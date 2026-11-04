import type { Capacidad, Medicion, Nodo } from './types.ts';
import { formarLote } from './domain.ts';

export interface Zona {
  id: string; cultivo_id: string; codigo: string; nombre: string;
  plano_x: number; plano_y: number; plano_ancho: number; plano_alto: number;
}
export interface NodoPlano extends Nodo {
  agricultor_id: string; tipo_nodo: 'fisico' | 'virtual'; zona_id: string | null;
  posicion_x: number | null; posicion_y: number | null; asignacion_version: string;
}
export interface Plano { zonas: Zona[]; nodos: NodoPlano[]; capacidades: Capacidad[] }
export interface MedicionZona extends Medicion { zona_id: string | null; zona_contexto: Record<string, unknown> }
export interface CapturaZona {
  mensajeId: string; tomadaEn: string; recibidaEn: string; origen: 'real' | 'simulado';
  zonaId: string | null; zonaNombre: string | null; asignacionVersion: string | null;
  posicionX: number | null; posicionY: number | null;
  valores: { codigo: string; nombre: string; unidad: string; valor: number; ayuda: string }[];
}
export const VARIABLES_ZONA = [
  { codigo: 'temperatura_aire', nombre: 'Temperatura del aire', unidad: '°C', min: -40, max: 80, ayuda: 'Temperatura ambiental.' },
  { codigo: 'humedad_aire', nombre: 'Humedad del aire', unidad: '% HR', min: 0, max: 100, ayuda: 'Humedad relativa del aire.' },
  { codigo: 'iluminacion_relativa', nombre: 'Iluminación relativa', unidad: '% relativo', min: 0, max: 100, ayuda: 'Índice relativo; no mide lux.' },
  { codigo: 'radiacion_solar', nombre: 'Radiación solar', unidad: 'W/m²', min: 0, max: 1400, ayuda: 'Independiente del índice de iluminación.' },
  { codigo: 'humedad_suelo_vwc', nombre: 'Humedad del suelo', unidad: '% VWC', min: 0, max: 80, ayuda: 'Contenido volumétrico de agua a 20 cm.' },
  { codigo: 'temperatura_suelo', nombre: 'Temperatura del suelo', unidad: '°C', min: -20, max: 70, ayuda: 'Profundidad de referencia: 20 cm.' },
  { codigo: 'ph_suelo', nombre: 'pH del suelo', unidad: 'sin unidad', min: 0, max: 14, ayuda: 'Valor de pH sin unidad.' },
  { codigo: 'conductividad_suelo_ece', nombre: 'Conductividad del suelo', unidad: 'dS/m', min: 0, max: 30, ayuda: 'ECe: extracto de pasta saturada a 25 °C.' },
  { codigo: 'precipitacion_60min', nombre: 'Lluvia en los últimos 60 min', unidad: 'mm', min: 0, max: 200, ayuda: 'Ventana móvil de 60 min. No sumar capturas sucesivas.' },
  { codigo: 'velocidad_viento', nombre: 'Velocidad del viento', unidad: 'm/s', min: 0, max: 50, ayuda: 'Velocidad del viento.' },
] as const;
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const coordenada = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const objeto = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
function canonico(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonico).join(',') + ']';
  if (objeto(v)) return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonico(v[k])).join(',') + '}';
  return JSON.stringify(v) ?? 'undefined';
}
export function validarPlano(plano: Plano, cultivoId: string, usuarioId: string): Plano {
  if (!Array.isArray(plano.zonas) || !Array.isArray(plano.nodos) || !Array.isArray(plano.capacidades)) throw new Error('Respuesta del croquis incompleta.');
  const ids = new Set<string>();
  for (const z of plano.zonas) {
    if (!z || !uuid(z.id) || ids.has(z.id) || z.cultivo_id !== cultivoId || typeof z.nombre !== 'string' || !z.nombre.trim() ||
        typeof z.codigo !== 'string' || !coordenada(z.plano_x) || !coordenada(z.plano_y) || !coordenada(z.plano_ancho) || !coordenada(z.plano_alto) ||
        z.plano_ancho === 0 || z.plano_alto === 0 || z.plano_x + z.plano_ancho > 1.00000001 || z.plano_y + z.plano_alto > 1.00000001) throw new Error('La geometría de las zonas no es válida.');
    ids.add(z.id);
  }
  const nodos = new Set<string>();
  for (const n of plano.nodos) {
    if (!n || !uuid(n.id) || nodos.has(n.id) || n.cultivo_id !== cultivoId || n.agricultor_id !== usuarioId || !uuid(n.asignacion_version) ||
        !['fisico', 'virtual'].includes(n.tipo_nodo) || typeof n.codigo !== 'string' || typeof n.habilitado !== 'boolean' ||
        (n.zona_id === null ? n.posicion_x !== null || n.posicion_y !== null : !ids.has(n.zona_id) || !coordenada(n.posicion_x) || !coordenada(n.posicion_y))) throw new Error('La ubicación o propiedad de los nodos no coincide.');
    nodos.add(n.id);
  }
  if (plano.capacidades.some(c => !nodos.has(c.nodo_id) || typeof c.variable_codigo !== 'string' || typeof c.sensor_modelo !== 'string') ||
      new Set(plano.capacidades.map(c => c.nodo_id + ':' + c.variable_codigo)).size !== plano.capacidades.length) throw new Error('Las capacidades de los nodos no coinciden.');
  return plano;
}
export function puntoNodo(nodo: NodoPlano, zonas: Zona[]): { x: number; y: number } | null {
  const z = zonas.find(z => z.id === nodo.zona_id);
  if (!z || !coordenada(nodo.posicion_x) || !coordenada(nodo.posicion_y)) return null;
  return { x: z.plano_x + nodo.posicion_x * z.plano_ancho, y: z.plano_y + nodo.posicion_y * z.plano_alto };
}
export function esVirtualCompleto(nodo: NodoPlano, capacidades: Capacidad[]): boolean {
  const propias = capacidades.filter(c => c.nodo_id === nodo.id);
  return nodo.tipo_nodo === 'virtual' && propias.length === 10 && VARIABLES_ZONA.every(v => propias.some(c => c.variable_codigo === v.codigo && c.sensor_modelo === 'SIMULADOR_V3'));
}
export function formarCapturaZona(filas: MedicionZona[], nodo: NodoPlano, cultivoId: string, mensajeId: string, conLdr: boolean): CapturaZona {
  if (!filas.length || new Set(filas.map(f => f.id)).size !== filas.length) throw new Error('La captura está incompleta o repetida.');
  const primera = filas[0], origen = nodo.tipo_nodo === 'virtual' ? 'simulado' : 'real';
  for (const f of filas) {
    if (!uuid(f.id) || f.nodo_id !== nodo.id || f.cultivo_id !== cultivoId || f.mensaje_id !== mensajeId || f.origen !== origen ||
        !Number.isFinite(Date.parse(f.tomada_en)) || !Number.isFinite(Date.parse(f.recibida_en)) ||
        Date.parse(f.tomada_en) !== Date.parse(primera.tomada_en) || Date.parse(f.recibida_en) !== Date.parse(primera.recibida_en) ||
        f.zona_id !== primera.zona_id || canonico(f.zona_contexto) !== canonico(primera.zona_contexto)) throw new Error('La captura no coincide con el nodo, origen o ubicación histórica.');
  }
  const contexto = primera.zona_contexto;
  if (!objeto(contexto) || (primera.zona_id !== null && (!uuid(primera.zona_id) || contexto.id !== primera.zona_id || typeof contexto.nombre !== 'string' ||
      !coordenada(contexto.posicion_nodo_x) || !coordenada(contexto.posicion_nodo_y)))) throw new Error('La ubicación histórica de la captura no es válida.');
  let version: string | null = null;
  if (origen === 'real') formarLote(filas, nodo.id, cultivoId, mensajeId, conLdr);
  else {
    if (filas.length !== 10 || primera.zona_id === null || !uuid(mensajeId) || new Set(filas.map(f => f.variable_codigo)).size !== 10) throw new Error('La captura simulada debe contener diez variables.');
    const meta = primera.metadatos;
    if (!meta || !uuid(meta.asignacion_version) || !objeto(meta.simulacion)) throw new Error('Falta la trazabilidad de la simulación.');
    const s = meta.simulacion;
    if (!uuid(s.ejecucion_id) || typeof s.semilla !== 'number' || !Number.isInteger(s.semilla) || s.semilla < 1 || s.semilla > 999999999 ||
        !['referencia', 'calor-seco', 'lluvia', 'viento', 'ph', 'recuperacion'].includes(String(s.escenario_id)) ||
        !['manual', 'escenario'].includes(String(s.modo)) || !Number.isInteger(s.paso) || Number(s.paso) < 0 || Number(s.paso) > 12 || s.pasos_transicion !== 12 || (s.modo === 'manual' && s.paso !== 0)) throw new Error('El contexto de simulación no es válido.');
    version = meta.asignacion_version;
    for (const f of filas) {
      const v = VARIABLES_ZONA.find(v => v.codigo === f.variable_codigo), m = f.metadatos;
      if (!v || typeof f.valor !== 'number' || !Number.isFinite(f.valor) || f.valor < v.min || f.valor > v.max || Number(f.valor.toFixed(4)) !== f.valor ||
          !m || m.version_payload !== 3 || m.asignacion_version !== version || m.unidad !== v.unidad || canonico(m.simulacion) !== canonico(s) || !objeto(m.detalle)) throw new Error('Variables o metadatos de simulación incoherentes.');
      const detalle: Record<string, unknown> = { fuente: 'generador_sintetico_v1' };
      if (['humedad_suelo_vwc', 'temperatura_suelo'].includes(v.codigo)) detalle.profundidad_cm = 20;
      if (v.codigo === 'iluminacion_relativa') detalle.metodo = 'indice_relativo_sintetico_v1';
      if (v.codigo === 'conductividad_suelo_ece') Object.assign(detalle, { metodo: 'extracto_pasta_saturada_ECe', temperatura_referencia_c: 25 });
      if (v.codigo === 'precipitacion_60min') Object.assign(detalle, { ventana: 'movil', periodo_segundos: 3600, inicio_periodo: new Date(Date.parse(f.tomada_en) - 3600000).toISOString(), fin_periodo: new Date(f.tomada_en).toISOString(), acumulados_no_sumables: true });
      if (canonico(m.detalle) !== canonico(detalle)) throw new Error('El método o la ventana de la variable no coincide.');
    }
  }
  return {
    mensajeId, tomadaEn: primera.tomada_en, recibidaEn: primera.recibida_en, origen, zonaId: primera.zona_id,
    zonaNombre: typeof contexto.nombre === 'string' ? contexto.nombre : null, asignacionVersion: version,
    posicionX: typeof contexto.posicion_nodo_x === 'number' ? contexto.posicion_nodo_x : null,
    posicionY: typeof contexto.posicion_nodo_y === 'number' ? contexto.posicion_nodo_y : null,
    valores: VARIABLES_ZONA.filter(v => filas.some(f => f.variable_codigo === v.codigo)).map(v => ({ codigo: v.codigo, nombre: v.nombre, unidad: v.unidad, ayuda: v.ayuda, valor: filas.find(f => f.variable_codigo === v.codigo)!.valor })),
  };
}
export function ubicacionCoincide(captura: CapturaZona, nodo: NodoPlano): boolean {
  return captura.zonaId === nodo.zona_id && captura.posicionX === nodo.posicion_x && captura.posicionY === nodo.posicion_y &&
    (nodo.tipo_nodo !== 'virtual' || captura.asignacionVersion === nodo.asignacion_version);
}
