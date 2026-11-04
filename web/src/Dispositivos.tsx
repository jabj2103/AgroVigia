import { useEffect,useRef,useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contexto,Nodo } from './types.ts';
import { actividadNodos,cambiarVinculo,ultimaRecepcion } from './device-data.ts';
import type { CambioNodo } from './device-data.ts';
import { fechaBogota } from './domain.ts';
import { VARIABLES_ZONA } from './zone-domain.ts';
export default function Dispositivos({client,contexto,revision,actualizado}:{client:SupabaseClient;contexto:Contexto;revision:number;actualizado:()=>void}){
  const [accion,setAccion]=useState<{nodo:Nodo;desvincular:boolean}|null>(null);
  const [destino,setDestino]=useState(''),[confirmado,setConfirmado]=useState(false),[ocupado,setOcupado]=useState(false);
  const [error,setError]=useState(''),[aviso,setAviso]=useState('');const bloqueo=useRef(false);
  const [recepciones,setRecepciones]=useState<Record<string,{fecha:string|null;error:boolean}>>({});
  const [actividad,setActividad]=useState<CambioNodo[]>([]),[errorActividad,setErrorActividad]=useState(''),[cargando,setCargando]=useState(true);
  useEffect(()=>{
    let activo=true;setCargando(true);
    void Promise.all(contexto.nodos.filter(n=>n.tipo_nodo!=='virtual').map(async n=>{try{const r=await ultimaRecepcion(client,n.id);return [n.id,{fecha:r?.recibida_en??null,error:false}] as const;}catch{return [n.id,{fecha:null,error:true}] as const;}})).then(r=>{if(activo){setRecepciones(Object.fromEntries(r));setCargando(false);}});
    actividadNodos(client,contexto.nodos.map(n=>n.id)).then(r=>{if(activo){setActividad(r);setErrorActividad('');}}).catch(e=>{if(activo){setActividad([]);setErrorActividad(e.message);}});
    return ()=>{activo=false;};
  },[client,contexto,revision]);
  const destinos=contexto.cultivos.filter(c=>!c.archivado_en&&contexto.nodos.filter(n=>n.tipo_nodo!=='virtual'&&n.cultivo_id===c.id).length<2);
  const nombre=(id:string|null)=>id?contexto.cultivos.find(c=>c.id===id)?.nombre??id:'Sin cultivo';
  function preparar(nodo:Nodo,desvincular:boolean){setAccion({nodo,desvincular});setDestino(destinos[0]?.id??'');setConfirmado(false);setError('');setAviso('');}
  async function confirmar(){
    if(!accion||!confirmado||bloqueo.current)return;
    if(!accion.desvincular&&!destinos.some(c=>c.id===destino)){setError('Selecciona un cultivo activo disponible.');return;}
    bloqueo.current=true;setOcupado(true);setError('');
    try{await cambiarVinculo(client,accion.nodo.id,accion.desvincular?accion.nodo.cultivo_id!:destino,accion.desvincular);
      setAccion(null);setAviso(accion.desvincular?'Nodo desvinculado. El historial se conserva; no se guardan nuevas capturas hasta asignarlo.':'Nodo vinculado. Ya puedes encenderlo en su nueva ubicación.');actualizado();
    }catch(e){setError(e instanceof Error?e.message:'No pudimos confirmar el cambio. Actualiza la cuenta.');}
    finally{bloqueo.current=false;setOcupado(false);}
  }
  return <section className="gestion-dispositivos" aria-label="Mis dispositivos" aria-busy={ocupado}>
    {aviso&&<p className="aviso exito" role="status">{aviso}</p>}{error&&<p className="aviso error" role="alert">{error}</p>}
    {accion?<section className="confirmar-archivo" aria-labelledby="accion-nodo"><h2 id="accion-nodo">{accion.desvincular?'Desvincular':'Vincular'} {accion.nodo.codigo}</h2>
      {accion.desvincular?<p>Se quitará de {nombre(accion.nodo.cultivo_id)}. Sus mediciones anteriores permanecerán en ese cultivo. Las nuevas capturas no se guardarán mientras esté sin asignar.</p>:<><label className="form-label" htmlFor="destino-nodo">Cultivo de destino</label><select id="destino-nodo" className="form-select" disabled={ocupado} value={destino} onChange={e=>setDestino(e.target.value)}>{destinos.map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}</select>{!destinos.length&&<p className="aviso advertencia">No tienes cultivos activos con espacio disponible. Puedes registrar uno con este nodo desde Cultivos.</p>}</>}
      <p className="aviso advertencia">Antes de cambiar de cultivo: apaga el ESP32 y espera al menos siete minutos desde su última publicación. Mantenlo apagado durante el cambio para evitar que capturas pendientes lleguen al cultivo nuevo.</p>
      <label className="opcion-nodo"><input type="checkbox" disabled={ocupado} checked={confirmado} onChange={e=>setConfirmado(e.target.checked)}/>He detenido el nodo y he esperado al menos siete minutos.</label>
      <div className="acciones-cultivo"><button className={'btn '+(accion.desvincular?'boton-peligro':'boton-principal')} disabled={ocupado||!confirmado||(!accion.desvincular&&!destinos.length)} onClick={()=>{void confirmar();}}>{ocupado?'Guardando…':accion.desvincular?'Confirmar desvinculación':'Confirmar vinculación'}</button><button className="btn boton-secundario" disabled={ocupado} onClick={()=>{setAccion(null);setError('');}}>Cancelar</button></div>
    </section>:<>
      {!contexto.nodos.length&&<div className="vacio"><h2>Aún no tienes dispositivos autorizados</h2><p>El equipo debe habilitar los nodos para tu cuenta antes de asignarlos a un cultivo.</p></div>}
      <div className="lista-cultivos">{contexto.nodos.map(n=>{const r=recepciones[n.id];return <article className="tarjeta-cultivo" key={n.id}>
        <span className={'estado '+(!n.habilitado?'neutral':n.cultivo_id?'reciente':'neutral')}>{!n.habilitado?'Deshabilitado':n.cultivo_id?'Asignado':'Disponible'}</span><h2>{n.codigo}</h2><p>Cultivo: {nombre(n.cultivo_id)}</p>
        <ul className="sensores-nodo">{contexto.capacidades.filter(c=>c.nodo_id===n.id).map(c=><li key={c.variable_codigo}>{VARIABLES_ZONA.find(v=>v.codigo===c.variable_codigo)?.nombre??c.variable_codigo} · {n.tipo_nodo==='virtual'?'Simulada':c.sensor_modelo}</li>)}</ul>
        {n.tipo_nodo==='virtual'?<p className="aviso neutral">Nodo virtual · Simulada. Consulta sus capturas y ubicación en Inicio → Zonas y nodos.</p>:<><p>{cargando?'Consultando última recepción…':r?.error?'Error al consultar la última recepción.':r?.fecha?'Última recepción real (aprox.): '+fechaBogota(r.fecha):'Sin mediciones reales guardadas.'}</p><p>La fecha no confirma la conexión actual del nodo.</p></>}
        {n.tipo_nodo!=='virtual'&&<div className="acciones-cultivo">{n.cultivo_id?<button className="enlace-archivo" onClick={()=>preparar(n,true)}>Desvincular</button>:<button className="btn boton-principal" disabled={!n.habilitado} onClick={()=>preparar(n,false)}>Vincular a cultivo</button>}</div>}
      </article>;})}</div>
      <details className="actividad-nodos"><summary>Últimos cambios de asignación (hasta 20)</summary>
        {errorActividad?<p className="aviso error" role="alert">{errorActividad}</p>:!actividad.length?<p>No hay cambios registrados.</p>:<ol>{actividad.map(a=><li key={a.id}><strong>{contexto.nodos.find(n=>n.id===a.nodo_id)?.codigo??a.nodo_id}</strong><p>{a.motivo==='estado_inicial'?'Estado al habilitar el registro de cambios: '+nombre(a.cultivo_nuevo_id):nombre(a.cultivo_anterior_id)+' → '+nombre(a.cultivo_nuevo_id)}</p><span>{fechaBogota(a.realizado_en)}</span></li>)}</ol>}
      </details>
    </>}
  </section>;
}
