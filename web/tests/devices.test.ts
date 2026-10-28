import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {cambiarVinculo,ultimaRecepcion,actividadNodos} from '../src/device-data.ts';
test('dispositivos: SDK envia nodo/cultivo esperado, valida respuesta y conserva filtros reales',async()=>{
 const reqs:{u:URL;b:Record<string,unknown>|null}[]=[];let fail=false;
 const client=createClient('https://fixture.supabase.co','sb_publishable_ficticia',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init)=>{
  const u=new URL(String(input)),b=init?.body?JSON.parse(String(init.body)):null;reqs.push({u,b});
  let data:unknown=[];
  if(u.pathname.includes('/rpc/'))data=fail?{message:'ASIGNACION_CAMBIO'}:{id:'nodo',cultivo_id:u.pathname.endsWith('desvincular_nodo')?null:'cultivo'};
  else if(u.pathname.endsWith('mediciones'))data=null;
  return new Response(JSON.stringify(data),{status:fail?400:200,headers:{'Content-Type':'application/json'}});
 }}});
 await cambiarVinculo(client,'nodo','cultivo',false);await cambiarVinculo(client,'nodo','cultivo',true);
 assert.deepEqual(reqs[0]!.b,{p_nodo_id:'nodo',p_cultivo_id:'cultivo'});
 assert.deepEqual(reqs[1]!.b,{p_nodo_id:'nodo',p_cultivo_esperado_id:'cultivo'});
 fail=true;await assert.rejects(cambiarVinculo(client,'nodo','cultivo',true),/asignación cambió/);fail=false;
 assert.equal(await ultimaRecepcion(client,'nodo'),null);
 assert.equal(reqs.at(-1)!.u.searchParams.get('origen'),'eq.real');assert.equal(reqs.at(-1)!.u.searchParams.get('nodo_id'),'eq.nodo');
 const prev=reqs.length;assert.deepEqual(await actividadNodos(client,[]),[]);assert.equal(reqs.length,prev);
 await actividadNodos(client,['nodo']);assert.equal(reqs.at(-1)!.u.searchParams.get('limit'),'20');assert.ok(reqs.at(-1)!.u.searchParams.has('nodo_id'));
});
