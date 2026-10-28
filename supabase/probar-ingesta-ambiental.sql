-- Ejecutar TODO despues de 0003, con postgres. Solo datos SIMULADOS; ROLLBACK.
-- Habilita LDR temporalmente dentro de esta transaccion, no cambia el nodo al terminar.
BEGIN;
DO $$ BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Usar postgres.'; END IF;
  IF NOT has_function_privilege('service_role','public.registrar_lote_ambiental(text,text,timestamptz,boolean,boolean,boolean)','EXECUTE')
     OR has_function_privilege('authenticated','public.registrar_lote_ambiental(text,text,timestamptz,boolean,boolean,boolean)','EXECUTE')
     OR has_function_privilege('anon','public.registrar_lote_ambiental(text,text,timestamptz,boolean,boolean,boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'Permisos incorrectos.';
  END IF;
END; $$;
INSERT INTO public.nodo_variables (nodo_id,variable_codigo,sensor_modelo)
SELECT id,'iluminacion_relativa','LDR' FROM public.nodos WHERE codigo='agv-dht22-01'
ON CONFLICT DO NOTHING;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM public.registrar_lote_ambiental(NULL,NULL,clock_timestamp());
    RAISE EXCEPTION 'Anon pudo ejecutar.';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.registrar_lote_ambiental(NULL,NULL,clock_timestamp());
    RAISE EXCEPTION 'Web pudo ejecutar.';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$
DECLARE
  recepcion timestamptz := date_trunc('second',clock_timestamp());
  topico text := 'agrovigia/v2/simulado/nodos/agv-dht22-01/telemetria';
  base jsonb; copia jsonb; caso jsonb; r jsonb; inicial jsonb; raw text;
  identidad text := gen_random_uuid()::text; rechazo text := gen_random_uuid()::text;
  nodo_uuid uuid; instante timestamptz;
BEGIN
  SELECT id INTO STRICT nodo_uuid FROM public.nodos WHERE codigo='agv-dht22-01';
  base := jsonb_build_object('version',2,'nodo_codigo','agv-dht22-01','mensaje_id',identidad,
    'origen','simulado','tomada_en',to_char(recepcion AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'ldr',jsonb_build_object('metodo','adc12_10k_11db_v1','adc_promedio',625),
    'mediciones',jsonb_build_array(
      jsonb_build_object('variable_codigo','temperatura_aire','valor',27.5,'unidad',chr(176)||'C'),
      jsonb_build_object('variable_codigo','humedad_aire','valor',47.8,'unidad','% HR'),
      jsonb_build_object('variable_codigo','iluminacion_relativa','valor',15.3,'unidad','% relativo')));
  inicial := public.registrar_lote_ambiental(topico,base::text,recepcion,true,NULL,true);
  IF inicial->>'estado' IS DISTINCT FROM 'insertado' OR jsonb_array_length(inicial->'medicion_ids') <> 3 THEN
    RAISE EXCEPTION 'Insercion fallo: %',inicial;
  END IF;
  IF (SELECT count(*) FROM public.mediciones WHERE nodo_id=nodo_uuid AND mensaje_id=identidad
      AND metadatos=jsonb_build_object('version_payload',2,'ldr',base->'ldr')
      AND tomada_en=recepcion AND recibida_en=recepcion AND origen='simulado') <> 3 THEN
    RAISE EXCEPTION 'Filas, trazabilidad o fechas no coinciden.';
  END IF;
  copia := jsonb_set(base,'{mediciones}',jsonb_build_array(base->'mediciones'->2,base->'mediciones'->0,base->'mediciones'->1));
  r := public.registrar_lote_ambiental(topico,copia::text,recepcion+interval '1 hour',true,false);
  IF r->>'estado' IS DISTINCT FROM 'duplicado' OR r->'medicion_ids' IS DISTINCT FROM inicial->'medicion_ids'
     OR r->'recibida_en' IS DISTINCT FROM inicial->'recibida_en' THEN RAISE EXCEPTION 'Duplicado fallo: %',r; END IF;
  -- Mismo indice redondeado pero ADC original distinto: es otro contenido.
  copia := jsonb_set(base,'{ldr,adc_promedio}','626');
  r := public.registrar_lote_ambiental(topico,copia::text,recepcion,true,false);
  IF r->>'estado' IS DISTINCT FROM 'conflicto_id' THEN RAISE EXCEPTION 'Conflicto de ADC ignorado: %',r; END IF;
  base := jsonb_set(base,'{mensaje_id}',to_jsonb(rechazo));
  FOR caso IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
    jsonb_set(base,'{mediciones}',jsonb_build_array(base->'mediciones'->0,base->'mediciones'->1)),
    jsonb_set(base,'{mediciones,2,valor}','50'),
    jsonb_set(base,'{ldr,adc_promedio}','4096'),
    jsonb_set(base,'{ldr,adc_promedio}','625.5'),
    jsonb_set(base,'{ldr,metodo}',to_jsonb('lux'::text)),
    jsonb_set(base,'{mediciones,1,valor}','101'),
    jsonb_set(base,'{mediciones,0,valor}','27.12345'),
    jsonb_set(base,'{mediciones,0,valor}',to_jsonb('27.5'::text)),
    jsonb_set(base,'{mediciones,2,unidad}',to_jsonb('lux'::text)),
    jsonb_set(base,'{version}','1'),
    jsonb_set(base,'{tomada_en}',to_jsonb('2026-02-30T12:00:00Z'::text)),
    jsonb_set(base,'{tomada_en}',to_jsonb(to_char((recepcion-interval '301 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))),
    jsonb_set(base,'{tomada_en}',to_jsonb(to_char((recepcion+interval '121 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))),
    base || '{"campo_extra":true}'::jsonb,
    jsonb_set(base,'{ldr}',base->'ldr'||'{"extra":1}'::jsonb),
    jsonb_set(base,'{mediciones}',jsonb_build_array(base->'mediciones'->0,base->'mediciones'->0,base->'mediciones'->2))
  )) LOOP
    r := public.registrar_lote_ambiental(topico,caso::text,recepcion,true,false);
    IF r->>'estado' IS DISTINCT FROM 'rechazado' THEN RAISE EXCEPTION 'No rechazo: %',r; END IF;
  END LOOP;
  FOREACH raw IN ARRAY ARRAY['{',chr(65279)||base::text,repeat(' ',2049)||base::text,
    '{"version":2,'||substr(base::text,2),
    replace(base::text,'"adc_promedio": 625','"adc_promedio":625,"adc_promedio":625'),
    replace(base::text,'"valor": 27.5','"valor":27.5,"valor":27.5')] LOOP
    r := public.registrar_lote_ambiental(topico,raw,recepcion,true,false);
    IF r->>'estado' IS DISTINCT FROM 'rechazado' THEN RAISE EXCEPTION 'Raw invalido no rechazo: %',r; END IF;
  END LOOP;
  r := public.registrar_lote_ambiental(topico,base::text,recepcion,false,false);
  IF r->>'codigo' IS DISTINCT FROM 'ORIGEN_NO_VERIFICADO' THEN RAISE EXCEPTION 'ACL no exigida'; END IF;
  r := public.registrar_lote_ambiental(topico,base::text,recepcion,true,true,true);
  IF r->>'codigo' IS DISTINCT FROM 'RETAIN_NO_ADMITIDO' THEN RAISE EXCEPTION 'Retain admitido'; END IF;
  r := public.registrar_lote_ambiental(topico,base::text,recepcion,true,NULL,false);
  IF r->>'codigo' IS DISTINCT FROM 'RETAIN_NO_VERIFICADO' THEN RAISE EXCEPTION 'Retain no verificado'; END IF;
  r := public.registrar_lote_ambiental(topico,base::text,NULL,true,false);
  IF r->>'codigo' IS DISTINCT FROM 'FECHA_RECEPCION' THEN RAISE EXCEPTION 'Recepcion no exigida'; END IF;
  r := public.registrar_lote_ambiental(replace(topico,'/v2/','/v1/'),base::text,recepcion,true,false);
  IF r->>'codigo' IS DISTINCT FROM 'TOPICO_NO_COINCIDE' THEN RAISE EXCEPTION 'Topico no verificado'; END IF;
  IF EXISTS (SELECT 1 FROM public.mediciones WHERE nodo_id=nodo_uuid AND mensaje_id=rechazo) THEN
    RAISE EXCEPTION 'Rechazo dejo filas.';
  END IF;
  FOREACH instante IN ARRAY ARRAY[recepcion-interval '300 seconds',recepcion+interval '120 seconds'] LOOP
    copia := jsonb_set(base,'{mensaje_id}',to_jsonb(gen_random_uuid()::text));
    copia := jsonb_set(copia,'{tomada_en}',to_jsonb(to_char(instante AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')));
    r := public.registrar_lote_ambiental(topico,copia::text,recepcion,true,false);
    IF r->>'estado' IS DISTINCT FROM 'insertado' THEN RAISE EXCEPTION 'Ventana inclusiva fallo: %',r; END IF;
  END LOOP;
  copia := jsonb_set(base,'{mensaje_id}',to_jsonb(gen_random_uuid()::text));
  copia := jsonb_set(jsonb_set(copia,'{ldr,adc_promedio}','4095'),'{mediciones,2,valor}','100');
  r := public.registrar_lote_ambiental(topico,copia::text,recepcion,true,false);
  IF r->>'estado' IS DISTINCT FROM 'insertado' OR NOT (r->'advertencias' ? 'LDR_EN_EXTREMO_ADC') THEN
    RAISE EXCEPTION 'Extremo no conservado/advertido: %',r;
  END IF;
END; $$;
RESET ROLE;
ROLLBACK;
SELECT 'Permisos solo servidor' AS comprobacion,'OK' AS resultado
UNION ALL SELECT 'Tres filas y ADC/metodo/fechas conservados','OK'
UNION ALL SELECT 'Duplicado tardio sin reinsercion; conflicto ADC detectado','OK'
UNION ALL SELECT 'Forma, conversion y contexto invalidos sin filas','OK'
UNION ALL SELECT 'Ventana inclusiva y extremos ADC con advertencia','OK'
UNION ALL SELECT 'Datos y capacidad temporal revertidos','OK';