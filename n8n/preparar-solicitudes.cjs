'use strict';
// Logica pura del flujo 03h: sugerencias de IA a peticion del agricultor. Cada 30 s toma las solicitudes
// pendientes (tabla solicitudes_ia, 0011), pide a la base el contexto de cada una, consulta a Gemini con el
// mismo armado de preparar-sugerencias.cjs y cierra la solicitud. Sin datos o sin cupo, la base la cierra
// sola y aqui no se gasta IA. Nunca incluye claves ni devuelve cuerpos de error HTTP.
// En el Code de n8n este archivo va despues de preparar-sugerencias.cjs, del que usa prepararGemini,
// interpretarGemini, esUuidIA y MODELO_IA.
const LIMITE_SOLICITUDES = 3;

// 1. Destinos y modelo desde la configuracion del nodo Proyecto Supabase.
function prepararToma(config) {
  const m = typeof config?.supabase_url === 'string' && config.supabase_url.match(/^((?:https:\/\/[a-z0-9-]+\.supabase\.co|http:\/\/(?:127\.0\.0\.1|localhost|host\.docker\.internal):[0-9]{2,5}))\/?$/);
  if (!m) return { lista: false, codigo: 'CONFIGURAR_URL_SUPABASE' };
  if (typeof config.gemini_modelo !== 'string' || !MODELO_IA.test(config.gemini_modelo)) return { lista: false, codigo: 'CONFIGURAR_MODELO_GEMINI' };
  const rpc = m[1] + '/rest/v1/rpc/';
  return { lista: true, codigo: 'POR_TOMAR', modelo_ia: config.gemini_modelo, destino_tomar: rpc + 'tomar_solicitudes_ia', solicitud_tomar: { p_limite: LIMITE_SOLICITUDES },
    destino_preparar: rpc + 'preparar_solicitud_ia', destino_completar: rpc + 'completar_solicitud_ia' };
}

// 2. Una entrada por solicitud tomada. Sin solicitudes (lo habitual) devuelve una lista vacia y el flujo termina.
function repartirSolicitudes(toma, respuesta) {
  const r = respuesta?.statusCode === 200 ? respuesta.body : null;
  if (!toma?.lista || !r || r.codigo !== 'SOLICITUDES_TOMADAS' || !Array.isArray(r.solicitudes)) return [];
  return r.solicitudes.filter(s => esUuidIA(s?.solicitud_id) && ['real', 'simulado'].includes(s.origen)).slice(0, 10).map(s => ({
    lista: true, solicitud_id: s.solicitud_id, cultivo_id: s.cultivo_id, origen: s.origen, modelo_ia: toma.modelo_ia,
    solicitud: { estado: 'en_proceso', codigo: 'POR_PREPARAR' }, ia: { estado: 'pendiente', codigo: 'POR_RESERVAR' },
    destino_preparar: toma.destino_preparar, destino_completar: toma.destino_completar, solicitud_preparar: { p_solicitud_id: s.solicitud_id } }));
}

// 3. Con la reserva de la base arma la consulta a Gemini (misma instruccion y esquema que el flujo automatico).
// Si la base cerro o aplazo la solicitud, no hay consulta.
function prepararGeminiSolicitud(previo, respuesta) {
  const r = respuesta?.statusCode === 200 && respuesta.body && typeof respuesta.body === 'object' && !Array.isArray(respuesta.body) ? respuesta.body : null;
  if (r && r.solicitud_id !== previo.solicitud_id) return { ...previo, lista: false, solicitud: { estado: 'en_proceso', codigo: 'RESPUESTA_DE_OTRA_SOLICITUD' }, ia: { estado: 'omitida', codigo: 'RESERVA_NO_CONFIRMADA' } };
  const g = prepararGemini(previo, respuesta);
  if (g.lista) return { ...g, solicitud: { estado: 'en_proceso', codigo: 'POR_CONSULTAR_GEMINI' } };
  if (r?.codigo === 'SOLICITUD_CERRADA' && ['sin_datos', 'rechazada', 'error', 'atendida'].includes(r.estado))
    return { ...g, solicitud: { estado: r.estado, codigo: r.codigo, detalle: typeof r.detalle === 'string' ? r.detalle.slice(0, 60) : null } };
  if (r?.codigo === 'SOLICITUD_APLAZADA') return { ...g, solicitud: { estado: 'pendiente', codigo: r.codigo, detalle: 'SUGERENCIA_EN_CURSO' } };
  // Sin respuesta valida la solicitud sigue en proceso: la base la recupera a los 5 minutos.
  return { ...g, solicitud: { estado: 'en_proceso', codigo: typeof r?.codigo === 'string' ? r.codigo.slice(0, 60) : 'PREPARACION_NO_CONFIRMADA' } };
}

// 4. Interpreta a Gemini igual que el flujo automatico y dirige el guardado a completar_solicitud_ia,
// que guarda la sugerencia y cierra la solicitud en una sola transaccion.
function completarSolicitud(previo, respuesta) {
  const x = interpretarGemini(previo, respuesta);
  const { p_sugerencia_id, ...resto } = x.solicitud_completar;
  return { ...x, solicitud_completar: { p_solicitud_id: previo.solicitud_id, ...resto } };
}

function resumenSolicitud(previo) {
  const { lista, destino_preparar, destino_completar, destino_gemini, destino_reserva, solicitud_preparar, solicitud_gemini, solicitud_completar, modelo_ia, ...resto } = previo ?? {};
  return resto;
}
// 5. Resultado final de cada solicitud.
function resultadoSolicitud(previo, respuesta) {
  const r = respuesta?.statusCode === 200 ? respuesta.body : null, c = previo.solicitud_completar ?? {};
  const ia = { ...previo.ia, modelo: c.p_modelo ?? previo.modelo_ia, tokens: { entrada: c.p_tokens_entrada ?? null, salida: c.p_tokens_salida ?? null } };
  if (!r || !['SOLICITUD_CERRADA', 'SOLICITUD_YA_CERRADA'].includes(r.codigo) || r.solicitud_id !== previo.solicitud_id)
    return { ...resumenSolicitud(previo), solicitud: { estado: 'en_proceso', codigo: 'CIERRE_NO_CONFIRMADO' }, ia: { ...ia, estado: 'pendiente', codigo: 'GUARDADO_IA_NO_CONFIRMADO', error_gemini: c.p_error_codigo ?? null } };
  return { ...resumenSolicitud(previo), solicitud: { estado: r.estado, codigo: r.codigo, detalle: r.detalle ?? null },
    ia: { ...ia, estado: r.estado === 'atendida' ? 'generada' : 'fallida', codigo: r.estado === 'atendida' ? 'SUGERENCIA_GUARDADA' : 'SUGERENCIA_FALLIDA', error_codigo: r.detalle ?? null } };
}
function solicitudSinIA(previo) { return resumenSolicitud(previo); }

// EXPORTACIONES_LOCALES:
const { prepararGemini, interpretarGemini, esUuidIA, MODELO_IA } = require('./preparar-sugerencias.cjs');
module.exports = { prepararToma, repartirSolicitudes, prepararGeminiSolicitud, completarSolicitud, resultadoSolicitud, solicitudSinIA, LIMITE_SOLICITUDES };
