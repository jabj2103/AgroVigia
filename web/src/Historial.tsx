import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Chart, Legend, LineController, LineElement, PointElement, LinearScale, Tooltip } from 'chart.js';
import type { Plugin } from 'chart.js';
import { esAmbiental, esDht22, fechaBogota, origenNodo } from './domain.ts';
import { Selector } from './Filtros.tsx';
import { cargarHistorial } from './history-data.ts';
import { compararConPlantilla, desdeFechaBogota, fechaLocalBogota, puntosHistorial, rangoPlantilla, resumirHistorial, tendenciaHistorial, validarFiltroHistorial, VARIABLES_HISTORIAL } from './history-domain.ts';
import type { FiltroHistorial, RangoPlantilla, VariableHistorial } from './history-domain.ts';
import { cargarPlantillas } from './alert-data.ts';
import { cargarParametros } from './escenario-data.ts';
import type { PlantillaRangos } from './history-domain.ts';
import type { Capacidad, Medicion, Nodo } from './types.ts';

Chart.register(LineController, LineElement, PointElement, LinearScale, Tooltip, Legend);
const numero = (n: number | null) => n === null ? '—' : n.toLocaleString('es-CO', { maximumFractionDigits: 4 });
const duraciones: Record<string, number> = { '1h': 3_600_000, '24h': 86_400_000, '7d': 604_800_000 };
interface Serie { nodo: Nodo; filtro: FiltroHistorial; filas: Medicion[] }
// Un resultado es un nodo o, en modo comparacion, todos los nodos del cultivo con el mismo origen.
interface Resultado { filtro: FiltroHistorial; filas: Medicion[]; series: Serie[]; comparacion: boolean }
const COLORES_SERIE = ['serie-1', 'serie-2', 'serie-3', 'serie-4', 'serie-5', 'serie-6', 'serie-7'];
// El lienzo no hereda CSS: los colores de la grafica se leen del tema de tokens.
const tema = (nombre: string) => getComputedStyle(document.documentElement).getPropertyValue('--agv-' + nombre).trim();
const fmt = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 1 });
const TEXTO_TENDENCIA = { sube: 'Sube', baja: 'Baja', estable: 'Estable', insuficiente: 'Pocas muestras' } as const;
function textoTendencia(filas: readonly Medicion[], variable: VariableHistorial, unidad: string) {
  const t = tendenciaHistorial(filas, variable);
  return t.cambio === null || t.direccion === 'insuficiente' ? TEXTO_TENDENCIA.insuficiente : `${TEXTO_TENDENCIA[t.direccion]} (${t.cambio > 0 ? '+' : ''}${fmt(t.cambio)} ${unidad})`;
}
// Franja del optimo y lineas de los limites de alerta de la plantilla, dibujadas detras de los datos.
function bandasPlantilla(rango: RangoPlantilla | null): Plugin<'line'> {
  return { id: 'plantilla', beforeDatasetsDraw(chart) {
    if (!rango) return;
    const { ctx, chartArea: a, scales: { y } } = chart; if (!y) return;
    const py = (v: number) => Math.min(a.bottom, Math.max(a.top, y.getPixelForValue(v)));
    ctx.save();
    ctx.fillStyle = tema('grafica-optimo'); ctx.fillRect(a.left, py(rango.optimoMax), a.right - a.left, py(rango.optimoMin) - py(rango.optimoMax));
    ctx.strokeStyle = tema('grafica-limite'); ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5;
    for (const v of [rango.minimo, rango.maximo]) { const yy = y.getPixelForValue(v); if (yy >= a.top && yy <= a.bottom) { ctx.beginPath(); ctx.moveTo(a.left, yy); ctx.lineTo(a.right, yy); ctx.stroke(); } }
    ctx.restore();
  } };
}
function filtroInicial(cultivoId: string, nodo: Nodo): FiltroHistorial {
  const ahora = new Date();
  return { cultivoId, nodoId: nodo.id, origen: origenNodo(nodo), variable: 'temperatura_aire', inicio: new Date(+ahora - duraciones['1h']!).toISOString(), fin: ahora.toISOString(), recibidasHasta: ahora.toISOString() };
}
function Grafica({ resultado, rango }: { resultado: Resultado; rango: RangoPlantilla | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { filtro, series, comparacion } = resultado;
  const regla = VARIABLES_HISTORIAL[filtro.variable];
  useEffect(() => {
    if (!canvas.current) return;
    const chart = new Chart<'line', ReturnType<typeof puntosHistorial>>(canvas.current, {
      type: 'line',
      plugins: [bandasPlantilla(rango)],
      data: { datasets: series.map((s, i) => { const color = tema(comparacion ? COLORES_SERIE[i % COLORES_SERIE.length]! : regla.color);
        return { label: comparacion ? s.nodo.codigo : regla.nombre, data: puntosHistorial(s.filas), borderColor: color,
        backgroundColor: color, borderWidth: 2, pointRadius: s.filas.length < 100 && !comparacion ? 2 : 0,
        pointHoverRadius: 4, tension: 0, spanGaps: false }; }) },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
        interaction: { mode: 'nearest', intersect: false },
        plugins: { legend: { display: comparacion, labels: { color: tema('texto'), boxWidth: 12 } }, tooltip: { callbacks: {
          title: items => { const x = items[0]?.parsed.x; return typeof x === 'number' ? fechaBogota(new Date(x).toISOString()) : ''; },
          label: item => (comparacion ? item.dataset.label + ': ' : '') + numero(item.parsed.y) + ' ' + regla.unidad,
        } } },
        scales: {
          x: { type: 'linear', min: Date.parse(filtro.inicio), max: Date.parse(filtro.fin),
            title: { display: true, color: tema('texto-2'), text: 'Fecha de captura · hora de Colombia' },
            ticks: { color: tema('texto-2'), maxTicksLimit: 6, callback: v => new Intl.DateTimeFormat('es-CO', {
              timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
            }).format(new Date(Number(v))) }, grid: { color: tema('borde') } },
          y: { ticks: { color: tema('texto-2') }, title: { display: true, color: tema('texto-2'), text: regla.unidad },
            // Porcentajes en escala fija 0 a 100; el resto se ajusta a los datos y, si hay plantilla, a sus limites.
            ...(filtro.variable === 'humedad_aire' || filtro.variable === 'iluminacion_relativa' ? { min: 0, max: 100 }
              : { grace: '10%', ...(rango ? { suggestedMin: rango.minimo - 1, suggestedMax: rango.maximo + 1 } : {}) }),
            grid: { color: tema('borde') } },
        },
      },
    });
    return () => chart.destroy();
  }, [series, filtro, regla, rango, comparacion]);
  return <figure className="grafica-historial">
    <div className="lienzo-historial"><canvas ref={canvas} role="img" aria-label={'Historial de ' + regla.nombre + '. Los valores también están en la tabla.'}>
      Los valores de la gráfica están disponibles en la tabla de lecturas.
    </canvas></div>
    <figcaption>Una muestra por punto. Los intervalos sin capturas de más de tres minutos interrumpen la línea.{rango ? ` Franja verde: rango óptimo de la plantilla ${rango.nombre}. Líneas rojas: límites de alerta.` : ''}</figcaption>
  </figure>;
}
function ComparacionPlantilla({ rango, plantillaCodigo, aviso, filas, unidad }: { rango: RangoPlantilla | null; plantillaCodigo: string | null; aviso: string; filas?: readonly Medicion[]; unidad?: string }) {
  if (aviso) return <p className="aviso neutral">{aviso}</p>;
  if (!plantillaCodigo) return <p className="aviso neutral">Este cultivo no tiene plantilla. Aplícala en Alertas &gt; Reglas para comparar las lecturas con rangos de referencia.</p>;
  if (!rango) return null;
  const c = filas?.length ? compararConPlantilla(filas, rango) : null;
  return <section className="frente-plantilla" aria-label="Comparación con la plantilla">
    <h3>Frente a la plantilla {rango.nombre}</h3>
    <p>Óptimo de {fmt(rango.optimoMin)} a {fmt(rango.optimoMax)} {unidad ?? ''} · límites de alerta de {fmt(rango.minimo)} a {fmt(rango.maximo)} {unidad ?? ''}. Rangos orientativos, no validados en campo.</p>
    {c && <ul className="barras-plantilla">
      <li><span>En el óptimo</span><strong>{fmt(c.enOptimo)} %</strong></li>
      <li><span>Fuera del óptimo, dentro de límites</span><strong>{fmt(c.entreOptimoYLimite)} %</strong></li>
      <li className={c.sobreMaximo > 0 ? 'fuera' : ''}><span>Sobre el máximo</span><strong>{fmt(c.sobreMaximo)} %</strong></li>
      <li className={c.bajoMinimo > 0 ? 'fuera' : ''}><span>Bajo el mínimo</span><strong>{fmt(c.bajoMinimo)} %</strong></li>
    </ul>}
  </section>;
}
export default function Historial({ client, cultivoId, nodos, capacidades, plantillaCodigo = null, nodoInicial = '' }: {
  client: SupabaseClient; cultivoId: string; nodos: Nodo[]; capacidades: Capacidad[]; plantillaCodigo?: string | null; nodoInicial?: string;
}) {
  // Primero los nodos que hoy pertenecen al cultivo; despues los demas de la cuenta (lecturas antiguas en este cultivo).
  // Fisicos DHT22/ambientales y virtuales v3 (diez variables simuladas) con capacidades registradas.
  const compatibles = useMemo(() => nodos.filter(n => esDht22(n.id, capacidades) || esAmbiental(n.id, capacidades)
      || (n.tipo_nodo === 'virtual' && capacidades.some(c => c.nodo_id === n.id && c.sensor_modelo === 'SIMULADOR_V3')))
    .sort((a, b) => Number(b.cultivo_id === cultivoId) - Number(a.cultivo_id === cultivoId)), [nodos, capacidades, cultivoId]);
  const delCultivo = compatibles.filter(n => n.cultivo_id === cultivoId), otros = compatibles.filter(n => n.cultivo_id !== cultivoId);
  const grupos = (['real', 'simulado'] as const).map(o => ({ origen: o, nodos: delCultivo.filter(n => origenNodo(n) === o) })).filter(g => g.nodos.length > 1);
  // Desde el detalle de nodo de Inicio se abre con ese nodo; si no es compatible, con el primero.
  const primero = compatibles.find(n => n.id === nodoInicial) ?? compatibles[0];
  const [nodoId, setNodoId] = useState(primero?.id ?? '');
  const [plantilla, setPlantilla] = useState<PlantillaRangos | null>(null), [avisoPlantilla, setAvisoPlantilla] = useState('');
  // Rangos de referencia vigentes: el ajuste propio del cultivo o, si no tiene, su plantilla.
  useEffect(() => {
    if (!plantillaCodigo) return;
    const abort = new AbortController();
    Promise.all([cargarPlantillas(client, abort.signal), cargarParametros(client, cultivoId, abort.signal).catch(() => null)]).then(([lista, ajuste]) => {
      const base = lista.find(p => p.codigo === plantillaCodigo) ?? null;
      setPlantilla(ajuste ? { nombre: (base?.nombre ?? 'del cultivo') + ' (ajustada)', ...ajuste } as unknown as PlantillaRangos : base);
    }).catch(() => { if (!abort.signal.aborted) setAvisoPlantilla('No pudimos cargar la plantilla del cultivo; el historial se muestra sin rangos de referencia.'); });
    return () => abort.abort();
  }, [client, cultivoId, plantillaCodigo]);
  const comparando = nodoId.startsWith('todos:');
  const nodosConsulta = comparando ? grupos.find(g => 'todos:' + g.origen === nodoId)?.nodos ?? [] : compatibles.filter(n => n.id === nodoId);
  const [variable, setVariable] = useState<VariableHistorial>('temperatura_aire');
  const [periodo, setPeriodo] = useState('1h');
  // En vivo: repite la ultima consulta relativa (1 h o 24 h) cada 30 s con la hora actual.
  const [enVivo, setEnVivo] = useState(false);
  const ultima = useRef<{ nodos: Nodo[]; variable: VariableHistorial; periodo: string } | null>(null);
  const [desde, setDesde] = useState(() => fechaLocalBogota(new Date(Date.now() - 3_600_000).toISOString()));
  const [hasta, setHasta] = useState(() => fechaLocalBogota(new Date().toISOString()));
  const [solicitud, setSolicitud] = useState<FiltroHistorial | null>(() => primero ? filtroInicial(cultivoId, primero) : null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [cargando, setCargando] = useState(!!solicitud);
  const [pagina, setPagina] = useState(0);
  const controlador = useRef<AbortController | null>(null);
  const variables = (Object.keys(VARIABLES_HISTORIAL) as VariableHistorial[]).filter(v => nodosConsulta.length > 0 && nodosConsulta.every(n => capacidades.some(c => c.nodo_id === n.id && c.variable_codigo === v)));
  const [solicitudes, setSolicitudes] = useState<{ nodo: Nodo; filtro: FiltroHistorial }[] | null>(() => solicitud && primero ? [{ nodo: primero, filtro: solicitud }] : null);
  useEffect(() => {
    if (!solicitud || !solicitudes) return;
    let activo = true;
    const abort = new AbortController(); controlador.current = abort;
    setCargando(true); setError(''); setAviso('');
    Promise.all(solicitudes.map(s => cargarHistorial(client, s.filtro, abort.signal).then(filas => ({ ...s, filas })))).then(series => {
      if (activo) { setResultado({ filtro: solicitud, filas: series[0]?.filas ?? [], series, comparacion: series.length > 1 }); setPagina(0); }
    }).catch(e => {
      if (!activo) return;
      if (abort.signal.aborted) setAviso('Consulta cancelada. Se conserva el último resultado completo, si existe.');
      else setError(e instanceof Error ? e.message : 'No pudimos consultar el historial.');
    }).finally(() => { if (activo) { setCargando(false); controlador.current = null; } });
    return () => { activo = false; abort.abort(); };
  }, [client, solicitud, solicitudes]);
  const resumen = resultado ? resumirHistorial(resultado.filas) : null;
  const simuladas = (resultado?.filtro.origen ?? solicitud?.origen) === 'simulado';
  const invertidas = useMemo(() => resultado ? [...resultado.filas].reverse() : [], [resultado]);
  function preparar(nodosElegidos: Nodo[], variableElegida: VariableHistorial, periodoElegido: string) {
    const ahora = new Date().toISOString();
    const base = { cultivoId, variable: variableElegida, recibidasHasta: ahora,
      inicio: periodoElegido === 'personalizado' ? desdeFechaBogota(desde) : new Date(Date.parse(ahora) - duraciones[periodoElegido]!).toISOString(),
      fin: periodoElegido === 'personalizado' ? desdeFechaBogota(hasta) : ahora };
    const lista = nodosElegidos.map(n => ({ nodo: n, filtro: { ...base, nodoId: n.id, origen: origenNodo(n) } as FiltroHistorial }));
    lista.forEach(l => validarFiltroHistorial(l.filtro));
    setSolicitudes(lista); setSolicitud(lista[0]!.filtro);
  }
  function consultar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      if (!nodosConsulta.length || !variables.includes(variable)) throw new Error('Selecciona un nodo y una variable disponibles.');
      preparar(nodosConsulta, variable, periodo);
      ultima.current = periodo === 'personalizado' ? null : { nodos: nodosConsulta, variable, periodo };
    } catch (e) { setError(e instanceof Error ? e.message : 'Revisa los filtros.'); }
  }
  useEffect(() => {
    if (!enVivo) return;
    const t = window.setInterval(() => {
      const u = ultima.current;
      if (!u || controlador.current || document.hidden) return; // sin consulta relativa previa o con una en curso
      try { preparar(u.nodos, u.variable, u.periodo); } catch { /* el filtro previo ya fue validado */ }
    }, 30_000);
    return () => window.clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enVivo]);
  if (!compatibles.length) return <section className="vacio"><h2>No hay nodos compatibles para consultar</h2><p>El historial estará disponible cuando tu cuenta tenga un nodo asignado.</p></section>;
  const reglaResultado = resultado ? VARIABLES_HISTORIAL[resultado.filtro.variable] : null;
  const rango = resultado ? rangoPlantilla(plantilla, resultado.filtro.variable) : null;
  const conDatos = resultado ? resultado.series.some(s => s.filas.length > 0) : false;
  return <section className="historial" aria-label="Historial y estadísticas">
    <form className="filtros-historial" onSubmit={consultar} aria-busy={cargando}>
      <div><Selector id="hist-nodo" etiqueta="Nodo" valor={nodoId} desactivado={cargando} alCambiar={v => {
          setNodoId(v);
          if (!v.startsWith('todos:') && !capacidades.some(c => c.nodo_id === v && c.variable_codigo === variable)) setVariable('temperatura_aire');
        }} opciones={[
          ...(delCultivo.length > 0 ? grupos.map(g => ({ valor: 'todos:' + g.origen, texto: `Comparar los ${g.nodos.length} nodos ${g.origen === 'simulado' ? 'simulados' : 'reales'}`, grupo: 'En este cultivo' })) : []),
          ...delCultivo.map(n => ({ valor: n.id, texto: n.codigo + (n.simulado ? ' (simulado)' : ' (físico)') + (n.habilitado ? '' : ' (deshabilitado)'), grupo: 'En este cultivo' })),
          ...otros.map(n => ({ valor: n.id, texto: n.codigo + (n.simulado ? ' (simulado)' : '') + (n.habilitado ? '' : ' (deshabilitado)'), grupo: 'Otros nodos de tu cuenta' }))]} /></div>
      <div><Selector id="hist-variable" etiqueta="Variable" valor={variable} desactivado={cargando} alCambiar={v => setVariable(v as VariableHistorial)} opciones={variables.map(v => ({ valor: v, texto: VARIABLES_HISTORIAL[v].nombre }))} /></div>
      <div><Selector id="hist-periodo" etiqueta="Período" valor={periodo} desactivado={cargando} alCambiar={setPeriodo} opciones={[{ valor: '1h', texto: 'Última hora' }, { valor: '24h', texto: 'Últimas 24 horas' }, { valor: '7d', texto: 'Últimos 7 días' }, { valor: 'personalizado', texto: 'Elegir fechas' }]} /></div>
      {periodo === 'personalizado' && <>
        <div><label className="form-label" htmlFor="hist-desde">Desde · Colombia</label><input id="hist-desde" type="datetime-local" className="form-control" value={desde} onChange={e => setDesde(e.target.value)} disabled={cargando} required /></div>
        <div><label className="form-label" htmlFor="hist-hasta">Hasta · Colombia</label><input id="hist-hasta" type="datetime-local" className="form-control" value={hasta} onChange={e => setHasta(e.target.value)} disabled={cargando} required /></div>
      </>}
      <button className="btn boton-principal" disabled={cargando}>{cargando ? 'Consultando…' : 'Consultar historial'}</button>
      {cargando && <button type="button" className="btn boton-secundario" onClick={() => controlador.current?.abort()}>Cancelar consulta</button>}
      <label className="opcion-nodo en-vivo"><input type="checkbox" checked={enVivo} disabled={periodo === 'personalizado'} onChange={e => setEnVivo(e.target.checked)} />Actualizar en vivo cada 30 s (última hora o 24 horas)</label>
      <p className="ayuda-historial">Hasta siete días por consulta. Los filtros se aplican al pulsar Consultar historial.{enVivo ? ' En vivo: la gráfica y las estadísticas se recalculan con las capturas nuevas.' : ''}</p>
    </form>
    {error && <p className="aviso error" role="alert">{error}{resultado ? ' El resultado anterior conserva su período indicado abajo.' : ''}</p>}
    {aviso && <p className="aviso neutral" role="status">{aviso}</p>}
    <p role="status" className="estado-carga">{cargando ? `Consultando las muestras ${simuladas ? 'simuladas' : 'reales'} del período…` : ''}</p>
    {resultado && reglaResultado && <div className="resultado-historial">
      <div className="cabecera-historial"><span className="sobre-titulo">RESULTADO CONSULTADO · DATOS {simuladas ? 'SIMULADOS' : 'REALES'}</span>
        <h2>{reglaResultado.nombre}</h2><p>{resultado.comparacion ? 'Nodos: ' + resultado.series.map(s => s.nodo.codigo).join(', ') : 'Nodo: ' + (nodos.find(n => n.id === resultado.filtro.nodoId)?.codigo ?? resultado.filtro.nodoId)}</p>
        <p>{fechaBogota(resultado.filtro.inicio)} — {fechaBogota(resultado.filtro.fin)}</p>
        <p>Consulta iniciada: {fechaBogota(resultado.filtro.recibidasHasta)}. Las nuevas lecturas aparecerán al volver a consultar.</p></div>
      {resultado.comparacion && conDatos ? <>
        <Grafica resultado={resultado} rango={rango} />
        <ComparacionPlantilla rango={rango} plantillaCodigo={plantillaCodigo} aviso={avisoPlantilla} unidad={reglaResultado.unidad} />
        <h3 className="titulo-tabla">Estadísticas por nodo</h3>
        <div className="table-responsive tabla-historial" tabIndex={0} role="region" aria-label="Estadísticas por nodo">
          <table className="table"><caption>Datos {simuladas ? 'simulados' : 'reales'} de cada nodo del cultivo en el período.{rango ? ' Porcentajes frente a la plantilla ' + rango.nombre + '.' : ''}</caption>
            <thead><tr><th scope="col">Nodo</th><th scope="col">Muestras</th><th scope="col">Mín.</th><th scope="col">Máx.</th><th scope="col">Promedio</th><th scope="col">Tendencia</th>{rango && <><th scope="col">En óptimo</th><th scope="col">Fuera de límites</th></>}</tr></thead>
            <tbody>{resultado.series.map(s => { const r = resumirHistorial(s.filas), c = rango && s.filas.length ? compararConPlantilla(s.filas, rango) : null;
              return <tr key={s.nodo.id}><th scope="row">{s.nodo.codigo}</th><td>{numero(r.cantidad)}</td><td>{r.minimo === null ? 'Sin dato' : numero(r.minimo)}</td><td>{r.maximo === null ? 'Sin dato' : numero(r.maximo)}</td><td>{r.promedio === null ? 'Sin dato' : fmt(r.promedio)}</td>
                <td>{textoTendencia(s.filas, resultado.filtro.variable, reglaResultado.unidad)}</td>
                {rango && <><td>{c ? fmt(c.enOptimo) + ' %' : 'Sin dato'}</td><td>{c ? fmt(c.sobreMaximo + c.bajoMinimo) + ' %' : 'Sin dato'}</td></>}</tr>; })}</tbody></table>
        </div>
      </> : !resultado.comparacion && resultado.filas.length > 0 && resumen ? <>
        <dl className="estadisticas-historial">
          <div><dt>Muestras</dt><dd>{numero(resumen.cantidad)}</dd></div>
          <div><dt>Mínimo</dt><dd>{numero(resumen.minimo)} <span>{reglaResultado.unidad}</span></dd></div>
          <div><dt>Máximo</dt><dd>{numero(resumen.maximo)} <span>{reglaResultado.unidad}</span></dd></div>
          <div><dt>Promedio de muestras</dt><dd>{numero(resumen.promedio)} <span>{reglaResultado.unidad}</span></dd></div>
          <div><dt>Tendencia</dt><dd className="tendencia">{textoTendencia(resultado.filas, resultado.filtro.variable, reglaResultado.unidad)}</dd></div>
        </dl>
        <Grafica resultado={resultado} rango={rango} />
        <ComparacionPlantilla rango={rango} plantillaCodigo={plantillaCodigo} aviso={avisoPlantilla} filas={resultado.filas} unidad={reglaResultado.unidad} />
        {resultado.filtro.variable === 'precipitacion_60min' && <p className="aviso neutral">Cada captura es la lluvia acumulada de la última hora en ventana móvil: las ventanas se solapan y no se suman entre sí.</p>}
        {resultado.filtro.variable === 'iluminacion_relativa' && <p className="aviso neutral">Índice relativo del ADC; no mide lux. Los valores 0 y 100 son límites de lectura. Comparar sensores requiere comprobarlos juntos antes de interpretar distintas ubicaciones.</p>}
        <h3 className="titulo-tabla">Lecturas del período</h3>
        <div className="table-responsive tabla-historial" tabIndex={0} role="region" aria-label="Tabla de lecturas históricas">
          <table className="table"><caption>Datos {simuladas ? 'simulados' : 'reales'}, del más reciente al más antiguo. Fechas en hora de Colombia.</caption><thead><tr><th scope="col">Captura</th><th scope="col">Valor ({reglaResultado.unidad})</th><th scope="col">Recepción aprox.</th><th scope="col">Mensaje</th></tr></thead>
            <tbody>{invertidas.slice(pagina * 20, (pagina + 1) * 20).map(f => <tr key={f.id}>
              <td>{fechaBogota(f.tomada_en)}</td><td>{numero(f.valor)}</td><td>{fechaBogota(f.recibida_en)}</td><td><code>{f.mensaje_id}</code></td>
            </tr>)}</tbody></table>
        </div>
        <nav className="paginas-historial" aria-label="Páginas de lecturas">
          <button className="btn boton-secundario" disabled={pagina === 0} onClick={() => setPagina(p => p - 1)}>Anterior</button>
          <span>{pagina * 20 + 1}–{Math.min((pagina + 1) * 20, invertidas.length)} de {invertidas.length}</span>
          <button className="btn boton-secundario" disabled={(pagina + 1) * 20 >= invertidas.length} onClick={() => setPagina(p => p + 1)}>Siguiente</button>
        </nav>
      </> : <div className="vacio"><h3>No hay mediciones {simuladas ? 'simuladas' : 'reales'} en este período</h3><p>Prueba otro período o variable. La ausencia de registros no se representa como cero.</p></div>}
    </div>}
  </section>;
}