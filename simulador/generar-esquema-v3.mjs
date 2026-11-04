import {writeFileSync} from 'node:fs';
import {VARIABLES,ESCENARIOS} from './public/motor.mjs';
const uuid={type:'string',minLength:36,maxLength:36,pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'};
const fecha={type:'string',minLength:24,maxLength:24,format:'date-time',pattern:'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$'};
const obj=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const mediciones=VARIABLES.map(v=>{
 const meta={fuente:{const:'generador_sintetico_v1'}};
 if(['humedad_suelo_vwc','temperatura_suelo'].includes(v.codigo))meta.profundidad_cm={const:20};
 if(v.codigo==='iluminacion_relativa')meta.metodo={const:'indice_relativo_sintetico_v1'};
 if(v.codigo==='conductividad_suelo_ece')Object.assign(meta,{metodo:{const:'extracto_pasta_saturada_ECe'},temperatura_referencia_c:{const:25}});
 if(v.codigo==='precipitacion_60min')Object.assign(meta,{ventana:{const:'movil'},periodo_segundos:{const:3600},inicio_periodo:fecha,fin_periodo:fecha,acumulados_no_sumables:{const:true}});
 return obj({variable_codigo:{const:v.codigo},valor:{type:'number',minimum:v.min,maximum:v.max,multipleOf:0.0001},unidad:{const:v.codigo==='ph_suelo'?'sin unidad':v.unidad},origen:{const:'simulado'},metadatos:obj(meta)});
});
const schema={$schema:'https://json-schema.org/draft/2020-12/schema',title:'AgroVigia telemetria simulada v3',description:'Solo nodos virtuales autorizados. Esquema de forma: no acredita ACL, propietario, asignacion, frescura ni semantica de ventanas. Esas comprobaciones son del receptor/RPC.',...obj({version:{const:3},nodo_codigo:{type:'string',minLength:6,maxLength:50,pattern:'^sim-[a-z0-9][a-z0-9-]{1,45}$'},mensaje_id:uuid,origen:{const:'simulado'},tomada_en:fecha,asignacion_version:uuid,simulacion:{...obj({ejecucion_id:uuid,semilla:{type:'integer',minimum:1,maximum:999999999},escenario_id:{enum:ESCENARIOS.map(s=>s.id)},modo:{enum:['manual','escenario']},paso:{type:'integer',minimum:0,maximum:12},pasos_transicion:{const:12}}),allOf:[{if:{properties:{modo:{const:'manual'}}},then:{properties:{paso:{const:0}}}}]},mediciones:{type:'array',minItems:10,maxItems:10,items:{oneOf:mediciones},allOf:VARIABLES.map(v=>({contains:{type:'object',required:['variable_codigo'],properties:{variable_codigo:{const:v.codigo}}},minContains:1,maxContains:1}))}})};
writeFileSync(new URL('../docs/mqtt/telemetria-simulada-v3.schema.json',import.meta.url),JSON.stringify(schema,null,2)+'\n');
console.log('Esquema JSON v3 generado desde el catalogo del simulador.');
