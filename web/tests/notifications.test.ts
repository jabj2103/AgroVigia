import test from 'node:test';import assert from 'node:assert/strict';import {createClient} from '@supabase/supabase-js';
import {cargarPendientes,esAlertaNueva} from '../src/notification-data.ts';
const crop='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
test('contador: reales activas sin revisar en cultivos autorizados, count exacto sin truncar a la fila',async()=>{
 let u:URL|undefined,prefer='';const client=createClient('https://fixture.supabase.co','sb_publishable_ficticia',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init)=>{u=new URL(String(input));prefer=new Headers(init?.headers).get('prefer')??'';return new Response(JSON.stringify([{id,cultivo_id:crop,abierta_en:'2026-10-28T00:00:00Z'}]),{status:200,headers:{'Content-Type':'application/json','Content-Range':'0-0/123'}});}}});
 const r=await cargarPendientes(client,[crop]);assert.equal(r.cantidad,123);assert.equal(u!.searchParams.get('origen'),'eq.real');assert.equal(u!.searchParams.get('cerrada_en'),'is.null');assert.equal(u!.searchParams.get('revisada_en'),'is.null');assert.equal(u!.searchParams.get('cultivo_id'),'in.('+crop+')');assert.equal(u!.searchParams.get('limit'),'1');assert.match(prefer,/count=exact/);
 assert.deepEqual(await cargarPendientes(client,[]),{cantidad:0,ultima:null});
});
test('contador: error no es cero y no notifica una alerta antigua al revisar la mas reciente',async()=>{
 const a={id,cultivo_id:crop,abierta_en:'2026-10-28T00:01:00Z'},b={...a,abierta_en:'2026-10-28T00:00:00Z'};
 assert.equal(esAlertaNueva(a,null),true);assert.equal(esAlertaNueva(a,a),false);assert.equal(esAlertaNueva(b,a),false);assert.equal(esAlertaNueva(a,b),true);
 const client=createClient('https://fixture.supabase.co','sb_publishable_ficticia',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async()=>new Response(JSON.stringify({message:'Fallo'}),{status:500,headers:{'Content-Type':'application/json'}})}});
 await assert.rejects(cargarPendientes(client,[crop]),/contador/);
});
