import type { SupabaseClient } from '@supabase/supabase-js';
import type { Capacidad } from './types.ts';
import type { CapturaZona, MedicionZona, NodoPlano, Plano, Zona } from './zone-domain.ts';
import { esVirtualCompleto, formarCapturaZona, validarPlano } from './zone-domain.ts';
import { esAmbiental, esDht22 } from './domain.ts';

export async function cargarPlano(client: SupabaseClient, cultivoId: string, usuarioId: string, signal: AbortSignal): Promise<Plano> {
  const [zonas, nodos] = await Promise.all([
    client.from('zonas').select('id,cultivo_id,codigo,nombre,plano_x,plano_y,plano_ancho,plano_alto').eq('cultivo_id', cultivoId).order('codigo').abortSignal(signal),
    client.from('nodos').select('id,codigo,agricultor_id,cultivo_id,habilitado,tipo_nodo,zona_id,posicion_x,posicion_y,asignacion_version')
      .eq('agricultor_id', usuarioId).eq('cultivo_id', cultivoId).order('codigo').abortSignal(signal),
  ]);
  if (zonas.error || nodos.error) throw new Error('No pudimos actualizar las zonas y nodos del cultivo. Reintenta.');
  if (!Array.isArray(zonas.data) || !Array.isArray(nodos.data)) throw new Error('Respuesta del croquis incompleta.');
  const lista = nodos.data as NodoPlano[];
  let capacidades: Capacidad[] = [];
  if (lista.length) {
    const c = await client.from('nodo_variables').select('nodo_id,variable_codigo,sensor_modelo').in('nodo_id', lista.map(n => n.id)).abortSignal(signal);
    if (c.error || !Array.isArray(c.data)) throw new Error('No pudimos consultar las variables de los nodos.');
    capacidades = c.data as Capacidad[];
  }
  return validarPlano({ zonas: zonas.data as Zona[], nodos: lista, capacidades }, cultivoId, usuarioId);
}
export async function cargarCapturaZona(client: SupabaseClient, cultivoId: string, nodo: NodoPlano, capacidades: Capacidad[], signal: AbortSignal): Promise<CapturaZona | null> {
  const virtual = nodo.tipo_nodo === 'virtual', ldr = esAmbiental(nodo.id, capacidades);
  if (virtual ? !esVirtualCompleto(nodo, capacidades) : !ldr && !esDht22(nodo.id, capacidades)) throw new Error('El perfil de variables de este nodo no está integrado.');
  const origen = virtual ? 'simulado' : 'real';
  const ultima = await client.from('mediciones').select('mensaje_id')
    .eq('cultivo_id', cultivoId).eq('nodo_id', nodo.id).eq('origen', origen)
    .order('tomada_en', { ascending: false }).order('recibida_en', { ascending: false }).order('mensaje_id', { ascending: false })
    .limit(1).abortSignal(signal).maybeSingle();
  if (ultima.error) throw new Error('No pudimos consultar la última captura de este nodo.');
  if (!ultima.data) return null;
  const id = ultima.data.mensaje_id;
  if (typeof id !== 'string') throw new Error('La identificación de la captura no es válida.');
  const lote = await client.from('mediciones')
    .select('id,cultivo_id,nodo_id,mensaje_id,variable_codigo,valor,tomada_en,recibida_en,origen,metadatos,zona_id,zona_contexto')
    .eq('cultivo_id', cultivoId).eq('nodo_id', nodo.id).eq('origen', origen).eq('mensaje_id', id).order('variable_codigo').abortSignal(signal);
  if (lote.error || !Array.isArray(lote.data)) throw new Error('No pudimos completar la consulta de la captura.');
  return formarCapturaZona(lote.data as MedicionZona[], nodo, cultivoId, id, ldr);
}
