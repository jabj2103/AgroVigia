-- Ejecutar TODO como postgres. Fixtures SIMULADOS y rollback; nunca cambia nodo real.
BEGIN;
DO $$
DECLARE usuario uuid:='3611e8b0-13ba-45ec-a66f-b066315a7341'; c uuid:=gen_random_uuid(); n uuid:=gen_random_uuid();
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=usuario) THEN RAISE EXCEPTION 'Falta perfil de prueba'; END IF;
 INSERT INTO public.cultivos(id,agricultor_id,nombre,tipo,area,unidad_area,solicitud_id) VALUES(c,usuario,'Fixture alertas','Demostracion',1,'m2',gen_random_uuid());
 INSERT INTO public.nodos(id,codigo,agricultor_id,cultivo_id) VALUES(n,'prueba-'||n,usuario,c);
 INSERT INTO public.nodo_variables VALUES(n,'temperatura_aire','DHT22');
 PERFORM set_config('agv.alerta_crop',c::text,true);PERFORM set_config('agv.alerta_node',n::text,true);
 PERFORM set_config('request.jwt.claim.sub',usuario::text,true);
 IF has_function_privilege('authenticated','public.evaluar_alertas_lote(uuid,text)','EXECUTE')
 OR has_function_privilege('anon','public.configurar_regla_alerta(uuid,text,numeric,numeric,text)','EXECUTE')
 OR has_table_privilege('authenticated','public.alertas','UPDATE') OR has_table_privilege('service_role','public.alertas','INSERT') THEN RAISE EXCEPTION 'Permisos excesivos'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE r public.reglas_alerta; otro public.reglas_alerta;
BEGIN
 SELECT * INTO r FROM public.configurar_regla_alerta(current_setting('agv.alerta_crop')::uuid,'temperatura_aire',20,30,'simulado');
 SELECT * INTO otro FROM public.configurar_regla_alerta(r.cultivo_id,r.variable_codigo,20,30,'simulado');
 IF otro.id<>r.id THEN RAISE EXCEPTION 'Configurar mismo limite no es idempotente'; END IF;
 PERFORM set_config('agv.alerta_regla',r.id::text,true);
 PERFORM public.configurar_regla_alerta(r.cultivo_id,r.variable_codigo,20,30,'real');
 BEGIN PERFORM public.configurar_regla_alerta(r.cultivo_id,r.variable_codigo,40,30,'simulado'); RAISE EXCEPTION 'Acepto limites cruzados'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.configurar_regla_alerta(r.cultivo_id,'humedad_aire',-1,50,'real'); RAISE EXCEPTION 'Acepto humedad negativa'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE;
-- Funcion temporal de fixture: no se instala como parte de la migracion.
CREATE FUNCTION pg_temp.medicion_alerta(valor numeric, segundos integer) RETURNS text LANGUAGE plpgsql AS $$
DECLARE mensaje text:=gen_random_uuid()::text;
BEGIN
 INSERT INTO public.mediciones(cultivo_id,nodo_id,variable_codigo,mensaje_id,valor,tomada_en,recibida_en,origen)
 VALUES(current_setting('agv.alerta_crop')::uuid,current_setting('agv.alerta_node')::uuid,'temperatura_aire',mensaje,valor,clock_timestamp()-make_interval(secs=>segundos),clock_timestamp(),'simulado');
 RETURN mensaje;
END; $$;
DO $$
DECLARE mensaje text; r jsonb; a public.alertas; n uuid:=current_setting('agv.alerta_node')::uuid; inicio uuid;
BEGIN
 mensaje:=pg_temp.medicion_alerta(31,120);
 SET LOCAL ROLE service_role;
 r:=public.evaluar_alertas_lote(n,mensaje);
 RESET ROLE;
 IF (r->>'abiertas')::int<>1 THEN RAISE EXCEPTION 'No abrio episodio: %',r; END IF;
 SELECT * INTO a FROM public.alertas WHERE nodo_id=n; inicio:=a.id;
 IF a.origen<>'simulado' OR a.umbral<>30 THEN RAISE EXCEPTION 'Mezclo origen/umbral'; END IF;
 SET LOCAL ROLE service_role; r:=public.evaluar_alertas_lote(n,mensaje); RESET ROLE;
 IF (r->>'evaluadas')::int<>0 THEN RAISE EXCEPTION 'Reproceso duplicado'; END IF;
 SET LOCAL ROLE authenticated;
 PERFORM public.revisar_alerta(inicio); PERFORM public.revisar_alerta(inicio);
 RESET ROLE;
 IF NOT EXISTS(SELECT 1 FROM public.alertas WHERE id=inicio AND revisada_en IS NOT NULL AND cerrada_en IS NULL) THEN RAISE EXCEPTION 'Revision cerro condicion'; END IF;
 mensaje:=pg_temp.medicion_alerta(32,110);
 SET LOCAL ROLE service_role; r:=public.evaluar_alertas_lote(n,mensaje); RESET ROLE;
 IF (r->>'actualizadas')::int<>1 OR (SELECT count(*) FROM public.alertas WHERE nodo_id=n)<>1 THEN RAISE EXCEPTION 'Duplico episodio abierto'; END IF;
 mensaje:=pg_temp.medicion_alerta(30,100);
 SET LOCAL ROLE service_role; r:=public.evaluar_alertas_lote(n,mensaje); RESET ROLE;
 IF (r->>'cerradas')::int<>1 OR NOT EXISTS(SELECT 1 FROM public.alertas WHERE id=inicio AND motivo_cierre='dentro_de_rango' AND medicion_cierre_id IS NOT NULL) THEN RAISE EXCEPTION 'No cerro en limite incluido'; END IF;
 mensaje:=pg_temp.medicion_alerta(35,115);
 SET LOCAL ROLE service_role; r:=public.evaluar_alertas_lote(n,mensaje); RESET ROLE;
 IF (r->>'evaluadas')::int<>0 THEN RAISE EXCEPTION 'Acepto lectura fuera de orden'; END IF;
 mensaje:=pg_temp.medicion_alerta(35,90);
 SET LOCAL ROLE service_role; r:=public.evaluar_alertas_lote(n,mensaje); RESET ROLE;
 IF (r->>'abiertas')::int<>1 THEN RAISE EXCEPTION 'No reabrio nuevo episodio'; END IF;
 mensaje:=pg_temp.medicion_alerta(19,80);
 SET LOCAL ROLE service_role; r:=public.evaluar_alertas_lote(n,mensaje); RESET ROLE;
 IF (r->>'abiertas')::int<>1 OR (r->>'cerradas')::int<>1 THEN RAISE EXCEPTION 'Cambio de extremo incorrecto'; END IF;
 mensaje:=pg_temp.medicion_alerta(25,250);
 SET LOCAL ROLE service_role; r:=public.evaluar_alertas_lote(n,mensaje); RESET ROLE;
 IF (r->>'evaluadas')::int<>0 OR NOT EXISTS(SELECT 1 FROM public.alertas WHERE nodo_id=n AND cerrada_en IS NULL) THEN RAISE EXCEPTION 'Datos viejos cerraron condicion'; END IF;
 PERFORM set_config('agv.alerta_id',inicio::text,true);
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE regla uuid:=current_setting('agv.alerta_regla')::uuid; nueva public.reglas_alerta;
BEGIN
 PERFORM set_config('request.jwt.claim.sub','f11baaf9-0461-4b73-94d6-d8eff18c6fa8',true);
 IF EXISTS(SELECT 1 FROM public.alertas WHERE nodo_id=current_setting('agv.alerta_node')::uuid) OR EXISTS(SELECT 1 FROM public.reglas_alerta WHERE id=regla) THEN RAISE EXCEPTION 'Fuga RLS'; END IF;
 BEGIN PERFORM public.revisar_alerta(current_setting('agv.alerta_id')::uuid); RAISE EXCEPTION 'Otra cuenta reviso'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.desactivar_regla_alerta(regla); RAISE EXCEPTION 'Otra cuenta desactivo'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.configurar_regla_alerta(current_setting('agv.alerta_crop')::uuid,'temperatura_aire',NULL,35); RAISE EXCEPTION 'Otra cuenta configuro'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub','3611e8b0-13ba-45ec-a66f-b066315a7341',true);
 SELECT * INTO nueva FROM public.configurar_regla_alerta(current_setting('agv.alerta_crop')::uuid,'temperatura_aire',21,31,'simulado');
 IF nueva.id=regla OR EXISTS(SELECT 1 FROM public.alertas WHERE regla_id=regla AND cerrada_en IS NULL) THEN RAISE EXCEPTION 'Reemplazo no preservo version/cerro episodios'; END IF;
 PERFORM public.desactivar_regla_alerta(nueva.id);PERFORM public.desactivar_regla_alerta(nueva.id);
 PERFORM set_config('agv.alerta_regla_nueva',nueva.id::text,true);

END $$;
RESET ROLE;
-- Desvinculacion cierra por cambio de contexto, sin fingir recuperacion ambiental.
DO $$
DECLARE mensaje text; r jsonb; nueva public.reglas_alerta;
BEGIN
 SET LOCAL ROLE authenticated;
 SELECT * INTO nueva FROM public.configurar_regla_alerta(current_setting('agv.alerta_crop')::uuid,'temperatura_aire',NULL,30,'simulado');
 RESET ROLE;
 mensaje:=pg_temp.medicion_alerta(35,60);
 SET LOCAL ROLE service_role; r:=public.evaluar_alertas_lote(current_setting('agv.alerta_node')::uuid,mensaje); RESET ROLE;
 IF (r->>'abiertas')::int<>1 THEN RAISE EXCEPTION 'No abrio para probar desvinculacion'; END IF;
 mensaje:=pg_temp.medicion_alerta(25,-130);
 SET LOCAL ROLE service_role; r:=public.evaluar_alertas_lote(current_setting('agv.alerta_node')::uuid,mensaje); RESET ROLE;
 IF (r->>'evaluadas')::int<>0 THEN RAISE EXCEPTION 'Acepto futuro excesivo'; END IF;
 SET LOCAL ROLE authenticated;
 PERFORM public.desvincular_nodo(current_setting('agv.alerta_node')::uuid,current_setting('agv.alerta_crop')::uuid);
 RESET ROLE;
 IF NOT EXISTS(SELECT 1 FROM public.alertas WHERE regla_id=nueva.id AND motivo_cierre='nodo_desvinculado') THEN RAISE EXCEPTION 'Desvinculacion no cerro episodio'; END IF;
END $$;
ROLLBACK;
SELECT 'OK: reglas, permisos, episodios, revision independiente, duplicados, orden temporal, aislamiento y rollback. Prueba revertida.' AS resultado;
