// Datos y acciones de la vista Escenario: clima simulado, pausa y configuracion de nodos, parametros
// por cultivo, preferencias del usuario y suscripcion en tiempo real. Sin claves privadas: todo pasa
// por RPC con la sesion del usuario y RLS.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Origen } from './types.ts';
import type { EstadoNodoRed } from './red-data.ts';

export type EventoClima = 'normal' | 'lluvia' | 'sol_fuerte' | 'tierra_seca' | 'viento';
export const EVENTOS_CLIMA: Record<EventoClima, { nombre: string; efecto: string }> = {
  normal: { nombre: 'Normal', efecto: 'Sin evento. Los nodos vuelven poco a poco a sus valores de referencia.' },
  lluvia: { nombre: 'Lluvia fuerte', efecto: 'Suben la lluvia acumulada y la humedad del aire y del suelo; bajan la temperatura y la luz.' },
  sol_fuerte: { nombre: 'Sol fuerte', efecto: 'Suben la temperatura y la radiación; bajan la humedad del aire y la del suelo.' },
  tierra_seca: { nombre: 'Tierra seca', efecto: 'Baja la humedad del suelo y algo la del aire; sube la temperatura del suelo.' },
  viento: { nombre: 'Viento fuerte', efecto: 'Sube la velocidad del viento; bajan un poco la humedad y la temperatura del aire.' },
};
export const INTENSIDADES: Record<number, string> = { 1: 'Moderado', 2: 'Fuerte', 3: 'Extremo' };
export const PROTOCOLOS: Record<string, string> = {
  mqtt_wifi: 'MQTT por Wi-Fi', mqtt_ethernet: 'MQTT por Ethernet', https_wifi: 'HTTPS por Wi-Fi, con clave propia del nodo',
  serie_puente_mqtt: 'USB serie con equipo puente a MQTT', mqtt_simulado: 'MQTT desde el servicio de simulación',
};
const uuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const MENSAJES: Record<string, string> = {
  CULTIVO_NO_AUTORIZADO: 'Este cultivo no pertenece a tu cuenta. Actualiza la cuenta.',
  CULTIVO_ARCHIVADO: 'El cultivo está archivado y no admite cambios.',
  NODO_NO_AUTORIZADO: 'Este dispositivo no pertenece a tu cuenta. Actualiza la cuenta.',
  CLIMA_INVALIDO: 'Elige un evento y una intensidad válidos.',
  DISPOSITIVO_INVALIDO: 'El tipo, el protocolo o el intervalo no son válidos para este dispositivo.',
  PARAMETROS_INVALIDOS: 'Revisa los rangos: mínimo, óptimo y máximo deben ir en orden y con un decimal como máximo.',
  PREFERENCIAS_INVALIDAS: 'Los ajustes no son válidos.',
};
function fallo(mensaje: string | undefined, generico: string): Error {
  const codigo = Object.keys(MENSAJES).find(k => mensaje?.includes(k));
  return new Error(codigo ? MENSAJES[codigo]! : generico);
}

// ---- Clima simulado ----
export async function establecerClima(client: SupabaseClient, cultivoId: string, evento: EventoClima, intensidad: number, todos: boolean): Promise<number> {
  if (!uuid(cultivoId) || !Object.hasOwn(EVENTOS_CLIMA, evento) || ![1, 2, 3].includes(intensidad)) throw new Error(MENSAJES.CLIMA_INVALIDO);
  const r = await client.rpc('establecer_clima', { p_cultivo_id: cultivoId, p_evento: evento, p_intensidad: intensidad, p_todos: todos });
  if (r.error) throw fallo(r.error.message, 'No pudimos cambiar el clima. Reintenta.');
  const d = r.data as { codigo?: string; evento?: string; cultivos_cambiados?: number } | null;
  if (d?.codigo !== 'CLIMA_ESTABLECIDO' || d.evento !== evento || !Number.isInteger(d.cultivos_cambiados)) throw new Error('No pudimos confirmar el cambio de clima.');
  return d.cultivos_cambiados!;
}

// ---- Nodos: lote actual, pausa y dispositivo ----
export interface LecturaVariable { variable_codigo: string; valor: number; tomada_en: string }
export async function cargarLoteNodo(client: SupabaseClient, f: Pick<EstadoNodoRed, 'nodo_id' | 'cultivo_id'>, mensajeId: string, origen: Origen, signal?: AbortSignal): Promise<LecturaVariable[]> {
  let q = client.from('mediciones').select('variable_codigo,valor,tomada_en,nodo_id,mensaje_id,origen')
    .eq('nodo_id', f.nodo_id).eq('cultivo_id', f.cultivo_id!).eq('mensaje_id', mensajeId).eq('origen', origen).limit(12);
  if (signal) q = q.abortSignal(signal);
  const r = await q;
  if (r.error || !Array.isArray(r.data)) throw new Error('No pudimos consultar los datos que envía este nodo.');
  const filas = r.data as (LecturaVariable & { nodo_id: string; mensaje_id: string; origen: string })[];
  if (filas.some(x => x.nodo_id !== f.nodo_id || x.mensaje_id !== mensajeId || x.origen !== origen || typeof x.valor !== 'number' || !Number.isFinite(x.valor)))
    throw new Error('La respuesta del lote no coincide con el nodo consultado.');
  return filas.map(({ variable_codigo, valor, tomada_en }) => ({ variable_codigo, valor, tomada_en }));
}
export async function pausarNodo(client: SupabaseClient, nodoId: string, pausar: boolean): Promise<void> {
  const r = await client.rpc('pausar_nodo', { p_nodo_id: nodoId, p_pausar: pausar });
  if (r.error) throw fallo(r.error.message, 'No pudimos cambiar la recepción de este nodo. Reintenta.');
  const d = (Array.isArray(r.data) ? r.data[0] : r.data) as { id?: string; recepcion_pausada?: boolean } | null;
  if (d?.id !== nodoId || d.recepcion_pausada !== pausar) throw new Error('No pudimos confirmar el cambio de recepción.');
}
export interface TipoDispositivo { codigo: string; nombre: string; descripcion: string; protocolos: string[]; protocolo_defecto: string;
  intervalo_defecto: number; adc_bits: number | null; conexion: string; probado: boolean }
export async function cargarTiposDispositivo(client: SupabaseClient, signal?: AbortSignal): Promise<TipoDispositivo[]> {
  let q = client.from('tipos_dispositivo').select('codigo,nombre,descripcion,protocolos,protocolo_defecto,intervalo_defecto,adc_bits,conexion,probado').order('nombre');
  if (signal) q = q.abortSignal(signal);
  const r = await q;
  if (r.error || !Array.isArray(r.data)) throw new Error('No pudimos consultar los tipos de dispositivo.');
  const tipos = r.data as TipoDispositivo[];
  if (tipos.some(t => typeof t.codigo !== 'string' || !Array.isArray(t.protocolos) || !t.protocolos.includes(t.protocolo_defecto))) throw new Error('Respuesta de tipos de dispositivo inconsistente.');
  return tipos;
}
// Automatico: protocolo e intervalo nulos, la base aplica los del tipo. Manual: se envian los elegidos.
export async function configurarDispositivo(client: SupabaseClient, nodoId: string, tipo: string, protocolo: string | null, intervalo: number | null): Promise<void> {
  if (intervalo !== null && (!Number.isInteger(intervalo) || intervalo < 10 || intervalo > 3600)) throw new Error('El intervalo va de 10 a 3600 segundos, sin decimales.');
  const r = await client.rpc('configurar_dispositivo', { p_nodo_id: nodoId, p_tipo: tipo, p_protocolo: protocolo, p_intervalo: intervalo });
  if (r.error) throw fallo(r.error.message, 'No pudimos guardar la configuración del dispositivo. Reintenta.');
  const d = (Array.isArray(r.data) ? r.data[0] : r.data) as { id?: string; tipo_dispositivo?: string } | null;
  if (d?.id !== nodoId || d.tipo_dispositivo !== tipo) throw new Error('No pudimos confirmar la configuración del dispositivo.');
}

// ---- Parametros por cultivo ----
export const GRUPOS_RANGOS = [
  { prefijo: 'temperatura', nombre: 'Temperatura del aire', unidad: '°C', min: -40, max: 80 },
  { prefijo: 'humedad', nombre: 'Humedad del aire', unidad: '% HR', min: 0, max: 100 },
  { prefijo: 'suelo_vwc', nombre: 'Humedad del suelo', unidad: '% VWC', min: 0, max: 80 },
] as const;
export const SUFIJOS_RANGO = [['_min', 'Alerta bajo'], ['_optima_min', 'Óptimo desde'], ['_optima_max', 'Óptimo hasta'], ['_max', 'Alerta sobre']] as const;
export const CAMPOS_RANGOS = GRUPOS_RANGOS.flatMap(g => SUFIJOS_RANGO.map(([s]) => g.prefijo + s));
export type Rangos = Record<string, number>;
// Limites de alerta calculados como margen en porcentaje del rango optimo: alerta bajo = optimo desde
// menos el margen; alerta sobre = optimo hasta mas el margen. Se recorta a lo que mide el sensor.
export function limitesPorPorcentaje(texto: Record<string, string>, porcentaje: string): Record<string, string> {
  const p = Number(porcentaje.trim().replace(',', '.'));
  if (!Number.isFinite(p) || p < 1 || p > 100) throw new Error('El margen debe ser un porcentaje entre 1 y 100.');
  const r = { ...texto }, aTexto = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',');
  for (const g of GRUPOS_RANGOS) {
    const desde = Number((texto[g.prefijo + '_optima_min'] ?? '').trim().replace(',', '.')), hasta = Number((texto[g.prefijo + '_optima_max'] ?? '').trim().replace(',', '.'));
    if (!Number.isFinite(desde) || !Number.isFinite(hasta) || (texto[g.prefijo + '_optima_min'] ?? '').trim() === '' || desde >= hasta) throw new Error(`${g.nombre}: escribe primero el rango óptimo, de menor a mayor.`);
    r[g.prefijo + '_min'] = aTexto(Math.max(g.min, desde - Math.abs(desde) * p / 100));
    r[g.prefijo + '_max'] = aTexto(Math.min(g.max, hasta + Math.abs(hasta) * p / 100));
  }
  return r;
}
// Convierte y valida los doce campos del formulario (acepta coma decimal). Lanza con un mensaje para el usuario.
export function validarRangos(texto: Record<string, string>): Rangos {
  const r: Rangos = {};
  for (const g of GRUPOS_RANGOS) {
    const v = SUFIJOS_RANGO.map(([s]) => {
      const crudo = (texto[g.prefijo + s] ?? '').trim().replace(',', '.');
      if (!/^-?\d{1,3}(\.\d)?$/.test(crudo)) throw new Error(`${g.nombre}: escribe números con un decimal como máximo.`);
      return Number(crudo);
    });
    if (!(v[0]! <= v[1]! && v[1]! < v[2]! && v[2]! <= v[3]!)) throw new Error(`${g.nombre}: el orden debe ser alerta bajo, óptimo desde, óptimo hasta y alerta sobre.`);
    if (v[0]! < g.min || v[3]! > g.max) throw new Error(`${g.nombre}: usa valores entre ${g.min} y ${g.max} ${g.unidad}.`);
    SUFIJOS_RANGO.forEach(([s], i) => { r[g.prefijo + s] = v[i]!; });
  }
  return r;
}
const rangosDe = (fila: Record<string, unknown> | null): Rangos | null => {
  if (!fila) return null;
  const r: Rangos = {};
  for (const c of CAMPOS_RANGOS) { const n = Number(fila[c]); if (fila[c] === null || fila[c] === undefined || !Number.isFinite(n)) return null; r[c] = n; }
  return r;
};
// Ajuste propio del cultivo, o null si usa los rangos de su plantilla.
export async function cargarParametros(client: SupabaseClient, cultivoId: string, signal?: AbortSignal): Promise<Rangos | null> {
  let q = client.from('cultivo_parametros').select(['cultivo_id', ...CAMPOS_RANGOS].join(',')).eq('cultivo_id', cultivoId);
  if (signal) q = q.abortSignal(signal);
  const r = await q.maybeSingle();
  if (r.error) throw new Error('No pudimos consultar los parámetros del cultivo.');
  const fila = r.data as Record<string, unknown> | null;
  if (fila && fila.cultivo_id !== cultivoId) throw new Error('Respuesta de parámetros inconsistente.');
  return rangosDe(fila);
}
export async function ajustarParametros(client: SupabaseClient, cultivoId: string, rangos: Rangos, reglas: boolean, origen: Origen): Promise<void> {
  const r = await client.rpc('ajustar_parametros_cultivo', { p_cultivo_id: cultivoId, p_parametros: rangos, p_configurar_reglas: reglas, p_origen: origen });
  if (r.error) throw fallo(r.error.message, 'No pudimos guardar los parámetros. Reintenta.');
  if ((r.data as { ajustada?: boolean } | null)?.ajustada !== true) throw new Error('No pudimos confirmar el guardado de los parámetros.');
}
export async function restablecerParametros(client: SupabaseClient, cultivoId: string): Promise<void> {
  const r = await client.rpc('restablecer_parametros_cultivo', { p_cultivo_id: cultivoId });
  if (r.error) throw fallo(r.error.message, 'No pudimos restablecer los parámetros. Reintenta.');
  if ((r.data as { ajustada?: boolean } | null)?.ajustada === true) throw new Error('No pudimos confirmar el restablecimiento.');
}

// ---- Preferencias del usuario ----
export interface Preferencias { tiempo_real: boolean; refresco_segundos: 5 | 10 | 30; clima_alcance: 'cultivo' | 'todos' }
export const PREFERENCIAS_DEFECTO: Preferencias = { tiempo_real: true, refresco_segundos: 10, clima_alcance: 'cultivo' };
const preferenciasValidas = (p: unknown): p is Preferencias => !!p && typeof p === 'object' && typeof (p as Preferencias).tiempo_real === 'boolean'
  && [5, 10, 30].includes((p as Preferencias).refresco_segundos) && ['cultivo', 'todos'].includes((p as Preferencias).clima_alcance);
export async function cargarPreferencias(client: SupabaseClient, signal?: AbortSignal): Promise<Preferencias> {
  let q = client.from('preferencias_usuario').select('tiempo_real,refresco_segundos,clima_alcance');
  if (signal) q = q.abortSignal(signal);
  const r = await q.maybeSingle();
  if (r.error) throw new Error('No pudimos consultar tus ajustes.');
  if (r.data === null) return PREFERENCIAS_DEFECTO;
  if (!preferenciasValidas(r.data)) throw new Error('Respuesta de ajustes inconsistente.');
  return { tiempo_real: r.data.tiempo_real, refresco_segundos: r.data.refresco_segundos, clima_alcance: r.data.clima_alcance };
}
export async function guardarPreferencias(client: SupabaseClient, p: Preferencias): Promise<Preferencias> {
  const r = await client.rpc('guardar_preferencias', { p_tiempo_real: p.tiempo_real, p_refresco_segundos: p.refresco_segundos, p_clima_alcance: p.clima_alcance });
  if (r.error) throw fallo(r.error.message, 'No pudimos guardar tus ajustes. Reintenta.');
  const d = Array.isArray(r.data) ? r.data[0] : r.data;
  if (!preferenciasValidas(d)) throw new Error('No pudimos confirmar tus ajustes.');
  return { tiempo_real: d.tiempo_real, refresco_segundos: d.refresco_segundos, clima_alcance: d.clima_alcance };
}

// ---- Tiempo real ----
// Avisa (agrupando rafagas) cuando cambian mediciones, nodos o clima de la cuenta. Supabase Realtime
// aplica RLS. 'alEstado' informa si el canal quedo activo; el sondeo periodico sigue como respaldo.
export function suscribirCambios(client: SupabaseClient, alCambiar: () => void, alEstado: (activo: boolean) => void): () => void {
  const canal = client.channel('agv-escenario-' + Math.random().toString(36).slice(2, 10));
  let espera: ReturnType<typeof setTimeout> | undefined;
  const avisar = () => { clearTimeout(espera); espera = setTimeout(alCambiar, 400); };
  for (const table of ['mediciones', 'nodos', 'clima_cultivo']) canal.on('postgres_changes', { event: '*', schema: 'public', table }, avisar);
  canal.subscribe(estado => alEstado(estado === 'SUBSCRIBED'));
  return () => { clearTimeout(espera); void client.removeChannel(canal); };
}
