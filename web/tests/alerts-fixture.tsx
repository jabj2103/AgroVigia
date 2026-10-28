// Fixture local de interfaz; no usa sesiones ni servicios reales.
import {StrictMode,useState} from 'react';import {createRoot} from 'react-dom/client';import {createClient} from '@supabase/supabase-js';import type {Session} from '@supabase/supabase-js';
import {Panel} from '../src/App.tsx';import type {Episodio,ReglaAlerta} from '../src/alert-data.ts';import 'bootstrap/dist/css/bootstrap.min.css';import '../src/styles.css';
const crop='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',archive='dddddddd-dddd-4ddd-8ddd-dddddddddddd',node='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',owner='11111111-1111-4111-8111-111111111111';
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
let reglas:ReglaAlerta[]=[{id:id(99),cultivo_id:crop,variable_codigo:'temperatura_aire',origen:'real',minimo:null,maximo:30,habilitada:true,creada_en:new Date().toISOString()}];
let alertas:Episodio[]=Array.from({length:25},(_,i)=>({id:id(i+1),regla_id:id(99),cultivo_id:crop,nodo_id:node,variable_codigo:'temperatura_aire',origen:'real',limite:'superior',umbral:30,valor_inicial:31,valor_ultimo:32,abierta_en:new Date(Date.now()-i*60000).toISOString(),ultima_tomada_en:new Date(Date.now()-3600000-i*60000).toISOString(),cerrada_en:i>=23?new Date().toISOString():null,motivo_cierre:i>=23?'regla_desactivada':null,revisada_en:null,medicion_inicial_id:id(100+i),medicion_ultima_id:id(200+i),medicion_cierre_id:null}));
declare global{interface Window{qaBadgeCerrar:()=>void;qaBadgeNueva:()=>void;qaAlertsError:boolean;qaAlertMutationError:boolean;qaAlertCalls:{name:string;args:Record<string,unknown>}[];qaAlertQueries:string[]}}
window.qaAlertsError=false;window.qaAlertMutationError=false;window.qaAlertCalls=[];window.qaAlertQueries=[];
window.qaBadgeNueva=()=>{alertas.unshift({...alertas[0]!,id:id(1000),abierta_en:new Date(Date.now()+1000).toISOString(),ultima_tomada_en:new Date().toISOString(),revisada_en:null,cerrada_en:null,motivo_cierre:null});};
window.qaBadgeCerrar=()=>{alertas=alertas.map(a=>({...a,cerrada_en:new Date().toISOString(),motivo_cierre:'dentro_de_rango'}));};
let vacio=false;
const client=createClient('https://fixture-no-remoto.supabase.co','sb_publishable_ficticia',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init)=>{
 const u=new URL(String(input)),name=u.pathname.split('/').at(-1)!;let data:unknown=[],total:number|undefined;
 const response=(d:unknown,status=200,count?:number)=>new Response(JSON.stringify(d),{status,headers:{'Content-Type':'application/json',...(count!==undefined?{'Content-Range':'*/'+count}:{})}});
 if(u.pathname.includes('/rpc/')){
  const args=JSON.parse(String(init?.body));window.qaAlertCalls.push({name,args});if(window.qaAlertMutationError){window.qaAlertMutationError=false;return response({message:'Fallo inventado'},500);}
  if(name==='configurar_regla_alerta'){
   reglas=reglas.map(r=>r.cultivo_id===args.p_cultivo_id&&r.variable_codigo===args.p_variable_codigo?{...r,habilitada:false}:r);
   const r={id:id(500),cultivo_id:args.p_cultivo_id,variable_codigo:args.p_variable_codigo,origen:'real',minimo:args.p_minimo,maximo:args.p_maximo,habilitada:true,creada_en:new Date().toISOString()};reglas.push(r);data=r;
  }else if(name==='desactivar_regla_alerta'){reglas=reglas.map(r=>r.id===args.p_regla_id?{...r,habilitada:false}:r);data=reglas.find(r=>r.id===args.p_regla_id);}
  else if(name==='revisar_alerta'){alertas=alertas.map(a=>a.id===args.p_alerta_id?{...a,revisada_en:new Date().toISOString()}:a);data=alertas.find(a=>a.id===args.p_alerta_id);}
  else return response({message:'RPC inesperada'},400);
 }else if(name==='reglas_alerta'||name==='alertas'){
  window.qaAlertQueries.push(u.href);if(window.qaAlertsError)return response({message:'Fallo QA'},500);
  const cultivo=u.searchParams.get('cultivo_id')?.slice(3);
  if(name==='reglas_alerta')data=vacio?[]:reglas.filter(r=>r.habilitada&&r.cultivo_id===cultivo&&r.origen===u.searchParams.get('origen')?.slice(3));
  else{
   const conjunto=u.searchParams.get('cultivo_id')?.startsWith('in.')?u.searchParams.get('cultivo_id')!.slice(4,-1).split(','):null;
   let filas=vacio?[]:alertas.filter(a=>(conjunto?conjunto.includes(a.cultivo_id):a.cultivo_id===cultivo)&&a.origen===u.searchParams.get('origen')?.slice(3));
   for(const k of ['cerrada_en','revisada_en'] as const){const f=u.searchParams.get(k);if(f)filas=filas.filter(a=>f==='is.null'?a[k]===null:a[k]!==null);}
   const cursor=u.searchParams.get('or');if(cursor){const m=cursor.match(/abierta_en.lt.(.+),and\(abierta_en.eq.(.+),id.lt.([a-f0-9-]+)\)/)!;const t=Date.parse(m[1]!);filas=filas.filter(a=>Date.parse(a.abierta_en)<t||(Date.parse(a.abierta_en)===t&&a.id<m[3]!));}
   filas.sort((a,b)=>Date.parse(b.abierta_en)-Date.parse(a.abierta_en)||b.id.localeCompare(a.id));total=filas.length;data=filas.slice(0,Number(u.searchParams.get('limit')??20));
  }
 }else if(name==='perfiles')data={nombre:vacio?'Cuenta vacía':'Cuenta de prueba'};
 else if(name==='cultivos')data=vacio?[]:[{id:crop,nombre:'Lote QA',tipo:'Maíz',area:10,unidad_area:'m2',archivado_en:null},{id:archive,nombre:'Lote archivado',tipo:'Prueba',area:1,unidad_area:'m2',archivado_en:new Date().toISOString()}];
 else if(name==='nodos')data=vacio?[]:[{id:node,codigo:'agv-prueba-01',cultivo_id:crop,habilitado:true}];
 else if(name==='nodo_variables')data=['temperatura_aire','humedad_aire','iluminacion_relativa'].map(v=>({nodo_id:node,variable_codigo:v,sensor_modelo:v==='iluminacion_relativa'?'LDR':'DHT22'}));
 else if(name==='mediciones')data=null;
 else throw new Error('Consulta QA inesperada');
 return response(data,200,total);
}}});
function Harness(){const [otra,setOtra]=useState(false);return <><div className="aviso advertencia" style={{margin:0}}>PRUEBA LOCAL · DATOS INVENTADOS <button onClick={()=>{vacio=true;setOtra(true);}}>Cuenta vacía</button></div><Panel key={otra?'otra':'propia'} client={client} sesion={{user:{id:otra?id(999):owner,email:'qa@example.test'}} as Session}/></>;}
createRoot(document.getElementById('root')!).render(<StrictMode><Harness/></StrictMode>);
