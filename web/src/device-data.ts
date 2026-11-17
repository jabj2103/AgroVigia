import type { SupabaseClient } from '@supabase/supabase-js';
import type { Nodo } from './types.ts';
export interface CambioNodo { id:string; nodo_id:string; cultivo_anterior_id:string|null; cultivo_nuevo_id:string|null; motivo:string; realizado_en:string }
export async function cambiarVinculo(client:SupabaseClient,nodoId:string,cultivoId:string,desvincular:boolean):Promise<Nodo> {
  const r=desvincular ? await client.rpc('desvincular_nodo',{p_nodo_id:nodoId,p_cultivo_esperado_id:cultivoId})
    : await client.rpc('vincular_nodo',{p_nodo_id:nodoId,p_cultivo_id:cultivoId});
  if(r.error){
    const m=r.error.message;
    if(m.includes('NODO_OCUPADO')||m.includes('ASIGNACION_CAMBIO'))throw new Error('La asignación cambió. Actualiza la cuenta y revisa el cultivo del dispositivo.');
    if(m.includes('LIMITE_NODOS_CULTIVO'))throw new Error('Este cultivo ya tiene dos nodos físicos. Selecciona otro cultivo.');
    if(m.includes('LIMITE_HEXAGONO_CULTIVO'))throw new Error('Este cultivo ya tiene sus 6 nodos (hexágono completo). Selecciona otro cultivo.');
    if(m.includes('NODO_DESHABILITADO'))throw new Error('El equipo ha deshabilitado este dispositivo.');
    if(m.includes('NO_AUTORIZADO')||m.includes('CULTIVO_ARCHIVADO'))throw new Error('El nodo o el cultivo no están disponibles para esta operación. Actualiza la cuenta.');
    throw new Error('No pudimos confirmar el cambio. Actualiza la cuenta antes de reintentar.');
  }
  const n=Array.isArray(r.data)?r.data[0]:r.data;
  if(!n||n.id!==nodoId||n.cultivo_id!==(desvincular?null:cultivoId))throw new Error('Respuesta inesperada. Actualiza la cuenta para comprobar el resultado.');
  return n as Nodo;
}
export async function ultimaRecepcion(client:SupabaseClient,nodoId:string,origen:'real'|'simulado'='real'){
  const r=await client.from('mediciones').select('tomada_en,recibida_en').eq('nodo_id',nodoId).eq('origen',origen)
    .order('recibida_en',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle();
  if(r.error)throw new Error('No pudimos consultar la última recepción.');
  return r.data as {tomada_en:string;recibida_en:string}|null;
}
export async function actividadNodos(client:SupabaseClient,ids:string[]):Promise<CambioNodo[]>{
  if(!ids.length)return [];
  const r=await client.from('nodo_asignaciones').select('id,nodo_id,cultivo_anterior_id,cultivo_nuevo_id,motivo,realizado_en')
    .in('nodo_id',ids).order('realizado_en',{ascending:false}).order('id',{ascending:false}).limit(20);
  if(r.error)throw new Error('No pudimos consultar los cambios de asignación. Comprueba que se aplicó la migración 0005.');
  return r.data as CambioNodo[];
}
// Sector (zona del croquis de 0007) de cada nodo. Sin la tabla de zonas devuelve null y la vista
// lista los dispositivos sin agrupar por sector.
export interface Ubicaciones {zonaDeNodo:Record<string,string|null>;zonas:Record<string,{nombre:string;codigo:string;cultivo_id:string}>}
export async function cargarUbicaciones(client:SupabaseClient,nodoIds:string[],cultivoIds:string[]):Promise<Ubicaciones|null>{
  if(!nodoIds.length)return {zonaDeNodo:{},zonas:{}};
  const [nodos,zonas]=await Promise.all([
    client.from('nodos').select('id,zona_id').in('id',nodoIds),
    cultivoIds.length?client.from('zonas').select('id,cultivo_id,codigo,nombre').in('cultivo_id',cultivoIds).order('codigo'):Promise.resolve({data:[],error:null}),
  ]);
  if(nodos.error||zonas.error||!Array.isArray(nodos.data)||!Array.isArray(zonas.data))return null;
  const lista=zonas.data as {id:string;cultivo_id:string;codigo:string;nombre:string}[];
  return {zonaDeNodo:Object.fromEntries((nodos.data as {id:string;zona_id:string|null}[]).map(n=>[n.id,n.zona_id??null])),
    zonas:Object.fromEntries(lista.map(z=>[z.id,{nombre:z.nombre,codigo:z.codigo,cultivo_id:z.cultivo_id}]))};
}
