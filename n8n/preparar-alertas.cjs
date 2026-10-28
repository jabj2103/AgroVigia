'use strict';
// Logica pura; nunca incluye claves ni devuelve cuerpos de error HTTP.
const esUuidAlerta = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
function prepararEvaluacionAlertas(persistencia, ingesta) {
  const base = { persistencia, alertas: { estado: 'omitida', codigo: 'PERSISTENCIA_NO_CONFIRMADA' }, lista: false };
  if (!persistencia || persistencia.persistido !== true || !['insertado','duplicado'].includes(persistencia.estado)) return base;
  const ids=persistencia.medicion_ids;
  if (!esUuidAlerta(persistencia.mensaje_id) || !esUuidAlerta(persistencia.cultivo_id) || !Array.isArray(ids) || ids.length!==3 || !ids.every(esUuidAlerta) || new Set(ids).size!==3 ||
    ingesta?.payload?.mensaje_id!==persistencia.mensaje_id || !['real','simulado'].includes(ingesta?.payload?.origen)) {
    return {...base,alertas:{estado:'pendiente',codigo:'CONTEXTO_PERSISTENCIA_INCONSISTENTE'}};
  }
  const match=typeof ingesta?.destino_rpc==='string' && ingesta.destino_rpc.match(/^(https:\/\/[a-z0-9-]+\.supabase\.co)\/rest\/v1\/rpc\/registrar_lote_ambiental$/);
  if(!match)return {...base,alertas:{estado:'pendiente',codigo:'DESTINO_ALERTAS_NO_VALIDO'}};
  const consulta=match[1]+'/rest/v1/mediciones?select=id,nodo_id,cultivo_id,mensaje_id,origen&id=eq.'+ids[0]+'&cultivo_id=eq.'+persistencia.cultivo_id+'&mensaje_id=eq.'+persistencia.mensaje_id+'&origen=eq.'+ingesta.payload.origen+'&limit=2';
  return {...base,lista:true,alertas:{estado:'pendiente',codigo:'POR_EVALUAR'},consulta_nodo_url:consulta,destino_alertas:match[1]+'/rest/v1/rpc/evaluar_alertas_lote',origen:ingesta.payload.origen};
}
function prepararRpcAlertas(contexto,respuesta) {
  const base={...contexto,lista:false};
  const filas=respuesta?.statusCode===200 && Array.isArray(respuesta.body) ? respuesta.body : null;
  const f=filas?.length===1?filas[0]:null;
  if(!f || f.id!==contexto.persistencia.medicion_ids[0] || f.cultivo_id!==contexto.persistencia.cultivo_id || f.mensaje_id!==contexto.persistencia.mensaje_id || f.origen!==contexto.origen || !esUuidAlerta(f.nodo_id))
    return {...base,alertas:{estado:'pendiente',codigo:'NO_SE_PUDO_RESOLVER_NODO_GUARDADO'}};
  return {...base,lista:true,solicitud_alertas:{p_nodo_id:f.nodo_id,p_mensaje_id:f.mensaje_id}};
}
function resultadoAlertas(contexto,respuesta) {
  const final={...contexto.persistencia,alertas:{estado:'pendiente',codigo:'EVALUACION_NO_CONFIRMADA',observacion:'Las mediciones siguen guardadas. Revisar esta ejecucion; no se confirma evaluacion de alertas.'}};
  const r=respuesta?.statusCode===200 ? respuesta.body : null;
  if(!r || typeof r!=='object' || Array.isArray(r))return final;
  if(['NODO_NO_ACTIVO','CULTIVO_NO_ACTIVO'].includes(r.codigo) && r.evaluadas===0)
    return {...final,alertas:{estado:'omitida',codigo:r.codigo,evaluadas:0}};
  const campos=['evaluadas','abiertas','actualizadas','cerradas'];
  if(r.codigo!=='LOTE_EVALUADO' || !campos.every(k=>Number.isInteger(r[k]) && r[k]>=0 && r[k]<=3) || r.abiertas+r.actualizadas>r.evaluadas || r.cerradas>r.evaluadas)return final;
  return {...final,alertas:{estado:'evaluada',codigo:r.codigo,...Object.fromEntries(campos.map(k=>[k,r[k]])),
    observacion:r.evaluadas===0?'Sin mediciones nuevas aplicables a reglas activas. No indica salud del cultivo ni ausencia de alertas previas.':'Evaluacion confirmada de las mediciones aplicables.'}};
}
function salidaSinEvaluar(contexto){return {...contexto.persistencia,alertas:contexto.alertas};}
// EXPORTACIONES_LOCALES:
module.exports={prepararEvaluacionAlertas,prepararRpcAlertas,resultadoAlertas,salidaSinEvaluar};
