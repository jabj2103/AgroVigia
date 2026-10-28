-- Solo lectura. Esperado true,true,true,false,false.
SELECT
 to_regclass('public.reglas_alerta') IS NOT NULL AND to_regclass('public.alertas') IS NOT NULL AND to_regclass('public.alerta_cursores') IS NOT NULL AS tablas_disponibles,
 has_function_privilege('authenticated','public.configurar_regla_alerta(uuid,text,numeric,numeric,text)','EXECUTE') AND has_function_privilege('authenticated','public.revisar_alerta(uuid)','EXECUTE') AS usuario_configura_y_revisa,
 has_function_privilege('service_role','public.evaluar_alertas_lote(uuid,text)','EXECUTE') AS servidor_evalua,
 has_function_privilege('authenticated','public.evaluar_alertas_lote(uuid,text)','EXECUTE') AS usuario_evalua_directamente,
 has_table_privilege('authenticated','public.alertas','UPDATE') OR has_table_privilege('service_role','public.alertas','INSERT') AS escritura_directa;
