'use strict';
// Logica pura del flujo 03i: ingesta REAL por HTTPS con clave propia de cada nodo fisico (migracion 0012).
// El webhook no usa la clave compartida de 03g: cada placa envia su codigo y su clave en cabeceras, y el
// cuerpo es el mismo JSON v2 que el firmware publica por MQTT. Aqui se arma el topico real del nodo y se
// sigue con la preparacion de 03e, de modo que validacion, guardado, alertas e IA son los mismos.
// Una clave de nodo solo sirve para escribir datos reales de ese nodo. Nunca se devuelve ni se registra.
// En el Code de n8n este archivo va despues de preparar-http.cjs, del que usa respuestaHttp.
const CODIGO_NODO_HTTPS = /^agv-[a-z0-9]+-[0-9]{2}$/;
const CLAVE_INVALIDA = { codigo_http: 401, cuerpo: { estado: 'rechazado', codigo: 'CLAVE_INVALIDA' } };

// 1. Cabeceras X-AgroVigia-Nodo y X-AgroVigia-Clave. Sin ellas no se consulta la base.
function prepararAutenticacionNodo(json) {
  const rechazo = { lista: false, estado: 'rechazado', codigo: 'CLAVE_INVALIDA', persistido: false, respuesta_http: CLAVE_INVALIDA };
  const cabeceras = json?.headers && typeof json.headers === 'object' ? json.headers : {};
  const codigo = cabeceras['x-agrovigia-nodo'], clave = cabeceras['x-agrovigia-clave'];
  if (typeof codigo !== 'string' || !CODIGO_NODO_HTTPS.test(codigo) || codigo.length > 64) return rechazo;
  if (typeof clave !== 'string' || clave.length < 20 || clave.length > 200 || /\s/.test(clave)) return rechazo;
  const m = typeof json.supabase_url === 'string' && json.supabase_url.match(/^((?:https:\/\/[a-z0-9-]+\.supabase\.co|http:\/\/(?:127\.0\.0\.1|localhost|host\.docker\.internal):[0-9]{2,5}))\/?$/);
  if (!m) return { lista: false, estado: 'pendiente', codigo: 'CONFIGURAR_URL_SUPABASE', persistido: false,
    respuesta_http: { codigo_http: 503, cuerpo: { estado: 'pendiente', codigo: 'CONFIGURAR_URL_SUPABASE' } } };
  return { lista: true, nodo_codigo: codigo, supabase_url: m[1], cuerpo: json.body,
    destino_autenticar: m[1] + '/rest/v1/rpc/autenticar_nodo', solicitud_autenticar: { p_codigo: codigo, p_clave: clave } };
}

// Respuesta al nodo: la de 03g mas su intervalo y su pausa, para que el firmware se adapte.
function respuestaNodo(resultado, nodo) {
  const r = respuestaHttp(resultado);
  return { codigo_http: r.codigo_http, cuerpo: { ...r.cuerpo, intervalo_segundos: nodo.intervalo_segundos, pausado: nodo.pausado } };
}

// 2. Con la respuesta de autenticar_nodo: clave rechazada 401, sin confirmacion 503; autenticado, el cuerpo
// pasa por la misma preparacion v2 de 03e con el topico real de ESE nodo.
function prepararIngestaNodo(previo, respuesta, canal, recibidaEn, prepararV2) {
  const a = respuesta?.statusCode === 200 && respuesta.body && typeof respuesta.body === 'object' && !Array.isArray(respuesta.body) ? respuesta.body : null;
  if (!a || !['NODO_AUTENTICADO', 'CLAVE_INVALIDA'].includes(a.codigo)) {
    const r = { estado: 'pendiente', codigo: 'AUTENTICACION_NO_CONFIRMADA', persistido: false, canal_entrada: 'https_nodo' };
    return { ...r, respuesta_http: { codigo_http: 503, cuerpo: { estado: 'pendiente', codigo: r.codigo } } };
  }
  if (a.codigo !== 'NODO_AUTENTICADO' || a.nodo_codigo !== previo.nodo_codigo)
    return { estado: 'rechazado', codigo: 'CLAVE_INVALIDA', persistido: false, canal_entrada: 'https_nodo', respuesta_http: CLAVE_INVALIDA };
  const nodo = { intervalo_segundos: Number.isInteger(a.intervalo_segundos) ? a.intervalo_segundos : null, pausado: a.pausado === true };
  const rechazo = codigo => { const r = { estado: 'rechazado', codigo, persistido: false, canal_entrada: 'https_nodo', nodo_http: nodo }; return { ...r, respuesta_http: respuestaNodo(r, nodo) }; };
  const cuerpo = previo.cuerpo;
  let mensaje;
  if (typeof cuerpo === 'string') mensaje = cuerpo;
  else if (cuerpo && typeof cuerpo === 'object' && !Array.isArray(cuerpo)) {
    // La clave autentica a un nodo: no puede enviar lotes de otro ni datos de origen simulado.
    if (cuerpo.nodo_codigo !== previo.nodo_codigo) return rechazo('NODO_NO_COINCIDE');
    if (cuerpo.origen !== 'real') return rechazo('SOLO_ORIGEN_REAL');
    mensaje = JSON.stringify(cuerpo);
  } else return rechazo('CUERPO_HTTP_INVALIDO');
  const entrada = { topic: 'agrovigia/v2/real/nodos/' + previo.nodo_codigo + '/telemetria', message: mensaje, supabase_url: previo.supabase_url };
  const salida = { ...prepararV2(entrada, canal, recibidaEn), canal_entrada: 'https_nodo', nodo_http: nodo };
  if (salida.fuente_recibida_en) salida.fuente_recibida_en = 'inicio_validacion_http_aproximado';
  if (salida.estado === 'prevalidado') return salida;
  salida.estado = 'rechazado'; salida.persistido = false;
  return { ...salida, respuesta_http: respuestaNodo(salida, nodo) };
}

// 3. Resume la respuesta de la RPC de guardado y arma la respuesta para el nodo.
function resumirPersistenciaNodo(resultado, preparado, resumirV2) {
  let r;
  try { r = resumirV2(resultado); }
  catch { r = { estado: 'pendiente', codigo: 'RPC_SIN_CONFIRMACION', mensaje_id: preparado?.payload?.mensaje_id, persistido: null, nuevo_lote: false }; }
  return { ...r, respuesta_http: respuestaNodo(r, preparado?.nodo_http ?? { intervalo_segundos: null, pausado: false }) };
}

// EXPORTACIONES_LOCALES:
const { respuestaHttp } = require('./preparar-http.cjs');
module.exports = { prepararAutenticacionNodo, prepararIngestaNodo, resumirPersistenciaNodo, respuestaNodo };
