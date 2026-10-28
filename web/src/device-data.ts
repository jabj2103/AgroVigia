import type { SupabaseClient } from '@supabase/supabase-js';
import type { Nodo } from './types.ts';
export interface CambioNodo { id:string; nodo_id:string; cultivo_anterior_id:string|null; cultivo_nuevo_id:string|null; motivo:string; realizado_en:string }
export async function cambiarVinculo(client:SupabaseClient,nodoId:string,cultivoId:string,desvincular:boolean):Promise<Nodo> {
  const r=desvincular ? await client.rpc('desvincular_nodo',{p_nodo_id:nodoId,p_cultivo_esperado_id:cultivoId})
    : await client.rpc('vincular_nodo',{p_nodo_id:nodoId,p_cultivo_id:cultivoId});
  if(r.error){
    const m=r.error.message;
    if(m.includes('NODO_OCUPADO')||m.includes('ASIGNACION_CAMBIO'))throw new Error('La asignación cambió. Actualiza la cuenta y revisa el cultivo del dispositivo.');
    if(m.includes('LIMITE_NODOS_CULTIVO'))throw new Error('Este cultivo ya tiene dos nodos. Selecciona otro cultivo.');
    if(m.includes('NODO_DESHABILITADO'))throw new Error('El equipo ha deshabilitado este dispositivo.');
    if(m.includes('NO_AUTORIZADO')||m.includes('CULTIVO_ARCHIVADO'))throw new Error('El nodo o el cultivo no están disponibles para esta operación. Actualiza la cuenta.');
    throw new Error('No pudimos confirmar el cambio. Actualiza la cuenta antes de reintentar.');
  }
  const n=Array.isArray(r.data)?r.data[0]:r.data;
  if(!n||n.id!==nodoId||n.cultivo_id!==(desvincular?null:cultivoId))throw new Error('Respuesta inesperada. Actualiza la cuenta para comprobar el resultado.');
  return n as Nodo;
}
export async function ultimaRecepcion(client:SupabaseClient,nodoId:string){
  const r=await client.from('mediciones').select('tomada_en,recibida_en').eq('nodo_id',nodoId).eq('origen','real')
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
