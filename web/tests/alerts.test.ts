import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {validarLimites,avisoEvidencia,motivoCierre,cargarEpisodios,cargarReglas,guardarRegla,desactivarRegla,revisarAlerta} from '../src/alert-data.ts';
const crop='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
test('alertas: limites opcionales, cero, negativos y precision sin defaults agronomicos',()=>{
 assert.deepEqual(validarLimites('temperatura_aire','-5,5','0'),{p_minimo:-5.5,p_maximo:0});
 assert.deepEqual(validarLimites('humedad_aire','','70'),{p_minimo:null,p_maximo:70});
 for(const [v,a,b] of [['humedad_aire','-1','70'],['iluminacion_relativa','','101'],['temperatura_aire','',''],['temperatura_aire','30','20'],['temperatura_aire','20','20'],['temperatura_aire','','0.00001'],['temperatura_aire','','NaN']])assert.throws(()=>validarLimites(v as 'temperatura_aire',a!,b!));
});
test('alertas: evidencia antigua/futura y cierre administrativo no se presentan como recuperacion',()=>{
 const t=Date.parse('2026-10-28T00:00:00Z');assert.match(avisoEvidencia(new Date(t-181000).toISOString(),t),/no confirma/);assert.match(avisoEvidencia(new Date(t+1000).toISOString(),t),/adelantada/);assert.equal(avisoEvidencia(new Date(t-1000).toISOString(),t),'');assert.match(motivoCierre('regla_desactivada'),/sustituida/);
});
test('alertas: cada pagina filtra cultivo/origen/condicion/revision; cursor sin offset, conteo y fallos',async()=>{
 const urls:URL[]=[];let fail=false;const client=createClient('https://fixture.supabase.co','sb_publishable_ficticia',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async (input,init)=>{if(init?.signal?.aborted)throw new DOMException('Abortado','AbortError');const u=new URL(String(input));urls.push(u);return new Response(JSON.stringify(fail?{message:'Fallo'}:[]),{status:fail?500:200,headers:{'Content-Type':'application/json','Content-Range':'*/0'}});}}});
 await cargarReglas(client,crop);await cargarEpisodios(client,crop,{estado:'activas',revision:'pendientes'},null);await cargarEpisodios(client,crop,{estado:'cerradas',revision:'revisadas'},{fecha:'2026-10-28T00:00:00Z',id});
 for(const u of urls){assert.equal(u.searchParams.get('cultivo_id'),'eq.'+crop);assert.equal(u.searchParams.get('origen'),'eq.real');assert.ok(!u.searchParams.has('offset'));}
 assert.equal(urls[1]!.searchParams.get('cerrada_en'),'is.null');assert.equal(urls[2]!.searchParams.get('cerrada_en'),'not.is.null');assert.equal(urls[2]!.searchParams.get('revisada_en'),'not.is.null');assert.match(urls[2]!.searchParams.get('or')!,/abierta_en.lt/);
 fail=true;await assert.rejects(cargarEpisodios(client,crop,{estado:'todas',revision:'todas'},null),/No pudimos consultar/);
 fail=false;const abort=new AbortController();abort.abort();await assert.rejects(cargarReglas(client,crop,abort.signal));
});
test('alertas: RPC publica solo configura/desactiva/revisa; no evalua ni envia propietario',async()=>{
 const calls:{name:string;args:Record<string,unknown>}[]=[];
 const client=createClient('https://fixture.supabase.co','sb_publishable_ficticia',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init)=>{const name=new URL(String(input)).pathname.split('/').at(-1)!;const args=JSON.parse(String(init?.body));calls.push({name,args});const data=name==='configurar_regla_alerta'?{id,cultivo_id:crop,origen:'real',variable_codigo:'temperatura_aire',minimo:null,maximo:30,habilitada:true}:name==='desactivar_regla_alerta'?{id,habilitada:false}:{id,revisada_en:'2026-10-28T00:00:00Z'};return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});}}});
 await guardarRegla(client,crop,'temperatura_aire','','30');await desactivarRegla(client,id);await revisarAlerta(client,id);
 assert.deepEqual(calls[0]!.args,{p_cultivo_id:crop,p_variable_codigo:'temperatura_aire',p_minimo:null,p_maximo:30,p_origen:'real'});assert.deepEqual(calls[2]!.args,{p_alerta_id:id});assert.ok(calls.every(c=>!c.name.includes('evaluar')&&!('agricultor_id' in c.args)));
});
