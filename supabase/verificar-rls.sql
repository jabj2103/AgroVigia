-- Ejecutar TODO en SQL Editor con el rol administrativo habitual.
-- Prueba SQL de RLS y privilegios; no prueba login, JWT firmado ni API web.
-- Inserta DOS valores SIMULADOS sin commit, comprueba acceso y revierte TODO.
-- No ejecutar fragmentos. Ante error, conservar mensaje y ejecutar ROLLBACK;
-- antes de continuar. No desactivar RLS ni usar service_role para las lecturas.
BEGIN;

DO $$
DECLARE
  propietario CONSTANT uuid := '3611e8b0-13ba-45ec-a66f-b066315a7341';
  otra_cuenta CONSTANT uuid := 'f11baaf9-0461-4b73-94d6-d8eff18c6fa8';
  nodo public.nodos%ROWTYPE;
  mensaje text := gen_random_uuid()::text;
  tabla text;
BEGIN
  IF (SELECT count(*) FROM auth.users
      WHERE id IN (propietario, otra_cuenta)) <> 2 THEN
    RAISE EXCEPTION 'Deben existir las dos cuentas indicadas en Auth.';
  END IF;

  FOREACH tabla IN ARRAY ARRAY[
    'perfiles','cultivos','nodos','variables','nodo_variables','mediciones'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c
                   WHERE c.oid = to_regclass('public.' || tabla)
                     AND c.relrowsecurity) THEN
      RAISE EXCEPTION 'Falta tabla o RLS en %', tabla;
    END IF;
    IF (SELECT count(*) FROM pg_catalog.pg_policies p
        WHERE p.schemaname = 'public' AND p.tablename = tabla
          AND p.cmd = 'SELECT') <> 1 THEN
      RAISE EXCEPTION 'Se esperaba una politica SELECT en %', tabla;
    END IF;
    IF has_table_privilege('service_role', 'public.' || tabla, 'INSERT')
       OR has_table_privilege('service_role', 'public.' || tabla, 'UPDATE')
       OR has_table_privilege('service_role', 'public.' || tabla, 'DELETE')
       OR has_table_privilege('service_role', 'public.' || tabla, 'TRUNCATE') THEN
      RAISE EXCEPTION 'Escritura directa de servidor no prevista en %', tabla;
    END IF;
  END LOOP;

  SELECT * INTO STRICT nodo FROM public.nodos
  WHERE codigo = 'agv-dht22-01' FOR SHARE;
  IF nodo.agricultor_id IS DISTINCT FROM propietario
     OR nodo.cultivo_id IS NULL OR NOT nodo.habilitado THEN
    RAISE EXCEPTION 'Falta el vinculo habilitado del DHT22 con Juan.';
  END IF;

  PERFORM set_config('agrovigia.prueba_nodo', nodo.id::text, true);
  PERFORM set_config('agrovigia.prueba_cultivo', nodo.cultivo_id::text, true);
  PERFORM set_config('agrovigia.prueba_mensaje', mensaje, true);

  -- Fixture temporal: nunca se presenta como una captura fisica.
  INSERT INTO public.mediciones
    (cultivo_id,nodo_id,variable_codigo,mensaje_id,valor,tomada_en,recibida_en,origen)
  VALUES
    (nodo.cultivo_id,nodo.id,'temperatura_aire',mensaje,25,now(),now(),'simulado'),
    (nodo.cultivo_id,nodo.id,'humedad_aire',mensaje,60,now(),now(),'simulado');
END;
$$;

-- A: rol sin privilegios administrativos, con identidad del propietario.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '3611e8b0-13ba-45ec-a66f-b066315a7341';
SET LOCAL request.jwt.claims = '{"sub":"3611e8b0-13ba-45ec-a66f-b066315a7341","role":"authenticated"}';

DO $$
DECLARE tabla text;
BEGIN
  IF current_user <> 'authenticated'
     OR auth.uid() IS DISTINCT FROM '3611e8b0-13ba-45ec-a66f-b066315a7341'::uuid
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles
                WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'No se esta probando como propietario bajo RLS.';
  END IF;
  IF (SELECT count(*) FROM public.perfiles WHERE id = auth.uid()) <> 1
     OR (SELECT count(*) FROM public.cultivos
         WHERE id = current_setting('agrovigia.prueba_cultivo')::uuid) <> 1
     OR (SELECT count(*) FROM public.nodos
         WHERE id = current_setting('agrovigia.prueba_nodo')::uuid) <> 1
     OR (SELECT count(*) FROM public.nodo_variables
         WHERE nodo_id = current_setting('agrovigia.prueba_nodo')::uuid) <> 2
     OR (SELECT count(*) FROM public.mediciones
         WHERE nodo_id = current_setting('agrovigia.prueba_nodo')::uuid
           AND mensaje_id = current_setting('agrovigia.prueba_mensaje')
           AND origen = 'simulado') <> 2 THEN
    RAISE EXCEPTION 'Juan no puede leer todos sus datos de prueba.';
  END IF;
  IF (SELECT count(*) FROM public.variables
      WHERE codigo IN ('temperatura_aire','humedad_aire','iluminacion_relativa')) <> 3 THEN
    RAISE EXCEPTION 'Catalogo no visible para Juan.';
  END IF;

  FOREACH tabla IN ARRAY ARRAY[
    'perfiles','cultivos','nodos','variables','nodo_variables','mediciones'
  ] LOOP
    IF has_table_privilege(current_user, 'public.' || tabla, 'INSERT')
       OR has_table_privilege(current_user, 'public.' || tabla, 'UPDATE')
       OR has_table_privilege(current_user, 'public.' || tabla, 'DELETE')
       OR has_table_privilege(current_user, 'public.' || tabla, 'TRUNCATE') THEN
      RAISE EXCEPTION 'Escritura de cliente no prevista en %', tabla;
    END IF;
  END LOOP;
END;
$$;

-- B: mismo rol, otra identidad Auth. No recibe perfil/cultivo/nodo propios.
SET LOCAL request.jwt.claim.sub = 'f11baaf9-0461-4b73-94d6-d8eff18c6fa8';
SET LOCAL request.jwt.claims = '{"sub":"f11baaf9-0461-4b73-94d6-d8eff18c6fa8","role":"authenticated"}';

DO $$
BEGIN
  IF current_user <> 'authenticated'
     OR auth.uid() IS DISTINCT FROM 'f11baaf9-0461-4b73-94d6-d8eff18c6fa8'::uuid THEN
    RAISE EXCEPTION 'La identidad de la segunda cuenta no se aplico.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.perfiles
             WHERE id = '3611e8b0-13ba-45ec-a66f-b066315a7341')
     OR EXISTS (SELECT 1 FROM public.cultivos
                WHERE id = current_setting('agrovigia.prueba_cultivo')::uuid)
     OR EXISTS (SELECT 1 FROM public.nodos
                WHERE id = current_setting('agrovigia.prueba_nodo')::uuid)
     OR EXISTS (SELECT 1 FROM public.nodo_variables
                WHERE nodo_id = current_setting('agrovigia.prueba_nodo')::uuid)
     OR EXISTS (SELECT 1 FROM public.mediciones
                WHERE nodo_id = current_setting('agrovigia.prueba_nodo')::uuid
                  AND mensaje_id = current_setting('agrovigia.prueba_mensaje')) THEN
    RAISE EXCEPTION 'Fallo de aislamiento: la segunda cuenta ve datos de Juan.';
  END IF;
  IF (SELECT count(*) FROM public.variables
      WHERE codigo IN ('temperatura_aire','humedad_aire','iluminacion_relativa')) <> 3 THEN
    RAISE EXCEPTION 'La segunda cuenta debe poder leer el catalogo compartido.';
  END IF;
END;
$$;

-- C: sin sesion. Comprobar denegacion SELECT real en cada tabla.
RESET ROLE;
SET LOCAL ROLE anon;
SET LOCAL request.jwt.claim.sub = '';
SET LOCAL request.jwt.claims = '{}';

DO $$
DECLARE tabla text;
BEGIN
  IF current_user <> 'anon' OR auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'No se esta probando acceso anonimo.';
  END IF;
  FOREACH tabla IN ARRAY ARRAY[
    'perfiles','cultivos','nodos','variables','nodo_variables','mediciones'
  ] LOOP
    BEGIN
      EXECUTE format('SELECT 1 FROM public.%I LIMIT 1', tabla);
      RAISE EXCEPTION 'Acceso anonimo indebidamente permitido en %', tabla;
    EXCEPTION WHEN insufficient_privilege THEN
      -- Rechazo esperado. Cualquier otro error se propaga.
      NULL;
    END;
    IF has_table_privilege(current_user, 'public.' || tabla, 'INSERT')
       OR has_table_privilege(current_user, 'public.' || tabla, 'UPDATE')
       OR has_table_privilege(current_user, 'public.' || tabla, 'DELETE')
       OR has_table_privilege(current_user, 'public.' || tabla, 'TRUNCATE') THEN
      RAISE EXCEPTION 'Escritura anonima indebidamente concedida en %', tabla;
    END IF;
  END LOOP;
END;
$$;

RESET ROLE;
-- Revierte las dos mediciones de prueba y los ajustes locales de identidad.
ROLLBACK;

-- Este resumen solo acredita la prueba si se ejecuto TODO sin errores.
SELECT 'Propietario: lectura de sus datos' AS comprobacion, 'OK' AS resultado
UNION ALL SELECT 'Segunda cuenta: datos de Juan ocultos', 'OK'
UNION ALL SELECT 'Catalogo: compartido entre cuentas autenticadas', 'OK'
UNION ALL SELECT 'Anonimo: lectura rechazada en las seis tablas', 'OK'
UNION ALL SELECT 'Escrituras directas: sin permisos previstos', 'OK'
UNION ALL SELECT 'Mediciones simuladas de prueba: revertidas', 'OK';
