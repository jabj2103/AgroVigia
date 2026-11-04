import type { SupabaseClient } from '@supabase/supabase-js';
import type { Capacidad, Contexto, Cultivo, LoteDht, Medicion, Nodo } from './types.ts';
import { formarLote } from './domain.ts';

export async function cargarContexto(client: SupabaseClient, usuarioId: string): Promise<Contexto> {
  const [perfil, cultivos, nodos] = await Promise.all([
    client.from('perfiles').select('nombre').eq('id', usuarioId).maybeSingle(),
    client.from('cultivos').select('id,nombre,tipo,area,unidad_area,archivado_en')
      .eq('agricultor_id', usuarioId).order('creado_en', { ascending: true }),
    client.from('nodos').select('id,codigo,cultivo_id,habilitado,tipo_nodo')
      .eq('agricultor_id', usuarioId).order('codigo'),
  ]);
  for (const respuesta of [perfil, cultivos, nodos]) {
    if (respuesta.error) throw new Error('No pudimos consultar los datos de tu cuenta. Reintenta o inicia sesión otra vez.');
  }
  const listaNodos = (nodos.data ?? []) as Nodo[];
  let capacidades: Capacidad[] = [];
  if (listaNodos.length) {
    const respuesta = await client.from('nodo_variables')
      .select('nodo_id,variable_codigo,sensor_modelo').in('nodo_id', listaNodos.map(n => n.id));
    if (respuesta.error) throw new Error('No pudimos consultar las variables habilitadas.');
    capacidades = (respuesta.data ?? []) as Capacidad[];
  }
  return {
    nombre: (perfil.data as { nombre?: string } | null)?.nombre ?? null,
    cultivos: (cultivos.data ?? []) as Cultivo[], nodos: listaNodos, capacidades,
  };
}

export async function cargarUltimoLote(
  client: SupabaseClient, cultivoId: string, nodoId: string, conLdr = false,
): Promise<LoteDht | null> {
  const ultima = await client.from('mediciones').select('mensaje_id')
    .eq('cultivo_id', cultivoId).eq('nodo_id', nodoId).eq('origen', 'real')
    .order('tomada_en', { ascending: false }).order('recibida_en', { ascending: false })
    .order('mensaje_id', { ascending: false }).limit(1).maybeSingle();
  if (ultima.error) throw new Error('No pudimos actualizar las lecturas. Se conserva la última consulta válida.');
  if (!ultima.data) return null;
  const mensajeId = ultima.data.mensaje_id as string;
  const lote = await client.from('mediciones')
    .select(conLdr ? 'id,cultivo_id,nodo_id,mensaje_id,variable_codigo,valor,tomada_en,recibida_en,origen,metadatos' : 'id,cultivo_id,nodo_id,mensaje_id,variable_codigo,valor,tomada_en,recibida_en,origen')
    .eq('cultivo_id', cultivoId).eq('nodo_id', nodoId).eq('origen', 'real')
    .eq('mensaje_id', mensajeId).order('variable_codigo')
    .overrideTypes<Medicion[], { merge: false }>();
  if (lote.error) throw new Error('No pudimos completar la consulta del lote.');
  return formarLote(lote.data ?? [], nodoId, cultivoId, mensajeId, conLdr);
}
