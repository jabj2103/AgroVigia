import type { SupabaseClient } from '@supabase/supabase-js';
import type { Origen } from './types.ts';

export const ESTADOS_GENERALES = {
  // Sin textos que sugieran «cultivo sano»: la IA solo ve las lecturas disponibles.
  favorable: { texto: 'Sin acciones urgentes', clase: 'reciente' },
  atencion: { texto: 'Requiere atención', clase: 'antiguo' },
  critico: { texto: 'Crítico', clase: 'revisar' },
  datos_insuficientes: { texto: 'Datos insuficientes', clase: 'neutral' },
} as const;
export const PRIORIDADES = { alta: 'Prioridad alta', media: 'Prioridad media', baja: 'Prioridad baja' } as const;
export const VARIABLES_IA = { temperatura_aire: 'Temperatura del aire', humedad_aire: 'Humedad del aire', iluminacion_relativa: 'Iluminación relativa',
  radiacion_solar: 'Radiación solar', humedad_suelo_vwc: 'Humedad del suelo', temperatura_suelo: 'Temperatura del suelo', ph_suelo: 'pH del suelo',
  conductividad_suelo_ece: 'Conductividad del suelo', precipitacion_60min: 'Lluvia (60 min)', velocidad_viento: 'Velocidad del viento', general: 'General' } as const;
export interface Recomendacion { titulo: string; accion: string; prioridad: keyof typeof PRIORIDADES; variable: keyof typeof VARIABLES_IA; evidencia: string }
export interface RespuestaIA { resumen: string; estado_general: keyof typeof ESTADOS_GENERALES; recomendaciones: Recomendacion[]; riego: string; luz: string; limitaciones: string }
export interface ContextoIA { hora_local?: string; periodo_del_dia?: string; plantilla?: { nombre?: string } | null;
  nodos?: { codigo: string; ultima_captura: string | null; valores: Record<string, number> | null }[]; alertas_abiertas?: unknown[] }
export interface Sugerencia {
  id: string; cultivo_id: string; origen: Origen; motivo: 'periodica' | 'alerta' | 'solicitud'; estado: 'pendiente' | 'generada' | 'fallida';
  plantilla_codigo: string | null; respuesta: RespuestaIA | null; modelo: string | null; error_codigo: string | null;
  solicitada_en: string; completada_en: string | null; contexto: ContextoIA;
}
const texto = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
// Mismas reglas que public.respuesta_ia_valida: lo que no cumple no se muestra como sugerencia.
export function respuestaValida(r: unknown): r is RespuestaIA {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
  const x = r as Record<string, unknown>;
  if (Object.keys(x).sort().join() !== 'estado_general,limitaciones,luz,recomendaciones,resumen,riego') return false;
  if (!Object.hasOwn(ESTADOS_GENERALES, String(x.estado_general)) || !texto(x.resumen, 600) || !texto(x.riego, 500) || !texto(x.luz, 500) || !texto(x.limitaciones, 500)) return false;
  return Array.isArray(x.recomendaciones) && x.recomendaciones.length >= 1 && x.recomendaciones.length <= 5 && x.recomendaciones.every(e => {
    const y = e as Record<string, unknown>;
    return !!e && typeof e === 'object' && Object.keys(y).sort().join() === 'accion,evidencia,prioridad,titulo,variable' && texto(y.titulo, 100) && texto(y.accion, 400) &&
      texto(y.evidencia, 300) && Object.hasOwn(PRIORIDADES, String(y.prioridad)) && Object.hasOwn(VARIABLES_IA, String(y.variable));
  });
}
const uuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);

export async function cargarSugerencias(client: SupabaseClient, cultivo: string, origen: Origen, signal?: AbortSignal): Promise<Sugerencia[]> {
  if (!uuid(cultivo)) throw new Error('Cultivo inválido.');
  let q = client.from('sugerencias_ia').select('id,cultivo_id,origen,motivo,estado,plantilla_codigo,respuesta,modelo,error_codigo,solicitada_en,completada_en,contexto')
    .eq('cultivo_id', cultivo).eq('origen', origen).order('solicitada_en', { ascending: false }).order('id', { ascending: false }).limit(10);
  if (signal) q = q.abortSignal(signal);
  const r = await q;
  if (r.error) throw new Error('No pudimos consultar las sugerencias. Reintenta la actualización.');
  const filas = (r.data ?? []) as Sugerencia[];
  if (filas.some(s => s.cultivo_id !== cultivo || s.origen !== origen || !uuid(s.id) || !['pendiente', 'generada', 'fallida'].includes(s.estado) ||
      !Number.isFinite(Date.parse(s.solicitada_en)) || (s.estado === 'generada' && !respuestaValida(s.respuesta))))
    throw new Error('Respuesta de sugerencias incompleta o inconsistente.');
  return filas;
}

export function textoFallo(codigo: string | null): string {
  if (!codigo) return 'La solicitud no se completó.';
  if (codigo === 'GEMINI_HTTP_429') return 'Gemini rechazó la solicitud por límite de uso o saldo agotado (429).';
  if (codigo === 'GEMINI_HTTP_401' || codigo === 'GEMINI_HTTP_403') return 'La API key de Gemini no es válida o no tiene permiso.';
  if (codigo === 'GEMINI_HTTP_404') return 'El servicio de IA no está disponible con la configuración actual. Avisa al equipo de AgroVigía.';
  if (codigo.startsWith('GEMINI_HTTP_5') || codigo === 'GEMINI_SIN_RESPUESTA') return 'La IA no respondió a tiempo. Se volverá a intentar en unos minutos.';
  if (codigo === 'SIN_RESPUESTA') return 'El análisis no se completó a tiempo. Puedes pedirlo de nuevo en un momento.';
  if (['RESPUESTA_INVALIDA', 'GEMINI_FORMA_INVALIDA', 'GEMINI_JSON_INVALIDO', 'GEMINI_RESPUESTA_TRUNCADA'].includes(codigo)) return 'La respuesta de la IA no tenía el formato esperado y no se guardó.';
  if (codigo === 'GEMINI_BLOQUEADA') return 'Gemini bloqueó la respuesta por sus filtros de seguridad.';
  return 'La solicitud no se completó (código ' + codigo + ').';
}
