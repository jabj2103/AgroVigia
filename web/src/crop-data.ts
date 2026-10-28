import type { SupabaseClient } from '@supabase/supabase-js';
import type { Cultivo } from './types.ts';
export interface DatosCultivo { nombre: string; tipo: string; area: string; unidad: string; nodos: string[] }
export function validarCultivo(d: DatosCultivo, crear: boolean) {
  if (!d.nombre.trim() || d.nombre.trim().length > 100 || !d.tipo.trim() || d.tipo.trim().length > 100)
    throw new Error('Escribe un nombre y un tipo de cultivo de hasta 100 caracteres.');
  if (!/^\d+(?:[.,]\d{1,4})?$/.test(d.area.trim())) throw new Error('El área debe ser positiva y tener como máximo cuatro decimales.');
  const area = Number(d.area.replace(',', '.'));
  if (!Number.isFinite(area) || area <= 0 || area > 99999999.9999) throw new Error('Revisa el área del cultivo.');
  if (!['m2','ha'].includes(d.unidad)) throw new Error('Selecciona m² o hectáreas.');
  if (crear && (d.nodos.length < 1 || d.nodos.length > 2 || new Set(d.nodos).size !== d.nodos.length))
    throw new Error('Selecciona uno o dos nodos disponibles de tu cuenta.');
  return { p_nombre: d.nombre.trim(), p_tipo: d.tipo.trim(), p_area: area, p_unidad_area: d.unidad };
}
export function mensajeGestion(error: { message?: string; code?: string }) {
  const m = error.message ?? '';
  if (m.includes('NODOS_NO_DISPONIBLES')) return 'Algún nodo ya no está disponible. Actualiza la cuenta y revisa la selección.';
  if (m.includes('SOLICITUD_EN_CONFLICTO')) return 'Esta solicitud ya fue procesada con otra configuración. Actualiza la cuenta antes de intentar otra creación.';
  if (m.includes('CULTIVO_ARCHIVADO')) return 'Este cultivo está archivado. Actualiza la cuenta.';
  if (m.includes('PERFIL_NO_AUTORIZADO') || m.includes('CULTIVO_NO_AUTORIZADO')) return 'Tu cuenta no tiene permiso para esta operación. Actualiza la cuenta o consulta al equipo.';
  return 'No pudimos confirmar el cambio. Actualiza la cuenta para comprobar si se guardó; puedes reintentar la misma solicitud.';
}
export async function guardarCultivo(client: SupabaseClient, datos: DatosCultivo, id: string | null, solicitud: string): Promise<Cultivo> {
  const args = validarCultivo(datos, !id);
  const r = id ? await client.rpc('editar_cultivo', { ...args, p_cultivo_id: id })
    : await client.rpc('crear_cultivo', { ...args, p_nodos: datos.nodos, p_solicitud_id: solicitud });
  if (r.error) throw new Error(mensajeGestion(r.error));
  // Una RPC que retorna un composite produce un objeto; admite tambien la envoltura de fila.
  const cultivo = Array.isArray(r.data) ? r.data[0] : r.data;
  if (!cultivo || typeof cultivo.id !== 'string') throw new Error('Respuesta incompleta. Actualiza la cuenta para comprobar el resultado.');
  return cultivo as Cultivo;
}
export async function archivarCultivo(client: SupabaseClient, id: string) {
  const r = await client.rpc('archivar_cultivo', { p_cultivo_id: id });
  if (r.error) throw new Error(mensajeGestion(r.error));
  const c = Array.isArray(r.data) ? r.data[0] : r.data;
  if (!c?.archivado_en) throw new Error('No pudimos confirmar el archivado. Actualiza la cuenta.');
}
