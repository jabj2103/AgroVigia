'use strict';
// Logica pura del flujo 03g (ingesta por HTTP, para desplegar sin puerto MQTT). El webhook recibe
// {"topico", "payload"} y aqui se convierte en lo mismo que entrega el disparador MQTT ({topic, message}),
// de modo que la validacion, el guardado, las alertas y la IA son los de 03e (v2) y 03f (v3).
// Nunca incluye claves: la cabecera X-AgroVigia-Clave la comprueba el nodo Webhook con su credencial.
const TOPICO_HTTP_V2 = /^agrovigia\/v2\/(real|simulado)\/nodos\/[a-z0-9-]{1,64}\/telemetria$/;
const TOPICO_HTTP_V3 = /^agrovigia\/v3\/simulado\/nodos\/[a-z0-9-]{1,64}\/telemetria$/;

// Codigo HTTP y cuerpo {estado, codigo} que recibe quien envio el lote:
//   200 guardado o duplicado confirmado; 400 lote rechazado (no reintentar);
//   503 guardado sin confirmar (reintentar el mismo lote: el guardado es idempotente).
function respuestaHttp(resultado) {
  const estado = typeof resultado?.estado === 'string' ? resultado.estado : 'pendiente';
  const codigo = typeof resultado?.codigo === 'string' ? resultado.codigo.slice(0, 80) : 'SIN_CODIGO';
  if (resultado?.persistido === true && ['insertado', 'duplicado'].includes(estado)) return { codigo_http: 200, cuerpo: { estado, codigo } };
  if (['rechazado', 'conflicto_id'].includes(estado)) return { codigo_http: 400, cuerpo: { estado, codigo } };
  return { codigo_http: 503, cuerpo: { estado: 'pendiente', codigo } };
}

// 'json' es el item del webhook mas la configuracion del nodo Proyecto Supabase.
// Por HTTP no hay ACL del broker que separe origenes: la clave es compartida. Por eso un topico de origen
// real solo se admite si el flujo lo habilita de forma expresa (http_admite_real = "si").
function prepararIngestaHttp(json, canal, recibidaEn, prepararV2, prepararV3) {
  const rechazo = codigo => { const r = { estado: 'rechazado', codigo, persistido: false, canal_entrada: 'http' }; return { ...r, respuesta_http: respuestaHttp(r) }; };
  const cuerpo = json?.body;
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo) || Object.keys(cuerpo).sort().join() !== 'payload,topico') return rechazo('CUERPO_HTTP_INVALIDO');
  if (typeof cuerpo.topico !== 'string') return rechazo('TOPICO_NO_ADMITIDO');
  const v2 = TOPICO_HTTP_V2.exec(cuerpo.topico), v3 = TOPICO_HTTP_V3.test(cuerpo.topico);
  if (!v2 && !v3) return rechazo('TOPICO_NO_ADMITIDO');
  if (v2 && v2[1] === 'real' && json.http_admite_real !== 'si') return rechazo('ORIGEN_REAL_NO_ADMITIDO_POR_HTTP');
  // El lote llega como objeto JSON (o como su texto exacto); los validadores trabajan sobre el texto.
  let mensaje;
  if (typeof cuerpo.payload === 'string') mensaje = cuerpo.payload;
  else if (cuerpo.payload && typeof cuerpo.payload === 'object' && !Array.isArray(cuerpo.payload)) mensaje = JSON.stringify(cuerpo.payload);
  else return rechazo('PAYLOAD_DEBE_SER_OBJETO');
  const entrada = { topic: cuerpo.topico, message: mensaje, supabase_url: json.supabase_url };
  const r = v3 ? prepararV3(entrada, canal, recibidaEn) : prepararV2(entrada, canal, recibidaEn);
  const salida = { ...r, canal_entrada: 'http' };
  if (salida.fuente_recibida_en) salida.fuente_recibida_en = 'inicio_validacion_http_aproximado';
  if (salida.estado === 'prevalidado') return salida;
  salida.estado = 'rechazado'; salida.persistido = false;
  return { ...salida, respuesta_http: respuestaHttp(salida) };
}

// Resume la respuesta de la RPC con la funcion del contrato que corresponde y agrega la respuesta HTTP.
// Si Supabase no confirma, el resultado queda pendiente (503) en lugar de detener la ejecucion.
function resumirPersistenciaHttp(resultado, preparado, resumirV2, resumirV3) {
  let r;
  if (typeof preparado?.destino_rpc === 'string' && preparado.destino_rpc.endsWith('/rest/v1/rpc/registrar_lote_simulado_v3')) r = resumirV3(resultado, preparado);
  else {
    try { r = resumirV2(resultado); }
    catch { r = { estado: 'pendiente', codigo: 'RPC_SIN_CONFIRMACION', mensaje_id: preparado?.payload?.mensaje_id, persistido: null, nuevo_lote: false }; }
  }
  return { ...r, respuesta_http: respuestaHttp(r) };
}

// EXPORTACIONES_LOCALES:
module.exports = { prepararIngestaHttp, resumirPersistenciaHttp, respuestaHttp };
