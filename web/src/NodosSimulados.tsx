// Inicio: ultimo envio de cada nodo simulado del cultivo, con sus variables y el sector donde esta.
// Los valores vienen de la simulacion (clima y ajuste manual activos); nunca se mezclan con los reales.
import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { TEXTO_CONEXION, cargarEstadoRed, estadoConexion, tonoConexion } from './red-data.ts';
import type { EstadoNodoRed } from './red-data.ts';
import { cargarLotesSimulados } from './simulacion-data.ts';
import type { LecturaVariable } from './escenario-data.ts';
import { antiguedad } from './domain.ts';
import { Buscador, Selector, coincide } from './Filtros.tsx';

const VARIABLES: [string, string, string][] = [['temperatura_aire', 'Temperatura', '°C'], ['humedad_aire', 'Humedad del aire', '% HR'], ['humedad_suelo_vwc', 'Humedad del suelo', '% VWC'],
  ['precipitacion_60min', 'Lluvia 60 min', 'mm'], ['ph_suelo', 'pH del suelo', 'pH'], ['velocidad_viento', 'Viento', 'm/s']];
const numero = (v: number | undefined) => v === undefined ? 'Sin dato' : v.toLocaleString('es-CO', { maximumFractionDigits: 1 });
const corto = (codigo: string) => codigo.replace(/^sim-[a-z0-9]+-(?=[a-z0-9]+$)/, 'sim-');

export default function NodosSimulados({ client, cultivoId, revision, verEscenario }: { client: SupabaseClient; cultivoId: string; revision: number; verEscenario: () => void }) {
  const [filas, setFilas] = useState<EstadoNodoRed[] | null>(null), [lotes, setLotes] = useState<Map<string, LecturaVariable[]>>(new Map());
  const [error, setError] = useState(''), [ahora, setAhora] = useState(Date.now()), [tick, setTick] = useState(0);
  const [q, setQ] = useState(''), [fEstado, setFEstado] = useState('todos');
  useEffect(() => { const t = window.setInterval(() => { if (!document.hidden) { setTick(x => x + 1); setAhora(Date.now()); } }, 15_000); return () => window.clearInterval(t); }, []);
  useEffect(() => {
    const abort = new AbortController();
    cargarEstadoRed(client, abort.signal).then(async todas => {
      const propias = todas.filter(f => f.simulado && f.cultivo_id === cultivoId);
      const l = await cargarLotesSimulados(client, cultivoId, propias.map(f => f.mensaje_id ?? ''), abort.signal);
      setFilas(propias); setLotes(l); setError(''); setAhora(Date.now());
    }).catch(e => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : 'No pudimos consultar los nodos simulados.'); });
    return () => abort.abort();
  }, [client, cultivoId, revision, tick]);
  if (filas && !filas.length && !error) return null;
  const recibiendo = filas?.filter(f => estadoConexion(f, ahora) === 'conectado').length ?? 0;
  const visibles = filas?.filter(f => (fEstado === 'todos' || tonoConexion(estadoConexion(f, ahora)) === fEstado) && coincide(f.codigo + ' ' + (f.zona_nombre ?? 'sin sector'), q)) ?? [];
  return <section className="nodos-simulados" aria-label="Nodos simulados del cultivo" aria-busy={!filas}>
    <div className="sim-cabecera">
      <div><span className="etiqueta-origen simulado">Datos simulados</span>
        <h2>Nodos simulados</h2>
        <p role="status">{filas ? `${recibiendo} de ${filas.length} recibiendo. Valores del último envío de cada nodo.` : 'Consultando los nodos simulados…'}</p></div>
      <button type="button" className="btn boton-secundario" onClick={verEscenario}>Cambiar clima o ajuste</button>
    </div>
    {error && <p className="aviso neutral" role="status">{error}{filas ? ' Se conserva la última consulta correcta.' : ''}</p>}
    {(filas?.length ?? 0) > 4 && <div className="barra-filtros" data-columnas="2" role="search" aria-label="Filtrar nodos simulados">
      <Buscador etiqueta="Buscar nodo" valor={q} alCambiar={setQ} marcador="Código o sector" />
      <Selector etiqueta="Estado" valor={fEstado} alCambiar={setFEstado} opciones={[{ valor: 'todos', texto: 'Cualquier estado' }, { valor: 'recibe', texto: 'Recibiendo' }, { valor: 'no_recibe', texto: 'Sin recibir' }, { valor: 'inactivo', texto: 'En pausa o fuera de servicio' }]} />
      <p className="filtro-cuenta" role="status">{visibles.length} de {filas?.length}</p>
    </div>}
    {(filas?.length ?? 0) > 0 && !visibles.length && <p className="aviso neutral" role="status">Ningún nodo coincide con la búsqueda. <button type="button" className="boton-fila" onClick={() => { setQ(''); setFEstado('todos'); }}>Quitar filtros</button></p>}
    <ul className="sim-nodos">{visibles.map(f => { const c = estadoConexion(f, ahora), lote = new Map((lotes.get(f.mensaje_id ?? '') ?? []).map(x => [x.variable_codigo, x.valor]));
      return <li key={f.nodo_id} className="sim-nodo">
        <div className="sim-nodo-cabecera"><strong>{corto(f.codigo)}</strong><span>{f.zona_nombre ?? 'Sin sector'}</span>
          <span className="pastilla-tono" data-tono={tonoConexion(c)}><i aria-hidden="true" />{TEXTO_CONEXION[c]}</span></div>
        <dl className="sim-valores">{VARIABLES.map(([codigo, nombre, unidad]) => <div key={codigo}><dt>{nombre}</dt><dd>{numero(lote.get(codigo))} <span>{lote.has(codigo) ? unidad : ''}</span></dd></div>)}</dl>
        <p className="sim-pie">{f.tomada_en ? 'Captura: ' + antiguedad(f.tomada_en, ahora).toLowerCase() : 'Este nodo todavía no envía datos.'}</p>
      </li>; })}</ul>
  </section>;
}
