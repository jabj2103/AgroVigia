-- AgroVigia 0003. Ejecutar completo UNA vez con rol postgres en SQL Editor.
-- Ambiental v2: DHT22 + indice relativo ADC LDR. No calibra lux ni registra sensores automaticamente.
BEGIN;
DO $$ BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Ejecutar con el rol postgres del SQL Editor.';
  END IF;
END; $$;

-- Aditivo: las filas DHT22 anteriores conservan metadatos {}.
ALTER TABLE public.mediciones ADD COLUMN metadatos jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(metadatos) = 'object');

CREATE FUNCTION public.registrar_lote_ambiental(
  p_topico text,
  p_mensaje text,
  p_recibida_en timestamptz,
  p_acl_verificada boolean DEFAULT false,
  p_retenido boolean DEFAULT NULL,
  p_retencion_broker_desactivada boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET timezone = 'UTC'
AS $$
DECLARE
  p json; m json; claves text[]; codigos_variables text[];
  v_codigo text; mensaje text; origen_lote text; fecha_texto text;
  tomada timestamptz; valor_m numeric; temperatura numeric; humedad numeric; iluminacion numeric; adc numeric; trazabilidad jsonb;
  nodo public.nodos%ROWTYPE; catalogo public.variables%ROWTYPE;
  previo public.mediciones%ROWTYPE;
  cantidad integer; lotes_cultivo integer; fechas_captura integer;
  fechas_recepcion integer; origenes integer;
  contenido jsonb; contenido_previo jsonb; ids jsonb;
  avisos jsonb := '[]'::jsonb;
BEGIN
  -- Contexto del servidor confiable, nunca del dispositivo.
  -- La DB no observa la ACL ni la metadata del paquete del broker.
  IF p_acl_verificada IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ORIGEN_NO_VERIFICADO' USING ERRCODE = '22023';
  END IF;
  IF p_retenido IS TRUE THEN
    RAISE EXCEPTION 'RETAIN_NO_ADMITIDO' USING ERRCODE = '22023';
  END IF;
  IF p_retenido IS NULL AND p_retencion_broker_desactivada IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'RETAIN_NO_VERIFICADO' USING ERRCODE = '22023';
  END IF;
  IF p_recibida_en IS NULL OR NOT isfinite(p_recibida_en) THEN
    RAISE EXCEPTION 'FECHA_RECEPCION' USING ERRCODE = '22023';
  END IF;
  IF p_mensaje IS NULL OR octet_length(convert_to(p_mensaje, 'UTF8')) > 2048
     OR left(p_mensaje, 1) = chr(65279) THEN
    RAISE EXCEPTION 'CODIFICACION_O_TAMANO' USING ERRCODE = '22023';
  END IF;
  BEGIN
    p := p_mensaje::json;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'JSON_INVALIDO' USING ERRCODE = '22023';
  END;
  IF json_typeof(p) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'CAMPOS_PAYLOAD' USING ERRCODE = '22023';
  END IF;
  -- json conserva claves duplicadas, jsonb las eliminaria antes del control.
  SELECT array_agg(j.key ORDER BY j.key) INTO claves FROM json_each(p) j;
  IF claves IS DISTINCT FROM ARRAY[
    'ldr','mediciones','mensaje_id','nodo_codigo','origen','tomada_en','version'
  ]::text[] THEN
    RAISE EXCEPTION 'CAMPOS_PAYLOAD_O_CLAVE_REPETIDA' USING ERRCODE = '22023';
  END IF;
  IF json_typeof(p->'version') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'VERSION' USING ERRCODE = '22023';
  END IF;
  BEGIN
    IF (p->>'version')::numeric <> 2 THEN
      RAISE EXCEPTION 'VERSION' USING ERRCODE = '22023';
    END IF;
  EXCEPTION WHEN numeric_value_out_of_range THEN
    RAISE EXCEPTION 'VERSION' USING ERRCODE = '22023';
  END;
  IF json_typeof(p->'nodo_codigo') IS DISTINCT FROM 'string'
     OR json_typeof(p->'mensaje_id') IS DISTINCT FROM 'string'
     OR json_typeof(p->'origen') IS DISTINCT FROM 'string'
     OR json_typeof(p->'tomada_en') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'TIPOS_PAYLOAD' USING ERRCODE = '22023';
  END IF;
  v_codigo := p->>'nodo_codigo'; mensaje := p->>'mensaje_id';
  origen_lote := p->>'origen'; fecha_texto := p->>'tomada_en';
  IF v_codigo !~ '^agv-[a-z0-9]+-[0-9]{2}$' OR v_codigo ~ E'[\r\n]' THEN
    RAISE EXCEPTION 'NODO_CODIGO' USING ERRCODE = '22023';
  END IF;
  IF length(mensaje) <> 36 OR mensaje !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'MENSAJE_ID' USING ERRCODE = '22023';
  END IF;
  IF origen_lote NOT IN ('real','simulado') THEN
    RAISE EXCEPTION 'ORIGEN' USING ERRCODE = '22023';
  END IF;
  IF p_topico IS DISTINCT FROM ('agrovigia/v2/' || origen_lote || '/nodos/' || v_codigo || '/telemetria') THEN
    RAISE EXCEPTION 'TOPICO_NO_COINCIDE' USING ERRCODE = '22023';
  END IF;
  IF length(fecha_texto) <> 20 OR fecha_texto !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' THEN
    RAISE EXCEPTION 'FECHA_CAPTURA' USING ERRCODE = '22023';
  END IF;
  BEGIN
    tomada := fecha_texto::timestamptz;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'FECHA_CAPTURA' USING ERRCODE = '22023';
  END;
  IF to_char(tomada AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') <> fecha_texto THEN
    RAISE EXCEPTION 'FECHA_CAPTURA' USING ERRCODE = '22023';
  END IF;
  IF json_typeof(p->'ldr') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'METODO_O_ADC_LDR' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(j.key ORDER BY j.key) INTO claves FROM json_each(p->'ldr') j;
  IF claves IS DISTINCT FROM ARRAY['adc_promedio','metodo']::text[]
     OR json_typeof(p->'ldr'->'metodo') IS DISTINCT FROM 'string'
     OR p->'ldr'->>'metodo' IS DISTINCT FROM 'adc12_10k_11db_v1'
     OR json_typeof(p->'ldr'->'adc_promedio') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'METODO_O_ADC_LDR' USING ERRCODE = '22023';
  END IF;
  BEGIN
    adc := (p->'ldr'->>'adc_promedio')::numeric;
  EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation THEN
    RAISE EXCEPTION 'METODO_O_ADC_LDR' USING ERRCODE = '22023';
  END;
  IF adc <> trunc(adc) OR adc < 0 OR adc > 4095 THEN
    RAISE EXCEPTION 'METODO_O_ADC_LDR' USING ERRCODE = '22023';
  END IF;
  trazabilidad := jsonb_build_object('version_payload',2,'ldr',
    jsonb_build_object('metodo','adc12_10k_11db_v1','adc_promedio',adc));
  avisos := avisos || '["INDICE_ADC_NO_CALIBRADO_EN_LUX"]'::jsonb;
  IF adc IN (0,4095) THEN
    avisos := avisos || '["LDR_EN_EXTREMO_ADC"]'::jsonb;
  END IF;
  IF json_typeof(p->'mediciones') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'CANTIDAD_VARIABLES' USING ERRCODE = '22023';
  END IF;
  IF json_array_length(p->'mediciones') <> 3 THEN
    RAISE EXCEPTION 'LOTE_AMBIENTAL_INCOMPLETO' USING ERRCODE = '22023';
  END IF;
  FOR m IN SELECT value FROM json_array_elements(p->'mediciones') LOOP
    IF json_typeof(m) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'CAMPOS_MEDICION' USING ERRCODE = '22023';
    END IF;
    SELECT array_agg(j.key ORDER BY j.key) INTO claves FROM json_each(m) j;
    IF claves IS DISTINCT FROM ARRAY['unidad','valor','variable_codigo']::text[] THEN
      RAISE EXCEPTION 'CAMPOS_MEDICION_O_CLAVE_REPETIDA' USING ERRCODE = '22023';
    END IF;
    IF json_typeof(m->'variable_codigo') IS DISTINCT FROM 'string'
       OR json_typeof(m->'unidad') IS DISTINCT FROM 'string'
       OR json_typeof(m->'valor') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'TIPOS_MEDICION' USING ERRCODE = '22023';
    END IF;
    IF m->>'variable_codigo' NOT IN ('temperatura_aire','humedad_aire','iluminacion_relativa') THEN
      RAISE EXCEPTION 'PERFIL_NO_ADMITIDO_EN_ESTA_RPC' USING ERRCODE = '22023';
    END IF;
    BEGIN
      valor_m := (m->>'valor')::numeric;
    EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation THEN
      RAISE EXCEPTION 'VALOR' USING ERRCODE = '22023';
    END;
    IF valor_m <> trunc(valor_m, 4) THEN
      RAISE EXCEPTION 'PRECISION_NUMERICA' USING ERRCODE = '22023';
    END IF;
    SELECT v.* INTO STRICT catalogo FROM public.variables v
    WHERE v.codigo = m->>'variable_codigo' FOR SHARE;
    IF (catalogo.codigo = 'temperatura_aire' AND
        (catalogo.unidad IS DISTINCT FROM (chr(176) || 'C')
         OR catalogo.valor_min IS DISTINCT FROM -40::numeric
         OR catalogo.valor_max IS DISTINCT FROM 80::numeric))
       OR (catalogo.codigo = 'humedad_aire' AND
        (catalogo.unidad IS DISTINCT FROM '% HR'
         OR catalogo.valor_min IS DISTINCT FROM 0::numeric
         OR catalogo.valor_max IS DISTINCT FROM 100::numeric))
       OR (catalogo.codigo = 'iluminacion_relativa' AND
        (catalogo.unidad IS DISTINCT FROM '% relativo'
         OR catalogo.valor_min IS DISTINCT FROM 0::numeric
         OR catalogo.valor_max IS DISTINCT FROM 100::numeric)) THEN
      RAISE EXCEPTION 'CATALOGO_NO_COINCIDE' USING ERRCODE = '22023';
    END IF;
    IF m->>'unidad' IS DISTINCT FROM catalogo.unidad THEN
      RAISE EXCEPTION 'UNIDAD' USING ERRCODE = '22023';
    END IF;
    IF valor_m < catalogo.valor_min OR valor_m > catalogo.valor_max THEN
      RAISE EXCEPTION 'VALOR' USING ERRCODE = '22023';
    END IF;
    IF catalogo.codigo = 'temperatura_aire' THEN temperatura := valor_m;
    ELSIF catalogo.codigo = 'humedad_aire' THEN humedad := valor_m;
    ELSE iluminacion := valor_m; END IF;
  END LOOP;
  SELECT array_agg(e.value->>'variable_codigo' ORDER BY e.value->>'variable_codigo'),
         jsonb_agg(jsonb_build_object('variable_codigo', e.value->>'variable_codigo',
                    'valor', (e.value->>'valor')::numeric) ORDER BY e.value->>'variable_codigo')
  INTO codigos_variables, contenido FROM json_array_elements(p->'mediciones') e;
  IF codigos_variables IS DISTINCT FROM ARRAY['humedad_aire','iluminacion_relativa','temperatura_aire']::text[] THEN
    RAISE EXCEPTION 'VARIABLE_REPETIDA_O_LOTE_INCOMPLETO' USING ERRCODE = '22023';
  END IF;
  IF iluminacion IS DISTINCT FROM round(adc * 100 / 4095, 1) THEN
    RAISE EXCEPTION 'CONVERSION_LDR_NO_COINCIDE' USING ERRCODE = '22023';
  END IF;
  IF temperatura = 0 AND humedad = 0 THEN
    avisos := avisos || '["PAR_CERO_REQUIERE_REVISION"]'::jsonb;
  END IF;
  IF p_retenido IS NULL THEN
    avisos := avisos || '["RETAIN_CONTROLADO_POR_POLITICA_BROKER"]'::jsonb;
  END IF;
  -- Serializa ingestas del nodo y coordina con UPDATE de su vinculo.
  -- Mantener v1: pausar y drenar mensajes antes de cambiar cultivo.
  SELECT n.* INTO nodo FROM public.nodos n WHERE n.codigo = v_codigo FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NODO_DESCONOCIDO' USING ERRCODE = '22023';
  END IF;
  IF NOT nodo.habilitado THEN
    RAISE EXCEPTION 'NODO_DESHABILITADO' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.nodo_variables nv WHERE nv.nodo_id = nodo.id) <> 3
     OR (SELECT count(*) FROM public.nodo_variables nv WHERE nv.nodo_id = nodo.id
         AND nv.variable_codigo IN ('temperatura_aire','humedad_aire')
         AND nv.sensor_modelo = 'DHT22') <> 2
     OR (SELECT count(*) FROM public.nodo_variables nv WHERE nv.nodo_id = nodo.id
         AND nv.variable_codigo = 'iluminacion_relativa' AND nv.sensor_modelo = 'LDR') <> 1 THEN
    RAISE EXCEPTION 'CAPACIDAD_NODO' USING ERRCODE = '22023';
  END IF;
  SELECT count(*),
         jsonb_agg(jsonb_build_object('variable_codigo', h.variable_codigo, 'valor', h.valor)
                   ORDER BY h.variable_codigo),
         jsonb_agg(h.id ORDER BY h.variable_codigo),
         count(DISTINCT h.cultivo_id), count(DISTINCT h.tomada_en),
         count(DISTINCT h.recibida_en), count(DISTINCT h.origen)
  INTO cantidad, contenido_previo, ids, lotes_cultivo, fechas_captura, fechas_recepcion, origenes
  FROM public.mediciones h WHERE h.nodo_id = nodo.id AND h.mensaje_id = mensaje;
  IF cantidad > 0 THEN
    SELECT h.* INTO STRICT previo FROM public.mediciones h
    WHERE h.nodo_id = nodo.id AND h.mensaje_id = mensaje LIMIT 1;
    IF cantidad <> 3 OR lotes_cultivo <> 1 OR fechas_captura <> 1
       OR fechas_recepcion <> 1 OR origenes <> 1 THEN
      RETURN jsonb_build_object('estado','conflicto_id','codigo','LOTE_PREVIO_INCONSISTENTE');
    END IF;
    IF contenido_previo IS DISTINCT FROM contenido OR previo.tomada_en <> tomada
       OR previo.origen <> origen_lote
       OR previo.metadatos IS DISTINCT FROM trazabilidad
       OR EXISTS (SELECT 1 FROM public.mediciones h
                  WHERE h.nodo_id=nodo.id AND h.mensaje_id=mensaje
                    AND h.metadatos IS DISTINCT FROM trazabilidad) THEN
      RETURN jsonb_build_object('estado','conflicto_id','codigo','MISMO_ID_OTRO_CONTENIDO');
    END IF;
    RETURN jsonb_build_object('estado','duplicado','codigo','LOTE_IDENTICO_NO_REINSERTADO',
      'mensaje_id',mensaje,'medicion_ids',ids,'cultivo_id',previo.cultivo_id,
      'tomada_en',previo.tomada_en,'recibida_en',previo.recibida_en,'advertencias',avisos);
  END IF;
  -- Solo para lote nuevo: vinculo actual y ventana temporal.
  PERFORM 1 FROM public.cultivos c
  WHERE c.id = nodo.cultivo_id AND c.agricultor_id = nodo.agricultor_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CULTIVO_NO_AUTORIZADO' USING ERRCODE = '22023';
  END IF;
  IF tomada < p_recibida_en - interval '300 seconds'
     OR tomada > p_recibida_en + interval '120 seconds' THEN
    RAISE EXCEPTION 'VENTANA_TEMPORAL' USING ERRCODE = '22023';
  END IF;
  WITH nuevas AS (
    INSERT INTO public.mediciones
      (cultivo_id,nodo_id,variable_codigo,mensaje_id,valor,tomada_en,recibida_en,origen,metadatos)
    SELECT nodo.cultivo_id,nodo.id,e.value->>'variable_codigo',mensaje,
           (e.value->>'valor')::numeric,tomada,p_recibida_en,origen_lote,trazabilidad
    FROM json_array_elements(p->'mediciones') e
    RETURNING id, variable_codigo
  ) SELECT jsonb_agg(id ORDER BY variable_codigo) INTO ids FROM nuevas;
  IF ids IS NULL OR jsonb_array_length(ids) <> 3 THEN
    RAISE EXCEPTION 'LOTE_INSERTADO_INCOMPLETO' USING ERRCODE = '23514';
  END IF;
  RETURN jsonb_build_object('estado','insertado','codigo','LOTE_AMBIENTAL_GUARDADO',
    'mensaje_id',mensaje,'medicion_ids',ids,'cultivo_id',nodo.cultivo_id,
    'tomada_en',tomada,'recibida_en',p_recibida_en,'advertencias',avisos);
EXCEPTION WHEN invalid_parameter_value THEN
  -- La subtransaccion revierte tambien cualquier escritura antes de rechazar.
  -- Errores no previstos de DB/integridad/permisos se propagan al cliente.
  RETURN jsonb_build_object('estado','rechazado','codigo',SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_lote_ambiental(text,text,timestamptz,boolean,boolean,boolean)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_lote_ambiental(text,text,timestamptz,boolean,boolean,boolean)
TO service_role;
COMMENT ON FUNCTION public.registrar_lote_ambiental(text,text,timestamptz,boolean,boolean,boolean)
IS 'Ambiental v2, tres filas atomicas. LDR indice ADC adc12_10k_11db_v1; no lux ni calibracion entre placas. Solo servidor confiable.';

-- Compatibilidad: el DHT22 v1 sigue siendo valido aunque el nodo habilite LDR.
-- Conserva la RPC, sus permisos y su contrato de dos filas. No convierte lotes viejos.
CREATE OR REPLACE FUNCTION public.registrar_lote_dht22(
  p_topico text,
  p_mensaje text,
  p_recibida_en timestamptz,
  p_acl_verificada boolean DEFAULT false,
  p_retenido boolean DEFAULT NULL,
  p_retencion_broker_desactivada boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET timezone = 'UTC'
AS $$
DECLARE
  p json; m json; claves text[]; codigos_variables text[];
  v_codigo text; mensaje text; origen_lote text; fecha_texto text;
  tomada timestamptz; valor_m numeric; temperatura numeric; humedad numeric;
  nodo public.nodos%ROWTYPE; catalogo public.variables%ROWTYPE;
  previo public.mediciones%ROWTYPE;
  cantidad integer; lotes_cultivo integer; fechas_captura integer;
  fechas_recepcion integer; origenes integer;
  contenido jsonb; contenido_previo jsonb; ids jsonb;
  avisos jsonb := '[]'::jsonb;
BEGIN
  -- Contexto del servidor confiable, nunca del dispositivo.
  -- La DB no observa la ACL ni la metadata del paquete del broker.
  IF p_acl_verificada IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ORIGEN_NO_VERIFICADO' USING ERRCODE = '22023';
  END IF;
  IF p_retenido IS TRUE THEN
    RAISE EXCEPTION 'RETAIN_NO_ADMITIDO' USING ERRCODE = '22023';
  END IF;
  IF p_retenido IS NULL AND p_retencion_broker_desactivada IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'RETAIN_NO_VERIFICADO' USING ERRCODE = '22023';
  END IF;
  IF p_recibida_en IS NULL OR NOT isfinite(p_recibida_en) THEN
    RAISE EXCEPTION 'FECHA_RECEPCION' USING ERRCODE = '22023';
  END IF;
  IF p_mensaje IS NULL OR octet_length(convert_to(p_mensaje, 'UTF8')) > 2048
     OR left(p_mensaje, 1) = chr(65279) THEN
    RAISE EXCEPTION 'CODIFICACION_O_TAMANO' USING ERRCODE = '22023';
  END IF;
  BEGIN
    p := p_mensaje::json;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'JSON_INVALIDO' USING ERRCODE = '22023';
  END;
  IF json_typeof(p) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'CAMPOS_PAYLOAD' USING ERRCODE = '22023';
  END IF;
  -- json conserva claves duplicadas, jsonb las eliminaria antes del control.
  SELECT array_agg(j.key ORDER BY j.key) INTO claves FROM json_each(p) j;
  IF claves IS DISTINCT FROM ARRAY[
    'mediciones','mensaje_id','nodo_codigo','origen','tomada_en','version'
  ]::text[] THEN
    RAISE EXCEPTION 'CAMPOS_PAYLOAD_O_CLAVE_REPETIDA' USING ERRCODE = '22023';
  END IF;
  IF json_typeof(p->'version') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'VERSION' USING ERRCODE = '22023';
  END IF;
  BEGIN
    IF (p->>'version')::numeric <> 1 THEN
      RAISE EXCEPTION 'VERSION' USING ERRCODE = '22023';
    END IF;
  EXCEPTION WHEN numeric_value_out_of_range THEN
    RAISE EXCEPTION 'VERSION' USING ERRCODE = '22023';
  END;
  IF json_typeof(p->'nodo_codigo') IS DISTINCT FROM 'string'
     OR json_typeof(p->'mensaje_id') IS DISTINCT FROM 'string'
     OR json_typeof(p->'origen') IS DISTINCT FROM 'string'
     OR json_typeof(p->'tomada_en') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'TIPOS_PAYLOAD' USING ERRCODE = '22023';
  END IF;
  v_codigo := p->>'nodo_codigo'; mensaje := p->>'mensaje_id';
  origen_lote := p->>'origen'; fecha_texto := p->>'tomada_en';
  IF v_codigo !~ '^agv-[a-z0-9]+-[0-9]{2}$' OR v_codigo ~ E'[\r\n]' THEN
    RAISE EXCEPTION 'NODO_CODIGO' USING ERRCODE = '22023';
  END IF;
  IF length(mensaje) <> 36 OR mensaje !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'MENSAJE_ID' USING ERRCODE = '22023';
  END IF;
  IF origen_lote NOT IN ('real','simulado') THEN
    RAISE EXCEPTION 'ORIGEN' USING ERRCODE = '22023';
  END IF;
  IF p_topico IS DISTINCT FROM ('agrovigia/v1/' || origen_lote || '/nodos/' || v_codigo || '/telemetria') THEN
    RAISE EXCEPTION 'TOPICO_NO_COINCIDE' USING ERRCODE = '22023';
  END IF;
  IF length(fecha_texto) <> 20 OR fecha_texto !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' THEN
    RAISE EXCEPTION 'FECHA_CAPTURA' USING ERRCODE = '22023';
  END IF;
  BEGIN
    tomada := fecha_texto::timestamptz;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'FECHA_CAPTURA' USING ERRCODE = '22023';
  END;
  IF to_char(tomada AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') <> fecha_texto THEN
    RAISE EXCEPTION 'FECHA_CAPTURA' USING ERRCODE = '22023';
  END IF;
  IF json_typeof(p->'mediciones') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'CANTIDAD_VARIABLES' USING ERRCODE = '22023';
  END IF;
  IF json_array_length(p->'mediciones') <> 2 THEN
    RAISE EXCEPTION 'LOTE_DHT22_INCOMPLETO' USING ERRCODE = '22023';
  END IF;
  FOR m IN SELECT value FROM json_array_elements(p->'mediciones') LOOP
    IF json_typeof(m) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'CAMPOS_MEDICION' USING ERRCODE = '22023';
    END IF;
    SELECT array_agg(j.key ORDER BY j.key) INTO claves FROM json_each(m) j;
    IF claves IS DISTINCT FROM ARRAY['unidad','valor','variable_codigo']::text[] THEN
      RAISE EXCEPTION 'CAMPOS_MEDICION_O_CLAVE_REPETIDA' USING ERRCODE = '22023';
    END IF;
    IF json_typeof(m->'variable_codigo') IS DISTINCT FROM 'string'
       OR json_typeof(m->'unidad') IS DISTINCT FROM 'string'
       OR json_typeof(m->'valor') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'TIPOS_MEDICION' USING ERRCODE = '22023';
    END IF;
    IF m->>'variable_codigo' NOT IN ('temperatura_aire','humedad_aire') THEN
      RAISE EXCEPTION 'PERFIL_NO_ADMITIDO_EN_ESTA_RPC' USING ERRCODE = '22023';
    END IF;
    BEGIN
      valor_m := (m->>'valor')::numeric;
    EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation THEN
      RAISE EXCEPTION 'VALOR' USING ERRCODE = '22023';
    END;
    IF valor_m <> trunc(valor_m, 4) THEN
      RAISE EXCEPTION 'PRECISION_NUMERICA' USING ERRCODE = '22023';
    END IF;
    SELECT v.* INTO STRICT catalogo FROM public.variables v
    WHERE v.codigo = m->>'variable_codigo' FOR SHARE;
    IF (catalogo.codigo = 'temperatura_aire' AND
        (catalogo.unidad IS DISTINCT FROM (chr(176) || 'C')
         OR catalogo.valor_min IS DISTINCT FROM -40::numeric
         OR catalogo.valor_max IS DISTINCT FROM 80::numeric))
       OR (catalogo.codigo = 'humedad_aire' AND
        (catalogo.unidad IS DISTINCT FROM '% HR'
         OR catalogo.valor_min IS DISTINCT FROM 0::numeric
         OR catalogo.valor_max IS DISTINCT FROM 100::numeric)) THEN
      RAISE EXCEPTION 'CATALOGO_NO_COINCIDE' USING ERRCODE = '22023';
    END IF;
    IF m->>'unidad' IS DISTINCT FROM catalogo.unidad THEN
      RAISE EXCEPTION 'UNIDAD' USING ERRCODE = '22023';
    END IF;
    IF valor_m < catalogo.valor_min OR valor_m > catalogo.valor_max THEN
      RAISE EXCEPTION 'VALOR' USING ERRCODE = '22023';
    END IF;
    IF catalogo.codigo = 'temperatura_aire' THEN temperatura := valor_m;
    ELSE humedad := valor_m; END IF;
  END LOOP;
  SELECT array_agg(e.value->>'variable_codigo' ORDER BY e.value->>'variable_codigo'),
         jsonb_agg(jsonb_build_object('variable_codigo', e.value->>'variable_codigo',
                    'valor', (e.value->>'valor')::numeric) ORDER BY e.value->>'variable_codigo')
  INTO codigos_variables, contenido FROM json_array_elements(p->'mediciones') e;
  IF codigos_variables IS DISTINCT FROM ARRAY['humedad_aire','temperatura_aire']::text[] THEN
    RAISE EXCEPTION 'VARIABLE_REPETIDA_O_LOTE_INCOMPLETO' USING ERRCODE = '22023';
  END IF;
  IF temperatura = 0 AND humedad = 0 THEN
    avisos := avisos || '["PAR_CERO_REQUIERE_REVISION"]'::jsonb;
  END IF;
  IF p_retenido IS NULL THEN
    avisos := avisos || '["RETAIN_CONTROLADO_POR_POLITICA_BROKER"]'::jsonb;
  END IF;
  -- Serializa ingestas del nodo y coordina con UPDATE de su vinculo.
  -- Mantener v1: pausar y drenar mensajes antes de cambiar cultivo.
  SELECT n.* INTO nodo FROM public.nodos n WHERE n.codigo = v_codigo FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NODO_DESCONOCIDO' USING ERRCODE = '22023';
  END IF;
  IF NOT nodo.habilitado THEN
    RAISE EXCEPTION 'NODO_DESHABILITADO' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.nodo_variables nv WHERE nv.nodo_id = nodo.id) NOT IN (2,3)
     OR (SELECT count(*) FROM public.nodo_variables nv WHERE nv.nodo_id = nodo.id
         AND nv.variable_codigo IN ('temperatura_aire','humedad_aire')
         AND nv.sensor_modelo = 'DHT22') <> 2
     OR EXISTS (SELECT 1 FROM public.nodo_variables nv WHERE nv.nodo_id=nodo.id
                AND NOT (nv.variable_codigo IN ('temperatura_aire','humedad_aire') AND nv.sensor_modelo='DHT22')
                AND NOT (nv.variable_codigo='iluminacion_relativa' AND nv.sensor_modelo='LDR')) THEN
    RAISE EXCEPTION 'CAPACIDAD_NODO' USING ERRCODE = '22023';
  END IF;
  SELECT count(*),
         jsonb_agg(jsonb_build_object('variable_codigo', h.variable_codigo, 'valor', h.valor)
                   ORDER BY h.variable_codigo),
         jsonb_agg(h.id ORDER BY h.variable_codigo),
         count(DISTINCT h.cultivo_id), count(DISTINCT h.tomada_en),
         count(DISTINCT h.recibida_en), count(DISTINCT h.origen)
  INTO cantidad, contenido_previo, ids, lotes_cultivo, fechas_captura, fechas_recepcion, origenes
  FROM public.mediciones h WHERE h.nodo_id = nodo.id AND h.mensaje_id = mensaje;
  IF cantidad > 0 THEN
    SELECT h.* INTO STRICT previo FROM public.mediciones h
    WHERE h.nodo_id = nodo.id AND h.mensaje_id = mensaje LIMIT 1;
    IF cantidad <> 2 OR lotes_cultivo <> 1 OR fechas_captura <> 1
       OR fechas_recepcion <> 1 OR origenes <> 1 THEN
      RETURN jsonb_build_object('estado','conflicto_id','codigo','LOTE_PREVIO_INCONSISTENTE');
    END IF;
    IF contenido_previo IS DISTINCT FROM contenido OR previo.tomada_en <> tomada
       OR previo.origen <> origen_lote THEN
      RETURN jsonb_build_object('estado','conflicto_id','codigo','MISMO_ID_OTRO_CONTENIDO');
    END IF;
    RETURN jsonb_build_object('estado','duplicado','codigo','LOTE_IDENTICO_NO_REINSERTADO',
      'mensaje_id',mensaje,'medicion_ids',ids,'cultivo_id',previo.cultivo_id,
      'tomada_en',previo.tomada_en,'recibida_en',previo.recibida_en,'advertencias',avisos);
  END IF;
  -- Solo para lote nuevo: vinculo actual y ventana temporal.
  PERFORM 1 FROM public.cultivos c
  WHERE c.id = nodo.cultivo_id AND c.agricultor_id = nodo.agricultor_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CULTIVO_NO_AUTORIZADO' USING ERRCODE = '22023';
  END IF;
  IF tomada < p_recibida_en - interval '300 seconds'
     OR tomada > p_recibida_en + interval '120 seconds' THEN
    RAISE EXCEPTION 'VENTANA_TEMPORAL' USING ERRCODE = '22023';
  END IF;
  WITH nuevas AS (
    INSERT INTO public.mediciones
      (cultivo_id,nodo_id,variable_codigo,mensaje_id,valor,tomada_en,recibida_en,origen)
    SELECT nodo.cultivo_id,nodo.id,e.value->>'variable_codigo',mensaje,
           (e.value->>'valor')::numeric,tomada,p_recibida_en,origen_lote
    FROM json_array_elements(p->'mediciones') e
    RETURNING id, variable_codigo
  ) SELECT jsonb_agg(id ORDER BY variable_codigo) INTO ids FROM nuevas;
  IF ids IS NULL OR jsonb_array_length(ids) <> 2 THEN
    RAISE EXCEPTION 'LOTE_INSERTADO_INCOMPLETO' USING ERRCODE = '23514';
  END IF;
  RETURN jsonb_build_object('estado','insertado','codigo','LOTE_DHT22_GUARDADO',
    'mensaje_id',mensaje,'medicion_ids',ids,'cultivo_id',nodo.cultivo_id,
    'tomada_en',tomada,'recibida_en',p_recibida_en,'advertencias',avisos);
EXCEPTION WHEN invalid_parameter_value THEN
  -- La subtransaccion revierte tambien cualquier escritura antes de rechazar.
  -- Errores no previstos de DB/integridad/permisos se propagan al cliente.
  RETURN jsonb_build_object('estado','rechazado','codigo',SQLERRM);
END;
$$;

COMMIT;

SELECT has_function_privilege('service_role', 'public.registrar_lote_ambiental(text,text,timestamptz,boolean,boolean,boolean)', 'EXECUTE') AS ejecuta_servidor,
       has_function_privilege('authenticated', 'public.registrar_lote_ambiental(text,text,timestamptz,boolean,boolean,boolean)', 'EXECUTE') AS ejecuta_web,
       has_function_privilege('anon', 'public.registrar_lote_ambiental(text,text,timestamptz,boolean,boolean,boolean)', 'EXECUTE') AS ejecuta_anonimo;
