// Estado ficticio con la forma de la RPC estado_simulacion(): platano (fisico + 5 virtuales), yuca y hortalizas (6 virtuales).
import { randomUUID } from 'node:crypto';
const rangos = (t, h, s) => ({ temperatura_min: t[0], temperatura_optima_min: t[1], temperatura_optima_max: t[2], temperatura_max: t[3],
  humedad_min: h[0], humedad_optima_min: h[1], humedad_optima_max: h[2], humedad_max: h[3],
  suelo_vwc_min: s[0], suelo_vwc_optima_min: s[1], suelo_vwc_optima_max: s[2], suelo_vwc_max: s[3] });
export const PARAMETROS = {
  platano: { codigo: 'platano', nombre: 'Plátano', ajustada: false, ...rangos([18, 26, 30, 35], [60, 75, 85, 95], [25, 30, 40, 50]) },
  yuca: { codigo: 'yuca', nombre: 'Yuca', ajustada: false, ...rangos([18, 25, 29, 35], [40, 60, 80, 90], [15, 20, 30, 40]) },
  hortalizas: { codigo: 'hortalizas', nombre: 'Hortalizas de clima cálido', ajustada: false, ...rangos([15, 20, 28, 32], [50, 60, 75, 85], [20, 25, 35, 45]) },
};
const SECTORES = ['Sector norte', 'Sector sur', 'Sector central', 'Sector de drenaje', 'Sector norte', 'Sector sur'];
const virtuales = (prefijo, n) => Array.from({ length: n }, (_, i) => ({ codigo: prefijo + String(i + 1).padStart(2, '0'), tipo_nodo: 'virtual',
  asignacion_version: randomUUID(), intervalo_segundos: 30, pausado: false, zona: SECTORES[i], ultima_real: null }));
export function estadoFicticio({ clima = null, climaAnterior = null, real = { temperatura: 29.4, humedad: 71, adc: 2600 }, ajustes = null } = {}) {
  return { generado_en: new Date().toISOString(), cultivos: [
    { cultivo_id: '52ea4628-c470-48f4-a09a-0f9a697d22b4', nombre: 'Lote Plátano', parametros: PARAMETROS.platano, clima, clima_anterior: climaAnterior, ajustes, ajustes_iniciado_en: ajustes ? new Date().toISOString() : null,
      nodos: [{ codigo: 'agv-dht22-01', tipo_nodo: 'fisico', asignacion_version: randomUUID(), intervalo_segundos: 60, pausado: false, zona: null,
        ultima_real: real && { tomada_en: new Date().toISOString(), ...real } }, ...virtuales('sim-52ea4628c470-', 5)] },
    { cultivo_id: 'aaaaaaaa-0000-4000-8000-000000000001', nombre: 'Simulado · Yuca', parametros: PARAMETROS.yuca, clima: null, clima_anterior: null, nodos: virtuales('sim-aaaaaaaa0001-', 6) },
    { cultivo_id: 'aaaaaaaa-0000-4000-8000-000000000003', nombre: 'Simulado · Hortalizas', parametros: PARAMETROS.hortalizas, clima: null, clima_anterior: null, nodos: virtuales('sim-aaaaaaaa0003-', 6) },
  ] };
}
