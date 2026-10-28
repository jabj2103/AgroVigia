'use strict';
const fs=require('node:fs'),path=require('node:path');
const f=JSON.parse(fs.readFileSync(path.join(__dirname,'03d-ingesta-multinodo.json'),'utf8'));
f.name='AgroVigia - 03e ingesta ambiental y alertas';f.active=false;
for(const n of f.nodes){n.id+='-alertas';delete n.credentials;}
const base=fs.readFileSync(path.join(__dirname,'preparar-alertas.cjs'),'utf8').split('// EXPORTACIONES_LOCALES:')[0];
function preparacion(){return $input.all().map((item,i)=>({json:prepararEvaluacionAlertas(item.json,$('Preparar ingesta').itemMatching(i).json),pairedItem:{item:i}}));}
function rpc(){return $input.all().map((item,i)=>({json:prepararRpcAlertas($('Preparar evaluacion').itemMatching(i).json,item.json),pairedItem:{item:i}}));}
function resultado(){return $input.all().map((item,i)=>({json:resultadoAlertas($('Preparar RPC alertas').itemMatching(i).json,item.json),pairedItem:{item:i}}));}
function sinEvaluar(){return $input.all().map((item,i)=>({json:salidaSinEvaluar(item.json),pairedItem:{item:i}}));}
function code(name,fn,position){return {name,id:'agv-'+name.replaceAll(' ','-').toLowerCase(),type:'n8n-nodes-base.code',typeVersion:2,position,parameters:{jsCode:base+'\nreturn ('+fn.toString()+')();\n'}};}
function gate(name,position){const n=structuredClone(f.nodes.find(n=>n.name==='Forma valida'));n.name=name;n.id='agv-'+name.replaceAll(' ','-');n.position=position;n.parameters.conditions.conditions=[{id:'lista',leftValue:'={{ $json.lista ? "si" : "no" }}',rightValue:'si',operator:{type:'string',operation:'equals'}}];return n;}
function http(name,method,url,position){return {id:'agv-'+name.replaceAll(' ','-'),name,type:'n8n-nodes-base.httpRequest',typeVersion:4.2,position,retryOnFail:true,maxTries:3,waitBetweenTries:2000,onError:'continueRegularOutput',alwaysOutputData:true,parameters:{method,url,authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',...(method==='POST'?{sendBody:true,contentType:'json',specifyBody:'json',jsonBody:'={{ $json.solicitud_alertas }}'}:{}),options:{timeout:15000,redirect:{redirect:{followRedirects:false}},response:{response:{fullResponse:true,responseFormat:'json'}}}}};}
f.nodes.push(code('Preparar evaluacion',preparacion,[1500,0]),gate('Persistencia confirmada',[1740,0]),http('Consultar nodo guardado','GET','={{ $json.consulta_nodo_url }}',[1980,0]),code('Preparar RPC alertas',rpc,[2220,0]),gate('Nodo resuelto',[2460,0]),http('Evaluar alertas','POST','={{ $json.destino_alertas }}',[2700,0]),code('Resultado de alertas',resultado,[2940,0]),code('Sin evaluar alertas',sinEvaluar,[2220,300]));
const edge=name=>[{node:name,type:'main',index:0}];
Object.assign(f.connections,{
 'Resultado de persistencia':{main:[edge('Preparar evaluacion')]},
 'Preparar evaluacion':{main:[edge('Persistencia confirmada')]},
 'Persistencia confirmada':{main:[edge('Consultar nodo guardado'),edge('Sin evaluar alertas')]},
 'Consultar nodo guardado':{main:[edge('Preparar RPC alertas')]},
 'Preparar RPC alertas':{main:[edge('Nodo resuelto')]},
 'Nodo resuelto':{main:[edge('Evaluar alertas'),edge('Sin evaluar alertas')]},
 'Evaluar alertas':{main:[edge('Resultado de alertas')]},
});
f.nodes.find(n=>n.name==='Guia de prueba').parameters.content='## Ingesta + alertas\nRequiere migracion0006. Configurar supabase_url, MQTT y misma credencial apikey privada en los TRES HTTP.\nSolo este flujo publicado; no activar simultaneamente 03c/03d.\nEl nodo guardado se resuelve desde una medicion confirmada, no desde el payload.\nErrores de alertas mantienen persistido:true y alertas.estado pendiente. Revisar salidas, no solo color verde de ejecucion.\nSin reglas: evaluadas0 es esperado y no certifica salud.\nTres intentos por HTTP; sin cola durable ni barrido de recuperacion. No fijar/pinear capturas reales.';
fs.writeFileSync(path.join(__dirname,'03e-ingesta-alertas.json'),JSON.stringify(f,null,2)+'\n');
console.log('03e generado, inactivo y sin credenciales.');
