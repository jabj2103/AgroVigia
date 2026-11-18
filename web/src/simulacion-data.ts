// Simulacion manual, condiciones activas, peticion de sugerencias y nodos virtuales.
// Todo pasa por RPC o por lecturas con RLS usando la sesion del usuario: aqui no hay claves privadas.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Nodo, Origen } from './types.ts';
import type { EventoClima, LecturaVariable } from './escenario-data.ts';

// ---- Ajuste manual: deltas sobre lo que ya produce la simulacion ----
export type ClaveAjuste = 'temperatura_aire' | 'humedad_aire' | 'humedad_suelo_vwc' | 'ph_suelo' | 'precipitacion_60min' | 'velocidad_viento';
export interface DefAjuste { clave: ClaveAjuste; nombre: string; unidad: string; min: number; max: number; paso: number; fisico: boolean; baja: string; sube: string }
// fisico: el nodo fisico (DHT22 + LDR) solo mide temperatura y humedad del aire y un indice de luz.
export const AJUSTES: DefAjuste[] = [
  { clave: 'temperatura_aire', nombre: 'Temperatura del aire', unidad: '°C', min: -10, max: 10, paso: 0.5, fisico: true, baja: 'Más frío', sube: 'Más calor' },
  { clave: 'humedad_aire', nombre: 'Humedad del aire', unidad: '% HR', min: -30, max: 30, paso: 1, fisico: true, baja: 'Más seco', sube: 'Más húmedo' },
  { clave: 'precipitacion_60min', nombre: 'Lluvia en 60 min', unidad: 'mm', min: -50, max: 50, paso: 1, fisico: false, baja: 'Menos lluvia', sube: 'Más lluvia' },
  { clave: 'humedad_suelo_vwc', nombre: 'Humedad del suelo', unidad: '% VWC', min: -30, max: 30, paso: 1, fisico: false, baja: 'Tierra más seca', sube: 'Tierra más húmeda' },
  { clave: 'ph_suelo', nombre: 'pH del suelo', unidad: 'pH', min: -2, max: 2, paso: 0.1, fisico: false, baja: 'Más ácido', sube: 'Más alcalino' },
  { clave: 'velocidad_viento', nombre: 'Viento', unidad: 'm/s', min: -10, max: 10, paso: 0.5, fisico: false, baja: 'Menos viento', sube: 'Más viento' },
];
export type Ajustes = Partial<Record<ClaveAjuste, number>>;
const redondo = (v: number) => Math.round(v * 10) / 10;
// Deja solo las claves conocidas, dentro de rango, con un decimal y distintas de cero.
export function limpiarAjustes(a: Record<string, unknown> | null | undefined): Ajustes {
  const r: Ajustes = {};
  for (const d of AJUSTES) {
    const v = Number(a?.[d.clave]);
    if (a?.[d.clave] === null || a?.[d.clave] === undefined || !Number.isFinite(v)) continue;
    const limitado = redondo(Math.min(d.max, Math.max(d.min, v)));
    if (limitado !== 0) r[d.clave] = limitado;
  }
  return r;
}
export const hayAjustes = (a: Ajustes | null | undefined) => !!a && Object.keys(a).length > 0;
export const mismosAjustes = (a: Ajustes, b: Ajustes) => AJUSTES.every(d => (a[d.clave] ?? 0) === (b[d.clave] ?? 0));
export function textoAjuste(d: DefAjuste, v: number): string {
  if (!v) return 'Sin cambio';
  return (v > 0 ? '+' : '−') + Math.abs(v).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + ' ' + d.unidad;
}
export const resumenAjustes = (a: Ajustes) => AJUSTES.filter(d => a[d.clave]).map(d => `${d.nombre} ${textoAjuste(d, a[d.clave]!)}`).join(' · ');

const uuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const MENSAJES: Record<string, string> = {
  CULTIVO_NO_AUTORIZADO: 'Este cultivo no pertenece a tu cuenta. Actualiza la cuenta.',
  CULTIVO_ARCHIVADO: 'El cultivo está archivado y no admite cambios.',
  AJUSTE_INVALIDO: 'El ajuste no es válido. Revisa que cada valor esté dentro de su regla.',
  SOLICITUD_INVALIDA: 'No pudimos registrar la petición para este origen de datos.',
  NODO_NO_AUTORIZADO: 'Este dispositivo no pertenece a tu cuenta. Actualiza la cuenta.',
  LIMITE_NODOS_CULTIVO: 'Este cultivo ya tiene el máximo de 16 nodos simulados.',
  ZONA_NO_AUTORIZADA: 'El sector elegido no pertenece a este cultivo.',
  NODO_NO_VIRTUAL: 'Esta acción solo aplica a nodos simulados.',
  SIN_CODIGO_DISPONIBLE: 'No quedan códigos libres para más nodos simulados en este cultivo.',
  PERFIL_NO_AUTORIZADO: 'Tu cuenta no está habilitada para esta acción.',
  NODO_ELIMINADO: 'Este nodo fue eliminado y ya no se puede usar.',
  NODO_DESHABILITADO: 'Este nodo está deshabilitado y no se puede mover.',
  CULTIVO_CON_HISTORIAL: 'Este cultivo ya tiene mediciones, alertas o sugerencias guardadas. Para conservarlas no se borra: archívalo.',
};
function fallo(mensaje: string | undefined, generico: string): Error {
  const codigo = Object.keys(MENSAJES).find(k => mensaje?.includes(k));
  // El codigo viaja en el error para que la pantalla pueda ofrecer la salida correcta (por ejemplo, archivar).
  return Object.assign(new Error(codigo ? MENSAJES[codigo]! : generico), { codigo: codigo ?? '' });
}

export async function ajustarSimulacion(client: SupabaseClient, cultivoId: string, ajustes: Ajustes, todos: boolean): Promise<number> {
  if (!uuid(cultivoId)) throw new Error(MENSAJES.AJUSTE_INVALIDO);
  const r = await client.rpc('ajustar_simulacion', { p_cultivo_id: cultivoId, p_ajustes: limpiarAjustes(ajustes), p_todos: todos });
  if (r.error) throw fallo(r.error.message, 'No pudimos aplicar el ajuste. Reintenta.');
  const d = r.data as { codigo?: string; cultivos_cambiados?: number } | null;
  if (d?.codigo !== 'AJUSTE_ESTABLECIDO' || !Number.isInteger(d.cultivos_cambiados)) throw new Error('No pudimos confirmar el ajuste.');
  return d.cultivos_cambiados!;
}

// ---- Condiciones simuladas: clima y ajustes, activos o del historial ----
export interface CondicionSimulada {
  id: string; cultivo_id: string; tipo: 'clima' | 'ajuste'; iniciado_en: string; finalizado_en: string | null;
  evento?: Exclude<EventoClima, 'normal'>; intensidad?: number; ajustes?: Ajustes;
}
export async function cargarCondiciones(client: SupabaseClient, cultivoIds: string[], soloActivas: boolean, signal?: AbortSignal): Promise<CondicionSimulada[]> {
  const ids = cultivoIds.filter(uuid);
  if (!ids.length) return [];
  let qc = client.from('clima_cultivo').select('id,cultivo_id,evento,intensidad,iniciado_en,finalizado_en').in('cultivo_id', ids).order('iniciado_en', { ascending: false }).limit(40);
  let qa = client.from('ajustes_simulacion').select('id,cultivo_id,ajustes,iniciado_en,finalizado_en').in('cultivo_id', ids).order('iniciado_en', { ascending: false }).limit(40);
  if (soloActivas) { qc = qc.is('finalizado_en', null); qa = qa.is('finalizado_en', null); }
  if (signal) { qc = qc.abortSignal(signal); qa = qa.abortSignal(signal); }
  const [c, a] = await Promise.all([qc, qa]);
  if (c.error || a.error || !Array.isArray(c.data) || !Array.isArray(a.data)) throw new Error('No pudimos consultar las condiciones simuladas.');
  const climas = (c.data as { id: string; cultivo_id: string; evento: Exclude<EventoClima, 'normal'>; intensidad: number; iniciado_en: string; finalizado_en: string | null }[])
    .filter(x => ids.includes(x.cultivo_id)).map(x => ({ ...x, tipo: 'clima' as const }));
  const ajustes = (a.data as { id: string; cultivo_id: string; ajustes: Record<string, unknown>; iniciado_en: string; finalizado_en: string | null }[])
    .filter(x => ids.includes(x.cultivo_id)).map(x => ({ ...x, tipo: 'ajuste' as const, ajustes: limpiarAjustes(x.ajustes) }));
  return [...climas, ...ajustes].sort((x, y) => Date.parse(y.iniciado_en) - Date.parse(x.iniciado_en));
}

// ---- Sugerencia de IA a peticion: la web registra la solicitud y n8n la atiende ----
export type CodigoSolicitud = 'SOLICITUD_REGISTRADA' | 'SOLICITUD_EN_CURSO' | 'SOLICITUD_EN_ESPERA';
export async function solicitarSugerencia(client: SupabaseClient, cultivoId: string, origen: Origen): Promise<{ codigo: CodigoSolicitud; disponible_en?: string }> {
  const r = await client.rpc('solicitar_sugerencia_ia', { p_cultivo_id: cultivoId, p_origen: origen });
  if (r.error) throw fallo(r.error.message, 'No pudimos registrar la petición. Reintenta.');
  const d = r.data as { codigo?: string; disponible_en?: string } | null;
  if (d?.codigo !== 'SOLICITUD_REGISTRADA' && d?.codigo !== 'SOLICITUD_EN_CURSO' && d?.codigo !== 'SOLICITUD_EN_ESPERA') throw new Error('No pudimos confirmar la petición.');
  return { codigo: d.codigo, disponible_en: d.disponible_en };
}
export interface SolicitudIA { id: string; estado: 'pendiente' | 'en_proceso' | 'atendida' | 'rechazada' | 'sin_datos' | 'error'; detalle: string | null; creada_en: string; cerrada_en: string | null }
export async function ultimaSolicitud(client: SupabaseClient, cultivoId: string, origen: Origen, signal?: AbortSignal): Promise<SolicitudIA | null> {
  let q = client.from('solicitudes_ia').select('id,estado,detalle,creada_en,cerrada_en').eq('cultivo_id', cultivoId).eq('origen', origen).order('creada_en', { ascending: false }).limit(1);
  if (signal) q = q.abortSignal(signal);
  const r = await q;
  if (r.error || !Array.isArray(r.data)) throw new Error('No pudimos consultar el estado de la petición.');
  return (r.data[0] as SolicitudIA | undefined) ?? null;
}
export const TEXTO_SOLICITUD: Record<SolicitudIA['estado'], string> = {
  pendiente: 'Petición registrada. El análisis empieza en menos de un minuto.',
  en_proceso: 'La IA está analizando las condiciones actuales.',
  atendida: 'Análisis listo.',
  rechazada: 'No se generó: se alcanzó el tope diario de sugerencias de este cultivo.',
  sin_datos: 'No se generó: no hay lecturas recientes de este origen para analizar.',
  error: 'La petición no se completó. Puedes intentarlo de nuevo.',
};

// ---- Nodos virtuales: crear, retirar y volver a vincular ----
export interface ZonaCultivo { id: string; cultivo_id: string; codigo: string; nombre: string }
export async function cargarZonasCultivo(client: SupabaseClient, cultivoId: string, signal?: AbortSignal): Promise<ZonaCultivo[]> {
  let q = client.from('zonas').select('id,cultivo_id,codigo,nombre').eq('cultivo_id', cultivoId).is('eliminada_en', null).order('codigo');
  if (signal) q = q.abortSignal(signal);
  const r = await q;
  if (r.error || !Array.isArray(r.data)) throw new Error('No pudimos consultar los sectores del cultivo.');
  return (r.data as ZonaCultivo[]).filter(z => z.cultivo_id === cultivoId);
}
const nodoDe = (d: unknown) => (Array.isArray(d) ? d[0] : d) as Nodo | null;
// Sin sector (null) el servidor elige el que tenga menos nodos; si el cultivo no tiene sectores, crea los cuatro por defecto.
export async function crearNodoVirtual(client: SupabaseClient, cultivoId: string, zonaId: string | null): Promise<Nodo> {
  const r = await client.rpc('crear_nodo_virtual', { p_cultivo_id: cultivoId, p_zona_id: zonaId });
  if (r.error) throw fallo(r.error.message, 'No pudimos crear el nodo simulado. Reintenta.');
  const n = nodoDe(r.data);
  if (!n?.id || n.cultivo_id !== cultivoId) throw new Error('No pudimos confirmar el nodo simulado.');
  return n;
}
export async function retirarNodoVirtual(client: SupabaseClient, nodoId: string): Promise<void> {
  const r = await client.rpc('retirar_nodo_virtual', { p_nodo_id: nodoId });
  if (r.error) throw fallo(r.error.message, 'No pudimos desvincular el nodo simulado. Reintenta.');
  const n = nodoDe(r.data);
  if (n?.id !== nodoId || n.cultivo_id !== null) throw new Error('No pudimos confirmar la desvinculación.');
}
export async function vincularNodoVirtual(client: SupabaseClient, nodoId: string, cultivoId: string, zonaId: string): Promise<void> {
  const v = await client.rpc('vincular_nodo', { p_nodo_id: nodoId, p_cultivo_id: cultivoId });
  if (v.error) throw fallo(v.error.message, 'No pudimos vincular el nodo simulado. Reintenta.');
  const z = await client.rpc('asignar_zona_nodo', { p_nodo_id: nodoId, p_zona_id: zonaId });
  if (z.error) throw fallo(z.error.message, 'El nodo quedó vinculado, pero no pudimos ubicarlo en el sector. Reintenta.');
}

// Mover un nodo simulado a otro cultivo o a otro sector en un solo paso. Conserva su codigo y su historial.
export async function moverNodoVirtual(client: SupabaseClient, nodoId: string, cultivoId: string, zonaId: string | null): Promise<Nodo> {
  const r = await client.rpc('mover_nodo_virtual', { p_nodo_id: nodoId, p_cultivo_id: cultivoId, p_zona_id: zonaId });
  if (r.error) throw fallo(r.error.message, 'No pudimos mover el nodo simulado. Reintenta.');
  const n = nodoDe(r.data);
  if (n?.id !== nodoId || n.cultivo_id !== cultivoId) throw new Error('No pudimos confirmar el cambio de cultivo.');
  return n;
}
// Eliminar un nodo simulado. Si nunca transmitio se borra; si tiene mediciones se retira y su historial se conserva.
export async function eliminarNodoVirtual(client: SupabaseClient, nodoId: string): Promise<'borrado' | 'retirado'> {
  const r = await client.rpc('eliminar_nodo_virtual', { p_nodo_id: nodoId });
  if (r.error) throw fallo(r.error.message, 'No pudimos eliminar el nodo simulado. Reintenta.');
  const d = r.data as { codigo?: string; modo?: string } | null;
  if (d?.codigo !== 'NODO_ELIMINADO' || (d.modo !== 'borrado' && d.modo !== 'retirado')) throw new Error('No pudimos confirmar la eliminación.');
  return d.modo;
}
// Borrado definitivo de un cultivo sin historial. Con historial el servidor lo rechaza: se archiva.
export async function eliminarCultivo(client: SupabaseClient, cultivoId: string): Promise<number> {
  const r = await client.rpc('eliminar_cultivo', { p_cultivo_id: cultivoId });
  if (r.error) throw fallo(r.error.message, 'No pudimos eliminar el cultivo. Reintenta.');
  const d = r.data as { codigo?: string; nodos_liberados?: number } | null;
  if (d?.codigo !== 'CULTIVO_ELIMINADO') throw new Error('No pudimos confirmar la eliminación del cultivo.');
  return Number(d.nodos_liberados ?? 0);
}

// ---- Lotes simulados de un cultivo (Inicio): una sola consulta para todos sus nodos virtuales ----
export async function cargarLotesSimulados(client: SupabaseClient, cultivoId: string, mensajes: string[], signal?: AbortSignal): Promise<Map<string, LecturaVariable[]>> {
  const ids = [...new Set(mensajes.filter(uuid))];
  const mapa = new Map<string, LecturaVariable[]>();
  if (!ids.length) return mapa;
  let q = client.from('mediciones').select('variable_codigo,valor,tomada_en,mensaje_id,cultivo_id,origen').eq('cultivo_id', cultivoId).eq('origen', 'simulado').in('mensaje_id', ids).limit(400);
  if (signal) q = q.abortSignal(signal);
  const r = await q;
  if (r.error || !Array.isArray(r.data)) throw new Error('No pudimos consultar las lecturas simuladas.');
  for (const f of r.data as (LecturaVariable & { mensaje_id: string; cultivo_id: string; origen: string })[]) {
    if (f.cultivo_id !== cultivoId || f.origen !== 'simulado' || !ids.includes(f.mensaje_id) || typeof f.valor !== 'number' || !Number.isFinite(f.valor)) continue;
    mapa.set(f.mensaje_id, [...(mapa.get(f.mensaje_id) ?? []), { variable_codigo: f.variable_codigo, valor: f.valor, tomada_en: f.tomada_en }]);
  }
  return mapa;
}
