import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {crearZonas,crearCaptura,VARIABLES} from '../../simulador/public/motor.mjs';
import {prepararCapturaV3,validarMensajeV3} from '../../simulador/contrato-v3.mjs';
const db=new PGlite(),owner=randomUUID(),other=randomUUID(),crop=randomUUID(),crop2=randomUUID(),foreignCrop=randomUUID();
let zona,zona2,virtual,physical;
const sql=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
async function asUser(user,run){await db.exec('SET ROLE authenticated');try{await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user]);return await run();}finally{await db.exec('RESET ROLE');await db.exec("SELECT set_config('request.jwt.claim.sub','',false)");}}
async function mapZone(codigo,x=0,y=0){return await asUser(owner,async()=> (await db.query('SELECT (public.configurar_zona($1,$2,$3,$4,$5,0.45,0.45)).*',[crop,codigo,codigo,x,y])).rows[0]);}
async function nodeNow(){return(await db.query('SELECT * FROM public.nodos WHERE id=$1',[virtual.id])).rows[0];}
async function packet(options={}){
 const n=await nodeNow(),local=crearCaptura(crearZonas()[0],{ejecucion:randomUUID(),...options});
 return prepararCapturaV3(local,{nodo_local:local.nodo_codigo,nodo_codigo:n.codigo,asignacion_version:n.asignacion_version});
}
async function rpc(p,{raw,topico=p.topico,acl=true,retain=null,policy=true,received=null}={}){
 await db.exec('SET ROLE service_role');try{return(await db.query('SELECT public.registrar_lote_simulado_v3($1,$2,coalesce($3::timestamptz,clock_timestamp()),$4,$5,$6) AS r',[topico,raw??JSON.stringify(p.payload),received,acl,retain,policy])).rows[0].r;}finally{await db.exec('RESET ROLE');}
}
before(async()=>{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;`);
 for(const f of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())await db.exec(sql('migrations/'+f));
 for(const [uid,name] of [[owner,'Propietario fixture'],[other,'Otra cuenta fixture']]){await db.query('INSERT INTO auth.users VALUES($1)',[uid]);await db.query('INSERT INTO public.perfiles(id,nombre)VALUES($1,$2)',[uid,name]);}
 for(const [id,uid,name] of [[crop,owner,'Pruebas locales'],[crop2,owner,'Otro cultivo propio'],[foreignCrop,other,'Ajeno']])await db.query("INSERT INTO public.cultivos(id,agricultor_id,nombre,tipo,area,unidad_area,solicitud_id)VALUES($1,$2,$3,'Fixture',1,'m2',$4)",[id,uid,name,randomUUID()]);
 zona=await mapZone('zona-norte');zona2=await mapZone('zona-sur',0.5,0.5);
 virtual=(await db.query("INSERT INTO public.nodos(codigo,agricultor_id,cultivo_id,tipo_nodo)VALUES('sim-fixture-01',$1,$2,'virtual')RETURNING *",[owner,crop])).rows[0];
 physical=(await db.query("INSERT INTO public.nodos(codigo,agricultor_id,cultivo_id)VALUES('agv-fixture-01',$1,$2)RETURNING *",[owner,crop])).rows[0];
 await db.query("INSERT INTO public.nodo_variables(nodo_id,variable_codigo,sensor_modelo)SELECT $1,codigo,'SIMULADOR_V3' FROM public.variables",[virtual.id]);
 await db.query("INSERT INTO public.nodo_variables(nodo_id,variable_codigo,sensor_modelo)SELECT $1,codigo,CASE WHEN codigo='iluminacion_relativa' THEN 'LDR' ELSE 'DHT22' END FROM public.variables WHERE codigo IN('temperatura_aire','humedad_aire','iluminacion_relativa')",[physical.id]);
 await asUser(owner,()=>db.query('SELECT public.asignar_zona_nodo($1,$2,0.3,0.6)',[virtual.id,zona.id]));
});
after(async()=>{await db.close();});

test('mapa normalizado: misma zona idempotente y límites que no aceptan cajas fuera del plano',async()=>{
 assert.equal((await mapZone('zona-norte')).id,zona.id);
 await assert.rejects(asUser(owner,()=>db.query("SELECT public.configurar_zona($1,'fuera','Fuera',0.8,0.8,0.5,0.5)",[crop])),/PLANO_ZONA_INVALIDO/);
 await assert.rejects(asUser(owner,()=>db.query("SELECT public.configurar_zona($1,'precision','Precisión',0.12345,0,0.2,0.2)",[crop])),/PLANO_ZONA_INVALIDO/);
 await assert.rejects(asUser(other,()=>db.query("SELECT public.configurar_zona($1,'ajena','Ajena',0,0,0.5,0.5)",[crop])),/CULTIVO_NO_AUTORIZADO/);
});
test('asignar comprueba cuenta, cultivo y coordenadas; repetir no cambia versión ni duplica auditoría',async()=>{
 const before=await nodeNow(),count=(await db.query('SELECT count(*)::int AS n FROM public.nodo_asignaciones WHERE nodo_id=$1',[virtual.id])).rows[0].n;
 await asUser(owner,()=>db.query('SELECT public.asignar_zona_nodo($1,$2,0.3,0.6)',[virtual.id,zona.id]));
 assert.equal((await nodeNow()).asignacion_version,before.asignacion_version);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM public.nodo_asignaciones WHERE nodo_id=$1',[virtual.id])).rows[0].n,count);
 await assert.rejects(asUser(other,()=>db.query('SELECT public.asignar_zona_nodo($1,$2)',[virtual.id,zona.id])),/NODO_SIN_CULTIVO_AUTORIZADO/);
 await assert.rejects(asUser(owner,()=>db.query('SELECT public.asignar_zona_nodo($1,$2,1.1,0.5)',[virtual.id,zona.id])),/POSICION_NODO_INVALIDA/);
 const otherZone=(await asUser(owner,()=>db.query("SELECT (public.configurar_zona($1,'otra','Otra',0,0,1,1)).*",[crop2]))).rows[0];
 await assert.rejects(asUser(owner,()=>db.query('SELECT public.asignar_zona_nodo($1,$2)',[virtual.id,otherZone.id])),/ZONA_NO_AUTORIZADA/);
});
test('las diez variables y unidades del motor coinciden con el catálogo SQL; RLS y permisos nuevos',async()=>{
 const vars=(await db.query('SELECT * FROM public.variables')).rows;
 for(const v of VARIABLES){const row=vars.find(x=>x.codigo===v.codigo);assert.equal(row.unidad,v.codigo==='ph_suelo'?'sin unidad':v.unidad);assert.equal(Number(row.valor_min),v.min);assert.equal(Number(row.valor_max),v.max);}
 const own=await asUser(owner,()=>db.query('SELECT * FROM public.zonas WHERE cultivo_id=$1',[crop]));assert.equal(own.rows.length,2);
 const hidden=await asUser(other,()=>db.query('SELECT * FROM public.zonas WHERE cultivo_id=$1',[crop]));assert.equal(hidden.rows.length,0);
 await assert.rejects(asUser(owner,()=>db.query('DELETE FROM public.zonas WHERE id=$1',[zona.id])),/permission denied/);
 const p=(await db.query("SELECT has_function_privilege('service_role','public.registrar_lote_simulado_v3(text,text,timestamptz,boolean,boolean,boolean)','EXECUTE') AS servidor,has_function_privilege('authenticated','public.registrar_lote_simulado_v3(text,text,timestamptz,boolean,boolean,boolean)','EXECUTE') AS web,has_table_privilege('service_role','public.mediciones','INSERT') AS directa")).rows[0];
 assert.deepEqual(p,{servidor:true,web:false,directa:false});
 await db.exec('SET ROLE anon');try{await assert.rejects(db.query('SELECT * FROM public.zonas'),/permission denied/);}finally{await db.exec('RESET ROLE');}
});
test('adaptador elimina nombres locales de cultivo/zona del mensaje y conserva origen en cada variable',async()=>{
 const p=await packet();assert.equal(validarMensajeV3(p.payload).version,3);assert.equal(p.payload.origen,'simulado');
 assert.equal('cultivo_id'in p.payload,false);assert.equal('zona_nombre'in p.payload.simulacion,false);assert.equal(p.payload.mediciones.length,10);
 const bad=structuredClone(p.payload);bad.mediciones[0].origen='real';assert.throws(()=>validarMensajeV3(bad));
 const repeat=structuredClone(p.payload);repeat.mediciones[1]=repeat.mediciones[0];assert.throws(()=>validarMensajeV3(repeat));
});
test('ingesta guarda diez filas atómicas con zona histórica, posición, fechas e identidad',async()=>{
 const p=await packet(),r=await rpc(p);assert.equal(r.estado,'insertado');assert.equal(r.medicion_ids.length,10);assert.equal(r.zona_id,zona.id);
 const rows=(await db.query('SELECT * FROM public.mediciones WHERE mensaje_id=$1',[p.payload.mensaje_id])).rows;
 assert.equal(rows.length,10);assert.ok(rows.every(m=>m.origen==='simulado'&&m.zona_id===zona.id&&m.zona_contexto.codigo==='zona-norte'&&m.zona_contexto.posicion_nodo_x===0.3));
 assert.ok(rows.every(m=>m.metadatos.version_payload===3&&m.metadatos.unidad&&m.metadatos.detalle.fuente==='generador_sintetico_v1'));
 assert.equal(new Set(rows.map(m=>String(m.recibida_en))).size,1);
});
test('mismo ID es idempotente incluso con orden diferente; contenido distinto no reescribe',async()=>{
 const p=await packet(),a=await rpc(p);p.payload.mediciones.reverse();const b=await rpc(p);
 assert.equal(b.estado,'duplicado');assert.deepEqual(b.medicion_ids,a.medicion_ids);assert.equal(b.recibida_en,a.recibida_en);
 p.payload.mediciones.find(m=>m.variable_codigo==='ph_suelo').valor=4.1;assert.equal((await rpc(p)).estado,'conflicto_id');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM public.mediciones WHERE mensaje_id=$1',[p.payload.mensaje_id])).rows[0].n,10);
});
test('mover nodo cambia versión, rechaza mensaje en vuelo y conserva originales y duplicados',async()=>{
 const saved=await packet(),stored=await rpc(saved),pending=await packet(),old=await nodeNow();
 await asUser(owner,()=>db.query('SELECT public.asignar_zona_nodo($1,$2,0.8,0.2)',[virtual.id,zona2.id]));assert.notEqual((await nodeNow()).asignacion_version,old.asignacion_version);
 assert.equal((await rpc(pending)).codigo,'ASIGNACION_CAMBIO');const duplicate=await rpc(saved);assert.equal(duplicate.estado,'duplicado');assert.equal(duplicate.zona_id,zona.id);assert.deepEqual(duplicate.medicion_ids,stored.medicion_ids);
 assert.equal((await rpc(await packet())).zona_id,zona2.id);
 assert.equal((await db.query('SELECT zona_id,zona_contexto FROM public.mediciones WHERE mensaje_id=$1 LIMIT 1',[saved.payload.mensaje_id])).rows[0].zona_contexto.codigo,'zona-norte');
 const audit=(await db.query('SELECT * FROM public.nodo_asignaciones WHERE nodo_id=$1 ORDER BY realizado_en DESC LIMIT 1',[virtual.id])).rows[0];assert.equal(audit.zona_anterior_id,zona.id);assert.equal(audit.zona_nueva_id,zona2.id);
});
test('duplicado guardado reconoce recepción antigua; lote nuevo no acepta recepción o captura caducada',async()=>{
 const p=await packet();await rpc(p);assert.equal((await rpc(p,{received:new Date(Date.now()-3600000).toISOString()})).estado,'duplicado');
 assert.equal((await rpc(await packet(),{received:new Date(Date.now()-3600000).toISOString()})).codigo,'FECHA_RECEPCION');
 assert.equal((await rpc(await packet({fecha:new Date(Date.now()-3600000)}))).codigo,'VENTANA_TEMPORAL');
});
test('rechaza origen/ACL/retain/tópico y no deja filas parciales',async()=>{
 const p=await packet();
 for(const [opts,code] of [[{acl:false},'ORIGEN_NO_VERIFICADO'],[{retain:true},'RETAIN_NO_ADMITIDO'],[{policy:false},'RETAIN_NO_VERIFICADO'],[{topico:p.topico.replace('/simulado/','/real/')},'TOPICO_NO_COINCIDE']])assert.equal((await rpc(p,opts)).codigo,code);
 p.payload.origen='real';assert.equal((await rpc(p)).estado,'rechazado');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM public.mediciones WHERE mensaje_id=$1',[p.payload.mensaje_id])).rows[0].n,0);
});
test('valida campos duplicados, perfil incompleto, unidades, precisión y metadatos químicos/lluvia',async()=>{
 const base=await packet();const dup=base.mensaje.replace('"version":3','"version":3,"version":3');assert.equal((await rpc(base,{raw:dup})).codigo,'CAMPOS_PAYLOAD_O_CLAVE_REPETIDA');
 for(const change of [p=>p.mediciones.pop(),p=>p.mediciones[1]=p.mediciones[0],p=>p.mediciones[0].unidad='K',p=>p.mediciones[0].valor=999,p=>p.mediciones[0].valor=28.12345,p=>p.mediciones.find(m=>m.variable_codigo==='conductividad_suelo_ece').metadatos.metodo='sensor_generico',p=>p.mediciones.find(m=>m.variable_codigo==='precipitacion_60min').metadatos.periodo_segundos=60,p=>p.simulacion.paso=12,p=>p.cultivo_id=crop2]){
  const p=structuredClone(base);change(p.payload);assert.equal((await rpc(p)).estado,'rechazado');
 }
 const malformed=base.mensaje.replace('"fuente":"generador_sintetico_v1"','"fuente":"generador_sintetico_v1","fuente":"generador_sintetico_v1"');assert.equal((await rpc(base,{raw:malformed})).codigo,'METADATOS_SIMULACION');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM public.mediciones WHERE mensaje_id=$1',[base.payload.mensaje_id])).rows[0].n,0);
});
test('capacidades y autorización: no crea nodos desde mensajes ni acepta un nodo físico',async()=>{
 const p=await packet();
 // La FK impide borrar una capacidad que ya tiene historia. Revocar su modelo
 // autorizado permite probar el rechazo sin intentar borrar mediciones previas.
 await assert.rejects(db.query("DELETE FROM public.nodo_variables WHERE nodo_id=$1 AND variable_codigo='ph_suelo'",[virtual.id]),/violates RESTRICT/);
 await db.query("UPDATE public.nodo_variables SET sensor_modelo='REVOCADO' WHERE nodo_id=$1 AND variable_codigo='ph_suelo'",[virtual.id]);assert.equal((await rpc(p)).codigo,'CAPACIDAD_NODO');
 await db.query("UPDATE public.nodo_variables SET sensor_modelo='SIMULADOR_V3' WHERE nodo_id=$1 AND variable_codigo='ph_suelo'",[virtual.id]);
 const unknown=structuredClone(p);unknown.payload.nodo_codigo='sim-desconocido-01';unknown.topico='agrovigia/v3/simulado/nodos/sim-desconocido-01/telemetria';assert.equal((await rpc(unknown)).codigo,'NODO_DESCONOCIDO');
 // Una identidad que cumpla el patrón no acredita tipo virtual en el catálogo.
 const fake=(await db.query("INSERT INTO public.nodos(codigo,agricultor_id)VALUES('sim-fisico-01',$1)RETURNING *",[owner])).rows[0];
 const real=structuredClone(p);real.payload.nodo_codigo=fake.codigo;real.topico=`agrovigia/v3/simulado/nodos/${fake.codigo}/telemetria`;assert.equal((await rpc(real)).codigo,'NODO_NO_VIRTUAL');
 await db.query('DELETE FROM public.nodos WHERE id=$1',[fake.id]);
});
test('fallo de integridad a mitad del lote revierte las diez escrituras',async()=>{
 const p=await packet();await db.exec("CREATE FUNCTION public.fallo_zonas() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.variable_codigo='ph_suelo' THEN RAISE EXCEPTION 'Fallo intencional';END IF;RETURN NEW;END;$$;CREATE TRIGGER fallo_zonas BEFORE INSERT ON public.mediciones FOR EACH ROW EXECUTE FUNCTION public.fallo_zonas();");
 try{await assert.rejects(rpc(p),/Fallo intencional/);assert.equal((await db.query('SELECT count(*)::int AS n FROM public.mediciones WHERE mensaje_id=$1',[p.payload.mensaje_id])).rows[0].n,0);}finally{await db.exec('DROP TRIGGER fallo_zonas ON public.mediciones;DROP FUNCTION public.fallo_zonas();');}
});
test('nuevo origen/zonas se ocultan a otra cuenta bajo RLS SQL',async()=>{
 const p=await packet();await rpc(p);
 assert.equal((await asUser(owner,()=>db.query('SELECT count(*)::int AS n FROM public.mediciones WHERE mensaje_id=$1',[p.payload.mensaje_id]))).rows[0].n,10);
 assert.equal((await asUser(other,()=>db.query('SELECT count(*)::int AS n FROM public.mediciones WHERE mensaje_id=$1',[p.payload.mensaje_id]))).rows[0].n,0);
});
test('más de dos virtuales conviven con dos físicos; las RPC mantienen límite físico',async()=>{
 const extra=(await db.query("INSERT INTO public.nodos(codigo,agricultor_id)VALUES('agv-extra-02',$1)RETURNING *",[owner])).rows[0];
 await asUser(owner,()=>db.query('SELECT public.vincular_nodo($1,$2)',[extra.id,crop]));
 const third=(await db.query("INSERT INTO public.nodos(codigo,agricultor_id)VALUES('agv-extra-03',$1)RETURNING *",[owner])).rows[0];
 await assert.rejects(asUser(owner,()=>db.query('SELECT public.vincular_nodo($1,$2)',[third.id,crop])),/LIMITE_NODOS_CULTIVO/);
 for(let i=2;i<=4;i++){const n=(await db.query("INSERT INTO public.nodos(codigo,agricultor_id,tipo_nodo)VALUES($1,$2,'virtual')RETURNING *",[`sim-extra-0${i}`,owner])).rows[0];await asUser(owner,()=>db.query('SELECT public.vincular_nodo($1,$2)',[n.id,crop]));}
 assert.equal((await db.query("SELECT count(*)::int AS n FROM public.nodos WHERE cultivo_id=$1 AND tipo_nodo='virtual'",[crop])).rows[0].n,4);
});
test('límite de dieciséis virtuales se aplica en RPC y los cambios de prueba revierten',async()=>{
 await db.exec('BEGIN');try{
  for(let i=5;i<=16;i++){const n=(await db.query("INSERT INTO public.nodos(codigo,agricultor_id,tipo_nodo)VALUES($1,$2,'virtual')RETURNING *",[`sim-limite-${i}`,owner])).rows[0];await asUser(owner,()=>db.query('SELECT public.vincular_nodo($1,$2)',[n.id,crop]));}
  const n=(await db.query("INSERT INTO public.nodos(codigo,agricultor_id,tipo_nodo)VALUES('sim-limite-17',$1,'virtual')RETURNING *",[owner])).rows[0];
  // Una excepcion dentro de una transaccion explicita la aborta; el helper
  // de identidad no se usa en este ultimo rechazo para poder revertir despues.
  await db.exec('SET ROLE authenticated');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[owner]);
  await assert.rejects(db.query('SELECT public.vincular_nodo($1,$2)',[n.id,crop]),/LIMITE_NODOS_CULTIVO/);
 }finally{await db.exec('ROLLBACK;RESET ROLE');await db.exec("SELECT set_config('request.jwt.claim.sub','',false)");}
});
test('provisionamiento exige cultivo explícito, es idempotente y no crea mediciones',async()=>{
 const source=sql('provisionar-simulacion.sql');
 await assert.rejects(db.exec(source),/CONFIGURAR_CULTIVO_ID/);await db.exec('ROLLBACK');
 const script=source.replace('p_cultivo_id uuid := NULL',`p_cultivo_id uuid := '${crop2}'`);
 const first=await db.exec(script),rows=first.find(r=>r.rows?.[0]?.nodo_local)?.rows;
 assert.equal(rows.length,4);const ids=rows.map(r=>r.asignacion_version);
 const repeat=await db.exec(script),again=repeat.find(r=>r.rows?.[0]?.nodo_local)?.rows;assert.deepEqual(again.map(r=>r.asignacion_version),ids);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM public.mediciones WHERE cultivo_id=$1',[crop2])).rows[0].n,0);
});
test('compatibilidad real v2: asignar zona conserva duplicados y metadatos originales',async()=>{
 await asUser(owner,()=>db.query('SELECT public.asignar_zona_nodo($1,$2)',[physical.id,zona.id]));
 const p={version:2,nodo_codigo:physical.codigo,mensaje_id:randomUUID(),origen:'real',tomada_en:new Date().toISOString().replace(/\.\d{3}Z$/,'Z'),ldr:{metodo:'adc12_10k_11db_v1',adc_promedio:625},mediciones:[{variable_codigo:'temperatura_aire',valor:28.1,unidad:'°C'},{variable_codigo:'humedad_aire',valor:70,unidad:'% HR'},{variable_codigo:'iluminacion_relativa',valor:15.3,unidad:'% relativo'}]};
 const call=async()=>{await db.exec('SET ROLE service_role');try{return(await db.query('SELECT public.registrar_lote_ambiental($1,$2,clock_timestamp(),true,NULL,true)AS r',[`agrovigia/v2/real/nodos/${physical.codigo}/telemetria`,JSON.stringify(p)])).rows[0].r;}finally{await db.exec('RESET ROLE');}};
 const a=await call();assert.equal(a.estado,'insertado');await asUser(owner,()=>db.query('SELECT public.asignar_zona_nodo($1,$2)',[physical.id,zona2.id]));
 const b=await call();assert.equal(b.estado,'duplicado');assert.deepEqual(b.medicion_ids,a.medicion_ids);
 const row=(await db.query('SELECT * FROM public.mediciones WHERE mensaje_id=$1 LIMIT 1',[p.mensaje_id])).rows[0];assert.equal(row.zona_id,zona.id);assert.deepEqual(Object.keys(row.metadatos).sort(),['ldr','version_payload']);
});
test('regresión: las pruebas previas de cultivos, vínculos y alertas pasan después de 0007/0008',async()=>{
 for(const file of ['probar-gestion-cultivos.sql','probar-gestion-nodos.sql','probar-alertas.sql']){
  const fixture=sql(file).replaceAll('3611e8b0-13ba-45ec-a66f-b066315a7341',owner).replaceAll('f11baaf9-0461-4b73-94d6-d8eff18c6fa8',other);
  const result=await db.exec(fixture);assert.match(result.at(-1).rows[0].resultado,/^OK:/);
 }
});
test('archivar libera zonas de los nodos, conserva historia y rechaza datos nuevos',async()=>{
 const p=await packet();await rpc(p);await asUser(owner,()=>db.query('SELECT public.archivar_cultivo($1)',[crop]));
 const n=await nodeNow();assert.equal(n.cultivo_id,null);assert.equal(n.zona_id,null);assert.equal(n.posicion_x,null);
 assert.equal((await rpc(p)).estado,'duplicado');assert.equal((await rpc(await packet())).codigo,'NODO_SIN_ZONA_O_CULTIVO');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM public.mediciones WHERE mensaje_id=$1',[p.payload.mensaje_id])).rows[0].n,10);
});
