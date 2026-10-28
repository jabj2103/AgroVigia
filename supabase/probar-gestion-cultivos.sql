-- PRUEBA TRANSITORIA. Ejecutar TODO, incluido ROLLBACK, como postgres.
-- No usa ni reasigna el ESP32 real. El nodo creado aqui es ficticio y se revierte.
BEGIN;
DO $$
DECLARE usuario uuid := '3611e8b0-13ba-45ec-a66f-b066315a7341'; nodo uuid := gen_random_uuid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.perfiles WHERE id=usuario) THEN
    RAISE EXCEPTION 'Falta el perfil de la cuenta de prueba';
  END IF;
  INSERT INTO public.nodos(id,codigo,agricultor_id) VALUES(nodo,'prueba-sql-'||nodo,usuario);
  PERFORM set_config('agrovigia.prueba_nodo',nodo::text,true);
  PERFORM set_config('request.jwt.claim.sub',usuario::text,true);
  IF has_function_privilege('anon','public.crear_cultivo(text,text,numeric,text,uuid[],uuid)','EXECUTE')
    OR has_function_privilege('service_role','public.archivar_cultivo(uuid)','EXECUTE')
    OR has_table_privilege('authenticated','public.cultivos','INSERT')
    OR has_table_privilege('authenticated','public.nodos','UPDATE') THEN
    RAISE EXCEPTION 'Permisos excesivos';
  END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE nodo uuid := current_setting('agrovigia.prueba_nodo')::uuid;
  solicitud uuid := gen_random_uuid(); cultivo public.cultivos; repetido public.cultivos;
BEGIN
  SELECT * INTO cultivo FROM public.crear_cultivo(' Prueba temporal ','Demostracion',10,'m2',ARRAY[nodo],solicitud);
  IF cultivo.nombre<>'Prueba temporal' OR cultivo.agricultor_id<>auth.uid()
    OR (SELECT cultivo_id FROM public.nodos WHERE id=nodo)<>cultivo.id THEN
    RAISE EXCEPTION 'Creacion o asignacion incorrecta';
  END IF;
  SELECT * INTO repetido FROM public.crear_cultivo('Prueba temporal','Demostracion',10,'m2',ARRAY[nodo],solicitud);
  IF repetido.id<>cultivo.id THEN RAISE EXCEPTION 'Creacion duplicada'; END IF;
  BEGIN
    PERFORM public.crear_cultivo('Otro','Demostracion',10,'m2',ARRAY[nodo],solicitud);
    RAISE EXCEPTION 'Se acepto solicitud en conflicto';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.crear_cultivo('Otro','Demostracion',10,'m2',ARRAY[nodo],gen_random_uuid());
    RAISE EXCEPTION 'Se acepto nodo ocupado';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.crear_cultivo('Sin nodo','Demostracion',10,'m2',ARRAY[]::uuid[],gen_random_uuid());
    RAISE EXCEPTION 'Se acepto cultivo sin nodo';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.editar_cultivo(cultivo.id,'Prueba','Demostracion',0,'m2');
    RAISE EXCEPTION 'Se acepto area cero';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  SELECT * INTO cultivo FROM public.editar_cultivo(cultivo.id,'Prueba editada','Demostracion',20,'m2');
  IF cultivo.nombre<>'Prueba editada' OR cultivo.area<>20 THEN RAISE EXCEPTION 'Edicion incorrecta'; END IF;
  PERFORM set_config('agrovigia.prueba_cultivo',cultivo.id::text,true);
  PERFORM set_config('request.jwt.claim.sub','f11baaf9-0461-4b73-94d6-d8eff18c6fa8',true);
  IF EXISTS(SELECT 1 FROM public.cultivos WHERE id=cultivo.id) THEN RAISE EXCEPTION 'Fuga RLS'; END IF;
  BEGIN
    PERFORM public.editar_cultivo(cultivo.id,'Intrusion','Otro',1,'ha');
    RAISE EXCEPTION 'Otra cuenta edito cultivo';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.archivar_cultivo(cultivo.id);
    RAISE EXCEPTION 'Otra cuenta archivo cultivo';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub','3611e8b0-13ba-45ec-a66f-b066315a7341',true);
  SELECT * INTO cultivo FROM public.archivar_cultivo(cultivo.id);
  IF cultivo.archivado_en IS NULL OR (SELECT cultivo_id FROM public.nodos WHERE id=nodo) IS NOT NULL THEN
    RAISE EXCEPTION 'Archivado no libero nodo';
  END IF;
  SELECT * INTO repetido FROM public.archivar_cultivo(cultivo.id);
  IF repetido.archivado_en<>cultivo.archivado_en THEN RAISE EXCEPTION 'Archivado no idempotente'; END IF;
  BEGIN
    PERFORM public.editar_cultivo(cultivo.id,'Cambio','Otro',1,'ha');
    RAISE EXCEPTION 'Se edito cultivo archivado';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE;
DO $$
BEGIN
  BEGIN
    UPDATE public.nodos SET cultivo_id=current_setting('agrovigia.prueba_cultivo')::uuid
      WHERE id=current_setting('agrovigia.prueba_nodo')::uuid;
    RAISE EXCEPTION 'Se vinculo nodo a cultivo archivado';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
ROLLBACK;
SELECT 'OK: crear y asignar; repeticion y conflictos; validaciones; editar; aislamiento; archivar y liberar; bloqueo archivado. Prueba revertida.' AS resultado;
