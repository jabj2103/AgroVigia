-- 0011: ajuste manual de la simulacion, sugerencias de IA a peticion, nodos virtuales gestionables
-- (crear, retirar, mover, eliminar), alta de cultivo sin nodos y borrado de cultivos sin historial.
-- Requiere 0001..0010. No modifica mediciones, reglas ni vinculos existentes.
BEGIN;

-- 0. Nodos eliminados. Un nodo sin mediciones se borra de verdad; uno con mediciones no puede borrarse
-- sin perderlas, asi que queda marcado: suelto, deshabilitado y con su codigo reservado.
ALTER TABLE public.nodos ADD COLUMN eliminado_en timestamptz;
ALTER TABLE public.nodos ADD CONSTRAINT nodo_eliminado_inactivo
  CHECK (eliminado_en IS NULL OR (cultivo_id IS NULL AND NOT habilitado));

-- 1. Ajuste manual de la simulacion por cultivo, con historial (mismo patron que clima_cultivo).
-- 'ajustes' es un objeto de DELTAS de prueba que el servicio de simulacion suma a lo que ya produce
-- (referencia del cultivo mas el evento de clima). Solo afecta a datos SIMULADOS: nodos virtuales y,
-- para temperatura y humedad del aire, la proyeccion simulada del nodo fisico. Sin fila activa la
-- simulacion es automatica.
CREATE TABLE public.ajustes_simulacion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cultivo_id uuid NOT NULL REFERENCES public.cultivos(id) ON DELETE RESTRICT,
  ajustes jsonb NOT NULL CHECK (jsonb_typeof(ajustes) = 'object' AND ajustes <> '{}'::jsonb),
  iniciado_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  finalizado_en timestamptz,
  actor_id uuid NOT NULL,
  CHECK (finalizado_en IS NULL OR finalizado_en >= iniciado_en)
);
CREATE UNIQUE INDEX ajuste_simulacion_activo ON public.ajustes_simulacion (cultivo_id) WHERE finalizado_en IS NULL;
CREATE INDEX ajustes_simulacion_fecha ON public.ajustes_simulacion (cultivo_id, iniciado_en DESC);
ALTER TABLE public.ajustes_simulacion ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ajustes_simulacion FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ajustes_simulacion TO authenticated, service_role;
CREATE POLICY leer_propios ON public.ajustes_simulacion FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cultivos c WHERE c.id = cultivo_id AND c.agricultor_id = (SELECT auth.uid())));

-- Valida y normaliza los deltas: solo claves permitidas, numeros con un decimal como maximo dentro de
-- su rango, y se conservan solo los distintos de cero. Un objeto vacio significa "automatico".
CREATE FUNCTION public.normalizar_ajustes_simulacion(p_ajustes jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  k text; v numeric; salida jsonb := '{}'::jsonb;
  limites CONSTANT jsonb := '{"temperatura_aire":[-10,10],"humedad_aire":[-30,30],"humedad_suelo_vwc":[-30,30],
    "ph_suelo":[-2,2],"precipitacion_60min":[-50,50],"velocidad_viento":[-10,15]}'::jsonb;
BEGIN
  IF p_ajustes IS NULL OR jsonb_typeof(p_ajustes) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'AJUSTE_INVALIDO' USING ERRCODE = '22023';
  END IF;
  FOR k IN SELECT jsonb_object_keys(p_ajustes) LOOP
    IF NOT limites ? k OR jsonb_typeof(p_ajustes -> k) IS DISTINCT FROM 'number' OR length(p_ajustes ->> k) > 12 THEN
      RAISE EXCEPTION 'AJUSTE_INVALIDO' USING ERRCODE = '22023';
    END IF;
    v := (p_ajustes ->> k)::numeric;
    IF v <> round(v, 1) OR v < (limites -> k ->> 0)::numeric OR v > (limites -> k ->> 1)::numeric THEN
      RAISE EXCEPTION 'AJUSTE_INVALIDO' USING ERRCODE = '22023';
    END IF;
    IF v <> 0 THEN salida := salida || jsonb_build_object(k, trim_scale(v)); END IF;
  END LOOP;
  RETURN salida;
END; $$;

-- Establece los deltas (o vuelve a automatico con un objeto vacio o todo en cero) en un cultivo o en
-- todos los cultivos activos de la cuenta. Cada cambio cierra el ajuste anterior y conserva el historial.
CREATE FUNCTION public.ajustar_simulacion(p_cultivo_id uuid, p_ajustes jsonb, p_todos boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  usuario uuid := auth.uid(); c public.cultivos; actual public.ajustes_simulacion; nuevo jsonb;
  ahora timestamptz := clock_timestamp(); cambiados integer := 0;
BEGIN
  SELECT * INTO c FROM public.cultivos WHERE id = p_cultivo_id AND agricultor_id = usuario;
  IF NOT FOUND THEN RAISE EXCEPTION 'CULTIVO_NO_AUTORIZADO' USING ERRCODE = '42501'; END IF;
  IF p_todos IS NULL THEN RAISE EXCEPTION 'AJUSTE_INVALIDO' USING ERRCODE = '22023'; END IF;
  nuevo := public.normalizar_ajustes_simulacion(p_ajustes);
  IF NOT p_todos AND c.archivado_en IS NOT NULL THEN RAISE EXCEPTION 'CULTIVO_ARCHIVADO' USING ERRCODE = '22023'; END IF;
  FOR c IN SELECT * FROM public.cultivos WHERE agricultor_id = usuario AND archivado_en IS NULL
            AND (p_todos OR id = p_cultivo_id) ORDER BY id FOR UPDATE LOOP
    SELECT * INTO actual FROM public.ajustes_simulacion WHERE cultivo_id = c.id AND finalizado_en IS NULL;
    IF actual.id IS NOT NULL AND actual.ajustes = nuevo THEN CONTINUE; END IF;
    IF actual.id IS NULL AND nuevo = '{}'::jsonb THEN CONTINUE; END IF;
    IF actual.id IS NOT NULL THEN UPDATE public.ajustes_simulacion SET finalizado_en = ahora WHERE id = actual.id; END IF;
    IF nuevo <> '{}'::jsonb THEN
      INSERT INTO public.ajustes_simulacion (cultivo_id, ajustes, iniciado_en, actor_id) VALUES (c.id, nuevo, ahora, usuario);
    END IF;
    cambiados := cambiados + 1;
  END LOOP;
  RETURN jsonb_build_object('codigo', 'AJUSTE_ESTABLECIDO', 'ajustes', nuevo, 'cultivos_cambiados', cambiados);
END; $$;

-- 2. Contexto de una sugerencia de IA, compartido por la reserva automatica (lote nuevo) y por la
-- sugerencia a peticion. Es el mismo de la 0010 mas 'ajustes_manuales' para origen simulado.
-- Funcion interna: nadie la ejecuta directamente.
CREATE FUNCTION public.contexto_sugerencia_ia(p_cultivo_id uuid, p_nodo_id uuid, p_origen text, p_motivo text, p_ahora timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'cultivo', jsonb_build_object('nombre', c.nombre, 'tipo', c.tipo, 'area', c.area, 'unidad_area', c.unidad_area),
    'origen_datos', p_origen,
    'motivo', p_motivo,
    'hora_local', to_char(p_ahora AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD HH24:MI'),
    'periodo_del_dia', CASE WHEN extract(hour FROM p_ahora AT TIME ZONE 'America/Bogota') BETWEEN 6 AND 17 THEN 'dia' ELSE 'noche' END,
    -- Rangos vigentes: el ajuste propio del cultivo o, si no tiene, su plantilla (ajustada: true/false).
    'plantilla', public.parametros_efectivos(c.id),
    -- Evento de clima de PRUEBA activo; solo aplica a datos simulados.
    'clima_simulado', CASE WHEN p_origen = 'simulado' THEN (SELECT jsonb_build_object('evento', k.evento, 'intensidad', k.intensidad, 'iniciado_en', k.iniciado_en)
        FROM public.clima_cultivo k WHERE k.cultivo_id = c.id AND k.finalizado_en IS NULL) END,
    -- Deltas que el usuario sumo a mano a la simulacion; solo aplica a datos simulados.
    'ajustes_manuales', CASE WHEN p_origen = 'simulado' THEN (SELECT a.ajustes
        FROM public.ajustes_simulacion a WHERE a.cultivo_id = c.id AND a.finalizado_en IS NULL) END,
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
        'antiguedad_segundos', CASE WHEN u.tomada_en IS NULL THEN NULL ELSE floor(extract(epoch FROM p_ahora - u.tomada_en)) END,
        'valores', (SELECT jsonb_object_agg(v.variable_codigo, v.valor) FROM public.mediciones v
                    WHERE v.nodo_id = x.id AND v.mensaje_id = u.mensaje_id AND v.cultivo_id = c.id))
        ORDER BY x.codigo)
      FROM public.nodos x
      LEFT JOIN LATERAL (SELECT m.mensaje_id, m.tomada_en FROM public.mediciones m
        WHERE m.cultivo_id = c.id AND m.nodo_id = x.id AND m.origen = p_origen AND m.variable_codigo = 'temperatura_aire'
        ORDER BY m.tomada_en DESC LIMIT 1) u ON true
      WHERE x.cultivo_id = c.id AND x.habilitado AND ((x.tipo_nodo = 'virtual') = (p_origen = 'simulado') OR x.id = n.id)), '[]'::jsonb),
    'estadisticas', coalesce((SELECT jsonb_object_agg(s.ventana || ':' || s.variable_codigo, jsonb_build_object(
        'muestras', s.muestras, 'minimo', s.minimo, 'maximo', s.maximo, 'promedio', s.promedio))
      FROM (SELECT w.ventana, m.variable_codigo, count(*) AS muestras, min(m.valor) AS minimo, max(m.valor) AS maximo,
                   round(avg(m.valor), 2) AS promedio
            FROM (VALUES ('ultima_hora', interval '1 hour'), ('ultimas_24h', interval '24 hours')) w(ventana, lapso)
            JOIN public.mediciones m ON m.cultivo_id = c.id AND m.origen = p_origen AND m.tomada_en > p_ahora - w.lapso
            GROUP BY w.ventana, m.variable_codigo) s), '{}'::jsonb),
    'reglas_activas', coalesce((SELECT jsonb_agg(jsonb_build_object('variable', r.variable_codigo, 'minimo', r.minimo, 'maximo', r.maximo)
        ORDER BY r.variable_codigo)
      FROM public.reglas_alerta r WHERE r.cultivo_id = c.id AND r.origen = p_origen AND r.habilitada), '[]'::jsonb),
    'alertas_abiertas', coalesce((SELECT jsonb_agg(jsonb_build_object('variable', a.variable_codigo, 'limite', a.limite,
        'umbral', a.umbral, 'valor_ultimo', a.valor_ultimo, 'abierta_en', a.abierta_en,
        'nodo', (SELECT x.codigo FROM public.nodos x WHERE x.id = a.nodo_id)) ORDER BY a.abierta_en DESC)
      FROM public.alertas a WHERE a.cultivo_id = c.id AND a.origen = p_origen AND a.cerrada_en IS NULL), '[]'::jsonb))
  FROM public.cultivos c JOIN public.nodos n ON n.id = p_nodo_id
  WHERE c.id = p_cultivo_id;
$$;

-- Una sugerencia tambien puede nacer de una peticion explicita del agricultor.
ALTER TABLE public.sugerencias_ia DROP CONSTRAINT sugerencias_ia_motivo_check;
ALTER TABLE public.sugerencias_ia ADD CONSTRAINT sugerencias_ia_motivo_check CHECK (motivo IN ('periodica','alerta','solicitud'));

-- Misma decision y control de gasto que en la 0010; el contexto sale de la funcion compartida.
CREATE OR REPLACE FUNCTION public.reservar_sugerencia_ia(p_nodo_id uuid, p_mensaje_id text) RETURNS jsonb
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
  ctx := public.contexto_sugerencia_ia(c.id, n.id, lote_origen, motivo_nuevo, ahora);
  INSERT INTO public.sugerencias_ia (cultivo_id, origen, motivo, plantilla_codigo, contexto, solicitada_en)
  VALUES (c.id, lote_origen, motivo_nuevo, c.plantilla_codigo, ctx, ahora) RETURNING id INTO nueva;
  INSERT INTO public.sugerencia_mediciones (sugerencia_id, medicion_id)
  SELECT nueva, m.id FROM public.mediciones m WHERE m.nodo_id = n.id AND m.mensaje_id = p_mensaje_id AND m.cultivo_id = c.id;
  RETURN jsonb_build_object('codigo','RESERVADA','sugerencia_id', nueva, 'motivo', motivo_nuevo, 'contexto', ctx);
END; $$;

-- 3. Sugerencia de IA a peticion del agricultor. La web solo registra la solicitud; n8n la toma,
-- consulta a Gemini con el mismo contexto de la reserva automatica y la cierra. Respeta el tope diario
-- de gasto, pero no exige alerta nueva ni el intervalo de las automaticas: es una peticion explicita.
-- 'en_proceso_desde' e 'intentos' son de uso del servidor, para recuperar solicitudes caidas.
CREATE TABLE public.solicitudes_ia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cultivo_id uuid NOT NULL REFERENCES public.cultivos(id) ON DELETE RESTRICT,
  origen text NOT NULL CHECK (origen IN ('real','simulado')),
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','en_proceso','atendida','rechazada','sin_datos','error')),
  detalle text CHECK (detalle IS NULL OR detalle ~ '^[A-Z0-9_]{3,60}$'),
  sugerencia_id uuid REFERENCES public.sugerencias_ia(id) ON DELETE RESTRICT,
  creada_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  cerrada_en timestamptz,
  actor_id uuid NOT NULL,
  en_proceso_desde timestamptz,
  intentos smallint NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  CHECK ((estado IN ('pendiente','en_proceso')) = (cerrada_en IS NULL)),
  CHECK ((estado = 'en_proceso') = (en_proceso_desde IS NOT NULL)),
  CHECK (estado <> 'atendida' OR sugerencia_id IS NOT NULL)
);
CREATE UNIQUE INDEX solicitud_ia_abierta ON public.solicitudes_ia (cultivo_id, origen) WHERE cerrada_en IS NULL;
CREATE INDEX solicitudes_ia_cultivo_fecha ON public.solicitudes_ia (cultivo_id, origen, creada_en DESC);
CREATE INDEX solicitudes_ia_pendientes ON public.solicitudes_ia (creada_en) WHERE cerrada_en IS NULL;
ALTER TABLE public.solicitudes_ia ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.solicitudes_ia FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.solicitudes_ia TO authenticated, service_role;
CREATE POLICY leer_propias ON public.solicitudes_ia FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cultivos c WHERE c.id = cultivo_id AND c.agricultor_id = (SELECT auth.uid())));

-- Recupera solicitudes caidas. En proceso mas de 5 minutos: vuelve a pendiente una vez y al segundo
-- intento caido se cierra como error. Pendiente mas de 15 minutos sin que nadie la tome: error.
-- Funcion interna.
CREATE FUNCTION public.depurar_solicitudes_ia(p_ahora timestamptz) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  UPDATE public.sugerencias_ia g SET estado = 'fallida', error_codigo = 'SIN_RESPUESTA', completada_en = p_ahora
   WHERE g.estado = 'pendiente' AND g.id IN (SELECT s.sugerencia_id FROM public.solicitudes_ia s
     WHERE s.estado = 'en_proceso' AND s.en_proceso_desde <= p_ahora - interval '5 minutes');
  UPDATE public.solicitudes_ia SET estado = 'error', detalle = 'PROCESO_INTERRUMPIDO', cerrada_en = p_ahora, en_proceso_desde = NULL
   WHERE estado = 'en_proceso' AND en_proceso_desde <= p_ahora - interval '5 minutes' AND intentos >= 2;
  UPDATE public.solicitudes_ia SET estado = 'pendiente', en_proceso_desde = NULL, sugerencia_id = NULL
   WHERE estado = 'en_proceso' AND en_proceso_desde <= p_ahora - interval '5 minutes';
  UPDATE public.solicitudes_ia SET estado = 'error', detalle = 'SOLICITUD_CADUCADA', cerrada_en = p_ahora
   WHERE estado = 'pendiente' AND creada_en <= p_ahora - interval '15 minutes';
END; $$;

-- Web: registra la peticion. Una sola abierta por cultivo y origen, y 60 s entre peticiones.
CREATE FUNCTION public.solicitar_sugerencia_ia(p_cultivo_id uuid, p_origen text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  usuario uuid := auth.uid(); c public.cultivos; ahora timestamptz := clock_timestamp();
  abierta uuid; ultima timestamptz; nueva uuid;
BEGIN
  SELECT * INTO c FROM public.cultivos WHERE id = p_cultivo_id AND agricultor_id = usuario;
  IF NOT FOUND THEN RAISE EXCEPTION 'CULTIVO_NO_AUTORIZADO' USING ERRCODE = '42501'; END IF;
  IF p_origen IS NULL OR p_origen NOT IN ('real','simulado') THEN RAISE EXCEPTION 'SOLICITUD_INVALIDA' USING ERRCODE = '22023'; END IF;
  IF c.archivado_en IS NOT NULL THEN RAISE EXCEPTION 'CULTIVO_ARCHIVADO' USING ERRCODE = '22023'; END IF;
  PERFORM public.depurar_solicitudes_ia(ahora);
  SELECT id INTO abierta FROM public.solicitudes_ia WHERE cultivo_id = c.id AND origen = p_origen AND cerrada_en IS NULL;
  IF FOUND THEN RETURN jsonb_build_object('codigo', 'SOLICITUD_EN_CURSO', 'solicitud_id', abierta); END IF;
  SELECT max(creada_en) INTO ultima FROM public.solicitudes_ia WHERE cultivo_id = c.id AND origen = p_origen;
  IF ultima > ahora - interval '60 seconds' THEN
    RETURN jsonb_build_object('codigo', 'SOLICITUD_EN_ESPERA', 'disponible_en', ultima + interval '60 seconds');
  END IF;
  BEGIN
    INSERT INTO public.solicitudes_ia (cultivo_id, origen, creada_en, actor_id) VALUES (c.id, p_origen, ahora, usuario) RETURNING id INTO nueva;
  EXCEPTION WHEN unique_violation THEN
    -- Dos peticiones simultaneas: gana la primera y la segunda la ve en curso.
    SELECT id INTO abierta FROM public.solicitudes_ia WHERE cultivo_id = c.id AND origen = p_origen AND cerrada_en IS NULL;
    RETURN jsonb_build_object('codigo', 'SOLICITUD_EN_CURSO', 'solicitud_id', abierta);
  END;
  RETURN jsonb_build_object('codigo', 'SOLICITUD_REGISTRADA', 'solicitud_id', nueva);
END; $$;

-- Servidor (n8n): toma de forma atomica las solicitudes pendientes mas antiguas y las marca en proceso.
CREATE FUNCTION public.tomar_solicitudes_ia(p_limite integer DEFAULT 3) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ahora timestamptz := clock_timestamp(); tomadas jsonb;
BEGIN
  IF p_limite IS NULL OR p_limite NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'LIMITE_INVALIDO' USING ERRCODE = '22023'; END IF;
  PERFORM public.depurar_solicitudes_ia(ahora);
  WITH elegidas AS (
    SELECT id FROM public.solicitudes_ia WHERE estado = 'pendiente' ORDER BY creada_en, id LIMIT p_limite FOR UPDATE SKIP LOCKED
  ), marcadas AS (
    UPDATE public.solicitudes_ia s SET estado = 'en_proceso', en_proceso_desde = ahora, intentos = s.intentos + 1
      FROM elegidas e WHERE s.id = e.id
    RETURNING s.id, s.cultivo_id, s.origen, s.creada_en, s.intentos
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('solicitud_id', m.id, 'cultivo_id', m.cultivo_id, 'origen', m.origen,
      'creada_en', m.creada_en, 'intento', m.intentos) ORDER BY m.creada_en, m.id), '[]'::jsonb)
    INTO tomadas FROM marcadas m;
  RETURN jsonb_build_object('codigo', 'SOLICITUDES_TOMADAS', 'solicitudes', tomadas);
END; $$;

-- Servidor (n8n): cierra una solicitud abierta. 'atendida' exige su sugerencia generada.
CREATE FUNCTION public.cerrar_solicitud_ia(p_solicitud_id uuid, p_estado text, p_detalle text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.solicitudes_ia; detalle_final text := p_detalle;
BEGIN
  SELECT * INTO s FROM public.solicitudes_ia WHERE id = p_solicitud_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SOLICITUD_DESCONOCIDA' USING ERRCODE = '22023'; END IF;
  IF p_estado IS NULL OR p_estado NOT IN ('atendida','rechazada','sin_datos','error') THEN
    RAISE EXCEPTION 'CIERRE_INVALIDO' USING ERRCODE = '22023';
  END IF;
  IF s.cerrada_en IS NOT NULL THEN
    RETURN jsonb_build_object('codigo', 'SOLICITUD_YA_CERRADA', 'solicitud_id', s.id, 'estado', s.estado,
      'detalle', s.detalle, 'sugerencia_id', s.sugerencia_id);
  END IF;
  IF p_estado = 'atendida' AND NOT EXISTS (SELECT 1 FROM public.sugerencias_ia g WHERE g.id = s.sugerencia_id AND g.estado = 'generada') THEN
    RAISE EXCEPTION 'CIERRE_INVALIDO' USING ERRCODE = '22023';
  END IF;
  IF p_estado = 'atendida' THEN detalle_final := NULL;
  ELSIF detalle_final IS NULL OR detalle_final !~ '^[A-Z0-9_]{3,60}$' THEN detalle_final := 'ERROR_NO_CLASIFICADO';
  END IF;
  UPDATE public.solicitudes_ia SET estado = p_estado, detalle = detalle_final, cerrada_en = clock_timestamp(), en_proceso_desde = NULL
   WHERE id = s.id RETURNING * INTO s;
  RETURN jsonb_build_object('codigo', 'SOLICITUD_CERRADA', 'solicitud_id', s.id, 'estado', s.estado,
    'detalle', s.detalle, 'sugerencia_id', s.sugerencia_id);
END; $$;

-- Servidor (n8n): reserva la sugerencia de una solicitud en proceso con el ultimo lote reciente de ese
-- origen en el cultivo (en simulado se prefiere un nodo virtual, que trae las diez variables).
-- Sin lote reciente la cierra como sin_datos; con el tope diario agotado, como rechazada.
CREATE FUNCTION public.preparar_solicitud_ia(p_solicitud_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ahora timestamptz := clock_timestamp(); s public.solicitudes_ia; c public.cultivos; g public.sugerencias_ia;
  lote_nodo uuid; lote_mensaje text; nueva uuid; ctx jsonb;
BEGIN
  SELECT * INTO s FROM public.solicitudes_ia WHERE id = p_solicitud_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SOLICITUD_DESCONOCIDA' USING ERRCODE = '22023'; END IF;
  IF s.estado <> 'en_proceso' THEN
    RETURN jsonb_build_object('codigo', 'SOLICITUD_NO_EN_PROCESO', 'solicitud_id', s.id, 'estado', s.estado);
  END IF;
  -- Reintento del servidor: la reserva ya existe y se devuelve tal cual.
  IF s.sugerencia_id IS NOT NULL THEN
    SELECT * INTO g FROM public.sugerencias_ia WHERE id = s.sugerencia_id;
    IF g.estado = 'pendiente' THEN
      RETURN jsonb_build_object('codigo', 'RESERVADA', 'solicitud_id', s.id, 'sugerencia_id', g.id, 'motivo', g.motivo, 'contexto', g.contexto);
    END IF;
    RETURN public.cerrar_solicitud_ia(s.id, CASE WHEN g.estado = 'generada' THEN 'atendida' ELSE 'error' END, g.error_codigo);
  END IF;
  SELECT * INTO c FROM public.cultivos WHERE id = s.cultivo_id AND archivado_en IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN public.cerrar_solicitud_ia(s.id, 'error', 'CULTIVO_NO_ACTIVO'); END IF;
  SELECT m.nodo_id, m.mensaje_id INTO lote_nodo, lote_mensaje
    FROM public.mediciones m JOIN public.nodos n ON n.id = m.nodo_id
   WHERE m.cultivo_id = c.id AND m.origen = s.origen AND m.variable_codigo = 'temperatura_aire'
     AND n.cultivo_id = c.id AND n.habilitado
     AND m.tomada_en >= ahora - interval '180 seconds' AND m.tomada_en <= ahora + interval '120 seconds'
   ORDER BY ((n.tipo_nodo = 'virtual') = (s.origen = 'simulado')) DESC, m.tomada_en DESC, m.recibida_en DESC LIMIT 1;
  IF NOT FOUND THEN RETURN public.cerrar_solicitud_ia(s.id, 'sin_datos', 'SIN_LOTE_RECIENTE'); END IF;
  UPDATE public.sugerencias_ia SET estado = 'fallida', error_codigo = 'SIN_RESPUESTA', completada_en = ahora
   WHERE cultivo_id = c.id AND origen = s.origen AND estado = 'pendiente' AND solicitada_en <= ahora - interval '3 minutes';
  -- Hay una sugerencia automatica en curso para este cultivo y origen: la solicitud espera al siguiente sondeo.
  IF EXISTS (SELECT 1 FROM public.sugerencias_ia WHERE cultivo_id = c.id AND origen = s.origen AND estado = 'pendiente') THEN
    UPDATE public.solicitudes_ia SET estado = 'pendiente', en_proceso_desde = NULL, intentos = greatest(intentos - 1, 0) WHERE id = s.id;
    RETURN jsonb_build_object('codigo', 'SOLICITUD_APLAZADA', 'solicitud_id', s.id, 'motivo', 'SUGERENCIA_EN_CURSO');
  END IF;
  IF (SELECT count(*) FROM public.sugerencias_ia WHERE cultivo_id = c.id AND origen = s.origen
        AND solicitada_en > ahora - interval '24 hours') >= 60 THEN
    RETURN public.cerrar_solicitud_ia(s.id, 'rechazada', 'LIMITE_DIARIO_CULTIVO');
  END IF;
  IF (SELECT count(*) FROM public.sugerencias_ia WHERE solicitada_en > ahora - interval '24 hours') >= 400 THEN
    RETURN public.cerrar_solicitud_ia(s.id, 'rechazada', 'LIMITE_DIARIO_GLOBAL');
  END IF;
  ctx := public.contexto_sugerencia_ia(c.id, lote_nodo, s.origen, 'solicitud', ahora);
  INSERT INTO public.sugerencias_ia (cultivo_id, origen, motivo, plantilla_codigo, contexto, solicitada_en)
  VALUES (c.id, s.origen, 'solicitud', c.plantilla_codigo, ctx, ahora) RETURNING id INTO nueva;
  INSERT INTO public.sugerencia_mediciones (sugerencia_id, medicion_id)
  SELECT nueva, m.id FROM public.mediciones m WHERE m.nodo_id = lote_nodo AND m.mensaje_id = lote_mensaje AND m.cultivo_id = c.id;
  UPDATE public.solicitudes_ia SET sugerencia_id = nueva WHERE id = s.id;
  RETURN jsonb_build_object('codigo', 'RESERVADA', 'solicitud_id', s.id, 'sugerencia_id', nueva, 'motivo', 'solicitud', 'contexto', ctx);
END; $$;

-- Servidor (n8n): guarda la respuesta de Gemini (o su error) en la sugerencia reservada y cierra la
-- solicitud en la misma transaccion: atendida si la sugerencia quedo generada, error si fallo.
CREATE FUNCTION public.completar_solicitud_ia(
  p_solicitud_id uuid, p_respuesta jsonb, p_modelo text, p_tokens_entrada integer, p_tokens_salida integer, p_error_codigo text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.solicitudes_ia; g public.sugerencias_ia; cierre jsonb;
BEGIN
  SELECT * INTO s FROM public.solicitudes_ia WHERE id = p_solicitud_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SOLICITUD_DESCONOCIDA' USING ERRCODE = '22023'; END IF;
  IF s.cerrada_en IS NOT NULL THEN
    RETURN jsonb_build_object('codigo', 'SOLICITUD_YA_CERRADA', 'solicitud_id', s.id, 'estado', s.estado,
      'detalle', s.detalle, 'sugerencia_id', s.sugerencia_id);
  END IF;
  IF s.estado <> 'en_proceso' OR s.sugerencia_id IS NULL THEN
    RETURN jsonb_build_object('codigo', 'SOLICITUD_SIN_RESERVA', 'solicitud_id', s.id, 'estado', s.estado);
  END IF;
  PERFORM public.completar_sugerencia_ia(s.sugerencia_id, p_respuesta, p_modelo, p_tokens_entrada, p_tokens_salida, p_error_codigo);
  SELECT * INTO g FROM public.sugerencias_ia WHERE id = s.sugerencia_id;
  cierre := public.cerrar_solicitud_ia(s.id, CASE WHEN g.estado = 'generada' THEN 'atendida' ELSE 'error' END, g.error_codigo);
  RETURN cierre || jsonb_build_object('sugerencia_estado', g.estado);
END; $$;

-- 4. Estado para el servicio de simulacion: agrega el ajuste manual activo de cada cultivo.
CREATE OR REPLACE FUNCTION public.estado_simulacion() RETURNS jsonb
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
      'ajustes', (SELECT a.ajustes FROM public.ajustes_simulacion a WHERE a.cultivo_id = c.id AND a.finalizado_en IS NULL),
      'ajustes_iniciado_en', (SELECT a.iniciado_en FROM public.ajustes_simulacion a WHERE a.cultivo_id = c.id AND a.finalizado_en IS NULL),
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
        WHERE n.cultivo_id = c.id AND n.habilitado AND n.eliminado_en IS NULL)) AS fila
    FROM public.cultivos c
    WHERE c.archivado_en IS NULL AND EXISTS (SELECT 1 FROM public.nodos n WHERE n.cultivo_id = c.id AND n.habilitado AND n.eliminado_en IS NULL)
  ) x;
$$;

-- Estado en vivo de la red: mismas columnas que en la 0010. No lista los nodos eliminados. Cambia cuando aparece 'proyeccion' en un
-- nodo fisico: ademas de con un evento de clima activo, con un ajuste manual activo de temperatura o
-- humedad del aire (lo unico que mide el fisico). La proyeccion es siempre un lote de origen simulado.
CREATE OR REPLACE FUNCTION public.estado_red_nodos() RETURNS TABLE (
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
         CASE WHEN n.tipo_nodo = 'fisico' AND (k.id IS NOT NULL OR a.id IS NOT NULL) THEN (
           SELECT jsonb_build_object('mensaje_id', s.mensaje_id, 'tomada_en', s.tomada_en,
             'temperatura', (SELECT v.valor FROM public.mediciones v WHERE v.nodo_id = n.id AND v.mensaje_id = s.mensaje_id AND v.variable_codigo = 'temperatura_aire' AND v.origen = 'simulado'),
             'humedad', (SELECT v.valor FROM public.mediciones v WHERE v.nodo_id = n.id AND v.mensaje_id = s.mensaje_id AND v.variable_codigo = 'humedad_aire' AND v.origen = 'simulado'),
             'iluminacion', (SELECT v.valor FROM public.mediciones v WHERE v.nodo_id = n.id AND v.mensaje_id = s.mensaje_id AND v.variable_codigo = 'iluminacion_relativa' AND v.origen = 'simulado'))
           FROM public.mediciones s
           WHERE s.cultivo_id = n.cultivo_id AND s.nodo_id = n.id AND s.origen = 'simulado' AND s.variable_codigo = 'temperatura_aire'
             -- Desde el cambio mas reciente (evento o ajuste). El contrato v2 trunca la captura al segundo.
             AND s.tomada_en >= date_trunc('second', greatest(k.iniciado_en, a.iniciado_en))
           ORDER BY s.tomada_en DESC, s.recibida_en DESC LIMIT 1) END
  FROM public.nodos n
  LEFT JOIN public.cultivos c ON c.id = n.cultivo_id
  LEFT JOIN public.zonas z ON z.id = n.zona_id
  LEFT JOIN public.clima_cultivo k ON k.cultivo_id = n.cultivo_id AND k.finalizado_en IS NULL
  LEFT JOIN public.ajustes_simulacion a ON a.cultivo_id = n.cultivo_id AND a.finalizado_en IS NULL
    AND a.ajustes ?| ARRAY['temperatura_aire','humedad_aire']
  LEFT JOIN LATERAL (SELECT m.origen, m.mensaje_id, m.tomada_en, m.recibida_en FROM public.mediciones m
    WHERE m.cultivo_id = n.cultivo_id AND m.nodo_id = n.id AND m.variable_codigo = 'temperatura_aire'
      AND m.origen = CASE WHEN n.tipo_nodo = 'virtual' THEN 'simulado' ELSE 'real' END
    ORDER BY m.tomada_en DESC, m.recibida_en DESC LIMIT 1) u ON true
  WHERE n.agricultor_id = (SELECT auth.uid()) AND n.eliminado_en IS NULL
  ORDER BY n.tipo_nodo, n.codigo;
$$;

-- 5. Nodos virtuales gestionables por el agricultor. Un nodo virtual solo recibe datos simulados v3
-- (lo garantiza la 0007). El codigo sigue la convencion sim-<12 primeros hex del cultivo>-NN.

-- Interna: si el cultivo todavia no tiene sectores, crea los cuatro del croquis (mismos codigos, nombres
-- y geometria que provisionar-hexagonos.sql).
CREATE FUNCTION public.asegurar_sectores_cultivo(p_cultivo_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.zonas WHERE cultivo_id = p_cultivo_id) THEN RETURN; END IF;
  INSERT INTO public.zonas (cultivo_id, codigo, nombre, plano_x, plano_y, plano_ancho, plano_alto)
  SELECT p_cultivo_id, s.codigo, s.nombre, CASE WHEN s.i IN (1, 3) THEN 0.05 ELSE 0.525 END,
         CASE WHEN s.i <= 2 THEN 0.05 ELSE 0.525 END, 0.425, 0.425
    FROM (VALUES (1, 'zona-norte', 'Sector norte'), (2, 'zona-sur', 'Sector sur'),
                 (3, 'zona-central', 'Sector central'), (4, 'zona-drenaje', 'Sector de drenaje')) s(i, codigo, nombre);
END; $$;
-- Interna: sector de destino dentro del cultivo. El indicado si es suyo; sin indicar, el que menos nodos
-- tiene (sin contar al propio nodo), con desempate por codigo. NULL si el sector no es del cultivo.
CREATE FUNCTION public.elegir_sector_nodo(p_cultivo_id uuid, p_zona_id uuid, p_nodo_id uuid) RETURNS uuid
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT z.id FROM public.zonas z
   WHERE z.cultivo_id = p_cultivo_id AND (p_zona_id IS NULL OR z.id = p_zona_id)
   ORDER BY (SELECT count(*) FROM public.nodos x WHERE x.zona_id = z.id AND x.id IS DISTINCT FROM p_nodo_id), z.codigo LIMIT 1;
$$;
-- Interna: primera posicion libre dentro del sector, para que dos nodos no queden encimados en el plano.
CREATE FUNCTION public.posicion_libre_sector(p_zona_id uuid, p_nodo_id uuid) RETURNS numeric[]
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce((SELECT ARRAY[p.x, p.y]
    FROM (VALUES (1, 0.5, 0.5), (2, 0.25, 0.3), (3, 0.75, 0.7), (4, 0.75, 0.3), (5, 0.25, 0.7),
                 (6, 0.5, 0.2), (7, 0.5, 0.8), (8, 0.2, 0.5), (9, 0.8, 0.5)) p(orden, x, y)
   WHERE NOT EXISTS (SELECT 1 FROM public.nodos n WHERE n.zona_id = p_zona_id AND n.id IS DISTINCT FROM p_nodo_id
                       AND n.posicion_x = p.x AND n.posicion_y = p.y)
   ORDER BY p.orden LIMIT 1), ARRAY[0.5, 0.5]);
$$;

-- Si el cultivo todavia no tiene sectores los crea. Con p_zona_id NULL elige el sector con menos nodos.
CREATE FUNCTION public.crear_nodo_virtual(p_cultivo_id uuid, p_zona_id uuid DEFAULT NULL) RETURNS public.nodos
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  usuario uuid := auth.uid(); c public.cultivos; zona uuid; n public.nodos; cod text; pos numeric[];
BEGIN
  PERFORM 1 FROM public.perfiles WHERE id = usuario FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERFIL_NO_AUTORIZADO' USING ERRCODE = '42501'; END IF;
  SELECT * INTO c FROM public.cultivos WHERE id = p_cultivo_id AND agricultor_id = usuario FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CULTIVO_NO_AUTORIZADO' USING ERRCODE = '42501'; END IF;
  IF c.archivado_en IS NOT NULL THEN RAISE EXCEPTION 'CULTIVO_ARCHIVADO' USING ERRCODE = '22023'; END IF;
  PERFORM public.asegurar_sectores_cultivo(c.id);
  zona := public.elegir_sector_nodo(c.id, p_zona_id, NULL);
  IF zona IS NULL THEN RAISE EXCEPTION 'ZONA_NO_AUTORIZADA' USING ERRCODE = '42501'; END IF;
  -- Mismo limite que vincular_nodo (0007): dieciseis virtuales por cultivo.
  IF (SELECT count(*) FROM public.nodos WHERE cultivo_id = c.id AND tipo_nodo = 'virtual') >= 16 THEN
    RAISE EXCEPTION 'LIMITE_NODOS_CULTIVO' USING ERRCODE = '22023';
  END IF;
  -- Siguiente numero libre: un nodo retirado o eliminado con historial conserva su codigo.
  SELECT 'sim-' || substr(replace(c.id::text, '-', ''), 1, 12) || '-' || lpad(i::text, 2, '0') INTO cod
    FROM generate_series(1, 99) i
   WHERE NOT EXISTS (SELECT 1 FROM public.nodos x
                      WHERE x.codigo = 'sim-' || substr(replace(c.id::text, '-', ''), 1, 12) || '-' || lpad(i::text, 2, '0'))
   ORDER BY i LIMIT 1;
  IF cod IS NULL THEN RAISE EXCEPTION 'SIN_CODIGO_DISPONIBLE' USING ERRCODE = '22023'; END IF;
  pos := public.posicion_libre_sector(zona, NULL);
  INSERT INTO public.nodos (codigo, agricultor_id, cultivo_id, tipo_nodo, zona_id, posicion_x, posicion_y)
  VALUES (cod, usuario, c.id, 'virtual', zona, pos[1], pos[2]) RETURNING * INTO n;
  INSERT INTO public.nodo_variables (nodo_id, variable_codigo, sensor_modelo)
  SELECT n.id, v, 'SIMULADOR_V3' FROM unnest(ARRAY['temperatura_aire','humedad_aire','iluminacion_relativa','radiacion_solar',
    'humedad_suelo_vwc','temperatura_suelo','ph_suelo','conductividad_suelo_ece','precipitacion_60min','velocidad_viento']) v;
  RETURN n;
END; $$;

-- Desvincula un nodo virtual de su cultivo con desvincular_nodo (0005): conserva mediciones e historial
-- de asignaciones, libera su sector y cierra sus alertas abiertas. Queda suelto y puede volver a
-- vincularse con vincular_nodo y asignar_zona_nodo.
CREATE FUNCTION public.retirar_nodo_virtual(p_nodo_id uuid) RETURNS public.nodos
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE usuario uuid := auth.uid(); n public.nodos;
BEGIN
  PERFORM 1 FROM public.perfiles WHERE id = usuario FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERFIL_NO_AUTORIZADO' USING ERRCODE = '42501'; END IF;
  SELECT * INTO n FROM public.nodos WHERE id = p_nodo_id AND agricultor_id = usuario;
  IF NOT FOUND THEN RAISE EXCEPTION 'NODO_NO_AUTORIZADO' USING ERRCODE = '42501'; END IF;
  IF n.tipo_nodo <> 'virtual' THEN RAISE EXCEPTION 'NODO_NO_VIRTUAL' USING ERRCODE = '22023'; END IF;
  IF n.cultivo_id IS NULL THEN RETURN n; END IF;
  RETURN public.desvincular_nodo(n.id, n.cultivo_id);
END; $$;

-- Mueve un nodo virtual (vinculado o suelto) a otro cultivo propio y activo, o lo cambia de sector dentro
-- del mismo cultivo. Conserva codigo, capacidades e historial: las mediciones anteriores siguen en el
-- cultivo donde se tomaron. Al cambiar de cultivo se cierran sus alertas abiertas y cambia su version de
-- asignacion, igual que al desvincular.
CREATE FUNCTION public.mover_nodo_virtual(p_nodo_id uuid, p_cultivo_id uuid, p_zona_id uuid DEFAULT NULL) RETURNS public.nodos
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE usuario uuid := auth.uid(); destino public.cultivos; n public.nodos; zona uuid; pos numeric[];
BEGIN
  PERFORM 1 FROM public.perfiles WHERE id = usuario FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERFIL_NO_AUTORIZADO' USING ERRCODE = '42501'; END IF;
  SELECT * INTO destino FROM public.cultivos WHERE id = p_cultivo_id AND agricultor_id = usuario FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CULTIVO_NO_AUTORIZADO' USING ERRCODE = '42501'; END IF;
  IF destino.archivado_en IS NOT NULL THEN RAISE EXCEPTION 'CULTIVO_ARCHIVADO' USING ERRCODE = '22023'; END IF;
  SELECT * INTO n FROM public.nodos WHERE id = p_nodo_id AND agricultor_id = usuario FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NODO_NO_AUTORIZADO' USING ERRCODE = '42501'; END IF;
  IF n.tipo_nodo <> 'virtual' THEN RAISE EXCEPTION 'NODO_NO_VIRTUAL' USING ERRCODE = '22023'; END IF;
  IF n.eliminado_en IS NOT NULL THEN RAISE EXCEPTION 'NODO_ELIMINADO' USING ERRCODE = '22023'; END IF;
  IF NOT n.habilitado THEN RAISE EXCEPTION 'NODO_DESHABILITADO' USING ERRCODE = '22023'; END IF;
  PERFORM public.asegurar_sectores_cultivo(destino.id);
  zona := public.elegir_sector_nodo(destino.id, p_zona_id, n.id);
  IF zona IS NULL THEN RAISE EXCEPTION 'ZONA_NO_AUTORIZADA' USING ERRCODE = '42501'; END IF;
  IF n.cultivo_id IS NOT DISTINCT FROM destino.id THEN
    IF n.zona_id IS NOT DISTINCT FROM zona THEN RETURN n; END IF;
  ELSE
    IF (SELECT count(*) FROM public.nodos WHERE cultivo_id = destino.id AND tipo_nodo = 'virtual') >= 16 THEN
      RAISE EXCEPTION 'LIMITE_NODOS_CULTIVO' USING ERRCODE = '22023';
    END IF;
    -- El cambio de cultivo deja al nodo sin sector (0007); el sector nuevo se asigna a continuacion.
    UPDATE public.nodos SET cultivo_id = destino.id WHERE id = n.id;
  END IF;
  pos := public.posicion_libre_sector(zona, n.id);
  UPDATE public.nodos SET zona_id = zona, posicion_x = pos[1], posicion_y = pos[2] WHERE id = n.id RETURNING * INTO n;
  RETURN n;
END; $$;

-- La auditoria de asignaciones sigue siendo inmutable. Solo se borra junto con el nodo o el cultivo al
-- que pertenece, dentro de eliminar_nodo_virtual y eliminar_cultivo, que lo senalan en su transaccion.
-- Los clientes no tienen permiso de borrado sobre la tabla.
CREATE FUNCTION public.proteger_asignacion() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('agrovigia.borrado_definitivo', true) = 'si' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Una asignacion registrada no se modifica ni se borra' USING ERRCODE = '23514';
END; $$;
DROP TRIGGER asignacion_inmutable ON public.nodo_asignaciones;
CREATE TRIGGER asignacion_inmutable BEFORE UPDATE OR DELETE ON public.nodo_asignaciones
FOR EACH ROW EXECUTE FUNCTION public.proteger_asignacion();

-- Elimina un nodo virtual propio. Si esta vinculado, primero lo desvincula. Sin mediciones ni alertas
-- se borra de verdad, con sus capacidades y su historial de asignaciones. Con mediciones no se pierde
-- nada: queda marcado como eliminado, suelto y deshabilitado, y su codigo no se reutiliza.
CREATE FUNCTION public.eliminar_nodo_virtual(p_nodo_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE usuario uuid := auth.uid(); n public.nodos;
BEGIN
  PERFORM 1 FROM public.perfiles WHERE id = usuario FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERFIL_NO_AUTORIZADO' USING ERRCODE = '42501'; END IF;
  SELECT * INTO n FROM public.nodos WHERE id = p_nodo_id AND agricultor_id = usuario FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NODO_NO_AUTORIZADO' USING ERRCODE = '42501'; END IF;
  IF n.tipo_nodo <> 'virtual' THEN RAISE EXCEPTION 'NODO_NO_VIRTUAL' USING ERRCODE = '22023'; END IF;
  IF n.eliminado_en IS NOT NULL THEN
    RETURN jsonb_build_object('codigo', 'NODO_ELIMINADO', 'modo', 'retirado', 'nodo_id', n.id);
  END IF;
  IF n.cultivo_id IS NOT NULL THEN UPDATE public.nodos SET cultivo_id = NULL WHERE id = n.id; END IF;
  IF EXISTS (SELECT 1 FROM public.mediciones WHERE nodo_id = n.id) OR EXISTS (SELECT 1 FROM public.alertas WHERE nodo_id = n.id) THEN
    UPDATE public.nodos SET eliminado_en = clock_timestamp(), habilitado = false WHERE id = n.id;
    RETURN jsonb_build_object('codigo', 'NODO_ELIMINADO', 'modo', 'retirado', 'nodo_id', n.id);
  END IF;
  DELETE FROM public.alerta_cursores WHERE nodo_id = n.id;
  PERFORM set_config('agrovigia.borrado_definitivo', 'si', true);
  DELETE FROM public.nodo_asignaciones WHERE nodo_id = n.id;
  PERFORM set_config('agrovigia.borrado_definitivo', '', true);
  DELETE FROM public.nodo_variables WHERE nodo_id = n.id;
  DELETE FROM public.nodos WHERE id = n.id;
  RETURN jsonb_build_object('codigo', 'NODO_ELIMINADO', 'modo', 'borrado', 'nodo_id', n.id);
END; $$;

-- Un nodo eliminado no vuelve a vincularse. Es vincular_nodo de la 0007 con esa unica comprobacion mas.
CREATE OR REPLACE FUNCTION public.vincular_nodo(p_nodo_id uuid,p_cultivo_id uuid) RETURNS public.nodos
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE usuario uuid:=auth.uid(); destino public.cultivos; nodo public.nodos; limite integer;
BEGIN
 PERFORM 1 FROM public.perfiles WHERE id=usuario FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PERFIL_NO_AUTORIZADO' USING ERRCODE='42501'; END IF;
 SELECT * INTO destino FROM public.cultivos WHERE id=p_cultivo_id AND agricultor_id=usuario FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CULTIVO_NO_AUTORIZADO' USING ERRCODE='42501'; END IF;
 IF destino.archivado_en IS NOT NULL THEN RAISE EXCEPTION 'CULTIVO_ARCHIVADO' USING ERRCODE='22023'; END IF;
 SELECT * INTO nodo FROM public.nodos WHERE id=p_nodo_id AND agricultor_id=usuario FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NODO_NO_AUTORIZADO' USING ERRCODE='42501'; END IF;
 IF nodo.eliminado_en IS NOT NULL THEN RAISE EXCEPTION 'NODO_ELIMINADO' USING ERRCODE='22023'; END IF;
 IF NOT nodo.habilitado THEN RAISE EXCEPTION 'NODO_DESHABILITADO' USING ERRCODE='22023'; END IF;
 IF nodo.cultivo_id=p_cultivo_id THEN RETURN nodo; END IF;
 IF nodo.cultivo_id IS NOT NULL THEN RAISE EXCEPTION 'NODO_OCUPADO' USING ERRCODE='22023'; END IF;
 limite:=CASE WHEN nodo.tipo_nodo='virtual' THEN 16 ELSE 2 END;
 IF (SELECT count(*) FROM public.nodos WHERE cultivo_id=p_cultivo_id AND tipo_nodo=nodo.tipo_nodo)>=limite THEN
  RAISE EXCEPTION 'LIMITE_NODOS_CULTIVO' USING ERRCODE='22023';
 END IF;
 UPDATE public.nodos SET cultivo_id=p_cultivo_id WHERE id=p_nodo_id RETURNING * INTO nodo;
 RETURN nodo;
END; $$;

-- Borrado definitivo de un cultivo propio SIN historial: ninguna medicion, alerta ni sugerencia. Con
-- historial el camino es archivar_cultivo. Libera sus nodos (los fisicos quedan disponibles y los virtuales
-- sueltos, sin borrarlos) y borra lo que solo existe por el cultivo: sectores, parametros, reglas, clima,
-- ajustes, solicitudes y las entradas de auditoria de asignaciones que lo nombran.
CREATE FUNCTION public.eliminar_cultivo(p_cultivo_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE usuario uuid := auth.uid(); c public.cultivos; liberados integer;
BEGIN
  PERFORM 1 FROM public.perfiles WHERE id = usuario FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERFIL_NO_AUTORIZADO' USING ERRCODE = '42501'; END IF;
  SELECT * INTO c FROM public.cultivos WHERE id = p_cultivo_id AND agricultor_id = usuario FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CULTIVO_NO_AUTORIZADO' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.mediciones WHERE cultivo_id = c.id) OR EXISTS (SELECT 1 FROM public.alertas WHERE cultivo_id = c.id)
     OR EXISTS (SELECT 1 FROM public.sugerencias_ia WHERE cultivo_id = c.id) THEN
    RAISE EXCEPTION 'CULTIVO_CON_HISTORIAL' USING ERRCODE = '22023';
  END IF;
  UPDATE public.nodos SET cultivo_id = NULL WHERE cultivo_id = c.id;
  GET DIAGNOSTICS liberados = ROW_COUNT;
  PERFORM set_config('agrovigia.borrado_definitivo', 'si', true);
  DELETE FROM public.nodo_asignaciones a WHERE a.cultivo_anterior_id = c.id OR a.cultivo_nuevo_id = c.id
     OR a.zona_anterior_id IN (SELECT z.id FROM public.zonas z WHERE z.cultivo_id = c.id)
     OR a.zona_nueva_id IN (SELECT z.id FROM public.zonas z WHERE z.cultivo_id = c.id);
  PERFORM set_config('agrovigia.borrado_definitivo', '', true);
  DELETE FROM public.alerta_cursores WHERE regla_id IN (SELECT r.id FROM public.reglas_alerta r WHERE r.cultivo_id = c.id);
  DELETE FROM public.reglas_alerta WHERE cultivo_id = c.id;
  DELETE FROM public.solicitudes_ia WHERE cultivo_id = c.id;
  DELETE FROM public.ajustes_simulacion WHERE cultivo_id = c.id;
  DELETE FROM public.clima_cultivo WHERE cultivo_id = c.id;
  DELETE FROM public.cultivo_parametros WHERE cultivo_id = c.id;
  DELETE FROM public.zonas WHERE cultivo_id = c.id;
  DELETE FROM public.cultivos WHERE id = c.id;
  RETURN jsonb_build_object('codigo', 'CULTIVO_ELIMINADO', 'cultivo_id', c.id, 'nodos_liberados', liberados);
END; $$;

-- Alta de cultivo para nodos simulados: crear_cultivo (0004) exigia uno o dos nodos libres, asi que una
-- cuenta sin nodo disponible no podia crear un cultivo y agregarle despues nodos virtuales. Ahora admite
-- de cero a dos nodos (arreglo vacio o NULL). Con nodos, las validaciones son las mismas de antes. Misma
-- firma, mismos permisos y misma idempotencia por p_solicitud_id.
CREATE OR REPLACE FUNCTION public.crear_cultivo(
  p_nombre text,p_tipo text,p_area numeric,p_unidad_area text,p_nodos uuid[],p_solicitud_id uuid
) RETURNS public.cultivos LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE usuario uuid := auth.uid(); resultado public.cultivos; cantidad integer; v_nodos uuid[] := coalesce(p_nodos, '{}'::uuid[]);
BEGIN
  IF usuario IS NULL OR NOT EXISTS (SELECT 1 FROM public.perfiles WHERE id=usuario) THEN
    RAISE EXCEPTION 'PERFIL_NO_AUTORIZADO' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.perfiles WHERE id=usuario FOR UPDATE;
  IF p_solicitud_id IS NULL OR p_nombre IS NULL OR length(btrim(p_nombre)) NOT BETWEEN 1 AND 100
    OR p_tipo IS NULL OR length(btrim(p_tipo)) NOT BETWEEN 1 AND 100
    OR p_area IS NULL OR p_area::text IN ('NaN','Infinity','-Infinity') OR p_area<=0
    OR p_area>99999999.9999 OR p_area<>round(p_area,4)
    OR p_unidad_area IS NULL OR p_unidad_area NOT IN ('ha','m2')
    OR cardinality(v_nodos)>2
    OR (cardinality(v_nodos)>0 AND (array_ndims(v_nodos)<>1 OR array_position(v_nodos,NULL) IS NOT NULL
        OR (SELECT count(DISTINCT x) FROM unnest(v_nodos) x)<>cardinality(v_nodos))) THEN
    RAISE EXCEPTION 'DATOS_CULTIVO_INVALIDOS' USING ERRCODE='22023';
  END IF;
  SELECT * INTO resultado FROM public.cultivos WHERE agricultor_id=usuario AND solicitud_id=p_solicitud_id;
  IF FOUND THEN
    IF resultado.nombre<>btrim(p_nombre) OR resultado.tipo<>btrim(p_tipo)
      OR resultado.area<>p_area OR resultado.unidad_area<>p_unidad_area
      OR resultado.archivado_en IS NOT NULL
      OR ARRAY(SELECT id FROM public.nodos WHERE cultivo_id=resultado.id ORDER BY id)
         <>ARRAY(SELECT x FROM unnest(v_nodos) x ORDER BY x) THEN
      RAISE EXCEPTION 'SOLICITUD_EN_CONFLICTO' USING ERRCODE='22023';
    END IF;
    RETURN resultado;
  END IF;
  PERFORM id FROM public.nodos WHERE id=ANY(v_nodos) ORDER BY id FOR UPDATE;
  SELECT count(*) INTO cantidad FROM public.nodos
    WHERE id=ANY(v_nodos) AND agricultor_id=usuario AND habilitado AND cultivo_id IS NULL;
  IF cantidad<>cardinality(v_nodos) THEN
    RAISE EXCEPTION 'NODOS_NO_DISPONIBLES' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.cultivos (agricultor_id,nombre,tipo,area,unidad_area,solicitud_id)
    VALUES (usuario,btrim(p_nombre),btrim(p_tipo),p_area,p_unidad_area,p_solicitud_id)
    RETURNING * INTO resultado;
  UPDATE public.nodos SET cultivo_id=resultado.id WHERE id=ANY(v_nodos);
  RETURN resultado;
END; $$;

-- 6. Tiempo real: la web puede suscribirse a los ajustes, las solicitudes y las sugerencias.
-- Fuera de Supabase la publicacion no existe y el bloque no hace nada.
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY['ajustes_simulacion','solicitudes_ia','sugerencias_ia'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END LOOP;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.normalizar_ajustes_simulacion(jsonb), public.ajustar_simulacion(uuid,jsonb,boolean),
  public.contexto_sugerencia_ia(uuid,uuid,text,text,timestamptz), public.depurar_solicitudes_ia(timestamptz),
  public.solicitar_sugerencia_ia(uuid,text), public.tomar_solicitudes_ia(integer), public.cerrar_solicitud_ia(uuid,text,text),
  public.preparar_solicitud_ia(uuid), public.completar_solicitud_ia(uuid,jsonb,text,integer,integer,text),
  public.crear_nodo_virtual(uuid,uuid), public.retirar_nodo_virtual(uuid),
  public.asegurar_sectores_cultivo(uuid), public.elegir_sector_nodo(uuid,uuid,uuid), public.posicion_libre_sector(uuid,uuid),
  public.mover_nodo_virtual(uuid,uuid,uuid), public.proteger_asignacion(), public.eliminar_nodo_virtual(uuid), public.eliminar_cultivo(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ajustar_simulacion(uuid,jsonb,boolean), public.solicitar_sugerencia_ia(uuid,text),
  public.crear_nodo_virtual(uuid,uuid), public.retirar_nodo_virtual(uuid),
  public.mover_nodo_virtual(uuid,uuid,uuid), public.eliminar_nodo_virtual(uuid), public.eliminar_cultivo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tomar_solicitudes_ia(integer), public.cerrar_solicitud_ia(uuid,text,text),
  public.preparar_solicitud_ia(uuid), public.completar_solicitud_ia(uuid,jsonb,text,integer,integer,text) TO service_role;
COMMIT;
