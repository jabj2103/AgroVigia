-- 0008. Requiere 0007. Solo ingesta de nodos VIRTUALES autorizados, no cambia v1/v2.
BEGIN;
INSERT INTO public.variables(codigo,nombre,unidad,valor_min,valor_max) VALUES
 ('radiacion_solar','Radiacion solar','W/m²',0,1400),
 ('humedad_suelo_vwc','Humedad volumetrica del suelo','% VWC',0,80),
 ('temperatura_suelo','Temperatura del suelo','°C',-20,70),
 ('ph_suelo','pH del suelo','sin unidad',0,14),
 ('conductividad_suelo_ece','Conductividad ECe del suelo','dS/m',0,30),
 ('precipitacion_60min','Precipitacion acumulada en ventana movil de 60 min','mm',0,200),
 ('velocidad_viento','Velocidad del viento','m/s',0,50);

CREATE FUNCTION public.registrar_lote_simulado_v3(
 p_topico text,p_mensaje text,p_recibida_en timestamptz,
 p_acl_verificada boolean DEFAULT false,p_retenido boolean DEFAULT NULL,p_retencion_broker_desactivada boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
DECLARE
 p json; m json; s json; keys text[]; codes text[]; v_codigo text; mensaje text; fecha text; tomada timestamptz;
 n public.nodos; anterior public.mediciones; catalogo public.variables; cuenta uuid; valor numeric; expected jsonb;
 contenido jsonb; previo jsonb; ids jsonb; cantidad integer; consistente boolean; trazabilidad jsonb;
 uuid4 text:='^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
BEGIN
 IF p_acl_verificada IS DISTINCT FROM true THEN RAISE EXCEPTION 'ORIGEN_NO_VERIFICADO' USING ERRCODE='22023'; END IF;
 IF p_retenido IS TRUE THEN RAISE EXCEPTION 'RETAIN_NO_ADMITIDO' USING ERRCODE='22023'; END IF;
 IF p_retenido IS NULL AND p_retencion_broker_desactivada IS DISTINCT FROM true THEN RAISE EXCEPTION 'RETAIN_NO_VERIFICADO' USING ERRCODE='22023'; END IF;
 IF p_recibida_en IS NULL OR NOT isfinite(p_recibida_en) THEN RAISE EXCEPTION 'FECHA_RECEPCION' USING ERRCODE='22023'; END IF;
 IF p_mensaje IS NULL OR octet_length(convert_to(p_mensaje,'UTF8'))>8192 OR left(p_mensaje,1)=chr(65279) THEN RAISE EXCEPTION 'CODIFICACION_O_TAMANO' USING ERRCODE='22023'; END IF;
 BEGIN p:=p_mensaje::json;
 EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'JSON_INVALIDO' USING ERRCODE='22023'; END;
 IF json_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'CAMPOS_PAYLOAD' USING ERRCODE='22023'; END IF;
 SELECT array_agg(j.key ORDER BY j.key) INTO keys FROM json_each(p) j;
 IF keys IS DISTINCT FROM ARRAY['asignacion_version','mediciones','mensaje_id','nodo_codigo','origen','simulacion','tomada_en','version']::text[] THEN
  RAISE EXCEPTION 'CAMPOS_PAYLOAD_O_CLAVE_REPETIDA' USING ERRCODE='22023'; END IF;
 IF json_typeof(p->'version') IS DISTINCT FROM 'number' OR p->>'version' IS DISTINCT FROM '3'
  OR json_typeof(p->'nodo_codigo') IS DISTINCT FROM 'string' OR json_typeof(p->'mensaje_id') IS DISTINCT FROM 'string'
  OR json_typeof(p->'origen') IS DISTINCT FROM 'string' OR p->>'origen' IS DISTINCT FROM 'simulado'
  OR json_typeof(p->'asignacion_version') IS DISTINCT FROM 'string' OR p->>'asignacion_version' !~ uuid4 OR length(p->>'asignacion_version')<>36
  OR json_typeof(p->'tomada_en') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'TIPOS_VERSION_U_ORIGEN' USING ERRCODE='22023'; END IF;
 v_codigo:=p->>'nodo_codigo'; mensaje:=p->>'mensaje_id'; fecha:=p->>'tomada_en';
 IF v_codigo !~ '^sim-[a-z0-9][a-z0-9-]{1,45}$' OR v_codigo ~ E'[\r\n]' OR mensaje !~ uuid4 OR length(mensaje)<>36 THEN RAISE EXCEPTION 'IDENTIDAD_SIMULADA' USING ERRCODE='22023'; END IF;
 IF p_topico IS DISTINCT FROM ('agrovigia/v3/simulado/nodos/'||v_codigo||'/telemetria') THEN RAISE EXCEPTION 'TOPICO_NO_COINCIDE' USING ERRCODE='22023'; END IF;
 IF fecha !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' OR length(fecha)<>24 THEN
  RAISE EXCEPTION 'FECHA_CAPTURA' USING ERRCODE='22023'; END IF;
 BEGIN tomada:=fecha::timestamptz;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'FECHA_CAPTURA' USING ERRCODE='22023'; END;
 IF to_char(tomada AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>fecha THEN RAISE EXCEPTION 'FECHA_CAPTURA' USING ERRCODE='22023'; END IF;
 s:=p->'simulacion';
 IF json_typeof(s) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'CONTEXTO_SIMULACION' USING ERRCODE='22023'; END IF;
 SELECT array_agg(j.key ORDER BY j.key) INTO keys FROM json_each(s) j;
 IF keys IS DISTINCT FROM ARRAY['ejecucion_id','escenario_id','modo','paso','pasos_transicion','semilla']::text[]
  OR json_typeof(s->'ejecucion_id') IS DISTINCT FROM 'string' OR s->>'ejecucion_id' !~ uuid4 OR length(s->>'ejecucion_id')<>36
  OR json_typeof(s->'escenario_id') IS DISTINCT FROM 'string' OR s->>'escenario_id' NOT IN ('referencia','calor-seco','lluvia','viento','ph','recuperacion')
  OR json_typeof(s->'modo') IS DISTINCT FROM 'string' OR s->>'modo' NOT IN ('manual','escenario')
  OR json_typeof(s->'semilla') IS DISTINCT FROM 'number' OR s->>'semilla' !~ '^[1-9][0-9]{0,8}$'
  OR json_typeof(s->'pasos_transicion') IS DISTINCT FROM 'number' OR s->>'pasos_transicion' IS DISTINCT FROM '12'
  OR json_typeof(s->'paso') IS DISTINCT FROM 'number' OR s->>'paso' !~ '^([0-9]|1[0-2])$'
  OR (s->>'modo'='manual' AND s->>'paso'<>'0') THEN RAISE EXCEPTION 'CONTEXTO_SIMULACION' USING ERRCODE='22023'; END IF;
 IF json_typeof(p->'mediciones') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'LOTE_SIMULADO_INCOMPLETO' USING ERRCODE='22023'; END IF;
 IF json_array_length(p->'mediciones')<>10 THEN RAISE EXCEPTION 'LOTE_SIMULADO_INCOMPLETO' USING ERRCODE='22023'; END IF;
 FOR m IN SELECT value FROM json_array_elements(p->'mediciones') LOOP
  IF json_typeof(m) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'CAMPOS_MEDICION' USING ERRCODE='22023'; END IF;
  SELECT array_agg(j.key ORDER BY j.key) INTO keys FROM json_each(m) j;
  IF keys IS DISTINCT FROM ARRAY['metadatos','origen','unidad','valor','variable_codigo']::text[]
   OR json_typeof(m->'variable_codigo') IS DISTINCT FROM 'string' OR json_typeof(m->'unidad') IS DISTINCT FROM 'string'
   OR json_typeof(m->'valor') IS DISTINCT FROM 'number' OR json_typeof(m->'origen') IS DISTINCT FROM 'string'
   OR m->>'origen' IS DISTINCT FROM 'simulado' OR json_typeof(m->'metadatos') IS DISTINCT FROM 'object' THEN
   RAISE EXCEPTION 'CAMPOS_O_TIPOS_MEDICION' USING ERRCODE='22023'; END IF;
  IF m->>'variable_codigo' NOT IN ('temperatura_aire','humedad_aire','iluminacion_relativa','radiacion_solar','humedad_suelo_vwc','temperatura_suelo','ph_suelo','conductividad_suelo_ece','precipitacion_60min','velocidad_viento') THEN
   RAISE EXCEPTION 'VARIABLE_NO_ADMITIDA' USING ERRCODE='22023'; END IF;
  SELECT * INTO catalogo FROM public.variables WHERE public.variables.codigo=m->>'variable_codigo' FOR SHARE;
  IF NOT FOUND OR catalogo.unidad IS DISTINCT FROM m->>'unidad' THEN RAISE EXCEPTION 'UNIDAD_NO_COINCIDE' USING ERRCODE='22023'; END IF;
  BEGIN valor:=(m->>'valor')::numeric;
  EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation THEN RAISE EXCEPTION 'VALOR' USING ERRCODE='22023'; END;
  IF valor::text IN ('NaN','Infinity','-Infinity') OR valor<>round(valor,4) OR valor<catalogo.valor_min OR valor>catalogo.valor_max THEN
   RAISE EXCEPTION 'VALOR_O_PRECISION' USING ERRCODE='22023'; END IF;
  expected:=jsonb_build_object('fuente','generador_sintetico_v1');
  IF catalogo.codigo IN ('humedad_suelo_vwc','temperatura_suelo') THEN expected:=expected||jsonb_build_object('profundidad_cm',20); END IF;
  IF catalogo.codigo='iluminacion_relativa' THEN expected:=expected||jsonb_build_object('metodo','indice_relativo_sintetico_v1'); END IF;
  IF catalogo.codigo='conductividad_suelo_ece' THEN expected:=expected||jsonb_build_object('metodo','extracto_pasta_saturada_ECe','temperatura_referencia_c',25); END IF;
  IF catalogo.codigo='precipitacion_60min' THEN expected:=expected||jsonb_build_object('ventana','movil','periodo_segundos',3600,
   'inicio_periodo',to_char((tomada-interval '1 hour') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'fin_periodo',fecha,'acumulados_no_sumables',true); END IF;
  SELECT array_agg(j.key ORDER BY j.key) INTO keys FROM json_each(m->'metadatos') j;
  IF keys IS DISTINCT FROM (SELECT array_agg(j.key ORDER BY j.key) FROM jsonb_each(expected) j)
    OR (m->'metadatos')::jsonb IS DISTINCT FROM expected THEN RAISE EXCEPTION 'METADATOS_SIMULACION' USING ERRCODE='22023'; END IF;
 END LOOP;
 SELECT array_agg(e.value->>'variable_codigo' ORDER BY e.value->>'variable_codigo'),
  jsonb_agg(e.value::jsonb ORDER BY e.value->>'variable_codigo') INTO codes,contenido FROM json_array_elements(p->'mediciones') e;
 IF codes IS DISTINCT FROM ARRAY['conductividad_suelo_ece','humedad_aire','humedad_suelo_vwc','iluminacion_relativa','ph_suelo','precipitacion_60min','radiacion_solar','temperatura_aire','temperatura_suelo','velocidad_viento']::text[] THEN
  RAISE EXCEPTION 'VARIABLE_REPETIDA_O_LOTE_INCOMPLETO' USING ERRCODE='22023'; END IF;
 -- Serializacion por cuenta, cultivo y nodo compatible con las RPC nuevas de mapa.
 SELECT agricultor_id INTO cuenta FROM public.nodos WHERE public.nodos.codigo=v_codigo;
 IF NOT FOUND THEN RAISE EXCEPTION 'NODO_DESCONOCIDO' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.perfiles WHERE id=cuenta FOR UPDATE;
 PERFORM 1 FROM public.cultivos c JOIN public.nodos nd ON nd.cultivo_id=c.id WHERE nd.codigo=v_codigo FOR UPDATE OF c;
 SELECT * INTO n FROM public.nodos WHERE public.nodos.codigo=v_codigo FOR UPDATE;
 IF n.tipo_nodo<>'virtual' OR n.agricultor_id<>cuenta THEN RAISE EXCEPTION 'NODO_NO_VIRTUAL' USING ERRCODE='22023'; END IF;
 IF NOT n.habilitado THEN RAISE EXCEPTION 'NODO_DESHABILITADO' USING ERRCODE='22023'; END IF;
 trazabilidad:=jsonb_build_object('version_payload',3,'asignacion_version',p->>'asignacion_version','simulacion',s::jsonb);
 SELECT count(*),jsonb_agg(jsonb_build_object('variable_codigo',h.variable_codigo,'valor',h.valor,'unidad',h.metadatos->>'unidad','origen',h.origen,'metadatos',h.metadatos->'detalle') ORDER BY h.variable_codigo),
  jsonb_agg(h.id ORDER BY h.variable_codigo),
  count(DISTINCT h.cultivo_id)=1 AND count(DISTINCT h.zona_id)=1 AND count(DISTINCT h.tomada_en)=1 AND count(DISTINCT h.recibida_en)=1 AND count(DISTINCT h.origen)=1
 INTO cantidad,previo,ids,consistente FROM public.mediciones h JOIN public.variables v ON v.codigo=h.variable_codigo WHERE h.nodo_id=n.id AND h.mensaje_id=mensaje;
 IF cantidad>0 THEN
  SELECT * INTO STRICT anterior FROM public.mediciones WHERE nodo_id=n.id AND mensaje_id=mensaje LIMIT 1;
  IF cantidad<>10 OR NOT consistente THEN RETURN jsonb_build_object('estado','conflicto_id','codigo','LOTE_PREVIO_INCONSISTENTE'); END IF;
  IF previo IS DISTINCT FROM contenido OR anterior.tomada_en<>tomada OR anterior.origen<>'simulado'
   OR EXISTS(SELECT 1 FROM public.mediciones h WHERE h.nodo_id=n.id AND h.mensaje_id=mensaje AND (h.metadatos-'detalle'-'unidad') IS DISTINCT FROM trazabilidad) THEN
   RETURN jsonb_build_object('estado','conflicto_id','codigo','MISMO_ID_OTRO_CONTENIDO'); END IF;
  RETURN jsonb_build_object('estado','duplicado','codigo','LOTE_IDENTICO_NO_REINSERTADO','mensaje_id',mensaje,'medicion_ids',ids,
   'cultivo_id',anterior.cultivo_id,'zona_id',anterior.zona_id,'tomada_en',anterior.tomada_en,'recibida_en',anterior.recibida_en,'origen','simulado');
 END IF;
 IF n.asignacion_version::text IS DISTINCT FROM p->>'asignacion_version' THEN RAISE EXCEPTION 'ASIGNACION_CAMBIO' USING ERRCODE='22023'; END IF;
 IF n.zona_id IS NULL OR n.cultivo_id IS NULL THEN RAISE EXCEPTION 'NODO_SIN_ZONA_O_CULTIVO' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.cultivos WHERE id=n.cultivo_id AND agricultor_id=n.agricultor_id AND archivado_en IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'CULTIVO_NO_ACTIVO' USING ERRCODE='22023'; END IF;
 IF p_recibida_en<clock_timestamp()-interval '300 seconds' OR p_recibida_en>clock_timestamp()+interval '120 seconds' THEN RAISE EXCEPTION 'FECHA_RECEPCION' USING ERRCODE='22023'; END IF;
 IF tomada<p_recibida_en-interval '300 seconds' OR tomada>p_recibida_en+interval '120 seconds' THEN RAISE EXCEPTION 'VENTANA_TEMPORAL' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*) FROM public.nodo_variables WHERE nodo_id=n.id)<>10 OR EXISTS(
  SELECT 1 FROM unnest(codes) code WHERE NOT EXISTS(SELECT 1 FROM public.nodo_variables nv WHERE nv.nodo_id=n.id AND nv.variable_codigo=code AND nv.sensor_modelo='SIMULADOR_V3')) THEN
  RAISE EXCEPTION 'CAPACIDAD_NODO' USING ERRCODE='22023'; END IF;
 WITH nuevas AS (
  INSERT INTO public.mediciones(cultivo_id,nodo_id,zona_id,variable_codigo,mensaje_id,valor,tomada_en,recibida_en,origen,metadatos)
  SELECT n.cultivo_id,n.id,n.zona_id,e.value->>'variable_codigo',mensaje,(e.value->>'valor')::numeric,tomada,p_recibida_en,'simulado',
   trazabilidad||jsonb_build_object('detalle',(e.value->'metadatos')::jsonb,'unidad',e.value->>'unidad') FROM json_array_elements(p->'mediciones') e RETURNING id,variable_codigo
 ) SELECT jsonb_agg(id ORDER BY variable_codigo) INTO ids FROM nuevas;
 IF jsonb_array_length(ids)<>10 THEN RAISE EXCEPTION 'LOTE_INSERTADO_INCOMPLETO' USING ERRCODE='23514'; END IF;
 RETURN jsonb_build_object('estado','insertado','codigo','LOTE_SIMULADO_GUARDADO','mensaje_id',mensaje,'medicion_ids',ids,
  'cultivo_id',n.cultivo_id,'zona_id',n.zona_id,'tomada_en',tomada,'recibida_en',p_recibida_en,'origen','simulado',
  'advertencias',CASE WHEN p_retenido IS NULL THEN jsonb_build_array('DATOS_SIMULADOS','RETAIN_CONTROLADO_POR_POLITICA_BROKER') ELSE jsonb_build_array('DATOS_SIMULADOS') END);
EXCEPTION WHEN invalid_parameter_value THEN
 RETURN jsonb_build_object('estado','rechazado','codigo',SQLERRM);
END; $$;
REVOKE ALL ON FUNCTION public.registrar_lote_simulado_v3(text,text,timestamptz,boolean,boolean,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.registrar_lote_simulado_v3(text,text,timestamptz,boolean,boolean,boolean) TO service_role;
COMMIT;
