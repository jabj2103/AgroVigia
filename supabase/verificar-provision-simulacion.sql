-- SOLO LECTURA. Cultivo de demostracion utilizado en esta integracion.
-- Si se aprovisiono otro cultivo, sustituir el UUID de la clausula WHERE.
SELECT
 'sim-zona-'||right(n.codigo,2) AS nodo_local,
 n.codigo AS nodo_codigo,
 n.asignacion_version,
 n.cultivo_id,n.zona_id,
 z.codigo AS zona_codigo,z.nombre AS zona_nombre,
 n.habilitado,
 (SELECT count(*)::int FROM public.nodo_variables nv
   WHERE nv.nodo_id=n.id AND nv.sensor_modelo='SIMULADOR_V3') AS variables_simuladas
FROM public.nodos n
JOIN public.zonas z ON z.id=n.zona_id AND z.cultivo_id=n.cultivo_id
WHERE n.cultivo_id='52ea4628-c470-48f4-a09a-0f9a697d22b4'::uuid
 AND n.tipo_nodo='virtual'
 AND n.codigo='sim-'||substr(replace(n.cultivo_id::text,'-',''),1,12)||'-'||right(n.codigo,2)
 AND z.codigo IN ('zona-norte','zona-sur','zona-central','zona-drenaje')
ORDER BY n.codigo;
-- Esperado tras el alta: cuatro filas, habilitado true y variables_simuladas 10.
