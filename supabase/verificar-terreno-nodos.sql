-- Verificacion de 0012 en Supabase (solo lectura). Resultado esperado: una fila con todas las columnas true.
SELECT
  (SELECT count(*) = 2 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cultivos' AND column_name IN ('ancho_m', 'largo_m')) AS terreno_en_cultivos,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'zonas' AND column_name = 'eliminada_en') AS sectores_retirables,
  has_function_privilege('authenticated', 'public.definir_terreno(uuid,numeric,numeric)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.crear_sector(uuid,text,numeric,numeric,numeric,numeric)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.editar_sector(uuid,text,numeric,numeric,numeric,numeric)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.eliminar_sector(uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.ubicar_nodo(uuid,uuid,numeric,numeric)', 'EXECUTE') AS web_gestiona_terreno_y_sectores,
  has_function_privilege('authenticated', 'public.registrar_nodo_fisico(text,text[])', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.regenerar_clave_nodo(uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.eliminar_nodo_fisico(uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.claves_nodos()', 'EXECUTE') AS web_gestiona_nodos_fisicos,
  has_function_privilege('service_role', 'public.autenticar_nodo(text,text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.autenticar_nodo(text,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.autenticar_nodo(text,text)', 'EXECUTE') AS autenticacion_solo_servidor,
  NOT has_function_privilege('anon', 'public.registrar_nodo_fisico(text,text[])', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.crear_sector(uuid,text,numeric,numeric,numeric,numeric)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.definir_terreno(uuid,numeric,numeric)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'public.registrar_nodo_fisico(text,text[])', 'EXECUTE') AS anonimo_y_servidor_sin_gestion,
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.nodo_claves'::regclass)
    AND NOT has_table_privilege('authenticated', 'public.nodo_claves', 'SELECT') AND NOT has_table_privilege('anon', 'public.nodo_claves', 'SELECT')
    AND NOT has_table_privilege('service_role', 'public.nodo_claves', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.nodo_claves', 'UPDATE') AS claves_ilegibles,
  NOT EXISTS (SELECT 1 FROM public.nodo_claves WHERE clave_hash !~ '^[0-9a-f]{64}$') AS solo_hashes,
  NOT has_function_privilege('authenticated', 'public.emitir_clave_nodo(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'public.emitir_clave_nodo(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.validar_sector(text,numeric,numeric,numeric,numeric)', 'EXECUTE') AS funciones_internas_cerradas,
  NOT has_table_privilege('authenticated', 'public.zonas', 'INSERT') AND NOT has_table_privilege('authenticated', 'public.zonas', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.zonas', 'DELETE') AS web_no_escribe_sectores_directo,
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'c_zona_activa' AND NOT tgisinternal) AS sectores_retirados_cerrados,
  NOT EXISTS (SELECT 1 FROM public.nodos n JOIN public.zonas z ON z.id = n.zona_id WHERE z.eliminada_en IS NOT NULL) AS ningun_nodo_en_sector_retirado,
  (SELECT 'https_wifi' = ANY (protocolos) FROM public.tipos_dispositivo WHERE codigo = 'esp32') AS protocolo_https_disponible,
  pg_get_functiondef('public.vincular_nodo(uuid,uuid)'::regprocedure) LIKE '%>=16%' AS dieciseis_fisicos_por_cultivo,
  (SELECT tipo_nodo = 'fisico' AND eliminado_en IS NULL FROM public.nodos WHERE codigo = 'agv-dht22-01') AS nodo_original_intacto;
