import type { Medicion } from './types.ts';

export const VARIABLES_HISTORIAL = {
  temperatura_aire: { nombre: 'Temperatura del aire', unidad: '°C', min: -40, max: 80, color: 'serie-2' },
  humedad_aire: { nombre: 'Humedad del aire', unidad: '% HR', min: 0, max: 100, color: 'serie-1' },
  iluminacion_relativa: { nombre: 'Iluminación relativa', unidad: '% relativo', min: 0, max: 100, color: 'serie-7' },
  // Variables de los nodos virtuales (simulacion v3 por zonas, 0008).
  radiacion_solar: { nombre: 'Radiación solar', unidad: 'W/m²', min: 0, max: 1400, color: 'serie-7' },
  humedad_suelo_vwc: { nombre: 'Humedad del suelo', unidad: '% VWC', min: 0, max: 80, color: 'serie-6' },
  temperatura_suelo: { nombre: 'Temperatura del suelo', unidad: '°C', min: -20, max: 70, color: 'serie-4' },
  ph_suelo: { nombre: 'pH del suelo', unidad: 'pH', min: 0, max: 14, color: 'serie-5' },
  conductividad_suelo_ece: { nombre: 'Conductividad del suelo', unidad: 'dS/m', min: 0, max: 30, color: 'serie-3' },
  precipitacion_60min: { nombre: 'Lluvia en los últimos 60 min', unidad: 'mm', min: 0, max: 200, color: 'serie-1' },
  velocidad_viento: { nombre: 'Velocidad del viento', unidad: 'm/s', min: 0, max: 50, color: 'serie-8' },
} as const;
export type VariableHistorial = keyof typeof VARIABLES_HISTORIAL;
export interface FiltroHistorial {
  cultivoId: string; nodoId: string; variable: VariableHistorial;
  inicio: string; fin: string; recibidasHasta: string; origen?: 'real' | 'simulado';
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
      fila.cultivo_id !== f.cultivoId || fila.variable_codigo !== f.variable || fila.origen !== (f.origen ?? 'real') ||
      typeof fila.valor !== 'number' || !Number.isFinite(fila.valor) ||
      fila.valor < regla.min || fila.valor > regla.max ||
      !Number.isFinite(captura) || !Number.isFinite(recibida) ||
      captura < Date.parse(f.inicio) || captura > Date.parse(f.fin) || recibida > Date.parse(f.recibidasHasta)) {
    throw new Error('Una lectura del historial no coincide con el período, nodo, variable u origen solicitado.');
  }
  // Iluminacion sintetica v3 de un nodo virtual: indice propio del simulador, nunca mezclado con el LDR.
  if (f.variable === 'iluminacion_relativa' && f.origen === 'simulado' && fila.metadatos?.version_payload === 3) {
    const detalle = fila.metadatos?.detalle as { metodo?: unknown } | undefined;
    if (detalle?.metodo !== 'indice_relativo_sintetico_v1') throw new Error('La escala de iluminación simulada no coincide.');
    return;
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
// Rangos de la plantilla del cultivo para la variable (la iluminacion relativa no tiene rango).
export interface PlantillaRangos { nombre: string; temperatura_min: number; temperatura_max: number; temperatura_optima_min: number; temperatura_optima_max: number;
  humedad_min: number; humedad_max: number; humedad_optima_min: number; humedad_optima_max: number;
  suelo_vwc_min?: number; suelo_vwc_max?: number; suelo_vwc_optima_min?: number; suelo_vwc_optima_max?: number }
export interface RangoPlantilla { nombre: string; optimoMin: number; optimoMax: number; minimo: number; maximo: number }
export function rangoPlantilla(p: PlantillaRangos | null | undefined, variable: VariableHistorial): RangoPlantilla | null {
  if (!p) return null;
  if (variable === 'humedad_suelo_vwc') return p.suelo_vwc_min === undefined || p.suelo_vwc_max === undefined || p.suelo_vwc_optima_min === undefined || p.suelo_vwc_optima_max === undefined ? null
    : { nombre: p.nombre, optimoMin: p.suelo_vwc_optima_min, optimoMax: p.suelo_vwc_optima_max, minimo: p.suelo_vwc_min, maximo: p.suelo_vwc_max };
  if (variable !== 'temperatura_aire' && variable !== 'humedad_aire') return null;
  return variable === 'temperatura_aire'
    ? { nombre: p.nombre, optimoMin: p.temperatura_optima_min, optimoMax: p.temperatura_optima_max, minimo: p.temperatura_min, maximo: p.temperatura_max }
    : { nombre: p.nombre, optimoMin: p.humedad_optima_min, optimoMax: p.humedad_optima_max, minimo: p.humedad_min, maximo: p.humedad_max };
}
// Porcentaje de muestras en el optimo, sobre el maximo y bajo el minimo de alerta de la plantilla.
export function compararConPlantilla(filas: readonly Medicion[], r: RangoPlantilla) {
  let optimo = 0, sobre = 0, bajo = 0;
  for (const f of filas) { if (f.valor >= r.optimoMin && f.valor <= r.optimoMax) optimo++; if (f.valor > r.maximo) sobre++; if (f.valor < r.minimo) bajo++; }
  const n = filas.length || 1, pct = (x: number) => Math.round(x * 1000 / n) / 10;
  return { enOptimo: pct(optimo), sobreMaximo: pct(sobre), bajoMinimo: pct(bajo), entreOptimoYLimite: pct(filas.length - optimo - sobre - bajo) };
}
// Tendencia: promedio del ultimo cuarto de muestras frente al primero.
export const UMBRAL_TENDENCIA: Record<VariableHistorial, number> = { temperatura_aire: 0.5, humedad_aire: 2, iluminacion_relativa: 5,
  radiacion_solar: 50, humedad_suelo_vwc: 1, temperatura_suelo: 0.5, ph_suelo: 0.2, conductividad_suelo_ece: 0.2, precipitacion_60min: 2, velocidad_viento: 1 };
export function tendenciaHistorial(filas: readonly Medicion[], variable: VariableHistorial): { direccion: 'sube' | 'baja' | 'estable' | 'insuficiente'; cambio: number | null } {
  if (filas.length < 6) return { direccion: 'insuficiente', cambio: null };
  const k = Math.max(2, Math.floor(filas.length / 4)), prom = (xs: readonly Medicion[]) => xs.reduce((s, f) => s + f.valor, 0) / xs.length;
  const cambio = Math.round((prom(filas.slice(-k)) - prom(filas.slice(0, k))) * 10) / 10;
  return { direccion: Math.abs(cambio) < UMBRAL_TENDENCIA[variable] ? 'estable' : cambio > 0 ? 'sube' : 'baja', cambio };
}
