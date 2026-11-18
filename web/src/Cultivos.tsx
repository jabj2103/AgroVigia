import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contexto, Cultivo } from './types.ts';
import { archivarCultivo, guardarCultivo } from './crop-data.ts';
import type { DatosCultivo } from './crop-data.ts';
import { fechaBogota, origenesCultivo } from './domain.ts';
import { TEXTO_CONEXION, cargarEstadoRed, estadoConexion, tonoConexion } from './red-data.ts';
import type { EstadoNodoRed } from './red-data.ts';
import ParametrosDialogo from './ParametrosDialogo.tsx';
import NodoVirtualDialogo from './NodoVirtualDialogo.tsx';
import Terreno from './Terreno.tsx';
import { Buscador, Selector, coincide } from './Filtros.tsx';
import { Confirmar } from './Dialogo.tsx';
import { eliminarCultivo, retirarNodoVirtual } from './simulacion-data.ts';
import type { Nodo } from './types.ts';
import './escenario.css';
export default function Cultivos({ client, contexto, actualizado, abrir }: {
  client: SupabaseClient; contexto: Contexto; actualizado: () => void; abrir: (id: string, historial: boolean) => void;
}) {
  const [filtro, setFiltro] = useState('activos');
  const [edicion, setEdicion] = useState<Cultivo | 'nuevo' | null>(null);
  const [archivo, setArchivo] = useState<Cultivo | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const bloqueo = useRef(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [confirmado, setConfirmado] = useState(false);
  // Estado en vivo de los nodos de cada cultivo y dialogos de parametros y de nodo simulado.
  const [red, setRed] = useState<EstadoNodoRed[] | null>(null), [ahora, setAhora] = useState(Date.now()), [tick, setTick] = useState(0);
  const [dialogo, setDialogo] = useState<{ tipo: 'parametros' | 'nodo' | 'mover' | 'eliminar'; cultivo: Cultivo; nodo?: Nodo } | null>(null);
  const [terreno, setTerreno] = useState<string>('');
  function quitar(n: Nodo) {
    if (bloqueo.current) return; bloqueo.current = true; setError(''); setAviso('');
    retirarNodoVirtual(client, n.id).then(() => { setAviso(n.codigo + ' quedó sin cultivo. Puedes reutilizarlo en otro cultivo o eliminarlo desde Dispositivos.'); actualizado(); })
      .catch(e => setError(e instanceof Error ? e.message : 'No pudimos quitar el nodo.')).finally(() => { bloqueo.current = false; });
  }
  useEffect(() => { const t = window.setInterval(() => { if (!document.hidden) setTick(x => x + 1); }, 20_000); return () => window.clearInterval(t); }, []);
  useEffect(() => {
    const abort = new AbortController();
    cargarEstadoRed(client, abort.signal).then(f => { setRed(f); setAhora(Date.now()); }).catch(() => { if (!abort.signal.aborted) setRed(null); });
    return () => abort.abort();
  }, [client, contexto, tick]);
  const [solicitud, setSolicitud] = useState('');
  const [datos, setDatos] = useState<DatosCultivo>({ nombre:'',tipo:'',area:'',unidad:'m2',nodos:[] });
  const disponibles = contexto.nodos.filter(n => n.tipo_nodo !== 'virtual' && n.habilitado && !n.cultivo_id);
  function editar(c: Cultivo | 'nuevo') {
    setEdicion(c); setArchivo(null); setError(''); setAviso(''); setSolicitud(crypto.randomUUID());
    setDatos(c === 'nuevo' ? { nombre:'',tipo:'',area:'',unidad:'m2',nodos:[] }
      : { nombre:c.nombre,tipo:c.tipo,area:String(c.area),unidad:c.unidad_area,nodos:[] });
  }
  async function guardar(e: FormEvent) {
    e.preventDefault(); if (bloqueo.current) return;
    bloqueo.current=true; setOcupado(true); setError('');
    try {
      await guardarCultivo(client, datos, edicion === 'nuevo' ? null : edicion!.id, solicitud);
      setEdicion(null); setAviso('Cultivo guardado. Actualizando tu cuenta…'); actualizado();
    } catch(e) { setError(e instanceof Error ? e.message : 'No pudimos confirmar el cambio. Actualiza la cuenta.'); }
    finally { bloqueo.current=false; setOcupado(false); }
  }
  async function archivar() {
    if (!archivo || !confirmado || bloqueo.current) return;
    bloqueo.current=true; setOcupado(true); setError('');
    try {
      await archivarCultivo(client, archivo.id); setArchivo(null);
      setAviso('Cultivo archivado. Su historial se conserva y sus nodos quedan disponibles.'); actualizado();
    } catch(e) { setError(e instanceof Error ? e.message : 'No pudimos confirmar el archivado. Actualiza la cuenta.'); }
    finally { bloqueo.current=false; setOcupado(false); }
  }
  const [q, setQ] = useState(''), [soloCultivo, setSoloCultivo] = useState('todos');
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const porEstado = contexto.cultivos.filter(c => filtro === 'archivados' ? !!c.archivado_en : !c.archivado_en);
  // Busca por nombre, tipo o codigo de alguno de sus nodos.
  const lista = porEstado.filter(c => (soloCultivo === 'todos' || c.id === soloCultivo) && coincide([c.nombre, c.tipo, ...contexto.nodos.filter(n => n.cultivo_id === c.id).map(n => n.codigo)].join(' '), q));
  const cultivoTerreno = contexto.cultivos.find(c => c.id === terreno && !c.archivado_en);
  if (cultivoTerreno) return <Terreno client={client} cultivo={cultivoTerreno} alVolver={() => setTerreno('')} actualizado={actualizado} />;
  return <section className="gestion-cultivos" aria-label="Gestión de cultivos" aria-busy={ocupado}>
    {aviso && <p className="aviso exito" role="status">{aviso}</p>}
    {error && <p className="aviso error" role="alert">{error}</p>}
    {edicion ? <form className="formulario-cultivo" onSubmit={guardar}>
      <h2>{edicion === 'nuevo' ? 'Registrar cultivo' : 'Editar cultivo'}</h2>
      <fieldset disabled={ocupado}>
        <label className="form-label" htmlFor="cult-nombre">Nombre del lote</label>
        <input autoFocus id="cult-nombre" className="form-control" maxLength={100} value={datos.nombre} onChange={e => setDatos({...datos,nombre:e.target.value})} placeholder="Ej. Lote Norte" required />
        <label className="form-label" htmlFor="cult-tipo">Tipo o variedad de cultivo</label>
        <input id="cult-tipo" className="form-control" maxLength={100} value={datos.tipo} onChange={e => setDatos({...datos,tipo:e.target.value})} placeholder="Ej. Maíz" required />
        <div className="campos-area"><div><label className="form-label" htmlFor="cult-area">Área aproximada</label>
          <input id="cult-area" className="form-control" inputMode="decimal" value={datos.area} onChange={e => setDatos({...datos,area:e.target.value})} placeholder="0,5" required /></div>
          <div><Selector id="cult-unidad" etiqueta="Unidad" valor={datos.unidad} alCambiar={v => setDatos({...datos,unidad:v})} opciones={[{ valor: 'm2', texto: 'm²' }, { valor: 'ha', texto: 'Hectáreas' }]} /></div></div>
        {edicion === 'nuevo' && <fieldset className="seleccion-nodos"><legend>Nodos disponibles</legend>
          <p>Selecciona uno o dos dispositivos autorizados para tu cuenta. Si reutilizas un nodo, mantenlo apagado y espera siete minutos desde su última publicación antes de asignarlo a otro cultivo.</p>
          {!disponibles.length && <p className="aviso neutral">No tienes nodos físicos disponibles. Puedes guardar el cultivo y agregarle nodos simulados desde su tarjeta.</p>}
          {disponibles.map(n => <label className="opcion-nodo" key={n.id}><input type="checkbox" checked={datos.nodos.includes(n.id)} onChange={e => setDatos({...datos,nodos:e.target.checked ? [...datos.nodos,n.id] : datos.nodos.filter(id => id !== n.id)})} />{n.codigo}</label>)}
        </fieldset>}
        <div className="acciones-cultivo"><button className="btn boton-principal" disabled={ocupado}>{ocupado ? 'Guardando…' : 'Guardar cultivo'}</button>
          <button type="button" className="btn boton-secundario" onClick={() => {setEdicion(null);setError('');}}>Cancelar</button></div>
      </fieldset>
    </form> : archivo ? <section className="confirmar-archivo" aria-labelledby="titulo-archivo">
      <h2 id="titulo-archivo">Archivar {archivo.nombre}</h2>
      <p>El historial se conserva. Se liberarán los nodos de este cultivo y las nuevas capturas dejarán de guardarse hasta asignarlos a otro cultivo.</p>
      <p>Esta versión todavía no permite restaurar un cultivo archivado.</p>
      <label className="opcion-nodo"><input type="checkbox" checked={confirmado} disabled={ocupado} onChange={e => setConfirmado(e.target.checked)} />Entiendo y quiero archivar este cultivo.</label>
      <div className="acciones-cultivo"><button className="btn boton-peligro" disabled={ocupado || !confirmado} onClick={() => { void archivar(); }}>{ocupado ? 'Archivando…' : 'Confirmar archivado'}</button>
        <button className="btn boton-secundario" disabled={ocupado} onClick={() => {setArchivo(null);setError('');}}>Cancelar</button></div>
    </section> : <>
      <div className="acciones-lista"><div className="filtro-cultivos" role="group" aria-label="Estado de cultivos"><button aria-pressed={filtro==='activos'} onClick={() => setFiltro('activos')}>Activos</button><button aria-pressed={filtro==='archivados'} onClick={() => setFiltro('archivados')}>Archivados</button></div>
        <button className="btn boton-principal" onClick={() => editar('nuevo')}>+ Registrar cultivo</button></div>
      {porEstado.length > 1 && <div className="barra-filtros" data-columnas="2" role="search" aria-label="Filtrar cultivos">
        <Buscador etiqueta="Buscar cultivo" valor={q} alCambiar={setQ} marcador="Nombre, tipo o código de un nodo" />
        <Selector etiqueta="Ver" valor={porEstado.some(c => c.id === soloCultivo) ? soloCultivo : 'todos'} alCambiar={setSoloCultivo} opciones={[{ valor: 'todos', texto: 'Todos los cultivos' }, ...porEstado.map(c => ({ valor: c.id, texto: c.nombre, detalle: c.tipo }))]} />
        <p className="filtro-cuenta" role="status">{lista.length} de {porEstado.length}</p>
      </div>}
      {porEstado.length > 0 && !lista.length && <div className="vacio"><h2>Ningún cultivo coincide</h2><p>Cambia la búsqueda para ver más cultivos.</p><button type="button" className="btn boton-principal" onClick={() => { setQ(''); setSoloCultivo('todos'); }}>Quitar filtros</button></div>}
      {!porEstado.length && <div className="vacio"><h2>{filtro === 'activos' ? 'Aún no tienes cultivos activos' : 'No tienes cultivos archivados'}</h2><p>{filtro === 'activos' ? 'Registra un cultivo y vincúlale nodos físicos disponibles o nodos simulados.' : 'Aquí podrás consultar el historial de los cultivos que archives.'}</p></div>}
      <div className="lista-cultivos">{lista.map(c => <article className="tarjeta-cultivo" key={c.id}>
        <span className={'estado '+(c.archivado_en ? 'neutral' : 'reciente')}>{c.archivado_en ? 'Archivado' : 'Activo'}</span>
        <h2>{c.nombre}</h2><p>{c.tipo} · {Number(c.area).toLocaleString('es-CO')} {c.unidad_area === 'm2' ? 'm²' : 'ha'}</p>
        {c.archivado_en ? <p>Archivado: {fechaBogota(c.archivado_en)}</p> : (() => { const propios = contexto.nodos.filter(n => n.cultivo_id===c.id); const estado = (id: string) => red?.find(f => f.nodo_id === id);
          const recibiendo = propios.filter(n => { const f = estado(n.id); return f && estadoConexion(f, ahora) === 'conectado'; }).length;
          const verNodos = abiertos.has(c.id) || (!!q.trim() && propios.some(n => coincide(n.codigo, q)));
          return !propios.length ? <p>Nodos: Sin nodos vinculados</p> : <>
            <p className="resumen-nodos">Nodos: {propios.length}{red ? ` · ${recibiendo} recibiendo` : ''}</p>
            {propios.length > 4 && <button type="button" className="nodos-alternar" aria-expanded={verNodos} aria-controls={'nodos-' + c.id} onClick={() => setAbiertos(a => { const b = new Set(a); if (verNodos) b.delete(c.id); else b.add(c.id); return b; })}>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>{verNodos ? 'Ocultar' : 'Ver'} los {propios.length} nodos</button>}
            {(propios.length <= 4 || verNodos) && <ul id={'nodos-' + c.id} className="nodos-cultivo" aria-label={'Nodos de ' + c.nombre}>{propios.map(n => { const f = estado(n.id), x = f ? estadoConexion(f, ahora) : null; return <li key={n.id}>
              <strong>{n.codigo}</strong><span>{n.tipo_nodo === 'virtual' ? 'Simulado' + (f?.zona_nombre ? ' · ' + f.zona_nombre : '') : 'Físico'}</span>
              {x && <span className="pastilla-tono" data-tono={tonoConexion(x)}><i aria-hidden="true" />{TEXTO_CONEXION[x]}</span>}
              {n.tipo_nodo === 'virtual' && <span className="acciones-nodo"><button type="button" className="boton-fila" aria-label={'Mover ' + n.codigo + ' a otro cultivo o sector'} onClick={() => setDialogo({ tipo: 'mover', cultivo: c, nodo: n })}>Mover</button>
                <button type="button" className="boton-fila" aria-label={'Quitar ' + n.codigo + ' de este cultivo'} onClick={() => quitar(n)}>Quitar</button></span>}</li>; })}</ul>}</>; })()}
        <div className="acciones-cultivo">{!c.archivado_en && <button className="btn boton-principal" onClick={() => abrir(c.id,false)}>Ver mediciones</button>}
          <button className="btn boton-secundario" onClick={() => abrir(c.id,true)}>Ver historial</button>
          {!c.archivado_en && <><button className="btn boton-secundario" onClick={() => editar(c)}>Editar</button>
            <button className="btn boton-secundario" onClick={() => setDialogo({ tipo: 'parametros', cultivo: c })}>Parámetros</button>
            <button className="btn boton-secundario" onClick={() => setTerreno(c.id)}>Terreno y sectores</button>
            <button className="btn boton-secundario" onClick={() => setDialogo({ tipo: 'nodo', cultivo: c })}>Agregar nodo simulado</button>
            <button className="enlace-archivo" onClick={() => {setArchivo(c);setConfirmado(false);setError('');setAviso('');}}>Archivar</button>
            <button className="enlace-archivo" onClick={() => setDialogo({ tipo: 'eliminar', cultivo: c })}>Eliminar</button></>}</div>
      </article>)}</div>
      <p className="ayuda-gestion">Los nodos físicos se habilitan previamente para tu cuenta; los simulados los creas tú. Puedes vincular o desvincular nodos desde Dispositivos. Cada cultivo con nodos aparece en Simulación con su propio dibujo.</p>
      {dialogo?.tipo === 'parametros' && <ParametrosDialogo client={client} cultivo={dialogo.cultivo} origenes={origenesCultivo(contexto.nodos.filter(n => n.cultivo_id === dialogo.cultivo.id))} alGuardar={actualizado} alCerrar={() => setDialogo(null)} />}
      {dialogo?.tipo === 'mover' && dialogo.nodo && <NodoVirtualDialogo client={client} cultivos={contexto.cultivos} cultivoInicial={dialogo.cultivo.id} nodo={dialogo.nodo} alGuardar={m => { setAviso(m); actualizado(); }} alCerrar={() => setDialogo(null)} />}
      {dialogo?.tipo === 'eliminar' && <Confirmar titulo={'Eliminar ' + dialogo.cultivo.nombre} accion="Eliminar cultivo" alCerrar={() => setDialogo(null)}
        salida={{ codigo: 'CULTIVO_CON_HISTORIAL', texto: 'Archivar en su lugar', accion: () => { const c = dialogo.cultivo; setDialogo(null); setArchivo(c); setConfirmado(false); setError(''); setAviso(''); } }}
        texto="El cultivo se borra por completo y no se puede recuperar. Solo es posible si todavía no tiene mediciones, alertas ni sugerencias guardadas; si las tiene, usa Archivar para conservarlas. Sus nodos físicos quedan disponibles y los simulados quedan sin cultivo, listos para reutilizar."
        alConfirmar={() => eliminarCultivo(client, dialogo.cultivo.id).then(n => { setAviso(`Cultivo eliminado.${n ? ` ${n} ${n === 1 ? 'nodo quedó' : 'nodos quedaron'} sin cultivo.` : ''}`); setError(''); actualizado(); })} />}
      {dialogo?.tipo === 'nodo' && <NodoVirtualDialogo client={client} cultivos={contexto.cultivos} cultivoInicial={dialogo.cultivo.id} alGuardar={m => { setAviso(m); actualizado(); }} alCerrar={() => setDialogo(null)} />}
    </>}
  </section>;
}
