-- SOLO LECTURA. Ejecutar antes de aplicar 0007/0008 en el proyecto elegido.
-- Detecta nombres/columnas existentes; no certifica que el companero no haya
-- modificado el cuerpo de funciones anteriores. No devuelve claves ni datos personales.
WITH estado AS (
 SELECT
  (SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'
   AND table_name IN ('perfiles','cultivos','nodos','variables','nodo_variables','mediciones','nodo_asignaciones','reglas_alerta','alertas','alerta_cursores')) AS tablas_base,
  (SELECT count(*)::int FROM (VALUES
   (to_regprocedure('public.registrar_lote_ambiental(text,text,timestamptz,boolean,boolean,boolean)')),
   (to_regprocedure('public.configurar_regla_alerta(uuid,text,numeric,numeric,text)')),
   (to_regprocedure('public.vincular_nodo(uuid,uuid)')),
   (to_regprocedure('public.archivar_cultivo(uuid)'))) f(id) WHERE id IS NOT NULL) AS funciones_base,
  to_regclass('public.zonas') IS NOT NULL AS tabla_zonas,
  (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND (
   (table_name='nodos' AND column_name IN ('tipo_nodo','zona_id','posicion_x','posicion_y','asignacion_version')) OR
   (table_name='mediciones' AND column_name IN ('zona_id','zona_contexto')) OR
   (table_name='nodo_asignaciones' AND column_name IN ('zona_anterior_id','zona_nueva_id','asignacion_version')))) AS columnas_zonas,
  (SELECT count(*)::int FROM public.variables WHERE codigo IN
   ('radiacion_solar','humedad_suelo_vwc','temperatura_suelo','ph_suelo','conductividad_suelo_ece','precipitacion_60min','velocidad_viento')) AS variables_nuevas,
  (SELECT count(*)::int FROM (VALUES
   (to_regprocedure('public.configurar_zona(uuid,text,text,numeric,numeric,numeric,numeric)')),
   (to_regprocedure('public.asignar_zona_nodo(uuid,uuid,numeric,numeric)')),
   (to_regprocedure('public.registrar_lote_simulado_v3(text,text,timestamptz,boolean,boolean,boolean)'))) f(id) WHERE id IS NOT NULL) AS rpc_nuevas
)
SELECT CASE
 WHEN tablas_base<>10 OR funciones_base<>4 THEN 'REVISAR_BASE'
 WHEN NOT tabla_zonas AND columnas_zonas=0 AND variables_nuevas=0 AND rpc_nuevas=0 THEN 'ESQUEMA_PREVIO_DETECTADO'
 WHEN tabla_zonas AND columnas_zonas=10 AND variables_nuevas=7 AND rpc_nuevas=3 THEN 'AMPLIACION_PRESENTE'
 ELSE 'REVISAR_AMPLIACION_PARCIAL_O_CAMBIOS'
 END AS estado,* FROM estado;
