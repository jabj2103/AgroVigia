import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Chart, LineController, LineElement, PointElement, LinearScale, Tooltip } from 'chart.js';
import { esAmbiental, esDht22, fechaBogota } from './domain.ts';
import { cargarHistorial } from './history-data.ts';
import { desdeFechaBogota, fechaLocalBogota, puntosHistorial, resumirHistorial, validarFiltroHistorial, VARIABLES_HISTORIAL } from './history-domain.ts';
import type { FiltroHistorial, VariableHistorial } from './history-domain.ts';
import type { Capacidad, Medicion, Nodo } from './types.ts';

Chart.register(LineController, LineElement, PointElement, LinearScale, Tooltip);
const numero = (n: number | null) => n === null ? '—' : n.toLocaleString('es-CO', { maximumFractionDigits: 4 });
const duraciones: Record<string, number> = { '1h': 3_600_000, '24h': 86_400_000, '7d': 604_800_000 };
interface Resultado { filtro: FiltroHistorial; filas: Medicion[] }
function filtroInicial(cultivoId: string, nodoId: string): FiltroHistorial {
  const ahora = new Date();
  return { cultivoId, nodoId, variable: 'temperatura_aire', inicio: new Date(+ahora - duraciones['1h']!).toISOString(), fin: ahora.toISOString(), recibidasHasta: ahora.toISOString() };
}
function Grafica({ resultado }: { resultado: Resultado }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { filas, filtro } = resultado;
  const regla = VARIABLES_HISTORIAL[filtro.variable];
  useEffect(() => {
    if (!canvas.current) return;
    const chart = new Chart<'line', ReturnType<typeof puntosHistorial>>(canvas.current, {
      type: 'line',
      data: { datasets: [{ label: regla.nombre, data: puntosHistorial(filas), borderColor: regla.color,
        backgroundColor: regla.color, borderWidth: 2, pointRadius: filas.length < 100 ? 2 : 0,
        pointHoverRadius: 4, tension: 0, spanGaps: false }] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
        interaction: { mode: 'nearest', intersect: false },
        plugins: { tooltip: { callbacks: {
          title: items => { const x = items[0]?.parsed.x; return typeof x === 'number' ? fechaBogota(new Date(x).toISOString()) : ''; },
          label: item => numero(item.parsed.y) + ' ' + regla.unidad,
        } } },
        scales: {
          x: { type: 'linear', min: Date.parse(filtro.inicio), max: Date.parse(filtro.fin),
            title: { display: true, color:'#aec3b8', text: 'Fecha de captura · hora de Colombia' },
            ticks: { color:'#aec3b8', maxTicksLimit: 6, callback: v => new Intl.DateTimeFormat('es-CO', {
              timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
            }).format(new Date(Number(v))) }, grid: { color: '#31443e' } },
          y: { ticks: { color:'#aec3b8' }, title: { display: true, color:'#aec3b8', text: regla.unidad },
            ...(filtro.variable !== 'temperatura_aire' ? { min: 0, max: 100 } : { grace: '10%' }),
            grid: { color: '#31443e' } },
        },
      },
    });
    return () => chart.destroy();
  }, [filas, filtro, regla]);
  return <figure className="grafica-historial">
    <div className="lienzo-historial"><canvas ref={canvas} role="img" aria-label={'Historial de ' + regla.nombre + '. Los valores también están en la tabla.'}>
      Los valores de la gráfica están disponibles en la tabla de lecturas.
    </canvas></div>
    <figcaption>Una muestra por punto. Los intervalos sin capturas de más de tres minutos interrumpen la línea.</figcaption>
  </figure>;
}
export default function Historial({ client, cultivoId, nodos, capacidades }: {
  client: SupabaseClient; cultivoId: string; nodos: Nodo[]; capacidades: Capacidad[];
}) {
  const compatibles = useMemo(() => nodos.filter(n => esDht22(n.id, capacidades) || esAmbiental(n.id, capacidades)), [nodos, capacidades]);
  const [nodoId, setNodoId] = useState(compatibles[0]?.id ?? '');
  const [variable, setVariable] = useState<VariableHistorial>('temperatura_aire');
  const [periodo, setPeriodo] = useState('1h');
  const [desde, setDesde] = useState(() => fechaLocalBogota(new Date(Date.now() - 3_600_000).toISOString()));
  const [hasta, setHasta] = useState(() => fechaLocalBogota(new Date().toISOString()));
  const [solicitud, setSolicitud] = useState<FiltroHistorial | null>(() => compatibles[0] ? filtroInicial(cultivoId, compatibles[0].id) : null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [cargando, setCargando] = useState(!!solicitud);
  const [pagina, setPagina] = useState(0);
  const controlador = useRef<AbortController | null>(null);
  const variables = (Object.keys(VARIABLES_HISTORIAL) as VariableHistorial[]).filter(v => capacidades.some(c => c.nodo_id === nodoId && c.variable_codigo === v));
  useEffect(() => {
    if (!solicitud) return;
    let activo = true;
    const abort = new AbortController(); controlador.current = abort;
    setCargando(true); setError(''); setAviso('');
    cargarHistorial(client, solicitud, abort.signal).then(filas => {
      if (activo) { setResultado({ filtro: solicitud, filas }); setPagina(0); }
    }).catch(e => {
      if (!activo) return;
      if (abort.signal.aborted) setAviso('Consulta cancelada. Se conserva el último resultado completo, si existe.');
      else setError(e instanceof Error ? e.message : 'No pudimos consultar el historial.');
    }).finally(() => { if (activo) { setCargando(false); controlador.current = null; } });
    return () => { activo = false; abort.abort(); };
  }, [client, solicitud]);
  const resumen = resultado ? resumirHistorial(resultado.filas) : null;
  const invertidas = useMemo(() => resultado ? [...resultado.filas].reverse() : [], [resultado]);
  function consultar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      if (!compatibles.some(n => n.id === nodoId) || !variables.includes(variable)) throw new Error('Selecciona un nodo y una variable disponibles.');
      const ahora = new Date().toISOString();
      const filtro: FiltroHistorial = { cultivoId, nodoId, variable, recibidasHasta: ahora,
        inicio: periodo === 'personalizado' ? desdeFechaBogota(desde) : new Date(Date.parse(ahora) - duraciones[periodo]!).toISOString(),
        fin: periodo === 'personalizado' ? desdeFechaBogota(hasta) : ahora };
      validarFiltroHistorial(filtro); setSolicitud(filtro);
    } catch (e) { setError(e instanceof Error ? e.message : 'Revisa los filtros.'); }
  }
  if (!compatibles.length) return <section className="vacio"><h2>No hay nodos compatibles para consultar</h2><p>El historial estará disponible cuando tu cuenta tenga un nodo asignado.</p></section>;
  const reglaResultado = resultado ? VARIABLES_HISTORIAL[resultado.filtro.variable] : null;
  return <section className="historial" aria-label="Historial y estadísticas">
    <form className="filtros-historial" onSubmit={consultar} aria-busy={cargando}>
      <div><label className="form-label" htmlFor="hist-nodo">Nodo</label>
        <select id="hist-nodo" className="form-select" value={nodoId} disabled={cargando} onChange={e => {
          setNodoId(e.target.value);
          if (!capacidades.some(c => c.nodo_id === e.target.value && c.variable_codigo === variable)) setVariable('temperatura_aire');
        }}>{compatibles.map(n => <option key={n.id} value={n.id}>{n.codigo}{n.habilitado ? '' : ' (deshabilitado)'}</option>)}</select></div>
      <div><label className="form-label" htmlFor="hist-variable">Variable</label>
        <select id="hist-variable" className="form-select" value={variable} disabled={cargando} onChange={e => setVariable(e.target.value as VariableHistorial)}>
          {variables.map(v => <option key={v} value={v}>{VARIABLES_HISTORIAL[v].nombre}</option>)}</select></div>
      <div><label className="form-label" htmlFor="hist-periodo">Período</label>
        <select id="hist-periodo" className="form-select" value={periodo} disabled={cargando} onChange={e => setPeriodo(e.target.value)}>
          <option value="1h">Última hora</option><option value="24h">Últimas 24 horas</option><option value="7d">Últimos 7 días</option><option value="personalizado">Elegir fechas</option>
        </select></div>
      {periodo === 'personalizado' && <>
        <div><label className="form-label" htmlFor="hist-desde">Desde · Colombia</label><input id="hist-desde" type="datetime-local" className="form-control" value={desde} onChange={e => setDesde(e.target.value)} disabled={cargando} required /></div>
        <div><label className="form-label" htmlFor="hist-hasta">Hasta · Colombia</label><input id="hist-hasta" type="datetime-local" className="form-control" value={hasta} onChange={e => setHasta(e.target.value)} disabled={cargando} required /></div>
      </>}
      <button className="btn boton-principal" disabled={cargando}>{cargando ? 'Consultando…' : 'Consultar historial'}</button>
      {cargando && <button type="button" className="btn boton-secundario" onClick={() => controlador.current?.abort()}>Cancelar consulta</button>}
      <p className="ayuda-historial">Hasta siete días por consulta. Los filtros se aplican al pulsar Consultar historial.</p>
    </form>
    {error && <p className="aviso error" role="alert">{error}{resultado ? ' El resultado anterior conserva su período indicado abajo.' : ''}</p>}
    {aviso && <p className="aviso neutral" role="status">{aviso}</p>}
    {cargando && <p role="status" className="texto-secundario">Consultando las muestras reales del período…</p>}
    {resultado && reglaResultado && <div className="resultado-historial">
      <div className="cabecera-historial"><span className="sobre-titulo">RESULTADO CONSULTADO · DATOS REALES</span>
        <h2>{reglaResultado.nombre}</h2><p>Nodo: {nodos.find(n => n.id === resultado.filtro.nodoId)?.codigo ?? resultado.filtro.nodoId}</p>
        <p>{fechaBogota(resultado.filtro.inicio)} — {fechaBogota(resultado.filtro.fin)}</p>
        <p>Consulta iniciada: {fechaBogota(resultado.filtro.recibidasHasta)}. Las nuevas lecturas aparecerán al volver a consultar.</p></div>
      {resultado.filas.length > 0 && resumen ? <>
        <dl className="estadisticas-historial">
          <div><dt>Muestras</dt><dd>{numero(resumen.cantidad)}</dd></div>
          <div><dt>Mínimo</dt><dd>{numero(resumen.minimo)} <span>{reglaResultado.unidad}</span></dd></div>
          <div><dt>Máximo</dt><dd>{numero(resumen.maximo)} <span>{reglaResultado.unidad}</span></dd></div>
          <div><dt>Promedio de muestras</dt><dd>{numero(resumen.promedio)} <span>{reglaResultado.unidad}</span></dd></div>
        </dl>
        <Grafica resultado={resultado} />
        {resultado.filtro.variable === 'iluminacion_relativa' && <p className="aviso neutral">Índice relativo del ADC; no mide lux. Los valores 0 y 100 son límites de lectura. Comparar sensores requiere comprobarlos juntos antes de interpretar distintas ubicaciones.</p>}
        <h3 className="titulo-tabla">Lecturas del período</h3>
        <div className="table-responsive tabla-historial" tabIndex={0} role="region" aria-label="Tabla de lecturas históricas">
          <table className="table"><caption>Datos reales, del más reciente al más antiguo. Fechas en hora de Colombia.</caption><thead><tr><th scope="col">Captura</th><th scope="col">Valor ({reglaResultado.unidad})</th><th scope="col">Recepción aprox.</th><th scope="col">Mensaje</th></tr></thead>
            <tbody>{invertidas.slice(pagina * 20, (pagina + 1) * 20).map(f => <tr key={f.id}>
              <td>{fechaBogota(f.tomada_en)}</td><td>{numero(f.valor)}</td><td>{fechaBogota(f.recibida_en)}</td><td><code>{f.mensaje_id}</code></td>
            </tr>)}</tbody></table>
        </div>
        <nav className="paginas-historial" aria-label="Páginas de lecturas">
          <button className="btn boton-secundario" disabled={pagina === 0} onClick={() => setPagina(p => p - 1)}>Anterior</button>
          <span>{pagina * 20 + 1}–{Math.min((pagina + 1) * 20, invertidas.length)} de {invertidas.length}</span>
          <button className="btn boton-secundario" disabled={(pagina + 1) * 20 >= invertidas.length} onClick={() => setPagina(p => p + 1)}>Siguiente</button>
        </nav>
      </> : <div className="vacio"><h3>No hay mediciones reales en este período</h3><p>Prueba otro período o variable. La ausencia de registros no se representa como cero.</p></div>}
    </div>}
  </section>;
}