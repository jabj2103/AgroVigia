-- Ejecutar TODO como postgres. Solo fixtures transitorios, no toca el ESP32 real.
BEGIN;
DO $$
DECLARE usuario uuid:='3611e8b0-13ba-45ec-a66f-b066315a7341'; otro uuid:='f11baaf9-0461-4b73-94d6-d8eff18c6fa8';
 a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); n uuid:=gen_random_uuid(); n2 uuid:=gen_random_uuid(); n3 uuid:=gen_random_uuid();
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=usuario) THEN RAISE EXCEPTION 'Falta perfil propietario'; END IF;
 INSERT INTO public.perfiles(id,nombre) VALUES(otro,'Fixture temporal') ON CONFLICT(id) DO NOTHING;
 INSERT INTO public.cultivos(id,agricultor_id,nombre,tipo,area,unidad_area,solicitud_id) VALUES
 (a,usuario,'Fixture A','Prueba',1,'m2',gen_random_uuid()),(b,usuario,'Fixture B','Prueba',1,'m2',gen_random_uuid()),(c,otro,'Fixture ajeno','Prueba',1,'m2',gen_random_uuid());
 INSERT INTO public.nodos(id,codigo,agricultor_id,cultivo_id) VALUES
 (n,'prueba-'||n,usuario,a),(n2,'prueba-'||n2,usuario,b),(n3,'prueba-'||n3,usuario,b);
 INSERT INTO public.nodo_variables VALUES(n,'temperatura_aire','DHT22');
 INSERT INTO public.mediciones(cultivo_id,nodo_id,variable_codigo,mensaje_id,valor,tomada_en,recibida_en,origen)
 VALUES(a,n,'temperatura_aire',gen_random_uuid()::text,25,clock_timestamp(),clock_timestamp(),'simulado');
 PERFORM set_config('agv.a',a::text,true); PERFORM set_config('agv.b',b::text,true); PERFORM set_config('agv.c',c::text,true); PERFORM set_config('agv.n',n::text,true);
 PERFORM set_config('agv.n3',n3::text,true);
 PERFORM set_config('request.jwt.claim.sub',usuario::text,true);
 IF has_function_privilege('anon','public.vincular_nodo(uuid,uuid)','EXECUTE') OR has_function_privilege('service_role','public.desvincular_nodo(uuid,uuid)','EXECUTE')
 OR has_table_privilege('authenticated','public.nodo_asignaciones','INSERT') THEN RAISE EXCEPTION 'Permisos excesivos'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE a uuid:=current_setting('agv.a')::uuid; b uuid:=current_setting('agv.b')::uuid; c uuid:=current_setting('agv.c')::uuid; n uuid:=current_setting('agv.n')::uuid;
 contador bigint; r public.nodos;
BEGIN
 SELECT count(*) INTO contador FROM public.nodo_asignaciones WHERE nodo_id=n;
 PERFORM public.vincular_nodo(n,a);
 IF (SELECT count(*) FROM public.nodo_asignaciones WHERE nodo_id=n)<>contador THEN RAISE EXCEPTION 'Reintento duplico auditoria'; END IF;
 BEGIN PERFORM public.vincular_nodo(n,b); RAISE EXCEPTION 'Movio nodo ocupado'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.desvincular_nodo(n,b); RAISE EXCEPTION 'Desvinculo asignacion distinta'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.vincular_nodo(n,c); RAISE EXCEPTION 'Acceso a cultivo ajeno'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM public.desvincular_nodo(n,a); PERFORM public.desvincular_nodo(n,a);
 IF (SELECT count(*) FROM public.nodo_asignaciones WHERE nodo_id=n)<>contador+1 THEN RAISE EXCEPTION 'Desvinculacion no idempotente'; END IF;
 BEGIN PERFORM public.vincular_nodo(n,b); RAISE EXCEPTION 'Supero dos nodos'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 PERFORM public.desvincular_nodo(current_setting('agv.n3')::uuid,b);
 SELECT * INTO r FROM public.vincular_nodo(n,b);
 IF r.cultivo_id<>b THEN RAISE EXCEPTION 'Vinculo incorrecto'; END IF;
 BEGIN PERFORM public.desvincular_nodo(n,a); RAISE EXCEPTION 'Reintento viejo desvinculo nueva asignacion'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 IF NOT EXISTS(SELECT 1 FROM public.mediciones WHERE nodo_id=n AND cultivo_id=a) OR EXISTS(SELECT 1 FROM public.mediciones WHERE nodo_id=n AND cultivo_id=b) THEN RAISE EXCEPTION 'Historia alterada'; END IF;
 IF (SELECT count(*) FROM public.nodo_asignaciones WHERE nodo_id=n)<>contador+2 THEN RAISE EXCEPTION 'Auditoria incorrecta'; END IF;
 PERFORM set_config('request.jwt.claim.sub','f11baaf9-0461-4b73-94d6-d8eff18c6fa8',true);
 IF EXISTS(SELECT 1 FROM public.nodo_asignaciones WHERE nodo_id=n) THEN RAISE EXCEPTION 'Fuga auditoria'; END IF;
 BEGIN PERFORM public.desvincular_nodo(n,b); RAISE EXCEPTION 'Otra cuenta desvinculo'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.vincular_nodo(n,c); RAISE EXCEPTION 'Otra cuenta vinculo nodo ajeno'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub','3611e8b0-13ba-45ec-a66f-b066315a7341',true);
 PERFORM public.archivar_cultivo(b);
 IF NOT EXISTS(SELECT 1 FROM public.nodo_asignaciones WHERE nodo_id=n AND cultivo_anterior_id=b AND cultivo_nuevo_id IS NULL) THEN RAISE EXCEPTION 'Archivo sin auditoria'; END IF;
 BEGIN PERFORM public.vincular_nodo(n,b); RAISE EXCEPTION 'Vinculo a archivado'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE;
DO $$
DECLARE n uuid:=current_setting('agv.n')::uuid;
BEGIN
 UPDATE public.nodos SET habilitado=false WHERE id=n;
END $$;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
 BEGIN PERFORM public.vincular_nodo(current_setting('agv.n')::uuid,current_setting('agv.a')::uuid);
 RAISE EXCEPTION 'Vinculo deshabilitado'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'OK: permisos, vinculos, reintentos, limite de dos, aislamiento, historial y auditoria. Prueba revertida.' AS resultado;
