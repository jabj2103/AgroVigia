'use strict';

// Logica reutilizable en el nodo Code de n8n. No abre servidor ni escribe datos.
function rechazar(codigo) { return { estado: 'rechazar', codigo }; }
function objeto(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function clavesExactas(value, keys) {
  return objeto(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
}
function fechaUtc(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return null;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value.replace('Z', '.000Z') ? epoch : null;
}

function leerJsonEstricto(texto) {
  // JSON.parse comprueba gramatica; este recorrido adicional detecta claves
  // duplicadas incluso si usan escapes y numeros con precision no representable.
  const value = JSON.parse(texto);
  let pos = 0;
  function espacio() { while (/\s/.test(texto[pos] ?? '') && pos < texto.length) pos++; }
  function cadena() {
    const inicio = pos++;
    while (pos < texto.length) {
      if (texto[pos] === '\\') pos += 2;
      else if (texto[pos++] === '"') return JSON.parse(texto.slice(inicio, pos));
    }
    throw new Error('JSON_INVALIDO');
  }
  function valor() {
    espacio();
    if (texto[pos] === '{') {
      pos++; espacio(); const vistas = new Set();
      if (texto[pos] === '}') { pos++; return; }
      while (true) {
        espacio(); const key = cadena();
        if (vistas.has(key)) throw new Error('CLAVE_REPETIDA');
        vistas.add(key); espacio(); pos++; valor(); espacio();
        if (texto[pos++] === '}') return;
      }
    }
    if (texto[pos] === '[') {
      pos++; espacio();
      if (texto[pos] === ']') { pos++; return; }
      while (true) { valor(); espacio(); if (texto[pos++] === ']') return; }
    }
    if (texto[pos] === '"') { cadena(); return; }
    const inicio = pos;
    while (pos < texto.length && !/[\s,\]}]/.test(texto[pos])) pos++;
    const token = texto.slice(inicio, pos);
    if (/^-?\d/.test(token)) {
      const [mantisa, exponente = '0'] = token.toLowerCase().split('e');
      const decimales = (mantisa.split('.')[1] ?? '').replace(/0+$/, '').length;
      if (decimales - Number(exponente) > 4) throw new Error('PRECISION_NUMERICA');
    }
  }
  valor();
  return value;
}

function prevalidarTelemetria(entrada) {
  if (!objeto(entrada) || typeof entrada.message !== 'string') return rechazar('MENSAJE_DEBE_SER_TEXTO');
  if (entrada.message.charCodeAt(0) === 0xfeff || Buffer.byteLength(entrada.message, 'utf8') > 2048) return rechazar('CODIFICACION_O_TAMANO');
  if (entrada.retained === true) return rechazar('RETAIN_NO_ADMITIDO');
  let p;
  try { p = leerJsonEstricto(entrada.message); }
  catch (error) { return rechazar(['CLAVE_REPETIDA', 'PRECISION_NUMERICA'].includes(error.message) ? error.message : 'JSON_INVALIDO'); }
  if (!clavesExactas(p, ['version', 'nodo_codigo', 'mensaje_id', 'origen', 'tomada_en', 'mediciones'])) return rechazar('CAMPOS_PAYLOAD');
  if (p.version !== 1) return rechazar('VERSION');
  if (typeof p.nodo_codigo !== 'string' || /[\r\n]/.test(p.nodo_codigo) || !/^agv-[a-z0-9]+-[0-9]{2}$/.test(p.nodo_codigo)) return rechazar('NODO_CODIGO');
  if (typeof p.mensaje_id !== 'string' || p.mensaje_id.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(p.mensaje_id)) return rechazar('MENSAJE_ID');
  if (!['real', 'simulado'].includes(p.origen)) return rechazar('ORIGEN');
  if (fechaUtc(p.tomada_en) === null) return rechazar('FECHA_CAPTURA');
  if (entrada.topic !== `agrovigia/v1/${p.origen}/nodos/${p.nodo_codigo}/telemetria`) return rechazar('TOPICO_NO_COINCIDE');
  if (!Array.isArray(p.mediciones) || p.mediciones.length < 1 || p.mediciones.length > 2) return rechazar('CANTIDAD_VARIABLES');
  const catalogo = {
    temperatura_aire: { unidad: '\u00b0C', min: -40, max: 80 },
    humedad_aire: { unidad: '% HR', min: 0, max: 100 },
    iluminacion_relativa: { unidad: '% relativo', min: 0, max: 100 },
  };
  const variables = new Set();
  for (const m of p.mediciones) {
    if (!clavesExactas(m, ['variable_codigo', 'valor', 'unidad']) || typeof m.variable_codigo !== 'string' || !Object.hasOwn(catalogo, m.variable_codigo)) return rechazar('CAMPOS_MEDICION');
    const regla = catalogo[m.variable_codigo];
    if (variables.has(m.variable_codigo)) return rechazar('VARIABLE_REPETIDA');
    variables.add(m.variable_codigo);
    if (m.unidad !== regla.unidad) return rechazar('UNIDAD');
    if (typeof m.valor !== 'number' || !Number.isFinite(m.valor) || m.valor < regla.min || m.valor > regla.max) return rechazar('VALOR');
  }
  const esDht = variables.size === 2 && variables.has('temperatura_aire') && variables.has('humedad_aire');
  const esLdr = variables.size === 1 && variables.has('iluminacion_relativa');
  if (!esDht && !esLdr) return rechazar('LOTE_INCOMPLETO_O_MIXTO');
  const advertencias = [];
  if (esDht && p.mediciones.every(m => m.valor === 0)) advertencias.push('PAR_CERO_REQUIERE_REVISION');
  if (typeof entrada.retained !== 'boolean') advertencias.push('BANDERA_RETAIN_NO_DISPONIBLE');
  return {
    estado: 'prevalidado', codigo: 'FORMA_Y_TOPICO_VALIDOS', payload: p,
    perfil_payload: esDht ? 'DHT22' : 'LDR',
    recibida_en: entrada.recibida_en ?? null,
    retain_verificado: entrada.retained === false,
    advertencias,
    controles_pendientes: ['origen_por_acl', 'nodo_y_cultivo_autorizados', 'duplicados_transaccionales', 'ventana_temporal', 'persistencia'],
  };
}

function contenidoCanonico(p) {
  return JSON.stringify({
    version: p.version, nodo_codigo: p.nodo_codigo, mensaje_id: p.mensaje_id,
    origen: p.origen, tomada_en: p.tomada_en,
    mediciones: [...p.mediciones].sort((a, b) => a.variable_codigo.localeCompare(b.variable_codigo)),
  }, (key, value) => objeto(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
}

// Evaluacion pura para preparar la futura operacion transaccional. El contexto
// debe provenir del servidor/catalogo, nunca del payload ni del navegador.
// No realiza consultas, bloqueos, RLS, inserciones ni reserva IDs contra carreras.
function evaluarContexto(prevalidado, contexto) {
  if (prevalidado.estado !== 'prevalidado') return prevalidado;
  if (!objeto(contexto) || contexto.acl_verificada !== true) return rechazar('ORIGEN_NO_VERIFICADO');
  if (!prevalidado.retain_verificado && contexto.retencion_broker_desactivada !== true) return rechazar('RETAIN_NO_VERIFICADO');
  const nodo = contexto.nodo;
  if (!objeto(nodo) || nodo.codigo !== prevalidado.payload.nodo_codigo) return rechazar('NODO_DESCONOCIDO');
  if (nodo.habilitado !== true) return rechazar('NODO_DESHABILITADO');
  if (nodo.perfil !== prevalidado.perfil_payload) return rechazar('CAPACIDAD_NODO');
  const p = prevalidado.payload;
  if (contexto.lote_previo !== null && contexto.lote_previo !== undefined) {
    const previo = contexto.lote_previo;
    if (!objeto(previo) || !Array.isArray(previo.mediciones)) return { estado: 'conflicto_id', codigo: 'LOTE_PREVIO_INCONSISTENTE' };
    try {
      const controlPrevio = prevalidarTelemetria({ topic: `agrovigia/v1/${previo.origen}/nodos/${previo.nodo_codigo}/telemetria`, message: JSON.stringify(previo) });
      if (controlPrevio.estado !== 'prevalidado') return { estado: 'conflicto_id', codigo: 'LOTE_PREVIO_INCONSISTENTE' };
    } catch { return { estado: 'conflicto_id', codigo: 'LOTE_PREVIO_INCONSISTENTE' }; }
    return contenidoCanonico(previo) === contenidoCanonico(p)
      ? { estado: 'duplicado', codigo: 'LOTE_IDENTICO_NO_REINSERTAR' }
      : { estado: 'conflicto_id', codigo: 'MISMO_ID_OTRO_CONTENIDO' };
  }
  if (!nodo.cultivo_id || !nodo.agricultor_id || nodo.agricultor_id !== nodo.cultivo_agricultor_id) return rechazar('CULTIVO_NO_AUTORIZADO');
  if (p.origen === 'real' && nodo.perfil === 'LDR' && contexto.conversion_ldr_real_aprobada !== true) return rechazar('ESCALA_LDR_PENDIENTE');
  const recepcionTexto = prevalidado.recibida_en;
  const recibida = typeof recepcionTexto === 'string' ? Date.parse(recepcionTexto) : NaN;
  const tomada = fechaUtc(p.tomada_en);
  const recepcionNormalizada = typeof recepcionTexto === 'string' ? recepcionTexto.replace(/Z$/, '.000Z') : null;
  if (!Number.isFinite(recibida) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(recepcionTexto) ||
      ![recepcionTexto, recepcionNormalizada].includes(new Date(recibida).toISOString())) return rechazar('FECHA_RECEPCION');
  if (tomada < recibida - 300000 || tomada > recibida + 120000) return rechazar('VENTANA_TEMPORAL');
  return { estado: 'aceptar', codigo: 'CONTEXTO_VALIDO_PENDIENTE_TRANSACCION', advertencias: prevalidado.advertencias };
}

// EXPORTACIONES_LOCALES: el generador elimina esta seccion al incrustar en n8n.
module.exports = { prevalidarTelemetria, evaluarContexto, leerJsonEstricto, objeto, clavesExactas, fechaUtc };
