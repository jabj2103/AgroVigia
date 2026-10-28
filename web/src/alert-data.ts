import type { SupabaseClient } from '@supabase/supabase-js';
export const VARIABLES_ALERTA = {
  temperatura_aire:{nombre:'Temperatura del aire',unidad:'°C',min:-40,max:80},
  humedad_aire:{nombre:'Humedad del aire',unidad:'% HR',min:0,max:100},
  iluminacion_relativa:{nombre:'Iluminación relativa',unidad:'% relativo',min:0,max:100},
} as const;
export type VariableAlerta=keyof typeof VARIABLES_ALERTA;
export interface ReglaAlerta {id:string;cultivo_id:string;variable_codigo:VariableAlerta;origen:string;minimo:number|null;maximo:number|null;habilitada:boolean;creada_en:string}
export interface Episodio {id:string;regla_id:string;cultivo_id:string;nodo_id:string;variable_codigo:VariableAlerta;origen:string;limite:'inferior'|'superior';umbral:number;valor_inicial:number;valor_ultimo:number;abierta_en:string;ultima_tomada_en:string;cerrada_en:string|null;motivo_cierre:string|null;revisada_en:string|null;medicion_inicial_id:string;medicion_ultima_id:string;medicion_cierre_id:string|null}
export interface CursorAlertas {fecha:string;id:string}
export interface FiltroAlertas {estado:'activas'|'cerradas'|'todas';revision:'todas'|'pendientes'|'revisadas'}
const uuid=(v:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
export function validarLimites(variable:VariableAlerta,minimo:string,maximo:string){
  const v=VARIABLES_ALERTA[variable];if(!v)throw new Error('Selecciona una variable disponible.');
  function convertir(s:string){if(!s.trim())return null;if(!/^-?\d+(?:[.,]\d{1,4})?$/.test(s.trim()))throw new Error('Usa números con un máximo de cuatro decimales.');const n=Number(s.trim().replace(',','.'));if(!Number.isFinite(n)||n<v.min||n>v.max)throw new Error(`Los límites deben estar entre ${v.min} y ${v.max} ${v.unidad}.`);return n;}
  const min=convertir(minimo),max=convertir(maximo);
  if(min===null&&max===null)throw new Error('Escribe al menos un límite.');
  if(min!==null&&max!==null&&min>=max)throw new Error('El mínimo debe ser menor que el máximo.');
  return {p_minimo:min,p_maximo:max};
}
export function motivoCierre(m:string|null){return ({dentro_de_rango:'Nueva lectura dentro del rango',cambio_de_limite:'Cambio al extremo opuesto',regla_desactivada:'Regla desactivada o sustituida',nodo_desvinculado:'Nodo desvinculado o deshabilitado'} as Record<string,string>)[m??'']??'Cierre registrado';}
export function avisoEvidencia(fecha:string,ahora=Date.now()){
  const t=Date.parse(fecha);if(!Number.isFinite(t))return 'Fecha de evidencia no disponible.';
  if(t>ahora)return 'La fecha de captura está adelantada. Revisa el reloj del nodo.';
  return ahora-t>180000?'Evidencia antigua: no confirma la condición actual.':'';
}
function falloCambio(m:string){
  if(m.includes('LIMITES_INVALIDOS'))return 'Revisa los límites configurados.';
  if(m.includes('CULTIVO_ARCHIVADO'))return 'El cultivo está archivado; actualiza la cuenta.';
  if(m.includes('NO_AUTORIZAD'))return 'Tu cuenta no puede realizar esta operación. Actualiza la cuenta.';
  return 'No pudimos confirmar el cambio. Actualiza las alertas antes de reintentar.';
}
export async function cargarReglas(client:SupabaseClient,cultivo:string,signal?:AbortSignal):Promise<ReglaAlerta[]>{
  let q=client.from('reglas_alerta').select('id,cultivo_id,variable_codigo,origen,minimo,maximo,habilitada,creada_en').eq('cultivo_id',cultivo).eq('origen','real').eq('habilitada',true).order('variable_codigo');
  if(signal)q=q.abortSignal(signal);const r=await q;
  if(r.error)throw new Error('No pudimos consultar las reglas. Reintenta la actualización.');
  const filas=(r.data??[]) as ReglaAlerta[];
  if(filas.some(f=>f.cultivo_id!==cultivo||f.origen!=='real'||!f.habilitada||!Object.hasOwn(VARIABLES_ALERTA,f.variable_codigo)))throw new Error('Respuesta de reglas inconsistente.');
  return filas;
}
export async function cargarEpisodios(client:SupabaseClient,cultivo:string,filtro:FiltroAlertas,cursor:CursorAlertas|null,signal?:AbortSignal){
  if(!uuid(cultivo)||!['activas','cerradas','todas'].includes(filtro.estado)||!['todas','pendientes','revisadas'].includes(filtro.revision))throw new Error('Filtros de alertas inválidos.');
  let q=client.from('alertas').select('id,regla_id,cultivo_id,nodo_id,variable_codigo,origen,limite,umbral,valor_inicial,valor_ultimo,abierta_en,ultima_tomada_en,cerrada_en,motivo_cierre,revisada_en,medicion_inicial_id,medicion_ultima_id,medicion_cierre_id',{count:'exact'}).eq('cultivo_id',cultivo).eq('origen','real');
  if(filtro.estado==='activas')q=q.is('cerrada_en',null);else if(filtro.estado==='cerradas')q=q.not('cerrada_en','is',null);
  if(filtro.revision==='pendientes')q=q.is('revisada_en',null);else if(filtro.revision==='revisadas')q=q.not('revisada_en','is',null);
  if(cursor){if(!uuid(cursor.id)||!Number.isFinite(Date.parse(cursor.fecha)))throw new Error('Cursor inválido.');const fecha=new Date(cursor.fecha).toISOString();q=q.or(`abierta_en.lt.${fecha},and(abierta_en.eq.${fecha},id.lt.${cursor.id})`);}
  q=q.order('abierta_en',{ascending:false}).order('id',{ascending:false}).limit(20);if(signal)q=q.abortSignal(signal);
  const r=await q;if(r.error)throw new Error('No pudimos consultar las alertas. Reintenta la actualización.');
  const filas=(r.data??[]) as Episodio[];
  if(r.count===null||r.count<filas.length||(r.count>0&&!filas.length)||filas.some(a=>a.cultivo_id!==cultivo||a.origen!=='real'||!uuid(a.id)||!Object.hasOwn(VARIABLES_ALERTA,a.variable_codigo)||!Number.isFinite(Date.parse(a.abierta_en))))throw new Error('Respuesta de alertas incompleta o inconsistente.');
  return {filas,hayMas:r.count>filas.length};
}
export async function guardarRegla(client:SupabaseClient,cultivo:string,variable:VariableAlerta,min:string,max:string){
  const valores=validarLimites(variable,min,max);
  const r=await client.rpc('configurar_regla_alerta',{p_cultivo_id:cultivo,p_variable_codigo:variable,...valores,p_origen:'real'});
  if(r.error)throw new Error(falloCambio(r.error.message));const f=Array.isArray(r.data)?r.data[0]:r.data;
  if(!f?.id||f.cultivo_id!==cultivo||f.origen!=='real'||!f.habilitada||f.variable_codigo!==variable||f.minimo!==valores.p_minimo||f.maximo!==valores.p_maximo)throw new Error('No pudimos confirmar los límites guardados. Actualiza las alertas.');
}
export async function desactivarRegla(client:SupabaseClient,id:string){const r=await client.rpc('desactivar_regla_alerta',{p_regla_id:id});if(r.error)throw new Error(falloCambio(r.error.message));const f=Array.isArray(r.data)?r.data[0]:r.data;if(f?.id!==id||f.habilitada!==false)throw new Error('No pudimos confirmar la desactivación. Actualiza las alertas.');}
export async function revisarAlerta(client:SupabaseClient,id:string){const r=await client.rpc('revisar_alerta',{p_alerta_id:id});if(r.error)throw new Error(falloCambio(r.error.message));const a=Array.isArray(r.data)?r.data[0]:r.data;if(a?.id!==id||!a.revisada_en)throw new Error('No pudimos confirmar la revisión. Actualiza las alertas.');}
