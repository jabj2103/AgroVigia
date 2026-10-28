-- Ejecutar completo en SQL Editor, con rol administrativo, despues de la base.
-- Cuenta creada por Juan en Auth. No crea usuarios ni mediciones.
-- Cultivo y area son datos de DEMOSTRACION, no una parcela real confirmada.
-- Repetir conserva registros; cualquier vinculo distinto aborta sin reasignar.
BEGIN;

DO $$
DECLARE
  cuenta CONSTANT uuid := '3611e8b0-13ba-45ec-a66f-b066315a7341';
  solicitud CONSTANT uuid := 'b8aff795-b68e-4559-99c8-e596d567e677';
  cultivo uuid;
  nodo public.nodos%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = cuenta) THEN
    RAISE EXCEPTION 'No existe el UID indicado en Auth. No se creo ningun registro.';
  END IF;

  IF (SELECT count(*) FROM public.variables
      WHERE (codigo = 'temperatura_aire' AND unidad = chr(176) || 'C'
             AND valor_min = -40 AND valor_max = 80)
         OR (codigo = 'humedad_aire' AND unidad = '% HR'
             AND valor_min = 0 AND valor_max = 100)) <> 2 THEN
    RAISE EXCEPTION 'El catalogo no coincide con el contrato DHT22. Revisar antes de continuar.';
  END IF;

  INSERT INTO public.perfiles (id, nombre)
  VALUES (cuenta, 'Juan Bustos')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.cultivos
    (agricultor_id, nombre, tipo, area, unidad_area, solicitud_id)
  VALUES
    (cuenta, 'Cultivo de demostracion', 'Demostracion sin especie definida',
     1, 'm2', solicitud)
  ON CONFLICT (agricultor_id, solicitud_id) DO NOTHING;

  SELECT id INTO STRICT cultivo FROM public.cultivos
  WHERE agricultor_id = cuenta AND solicitud_id = solicitud;

  INSERT INTO public.nodos (codigo, agricultor_id, cultivo_id, habilitado)
  VALUES ('agv-dht22-01', cuenta, cultivo, true)
  ON CONFLICT (codigo) DO NOTHING;

  SELECT * INTO STRICT nodo FROM public.nodos
  WHERE codigo = 'agv-dht22-01' FOR UPDATE;

  IF nodo.agricultor_id IS DISTINCT FROM cuenta
     OR nodo.cultivo_id IS DISTINCT FROM cultivo
     OR nodo.habilitado IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'El DHT22 ya tiene otra cuenta, vinculo o estado. No se reasigno.';
  END IF;

  INSERT INTO public.nodo_variables (nodo_id, variable_codigo, sensor_modelo)
  VALUES (nodo.id, 'temperatura_aire', 'DHT22'),
         (nodo.id, 'humedad_aire', 'DHT22')
  ON CONFLICT (nodo_id, variable_codigo) DO NOTHING;

  IF (SELECT count(*) FROM public.nodo_variables WHERE nodo_id = nodo.id) <> 2
     OR (SELECT count(*) FROM public.nodo_variables
         WHERE nodo_id = nodo.id AND sensor_modelo = 'DHT22'
           AND variable_codigo IN ('temperatura_aire', 'humedad_aire')) <> 2 THEN
    RAISE EXCEPTION 'Las capacidades existentes del nodo no corresponden al DHT22.';
  END IF;
END;
$$;

COMMIT;

-- Resultado esperado: dos filas, mismo perfil/cultivo/nodo, habilitado true.
-- Esta consulta administrativa no prueba aislamiento RLS entre usuarios.
SELECT p.nombre AS perfil, c.nombre AS cultivo, c.tipo, c.area, c.unidad_area,
       n.codigo AS nodo, n.habilitado, nv.variable_codigo, v.unidad,
       nv.sensor_modelo
FROM public.perfiles p
JOIN public.cultivos c ON c.agricultor_id = p.id
JOIN public.nodos n ON n.cultivo_id = c.id AND n.agricultor_id = p.id
JOIN public.nodo_variables nv ON nv.nodo_id = n.id
JOIN public.variables v ON v.codigo = nv.variable_codigo
WHERE p.id = '3611e8b0-13ba-45ec-a66f-b066315a7341'
  AND c.solicitud_id = 'b8aff795-b68e-4559-99c8-e596d567e677'
  AND n.codigo = 'agv-dht22-01'
ORDER BY nv.variable_codigo;
