'use strict';

// V2 ambiental: tres mediciones y trazabilidad del indice ADC. No certifica lux.
function indiceLdr(adc) { return Math.round(adc * 1000 / 4095) / 10; }
function prevalidarAmbiental(entrada) {
  const no = codigo => ({ estado: 'rechazar', codigo });
  if (!objeto(entrada) || typeof entrada.message !== 'string') return no('MENSAJE_DEBE_SER_TEXTO');
  if (entrada.message.charCodeAt(0) === 0xfeff || Buffer.byteLength(entrada.message, 'utf8') > 2048) return no('CODIFICACION_O_TAMANO');
  if (entrada.retained === true) return no('RETAIN_NO_ADMITIDO');
  let p;
  try { p = leerJsonEstricto(entrada.message); }
  catch (e) { return no(['CLAVE_REPETIDA', 'PRECISION_NUMERICA'].includes(e.message) ? e.message : 'JSON_INVALIDO'); }
  if (!clavesExactas(p, ['version', 'nodo_codigo', 'mensaje_id', 'origen', 'tomada_en', 'mediciones', 'ldr'])) return no('CAMPOS_PAYLOAD');
  if (p.version !== 2) return no('VERSION');
  if (typeof p.nodo_codigo !== 'string' || /[\r\n]/.test(p.nodo_codigo) || !/^agv-[a-z0-9]+-[0-9]{2}$/.test(p.nodo_codigo)) return no('NODO_CODIGO');
  if (typeof p.mensaje_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(p.mensaje_id) || p.mensaje_id.length !== 36) return no('MENSAJE_ID');
  if (!['real', 'simulado'].includes(p.origen)) return no('ORIGEN');
  if (fechaUtc(p.tomada_en) === null) return no('FECHA_CAPTURA');
  if (entrada.topic !== `agrovigia/v2/${p.origen}/nodos/${p.nodo_codigo}/telemetria`) return no('TOPICO_NO_COINCIDE');
  if (!clavesExactas(p.ldr, ['metodo', 'adc_promedio']) || p.ldr.metodo !== 'adc12_10k_11db_v1' ||
      !Number.isInteger(p.ldr.adc_promedio) || p.ldr.adc_promedio < 0 || p.ldr.adc_promedio > 4095) return no('METODO_O_ADC_LDR');
  if (!Array.isArray(p.mediciones) || p.mediciones.length !== 3) return no('LOTE_AMBIENTAL_INCOMPLETO');
  const catalogo = {
    temperatura_aire: { unidad: '\u00b0C', min: -40, max: 80 },
    humedad_aire: { unidad: '% HR', min: 0, max: 100 },
    iluminacion_relativa: { unidad: '% relativo', min: 0, max: 100 },
  };
  const vistas = new Set();
  for (const m of p.mediciones) {
    if (!clavesExactas(m, ['variable_codigo', 'valor', 'unidad']) || typeof m.variable_codigo !== 'string' || !Object.hasOwn(catalogo, m.variable_codigo)) return no('CAMPOS_MEDICION');
    if (vistas.has(m.variable_codigo)) return no('VARIABLE_REPETIDA');
    vistas.add(m.variable_codigo);
    const r = catalogo[m.variable_codigo];
    if (m.unidad !== r.unidad) return no('UNIDAD');
    if (typeof m.valor !== 'number' || !Number.isFinite(m.valor) || m.valor < r.min || m.valor > r.max) return no('VALOR');
  }
  if (p.mediciones.find(m => m.variable_codigo === 'iluminacion_relativa').valor !== indiceLdr(p.ldr.adc_promedio)) return no('CONVERSION_LDR_NO_COINCIDE');
  const advertencias = ['INDICE_ADC_NO_CALIBRADO_EN_LUX'];
  if (p.mediciones.filter(m => m.variable_codigo !== 'iluminacion_relativa').every(m => m.valor === 0)) advertencias.push('PAR_CERO_REQUIERE_REVISION');
  if ([0, 4095].includes(p.ldr.adc_promedio)) advertencias.push('LDR_EN_EXTREMO_ADC');
  if (typeof entrada.retained !== 'boolean') advertencias.push('BANDERA_RETAIN_NO_DISPONIBLE');
  return {
    estado: 'prevalidado', codigo: 'FORMA_Y_TOPICO_VALIDOS', payload: p,
    perfil_payload: 'DHT22_LDR', recibida_en: entrada.recibida_en ?? null,
    retain_verificado: entrada.retained === false, advertencias,
    controles_pendientes: ['origen_por_acl', 'nodo_y_cultivo_autorizados', 'duplicados_transaccionales', 'ventana_temporal', 'persistencia'],
  };
}

// EXPORTACIONES_LOCALES: el generador elimina dependencias al incrustar.
const { objeto, clavesExactas, fechaUtc, leerJsonEstricto } = require('./validar-telemetria.cjs');
module.exports = { prevalidarAmbiental, indiceLdr };