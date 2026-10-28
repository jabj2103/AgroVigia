import type {SupabaseClient} from '@supabase/supabase-js';
export interface ResumenPendientes {cantidad:number;ultima:{id:string;cultivo_id:string;abierta_en:string}|null}
export async function cargarPendientes(client:SupabaseClient,cultivos:string[],signal?:AbortSignal):Promise<ResumenPendientes>{
  if(!cultivos.length)return {cantidad:0,ultima:null};
  const r=await client.from('alertas').select('id,cultivo_id,abierta_en',{count:'exact'})
    .in('cultivo_id',cultivos).eq('origen','real').is('cerrada_en',null).is('revisada_en',null)
    .order('abierta_en',{ascending:false}).order('id',{ascending:false}).limit(1).abortSignal(signal??new AbortController().signal);
  if(r.error)throw new Error('No pudimos actualizar el contador de alertas.');
  const ultima=r.data?.[0]??null;
  if(r.count===null||!Number.isInteger(r.count)||r.count<0||(r.count>0&&!ultima)||(r.count===0&&ultima)||(ultima&&(!cultivos.includes(ultima.cultivo_id)||!Number.isFinite(Date.parse(ultima.abierta_en)))))throw new Error('Contador de alertas no disponible.');
  return {cantidad:r.count,ultima};
}
export function esAlertaNueva(ultima:ResumenPendientes['ultima'],anterior:ResumenPendientes['ultima']){
  return !!ultima&&(!anterior||Date.parse(ultima.abierta_en)>Date.parse(anterior.abierta_en)||(Date.parse(ultima.abierta_en)===Date.parse(anterior.abierta_en)&&ultima.id>anterior.id));
}
