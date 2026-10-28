-- Ejecutar TODO despues de 0002, con rol postgres. Datos SIMULADOS.
-- Todas las filas de prueba se revierten. Ante error: conservarlo y ROLLBACK;
BEGIN;

DO $$ BEGIN
  IF NOT has_function_privilege('service_role',
    'public.registrar_lote_dht22(text,text,timestamptz,boolean,boolean,boolean)','EXECUTE')
    OR has_function_privilege('authenticated',
    'public.registrar_lote_dht22(text,text,timestamptz,boolean,boolean,boolean)','EXECUTE')
    OR has_function_privilege('anon',
    'public.registrar_lote_dht22(text,text,timestamptz,boolean,boolean,boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'Permisos de la RPC incorrectos.';
  END IF;
END; $$;

-- Probar denegacion real, sin proporcionar credenciales ni invocar HTTP.
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM public.registrar_lote_dht22(NULL::text,NULL::text,clock_timestamp());
    RAISE EXCEPTION 'Fallo: anon pudo ejecutar la RPC.';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END; $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.registrar_lote_dht22(NULL::text,NULL::text,clock_timestamp());
    RAISE EXCEPTION 'Fallo: authenticated pudo ejecutar la RPC.';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END; $$;
RESET ROLE;

SET LOCAL ROLE service_role;
DO $$
DECLARE
  recepcion timestamptz := date_trunc('second',clock_timestamp());
  topico CONSTANT text := 'agrovigia/v1/simulado/nodos/agv-dht22-01/telemetria';
  base jsonb; copia jsonb; caso jsonb; r jsonb; inicial jsonb;
  identidad text := gen_random_uuid()::text;
  identidad_rechazo text := gen_random_uuid()::text;
  nodo_id_prueba uuid; raw text; instante timestamptz; codigo_rechazo text;
BEGIN
  SELECT n.id INTO STRICT nodo_id_prueba FROM public.nodos n
  WHERE n.codigo = 'agv-dht22-01';
  base := jsonb_build_object(
    'version',1,'nodo_codigo','agv-dht22-01','mensaje_id',identidad,
    'origen','simulado',
    'tomada_en',to_char(recepcion AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'mediciones',jsonb_build_array(
      jsonb_build_object('variable_codigo','temperatura_aire','valor',28.5,'unidad',chr(176)||'C'),
      jsonb_build_object('variable_codigo','humedad_aire','valor',72,'unidad','% HR')
    )
  );

  inicial := public.registrar_lote_dht22(topico,base::text,recepcion,true,false);
  IF inicial->>'estado' IS DISTINCT FROM 'insertado'
     OR coalesce(jsonb_array_length(inicial->'medicion_ids'),0) <> 2 THEN
    RAISE EXCEPTION 'Insercion de lote valido fallo: %', inicial;
  END IF;
  IF (SELECT count(*) FROM public.mediciones m
      WHERE m.nodo_id = nodo_id_prueba AND m.mensaje_id = identidad
        AND m.origen = 'simulado' AND m.recibida_en = recepcion AND m.tomada_en = recepcion) <> 2 THEN
    RAISE EXCEPTION 'Lote incompleto o fechas/origen cambiados.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mediciones m
                 WHERE m.nodo_id=nodo_id_prueba AND m.mensaje_id=identidad
                   AND m.variable_codigo='temperatura_aire' AND m.valor=28.5)
     OR NOT EXISTS (SELECT 1 FROM public.mediciones m
                    WHERE m.nodo_id=nodo_id_prueba AND m.mensaje_id=identidad
                      AND m.variable_codigo='humedad_aire' AND m.valor=72) THEN
    RAISE EXCEPTION 'Los valores guardados difieren del lote enviado.';
  END IF;

  -- Reordenar el array y volver una hora despues: sigue siendo duplicado.
  copia := jsonb_set(base,'{mediciones}',
                    jsonb_build_array(base->'mediciones'->1,base->'mediciones'->0));
  r := public.registrar_lote_dht22(topico,copia::text,recepcion+interval '1 hour',true,false);
  IF r->>'estado' IS DISTINCT FROM 'duplicado'
     OR r->'medicion_ids' IS DISTINCT FROM inicial->'medicion_ids'
     OR r->'recibida_en' IS DISTINCT FROM inicial->'recibida_en' THEN
    RAISE EXCEPTION 'Duplicado no conserva IDs/recepcion original: %', r;
  END IF;
  copia := jsonb_set(base,'{mediciones,0,valor}','29'::jsonb);
  r := public.registrar_lote_dht22(topico,copia::text,recepcion,true,false);
  IF r->>'estado' IS DISTINCT FROM 'conflicto_id'
     OR (SELECT count(*) FROM public.mediciones m
         WHERE m.nodo_id=nodo_id_prueba AND m.mensaje_id=identidad) <> 2
     OR NOT EXISTS (SELECT 1 FROM public.mediciones m
         WHERE m.nodo_id=nodo_id_prueba AND m.mensaje_id=identidad
           AND m.variable_codigo='temperatura_aire' AND m.valor=28.5) THEN
    RAISE EXCEPTION 'Conflicto modifica o duplica el lote previo: %', r;
  END IF;

  base := jsonb_set(base,'{mensaje_id}',to_jsonb(identidad_rechazo));
  FOR caso IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
    jsonb_set(base,'{mediciones}',jsonb_build_array(base->'mediciones'->0)),
    jsonb_set(base,'{mediciones,1,valor}','101'::jsonb),
    jsonb_set(base,'{mediciones,0,valor}','28.12345'::jsonb),
    jsonb_set(base,'{mediciones,0,valor}',to_jsonb('28.5'::text)),
    jsonb_set(base,'{mediciones,0,unidad}',to_jsonb('C'::text)),
    jsonb_set(base,'{tomada_en}',to_jsonb('2026-02-30T12:00:00Z'::text)),
    jsonb_set(base,'{tomada_en}',to_jsonb(to_char((recepcion-interval '301 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))),
    jsonb_set(base,'{tomada_en}',to_jsonb(to_char((recepcion+interval '121 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))),
    jsonb_set(base,'{version}','2'::jsonb),
    jsonb_set(base,'{origen}',to_jsonb('inventado'::text)),
    base || '{"campo_extra":true}'::jsonb,
    jsonb_set(base,'{mediciones}',jsonb_build_array(base->'mediciones'->0,base->'mediciones'->0))
  )) LOOP
    r := public.registrar_lote_dht22(topico,caso::text,recepcion,true,false);
    IF r->>'estado' IS DISTINCT FROM 'rechazado' THEN
      RAISE EXCEPTION 'Lote invalido no fue rechazado: %',r;
    END IF;
  END LOOP;

  FOREACH raw IN ARRAY ARRAY[
    '{',
    chr(65279)||base::text,
    repeat(' ',2049)||base::text,
    '{"version":1,'||substr(base::text,2),
    replace(base::text,'"valor": 28.5','"valor":28.5,"valor":28.5')
  ] LOOP
    r := public.registrar_lote_dht22(topico,raw,recepcion,true,false);
    IF r->>'estado' IS DISTINCT FROM 'rechazado' THEN
      RAISE EXCEPTION 'JSON invalido/duplicado/BOM/tamano no rechazado: %',r;
    END IF;
  END LOOP;

  r := public.registrar_lote_dht22(topico,base::text,recepcion,false,false);
  IF r->>'codigo' IS DISTINCT FROM 'ORIGEN_NO_VERIFICADO' THEN
    RAISE EXCEPTION 'No exige verificacion del canal.';
  END IF;
  r := public.registrar_lote_dht22(topico,base::text,recepcion,true,true,true);
  IF r->>'codigo' IS DISTINCT FROM 'RETAIN_NO_ADMITIDO' THEN
    RAISE EXCEPTION 'No rechaza retain observado verdadero.';
  END IF;
  r := public.registrar_lote_dht22(topico,base::text,recepcion,true,NULL,false);
  IF r->>'codigo' IS DISTINCT FROM 'RETAIN_NO_VERIFICADO' THEN
    RAISE EXCEPTION 'No exige evidencia de retain.';
  END IF;
  r := public.registrar_lote_dht22(topico,base::text,NULL,true,false);
  IF r->>'codigo' IS DISTINCT FROM 'FECHA_RECEPCION' THEN
    RAISE EXCEPTION 'No exige fecha de recepcion.';
  END IF;
  r := public.registrar_lote_dht22('otro/topico',base::text,recepcion,true,false);
  IF r->>'codigo' IS DISTINCT FROM 'TOPICO_NO_COINCIDE' THEN
    RAISE EXCEPTION 'No valida el topico.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.mediciones m
             WHERE m.nodo_id=nodo_id_prueba AND m.mensaje_id=identidad_rechazo) THEN
    RAISE EXCEPTION 'Un lote rechazado dejo filas.';
  END IF;

  -- Limites inclusivos de la ventana.
  FOREACH instante IN ARRAY ARRAY[recepcion-interval '300 seconds',recepcion+interval '120 seconds'] LOOP
    copia := jsonb_set(base,'{mensaje_id}',to_jsonb(gen_random_uuid()::text));
    copia := jsonb_set(copia,'{tomada_en}',to_jsonb(to_char(instante AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')));
    r := public.registrar_lote_dht22(topico,copia::text,recepcion,true,false);
    IF r->>'estado' IS DISTINCT FROM 'insertado' THEN
      RAISE EXCEPTION 'Extremo inclusivo de ventana rechazado: %',r;
    END IF;
  END LOOP;

  -- Ambos ceros generan advertencia, sin inventar una causa ni ocultarlos.
  copia := jsonb_set(base,'{mensaje_id}',to_jsonb(gen_random_uuid()::text));
  copia := jsonb_set(jsonb_set(copia,'{mediciones,0,valor}','0'),'{mediciones,1,valor}','0');
  r := public.registrar_lote_dht22(topico,copia::text,recepcion,true,false);
  IF r->>'estado' IS DISTINCT FROM 'insertado'
     OR NOT (r->'advertencias' ? 'PAR_CERO_REQUIERE_REVISION') THEN
    RAISE EXCEPTION 'Tratamiento de par cero incorrecto: %',r;
  END IF;
END;
$$;
RESET ROLE;

ROLLBACK;
-- Resumen condicionado a ejecutar TODO sin errores; no ejecutar este SELECT solo.
SELECT 'Permisos: servidor permitido; web y anon denegados' AS comprobacion, 'OK' AS resultado
UNION ALL SELECT 'Lote valido: dos filas con origen y fechas conservados','OK'
UNION ALL SELECT 'Duplicado reordenado y tardio: sin reinsercion','OK'
UNION ALL SELECT 'Conflicto: contenido anterior intacto','OK'
UNION ALL SELECT 'Lotes invalidos y contexto no verificado: cero filas','OK'
UNION ALL SELECT 'Ventana inclusiva y advertencia cero/cero','OK'
UNION ALL SELECT 'Datos simulados de prueba: revertidos','OK';
