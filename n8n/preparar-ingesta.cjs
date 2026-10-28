'use strict';

// Preparacion pura. Configuracion del servidor: no tomar flags del payload.
function prepararIngesta(entrada, configuracion, recibidaEn) {
  const rechazo = codigo => ({ estado: 'rechazado', codigo, persistido: false });
  if (configuracion?.acl_verificada !== true ||
      configuracion?.retencion_broker_desactivada !== true) {
    return rechazo('CANAL_LOCAL_NO_VERIFICADO');
  }
  const fecha = typeof recibidaEn === 'string' ? new Date(recibidaEn) : null;
  if (!fecha || !Number.isFinite(fecha.getTime()) ||
      fecha.toISOString() !== recibidaEn) return rechazo('FECHA_RECEPCION');
  const previo = prevalidarTelemetria({
    topic: entrada?.topic, message: entrada?.message, recibida_en: recibidaEn,
  });
  const base = {
    ...previo, persistido: false,
    recibida_en: recibidaEn,
    fuente_recibida_en: 'inicio_validacion_mqtt_aproximado',
  };
  if (previo.estado !== 'prevalidado') return { ...base, estado: 'rechazado' };
  if (previo.perfil_payload !== 'DHT22') {
    return { ...base, estado: 'rechazado', codigo: 'PERFIL_NO_ADMITIDO_EN_ESTA_RPC' };
  }
  const url = entrada.supabase_url;
  if (typeof url !== 'string' || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)) {
    return { ...base, estado: 'rechazado', codigo: 'CONFIGURAR_URL_SUPABASE' };
  }
  return {
    ...base,
    destino_rpc: url.replace(/\/$/, '') + '/rest/v1/rpc/registrar_lote_dht22',
    solicitud_rpc: {
      p_topico: entrada.topic,
      p_mensaje: entrada.message,
      p_recibida_en: recibidaEn,
      p_acl_verificada: true,
      p_retenido: null,
      p_retencion_broker_desactivada: true,
    },
  };
}

function resumirPersistencia(resultado) {
  const estados = ['insertado', 'duplicado', 'rechazado', 'conflicto_id'];
  if (!resultado || typeof resultado !== 'object' || Array.isArray(resultado) ||
      !estados.includes(resultado.estado)) throw new Error('RESPUESTA_RPC_NO_RECONOCIDA');
  const confirmado = ['insertado', 'duplicado'].includes(resultado.estado);
  if (confirmado && (
    !Array.isArray(resultado.medicion_ids) || resultado.medicion_ids.length !== 2 ||
    resultado.medicion_ids.some(id => typeof id !== 'string' || id.length !== 36) ||
    new Set(resultado.medicion_ids).size !== 2 ||
    typeof resultado.mensaje_id !== 'string' ||
    typeof resultado.recibida_en !== 'string'
  )) throw new Error('RESPUESTA_RPC_INCOMPLETA');
  return {
    ...resultado,
    persistido: confirmado,
    nuevo_lote: resultado.estado === 'insertado',
  };
}

// EXPORTACIONES_LOCALES: el generador elimina esta seccion en el Code.
const { prevalidarTelemetria } = require('./validar-telemetria.cjs');
module.exports = { prepararIngesta, resumirPersistencia };
