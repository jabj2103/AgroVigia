-- Verificacion de 0009, 0010, 0011 y de provisionar-hexagonos.sql en Supabase (solo lectura).
-- Resultado esperado: una fila con todas las columnas true.
SELECT
  to_regclass('public.sugerencias_ia') IS NOT NULL AS tabla_sugerencias,
  (SELECT count(*) = 6 FROM public.cultivo_plantillas WHERE suelo_vwc_min < suelo_vwc_max) AS seis_plantillas_con_suelo,
  (SELECT count(*) = 3 FROM (SELECT n.cultivo_id FROM public.nodos n
     WHERE n.cultivo_id IN (SELECT cultivo_id FROM public.nodos WHERE tipo_nodo = 'virtual')
     GROUP BY n.cultivo_id HAVING count(*) = 6) h) AS tres_hexagonos_de_seis,
  (SELECT count(*) = 6 FROM public.nodos x WHERE x.cultivo_id = (SELECT cultivo_id FROM public.nodos WHERE codigo = 'agv-dht22-01')) AS hexagono_del_fisico,
  NOT EXISTS (SELECT 1 FROM public.nodos n WHERE n.tipo_nodo = 'virtual' AND n.habilitado AND n.cultivo_id IS NOT NULL
     AND (n.zona_id IS NULL OR (SELECT count(*) FROM public.nodo_variables v WHERE v.nodo_id = n.id AND v.sensor_modelo = 'SIMULADOR_V3') <> 10)) AS virtuales_con_zona_y_diez_variables,
  (SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.sugerencias_ia'::regclass,
     'public.sugerencia_mediciones'::regclass, 'public.cultivo_plantillas'::regclass)) AS rls_activo,
  has_function_privilege('service_role', 'public.reservar_sugerencia_ia(uuid,text)', 'EXECUTE') AS n8n_reserva,
  NOT has_function_privilege('authenticated', 'public.reservar_sugerencia_ia(uuid,text)', 'EXECUTE') AS web_no_reserva,
  NOT has_function_privilege('authenticated', 'public.configurar_regla_suelo(uuid,numeric,numeric)', 'EXECUTE') AS web_no_regla_suelo,
  NOT has_function_privilege('anon', 'public.estado_red_nodos()', 'EXECUTE') AS anonimo_sin_red,
  NOT has_table_privilege('authenticated', 'public.sugerencias_ia', 'INSERT') AS web_no_escribe,
  (SELECT tipo_nodo = 'fisico' FROM public.nodos WHERE codigo = 'agv-dht22-01') AS nodo_fisico_real,
  (SELECT count(*) = 4 FROM public.tipos_dispositivo) AS cuatro_tipos_dispositivo,
  NOT EXISTS (SELECT 1 FROM public.nodos WHERE (tipo_nodo = 'virtual') <> (tipo_dispositivo = 'virtual')) AS dispositivo_coherente,
  (SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.cultivo_parametros'::regclass, 'public.clima_cultivo'::regclass,
     'public.tipos_dispositivo'::regclass, 'public.preferencias_usuario'::regclass)) AS rls_plataforma,
  has_function_privilege('authenticated', 'public.establecer_clima(uuid,text,integer,boolean)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.pausar_nodo(uuid,boolean)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.ajustar_parametros_cultivo(uuid,jsonb,boolean,text)', 'EXECUTE') AS web_configura,
  has_function_privilege('service_role', 'public.estado_simulacion()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.estado_simulacion()', 'EXECUTE') AS simulacion_solo_servidor,
  NOT has_table_privilege('authenticated', 'public.clima_cultivo', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.cultivo_parametros', 'UPDATE') AS web_no_escribe_directo,
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'a_recepcion_pausada' AND NOT tgisinternal) AS pausa_activa,
  -- 0011: ajuste manual de la simulacion, sugerencias a peticion y nodos virtuales gestionables.
  (SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.ajustes_simulacion'::regclass, 'public.solicitudes_ia'::regclass)) AS rls_0011,
  has_function_privilege('authenticated', 'public.ajustar_simulacion(uuid,jsonb,boolean)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.solicitar_sugerencia_ia(uuid,text)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.crear_nodo_virtual(uuid,uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.retirar_nodo_virtual(uuid)', 'EXECUTE') AS web_ajusta_solicita_y_gestiona_virtuales,
  has_function_privilege('service_role', 'public.tomar_solicitudes_ia(integer)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.preparar_solicitud_ia(uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.completar_solicitud_ia(uuid,jsonb,text,integer,integer,text)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.cerrar_solicitud_ia(uuid,text,text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.tomar_solicitudes_ia(integer)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.completar_solicitud_ia(uuid,jsonb,text,integer,integer,text)', 'EXECUTE') AS solicitudes_solo_servidor,
  NOT has_table_privilege('authenticated', 'public.ajustes_simulacion', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.solicitudes_ia', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.solicitudes_ia', 'UPDATE') AS web_no_escribe_0011,
  NOT has_function_privilege('anon', 'public.ajustar_simulacion(uuid,jsonb,boolean)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.solicitar_sugerencia_ia(uuid,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.crear_nodo_virtual(uuid,uuid)', 'EXECUTE')
    AND NOT has_table_privilege('anon', 'public.solicitudes_ia', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.ajustes_simulacion', 'SELECT') AS anonimo_sin_0011,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sugerencias_ia_motivo_check' AND pg_get_constraintdef(oid) LIKE '%solicitud%') AS motivo_solicitud,
  NOT has_function_privilege('service_role', 'public.contexto_sugerencia_ia(uuid,uuid,text,text,timestamptz)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.depurar_solicitudes_ia(timestamptz)', 'EXECUTE') AS funciones_internas_cerradas,
  -- 0011: mover y eliminar nodos virtuales, eliminar cultivos sin historial.
  has_function_privilege('authenticated', 'public.mover_nodo_virtual(uuid,uuid,uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.eliminar_nodo_virtual(uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.eliminar_cultivo(uuid)', 'EXECUTE') AS web_mueve_y_elimina,
  NOT has_function_privilege('anon', 'public.mover_nodo_virtual(uuid,uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.eliminar_nodo_virtual(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.eliminar_cultivo(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'public.eliminar_cultivo(uuid)', 'EXECUTE') AS solo_la_cuenta_elimina,
  NOT has_table_privilege('authenticated', 'public.nodos', 'DELETE') AND NOT has_table_privilege('authenticated', 'public.nodos', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.cultivos', 'DELETE')
    AND NOT has_table_privilege('authenticated', 'public.nodo_asignaciones', 'DELETE') AS web_no_borra_directo,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'nodos' AND column_name = 'eliminado_en')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nodo_eliminado_inactivo') AS nodos_eliminados_marcados,
  NOT EXISTS (SELECT 1 FROM public.nodos WHERE eliminado_en IS NOT NULL AND (cultivo_id IS NOT NULL OR habilitado)) AS eliminados_sueltos_e_inactivos,
  EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc f ON f.oid = t.tgfoid
          WHERE t.tgname = 'asignacion_inmutable' AND NOT t.tgisinternal AND f.proname = 'proteger_asignacion') AS auditoria_protegida,
  NOT has_function_privilege('authenticated', 'public.asegurar_sectores_cultivo(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.elegir_sector_nodo(uuid,uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.posicion_libre_sector(uuid,uuid)', 'EXECUTE') AS auxiliares_de_nodos_cerradas;
