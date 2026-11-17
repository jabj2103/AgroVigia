'use strict';
// Ramas compartidas por 03e (real v2) y 03f (simulado v3 por zonas): evaluacion de alertas y
// sugerencias IA, despues de una persistencia confirmada. Reciben el flujo y lo amplian en el lugar.
const fs=require('node:fs'),path=require('node:path');
const edge=name=>[{node:name,type:'main',index:0}];
function gateDe(f){return function gate(name,position){const n=structuredClone(f.nodes.find(n=>n.name==='Forma valida'));n.name=name;n.id='agv-'+name.replaceAll(' ','-');n.position=position;n.parameters.conditions.conditions=[{id:'lista',leftValue:'={{ $json.lista ? "si" : "no" }}',rightValue:'si',operator:{type:'string',operation:'equals'}}];return n;};}
// Modelo de Gemini configurable junto a la URL publica de Supabase. La API key va en una credencial.
function agregarModelo(f,modelo='gemini-3.5-flash-lite'){
 const a=f.nodes.find(n=>n.name==='Proyecto Supabase').parameters.assignments.assignments;
 if(!a.some(x=>x.name==='gemini_modelo'))a.push({id:'agv-modelo-ia',name:'gemini_modelo',value:modelo,type:'string'});
}
function agregarAlertas(f){
 const gate=gateDe(f);
 const base=fs.readFileSync(path.join(__dirname,'preparar-alertas.cjs'),'utf8').split('// EXPORTACIONES_LOCALES:')[0];
 function preparacion(){return $input.all().map((item,i)=>({json:prepararEvaluacionAlertas(item.json,$('Preparar ingesta').itemMatching(i).json),pairedItem:{item:i}}));}
 function rpc(){return $input.all().map((item,i)=>({json:prepararRpcAlertas($('Preparar evaluacion').itemMatching(i).json,item.json),pairedItem:{item:i}}));}
 function resultado(){return $input.all().map((item,i)=>({json:resultadoAlertas($('Preparar RPC alertas').itemMatching(i).json,item.json),pairedItem:{item:i}}));}
 function sinEvaluar(){return $input.all().map((item,i)=>({json:salidaSinEvaluar(item.json),pairedItem:{item:i}}));}
 function code(name,fn,position){return {name,id:'agv-'+name.replaceAll(' ','-').toLowerCase(),type:'n8n-nodes-base.code',typeVersion:2,position,parameters:{jsCode:base+'\nreturn ('+fn.toString()+')();\n'}};}
 function http(name,method,url,position){return {id:'agv-'+name.replaceAll(' ','-'),name,type:'n8n-nodes-base.httpRequest',typeVersion:4.2,position,retryOnFail:true,maxTries:3,waitBetweenTries:2000,onError:'continueRegularOutput',alwaysOutputData:true,parameters:{method,url,authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',...(method==='POST'?{sendBody:true,contentType:'json',specifyBody:'json',jsonBody:'={{ $json.solicitud_alertas }}'}:{}),options:{timeout:15000,redirect:{redirect:{followRedirects:false}},response:{response:{fullResponse:true,responseFormat:'json'}}}}};}
 f.nodes.push(code('Preparar evaluacion',preparacion,[1500,0]),gate('Persistencia confirmada',[1740,0]),http('Consultar nodo guardado','GET','={{ $json.consulta_nodo_url }}',[1980,0]),code('Preparar RPC alertas',rpc,[2220,0]),gate('Nodo resuelto',[2460,0]),http('Evaluar alertas','POST','={{ $json.destino_alertas }}',[2700,0]),code('Resultado de alertas',resultado,[2940,0]),code('Sin evaluar alertas',sinEvaluar,[2220,300]));
 Object.assign(f.connections,{
  'Resultado de persistencia':{main:[edge('Preparar evaluacion')]},
  'Preparar evaluacion':{main:[edge('Persistencia confirmada')]},
  'Persistencia confirmada':{main:[edge('Consultar nodo guardado'),edge('Sin evaluar alertas')]},
  'Consultar nodo guardado':{main:[edge('Preparar RPC alertas')]},
  'Preparar RPC alertas':{main:[edge('Nodo resuelto')]},
  'Nodo resuelto':{main:[edge('Evaluar alertas'),edge('Sin evaluar alertas')]},
  'Evaluar alertas':{main:[edge('Resultado de alertas')]},
 });
}
function agregarIA(f){
 const gate=gateDe(f);
 const baseIA=fs.readFileSync(path.join(__dirname,'preparar-sugerencias.cjs'),'utf8').split('// EXPORTACIONES_LOCALES:')[0];
 function codeIA(name,fn,position){return {name,id:'agv-'+name.replaceAll(' ','-').toLowerCase(),type:'n8n-nodes-base.code',typeVersion:2,position,parameters:{jsCode:baseIA+'\nreturn ('+fn.toString()+')();\n'}};}
 function reservaIA(){return $input.all().map((item,i)=>({json:prepararReservaIA(item.json,$('Preparar RPC alertas').itemMatching(i).json,$('Proyecto Supabase').itemMatching(i).json.gemini_modelo),pairedItem:{item:i}}));}
 function gemini(){return $input.all().map((item,i)=>({json:prepararGemini($('Preparar reserva IA').itemMatching(i).json,item.json),pairedItem:{item:i}}));}
 function interpretar(){return $input.all().map((item,i)=>({json:interpretarGemini($('Preparar Gemini').itemMatching(i).json,item.json),pairedItem:{item:i}}));}
 function resultadoFinalIA(){return $input.all().map((item,i)=>({json:resultadoIA($('Interpretar Gemini').itemMatching(i).json,item.json),pairedItem:{item:i}}));}
 function sinIA(){return $input.all().map((item,i)=>({json:salidaSinIA(item.json),pairedItem:{item:i}}));}
 function httpCuerpo(name,url,cuerpo,position,{timeout=15000,maxTries=3,wait=2000}={}){return {id:'agv-'+name.replaceAll(' ','-'),name,type:'n8n-nodes-base.httpRequest',typeVersion:4.2,position,retryOnFail:true,maxTries,waitBetweenTries:wait,onError:'continueRegularOutput',alwaysOutputData:true,parameters:{method:'POST',url,authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',sendBody:true,contentType:'json',specifyBody:'json',jsonBody:'={{ $json.'+cuerpo+' }}',options:{timeout,redirect:{redirect:{followRedirects:false}},response:{response:{fullResponse:true,responseFormat:'json'}}}}};}
 f.nodes.push(codeIA('Preparar reserva IA',reservaIA,[3180,0]),gate('IA corresponde',[3420,0]),
  httpCuerpo('Reservar sugerencia IA','={{ $json.destino_reserva }}','solicitud_reserva',[3660,-100]),
  codeIA('Preparar Gemini',gemini,[3900,-100]),gate('Sugerencia reservada',[4140,-100]),
  httpCuerpo('Consultar Gemini','={{ $json.destino_gemini }}','solicitud_gemini',[4380,-200],{timeout:45000,maxTries:2,wait:5000}),
  codeIA('Interpretar Gemini',interpretar,[4620,-200]),
  httpCuerpo('Guardar sugerencia IA','={{ $json.destino_completar }}','solicitud_completar',[4860,-200]),
  codeIA('Resultado IA',resultadoFinalIA,[5100,-200]),codeIA('Sin sugerencia IA',sinIA,[4380,200]));
 Object.assign(f.connections,{
  'Resultado de alertas':{main:[edge('Preparar reserva IA')]},
  'Preparar reserva IA':{main:[edge('IA corresponde')]},
  'IA corresponde':{main:[edge('Reservar sugerencia IA'),edge('Sin sugerencia IA')]},
  'Reservar sugerencia IA':{main:[edge('Preparar Gemini')]},
  'Preparar Gemini':{main:[edge('Sugerencia reservada')]},
  'Sugerencia reservada':{main:[edge('Consultar Gemini'),edge('Sin sugerencia IA')]},
  'Consultar Gemini':{main:[edge('Interpretar Gemini')]},
  'Interpretar Gemini':{main:[edge('Guardar sugerencia IA')]},
  'Guardar sugerencia IA':{main:[edge('Resultado IA')]},
 });
}
module.exports={agregarModelo,agregarAlertas,agregarIA};
