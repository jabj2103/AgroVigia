import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { validarCultivo, guardarCultivo, archivarCultivo } from '../src/crop-data.ts';
const datos = { nombre:' Norte ',tipo:' Maíz ',area:'0,5',unidad:'ha',nodos:['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'] };
test('cultivo valida decimales, unidades, nodo obligatorio y texto; preserva la precision', () => {
  assert.deepEqual(validarCultivo(datos,true),{p_nombre:'Norte',p_tipo:'Maíz',p_area:0.5,p_unidad_area:'ha'});
  for (const cambio of [{area:'0'},{area:'NaN'},{area:'0.00001'},{area:'100000000'},{area:'1e2'},{unidad:'acres'},{nombre:' '},{nodos:[]},{nodos:[...datos.nodos,...datos.nodos]}])
    assert.throws(() => validarCultivo({...datos,...cambio},true));
  assert.doesNotThrow(() => validarCultivo({...datos,nodos:[]},false));
});
test('RPC usa sesion SDK sin propietario enviado; reintento mantiene UUID; errores no confirman exito', async () => {
  const peticiones: { url:string; body:Record<string,unknown> }[]=[];
  let falla=true;
  const client=createClient('https://fixture.supabase.co','sb_publishable_ficticia',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async (input,init) => {
    peticiones.push({url:String(input),body:JSON.parse(String(init?.body))});
    return new Response(JSON.stringify(falla?{message:'NODOS_NO_DISPONIBLES',code:'42501'}:{id:'nuevo',archivado_en:'2026-10-27T20:00:00Z'}),{status:falla?403:200,headers:{'Content-Type':'application/json'}});
  }}});
  await assert.rejects(guardarCultivo(client,datos,null,'solicitud-unica'),/nodo ya no está disponible/);
  falla=false; await guardarCultivo(client,datos,null,'solicitud-unica');
  assert.equal(peticiones[0]!.body.p_solicitud_id,peticiones[1]!.body.p_solicitud_id);
  assert.ok(!('agricultor_id' in peticiones[1]!.body));
  await guardarCultivo(client,datos,'cultivo','no-se-envia');
  assert.ok(peticiones[2]!.url.endsWith('/rpc/editar_cultivo'));
  assert.ok(!('p_nodos' in peticiones[2]!.body));
  await archivarCultivo(client,'cultivo');
  assert.deepEqual(peticiones[3]!.body,{p_cultivo_id:'cultivo'});
});
