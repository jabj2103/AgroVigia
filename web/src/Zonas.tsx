import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Capacidad } from './types.ts';
import { antiguedad, ANTIGUEDAD_MAXIMA_MS, fechaBogota } from './domain.ts';
import { cargarCapturaZona, cargarPlano } from './zone-data.ts';
import { puntoNodo, ubicacionCoincide } from './zone-domain.ts';
import type { CapturaZona, NodoPlano, Plano } from './zone-domain.ts';
import './zonas.css';

function Procedencia({ virtual }: { virtual: boolean }) {
  return <span className={'procedencia-zona ' + (virtual ? 'simulada' : 'real')}>{virtual ? 'Simulada' : 'Real'}</span>;
}
function LecturaZona({ client, cultivoId, nodo, capacidades, revision }: {
  client: SupabaseClient; cultivoId: string; nodo: NodoPlano; capacidades: Capacidad[]; revision: number;
}) {
  const [captura, setCaptura] = useState<CapturaZona | null>(null);
  const [error, setError] = useState(''), [cargando, setCargando] = useState(true);
  const [consulta, setConsulta] = useState<string | null>(null), [ahora, setAhora] = useState(Date.now());
  const virtual = nodo.tipo_nodo === 'virtual';
  useEffect(() => { const timer = window.setInterval(() => setAhora(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    const controller = new AbortController(); let pendiente = false;
    async function actualizar() {
      if (pendiente || controller.signal.aborted) return;
      pendiente = true; setCargando(true);
      try {
        const c = await cargarCapturaZona(client, cultivoId, nodo, capacidades, controller.signal);
        if (!controller.signal.aborted) { setCaptura(c); setError(''); setConsulta(new Date().toISOString()); }
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'No pudimos consultar la captura.');
      } finally { pendiente = false; if (!controller.signal.aborted) setCargando(false); }
    }
    void actualizar(); const timer = window.setInterval(() => { void actualizar(); }, 30_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [client, cultivoId, nodo, capacidades, revision]);
  const futuro = captura && (Date.parse(captura.tomadaEn) > ahora || Date.parse(captura.recibidaEn) > ahora);
  const antigua = captura && (ahora - Date.parse(captura.tomadaEn) > ANTIGUEDAD_MAXIMA_MS || ahora - Date.parse(captura.recibidaEn) > ANTIGUEDAD_MAXIMA_MS);
  const estado = error ? 'Error de actualización' : !nodo.habilitado ? 'Nodo deshabilitado' : cargando && !captura ? 'Consultando captura…' :
    !captura ? virtual ? 'Sin datos simulados' : 'Sin datos reales' : futuro ? 'Revisar reloj' : antigua ? 'Datos desactualizados' : 'Datos recientes';
  return <section className="detalle-zona" aria-label="Variables del nodo seleccionado" aria-busy={cargando}>
    <div className="cabecera-nodo"><div><span className="sobre-titulo">{virtual ? 'NODO VIRTUAL' : 'NODO FÍSICO'}</span><h3>{nodo.codigo}</h3></div><Procedencia virtual={virtual}/></div>
    <p className="estado-captura-zona"><span className={'estado ' + (error || futuro ? 'revisar' : antigua ? 'antiguo' : !captura || !nodo.habilitado ? 'neutral' : 'reciente')}>{estado}</span></p>
    {error && <p className="aviso error" role="alert">{error}{captura ? ' Se conserva la última captura consultada; su actualización no está confirmada.' : ''}</p>}
    {!nodo.habilitado && <p className="aviso neutral">Nodo deshabilitado. Las capturas guardadas se conservan como referencia.</p>}
    {!captura && !cargando && !error && <p className="vacio">{virtual ? 'Todavía no hay una captura simulada guardada para este nodo. Envía una desde el panel externo.' : 'Todavía no hay una captura real guardada para este nodo.'}</p>}
    {captura && <>
      {!ubicacionCoincide(captura, nodo) && <p className="aviso advertencia" role="status">Esta captura corresponde a una ubicación o asignación anterior. Zona de captura: {captura.zonaNombre ?? 'Sin ubicar'}. Consulta su fecha antes de relacionarla con el croquis actual.</p>}
      <div className="resumen-captura-zona"><p><strong>{captura.valores.length} variables · {virtual ? 'Simuladas' : 'Reales'}</strong><br/>Captura: {antiguedad(captura.tomadaEn, ahora)}</p><p>Zona de captura: <strong>{captura.zonaNombre ?? 'Sin ubicar'}</strong></p></div>
      {virtual && <p className="nota-simulacion-zona">Valores sintéticos enviados desde el simulador. Los escenarios y los rangos de prueba no diagnostican el cultivo.</p>}
      <div className="variables-zona">{captura.valores.map(v => <article className="variable-zona" key={v.codigo}>
        <div><h4>{v.nombre}</h4><Procedencia virtual={virtual}/></div>
        <p className="valor-zona">{v.valor.toLocaleString('es-CO', { maximumFractionDigits: 4 })}<span>{v.unidad}</span></p><p>{v.ayuda}</p>
      </article>)}</div>
      <dl className="fechas-zona"><div><dt>Fecha de captura</dt><dd>{fechaBogota(captura.tomadaEn)}</dd></div><div><dt>Recepción de aplicación · aprox.</dt><dd>{fechaBogota(captura.recibidaEn)}</dd></div></dl>
      <details className="identificacion"><summary>Identificación de la captura</summary><p>Origen: {captura.origen} · Nodo: {nodo.codigo}</p><code>{captura.mensajeId}</code></details>
    </>}
    <p className="pie-consulta" aria-live="polite">{cargando ? 'Consultando captura…' : consulta ? 'Última consulta correcta: ' + fechaBogota(consulta) : 'Sin una consulta correcta todavía.'}</p>
  </section>;
}
export default function Zonas({ client, cultivoId, usuarioId, revision }: { client: SupabaseClient; cultivoId: string; usuarioId: string; revision: number }) {
  const [plano, setPlano] = useState<Plano | null>(null), [error, setError] = useState('');
  const [cargando, setCargando] = useState(true), [zonaId, setZonaId] = useState('todas');
  const [nodoId, setNodoId] = useState(''), [origen, setOrigen] = useState('todos'), [intento, setIntento] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let pendiente = false;
    async function actualizar() {
      if (pendiente || controller.signal.aborted) return;
      pendiente = true; setCargando(true);
      try {
        const p = await cargarPlano(client, cultivoId, usuarioId, controller.signal);
        if (!controller.signal.aborted) { setPlano(anterior => JSON.stringify(anterior) === JSON.stringify(p) ? anterior : p); setError(''); }
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'No pudimos consultar el croquis.'); }
      finally { pendiente = false; if (!controller.signal.aborted) setCargando(false); }
    }
    void actualizar(); const timer = window.setInterval(() => { void actualizar(); }, 30_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [client, cultivoId, usuarioId, revision, intento]);
  const zonas = plano?.zonas ?? [], nodos = plano?.nodos ?? [];
  const zonaActual = zonaId === 'todas' || zonaId === 'sin-ubicar' || zonas.some(z => z.id === zonaId) ? zonaId : 'todas';
  const visibles = nodos.filter(n => origen === 'todos' || n.tipo_nodo === origen);
  const lista = visibles.filter(n => zonaActual === 'todas' || (zonaActual === 'sin-ubicar' ? n.zona_id === null : n.zona_id === zonaActual));
  const elegido = lista.find(n => n.id === nodoId) ?? lista.find(n => n.zona_id !== null) ?? lista[0];
  const marcador = (n: NodoPlano) => (n.tipo_nodo === 'virtual' ? 'S' : 'R') + String(visibles.filter(x => x.tipo_nodo === n.tipo_nodo).findIndex(x => x.id === n.id) + 1);
  function seleccionarZona(id: string) { setZonaId(id); setNodoId(''); }
  return <section className="zonas-cultivo" aria-label="Zonas y nodos del cultivo">
    <div className="titulo-zonas"><div><span className="sobre-titulo">DISTRIBUCIÓN DEL CULTIVO</span><h2>Zonas y nodos</h2><p>Selecciona un sector o un punto para consultar sus variables.</p></div><button className="btn boton-secundario" disabled={cargando} onClick={() => setIntento(i => i + 1)}>Actualizar zonas</button></div>
    {error && <p className="aviso error" role="alert">{error}{plano ? ' El croquis conserva la última consulta válida.' : ''}</p>}
    {!plano && cargando && <p role="status">Consultando zonas y nodos…</p>}
    {plano && <>
      <div className="leyenda-croquis"><span><b className="marca-real">R</b> Físico · datos reales</span><span><b className="marca-simulada">S</b> Virtual · datos simulados</span></div>
      <div className="croquis" role="group" aria-label="Croquis seleccionable del cultivo"><div className="area-croquis">
        {zonas.map(z => <button type="button" className={'zona-croquis' + (zonaActual === z.id ? ' activa' : '')} key={z.id}
          style={{ left: z.plano_x * 100 + '%', top: z.plano_y * 100 + '%', width: z.plano_ancho * 100 + '%', height: z.plano_alto * 100 + '%' }}
          aria-pressed={zonaActual === z.id} aria-label={'Seleccionar zona ' + z.nombre} title={z.nombre} onClick={() => seleccionarZona(z.id)}>
          <strong>{z.nombre}</strong><span>{visibles.filter(n => n.zona_id === z.id).length} {visibles.filter(n => n.zona_id === z.id).length === 1 ? 'nodo' : 'nodos'}</span>
        </button>)}
        {visibles.map(n => {
          const p = puntoNodo(n, zonas); if (!p) return null;
          return <button type="button" key={n.id} className={'nodo-croquis ' + (n.tipo_nodo === 'virtual' ? 'simulado' : 'fisico') + (elegido?.id === n.id ? ' elegido' : '')}
            style={{ left: p.x * 100 + '%', top: p.y * 100 + '%' }} aria-pressed={elegido?.id === n.id}
            aria-label={'Seleccionar nodo ' + n.codigo + (n.tipo_nodo === 'virtual' ? ', simulado' : ', real')}
            title={n.codigo} onClick={() => { setZonaId(n.zona_id!); setNodoId(n.id); }}>{marcador(n)}</button>;
        })}
        {!zonas.length && <p className="croquis-vacio">Este cultivo todavía no tiene zonas configuradas. Sus nodos aparecen en la lista.</p>}
      </div></div>
      <p className="nota-croquis">Croquis esquemático de las posiciones registradas. No representa coordenadas GPS, cobertura ni salud del cultivo. También puedes seleccionar zonas y nodos en la lista.</p>
      <div className="filtros-zonas"><div><label htmlFor="zona-cultivo">Zona</label><select id="zona-cultivo" className="form-select" value={zonaActual} onChange={e => seleccionarZona(e.target.value)}>
        <option value="todas">Todas las zonas</option>{zonas.map(z => <option key={z.id} value={z.id}>{z.nombre}</option>)}<option value="sin-ubicar">Sin ubicar</option>
      </select></div><div><label htmlFor="origen-zonas">Tipo de nodo</label><select id="origen-zonas" className="form-select" value={origen} onChange={e => { setOrigen(e.target.value); setNodoId(''); }}>
        <option value="todos">Todos los nodos</option><option value="fisico">Físicos · datos reales</option><option value="virtual">Virtuales · datos simulados</option>
      </select></div></div>
      <div className="contenido-zonas"><div className="lista-nodos-zona" role="group" aria-label="Nodos de la zona seleccionada">
        <p className="sobre-titulo">{lista.length} {lista.length === 1 ? 'NODO' : 'NODOS'} EN ESTA VISTA</p>
        {!lista.length && <p className="vacio">No hay nodos para esta selección.</p>}
        {lista.map(n => <button type="button" key={n.id} aria-pressed={elegido?.id === n.id} className={'selector-nodo-zona' + (elegido?.id === n.id ? ' activo' : '')} onClick={() => setNodoId(n.id)}>
          <span className="codigo-nodo-zona">{n.codigo}</span><Procedencia virtual={n.tipo_nodo === 'virtual'}/>
          <span>{zonas.find(z => z.id === n.zona_id)?.nombre ?? 'Sin ubicar'} · {n.habilitado ? 'Habilitado' : 'Deshabilitado'}</span>
        </button>)}
      </div>{elegido && <LecturaZona key={cultivoId + ':' + elegido.id + ':' + elegido.asignacion_version} client={client} cultivoId={cultivoId} nodo={elegido} capacidades={plano.capacidades} revision={revision + intento}/>}</div>
    </>}
  </section>;
}
