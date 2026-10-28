import type { Capacidad, LoteDht, Medicion } from './types.ts';

export const ANTIGUEDAD_MAXIMA_MS = 180_000;
export function esDht22(nodoId: string, capacidades: Capacidad[]): boolean {
  const propias = capacidades.filter(c => c.nodo_id === nodoId);
  return propias.length === 2 && propias.every(c => c.sensor_modelo === 'DHT22') &&
    propias.some(c => c.variable_codigo === 'temperatura_aire') &&
    propias.some(c => c.variable_codigo === 'humedad_aire');
}
export function esAmbiental(nodoId: string, capacidades: Capacidad[]): boolean {
  const propias = capacidades.filter(c => c.nodo_id === nodoId);
  return propias.length === 3 &&
    ['temperatura_aire', 'humedad_aire'].every(v => propias.some(c => c.variable_codigo === v && c.sensor_modelo === 'DHT22')) &&
    propias.some(c => c.variable_codigo === 'iluminacion_relativa' && c.sensor_modelo === 'LDR');
}
export function formarLote(
  filas: Medicion[], nodoId: string, cultivoId: string, mensajeId: string, conLdr = false,
): LoteDht {
  if ((filas.length !== 2 && !(conLdr && filas.length === 3)) ||
      new Set(filas.map(f => f.variable_codigo)).size !== filas.length) {
    throw new Error('El lote debe contener las dos variables DHT22 o las tres del nodo ambiental.');
  }
  const t = filas.find(f => f.variable_codigo === 'temperatura_aire');
  const h = filas.find(f => f.variable_codigo === 'humedad_aire');
  const luz = filas.find(f => f.variable_codigo === 'iluminacion_relativa');
  if (!t || !h || (filas.length === 3 && !luz) || filas.some(f =>
    f.nodo_id !== nodoId || f.cultivo_id !== cultivoId ||
    f.mensaje_id !== mensajeId || f.origen !== 'real' ||
    typeof f.valor !== 'number' || !Number.isFinite(f.valor) ||
    !Number.isFinite(Date.parse(f.tomada_en)) || !Number.isFinite(Date.parse(f.recibida_en))
  )) throw new Error('El lote no coincide con el nodo, cultivo u origen solicitado.');
  if (filas.some(f => Date.parse(f.tomada_en) !== Date.parse(t.tomada_en) ||
      Date.parse(f.recibida_en) !== Date.parse(t.recibida_en))) {
    throw new Error('Las fechas del lote no coinciden.');
  }
  if (t.valor < -40 || t.valor > 80 || h.valor < 0 || h.valor > 100 ||
      (luz && (luz.valor < 0 || luz.valor > 100))) {
    throw new Error('El lote contiene valores fuera de los rangos admitidos.');
  }
  let adcLdr: number | undefined;
  if (luz) {
    for (const f of filas) {
      const meta = f.metadatos;
      const ldr = meta?.ldr as { metodo?: unknown; adc_promedio?: unknown } | undefined;
      if (!meta || Object.keys(meta).length !== 2 || meta.version_payload !== 2 ||
          !ldr || Object.keys(ldr).length !== 2 || ldr.metodo !== 'adc12_10k_11db_v1' ||
          typeof ldr.adc_promedio !== 'number' || !Number.isInteger(ldr.adc_promedio) ||
          ldr.adc_promedio < 0 || ldr.adc_promedio > 4095 ||
          luz.valor !== Math.round(ldr.adc_promedio * 1000 / 4095) / 10 ||
          (adcLdr !== undefined && adcLdr !== ldr.adc_promedio)) {
        throw new Error('La escala o la trazabilidad del LDR no coincide con el lote.');
      }
      adcLdr = ldr.adc_promedio;
    }
  } else if (filas.some(f => f.metadatos && Object.keys(f.metadatos).length > 0)) {
    throw new Error('Lote ambiental incompleto: falta la medicion del LDR.');
  }
  return {
    mensajeId, nodoId, tomadaEn: t.tomada_en, recibidaEn: t.recibida_en,
    temperatura: t.valor, humedad: h.valor, ...(luz ? { iluminacion: luz.valor, adcLdr } : {}),
  };
}
export function estadoDatos(lote: LoteDht | null, ahora: number): {
  texto: string; clase: 'neutral' | 'reciente' | 'antiguo' | 'revisar';
} {
  if (!lote) return { texto: 'Sin datos reales', clase: 'neutral' };
  if (Date.parse(lote.tomadaEn) > ahora || Date.parse(lote.recibidaEn) > ahora) {
    return { texto: 'Revisar reloj', clase: 'revisar' };
  }
  if (ahora - Date.parse(lote.tomadaEn) > ANTIGUEDAD_MAXIMA_MS ||
      ahora - Date.parse(lote.recibidaEn) > ANTIGUEDAD_MAXIMA_MS) {
    return { texto: 'Datos desactualizados', clase: 'antiguo' };
  }
  return { texto: 'Datos recientes', clase: 'reciente' };
}

export function antiguedad(fecha: string, ahora: number): string {
  const segundos = Math.floor((ahora - Date.parse(fecha)) / 1000);
  if (!Number.isFinite(segundos)) return 'Fecha no disponible';
  if (segundos < 0) return 'Posterior al reloj local';
  if (segundos < 60) return 'Hace ' + segundos + ' s';
  if (segundos < 3600) return 'Hace ' + Math.floor(segundos / 60) + ' min';
  if (segundos < 86400) return 'Hace ' + Math.floor(segundos / 3600) + ' h';
  return 'Hace ' + Math.floor(segundos / 86400) + ' días';
}

export function fechaBogota(fecha: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'medium',
  }).format(new Date(fecha));
}
