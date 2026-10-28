-- Ejecutar TODO con postgres DESPUES de 0003 y sus pruebas.
-- 0003 conserva compatibilidad DHT22 v1; esta alta no crea mediciones.
BEGIN;
DO $$
DECLARE n public.nodos%ROWTYPE;
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Usar rol postgres.'; END IF;
  PERFORM 'public.registrar_lote_ambiental(text,text,timestamptz,boolean,boolean,boolean)'::regprocedure;
  SELECT * INTO STRICT n FROM public.nodos WHERE codigo='agv-dht22-01' FOR UPDATE;
  IF n.agricultor_id IS DISTINCT FROM '3611e8b0-13ba-45ec-a66f-b066315a7341'::uuid
     OR n.cultivo_id IS DISTINCT FROM '52ea4628-c470-48f4-a09a-0f9a697d22b4'::uuid
     OR NOT n.habilitado THEN RAISE EXCEPTION 'Nodo/cuenta/cultivo distintos. No se reasigna.'; END IF;
  IF (SELECT count(*) FROM public.nodo_variables WHERE nodo_id=n.id
      AND variable_codigo IN ('temperatura_aire','humedad_aire') AND sensor_modelo='DHT22') <> 2
     OR EXISTS (SELECT 1 FROM public.nodo_variables WHERE nodo_id=n.id
                AND variable_codigo NOT IN ('temperatura_aire','humedad_aire','iluminacion_relativa')) THEN
    RAISE EXCEPTION 'Capacidades inesperadas.';
  END IF;
  INSERT INTO public.nodo_variables (nodo_id,variable_codigo,sensor_modelo)
  VALUES (n.id,'iluminacion_relativa','LDR') ON CONFLICT DO NOTHING;
  IF (SELECT count(*) FROM public.nodo_variables WHERE nodo_id=n.id) <> 3
     OR NOT EXISTS (SELECT 1 FROM public.nodo_variables WHERE nodo_id=n.id
                    AND variable_codigo='iluminacion_relativa' AND sensor_modelo='LDR') THEN
    RAISE EXCEPTION 'Capacidad LDR no coincide.';
  END IF;
END; $$;
COMMIT;
SELECT n.codigo,nv.variable_codigo,nv.sensor_modelo,v.unidad
FROM public.nodos n JOIN public.nodo_variables nv ON nv.nodo_id=n.id
JOIN public.variables v ON v.codigo=nv.variable_codigo WHERE n.codigo='agv-dht22-01'
ORDER BY nv.variable_codigo;