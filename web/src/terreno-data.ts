// Terreno real del cultivo: medidas en metros, sectores dibujados por el agricultor y posicion de cada
// nodo. En la base todo se guarda como fraccion 0..1 (del terreno para los sectores, del sector para los
// nodos); aqui se convierte a metros para mostrar distancias reales.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Cultivo } from './types.ts';

export interface Sector { id: string; cultivo_id: string; codigo: string; nombre: string; plano_x: number; plano_y: number; plano_ancho: number; plano_alto: number }
export interface NodoTerreno { id: string; codigo: string; cultivo_id: string | null; tipo_nodo: 'fisico' | 'virtual'; zona_id: string | null; posicion_x: number | null; posicion_y: number | null }
export interface Medidas { ancho: number; largo: number; declaradas: boolean }
export interface Terreno { medidas: Medidas; sectores: Sector[]; nodos: NodoTerreno[] }
export type CultivoTerreno = Cultivo & { ancho_m?: number | null; largo_m?: number | null };

const uuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const r1 = (v: number) => Math.round(v * 10) / 10;
export const SECTOR_MINIMO = 0.02;

// Medidas del terreno: las declaradas o, si faltan, un cuadrado con el area registrada del cultivo.
export function medidasDe(c: CultivoTerreno): Medidas {
  const ancho = Number(c.ancho_m), largo = Number(c.largo_m);
  if (Number.isFinite(ancho) && Number.isFinite(largo) && ancho > 0 && largo > 0) return { ancho, largo, declaradas: true };
  const m2 = Number(c.area) * (c.unidad_area === 'ha' ? 10_000 : 1), lado = Number.isFinite(m2) && m2 > 0 ? r1(Math.sqrt(m2)) : 100;
  return { ancho: lado, largo: lado, declaradas: false };
}
// Posicion de un nodo dentro del terreno, como fraccion 0..1 y en metros. Null si no esta en un sector.
export function posicionNodo(n: Pick<NodoTerreno, 'zona_id' | 'posicion_x' | 'posicion_y'>, sectores: Sector[], m: Medidas): { fx: number; fy: number; x: number; y: number } | null {
  const s = sectores.find(z => z.id === n.zona_id);
  if (!s || n.posicion_x === null || n.posicion_y === null) return null;
  const fx = s.plano_x + n.posicion_x * s.plano_ancho, fy = s.plano_y + n.posicion_y * s.plano_alto;
  return { fx, fy, x: r1(fx * m.ancho), y: r1(fy * m.largo) };
}
export const distanciaMetros = (a: { x: number; y: number }, b: { x: number; y: number }) => r1(Math.hypot(a.x - b.x, a.y - b.y));
// Sector que contiene un punto del terreno (fraccion 0..1). Si varios se solapan gana el mas pequeno.
export function sectorEn(fx: number, fy: number, sectores: Sector[]): Sector | null {
  return sectores.filter(s => fx >= s.plano_x && fx <= s.plano_x + s.plano_ancho && fy >= s.plano_y && fy <= s.plano_y + s.plano_alto)
    .sort((a, b) => a.plano_ancho * a.plano_alto - b.plano_ancho * b.plano_alto)[0] ?? null;
}
// Recorta un rectangulo dibujado para que quede dentro del terreno y con el tamano minimo.
export function ajustarRect(x: number, y: number, ancho: number, alto: number) {
  const r4 = (v: number) => Math.round(v * 10_000) / 10_000, lim = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  const w = lim(ancho, SECTOR_MINIMO, 1), h = lim(alto, SECTOR_MINIMO, 1);
  return { x: r4(lim(x, 0, 1 - w)), y: r4(lim(y, 0, 1 - h)), ancho: r4(w), alto: r4(h) };
}
export const metros = (v: number) => v.toLocaleString('es-CO', { maximumFractionDigits: 1 }) + ' m';

const MENSAJES: Record<string, string> = {
  CULTIVO_NO_AUTORIZADO: 'Este cultivo no pertenece a tu cuenta. Actualiza la cuenta.',
  CULTIVO_ARCHIVADO: 'El cultivo está archivado y no admite cambios.',
  ZONA_NO_AUTORIZADA: 'Ese sector no pertenece a este cultivo.',
  TERRENO_INVALIDO: 'Escribe el ancho y el largo en metros, entre 1 y 20.000.',
  SECTOR_INVALIDO: 'El sector debe tener nombre, quedar dentro del terreno y no ser demasiado pequeño.',
  SECTOR_CON_NODOS: 'Este sector tiene nodos. Muévelos a otro sector antes de eliminarlo.',
  LIMITE_SECTORES: 'Este cultivo ya tiene el máximo de 24 sectores.',
  NODO_SIN_CULTIVO_AUTORIZADO: 'Este nodo no está vinculado a un cultivo de tu cuenta.',
  POSICION_NODO_INVALIDA: 'Esa posición no es válida dentro del sector.',
  NODO_DESHABILITADO: 'Este nodo está deshabilitado y no se puede ubicar.',
};
function fallo(mensaje: string | undefined, generico: string): Error {
  const codigo = Object.keys(MENSAJES).find(k => mensaje?.includes(k));
  return new Error(codigo ? MENSAJES[codigo]! : generico);
}
const fila = <T>(d: unknown) => (Array.isArray(d) ? d[0] : d) as T | null;
const numeros = (s: Sector): Sector => ({ ...s, plano_x: Number(s.plano_x), plano_y: Number(s.plano_y), plano_ancho: Number(s.plano_ancho), plano_alto: Number(s.plano_alto) });
const nodoNum = (n: NodoTerreno): NodoTerreno => ({ ...n, posicion_x: n.posicion_x === null ? null : Number(n.posicion_x), posicion_y: n.posicion_y === null ? null : Number(n.posicion_y) });

async function leerSectoresYNodos(client: SupabaseClient, ids: string[], signal?: AbortSignal): Promise<{ sectores: Sector[]; nodos: NodoTerreno[] }> {
  let qz = client.from('zonas').select('id,cultivo_id,codigo,nombre,plano_x,plano_y,plano_ancho,plano_alto').in('cultivo_id', ids).is('eliminada_en', null).order('codigo');
  let qn = client.from('nodos').select('id,codigo,cultivo_id,tipo_nodo,zona_id,posicion_x,posicion_y').in('cultivo_id', ids).is('eliminado_en', null).order('codigo');
  if (signal) { qz = qz.abortSignal(signal); qn = qn.abortSignal(signal); }
  const [z, n] = await Promise.all([qz, qn]);
  if (z.error || n.error || !Array.isArray(z.data) || !Array.isArray(n.data)) throw new Error('No pudimos consultar el terreno del cultivo.');
  return { sectores: (z.data as Sector[]).filter(s => ids.includes(s.cultivo_id)).map(numeros), nodos: (n.data as NodoTerreno[]).filter(x => x.cultivo_id && ids.includes(x.cultivo_id)).map(nodoNum) };
}
export async function cargarTerreno(client: SupabaseClient, cultivo: CultivoTerreno, signal?: AbortSignal): Promise<Terreno> {
  if (!uuid(cultivo.id)) throw new Error('Cultivo no válido.');
  const { sectores, nodos } = await leerSectoresYNodos(client, [cultivo.id], signal);
  return { medidas: medidasDe(cultivo), sectores, nodos };
}
// Plano de cada cultivo para el Escenario 3D: una sola consulta para todos.
export async function cargarPlanos(client: SupabaseClient, cultivos: CultivoTerreno[], signal?: AbortSignal): Promise<Map<string, Terreno>> {
  const activos = cultivos.filter(c => !c.archivado_en && uuid(c.id)), mapa = new Map<string, Terreno>();
  if (!activos.length) return mapa;
  const { sectores, nodos } = await leerSectoresYNodos(client, activos.map(c => c.id), signal);
  for (const c of activos) mapa.set(c.id, { medidas: medidasDe(c), sectores: sectores.filter(s => s.cultivo_id === c.id), nodos: nodos.filter(n => n.cultivo_id === c.id) });
  return mapa;
}

export async function definirTerreno(client: SupabaseClient, cultivoId: string, ancho: number | null, largo: number | null): Promise<void> {
  const r = await client.rpc('definir_terreno', { p_cultivo_id: cultivoId, p_ancho_m: ancho, p_largo_m: largo });
  if (r.error) throw fallo(r.error.message, 'No pudimos guardar las medidas del terreno. Reintenta.');
  if (fila<{ id: string }>(r.data)?.id !== cultivoId) throw new Error('No pudimos confirmar las medidas del terreno.');
}
export interface DatosSector { nombre: string; x: number; y: number; ancho: number; alto: number }
export async function crearSector(client: SupabaseClient, cultivoId: string, d: DatosSector): Promise<Sector> {
  const a = ajustarRect(d.x, d.y, d.ancho, d.alto);
  const r = await client.rpc('crear_sector', { p_cultivo_id: cultivoId, p_nombre: d.nombre.trim(), p_x: a.x, p_y: a.y, p_ancho: a.ancho, p_alto: a.alto });
  if (r.error) throw fallo(r.error.message, 'No pudimos crear el sector. Reintenta.');
  const s = fila<Sector>(r.data);
  if (!s?.id || s.cultivo_id !== cultivoId) throw new Error('No pudimos confirmar el sector.');
  return numeros(s);
}
export async function editarSector(client: SupabaseClient, zonaId: string, d: DatosSector): Promise<Sector> {
  const a = ajustarRect(d.x, d.y, d.ancho, d.alto);
  const r = await client.rpc('editar_sector', { p_zona_id: zonaId, p_nombre: d.nombre.trim(), p_x: a.x, p_y: a.y, p_ancho: a.ancho, p_alto: a.alto });
  if (r.error) throw fallo(r.error.message, 'No pudimos guardar el sector. Reintenta.');
  const s = fila<Sector>(r.data);
  if (s?.id !== zonaId) throw new Error('No pudimos confirmar el sector.');
  return numeros(s);
}
export async function eliminarSector(client: SupabaseClient, zonaId: string): Promise<void> {
  const r = await client.rpc('eliminar_sector', { p_zona_id: zonaId });
  if (r.error) throw fallo(r.error.message, 'No pudimos eliminar el sector. Reintenta.');
  if ((r.data as { codigo?: string } | null)?.codigo !== 'SECTOR_ELIMINADO') throw new Error('No pudimos confirmar la eliminación del sector.');
}
// Ubica un nodo (fisico o simulado) en un punto de un sector de su cultivo. x e y son fraccion 0..1 del sector.
export async function ubicarNodo(client: SupabaseClient, nodoId: string, zonaId: string, x: number, y: number): Promise<void> {
  const lim = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 10_000) / 10_000;
  const r = await client.rpc('ubicar_nodo', { p_nodo_id: nodoId, p_zona_id: zonaId, p_x: lim(x), p_y: lim(y) });
  if (r.error) throw fallo(r.error.message, 'No pudimos ubicar el nodo. Reintenta.');
  if (fila<{ id: string; zona_id: string }>(r.data)?.zona_id !== zonaId) throw new Error('No pudimos confirmar la ubicación del nodo.');
}
