import type { SupabaseClient } from '@supabase/supabase-js';
import type { Capacidad, Contexto, Cultivo, LoteDht, Medicion, Nodo, Origen } from './types.ts';
import { formarLote } from './domain.ts';

export async function cargarContexto(client: SupabaseClient, usuarioId: string): Promise<Contexto> {
  // Sin la migracion 0009 la columna plantilla_codigo no existe (42703): se cargan los cultivos sin plantilla
  // para que el resto del panel siga disponible; IA, red y plantillas informan su propio error.
  const consultarCultivos = (campos: string) => client.from('cultivos').select(campos)
    .eq('agricultor_id', usuarioId).order('creado_en', { ascending: true });
  // Lo mismo con las columnas de la 0011 y la 0012 (nodos eliminados y medidas del terreno): si faltan, se
  // repite la consulta sin ellas en lugar de dejar la cuenta sin panel.
  const consultarNodos = (sinEliminados: boolean) => { const q = client.from('nodos').select('id,codigo,cultivo_id,habilitado,tipo_nodo');
    return (sinEliminados ? q.is('eliminado_en', null) : q).eq('agricultor_id', usuarioId).order('codigo'); };
  const [perfil, cultivosCompletos, nodosVigentes] = await Promise.all([
    client.from('perfiles').select('nombre').eq('id', usuarioId).maybeSingle(),
    consultarCultivos('id,nombre,tipo,area,unidad_area,archivado_en,plantilla_codigo,ancho_m,largo_m'),
    consultarNodos(true),
  ]);
  const cultivosConPlantilla = cultivosCompletos.error?.code === '42703'
    ? await consultarCultivos('id,nombre,tipo,area,unidad_area,archivado_en,plantilla_codigo') : cultivosCompletos;
  const cultivos = cultivosConPlantilla.error?.code === '42703'
    ? await consultarCultivos('id,nombre,tipo,area,unidad_area,archivado_en') : cultivosConPlantilla;
  const nodos = nodosVigentes.error?.code === '42703' ? await consultarNodos(false) : nodosVigentes;
  for (const respuesta of [perfil, cultivos, nodos]) {
    if (respuesta.error) throw new Error('No pudimos consultar los datos de tu cuenta. Reintenta o inicia sesión otra vez.');
  }
  // El tipo de nodo (0007 de zonas) define el origen: un virtual solo recibe datos simulados.
  const listaNodos = ((nodos.data ?? []) as Nodo[]).map(n => ({ ...n, simulado: n.tipo_nodo === 'virtual' }));
  let capacidades: Capacidad[] = [];
  if (listaNodos.length) {
    const respuesta = await client.from('nodo_variables')
      .select('nodo_id,variable_codigo,sensor_modelo').in('nodo_id', listaNodos.map(n => n.id));
    if (respuesta.error) throw new Error('No pudimos consultar las variables habilitadas.');
    capacidades = (respuesta.data ?? []) as Capacidad[];
  }
  return {
    nombre: (perfil.data as { nombre?: string } | null)?.nombre ?? null,
    cultivos: (cultivos.data ?? []) as unknown as Cultivo[], nodos: listaNodos, capacidades,
  };
}

export async function cargarUltimoLote(
  client: SupabaseClient, cultivoId: string, nodoId: string, conLdr = false, origen: Origen = 'real',
): Promise<LoteDht | null> {
  const ultima = await client.from('mediciones').select('mensaje_id')
    .eq('cultivo_id', cultivoId).eq('nodo_id', nodoId).eq('origen', origen)
    .order('tomada_en', { ascending: false }).order('recibida_en', { ascending: false })
    .order('mensaje_id', { ascending: false }).limit(1).maybeSingle();
  if (ultima.error) throw new Error('No pudimos actualizar las lecturas. Se conserva la última consulta válida.');
  if (!ultima.data) return null;
  const mensajeId = ultima.data.mensaje_id as string;
  const lote = await client.from('mediciones')
    .select(conLdr ? 'id,cultivo_id,nodo_id,mensaje_id,variable_codigo,valor,tomada_en,recibida_en,origen,metadatos' : 'id,cultivo_id,nodo_id,mensaje_id,variable_codigo,valor,tomada_en,recibida_en,origen')
    .eq('cultivo_id', cultivoId).eq('nodo_id', nodoId).eq('origen', origen)
    .eq('mensaje_id', mensajeId).order('variable_codigo')
    .overrideTypes<Medicion[], { merge: false }>();
  if (lote.error) throw new Error('No pudimos completar la consulta del lote.');
  return formarLote(lote.data ?? [], nodoId, cultivoId, mensajeId, conLdr, origen);
}
