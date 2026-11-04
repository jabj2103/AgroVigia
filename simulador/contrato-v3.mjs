// Adaptador puro. Preparar un mensaje no lo publica ni acredita autorizacion.
import { VARIABLES, ZONAS, CULTIVOS, ESCENARIOS, PASOS, validarSemilla } from './public/motor.mjs';
const uuid4=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const codigoVirtual=/^sim-[a-z0-9][a-z0-9-]{1,45}$/;
function exacto(obj,keys,nombre){
 if(!obj||typeof obj!=='object'||Array.isArray(obj)||Object.keys(obj).sort().join('|')!==[...keys].sort().join('|'))throw new Error(`Campos inválidos: ${nombre}.`);
}
function fechaUtc(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))throw new Error('Fecha UTC con milisegundos requerida.');
 const date=new Date(value);if(!Number.isFinite(date.getTime())||date.toISOString()!==value)throw new Error('Fecha no válida.');return date;
}
function iguales(a,b){
 if(a===null||b===null||typeof a!=='object'||typeof b!=='object')return a===b;
 return Object.keys(a).sort().join('|')===Object.keys(b).sort().join('|')&&Object.keys(a).every(k=>iguales(a[k],b[k]));
}
export function validarMensajeV3(p){
 exacto(p,['version','nodo_codigo','mensaje_id','origen','tomada_en','asignacion_version','simulacion','mediciones'],'mensaje v3');
 if(p.version!==3||p.origen!=='simulado'||typeof p.nodo_codigo!=='string'||/[\r\n]/.test(p.nodo_codigo)||!codigoVirtual.test(p.nodo_codigo)||typeof p.mensaje_id!=='string'||p.mensaje_id.length!==36||!uuid4.test(p.mensaje_id)||typeof p.asignacion_version!=='string'||p.asignacion_version.length!==36||!uuid4.test(p.asignacion_version))throw new Error('Identidad, versión u origen inválidos.');
 const fecha=fechaUtc(p.tomada_en),s=p.simulacion;
 exacto(s,['ejecucion_id','semilla','escenario_id','modo','paso','pasos_transicion'],'simulación');
 if(typeof s.ejecucion_id!=='string'||s.ejecucion_id.length!==36||!uuid4.test(s.ejecucion_id)||typeof s.semilla!=='number'||validarSemilla(s.semilla)!==s.semilla
  ||!ESCENARIOS.some(e=>e.id===s.escenario_id)||!['manual','escenario'].includes(s.modo)
  ||!Number.isInteger(s.paso)||s.paso<0||s.paso>PASOS||s.pasos_transicion!==PASOS||(s.modo==='manual'&&s.paso!==0))throw new Error('Contexto de simulación inválido.');
 if(!Array.isArray(p.mediciones)||p.mediciones.length!==VARIABLES.length)throw new Error('Se requieren diez variables.');
 const vistos=new Set();
 for(const m of p.mediciones){
  exacto(m,['variable_codigo','valor','unidad','origen','metadatos'],'medición');
  const v=VARIABLES.find(v=>v.codigo===m.variable_codigo);
  if(!v||vistos.has(m.variable_codigo)||m.origen!=='simulado'||typeof m.valor!=='number'||m.unidad!==(v.codigo==='ph_suelo'?'sin unidad':v.unidad))throw new Error('Variable, unidad u origen inválidos.');
  if(!Number.isFinite(m.valor)||m.valor<v.min||m.valor>v.max||Number(m.valor.toFixed(4))!==m.valor)throw new Error('Valor fuera de rango o precisión no admitida.');
  vistos.add(m.variable_codigo);
  const expected={fuente:'generador_sintetico_v1'};
  if(['humedad_suelo_vwc','temperatura_suelo'].includes(v.codigo))expected.profundidad_cm=20;
  if(v.codigo==='iluminacion_relativa')expected.metodo='indice_relativo_sintetico_v1';
  if(v.codigo==='conductividad_suelo_ece')Object.assign(expected,{metodo:'extracto_pasta_saturada_ECe',temperatura_referencia_c:25});
  if(v.codigo==='precipitacion_60min')Object.assign(expected,{ventana:'movil',periodo_segundos:3600,inicio_periodo:new Date(fecha.getTime()-3600000).toISOString(),fin_periodo:fecha.toISOString(),acumulados_no_sumables:true});
  if(!iguales(m.metadatos,expected))throw new Error('Metadatos de variable no compatibles.');
 }
 if(new TextEncoder().encode(JSON.stringify(p)).length>8192)throw new Error('Mensaje mayor de 8192 bytes.');
 return structuredClone(p);
}
export function prepararCapturaV3(local,vinculo){
 exacto(local,['formato','mensaje_id','nodo_codigo','origen','tomada_en','simulacion','mediciones'],'captura local');
 exacto(vinculo,['nodo_local','nodo_codigo','asignacion_version'],'vínculo autorizado');
 const z=ZONAS.find(z=>z.nodo===local.nodo_codigo);
 if(local.formato!=='agrovigia.simulacion.local.v1'||local.origen!=='simulado'||!z||vinculo.nodo_local!==z.nodo)throw new Error('Captura o mapeo local no compatibles.');
 const s=local.simulacion;
 exacto(s,['ejecucion_id','semilla','escenario_id','modo','paso','pasos_transicion','zona_codigo','zona_nombre','cultivo_ejemplo'],'contexto local');
 if(s.zona_codigo!==z.codigo||s.zona_nombre!==z.nombre||!CULTIVOS.includes(s.cultivo_ejemplo))throw new Error('Contexto local inconsistente.');
 const payload=validarMensajeV3({version:3,nodo_codigo:vinculo.nodo_codigo,mensaje_id:local.mensaje_id,origen:'simulado',tomada_en:local.tomada_en,
  asignacion_version:vinculo.asignacion_version,simulacion:{ejecucion_id:s.ejecucion_id,semilla:s.semilla,escenario_id:s.escenario_id,modo:s.modo,paso:s.paso,pasos_transicion:s.pasos_transicion},mediciones:structuredClone(local.mediciones)});
 return {topico:`agrovigia/v3/simulado/nodos/${payload.nodo_codigo}/telemetria`,payload,mensaje:JSON.stringify(payload)};
}
