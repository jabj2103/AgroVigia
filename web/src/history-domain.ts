import type { Medicion } from './types.ts';

export const VARIABLES_HISTORIAL = {
  temperatura_aire: { nombre: 'Temperatura del aire', unidad: '°C', min: -40, max: 80, color: '#a46b2c' },
  humedad_aire: { nombre: 'Humedad del aire', unidad: '% HR', min: 0, max: 100, color: '#477586' },
  iluminacion_relativa: { nombre: 'Iluminación relativa', unidad: '% relativo', min: 0, max: 100, color: '#777d24' },
} as const;
export type VariableHistorial = keyof typeof VARIABLES_HISTORIAL;
export interface FiltroHistorial {
  cultivoId: string; nodoId: string; variable: VariableHistorial;
  inicio: string; fin: string; recibidasHasta: string;
}
export const MAX_DIAS_HISTORIAL = 7;
export const MAX_MUESTRAS_HISTORIAL = 12_000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function validarFiltroHistorial(f: FiltroHistorial): void {
  if (!uuid.test(f.cultivoId) || !uuid.test(f.nodoId) || !Object.hasOwn(VARIABLES_HISTORIAL, f.variable)) {
    throw new Error('Selecciona un cultivo, un nodo y una variable válidos.');
  }
  const inicio = Date.parse(f.inicio), fin = Date.parse(f.fin), corte = Date.parse(f.recibidasHasta);
  if (![inicio, fin, corte].every(Number.isFinite) || inicio >= fin || fin > corte) {
    throw new Error('Revisa las fechas: inicio anterior al final y final hasta el momento actual.');
  }
  if (fin - inicio > MAX_DIAS_HISTORIAL * 86_400_000) {
    throw new Error('Consulta como máximo siete días por vez.');
  }
}

export function validarFilaHistorial(fila: Medicion, f: FiltroHistorial): void {
  if (!fila || typeof fila !== 'object' || Array.isArray(fila)) throw new Error('Una lectura del historial no es válida.');
  const regla = VARIABLES_HISTORIAL[f.variable];
  const captura = Date.parse(fila.tomada_en), recibida = Date.parse(fila.recibida_en);
  if (!uuid.test(fila.id) || !uuid.test(fila.mensaje_id) || fila.nodo_id !== f.nodoId ||
      fila.cultivo_id !== f.cultivoId || fila.variable_codigo !== f.variable || fila.origen !== 'real' ||
      typeof fila.valor !== 'number' || !Number.isFinite(fila.valor) ||
      fila.valor < regla.min || fila.valor > regla.max ||
      !Number.isFinite(captura) || !Number.isFinite(recibida) ||
      captura < Date.parse(f.inicio) || captura > Date.parse(f.fin) || recibida > Date.parse(f.recibidasHasta)) {
    throw new Error('Una lectura del historial no coincide con el período, nodo, variable u origen solicitado.');
  }
  if (f.variable === 'iluminacion_relativa') {
    const ldr = fila.metadatos?.ldr as { metodo?: unknown; adc_promedio?: unknown } | undefined;
    if (fila.metadatos?.version_payload !== 2 || ldr?.metodo !== 'adc12_10k_11db_v1' ||
        typeof ldr.adc_promedio !== 'number' || !Number.isInteger(ldr.adc_promedio) ||
        ldr.adc_promedio < 0 || ldr.adc_promedio > 4095 ||
        fila.valor !== Math.round(ldr.adc_promedio * 1000 / 4095) / 10) {
      throw new Error('La escala del LDR no coincide. No se mezclan métodos de iluminación distintos.');
    }
  }
}
export function resumirHistorial(filas: readonly Medicion[]) {
  if (!filas.length) return { cantidad: 0, minimo: null, maximo: null, promedio: null };
  let minimo = Infinity, maximo = -Infinity, suma = 0;
  for (const f of filas) { minimo = Math.min(minimo, f.valor); maximo = Math.max(maximo, f.valor); suma += f.valor; }
  return { cantidad: filas.length, minimo, maximo, promedio: suma / filas.length };
}
export function puntosHistorial(filas: readonly Medicion[]): { x: number; y: number | null }[] {
  const puntos: { x: number; y: number | null }[] = [];
  let anterior: number | undefined;
  for (const fila of filas) {
    const x = Date.parse(fila.tomada_en);
    if (anterior !== undefined && x - anterior > 180_000) puntos.push({ x: anterior + 1, y: null });
    puntos.push({ x, y: fila.valor }); anterior = x;
  }
  return puntos;
}
export function fechaLocalBogota(iso: string): string {
  const partes = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const obtener = (tipo: string) => partes.find(p => p.type === tipo)!.value;
  return obtener('year') + '-' + obtener('month') + '-' + obtener('day') + 'T' + obtener('hour') + ':' + obtener('minute');
}
export function desdeFechaBogota(local: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new Error('Completa las fechas en hora de Colombia.');
  const fecha = new Date(local + ':00-05:00');
  if (!Number.isFinite(fecha.getTime()) || fechaLocalBogota(fecha.toISOString()) !== local) {
    throw new Error('La fecha no existe o tiene un formato incorrecto.');
  }
  return fecha.toISOString();
}