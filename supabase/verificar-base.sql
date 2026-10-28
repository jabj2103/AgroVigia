-- Solo lectura. Ejecutar despues de 202610260001_base_recepcion.sql.
-- Deben aparecer seis filas: existe/rls/lectura=true; escrituras/anonimo=false;
-- y una politica SELECT por tabla.
WITH esperadas(tabla) AS (
  VALUES ('perfiles'), ('cultivos'), ('nodos'), ('variables'),
         ('nodo_variables'), ('mediciones')
), relaciones AS (
  SELECT tabla, to_regclass('public.' || tabla) AS oid FROM esperadas
)
SELECT r.tabla,
       r.oid IS NOT NULL AS existe,
       c.relrowsecurity AS rls_activado,
       has_table_privilege('authenticated', r.oid, 'SELECT') AS lectura_autenticada,
       (has_table_privilege('authenticated', r.oid, 'INSERT')
        OR has_table_privilege('authenticated', r.oid, 'UPDATE')
        OR has_table_privilege('authenticated', r.oid, 'DELETE')
        OR has_table_privilege('authenticated', r.oid, 'TRUNCATE')) AS escritura_cliente,
       (has_table_privilege('anon', r.oid, 'SELECT')
        OR has_table_privilege('anon', r.oid, 'INSERT')
        OR has_table_privilege('anon', r.oid, 'UPDATE')
        OR has_table_privilege('anon', r.oid, 'DELETE')
        OR has_table_privilege('anon', r.oid, 'TRUNCATE')) AS acceso_anonimo,
       (has_table_privilege('service_role', r.oid, 'INSERT')
        OR has_table_privilege('service_role', r.oid, 'UPDATE')
        OR has_table_privilege('service_role', r.oid, 'DELETE')
        OR has_table_privilege('service_role', r.oid, 'TRUNCATE')) AS escritura_servidor_directa,
       (SELECT count(*) FROM pg_catalog.pg_policies p
        WHERE p.schemaname = 'public' AND p.tablename = r.tabla
          AND p.cmd = 'SELECT') AS politicas_select
FROM relaciones r
LEFT JOIN pg_catalog.pg_class c ON c.oid = r.oid
ORDER BY r.tabla;
