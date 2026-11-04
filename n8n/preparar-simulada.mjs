import { validarMensajeV3 } from '../simulador/contrato-v3.mjs';
import validador from './validar-telemetria.cjs';
const { leerJsonEstricto } = validador;

export function prepararIngestaSimulada(entrada, configuracion, recibidaEn) {
  const rechazo = codigo => ({ estado: 'rechazado', codigo, origen: 'simulado', persistido: false });
  if (configuracion?.acl_verificada !== true || configuracion?.retencion_broker_desactivada !== true) return rechazo('CANAL_LOCAL_NO_VERIFICADO');
  if (typeof recibidaEn !== 'string' || !Number.isFinite(Date.parse(recibidaEn)) || new Date(recibidaEn).toISOString() !== recibidaEn) return rechazo('FECHA_RECEPCION');
  if (typeof entrada?.message !== 'string') return rechazo('MENSAJE_DEBE_SER_TEXTO');
  if (entrada.message.charCodeAt(0) === 0xfeff || Buffer.byteLength(entrada.message, 'utf8') > 8192) return rechazo('CODIFICACION_O_TAMANO');
  if (entrada.retained === true || entrada.retain === true) return rechazo('RETAIN_NO_ADMITIDO');
  let payload;
  try { payload = validarMensajeV3(leerJsonEstricto(entrada.message)); }
  catch (error) { return rechazo(['CLAVE_REPETIDA', 'PRECISION_NUMERICA'].includes(error.message) ? error.message : 'PAYLOAD_V3_INVALIDO'); }
  if (entrada.topic !== `agrovigia/v3/simulado/nodos/${payload.nodo_codigo}/telemetria`) return rechazo('TOPICO_NO_COINCIDE');
  if (typeof entrada.supabase_url !== 'string' || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(entrada.supabase_url)) return rechazo('CONFIGURAR_URL_SUPABASE');
  return {
    estado: 'prevalidado', codigo: 'FORMA_V3_VALIDA', origen: 'simulado', persistido: false,
    mensaje_id: payload.mensaje_id, nodo_codigo: payload.nodo_codigo, tomada_en: payload.tomada_en,
    recibida_en: recibidaEn, fuente_recibida_en: 'inicio_validacion_mqtt_aproximado',
    destino_rpc: entrada.supabase_url.replace(/\/$/, '') + '/rest/v1/rpc/registrar_lote_simulado_v3',
    solicitud_rpc: { p_topico: entrada.topic, p_mensaje: entrada.message, p_recibida_en: recibidaEn,
      p_acl_verificada: true, p_retenido: null, p_retencion_broker_desactivada: true },
  };
}

export function resumirPersistenciaSimulada(resultado, preparado) {
  const pendiente = codigo => ({ estado: 'pendiente', codigo, origen: 'simulado', mensaje_id: preparado?.mensaje_id, persistido: null, nuevo_lote: false });
  if (!preparado || preparado.estado !== 'prevalidado' || !resultado || typeof resultado !== 'object' || Array.isArray(resultado)) return pendiente('RPC_SIN_CONFIRMACION');
  if (['rechazado', 'conflicto_id'].includes(resultado.estado)) return { estado: resultado.estado, codigo: resultado.codigo, mensaje_id: preparado.mensaje_id, origen: 'simulado', persistido: false, nuevo_lote: false };
  if (!['insertado', 'duplicado'].includes(resultado.estado)) return pendiente('RPC_SIN_CONFIRMACION');
  const id = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
  if (resultado.mensaje_id !== preparado.mensaje_id || resultado.origen !== 'simulado' ||
      !Array.isArray(resultado.medicion_ids) || resultado.medicion_ids.length !== 10 ||
      !resultado.medicion_ids.every(id) || new Set(resultado.medicion_ids).size !== 10 ||
      !id(resultado.cultivo_id) || !id(resultado.zona_id) ||
      typeof resultado.tomada_en !== 'string' || Date.parse(resultado.tomada_en) !== Date.parse(preparado.tomada_en) ||
      typeof resultado.recibida_en !== 'string' || !Number.isFinite(Date.parse(resultado.recibida_en))) return pendiente('RESPUESTA_RPC_INCOMPLETA');
  return { ...resultado, persistido: true, nuevo_lote: resultado.estado === 'insertado' };
}
