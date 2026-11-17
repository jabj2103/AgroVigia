-- 0010: sugerencias IA, estado en vivo de la red y estado para el servicio de simulacion.
-- Requiere 0009. Gemini se invoca desde n8n; esta migracion solo guarda contexto y respuesta.
BEGIN;

-- 1. Sugerencias IA con su contexto y evidencias. Solo el servidor (n8n) escribe.
CREATE TABLE public.sugerencias_ia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cultivo_id uuid NOT NULL REFERENCES public.cultivos(id) ON DELETE RESTRICT,
  origen text NOT NULL CHECK (origen IN ('real','simulado')),
  motivo text NOT NULL CHECK (motivo IN ('periodica','alerta')),
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','generada','fallida')),
  plantilla_codigo text REFERENCES public.cultivo_plantillas(codigo),
  contexto jsonb NOT NULL CHECK (jsonb_typeof(contexto) = 'object'),
  respuesta jsonb,
  modelo text CHECK (modelo IS NULL OR modelo ~ '^[a-z0-9.\-]{3,60}$'),
  error_codigo text CHECK (error_codigo IS NULL OR error_codigo ~ '^[A-Z0-9_]{3,60}$'),
  tokens_entrada integer CHECK (tokens_entrada IS NULL OR tokens_entrada >= 0),
  tokens_salida integer CHECK (tokens_salida IS NULL OR tokens_salida >= 0),
  solicitada_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  completada_en timestamptz,
  CHECK ((estado = 'pendiente') = (completada_en IS NULL)),
  CHECK ((estado = 'generada') = (respuesta IS NOT NULL)),
  CHECK ((estado = 'fallida') = (error_codigo IS NOT NULL))
);
CREATE INDEX sugerencias_cultivo_fecha ON public.sugerencias_ia (cultivo_id, origen, solicitada_en DESC, id DESC);
CREATE INDEX sugerencias_fecha ON public.sugerencias_ia (solicitada_en DESC);
CREATE TABLE public.sugerencia_mediciones (
  sugerencia_id uuid NOT NULL REFERENCES public.sugerencias_ia(id) ON DELETE RESTRICT,
  medicion_id uuid NOT NULL REFERENCES public.mediciones(id) ON DELETE RESTRICT,
  PRIMARY KEY (sugerencia_id, medicion_id)
);

CREATE FUNCTION public.proteger_sugerencia() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.estado <> 'pendiente' OR NEW.contexto IS DISTINCT FROM OLD.contexto
     OR NEW.cultivo_id IS DISTINCT FROM OLD.cultivo_id OR NEW.origen IS DISTINCT FROM OLD.origen
     OR NEW.solicitada_en IS DISTINCT FROM OLD.solicitada_en THEN
    RAISE EXCEPTION 'SUGERENCIA_INMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER sugerencia_inmutable BEFORE UPDATE OR DELETE ON public.sugerencias_ia
FOR EACH ROW EXECUTE FUNCTION public.proteger_sugerencia();
CREATE TRIGGER evidencia_inmutable BEFORE UPDATE OR DELETE ON public.sugerencia_mediciones
FOR EACH ROW EXECUTE FUNCTION public.impedir_cambio_medicion();

ALTER TABLE public.sugerencias_ia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sugerencia_mediciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sugerencias_ia, public.sugerencia_mediciones FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.sugerencias_ia, public.sugerencia_mediciones TO authenticated, service_role;
CREATE POLICY leer_propias ON public.sugerencias_ia FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cultivos c WHERE c.id = cultivo_id AND c.agricultor_id = (SELECT auth.uid())));
CREATE POLICY leer_propias ON public.sugerencia_mediciones FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sugerencias_ia s JOIN public.cultivos c ON c.id = s.cultivo_id
                 WHERE s.id = sugerencia_id AND c.agricultor_id = (SELECT auth.uid())));

-- Decide si corresponde pedir una sugerencia y, si corresponde, la reserva con su contexto.
-- Control de gasto: 1 periodica cada 30 min por cultivo y origen; 1 adicional por alerta
-- nueva (separadas al menos 5 min); tras un fallo espera 10 min; topes de 60 por cultivo
-- y origen, y 400 en total cada 24 h. Una reserva pendiente de mas de 3 min se da por fallida.
CREATE FUNCTION public.reservar_sugerencia_ia(p_nodo_id uuid, p_mensaje_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ahora timestamptz := clock_timestamp(); n public.nodos; c public.cultivos;
  lote_origen text; lote_tomada timestamptz; ultima public.sugerencias_ia; motivo_nuevo text;
  nueva uuid; ctx jsonb; alerta_nueva boolean;
BEGIN
  SELECT * INTO n FROM public.nodos WHERE id = p_nodo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NODO_DESCONOCIDO' USING ERRCODE = '22023'; END IF;
  IF n.cultivo_id IS NULL OR NOT n.habilitado THEN RETURN jsonb_build_object('codigo','NODO_NO_ACTIVO'); END IF;
  SELECT m.origen, m.tomada_en INTO lote_origen, lote_tomada FROM public.mediciones m
   WHERE m.nodo_id = n.id AND m.mensaje_id = p_mensaje_id AND m.cultivo_id = n.cultivo_id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('codigo','LOTE_NO_ENCONTRADO'); END IF;
  -- Serializa por cultivo: dos nodos del mismo cultivo no reservan a la vez.
  SELECT * INTO c FROM public.cultivos WHERE id = n.cultivo_id AND archivado_en IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('codigo','CULTIVO_NO_ACTIVO'); END IF;
  IF lote_tomada < ahora - interval '180 seconds' OR lote_tomada > ahora + interval '120 seconds' THEN
    RETURN jsonb_build_object('codigo','LOTE_NO_RECIENTE');
  END IF;
  UPDATE public.sugerencias_ia SET estado = 'fallida', error_codigo = 'SIN_RESPUESTA', completada_en = ahora
   WHERE cultivo_id = c.id AND origen = lote_origen AND estado = 'pendiente' AND solicitada_en <= ahora - interval '3 minutes';
  IF EXISTS (SELECT 1 FROM public.sugerencias_ia WHERE cultivo_id = c.id AND origen = lote_origen AND estado = 'pendiente') THEN
    RETURN jsonb_build_object('codigo','SUGERENCIA_EN_CURSO');
  END IF;
  -- Por origen: los simulados de un cultivo mixto no agotan el cupo de los datos reales.
  IF (SELECT count(*) FROM public.sugerencias_ia WHERE cultivo_id = c.id AND origen = lote_origen
        AND solicitada_en > ahora - interval '24 hours') >= 60 THEN
    RETURN jsonb_build_object('codigo','LIMITE_DIARIO_CULTIVO');
  END IF;
  IF (SELECT count(*) FROM public.sugerencias_ia WHERE solicitada_en > ahora - interval '24 hours') >= 400 THEN
    RETURN jsonb_build_object('codigo','LIMITE_DIARIO_GLOBAL');
  END IF;
  SELECT * INTO ultima FROM public.sugerencias_ia WHERE cultivo_id = c.id AND origen = lote_origen
   ORDER BY solicitada_en DESC, id DESC LIMIT 1;
  alerta_nueva := EXISTS (SELECT 1 FROM public.alertas a WHERE a.cultivo_id = c.id AND a.origen = lote_origen
    AND a.cerrada_en IS NULL AND (ultima.id IS NULL OR a.abierta_en > ultima.solicitada_en));
  IF ultima.id IS NULL OR (ultima.estado = 'generada' AND ultima.solicitada_en <= ahora - interval '30 minutes')
     OR (ultima.estado = 'fallida' AND ultima.solicitada_en <= ahora - interval '10 minutes') THEN
    motivo_nuevo := CASE WHEN alerta_nueva THEN 'alerta' ELSE 'periodica' END;
  ELSIF alerta_nueva AND ultima.solicitada_en <= ahora - interval '5 minutes' THEN
    motivo_nuevo := 'alerta';
  ELSE
    RETURN jsonb_build_object('codigo','NO_CORRESPONDE','proxima_periodica_desde',
      ultima.solicitada_en + CASE WHEN ultima.estado = 'fallida' THEN interval '10 minutes' ELSE interval '30 minutes' END);
  END IF;

  ctx := jsonb_build_object(
    'cultivo', jsonb_build_object('nombre', c.nombre, 'tipo', c.tipo, 'area', c.area, 'unidad_area', c.unidad_area),
    'origen_datos', lote_origen,
    'motivo', motivo_nuevo,
    'hora_local', to_char(ahora AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD HH24:MI'),
    'periodo_del_dia', CASE WHEN extract(hour FROM ahora AT TIME ZONE 'America/Bogota') BETWEEN 6 AND 17 THEN 'dia' ELSE 'noche' END,
    -- Rangos vigentes: el ajuste propio del cultivo o, si no tiene, su plantilla (ajustada: true/false).
    'plantilla', public.parametros_efectivos(c.id),
    -- Evento de clima de PRUEBA activo; solo aplica a datos simulados.
    'clima_simulado', CASE WHEN lote_origen = 'simulado' THEN (SELECT jsonb_build_object('evento', k.evento, 'intensidad', k.intensidad, 'iniciado_en', k.iniciado_en)
        FROM public.clima_cultivo k WHERE k.cultivo_id = c.id AND k.finalizado_en IS NULL) END,
    -- Sensores segun las capacidades del nodo que envio el lote: fisico DHT22 + LDR, o virtual v3 (10 variables).
    'sensores', jsonb_build_object(
      'tipo_nodo', n.tipo_nodo,
      'variables', (SELECT jsonb_object_agg(nv.variable_codigo, jsonb_build_object('nombre', v.nombre, 'unidad', v.unidad, 'modelo', nv.sensor_modelo))
                    FROM public.nodo_variables nv JOIN public.variables v ON v.codigo = nv.variable_codigo WHERE nv.nodo_id = n.id),
      'notas', jsonb_build_array(
        'iluminacion_relativa es un indice relativo 0 a 100, no lux ni radiacion calibrada',
        'humedad_aire es humedad relativa del aire, distinta de la humedad del suelo',
        'en nodos virtuales todos los valores son sinteticos del simulador v3, no lecturas de campo'),
      'sin_sensor_de', (SELECT coalesce(jsonb_agg(x.nombre), '[]'::jsonb) FROM (VALUES ('humedad del suelo','humedad_suelo_vwc'),
          ('lluvia','precipitacion_60min'), ('viento','velocidad_viento')) x(nombre, codigo)
        WHERE NOT EXISTS (SELECT 1 FROM public.nodo_variables nv WHERE nv.nodo_id = n.id AND nv.variable_codigo = x.codigo))
        || jsonb_build_array('radiacion en lux')),
    'nodos', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'codigo', x.codigo, 'tipo_nodo', x.tipo_nodo, 'zona', (SELECT z.nombre FROM public.zonas z WHERE z.id = x.zona_id), 'ultima_captura', u.tomada_en,
        'antiguedad_segundos', CASE WHEN u.tomada_en IS NULL THEN NULL ELSE floor(extract(epoch FROM ahora - u.tomada_en)) END,
        'valores', (SELECT jsonb_object_agg(v.variable_codigo, v.valor) FROM public.mediciones v
                    WHERE v.nodo_id = x.id AND v.mensaje_id = u.mensaje_id AND v.cultivo_id = c.id))
        ORDER BY x.codigo)
      FROM public.nodos x
      LEFT JOIN LATERAL (SELECT m.mensaje_id, m.tomada_en FROM public.mediciones m
        WHERE m.cultivo_id = c.id AND m.nodo_id = x.id AND m.origen = lote_origen AND m.variable_codigo = 'temperatura_aire'
        ORDER BY m.tomada_en DESC LIMIT 1) u ON true
      WHERE x.cultivo_id = c.id AND x.habilitado AND ((x.tipo_nodo = 'virtual') = (lote_origen = 'simulado') OR x.id = n.id)), '[]'::jsonb),
    'estadisticas', coalesce((SELECT jsonb_object_agg(s.ventana || ':' || s.variable_codigo, jsonb_build_object(
        'muestras', s.muestras, 'minimo', s.minimo, 'maximo', s.maximo, 'promedio', s.promedio))
      FROM (SELECT w.ventana, m.variable_codigo, count(*) AS muestras, min(m.valor) AS minimo, max(m.valor) AS maximo,
                   round(avg(m.valor), 2) AS promedio
            FROM (VALUES ('ultima_hora', interval '1 hour'), ('ultimas_24h', interval '24 hours')) w(ventana, lapso)
            JOIN public.mediciones m ON m.cultivo_id = c.id AND m.origen = lote_origen AND m.tomada_en > ahora - w.lapso
            GROUP BY w.ventana, m.variable_codigo) s), '{}'::jsonb),
    'reglas_activas', coalesce((SELECT jsonb_agg(jsonb_build_object('variable', r.variable_codigo, 'minimo', r.minimo, 'maximo', r.maximo)
        ORDER BY r.variable_codigo)
      FROM public.reglas_alerta r WHERE r.cultivo_id = c.id AND r.origen = lote_origen AND r.habilitada), '[]'::jsonb),
    'alertas_abiertas', coalesce((SELECT jsonb_agg(jsonb_build_object('variable', a.variable_codigo, 'limite', a.limite,
        'umbral', a.umbral, 'valor_ultimo', a.valor_ultimo, 'abierta_en', a.abierta_en,
        'nodo', (SELECT x.codigo FROM public.nodos x WHERE x.id = a.nodo_id)) ORDER BY a.abierta_en DESC)
      FROM public.alertas a WHERE a.cultivo_id = c.id AND a.origen = lote_origen AND a.cerrada_en IS NULL), '[]'::jsonb));

  INSERT INTO public.sugerencias_ia (cultivo_id, origen, motivo, plantilla_codigo, contexto, solicitada_en)
  VALUES (c.id, lote_origen, motivo_nuevo, c.plantilla_codigo, ctx, ahora) RETURNING id INTO nueva;
  INSERT INTO public.sugerencia_mediciones (sugerencia_id, medicion_id)
  SELECT nueva, m.id FROM public.mediciones m WHERE m.nodo_id = n.id AND m.mensaje_id = p_mensaje_id AND m.cultivo_id = c.id;
  RETURN jsonb_build_object('codigo','RESERVADA','sugerencia_id', nueva, 'motivo', motivo_nuevo, 'contexto', ctx);
END; $$;

-- Valida la forma de la respuesta de IA antes de guardarla. Texto acotado, sin HTML.
CREATE FUNCTION public.texto_ia_valido(x jsonb, maximo integer) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce(jsonb_typeof(x) = 'string' AND length(btrim(x #>> '{}')) BETWEEN 1 AND maximo, false);
$$;
CREATE FUNCTION public.respuesta_ia_valida(r jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE e jsonb;
BEGIN
  IF r IS NULL OR jsonb_typeof(r) <> 'object' THEN RETURN false; END IF;
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(r) k)
     IS DISTINCT FROM ARRAY['estado_general','limitaciones','luz','recomendaciones','resumen','riego'] THEN RETURN false; END IF;
  IF NOT coalesce(r->>'estado_general' IN ('favorable','atencion','critico','datos_insuficientes'), false)
     OR NOT public.texto_ia_valido(r->'resumen', 600) OR NOT public.texto_ia_valido(r->'riego', 500)
     OR NOT public.texto_ia_valido(r->'luz', 500) OR NOT public.texto_ia_valido(r->'limitaciones', 500)
     OR jsonb_typeof(r->'recomendaciones') IS DISTINCT FROM 'array'
     OR r::text ~ '<[a-zA-Z/!]' THEN RETURN false; END IF;
  IF jsonb_array_length(r->'recomendaciones') NOT BETWEEN 1 AND 5 THEN RETURN false; END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(r->'recomendaciones') x LOOP
    IF jsonb_typeof(e) <> 'object' THEN RETURN false; END IF;
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(e) k)
       IS DISTINCT FROM ARRAY['accion','evidencia','prioridad','titulo','variable'] THEN RETURN false; END IF;
    IF NOT public.texto_ia_valido(e->'titulo', 100) OR NOT public.texto_ia_valido(e->'accion', 400)
       OR NOT public.texto_ia_valido(e->'evidencia', 300)
       OR NOT coalesce(e->>'prioridad' IN ('alta','media','baja'), false)
       OR NOT coalesce(e->>'variable' IN ('temperatura_aire','humedad_aire','iluminacion_relativa','radiacion_solar','humedad_suelo_vwc','temperatura_suelo','ph_suelo','conductividad_suelo_ece','precipitacion_60min','velocidad_viento','general'), false) THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END; $$;

CREATE FUNCTION public.completar_sugerencia_ia(
  p_sugerencia_id uuid, p_respuesta jsonb, p_modelo text, p_tokens_entrada integer, p_tokens_salida integer, p_error_codigo text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.sugerencias_ia; error_final text := p_error_codigo;
BEGIN
  SELECT * INTO s FROM public.sugerencias_ia WHERE id = p_sugerencia_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUGERENCIA_DESCONOCIDA' USING ERRCODE = '22023'; END IF;
  IF s.estado <> 'pendiente' THEN
    RETURN jsonb_build_object('codigo','SUGERENCIA_YA_COMPLETADA','estado', s.estado, 'sugerencia_id', s.id);
  END IF;
  IF error_final IS NULL AND (p_respuesta IS NULL OR NOT public.respuesta_ia_valida(p_respuesta)) THEN
    error_final := 'RESPUESTA_INVALIDA';
  END IF;
  IF error_final IS NOT NULL AND error_final !~ '^[A-Z0-9_]{3,60}$' THEN error_final := 'ERROR_NO_CLASIFICADO'; END IF;
  UPDATE public.sugerencias_ia SET
    estado = CASE WHEN error_final IS NULL THEN 'generada' ELSE 'fallida' END,
    respuesta = CASE WHEN error_final IS NULL THEN p_respuesta END,
    error_codigo = error_final,
    modelo = CASE WHEN p_modelo ~ '^[a-z0-9.\-]{3,60}$' THEN p_modelo END,
    tokens_entrada = CASE WHEN p_tokens_entrada >= 0 THEN p_tokens_entrada END,
    tokens_salida = CASE WHEN p_tokens_salida >= 0 THEN p_tokens_salida END,
    completada_en = clock_timestamp()
  WHERE id = s.id RETURNING * INTO s;
  RETURN jsonb_build_object('codigo', CASE WHEN s.estado = 'generada' THEN 'SUGERENCIA_GUARDADA' ELSE 'SUGERENCIA_FALLIDA' END,
    'estado', s.estado, 'sugerencia_id', s.id, 'error_codigo', s.error_codigo);
END; $$;

-- 2. Estado en vivo de la red para el Escenario. SECURITY INVOKER: respeta RLS de la cuenta.
-- Cada nodo muestra su ultimo lote del origen que le corresponde (virtual: simulado; fisico: real),
-- su configuracion de dispositivo, la pausa y el clima simulado activo de su cultivo. En un nodo fisico
-- con evento activo, 'proyeccion' trae el ultimo lote SIMULADO derivado de su lectura real.
CREATE FUNCTION public.estado_red_nodos() RETURNS TABLE (
  nodo_id uuid, codigo text, simulado boolean, habilitado boolean, cultivo_id uuid, cultivo_nombre text,
  plantilla_codigo text, zona_id uuid, zona_nombre text, origen text, mensaje_id text, tomada_en timestamptz, recibida_en timestamptz,
  temperatura numeric, humedad numeric, iluminacion numeric, humedad_suelo numeric,
  tipo_dispositivo text, protocolo text, intervalo_segundos integer, configuracion_manual boolean, recepcion_pausada boolean,
  clima_evento text, clima_intensidad smallint, clima_iniciado_en timestamptz, proyeccion jsonb
) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT n.id, n.codigo, n.tipo_nodo = 'virtual', n.habilitado, n.cultivo_id, c.nombre, c.plantilla_codigo,
         n.zona_id, z.nombre, u.origen, u.mensaje_id, u.tomada_en, u.recibida_en,
         (SELECT v.valor FROM public.mediciones v WHERE v.nodo_id = n.id AND v.mensaje_id = u.mensaje_id AND v.variable_codigo = 'temperatura_aire'),
         (SELECT v.valor FROM public.mediciones v WHERE v.nodo_id = n.id AND v.mensaje_id = u.mensaje_id AND v.variable_codigo = 'humedad_aire'),
         (SELECT v.valor FROM public.mediciones v WHERE v.nodo_id = n.id AND v.mensaje_id = u.mensaje_id AND v.variable_codigo = 'iluminacion_relativa'),
         (SELECT v.valor FROM public.mediciones v WHERE v.nodo_id = n.id AND v.mensaje_id = u.mensaje_id AND v.variable_codigo = 'humedad_suelo_vwc'),
         n.tipo_dispositivo, n.protocolo, n.intervalo_segundos, n.configuracion_manual, n.recepcion_pausada,
         k.evento, k.intensidad, k.iniciado_en,
         CASE WHEN n.tipo_nodo = 'fisico' AND k.id IS NOT NULL THEN (
           SELECT jsonb_build_object('mensaje_id', s.mensaje_id, 'tomada_en', s.tomada_en,
             'temperatura', (SELECT v.valor FROM public.mediciones v WHERE v.nodo_id = n.id AND v.mensaje_id = s.mensaje_id AND v.variable_codigo = 'temperatura_aire' AND v.origen = 'simulado'),
             'humedad', (SELECT v.valor FROM public.mediciones v WHERE v.nodo_id = n.id AND v.mensaje_id = s.mensaje_id AND v.variable_codigo = 'humedad_aire' AND v.origen = 'simulado'),
             'iluminacion', (SELECT v.valor FROM public.mediciones v WHERE v.nodo_id = n.id AND v.mensaje_id = s.mensaje_id AND v.variable_codigo = 'iluminacion_relativa' AND v.origen = 'simulado'))
           FROM public.mediciones s
           WHERE s.cultivo_id = n.cultivo_id AND s.nodo_id = n.id AND s.origen = 'simulado' AND s.variable_codigo = 'temperatura_aire'
             AND s.tomada_en >= date_trunc('second', k.iniciado_en) -- el contrato v2 trunca la captura al segundo
           ORDER BY s.tomada_en DESC, s.recibida_en DESC LIMIT 1) END
  FROM public.nodos n
  LEFT JOIN public.cultivos c ON c.id = n.cultivo_id
  LEFT JOIN public.zonas z ON z.id = n.zona_id
  LEFT JOIN public.clima_cultivo k ON k.cultivo_id = n.cultivo_id AND k.finalizado_en IS NULL
  LEFT JOIN LATERAL (SELECT m.origen, m.mensaje_id, m.tomada_en, m.recibida_en FROM public.mediciones m
    WHERE m.cultivo_id = n.cultivo_id AND m.nodo_id = n.id AND m.variable_codigo = 'temperatura_aire'
      AND m.origen = CASE WHEN n.tipo_nodo = 'virtual' THEN 'simulado' ELSE 'real' END
    ORDER BY m.tomada_en DESC, m.recibida_en DESC LIMIT 1) u ON true
  WHERE n.agricultor_id = (SELECT auth.uid())
  ORDER BY n.tipo_nodo, n.codigo;
$$;

-- 3. Estado para el servicio de simulacion (solo service_role). Por cada cultivo activo con nodos:
-- parametros vigentes, clima simulado activo, el evento que termino hace menos de 5 minutos (para
-- volver de forma gradual), y sus nodos con la version de asignacion, el intervalo y la pausa. En los
-- fisicos incluye la ultima lectura REAL de los ultimos 10 minutos, base de la proyeccion simulada.
CREATE FUNCTION public.estado_simulacion() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('generado_en', clock_timestamp(), 'cultivos', coalesce(jsonb_agg(x.fila ORDER BY x.nombre, x.id), '[]'::jsonb))
  FROM (
    SELECT c.id, c.nombre, jsonb_build_object(
      'cultivo_id', c.id, 'nombre', c.nombre, 'parametros', public.parametros_efectivos(c.id),
      'clima', (SELECT jsonb_build_object('evento', k.evento, 'intensidad', k.intensidad, 'iniciado_en', k.iniciado_en)
                FROM public.clima_cultivo k WHERE k.cultivo_id = c.id AND k.finalizado_en IS NULL),
      'clima_anterior', (SELECT jsonb_build_object('evento', k.evento, 'intensidad', k.intensidad, 'iniciado_en', k.iniciado_en, 'finalizado_en', k.finalizado_en)
                FROM public.clima_cultivo k WHERE k.cultivo_id = c.id AND k.finalizado_en > clock_timestamp() - interval '5 minutes'
                ORDER BY k.finalizado_en DESC LIMIT 1),
      'nodos', (SELECT jsonb_agg(jsonb_build_object(
          'codigo', n.codigo, 'tipo_nodo', n.tipo_nodo, 'asignacion_version', n.asignacion_version,
          'intervalo_segundos', n.intervalo_segundos, 'pausado', n.recepcion_pausada, 'zona', z.nombre,
          'ultima_real', CASE WHEN n.tipo_nodo = 'fisico' THEN (
            SELECT jsonb_build_object('tomada_en', r.tomada_en,
              'temperatura', (SELECT v.valor FROM public.mediciones v WHERE v.nodo_id = n.id AND v.mensaje_id = r.mensaje_id AND v.variable_codigo = 'temperatura_aire' AND v.origen = 'real'),
              'humedad', (SELECT v.valor FROM public.mediciones v WHERE v.nodo_id = n.id AND v.mensaje_id = r.mensaje_id AND v.variable_codigo = 'humedad_aire' AND v.origen = 'real'),
              'adc', (SELECT (v.metadatos -> 'ldr' ->> 'adc_promedio')::integer FROM public.mediciones v WHERE v.nodo_id = n.id AND v.mensaje_id = r.mensaje_id AND v.variable_codigo = 'iluminacion_relativa' AND v.origen = 'real'))
            FROM public.mediciones r
            WHERE r.cultivo_id = c.id AND r.nodo_id = n.id AND r.origen = 'real' AND r.variable_codigo = 'temperatura_aire'
              AND r.tomada_en > clock_timestamp() - interval '10 minutes'
            ORDER BY r.tomada_en DESC, r.recibida_en DESC LIMIT 1) END) ORDER BY n.codigo)
        FROM public.nodos n LEFT JOIN public.zonas z ON z.id = n.zona_id
        WHERE n.cultivo_id = c.id AND n.habilitado)) AS fila
    FROM public.cultivos c
    WHERE c.archivado_en IS NULL AND EXISTS (SELECT 1 FROM public.nodos n WHERE n.cultivo_id = c.id AND n.habilitado)
  ) x;
$$;

-- 4. Tiempo real: la web se suscribe a cambios de estas tablas (Supabase Realtime respeta RLS).
-- Fuera de Supabase la publicacion no existe y el bloque no hace nada.
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY['mediciones','nodos','clima_cultivo','alertas'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END LOOP;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.proteger_sugerencia(), public.reservar_sugerencia_ia(uuid,text),
  public.texto_ia_valido(jsonb,integer), public.respuesta_ia_valida(jsonb), public.completar_sugerencia_ia(uuid,jsonb,text,integer,integer,text),
  public.estado_red_nodos(), public.estado_simulacion() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.estado_red_nodos() TO authenticated;
GRANT EXECUTE ON FUNCTION public.reservar_sugerencia_ia(uuid,text), public.completar_sugerencia_ia(uuid,jsonb,text,integer,integer,text),
  public.estado_simulacion() TO service_role;
COMMIT;
