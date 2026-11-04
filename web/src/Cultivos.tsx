import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contexto, Cultivo } from './types.ts';
import { archivarCultivo, guardarCultivo } from './crop-data.ts';
import type { DatosCultivo } from './crop-data.ts';
import { fechaBogota } from './domain.ts';
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
  const lista = contexto.cultivos.filter(c => filtro === 'archivados' ? !!c.archivado_en : !c.archivado_en);
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
          <div><label className="form-label" htmlFor="cult-unidad">Unidad</label><select id="cult-unidad" className="form-select" value={datos.unidad} onChange={e => setDatos({...datos,unidad:e.target.value})}><option value="m2">m²</option><option value="ha">Hectáreas</option></select></div></div>
        {edicion === 'nuevo' && <fieldset className="seleccion-nodos"><legend>Nodos disponibles</legend>
          <p>Selecciona uno o dos dispositivos autorizados para tu cuenta. Si reutilizas un nodo, mantenlo apagado y espera siete minutos desde su última publicación antes de asignarlo a otro cultivo.</p>
          {!disponibles.length && <p className="aviso advertencia">No tienes nodos disponibles. Los asignados siguen en su cultivo; consulta al equipo si necesitas otro dispositivo.</p>}
          {disponibles.map(n => <label className="opcion-nodo" key={n.id}><input type="checkbox" checked={datos.nodos.includes(n.id)} onChange={e => setDatos({...datos,nodos:e.target.checked ? [...datos.nodos,n.id] : datos.nodos.filter(id => id !== n.id)})} />{n.codigo}</label>)}
        </fieldset>}
        <div className="acciones-cultivo"><button className="btn boton-principal" disabled={edicion === 'nuevo' && !disponibles.length}>{ocupado ? 'Guardando…' : 'Guardar cultivo'}</button>
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
      {!lista.length && <div className="vacio"><h2>{filtro === 'activos' ? 'Aún no tienes cultivos activos' : 'No tienes cultivos archivados'}</h2><p>{filtro === 'activos' ? 'Puedes registrar un cultivo con los nodos disponibles de tu cuenta.' : 'Aquí podrás consultar el historial de los cultivos que archives.'}</p></div>}
      <div className="lista-cultivos">{lista.map(c => <article className="tarjeta-cultivo" key={c.id}>
        <span className={'estado '+(c.archivado_en ? 'neutral' : 'reciente')}>{c.archivado_en ? 'Archivado' : 'Activo'}</span>
        <h2>{c.nombre}</h2><p>{c.tipo} · {Number(c.area).toLocaleString('es-CO')} {c.unidad_area === 'm2' ? 'm²' : 'ha'}</p>
        {c.archivado_en ? <p>Archivado: {fechaBogota(c.archivado_en)}</p> : <p>Nodos: {contexto.nodos.filter(n => n.cultivo_id===c.id).map(n => n.codigo).join(', ') || 'Sin nodos vinculados'}</p>}
        <div className="acciones-cultivo">{!c.archivado_en && <button className="btn boton-principal" onClick={() => abrir(c.id,false)}>Ver mediciones</button>}
          <button className="btn boton-secundario" onClick={() => abrir(c.id,true)}>Ver historial</button>
          {!c.archivado_en && <><button className="btn boton-secundario" onClick={() => editar(c)}>Editar</button>
            <button className="enlace-archivo" onClick={() => {setArchivo(c);setConfirmado(false);setError('');setAviso('');}}>Archivar</button></>}</div>
      </article>)}</div>
      <p className="ayuda-gestion">Los dispositivos se habilitan previamente para tu cuenta. Puedes vincular o desvincular nodos de cultivos existentes desde Dispositivos.</p>
    </>}
  </section>;
}
