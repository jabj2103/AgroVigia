// Solo QA local: no conecta con Supabase ni guarda datos reales.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import type { Session } from '@supabase/supabase-js';
import { Panel } from '../src/App.tsx';
import 'bootstrap/dist/css/bootstrap.min.css';
import '../src/styles.css';
const owner='11111111-1111-4111-8111-111111111111';
const crop='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const n1='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',n2='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
let cultivos=[{id:crop,nombre:'Lote QA',tipo:'Maíz',area:10,unidad_area:'m2',archivado_en:null as string|null}];
let cambios:Record<string,unknown>[]=[];
// Campos del croquis (E2): propietario, tipo, ubicacion y version de asignacion.
const ubicacion={tipo_nodo:'fisico',agricultor_id:owner,zona_id:null,posicion_x:null,posicion_y:null};
let nodos=[{id:n1,codigo:'agv-prueba-01',cultivo_id:crop as string|null,habilitado:true,...ubicacion,asignacion_version:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'},{id:n2,codigo:'agv-prueba-02',cultivo_id:null as string|null,habilitado:true,...ubicacion,asignacion_version:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2'}];
const igual=(u:URL,k:string)=>u.searchParams.get(k)?.startsWith('eq.')?u.searchParams.get(k)!.slice(3):null;
const enLista=(u:URL,k:string)=>u.searchParams.get(k)?.startsWith('in.(')?u.searchParams.get(k)!.slice(4,-1).replaceAll('"','').split(','):null;

declare global { interface Window { qaCropsRequests: { name:string; args:Record<string,unknown> }[]; qaCropError:boolean } }
window.qaCropsRequests=[];window.qaCropError=false;
const client=createClient('https://fixture-no-remoto.supabase.co','sb_publishable_ficticia',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async (input,init) => {
  const u=new URL(String(input)),name=u.pathname.split('/').at(-1)!;
  let data:unknown;
  // Estado de los nodos para Inicio: solo lectura, sin capturas guardadas en este fixture.
  if(name==='estado_red_nodos')return new Response(JSON.stringify(nodos.map(n=>({nodo_id:n.id,codigo:n.codigo,simulado:false,habilitado:n.habilitado,cultivo_id:n.cultivo_id,cultivo_nombre:cultivos.find(c=>c.id===n.cultivo_id)?.nombre??null,plantilla_codigo:null,origen:null,mensaje_id:null,tomada_en:null,recibida_en:null,temperatura:null,humedad:null,iluminacion:null}))),{status:200,headers:{'Content-Type':'application/json'}});
  if(name==='alertas')return new Response('[]',{status:200,headers:{'Content-Type':'application/json','Content-Range':'*/0'}});
  if(u.pathname.includes('/rpc/')) {
    const args=JSON.parse(String(init?.body));window.qaCropsRequests.push({name,args});
    if(window.qaCropError){window.qaCropError=false;return new Response(JSON.stringify({message:'Fallo QA'}),{status:500,headers:{'Content-Type':'application/json'}});}
    const antes=nodos.map(n=>({...n}));
    if(name==='vincular_nodo'||name==='desvincular_nodo'){
      nodos=nodos.map(n=>n.id===args.p_nodo_id?{...n,cultivo_id:name==='desvincular_nodo'?null:args.p_cultivo_id}:n);data=nodos.find(n=>n.id===args.p_nodo_id);
    }else if(name==='crear_cultivo'){
      const c={id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',nombre:args.p_nombre,tipo:args.p_tipo,area:args.p_area,unidad_area:args.p_unidad_area,archivado_en:null};
      cultivos.push(c);nodos=nodos.map(n=>args.p_nodos.includes(n.id)?{...n,cultivo_id:c.id}:n);data=c;
    }else if(name==='editar_cultivo'){
      cultivos=cultivos.map(c=>c.id===args.p_cultivo_id?{...c,nombre:args.p_nombre,tipo:args.p_tipo,area:args.p_area,unidad_area:args.p_unidad_area}:c);data=cultivos.find(c=>c.id===args.p_cultivo_id);
    }else{
      cultivos=cultivos.map(c=>c.id===args.p_cultivo_id?{...c,archivado_en:new Date().toISOString()}:c);nodos=nodos.map(n=>n.cultivo_id===args.p_cultivo_id?{...n,cultivo_id:null}:n);data=cultivos.find(c=>c.id===args.p_cultivo_id);
    }
  nodos.forEach(n=>{const viejo=antes.find(x=>x.id===n.id);if(viejo?.cultivo_id!==n.cultivo_id)cambios.unshift({id:crypto.randomUUID(),nodo_id:n.id,cultivo_anterior_id:viejo?.cultivo_id??null,cultivo_nuevo_id:n.cultivo_id,motivo:n.cultivo_id?'asignacion':'desvinculacion',realizado_en:new Date().toISOString()});});
  } else if(name==='nodo_asignaciones') data=cambios;
  else if(name==='perfiles') data={nombre:'Cuenta de prueba'};
  else if(name==='cultivos') data=cultivos;
  else if(name==='nodos') data=igual(u,'cultivo_id')?nodos.filter(n=>n.cultivo_id===igual(u,'cultivo_id')):nodos;
  else if(name==='zonas') data=[];
  else if(name==='sugerencias_ia') data=[];
  else if(name==='nodo_variables') data=nodos.filter(n=>!enLista(u,'nodo_id')||enLista(u,'nodo_id')!.includes(n.id)).flatMap(n=>['temperatura_aire','humedad_aire','iluminacion_relativa'].map(v=>({nodo_id:n.id,variable_codigo:v,sensor_modelo:v==='iluminacion_relativa'?'LDR':'DHT22'})));
  else if(name==='mediciones') data=u.searchParams.get('select')==='mensaje_id'?null:[];
  else throw new Error('Peticion QA inesperada');
  return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
}}});
const sesion={user:{id:owner,email:'prueba@example.test'}} as Session;
createRoot(document.getElementById('root')!).render(<StrictMode><div className="aviso advertencia" style={{margin:0}}>PRUEBA LOCAL · DATOS INVENTADOS</div><Panel client={client} sesion={sesion}/></StrictMode>);
