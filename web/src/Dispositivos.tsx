import { useEffect,useRef,useState } from 'react';
import NodoVirtualDialogo from './NodoVirtualDialogo.tsx';
import { Buscador, Selector, coincide } from './Filtros.tsx';
import { Confirmar } from './Dialogo.tsx';
import NodoFisicoAsistente from './NodoFisicoAsistente.tsx';
import { eliminarNodoFisico } from './nodo-fisico-data.ts';
import { eliminarNodoVirtual, retirarNodoVirtual } from './simulacion-data.ts';
import './escenario.css';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contexto,Nodo } from './types.ts';
import { actividadNodos,cambiarVinculo,cargarUbicaciones,ultimaRecepcion } from './device-data.ts';
import type { CambioNodo,Ubicaciones } from './device-data.ts';
import { fechaBogota } from './domain.ts';
import { VARIABLES_ZONA } from './zone-domain.ts';
export default function Dispositivos({client,contexto,revision,actualizado}:{client:SupabaseClient;contexto:Contexto;revision:number;actualizado:()=>void}){
  const [accion,setAccion]=useState<{nodo:Nodo;desvincular:boolean}|null>(null);
  const [destino,setDestino]=useState(''),[confirmado,setConfirmado]=useState(false),[ocupado,setOcupado]=useState(false);
  const [error,setError]=useState(''),[aviso,setAviso]=useState('');const bloqueo=useRef(false);
  const [recepciones,setRecepciones]=useState<Record<string,{fecha:string|null;error:boolean}>>({});
  const [actividad,setActividad]=useState<CambioNodo[]>([]),[errorActividad,setErrorActividad]=useState(''),[cargando,setCargando]=useState(true);
  // Sectores y refresco: la vista se actualiza cada 30 s para ver llegar las capturas simuladas por zona.
  const [ubicaciones,setUbicaciones]=useState<Ubicaciones|null>(null),[tick,setTick]=useState(0);
  useEffect(()=>{const t=window.setInterval(()=>{if(!document.hidden)setTick(x=>x+1);},30000);return()=>window.clearInterval(t);},[]);
  useEffect(()=>{
    let activo=true;if(!tick)setCargando(true);
    cargarUbicaciones(client,contexto.nodos.map(n=>n.id),contexto.cultivos.map(c=>c.id)).then(u=>{if(activo)setUbicaciones(u);}).catch(()=>{if(activo)setUbicaciones(null);});
    void Promise.all(contexto.nodos.map(async n=>{try{const r=await ultimaRecepcion(client,n.id,n.tipo_nodo==='virtual'?'simulado':'real');return [n.id,{fecha:r?.recibida_en??null,error:false}] as const;}catch{return [n.id,{fecha:null,error:true}] as const;}})).then(r=>{if(activo){setRecepciones(Object.fromEntries(r));setCargando(false);}});
    actividadNodos(client,contexto.nodos.map(n=>n.id)).then(r=>{if(activo){setActividad(r);setErrorActividad('');}}).catch(e=>{if(activo){setActividad([]);setErrorActividad(e.message);}});
    return ()=>{activo=false;};
  },[client,contexto,revision,tick]);
  const destinos=contexto.cultivos.filter(c=>!c.archivado_en&&contexto.nodos.filter(n=>n.tipo_nodo!=='virtual'&&n.cultivo_id===c.id).length<2);
  const nombre=(id:string|null)=>id?contexto.cultivos.find(c=>c.id===id)?.nombre??id:'Sin cultivo';
  // Filtros de la lista: texto, cultivo y tipo. Solo cambian lo que se muestra.
  const [q,setQ]=useState(''),[fCultivo,setFCultivo]=useState('todos'),[fTipo,setFTipo]=useState('todos');
  const sectorDe=(n:Nodo)=>{const z=ubicaciones?.zonaDeNodo[n.id];return z?ubicaciones?.zonas[z]?.nombre??'':'';};
  const visibles=contexto.nodos.filter(n=>(fTipo==='todos'||(fTipo==='virtual')===(n.tipo_nodo==='virtual'))&&(fCultivo==='todos'||(fCultivo==='sin'?!n.cultivo_id:n.cultivo_id===fCultivo))
    &&coincide([n.codigo,n.cultivo_id?contexto.cultivos.find(c=>c.id===n.cultivo_id)?.nombre??'':'sin cultivo',sectorDe(n),n.tipo_nodo==='virtual'?'simulado virtual':'fisico'].join(' '),q));
  function agrupar(){
    const orden=['zona-norte','zona-sur','zona-central','zona-drenaje'];
    const grupos=[...contexto.cultivos.filter(c=>visibles.some(n=>n.cultivo_id===c.id)).map(c=>({clave:c.id,nombre:c.nombre,nodos:visibles.filter(n=>n.cultivo_id===c.id)})),
      ...(visibles.some(n=>!n.cultivo_id)?[{clave:'sin-cultivo',nombre:'Sin cultivo asignado',nodos:visibles.filter(n=>!n.cultivo_id)}]:[])];
    return grupos.map(g=>{
      const zonaDe=(n:Nodo)=>ubicaciones?.zonaDeNodo[n.id]??null;
      const conSectores=!!ubicaciones&&g.nodos.some(n=>zonaDe(n));
      const claves=[...new Set(g.nodos.map(n=>zonaDe(n)??'sin-sector'))].sort((a,b)=>{
        const ia=orden.indexOf(ubicaciones?.zonas[a]?.codigo??''),ib=orden.indexOf(ubicaciones?.zonas[b]?.codigo??'');
        return (a==='sin-sector'?-1:ia===-1?99:ia)-(b==='sin-sector'?-1:ib===-1?99:ib);});
      return {...g,conSectores,sectores:claves.map(k=>({clave:k,nombre:k==='sin-sector'?'Sin sector (físicos)':ubicaciones?.zonas[k]?.nombre??'Sector',
        nodos:g.nodos.filter(n=>(zonaDe(n)??'sin-sector')===k).sort((a,b)=>Number(a.tipo_nodo==='virtual')-Number(b.tipo_nodo==='virtual')||a.codigo.localeCompare(b.codigo))}))};
    });
  }
  const [virtual,setVirtual]=useState<{nodo?:Nodo}|null>(null),[borrar,setBorrar]=useState<Nodo|null>(null),[fisico,setFisico]=useState<{nodo?:Nodo}|null>(null);
  async function retirar(nodo:Nodo){
    if(bloqueo.current)return;bloqueo.current=true;setOcupado(true);setError('');setAviso('');
    try{await retirarNodoVirtual(client,nodo.id);setAviso(nodo.codigo+' quedó sin cultivo. Su historial se conserva y deja de transmitir hasta que lo vincules de nuevo.');actualizado();}
    catch(e){setError(e instanceof Error?e.message:'No pudimos desvincular el nodo simulado.');}
    finally{bloqueo.current=false;setOcupado(false);}
  }
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
      {accion.desvincular?<p>Se quitará de {nombre(accion.nodo.cultivo_id)}. Sus mediciones anteriores permanecerán en ese cultivo. Las nuevas capturas no se guardarán mientras esté sin asignar.</p>:<><Selector id="destino-nodo" etiqueta="Cultivo de destino" desactivado={ocupado||!destinos.length} valor={destino} alCambiar={setDestino} opciones={destinos.map(c=>({valor:c.id,texto:c.nombre,detalle:c.tipo}))}/>{!destinos.length&&<p className="aviso advertencia">No tienes cultivos activos con espacio disponible. Puedes registrar uno con este nodo desde Cultivos.</p>}</>}
      <p className="aviso advertencia">Antes de cambiar de cultivo: apaga el ESP32 y espera al menos siete minutos desde su última publicación. Mantenlo apagado durante el cambio para evitar que capturas pendientes lleguen al cultivo nuevo.</p>
      <label className="opcion-nodo"><input type="checkbox" disabled={ocupado} checked={confirmado} onChange={e=>setConfirmado(e.target.checked)}/>He detenido el nodo y he esperado al menos siete minutos.</label>
      <div className="acciones-cultivo"><button className={'btn '+(accion.desvincular?'boton-peligro':'boton-principal')} disabled={ocupado||!confirmado||(!accion.desvincular&&!destinos.length)} onClick={()=>{void confirmar();}}>{ocupado?'Guardando…':accion.desvincular?'Confirmar desvinculación':'Confirmar vinculación'}</button><button className="btn boton-secundario" disabled={ocupado} onClick={()=>{setAccion(null);setError('');}}>Cancelar</button></div>
    </section>:<>
      <div className="acciones-lista"><p className="ayuda-gestion">Registra tus placas y cárgales el firmware desde aquí, o crea nodos simulados. Después vincúlalos a un cultivo y ubícalos en su sector.</p><div className="acciones-ia"><button className="btn boton-secundario" onClick={()=>setFisico({})}>+ Registrar nodo físico</button><button className="btn boton-principal" onClick={()=>setVirtual({})}>+ Nuevo nodo simulado</button></div></div>
      {fisico&&<NodoFisicoAsistente client={client} nodo={fisico.nodo} alCambiar={actualizado} alCerrar={()=>setFisico(null)}/>}
      {borrar&&<Confirmar titulo={'Eliminar '+borrar.codigo} accion={borrar.tipo_nodo==='virtual'?'Eliminar nodo simulado':'Eliminar nodo físico'} alCerrar={()=>setBorrar(null)}
        texto="El nodo deja de existir en tu cuenta y no se puede recuperar. Si ya transmitió, sus mediciones se conservan en el historial del cultivo donde estuvo. Si es una placa, su clave deja de servir."
        alConfirmar={()=>(borrar.tipo_nodo==='virtual'?eliminarNodoVirtual(client,borrar.id):eliminarNodoFisico(client,borrar.id)).then(modo=>{setAviso(modo==='borrado'?borrar.codigo+' fue eliminado.':borrar.codigo+' fue retirado. Sus mediciones anteriores se conservan.');setError('');actualizado();})}/>}
      {virtual&&<NodoVirtualDialogo client={client} cultivos={contexto.cultivos} nodo={virtual.nodo} alGuardar={m=>{setAviso(m);setError('');actualizado();}} alCerrar={()=>setVirtual(null)}/>}
      {contexto.nodos.length>0&&<div className="barra-filtros" role="search" aria-label="Filtrar dispositivos">
        <Buscador etiqueta="Buscar dispositivo" valor={q} alCambiar={setQ} marcador="Código, cultivo o sector"/>
        <Selector etiqueta="Cultivo" valor={fCultivo} alCambiar={setFCultivo} opciones={[{valor:'todos',texto:'Todos los cultivos'},...contexto.cultivos.filter(c=>contexto.nodos.some(n=>n.cultivo_id===c.id)).map(c=>({valor:c.id,texto:c.nombre,detalle:contexto.nodos.filter(n=>n.cultivo_id===c.id).length+' dispositivos'})),...(contexto.nodos.some(n=>!n.cultivo_id)?[{valor:'sin',texto:'Sin cultivo asignado'}]:[])]}/>
        <Selector etiqueta="Tipo" valor={fTipo} alCambiar={setFTipo} opciones={[{valor:'todos',texto:'Físicos y simulados'},{valor:'fisico',texto:'Solo físicos'},{valor:'virtual',texto:'Solo simulados'}]}/>
        <p className="filtro-cuenta" role="status">{visibles.length} de {contexto.nodos.length}</p>
      </div>}
      {contexto.nodos.length>0&&!visibles.length&&<div className="vacio"><h2>Ningún dispositivo coincide</h2><p>Cambia la búsqueda o los filtros para ver más dispositivos.</p><button type="button" className="btn boton-principal" onClick={()=>{setQ('');setFCultivo('todos');setFTipo('todos');}}>Quitar filtros</button></div>}
      {!contexto.nodos.length&&<div className="vacio"><h2>Aún no tienes dispositivos autorizados</h2><p>El equipo debe habilitar los nodos para tu cuenta antes de asignarlos a un cultivo.</p></div>}
      {/* Por cultivo y, dentro, por sector del croquis. El fisico va en "Sin sector". */}
      {agrupar().map(g=><section className="grupo-dispositivos" key={g.clave} aria-label={'Dispositivos de '+g.nombre}>
        <h2 className="titulo-grupo-dispositivos">{g.nombre}<span>{g.nodos.length} {g.nodos.length===1?'dispositivo':'dispositivos'}</span></h2>
        {g.sectores.map(sec=><div className="sector-dispositivos" key={sec.clave}>
          {g.conSectores&&<h3>{sec.nombre}<span>{sec.nodos.length}</span></h3>}
          <div className="lista-cultivos">{sec.nodos.map(n=>{const r=recepciones[n.id];return <article className="tarjeta-cultivo" key={n.id}>
        <span className={'estado '+(!n.habilitado?'neutral':n.cultivo_id?'reciente':'neutral')}>{!n.habilitado?'Deshabilitado':n.cultivo_id?'Asignado':'Disponible'}</span><h2>{n.codigo}</h2><p>Cultivo: {nombre(n.cultivo_id)}</p>
        {n.tipo_nodo==='virtual'?<details className="variables-virtuales"><summary>{contexto.capacidades.filter(c=>c.nodo_id===n.id).length} variables simuladas: aire, suelo, lluvia y viento</summary><ul className="sensores-nodo">{contexto.capacidades.filter(c=>c.nodo_id===n.id).map(c=><li key={c.variable_codigo}>{VARIABLES_ZONA.find(v=>v.codigo===c.variable_codigo)?.nombre??c.variable_codigo} · {n.tipo_nodo==='virtual'?'Simulada':c.sensor_modelo}</li>)}</ul></details>:<ul className="sensores-nodo">{contexto.capacidades.filter(c=>c.nodo_id===n.id).map(c=><li key={c.variable_codigo}>{VARIABLES_ZONA.find(v=>v.codigo===c.variable_codigo)?.nombre??c.variable_codigo} · {n.tipo_nodo==='virtual'?'Simulada':c.sensor_modelo}</li>)}</ul>}
        {n.tipo_nodo==='virtual'?<><p>{cargando?'Consultando última recepción…':r?.error?'Error al consultar la última recepción.':r?.fecha?'Última recepción simulada (aprox.): '+fechaBogota(r.fecha):'Sin mediciones simuladas guardadas.'}</p><p className="aviso neutral">Nodo virtual · Simulada. Sus valores están en Inicio y en Simulación.</p></>:<><p>{cargando?'Consultando última recepción…':r?.error?'Error al consultar la última recepción.':r?.fecha?'Última recepción real (aprox.): '+fechaBogota(r.fecha):'Sin mediciones reales guardadas.'}</p><p>La fecha no confirma la conexión actual del nodo.</p></>}
        {n.tipo_nodo!=='virtual'?<div className="acciones-cultivo">{n.cultivo_id?<button className="enlace-archivo" onClick={()=>preparar(n,true)}>Desvincular</button>:<button className="btn boton-principal" disabled={!n.habilitado} onClick={()=>preparar(n,false)}>Vincular a cultivo</button>}<button className="btn boton-secundario" onClick={()=>setFisico({nodo:n})}>Configurar placa</button>{!n.cultivo_id&&<button className="enlace-archivo" disabled={ocupado} onClick={()=>setBorrar(n)}>Eliminar</button>}</div>
          :<div className="acciones-cultivo">{n.cultivo_id?<><button className="btn boton-secundario" disabled={ocupado} onClick={()=>setVirtual({nodo:n})}>Mover a otro cultivo</button><button className="enlace-archivo" disabled={ocupado} onClick={()=>{void retirar(n);}}>Desvincular nodo simulado</button></>:<><button className="btn boton-principal" disabled={!n.habilitado} onClick={()=>setVirtual({nodo:n})}>Vincular a cultivo</button><button className="enlace-archivo" disabled={ocupado} onClick={()=>setBorrar(n)}>Eliminar</button></>}</div>}
      </article>;})}</div>
        </div>)}
      </section>)}
      <details className="actividad-nodos"><summary>Últimos cambios de asignación (hasta 20)</summary>
        {errorActividad?<p className="aviso error" role="alert">{errorActividad}</p>:!actividad.length?<p>No hay cambios registrados.</p>:<ol>{actividad.map(a=><li key={a.id}><strong>{contexto.nodos.find(n=>n.id===a.nodo_id)?.codigo??a.nodo_id}</strong><p>{a.motivo==='estado_inicial'?'Estado al habilitar el registro de cambios: '+nombre(a.cultivo_nuevo_id):nombre(a.cultivo_anterior_id)+' → '+nombre(a.cultivo_nuevo_id)}</p><span>{fechaBogota(a.realizado_en)}</span></li>)}</ol>}
      </details>
    </>}
  </section>;
}
