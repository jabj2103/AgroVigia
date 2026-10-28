'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {prepararEvaluacionAlertas:preparar,prepararRpcAlertas:rpc,resultadoAlertas:resultado,salidaSinEvaluar}=require('./preparar-alertas.cjs');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const persistencia=()=>({codigo:'LOTE_DHT22_GUARDADO',estado:'insertado',persistido:true,nuevo_lote:true,mensaje_id:id(10),cultivo_id:id(20),medicion_ids:[id(1),id(2),id(3)],recibida_en:'2026-10-27T20:00:00Z'});
const ingesta=()=>({destino_rpc:'https://fixture.supabase.co/rest/v1/rpc/registrar_lote_ambiental',payload:{mensaje_id:id(10),origen:'real',nodo_codigo:'agv-dht22-01'}});
const consulta=()=>({statusCode:200,body:[{id:id(1),nodo_id:id(30),cultivo_id:id(20),mensaje_id:id(10),origen:'real'}]});
const ok=()=>({statusCode:200,body:{codigo:'LOTE_EVALUADO',evaluadas:3,abiertas:1,actualizadas:0,cerradas:0}});
test('alertas: solo prepara evaluacion tras persistencia confirmada; insercion y duplicado conservan evidencia',()=>{
 for(const estado of ['rechazado','conflicto_id'])assert.equal(preparar({...persistencia(),estado,persistido:false},ingesta()).lista,false);
 for(const estado of ['insertado','duplicado']){const c=preparar({...persistencia(),estado},ingesta());assert.equal(c.lista,true);const u=new URL(c.consulta_nodo_url);assert.equal(u.searchParams.get('id'),'eq.'+id(1));assert.equal(u.searchParams.get('cultivo_id'),'eq.'+id(20));assert.equal(u.searchParams.get('mensaje_id'),'eq.'+id(10));assert.equal(u.searchParams.get('origen'),'eq.real');}
});
test('alertas: destino y contexto inconsistente no llegan a HTTP',()=>{
 assert.equal(preparar(persistencia(),{...ingesta(),destino_rpc:'https://externo.example/rest/v1/rpc/registrar_lote_ambiental'}).lista,false);
 assert.equal(preparar(persistencia(),{...ingesta(),payload:{...ingesta().payload,mensaje_id:id(99)}}).lista,false);
 assert.equal(preparar({...persistencia(),medicion_ids:[id(1),id(1),id(1)]},ingesta()).lista,false);
});
test('alertas: resuelve nodo desde fila guardada y exige coincidencia de cultivo/UUID/origen',()=>{
 const c=preparar(persistencia(),ingesta()),r=rpc(c,consulta());assert.equal(r.lista,true);assert.deepEqual(r.solicitud_alertas,{p_nodo_id:id(30),p_mensaje_id:id(10)});
 for(const respuesta of [{error:{message:'secreto'}},{statusCode:500,body:[]},{statusCode:200,body:[]},{statusCode:200,body:[...consulta().body,...consulta().body]},...['cultivo_id','mensaje_id','origen','id'].map(k=>({statusCode:200,body:[{...consulta().body[0],[k]:'otro'}]}))]){const fallo=rpc(c,respuesta);assert.equal(fallo.lista,false);assert.equal(salidaSinEvaluar(fallo).persistido,true);}
});
test('alertas: error o respuesta malformada conserva persistido true sin filtrar errores HTTP ni afirmar exito',()=>{
 const c=rpc(preparar(persistencia(),ingesta()),consulta());
 for(const r of [{error:{message:'CLAVE_PRIVADA_FICTICIA'}},{statusCode:500,body:ok().body},{statusCode:200,body:{codigo:'LOTE_EVALUADO',evaluadas:0,abiertas:1,actualizadas:0,cerradas:0}},{statusCode:200,body:{...ok().body,evaluadas:'3'}},{}]){
  const f=resultado(c,r);assert.equal(f.persistido,true);assert.equal(f.alertas.estado,'pendiente');assert.ok(!JSON.stringify(f).includes('CLAVE_PRIVADA_FICTICIA'));assert.equal(f.mensaje_id,id(10));
 }
 assert.equal(resultado(c,ok()).alertas.estado,'evaluada');
 const cero=resultado(c,{statusCode:200,body:{codigo:'LOTE_EVALUADO',evaluadas:0,abiertas:0,actualizadas:0,cerradas:0}});assert.equal(cero.alertas.evaluadas,0);assert.match(cero.alertas.observacion,/No indica salud/);
 assert.equal(resultado(c,{statusCode:200,body:{codigo:'NODO_NO_ACTIVO',evaluadas:0}}).alertas.estado,'omitida');
});
test('03e: grafo, credenciales ausentes, HTTP limitados con reintentos y errores separados del guardado',()=>{
 const f=JSON.parse(fs.readFileSync(path.join(__dirname,'03e-ingesta-alertas.json'),'utf8'));assert.equal(f.active,false);assert.ok(f.nodes.every(n=>!n.credentials));
 for(const c of Object.values(f.connections))for(const out of c.main)for(const e of out)assert.ok(f.nodes.some(n=>n.name===e.node));
 for(const name of ['Consultar nodo guardado','Evaluar alertas']){const h=f.nodes.find(n=>n.name===name);assert.equal(h.onError,'continueRegularOutput');assert.equal(h.retryOnFail,true);assert.equal(h.maxTries,3);assert.equal(h.waitBetweenTries,2000);assert.equal(h.parameters.options.response.response.fullResponse,true);assert.equal(h.parameters.options.redirect.redirect.followRedirects,false);}
 assert.equal(f.nodes.find(n=>n.name==='Guardar lote en Supabase').onError,undefined);
 assert.equal(f.connections['Persistencia confirmada'].main[1][0].node,'Sin evaluar alertas');assert.equal(f.connections['Nodo resuelto'].main[1][0].node,'Sin evaluar alertas');
});
test('03e: Code incrustado respeta pairedItem para dos lotes y mantiene resumen tras fallo de evaluacion',()=>{
 const f=JSON.parse(fs.readFileSync(path.join(__dirname,'03e-ingesta-alertas.json'),'utf8'));
 const execute=(name,inputs,linked)=>vm.runInNewContext('(function(){'+f.nodes.find(n=>n.name===name).parameters.jsCode+'})()',{$input:{all:()=>inputs.map(json=>({json}))},$:(node)=>({itemMatching:i=>({json:linked[node][i]})})});
 const ps=[persistencia(),{...persistencia(),mensaje_id:id(11),medicion_ids:[id(4),id(5),id(6)]}];const ins=[ingesta(),{...ingesta(),payload:{...ingesta().payload,mensaje_id:id(11)}}];
 const c=execute('Preparar evaluacion',ps,{'Preparar ingesta':ins});assert.equal(c[1].pairedItem.item,1);assert.equal(c[1].json.persistencia.mensaje_id,id(11));
 const records=[consulta(),{statusCode:200,body:[{...consulta().body[0],id:id(4),nodo_id:id(31),mensaje_id:id(11)}]}];
 const r=execute('Preparar RPC alertas',records,{'Preparar evaluacion':c.map(i=>i.json)});assert.equal(r[1].json.solicitud_alertas.p_nodo_id,id(31));
 const out=execute('Resultado de alertas',[ok(),{error:{message:'fallo'}}],{'Preparar RPC alertas':r.map(i=>i.json)});
 assert.equal(out[0].json.alertas.estado,'evaluada');assert.equal(out[1].json.alertas.estado,'pendiente');assert.equal(out[1].json.persistido,true);assert.equal(out[1].json.mensaje_id,id(11));
});
