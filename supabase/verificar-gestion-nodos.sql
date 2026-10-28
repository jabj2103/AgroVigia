-- Solo lectura. Esperado: true,true,true,false,false.
SELECT
 to_regclass('public.nodo_asignaciones') IS NOT NULL AS auditoria_disponible,
 has_function_privilege('authenticated','public.vincular_nodo(uuid,uuid)','EXECUTE') AS puede_vincular,
 has_function_privilege('authenticated','public.desvincular_nodo(uuid,uuid)','EXECUTE') AS puede_desvincular,
 has_function_privilege('anon','public.vincular_nodo(uuid,uuid)','EXECUTE') AS anon_puede_vincular,
 has_table_privilege('authenticated','public.nodo_asignaciones','INSERT') AS escritura_directa_auditoria;
