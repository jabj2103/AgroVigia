-- 0009: catalogo y parametros de cultivo, clima simulado, dispositivos y preferencias de usuario.
-- Requiere 0001..0008 (0007 zonas y nodos virtuales, 0008 ingesta simulada v3 de Juan).
-- No modifica mediciones, reglas ni vinculos existentes.
BEGIN;

-- 1. Plantillas de cultivo. Rangos ORIENTATIVOS para tropico bajo (Caribe colombiano).
-- Los limites de alerta cubren temperatura y humedad del aire y, para datos simulados v3,
-- humedad volumetrica del suelo a 20 cm. La iluminacion es un indice relativo (no lux) y de
-- noche siempre baja, asi que no genera reglas.
CREATE TABLE public.cultivo_plantillas (
  codigo text PRIMARY KEY CHECK (codigo ~ '^[a-z_]{3,30}$'),
  nombre text NOT NULL CHECK (length(btrim(nombre)) BETWEEN 1 AND 60),
  descripcion text NOT NULL,
  temperatura_min numeric(12,4) NOT NULL,
  temperatura_max numeric(12,4) NOT NULL,
  temperatura_optima_min numeric(12,4) NOT NULL,
  temperatura_optima_max numeric(12,4) NOT NULL,
  humedad_min numeric(12,4) NOT NULL,
  humedad_max numeric(12,4) NOT NULL,
  humedad_optima_min numeric(12,4) NOT NULL,
  humedad_optima_max numeric(12,4) NOT NULL,
  suelo_vwc_min numeric(12,4) NOT NULL,
  suelo_vwc_max numeric(12,4) NOT NULL,
  suelo_vwc_optima_min numeric(12,4) NOT NULL,
  suelo_vwc_optima_max numeric(12,4) NOT NULL,
  luz_requerimiento text NOT NULL CHECK (luz_requerimiento IN ('pleno_sol','sol_parcial')),
  riego_referencia text NOT NULL,
  notas text NOT NULL,
  fuente text NOT NULL,
  CHECK (temperatura_min < temperatura_optima_min AND temperatura_optima_min < temperatura_optima_max
         AND temperatura_optima_max < temperatura_max AND temperatura_min >= -40 AND temperatura_max <= 80),
  CHECK (humedad_min < humedad_optima_min AND humedad_optima_min < humedad_optima_max
         AND humedad_optima_max < humedad_max AND humedad_min >= 0 AND humedad_max <= 100),
  CHECK (suelo_vwc_min < suelo_vwc_optima_min AND suelo_vwc_optima_min < suelo_vwc_optima_max
         AND suelo_vwc_optima_max < suelo_vwc_max AND suelo_vwc_min >= 0 AND suelo_vwc_max <= 80)
);
INSERT INTO public.cultivo_plantillas VALUES
 ('yuca','Yuca','Manihot esculenta. Raíz tolerante a sequía una vez establecida.',
  18,35,25,29, 40,90,60,80, 15,40,20,30,'pleno_sol',
  'Riego crítico en el establecimiento y el engrose de raíces (meses 1 a 5). Tolera déficit después. Evitar encharcamiento: pudre la raíz.',
  'La humedad alta sostenida favorece bacteriosis y superalargamiento.',
  'Rangos orientativos de literatura agronómica general para trópico bajo. No validados en campo por AgroVigía; ajústalos con asistencia técnica local.'),
 ('platano','Plátano','Musa AAB (hartón, dominico). Alta demanda de agua y de humedad ambiental.',
  18,35,26,30, 60,95,75,85, 25,50,30,40,'pleno_sol',
  'Demanda hídrica alta y continua. Sensible tanto al déficit como al encharcamiento; mantener drenaje.',
  'La humedad muy alta con temperatura alta favorece la sigatoka negra.',
  'Rangos orientativos de literatura agronómica general para trópico bajo. No validados en campo por AgroVigía; ajústalos con asistencia técnica local.'),
 ('hortalizas','Hortalizas de clima cálido','Tomate, ají, pepino, berenjena y similares.',
  15,32,20,28, 50,85,60,75, 20,45,25,35,'pleno_sol',
  'Riegos frecuentes y ligeros; muy sensibles al estrés hídrico en floración y cuajado.',
  'Por encima de 32 °C puede caer la flor. La humedad alta favorece hongos foliares.',
  'Rangos orientativos de literatura agronómica general para trópico bajo. No validados en campo por AgroVigía; ajústalos con asistencia técnica local.'),
 ('mango','Mango','Mangifera indica. Prefiere una época seca antes de florecer.',
  15,38,24,30, 40,85,50,70, 12,40,18,28,'pleno_sol',
  'Un periodo seco favorece la floración; regar en el cuajado y llenado de fruto.',
  'La humedad alta en floración favorece la antracnosis.',
  'Rangos orientativos de literatura agronómica general para trópico bajo. No validados en campo por AgroVigía; ajústalos con asistencia técnica local.'),
 ('papaya','Papaya','Carica papaya. Crecimiento rápido, raíz muy sensible al exceso de agua.',
  18,34,22,30, 50,90,60,80, 20,40,25,32,'pleno_sol',
  'Riego frecuente y moderado. El encharcamiento de pocas horas puede causar pudrición de raíz.',
  'El calor extremo provoca caída de flores.',
  'Rangos orientativos de literatura agronómica general para trópico bajo. No validados en campo por AgroVigía; ajústalos con asistencia técnica local.'),
 ('maracuya','Maracuyá','Passiflora edulis f. flavicarpa.',
  18,33,21,30, 50,90,60,80, 20,45,25,35,'pleno_sol',
  'Riego regular en floración y fructificación; el déficit reduce el cuajado.',
  'La humedad alta y la lluvia continua favorecen enfermedades fungosas y bacterianas.',
  'Rangos orientativos de literatura agronómica general para trópico bajo. No validados en campo por AgroVigía; ajústalos con asistencia técnica local.');

ALTER TABLE public.cultivos ADD COLUMN plantilla_codigo text REFERENCES public.cultivo_plantillas(codigo);

ALTER TABLE public.cultivo_plantillas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cultivo_plantillas FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.cultivo_plantillas TO authenticated, service_role;
CREATE POLICY leer_catalogo ON public.cultivo_plantillas FOR SELECT TO authenticated USING (true);

-- Asigna la plantilla y, si se pide, sustituye las reglas de temperatura y humedad.
-- configurar_regla_alerta (0006) solo admite variables del aire; esta funcion interna, sin permiso
-- para la web, aplica la misma sustitucion para humedad_suelo_vwc con origen simulado.
CREATE FUNCTION public.configurar_regla_suelo(p_cultivo_id uuid, p_minimo numeric, p_maximo numeric) RETURNS public.reglas_alerta
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.reglas_alerta;
BEGIN
  SELECT * INTO r FROM public.reglas_alerta WHERE cultivo_id = p_cultivo_id AND variable_codigo = 'humedad_suelo_vwc'
    AND origen = 'simulado' AND habilitada FOR UPDATE;
  IF FOUND AND r.minimo IS NOT DISTINCT FROM p_minimo AND r.maximo IS NOT DISTINCT FROM p_maximo THEN RETURN r; END IF;
  IF r.id IS NOT NULL THEN
    UPDATE public.alertas SET cerrada_en = clock_timestamp(), motivo_cierre = 'regla_desactivada' WHERE regla_id = r.id AND cerrada_en IS NULL;
    UPDATE public.reglas_alerta SET habilitada = false, desactivada_en = clock_timestamp() WHERE id = r.id;
  END IF;
  INSERT INTO public.reglas_alerta (cultivo_id, variable_codigo, minimo, maximo, origen)
  VALUES (p_cultivo_id, 'humedad_suelo_vwc', p_minimo, p_maximo, 'simulado') RETURNING * INTO r;
  RETURN r;
END; $$;

CREATE FUNCTION public.aplicar_plantilla_cultivo(
  p_cultivo_id uuid, p_plantilla text, p_configurar_reglas boolean DEFAULT true, p_origen text DEFAULT 'real'
) RETURNS public.cultivos LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.cultivos; t public.cultivo_plantillas;
BEGIN
  SELECT * INTO c FROM public.cultivos WHERE id = p_cultivo_id AND agricultor_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CULTIVO_NO_AUTORIZADO' USING ERRCODE = '42501'; END IF;
  IF c.archivado_en IS NOT NULL THEN RAISE EXCEPTION 'CULTIVO_ARCHIVADO' USING ERRCODE = '22023'; END IF;
  SELECT * INTO t FROM public.cultivo_plantillas WHERE codigo = p_plantilla;
  IF NOT FOUND OR p_configurar_reglas IS NULL OR p_origen IS NULL OR p_origen NOT IN ('real','simulado') THEN
    RAISE EXCEPTION 'PLANTILLA_INVALIDA' USING ERRCODE = '22023';
  END IF;
  UPDATE public.cultivos SET plantilla_codigo = t.codigo WHERE id = c.id RETURNING * INTO c;
  -- Aplicar una plantilla vuelve a sus rangos: se retira el ajuste propio del cultivo.
  DELETE FROM public.cultivo_parametros WHERE cultivo_id = c.id;
  IF p_configurar_reglas THEN
    PERFORM public.configurar_regla_alerta(c.id, 'temperatura_aire', t.temperatura_min, t.temperatura_max, p_origen);
    PERFORM public.configurar_regla_alerta(c.id, 'humedad_aire', t.humedad_min, t.humedad_max, p_origen);
    -- La humedad del suelo solo existe en datos simulados v3: su regla es siempre de origen simulado.
    IF p_origen = 'simulado' THEN PERFORM public.configurar_regla_suelo(c.id, t.suelo_vwc_min, t.suelo_vwc_max); END IF;
  END IF;
  RETURN c;
END; $$;

-- 2. Parametros propios por cultivo. El agricultor ajusta los rangos de SU cultivo sin cambiar el catalogo.
-- Si existen, sustituyen a los de la plantilla en reglas, sugerencias IA, historial y simulacion.
CREATE TABLE public.cultivo_parametros (
  cultivo_id uuid PRIMARY KEY REFERENCES public.cultivos(id) ON DELETE RESTRICT,
  temperatura_min numeric(12,4) NOT NULL, temperatura_optima_min numeric(12,4) NOT NULL,
  temperatura_optima_max numeric(12,4) NOT NULL, temperatura_max numeric(12,4) NOT NULL,
  humedad_min numeric(12,4) NOT NULL, humedad_optima_min numeric(12,4) NOT NULL,
  humedad_optima_max numeric(12,4) NOT NULL, humedad_max numeric(12,4) NOT NULL,
  suelo_vwc_min numeric(12,4) NOT NULL, suelo_vwc_optima_min numeric(12,4) NOT NULL,
  suelo_vwc_optima_max numeric(12,4) NOT NULL, suelo_vwc_max numeric(12,4) NOT NULL,
  actualizado_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  actualizado_por uuid NOT NULL,
  CHECK (temperatura_min <= temperatura_optima_min AND temperatura_optima_min < temperatura_optima_max
         AND temperatura_optima_max <= temperatura_max AND temperatura_min >= -40 AND temperatura_max <= 80),
  CHECK (humedad_min <= humedad_optima_min AND humedad_optima_min < humedad_optima_max
         AND humedad_optima_max <= humedad_max AND humedad_min >= 0 AND humedad_max <= 100),
  CHECK (suelo_vwc_min <= suelo_vwc_optima_min AND suelo_vwc_optima_min < suelo_vwc_optima_max
         AND suelo_vwc_optima_max <= suelo_vwc_max AND suelo_vwc_min >= 0 AND suelo_vwc_max <= 80)
);
ALTER TABLE public.cultivo_parametros ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cultivo_parametros FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.cultivo_parametros TO authenticated, service_role;
CREATE POLICY leer_propios ON public.cultivo_parametros FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cultivos c WHERE c.id = cultivo_id AND c.agricultor_id = (SELECT auth.uid())));

-- Parametros vigentes de un cultivo: su ajuste propio o, si no tiene, la plantilla. NULL sin ninguno.
CREATE FUNCTION public.parametros_efectivos(p_cultivo_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN a.cultivo_id IS NOT NULL THEN jsonb_build_object(
      'codigo', c.plantilla_codigo, 'nombre', coalesce(t.nombre, c.tipo), 'ajustada', true,
      'temperatura_min', a.temperatura_min, 'temperatura_optima_min', a.temperatura_optima_min,
      'temperatura_optima_max', a.temperatura_optima_max, 'temperatura_max', a.temperatura_max,
      'humedad_min', a.humedad_min, 'humedad_optima_min', a.humedad_optima_min,
      'humedad_optima_max', a.humedad_optima_max, 'humedad_max', a.humedad_max,
      'suelo_vwc_min', a.suelo_vwc_min, 'suelo_vwc_optima_min', a.suelo_vwc_optima_min,
      'suelo_vwc_optima_max', a.suelo_vwc_optima_max, 'suelo_vwc_max', a.suelo_vwc_max,
      'luz_requerimiento', t.luz_requerimiento, 'riego_referencia', t.riego_referencia, 'notas', t.notas)
    WHEN t.codigo IS NOT NULL THEN (to_jsonb(t) - 'fuente') || jsonb_build_object('ajustada', false)
  END
  FROM public.cultivos c
  LEFT JOIN public.cultivo_parametros a ON a.cultivo_id = c.id
  LEFT JOIN public.cultivo_plantillas t ON t.codigo = c.plantilla_codigo
  WHERE c.id = p_cultivo_id;
$$;

-- Guarda los doce rangos del cultivo (un decimal) y, si se pide, sustituye sus reglas de alerta.
CREATE FUNCTION public.ajustar_parametros_cultivo(
  p_cultivo_id uuid, p_parametros jsonb, p_configurar_reglas boolean DEFAULT true, p_origen text DEFAULT 'real'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c public.cultivos; v numeric[] := array_fill(NULL::numeric, ARRAY[12]);
  claves CONSTANT text[] := ARRAY['temperatura_min','temperatura_optima_min','temperatura_optima_max','temperatura_max',
    'humedad_min','humedad_optima_min','humedad_optima_max','humedad_max',
    'suelo_vwc_min','suelo_vwc_optima_min','suelo_vwc_optima_max','suelo_vwc_max'];
BEGIN
  SELECT * INTO c FROM public.cultivos WHERE id = p_cultivo_id AND agricultor_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CULTIVO_NO_AUTORIZADO' USING ERRCODE = '42501'; END IF;
  IF c.archivado_en IS NOT NULL THEN RAISE EXCEPTION 'CULTIVO_ARCHIVADO' USING ERRCODE = '22023'; END IF;
  IF p_parametros IS NULL OR jsonb_typeof(p_parametros) IS DISTINCT FROM 'object' OR p_configurar_reglas IS NULL
     OR p_origen IS NULL OR p_origen NOT IN ('real','simulado')
     OR (SELECT count(*) FROM jsonb_object_keys(p_parametros)) <> 12 THEN
    RAISE EXCEPTION 'PARAMETROS_INVALIDOS' USING ERRCODE = '22023';
  END IF;
  FOR i IN 1..12 LOOP
    IF jsonb_typeof(p_parametros -> claves[i]) IS DISTINCT FROM 'number' OR length(p_parametros ->> claves[i]) > 12 THEN
      RAISE EXCEPTION 'PARAMETROS_INVALIDOS' USING ERRCODE = '22023';
    END IF;
    v[i] := (p_parametros ->> claves[i])::numeric;
    IF v[i] <> round(v[i], 1) THEN RAISE EXCEPTION 'PARAMETROS_INVALIDOS' USING ERRCODE = '22023'; END IF;
  END LOOP;
  IF NOT (v[1] <= v[2] AND v[2] < v[3] AND v[3] <= v[4] AND v[1] >= -40 AND v[4] <= 80
      AND v[5] <= v[6] AND v[6] < v[7] AND v[7] <= v[8] AND v[5] >= 0 AND v[8] <= 100
      AND v[9] <= v[10] AND v[10] < v[11] AND v[11] <= v[12] AND v[9] >= 0 AND v[12] <= 80) THEN
    RAISE EXCEPTION 'PARAMETROS_INVALIDOS' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.cultivo_parametros AS p (cultivo_id, temperatura_min, temperatura_optima_min, temperatura_optima_max, temperatura_max,
    humedad_min, humedad_optima_min, humedad_optima_max, humedad_max,
    suelo_vwc_min, suelo_vwc_optima_min, suelo_vwc_optima_max, suelo_vwc_max, actualizado_por)
  VALUES (c.id, v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8], v[9], v[10], v[11], v[12], auth.uid())
  ON CONFLICT (cultivo_id) DO UPDATE SET
    temperatura_min = EXCLUDED.temperatura_min, temperatura_optima_min = EXCLUDED.temperatura_optima_min,
    temperatura_optima_max = EXCLUDED.temperatura_optima_max, temperatura_max = EXCLUDED.temperatura_max,
    humedad_min = EXCLUDED.humedad_min, humedad_optima_min = EXCLUDED.humedad_optima_min,
    humedad_optima_max = EXCLUDED.humedad_optima_max, humedad_max = EXCLUDED.humedad_max,
    suelo_vwc_min = EXCLUDED.suelo_vwc_min, suelo_vwc_optima_min = EXCLUDED.suelo_vwc_optima_min,
    suelo_vwc_optima_max = EXCLUDED.suelo_vwc_optima_max, suelo_vwc_max = EXCLUDED.suelo_vwc_max,
    actualizado_en = clock_timestamp(), actualizado_por = EXCLUDED.actualizado_por;
  IF p_configurar_reglas THEN
    PERFORM public.configurar_regla_alerta(c.id, 'temperatura_aire', v[1], v[4], p_origen);
    PERFORM public.configurar_regla_alerta(c.id, 'humedad_aire', v[5], v[8], p_origen);
    IF p_origen = 'simulado' THEN PERFORM public.configurar_regla_suelo(c.id, v[9], v[12]); END IF;
  END IF;
  RETURN public.parametros_efectivos(c.id);
END; $$;

-- Quita el ajuste propio: el cultivo vuelve a los rangos de su plantilla. No cambia las reglas vigentes.
CREATE FUNCTION public.restablecer_parametros_cultivo(p_cultivo_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public.cultivos WHERE id = p_cultivo_id AND agricultor_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CULTIVO_NO_AUTORIZADO' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.cultivo_parametros WHERE cultivo_id = p_cultivo_id;
  RETURN public.parametros_efectivos(p_cultivo_id);
END; $$;

-- 3. Clima simulado por cultivo. Evento de PRUEBA que activa el agricultor: el servicio de simulacion
-- lo aplica a los nodos virtuales y proyecta su efecto sobre la lectura real de los fisicos (como dato
-- simulado, nunca sobre el dato real). Sin fila activa el clima es normal.
CREATE TABLE public.clima_cultivo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cultivo_id uuid NOT NULL REFERENCES public.cultivos(id) ON DELETE RESTRICT,
  evento text NOT NULL CHECK (evento IN ('lluvia','sol_fuerte','tierra_seca','viento')),
  intensidad smallint NOT NULL CHECK (intensidad BETWEEN 1 AND 3),
  iniciado_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  finalizado_en timestamptz,
  actor_id uuid NOT NULL,
  CHECK (finalizado_en IS NULL OR finalizado_en >= iniciado_en)
);
CREATE UNIQUE INDEX clima_activo ON public.clima_cultivo (cultivo_id) WHERE finalizado_en IS NULL;
CREATE INDEX clima_cultivo_fecha ON public.clima_cultivo (cultivo_id, iniciado_en DESC);
ALTER TABLE public.clima_cultivo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clima_cultivo FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.clima_cultivo TO authenticated, service_role;
CREATE POLICY leer_propios ON public.clima_cultivo FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cultivos c WHERE c.id = cultivo_id AND c.agricultor_id = (SELECT auth.uid())));

-- Activa un evento (o vuelve a 'normal') en un cultivo o en todos los cultivos activos de la cuenta.
CREATE FUNCTION public.establecer_clima(
  p_cultivo_id uuid, p_evento text, p_intensidad integer DEFAULT 2, p_todos boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  usuario uuid := auth.uid(); c public.cultivos; actual public.clima_cultivo;
  ahora timestamptz := clock_timestamp(); cambiados integer := 0;
BEGIN
  SELECT * INTO c FROM public.cultivos WHERE id = p_cultivo_id AND agricultor_id = usuario;
  IF NOT FOUND THEN RAISE EXCEPTION 'CULTIVO_NO_AUTORIZADO' USING ERRCODE = '42501'; END IF;
  IF p_evento IS NULL OR p_evento NOT IN ('normal','lluvia','sol_fuerte','tierra_seca','viento') OR p_todos IS NULL
     OR (p_evento <> 'normal' AND (p_intensidad IS NULL OR p_intensidad NOT BETWEEN 1 AND 3)) THEN
    RAISE EXCEPTION 'CLIMA_INVALIDO' USING ERRCODE = '22023';
  END IF;
  IF NOT p_todos AND c.archivado_en IS NOT NULL THEN RAISE EXCEPTION 'CULTIVO_ARCHIVADO' USING ERRCODE = '22023'; END IF;
  FOR c IN SELECT * FROM public.cultivos WHERE agricultor_id = usuario AND archivado_en IS NULL
            AND (p_todos OR id = p_cultivo_id) ORDER BY id FOR UPDATE LOOP
    SELECT * INTO actual FROM public.clima_cultivo WHERE cultivo_id = c.id AND finalizado_en IS NULL;
    IF actual.id IS NOT NULL AND actual.evento = p_evento AND actual.intensidad = p_intensidad THEN CONTINUE; END IF;
    IF actual.id IS NULL AND p_evento = 'normal' THEN CONTINUE; END IF;
    IF actual.id IS NOT NULL THEN UPDATE public.clima_cultivo SET finalizado_en = ahora WHERE id = actual.id; END IF;
    IF p_evento <> 'normal' THEN
      INSERT INTO public.clima_cultivo (cultivo_id, evento, intensidad, iniciado_en, actor_id)
      VALUES (c.id, p_evento, p_intensidad, ahora, usuario);
    END IF;
    cambiados := cambiados + 1;
  END LOOP;
  RETURN jsonb_build_object('codigo', 'CLIMA_ESTABLECIDO', 'evento', p_evento,
    'intensidad', CASE WHEN p_evento = 'normal' THEN NULL ELSE p_intensidad END, 'cultivos_cambiados', cambiados);
END; $$;

-- 4. Dispositivos: tipo de equipo, protocolo e intervalo esperado por nodo; pausa de recepcion.
-- Solo el firmware ESP32 del repositorio esta probado. Arduino Uno y Raspberry Pi son perfiles de
-- configuracion: describen como llegaria ese equipo al broker, no acreditan hardware probado.
CREATE TABLE public.tipos_dispositivo (
  codigo text PRIMARY KEY CHECK (codigo ~ '^[a-z0-9_]{3,30}$'),
  nombre text NOT NULL, descripcion text NOT NULL,
  protocolos text[] NOT NULL CHECK (cardinality(protocolos) >= 1),
  protocolo_defecto text NOT NULL,
  intervalo_defecto integer NOT NULL CHECK (intervalo_defecto BETWEEN 10 AND 3600),
  adc_bits smallint CHECK (adc_bits BETWEEN 8 AND 16),
  conexion text NOT NULL,
  probado boolean NOT NULL DEFAULT false,
  CHECK (protocolo_defecto = ANY (protocolos))
);
INSERT INTO public.tipos_dispositivo VALUES
 ('esp32', 'ESP32', 'Microcontrolador con Wi-Fi integrado y ADC de 12 bits.',
  ARRAY['mqtt_wifi'], 'mqtt_wifi', 60, 12,
  'Publica directo en el broker MQTT por Wi-Fi con el firmware del repositorio (contrato v2, QoS 1).', true),
 ('arduino_uno', 'Arduino Uno', 'Microcontrolador sin red propia y ADC de 10 bits.',
  ARRAY['serie_puente_mqtt','mqtt_ethernet'], 'serie_puente_mqtt', 60, 10,
  'Envía sus lecturas por USB serie a un equipo puente (computador o Raspberry Pi) que las publica en MQTT; o usa un shield Ethernet. Requiere adaptar la escala del LDR de 10 a 12 bits.', false),
 ('raspberry_pi', 'Raspberry Pi', 'Computador Linux de placa única, sin ADC propio.',
  ARRAY['mqtt_wifi','mqtt_ethernet'], 'mqtt_wifi', 60, NULL,
  'Publica en MQTT desde un programa propio por Wi-Fi o Ethernet. Usa sensores digitales o un ADC externo para el LDR.', false),
 ('virtual', 'Nodo virtual', 'Punto simulado de diez variables.',
  ARRAY['mqtt_simulado'], 'mqtt_simulado', 30, NULL,
  'Lo publica el servicio de simulación por MQTT (contrato v3). No es un equipo físico.', true);
ALTER TABLE public.tipos_dispositivo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tipos_dispositivo FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.tipos_dispositivo TO authenticated, service_role;
CREATE POLICY leer_catalogo ON public.tipos_dispositivo FOR SELECT TO authenticated USING (true);

ALTER TABLE public.nodos
  ADD COLUMN tipo_dispositivo text NOT NULL DEFAULT 'esp32' REFERENCES public.tipos_dispositivo(codigo),
  ADD COLUMN protocolo text NOT NULL DEFAULT 'mqtt_wifi',
  ADD COLUMN intervalo_segundos integer NOT NULL DEFAULT 60 CHECK (intervalo_segundos BETWEEN 10 AND 3600),
  ADD COLUMN configuracion_manual boolean NOT NULL DEFAULT false,
  ADD COLUMN recepcion_pausada boolean NOT NULL DEFAULT false,
  ADD COLUMN pausada_en timestamptz;
UPDATE public.nodos SET tipo_dispositivo = 'virtual', protocolo = 'mqtt_simulado', intervalo_segundos = 30 WHERE tipo_nodo = 'virtual';
ALTER TABLE public.nodos ADD CONSTRAINT nodo_dispositivo_coherente CHECK ((tipo_nodo = 'virtual') = (tipo_dispositivo = 'virtual'));

-- Un nodo virtual nuevo nace con el perfil virtual, lo cree quien lo cree.
CREATE FUNCTION public.dispositivo_por_tipo_nodo() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.tipo_nodo = 'virtual' AND NEW.tipo_dispositivo <> 'virtual' THEN
    NEW.tipo_dispositivo := 'virtual'; NEW.protocolo := 'mqtt_simulado'; NEW.intervalo_segundos := 30;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER b_dispositivo_por_tipo_nodo BEFORE INSERT ON public.nodos
FOR EACH ROW EXECUTE FUNCTION public.dispositivo_por_tipo_nodo();

-- Automatico (sin protocolo ni intervalo): toma los valores del tipo. Manual: valida los indicados.
-- En un nodo virtual el intervalo es la cadencia con que lo publica el servicio de simulacion.
CREATE FUNCTION public.configurar_dispositivo(
  p_nodo_id uuid, p_tipo text, p_protocolo text DEFAULT NULL, p_intervalo integer DEFAULT NULL
) RETURNS public.nodos LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n public.nodos; t public.tipos_dispositivo; manual boolean := p_protocolo IS NOT NULL OR p_intervalo IS NOT NULL;
BEGIN
  SELECT * INTO n FROM public.nodos WHERE id = p_nodo_id AND agricultor_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NODO_NO_AUTORIZADO' USING ERRCODE = '42501'; END IF;
  SELECT * INTO t FROM public.tipos_dispositivo WHERE codigo = p_tipo;
  IF NOT FOUND OR (n.tipo_nodo = 'virtual') <> (t.codigo = 'virtual')
     OR coalesce(p_protocolo, t.protocolo_defecto) <> ALL (t.protocolos)
     OR coalesce(p_intervalo, t.intervalo_defecto) NOT BETWEEN 10 AND 3600 THEN
    RAISE EXCEPTION 'DISPOSITIVO_INVALIDO' USING ERRCODE = '22023';
  END IF;
  UPDATE public.nodos SET tipo_dispositivo = t.codigo, protocolo = coalesce(p_protocolo, t.protocolo_defecto),
    intervalo_segundos = coalesce(p_intervalo, t.intervalo_defecto), configuracion_manual = manual
  WHERE id = n.id RETURNING * INTO n;
  RETURN n;
END; $$;

-- Pausa de recepcion: el agricultor desconecta un nodo del servicio sin desvincularlo del cultivo.
-- Mientras esta pausado, las RPC de ingesta rechazan sus lotes con NODO_PAUSADO y no guardan nada.
CREATE FUNCTION public.pausar_nodo(p_nodo_id uuid, p_pausar boolean) RETURNS public.nodos
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n public.nodos;
BEGIN
  SELECT * INTO n FROM public.nodos WHERE id = p_nodo_id AND agricultor_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NODO_NO_AUTORIZADO' USING ERRCODE = '42501'; END IF;
  IF p_pausar IS NULL THEN RAISE EXCEPTION 'PAUSA_INVALIDA' USING ERRCODE = '22023'; END IF;
  IF n.recepcion_pausada = p_pausar THEN RETURN n; END IF;
  UPDATE public.nodos SET recepcion_pausada = p_pausar, pausada_en = CASE WHEN p_pausar THEN clock_timestamp() END
  WHERE id = n.id RETURNING * INTO n;
  RETURN n;
END; $$;
-- 22023 es el codigo que las tres RPC de ingesta convierten en {estado: rechazado, codigo: NODO_PAUSADO}.
CREATE FUNCTION public.rechazar_nodo_pausado() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (SELECT recepcion_pausada FROM public.nodos WHERE id = NEW.nodo_id) THEN
    RAISE EXCEPTION 'NODO_PAUSADO' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER a_recepcion_pausada BEFORE INSERT ON public.mediciones
FOR EACH ROW EXECUTE FUNCTION public.rechazar_nodo_pausado();

-- 5. Preferencias por usuario de la plataforma web.
CREATE TABLE public.preferencias_usuario (
  agricultor_id uuid PRIMARY KEY REFERENCES public.perfiles(id) ON DELETE RESTRICT,
  tiempo_real boolean NOT NULL DEFAULT true,
  refresco_segundos smallint NOT NULL DEFAULT 10 CHECK (refresco_segundos IN (5, 10, 30)),
  clima_alcance text NOT NULL DEFAULT 'cultivo' CHECK (clima_alcance IN ('cultivo','todos')),
  actualizado_en timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.preferencias_usuario ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.preferencias_usuario FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.preferencias_usuario TO authenticated;
CREATE POLICY leer_propias ON public.preferencias_usuario FOR SELECT TO authenticated
  USING (agricultor_id = (SELECT auth.uid()));
CREATE FUNCTION public.guardar_preferencias(p_tiempo_real boolean, p_refresco_segundos integer, p_clima_alcance text)
RETURNS public.preferencias_usuario LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.preferencias_usuario;
BEGIN
  PERFORM 1 FROM public.perfiles WHERE id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'PERFIL_NO_AUTORIZADO' USING ERRCODE = '42501'; END IF;
  IF p_tiempo_real IS NULL OR p_refresco_segundos IS NULL OR p_refresco_segundos NOT IN (5, 10, 30)
     OR p_clima_alcance IS NULL OR p_clima_alcance NOT IN ('cultivo','todos') THEN
    RAISE EXCEPTION 'PREFERENCIAS_INVALIDAS' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.preferencias_usuario (agricultor_id, tiempo_real, refresco_segundos, clima_alcance)
  VALUES (auth.uid(), p_tiempo_real, p_refresco_segundos, p_clima_alcance)
  ON CONFLICT (agricultor_id) DO UPDATE SET tiempo_real = EXCLUDED.tiempo_real,
    refresco_segundos = EXCLUDED.refresco_segundos, clima_alcance = EXCLUDED.clima_alcance, actualizado_en = clock_timestamp()
  RETURNING * INTO r;
  RETURN r;
END; $$;

REVOKE ALL ON FUNCTION public.configurar_regla_suelo(uuid,numeric,numeric), public.parametros_efectivos(uuid),
  public.aplicar_plantilla_cultivo(uuid,text,boolean,text), public.ajustar_parametros_cultivo(uuid,jsonb,boolean,text),
  public.restablecer_parametros_cultivo(uuid), public.establecer_clima(uuid,text,integer,boolean),
  public.dispositivo_por_tipo_nodo(), public.configurar_dispositivo(uuid,text,text,integer),
  public.pausar_nodo(uuid,boolean), public.rechazar_nodo_pausado(), public.guardar_preferencias(boolean,integer,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aplicar_plantilla_cultivo(uuid,text,boolean,text), public.ajustar_parametros_cultivo(uuid,jsonb,boolean,text),
  public.restablecer_parametros_cultivo(uuid), public.establecer_clima(uuid,text,integer,boolean),
  public.configurar_dispositivo(uuid,text,text,integer), public.pausar_nodo(uuid,boolean),
  public.guardar_preferencias(boolean,integer,text) TO authenticated;
COMMIT;
