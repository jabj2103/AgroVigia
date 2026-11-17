import type { SupabaseClient } from '@supabase/supabase-js';
import { ANTIGUEDAD_MAXIMA_MS } from './domain.ts';
import { posicionNodo } from './terreno-data.ts';
import type { Terreno } from './terreno-data.ts';

export interface EstadoNodoRed {
  nodo_id: string; codigo: string; simulado: boolean; habilitado: boolean; cultivo_id: string | null; cultivo_nombre: string | null;
  plantilla_codigo: string | null; zona_id?: string | null; zona_nombre?: string | null; origen: 'real' | 'simulado' | null; mensaje_id: string | null; tomada_en: string | null; recibida_en: string | null;
  temperatura: number | null; humedad: number | null; iluminacion: number | null; humedad_suelo?: number | null;
  // Dispositivo, pausa y clima simulado del cultivo (0009/0010).
  tipo_dispositivo?: string; protocolo?: string; intervalo_segundos?: number; configuracion_manual?: boolean; recepcion_pausada?: boolean;
  clima_evento?: 'lluvia' | 'sol_fuerte' | 'tierra_seca' | 'viento' | null; clima_intensidad?: number | null; clima_iniciado_en?: string | null;
  // Solo nodos fisicos con evento activo: ultimo lote SIMULADO derivado de su lectura real.
  proyeccion?: { mensaje_id: string; tomada_en: string; temperatura: number | null; humedad: number | null; iluminacion: number | null } | null;
}
export type Conexion = 'conectado' | 'antiguo' | 'sin_datos' | 'sin_cultivo' | 'deshabilitado' | 'reloj' | 'pausado';
export const TEXTO_CONEXION: Record<Conexion, string> = {
  conectado: 'Recibiendo', antiguo: 'Sin recibir', sin_datos: 'Sin recibir todavía',
  sin_cultivo: 'Sin cultivo asignado', deshabilitado: 'Deshabilitado', reloj: 'Revisar reloj', pausado: 'En pausa',
};
// Tres grupos visibles: verde si recibe, naranja si no recibe, gris si esta fuera de servicio.
export type TonoConexion = 'recibe' | 'no_recibe' | 'inactivo';
export const tonoConexion = (c: Conexion): TonoConexion =>
  c === 'conectado' ? 'recibe' : c === 'pausado' || c === 'deshabilitado' || c === 'sin_cultivo' ? 'inactivo' : 'no_recibe';
// Ventana para considerar que un nodo recibe: tres intervalos esperados de su dispositivo, minimo 90 s.
export const ventanaConexionMs = (f: Pick<EstadoNodoRed, 'intervalo_segundos'>) =>
  f.intervalo_segundos ? Math.max(90, 3 * f.intervalo_segundos) * 1000 : ANTIGUEDAD_MAXIMA_MS;
const uuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const numeroONulo = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v));

export async function cargarEstadoRed(client: SupabaseClient, signal?: AbortSignal): Promise<EstadoNodoRed[]> {
  let q = client.rpc('estado_red_nodos');
  if (signal) q = q.abortSignal(signal);
  const r = await q;
  if (r.error) throw new Error('No pudimos consultar el estado de la red. Se conserva la última consulta válida.');
  const filas = (Array.isArray(r.data) ? r.data : []) as EstadoNodoRed[];
  for (const f of filas) {
    if (!uuid(f.nodo_id) || typeof f.codigo !== 'string' || typeof f.simulado !== 'boolean' ||
        (f.origen !== null && f.origen !== (f.simulado ? 'simulado' : 'real')) ||
        (f.tomada_en !== null && !Number.isFinite(Date.parse(f.tomada_en))) ||
        ![f.temperatura, f.humedad, f.iluminacion, f.humedad_suelo ?? null].every(numeroONulo)) throw new Error('Respuesta de la red inconsistente.');
  }
  return filas;
}

// "Recibiendo" = su ultimo lote guardado esta dentro de la ventana de su dispositivo. No es un ping
// al broker: mide el recorrido completo hasta Supabase, que es lo que importa al agricultor.
export function estadoConexion(f: EstadoNodoRed, ahora: number): Conexion {
  if (!f.habilitado) return 'deshabilitado';
  if (!f.cultivo_id) return 'sin_cultivo';
  if (f.recepcion_pausada) return 'pausado';
  if (!f.tomada_en || !f.recibida_en) return 'sin_datos';
  const t = Date.parse(f.tomada_en), r = Date.parse(f.recibida_en);
  if (t > ahora + 120_000 || r > ahora + 120_000) return 'reloj';
  const ventana = ventanaConexionMs(f);
  return ahora - t <= ventana && ahora - r <= ventana ? 'conectado' : 'antiguo';
}

// Devuelve los nodos con lote nuevo respecto de la consulta anterior (para el pulso 3D).
export function lotesNuevos(previas: EstadoNodoRed[] | null, actuales: EstadoNodoRed[]): Set<string> {
  const nuevos = new Set<string>();
  if (!previas) return nuevos;
  for (const f of actuales) {
    const p = previas.find(x => x.nodo_id === f.nodo_id);
    if (f.mensaje_id && p?.mensaje_id !== f.mensaje_id) nuevos.add(f.nodo_id);
  }
  return nuevos;
}

// Panal: un hexagono por cultivo. Cada nodo ocupa un vertice (los fisicos primero, arriba);
// si un cultivo tiene mas de 6 nodos los siguientes van a los puntos medios de los lados.
// Los cultivos se ubican lado a lado en panal compacto: centro, este, noreste y el resto del anillo.
export const RADIO_HEXAGONO = 4;
const SEPARACION = RADIO_HEXAGONO * 2.75;
// Plano real del cultivo llevado a la escena: W y L son el ancho y el largo en unidades de la escena (el lado
// mayor ocupa lo mismo que un hexagono) y cada sector va relativo al centro del cultivo.
export interface PlanoRed { ancho_m: number; largo_m: number; W: number; L: number; sectores: { id: string; nombre: string; x: number; z: number; w: number; l: number }[] }
export interface GrupoRed { clave: string; cultivo_id: string | null; nombre: string; plantilla: string | null; x: number; z: number; nodos: EstadoNodoRed[]; plano?: PlanoRed }
export interface PosicionRed { x: number; z: number; fisico: boolean; grupo: string }
export interface Panal { grupos: GrupoRed[]; posiciones: Map<string, PosicionRed>; centro: { x: number; z: number }; semiAncho: number; semiFondo: number }
const r3 = (v: number) => Math.round(v * 1000) / 1000;
function celdas(n: number): [number, number][] {
  const salida: [number, number][] = [[0, 0]];
  // Primer anillo: vecinos consecutivos (este, noreste, noroeste...) para que el panal quede compacto.
  for (const c of [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]] as [number, number][]) salida.push(c);
  const dirs: [number, number][] = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  for (let k = 2; salida.length < n; k++) {
    let q = -k, r = k;
    for (let lado = 0; lado < 6; lado++) for (let paso = 0; paso < k; paso++) { salida.push([q, r]); q += dirs[lado]![0]; r += dirs[lado]![1]; }
  }
  return salida.slice(0, n);
}
export function vertice(j: number, radio = RADIO_HEXAGONO): { x: number; z: number } {
  if (j < 6) { const a = j * Math.PI / 3 - Math.PI / 2; return { x: r3(Math.cos(a) * radio), z: r3(Math.sin(a) * radio) }; }
  if (j < 12) { const a = (j - 6) * Math.PI / 3 - Math.PI / 3, d = radio * Math.cos(Math.PI / 6); return { x: r3(Math.cos(a) * d), z: r3(Math.sin(a) * d) }; }
  const a = (j - 12) * 2 * Math.PI / 6, d = radio * 0.45; return { x: r3(Math.cos(a) * d), z: r3(Math.sin(a) * d) };
}
export function panalRed(filas: EstadoNodoRed[], planos?: Map<string, Terreno>): Panal {
  const mapa = new Map<string, GrupoRed>();
  for (const f of filas) {
    const clave = f.cultivo_id ?? 'sin-cultivo';
    let g = mapa.get(clave);
    if (!g) { g = { clave, cultivo_id: f.cultivo_id, nombre: f.cultivo_id ? f.cultivo_nombre ?? 'Cultivo' : 'Sin cultivo asignado', plantilla: f.plantilla_codigo, x: 0, z: 0, nodos: [] }; mapa.set(clave, g); }
    g.nodos.push(f);
  }
  const grupos = [...mapa.values()].sort((a, b) => Number(a.cultivo_id === null) - Number(b.cultivo_id === null)
    || Number(b.nodos.some(n => !n.simulado)) - Number(a.nodos.some(n => !n.simulado)) || a.nombre.localeCompare(b.nombre, 'es'));
  const posiciones = new Map<string, PosicionRed>();
  celdas(grupos.length).forEach(([q, r], i) => {
    const g = grupos[i]!; g.x = r3(SEPARACION * (q + r / 2)); g.z = r3(SEPARACION * r * Math.sqrt(3) / 2);
    g.nodos.sort((a, b) => Number(a.simulado) - Number(b.simulado) || a.codigo.localeCompare(b.codigo));
    // Con plano y sectores, cada nodo va donde esta de verdad en el terreno; los que no tienen ubicacion quedan en fila al borde.
    const t = g.cultivo_id ? planos?.get(g.cultivo_id) : undefined;
    if (t?.sectores.length) {
      const escala = 2 * RADIO_HEXAGONO / Math.max(t.medidas.ancho, t.medidas.largo), W = r3(t.medidas.ancho * escala), L = r3(t.medidas.largo * escala);
      g.plano = { ancho_m: t.medidas.ancho, largo_m: t.medidas.largo, W, L, sectores: t.sectores.map(s => ({ id: s.id, nombre: s.nombre, x: r3((s.plano_x + s.plano_ancho / 2 - 0.5) * W), z: r3((s.plano_y + s.plano_alto / 2 - 0.5) * L), w: r3(s.plano_ancho * W), l: r3(s.plano_alto * L) })) };
      let sueltos = 0;
      g.nodos.forEach(f => { const n = t.nodos.find(x => x.id === f.nodo_id), p = n ? posicionNodo(n, t.sectores, t.medidas) : null;
        posiciones.set(f.nodo_id, p ? { x: r3(g.x + (p.fx - 0.5) * W), z: r3(g.z + (p.fy - 0.5) * L), fisico: !f.simulado, grupo: g.clave }
          : { x: r3(g.x - W / 2 + 0.8 + 1.4 * sueltos++), z: r3(g.z + L / 2 + 1.1), fisico: !f.simulado, grupo: g.clave }); });
      return;
    }
    g.nodos.forEach((f, j) => { const v = vertice(j); posiciones.set(f.nodo_id, { x: r3(g.x + v.x), z: r3(g.z + v.z), fisico: !f.simulado, grupo: g.clave }); });
  });
  const xs = grupos.map(g => g.x), zs = grupos.map(g => g.z);
  const centro = grupos.length ? { x: r3((Math.min(...xs) + Math.max(...xs)) / 2), z: r3((Math.min(...zs) + Math.max(...zs)) / 2) } : { x: 0, z: 0 };
  const borde = RADIO_HEXAGONO + 1.2;
  const semiAncho = r3(grupos.reduce((m, g) => Math.max(m, Math.abs(g.x - centro.x)), 0) + borde);
  const semiFondo = r3(grupos.reduce((m, g) => Math.max(m, Math.abs(g.z - centro.z)), 0) + borde);
  return { grupos, posiciones, centro, semiAncho, semiFondo };
}
