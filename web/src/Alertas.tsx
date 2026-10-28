import {useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Cultivo,Nodo} from './types.ts';
import {VARIABLES_ALERTA,avisoEvidencia,cargarEpisodios,cargarReglas,desactivarRegla,guardarRegla,motivoCierre,revisarAlerta,validarLimites} from './alert-data.ts';
import type {CursorAlertas,Episodio,FiltroAlertas,ReglaAlerta,VariableAlerta} from './alert-data.ts';
import {fechaBogota} from './domain.ts';
const numero=(n:number)=>n.toLocaleString('es-CO',{maximumFractionDigits:4});
interface Resultado {clave:string;reglas:ReglaAlerta[];filas:Episodio[];hayMas:boolean;fecha:string}
export default function Alertas({client,cultivo,nodos,revision,onCambio}:{client:SupabaseClient;cultivo:Cultivo;nodos:Nodo[];revision:number;onCambio:()=>void}){
  const [pestana,setPestana]=useState<'episodios'|'reglas'>('episodios');
  const [filtro,setFiltro]=useState<FiltroAlertas>({estado:'activas',revision:'todas'});
  const [cursores,setCursores]=useState<(CursorAlertas|null)[]>([null]);
  const [resultado,setResultado]=useState<Resultado|null>(null),[cargando,setCargando]=useState(true),[error,setError]=useState('');
  const [refresco,setRefresco]=useState(0),[ocupado,setOcupado]=useState(false),[aviso,setAviso]=useState(''),[errorCambio,setErrorCambio]=useState('');
  const bloqueo=useRef(false);
  const [editor,setEditor]=useState(false),[variable,setVariable]=useState<VariableAlerta>('temperatura_aire');
  const [min,setMin]=useState(''),[max,setMax]=useState(''),[confirmado,setConfirmado]=useState(false);
  const [desactivar,setDesactivar]=useState<ReglaAlerta|null>(null);
  const [ahora,setAhora]=useState(Date.now());
  const clave=JSON.stringify([cultivo.id,filtro,cursores.at(-1)]);
  useEffect(()=>{let activo=true;const abort=new AbortController();setCargando(true);setError('');
    Promise.all([cargarReglas(client,cultivo.id,abort.signal),cargarEpisodios(client,cultivo.id,filtro,cursores.at(-1)!,abort.signal)]).then(([reglas,pagina])=>{if(activo)setResultado({clave,reglas,...pagina,fecha:new Date().toISOString()});}).catch(e=>{if(activo)setError(e instanceof Error?e.message:'No pudimos actualizar las alertas.');}).finally(()=>{if(activo)setCargando(false);});
    return()=>{activo=false;abort.abort();};
  },[client,cultivo.id,filtro,cursores,clave,revision,refresco]);
  useEffect(()=>{if(editor||desactivar||ocupado||cursores.length>1)return;const timer=window.setInterval(()=>setRefresco(r=>r+1),30000);return()=>window.clearInterval(timer);},[editor,desactivar,ocupado,cursores.length]);
  useEffect(()=>{const timer=window.setInterval(()=>setAhora(Date.now()),1000);return()=>window.clearInterval(timer);},[]);
  const datos=resultado?.clave===clave?resultado:null;
  function editar(r?:ReglaAlerta){setEditor(true);setDesactivar(null);setVariable(r?.variable_codigo??'temperatura_aire');setMin(r?.minimo===null||r?.minimo===undefined?'':String(r.minimo));setMax(r?.maximo===null||r?.maximo===undefined?'':String(r.maximo));setConfirmado(false);setErrorCambio('');setAviso('');}
  async function ejecutar(operacion:()=>Promise<void>,mensaje:string){if(bloqueo.current)return;bloqueo.current=true;setOcupado(true);setErrorCambio('');try{await operacion();setAviso(mensaje);setEditor(false);setDesactivar(null);setRefresco(r=>r+1);onCambio();}catch(e){setErrorCambio(e instanceof Error?e.message:'No pudimos confirmar el cambio. Actualiza las alertas.');}finally{bloqueo.current=false;setOcupado(false);}}
  function guardar(e:FormEvent){e.preventDefault();if(!confirmado||cultivo.archivado_en)return;try{validarLimites(variable,min,max);}catch(e){setErrorCambio((e as Error).message);return;}void ejecutar(()=>guardarRegla(client,cultivo.id,variable,min,max),'Límites guardados. Se aplicarán a nuevas mediciones recibidas; espera la siguiente captura.');}
  return <section className="alertas-cultivo" aria-label="Alertas del cultivo">
    <div className="cabecera-alertas"><span className="etiqueta-origen">Datos reales</span><button className="btn boton-secundario" disabled={ocupado||cargando} onClick={()=>setRefresco(r=>r+1)}>Actualizar alertas</button></div>
    <p className="ayuda-gestion">Consulta automática cada 30 s en la primera página. Sin alertas no significa cultivo saludable. La revisión y el cierre de la condición son independientes.</p>
    {aviso&&<p className="aviso exito" role="status">{aviso}</p>}{errorCambio&&<p className="aviso error" role="alert">{errorCambio}</p>}
    {error&&<p className="aviso error" role="alert">{error}{datos?' Se conserva la última consulta correcta, con su fecha indicada.':''}</p>}
    {cargando&&<p role="status">Actualizando reglas y alertas…</p>}
    <div className="filtro-cultivos pestanas-alertas" role="group" aria-label="Vista de alertas"><button disabled={ocupado} aria-pressed={pestana==='episodios'} onClick={()=>{setPestana('episodios');setEditor(false);setDesactivar(null);setErrorCambio('');}}>Episodios</button><button disabled={ocupado} aria-pressed={pestana==='reglas'} onClick={()=>setPestana('reglas')}>Reglas</button></div>
    {datos&&pestana==='reglas'&&<>
      <section className="reglas-alertas" aria-labelledby="titulo-reglas"><div className="acciones-lista"><h2 id="titulo-reglas">Límites de monitoreo</h2>{!cultivo.archivado_en&&<button className="btn boton-principal" disabled={ocupado} onClick={()=>editar()}>Configurar regla</button>}</div>
        <p>No hay límites agronómicos predefinidos. Usa valores elegidos para tu cultivo; los rangos admitidos corresponden al sensor. La iluminación es un índice relativo, no lux.</p>
        {!datos.reglas.length&&<p className="aviso neutral">No hay reglas reales activas para este cultivo.</p>}
        <div className="lista-reglas">{datos.reglas.map(r=><article key={r.id} className="regla-alerta"><h3>{VARIABLES_ALERTA[r.variable_codigo].nombre}</h3><p>Mínimo: {r.minimo===null?'Sin límite':numero(r.minimo)+' '+VARIABLES_ALERTA[r.variable_codigo].unidad}</p><p>Máximo: {r.maximo===null?'Sin límite':numero(r.maximo)+' '+VARIABLES_ALERTA[r.variable_codigo].unidad}</p>{!cultivo.archivado_en&&<div className="acciones-cultivo"><button className="btn boton-secundario" disabled={ocupado} onClick={()=>editar(r)}>Editar límites</button><button className="enlace-archivo" disabled={ocupado} onClick={()=>{setDesactivar(r);setEditor(false);setErrorCambio('');setAviso('');}}>Desactivar regla</button></div>}</article>)}</div>
      </section>
    </>}
    {editor&&!cultivo.archivado_en&&<form className="formulario-cultivo editor-alerta" onSubmit={guardar}>
      <h2>Configurar límites</h2><fieldset disabled={ocupado}>
        <label className="form-label" htmlFor="regla-variable">Variable</label><select id="regla-variable" className="form-select" value={variable} onChange={e=>{const v=e.target.value as VariableAlerta;const r=datos?.reglas.find(r=>r.variable_codigo===v);setVariable(v);setMin(r?.minimo==null?'':String(r.minimo));setMax(r?.maximo==null?'':String(r.maximo));setConfirmado(false);}}>{Object.entries(VARIABLES_ALERTA).map(([k,v])=><option key={k} value={k}>{v.nombre} ({v.unidad})</option>)}</select>
        <div className="campos-area"><div><label className="form-label" htmlFor="regla-min">Mínimo (opcional)</label><input id="regla-min" className="form-control" inputMode="decimal" value={min} onChange={e=>{setMin(e.target.value);setConfirmado(false);}}/></div><div><label className="form-label" htmlFor="regla-max">Máximo (opcional)</label><input id="regla-max" className="form-control" inputMode="decimal" value={max} onChange={e=>{setMax(e.target.value);setConfirmado(false);}}/></div></div>
        <p className="ayuda-gestion">Admitido: {VARIABLES_ALERTA[variable].min} a {VARIABLES_ALERTA[variable].max} {VARIABLES_ALERTA[variable].unidad}. Al menos un límite. El valor igual al límite está dentro del rango.</p>
        <p className="aviso advertencia">Cambiar los límites sustituye la regla anterior y cierra sus episodios por cambio de configuración. Esto no indica recuperación ambiental. Las capturas anteriores no se vuelven a evaluar.</p>
        <label className="opcion-nodo"><input type="checkbox" checked={confirmado} onChange={e=>setConfirmado(e.target.checked)}/>Confirmo estos límites y el efecto de sustituir una regla existente.</label>
        <div className="acciones-cultivo"><button className="btn boton-principal" disabled={!confirmado}>{ocupado?'Guardando…':'Guardar límites'}</button><button type="button" className="btn boton-secundario" onClick={()=>{setEditor(false);setErrorCambio('');}}>Cancelar</button></div>
      </fieldset>
    </form>}
    {desactivar&&<section className="confirmar-archivo"><h2>Desactivar {VARIABLES_ALERTA[desactivar.variable_codigo].nombre}</h2><p>Se dejará de evaluar esta regla y sus episodios abiertos se cerrarán por desactivación, conservando las evidencias. Esto no indica recuperación del cultivo.</p><div className="acciones-cultivo"><button className="btn boton-peligro" disabled={ocupado} onClick={()=>{void ejecutar(()=>desactivarRegla(client,desactivar.id),'Regla desactivada. Sus episodios se conservan.');}}>Confirmar desactivación</button><button className="btn boton-secundario" disabled={ocupado} onClick={()=>setDesactivar(null)}>Cancelar</button></div></section>}
    {pestana==='episodios'&&<section className="episodios-alertas" aria-label="Episodios de alerta"><h2>Alertas del cultivo</h2>
      <div className="filtros-alertas"><div><label className="form-label" htmlFor="alerta-estado">Condición</label><select id="alerta-estado" className="form-select" disabled={ocupado} value={filtro.estado} onChange={e=>{setFiltro({...filtro,estado:e.target.value as FiltroAlertas['estado']});setCursores([null]);}}><option value="activas">Activas</option><option value="cerradas">Cerradas</option><option value="todas">Todas</option></select></div><div><label className="form-label" htmlFor="alerta-revision">Revisión</label><select id="alerta-revision" className="form-select" disabled={ocupado} value={filtro.revision} onChange={e=>{setFiltro({...filtro,revision:e.target.value as FiltroAlertas['revision']});setCursores([null]);}}><option value="todas">Todas</option><option value="pendientes">Sin revisar</option><option value="revisadas">Revisadas</option></select></div></div>
      {datos&&<>
        <p className="pie-consulta">Consulta correcta: {fechaBogota(datos.fecha)} · Página {cursores.length}</p>
        {!datos.filas.length&&<div className="vacio"><h3>No hay alertas para estos filtros</h3><p>Comprueba las reglas, la llegada de nuevas mediciones y la evaluación en n8n. Este resultado no certifica el estado del cultivo.</p></div>}
        <div className="lista-episodios">{datos.filas.map(a=>{const v=VARIABLES_ALERTA[a.variable_codigo];const advertencia=avisoEvidencia(a.ultima_tomada_en,ahora);return <article className={'tarjeta-alerta '+(a.cerrada_en?'cerrada':'activa')} key={a.id}>
          <div className="estados-alerta"><span className={'estado '+(a.cerrada_en?'neutral':'revisar')}>{a.cerrada_en?'Cerrada':'Activa'}</span><span className="estado neutral">{a.revisada_en?'Revisada':'Sin revisar'}</span></div>
          <h3>{v.nombre} {a.limite==='superior'?'por encima del máximo':'por debajo del mínimo'}</h3>
          <p>Nodo: {nodos.find(n=>n.id===a.nodo_id)?.codigo??a.nodo_id}</p><p className="valor-alerta">{numero(a.valor_ultimo)} <span>{v.unidad}</span></p><p>Último valor fuera de rango · Límite: {numero(a.umbral)} {v.unidad}</p>
          <p>Evidencia: {fechaBogota(a.ultima_tomada_en)}</p>{!a.cerrada_en&&advertencia&&<p className="aviso advertencia">{advertencia}</p>}
          {a.cerrada_en&&<p className="cierre-alerta">{motivoCierre(a.motivo_cierre)} · {fechaBogota(a.cerrada_en)}</p>}
          {a.revisada_en&&<p>Revisada: {fechaBogota(a.revisada_en)}</p>}
          {!a.revisada_en&&<button className="btn boton-principal" disabled={ocupado} onClick={()=>{void ejecutar(()=>revisarAlerta(client,a.id),'Alerta marcada como revisada. La condición mantiene su estado independiente.');}}>Marcar como revisada</button>}
          <details className="evidencia-alerta"><summary>Ver evidencia</summary><p>Apertura: {fechaBogota(a.abierta_en)}</p><p>Valor inicial: {numero(a.valor_inicial)} {v.unidad}</p><p>Episodio: <code>{a.id}</code></p><p>Medición inicial: <code>{a.medicion_inicial_id}</code></p><p>Última fuera de rango: <code>{a.medicion_ultima_id}</code></p>{a.medicion_cierre_id&&<p>Medición de cierre: <code>{a.medicion_cierre_id}</code></p>}</details>
        </article>;})}</div>
        <div className="paginas-historial"><button className="btn boton-secundario" disabled={ocupado||cargando||cursores.length<=1} onClick={()=>setCursores(c=>c.slice(0,-1))}>Anterior</button><span>Hasta 20 episodios por página</span><button className="btn boton-secundario" disabled={ocupado||cargando||!datos.hayMas||!datos.filas.length} onClick={()=>{const a=datos.filas.at(-1)!;setCursores(c=>[...c,{fecha:a.abierta_en,id:a.id}]);}}>Siguiente</button></div>
      </>}
    </section>}
  </section>;
}
