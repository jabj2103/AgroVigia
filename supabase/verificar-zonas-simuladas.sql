-- Solo lectura. Ejecutar despues de 0007/0008; no crea filas ni invoca ingestas.
SELECT
 to_regclass('public.zonas') IS NOT NULL AS tabla_zonas,
 (SELECT relrowsecurity FROM pg_class WHERE oid='public.zonas'::regclass) AS rls_zonas,
 (SELECT count(*)=10 FROM public.variables WHERE codigo IN
  ('temperatura_aire','humedad_aire','iluminacion_relativa','radiacion_solar','humedad_suelo_vwc','temperatura_suelo','ph_suelo','conductividad_suelo_ece','precipitacion_60min','velocidad_viento')) AS diez_variables,
 has_function_privilege('authenticated','public.configurar_zona(uuid,text,text,numeric,numeric,numeric,numeric)','EXECUTE') AS web_configura_zona,
 has_function_privilege('authenticated','public.asignar_zona_nodo(uuid,uuid,numeric,numeric)','EXECUTE') AS web_asigna_zona,
 has_function_privilege('service_role','public.registrar_lote_simulado_v3(text,text,timestamptz,boolean,boolean,boolean)','EXECUTE') AS servidor_ingesta,
 has_function_privilege('authenticated','public.registrar_lote_simulado_v3(text,text,timestamptz,boolean,boolean,boolean)','EXECUTE') AS web_ingesta,
 has_table_privilege('authenticated','public.zonas','INSERT') AS web_insert_directo,
 has_table_privilege('service_role','public.mediciones','INSERT') AS servidor_insert_directo;
-- Esperado: true,true,true,true,true,true,false,false,false.
