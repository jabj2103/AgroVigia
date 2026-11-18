import { useEffect, useState } from 'react';
import { TEXTO_SOLICITUD, solicitarSugerencia, ultimaSolicitud } from './simulacion-data.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Cultivo, Origen } from './types.ts';
import { ESTADOS_GENERALES, PRIORIDADES, VARIABLES_IA, cargarSugerencias, textoFallo } from './sugerencia-data.ts';
import type { RespuestaIA, Sugerencia } from './sugerencia-data.ts';
import { antiguedad, fechaBogota } from './domain.ts';
import { Informacion } from './Informacion.tsx';

const UNIDADES: Record<string, string> = { temperatura_aire: '°C', humedad_aire: '% HR', iluminacion_relativa: '% relativo', radiacion_solar: 'W/m²',
  humedad_suelo_vwc: '% VWC', temperatura_suelo: '°C', ph_suelo: '', conductividad_suelo_ece: 'dS/m', precipitacion_60min: 'mm', velocidad_viento: 'm/s' };
function Detalle({ s, r }: { s: Sugerencia; r: RespuestaIA }) {
  const e = ESTADOS_GENERALES[r.estado_general];
  return <>
    <div className="estados-alerta"><span className={'estado ' + e.clase}>{e.texto}</span><span className="estado neutral">{s.motivo === 'alerta' ? 'Por alerta nueva' : s.motivo === 'solicitud' ? 'A petición' : 'Revisión periódica'}</span></div>
    <p className="resumen-ia">{r.resumen}</p>
    <ol className="lista-recomendaciones">{r.recomendaciones.map((x, i) => <li key={i} className={'recomendacion prioridad-' + x.prioridad}>
      <div className="cabecera-recomendacion"><h4>{x.titulo}</h4><span className="chip-prioridad">{PRIORIDADES[x.prioridad]}</span></div>
      <p>{x.accion}</p><p className="evidencia-ia"><span>{VARIABLES_IA[x.variable]}</span> · {x.evidencia}</p>
    </li>)}</ol>
    <div className="bloques-ia">
      <div><h4><svg className="icono-linea" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3.5s5 5.2 5 9a5 5 0 0 1-10 0c0-3.8 5-9 5-9Z" /></svg> Agua y riego</h4><p>{r.riego}</p></div>
      <div><h4><svg className="icono-linea" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" /><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" /></svg> Luz</h4><p>{r.luz}</p></div>
    </div>
    <p className="aviso neutral"><strong>Limitaciones:</strong> {r.limitaciones}</p>
  </>;
}
function Evidencia({ s }: { s: Sugerencia }) {
  const c = s.contexto ?? {};
  return <details className="evidencia-alerta"><summary>Ver datos usados</summary>
    <p>Hora del contexto: {c.hora_local ?? 'no disponible'} ({c.periodo_del_dia === 'noche' ? 'noche' : 'día'}) · Plantilla: {c.plantilla?.nombre ?? 'sin plantilla'}</p>
    {(c.nodos ?? []).map(n => <p key={n.codigo}>{n.codigo}: {n.valores ? Object.entries(n.valores).map(([k, v]) => `${v} ${UNIDADES[k] ?? ''}`).join(' · ') : 'sin lecturas'}{n.ultima_captura ? ' · ' + fechaBogota(n.ultima_captura) : ''}</p>)}
    <p>Alertas abiertas en ese momento: {c.alertas_abiertas?.length ?? 0}</p>
    <p>Modelo: {s.modelo ?? 'no indicado'} · Sugerencia: <code>{s.id}</code></p>
  </details>;
}

export default function Sugerencias({ client, cultivo, origen, revision }: { client: SupabaseClient; cultivo: Cultivo; origen: Origen; revision: number }) {
  const [datos, setDatos] = useState<{ clave: string; filas: Sugerencia[]; fecha: string } | null>(null);
  const [error, setError] = useState(''), [cargando, setCargando] = useState(true), [refresco, setRefresco] = useState(0);
  const [ahora, setAhora] = useState(Date.now());
  // Analisis a peticion: la web registra la solicitud, n8n la atiende y aqui se consulta hasta que llega.
  const [peticion, setPeticion] = useState<{ tono: 'neutral' | 'exito' | 'advertencia' | 'error'; texto: string } | null>(null);
  const [pidiendo, setPidiendo] = useState(false), [espera, setEspera] = useState(0), [pedidaEn, setPedidaEn] = useState(0);
  const clave = cultivo.id + ':' + origen;
  function analizar() {
    if (pidiendo) return;
    setPidiendo(true); setPeticion(null);
    solicitarSugerencia(client, cultivo.id, origen).then(r => {
      if (r.codigo === 'SOLICITUD_EN_ESPERA') { setPeticion({ tono: 'advertencia', texto: 'Acabas de pedir un análisis. Podrás pedir otro ' + (r.disponible_en ? 'desde ' + fechaBogota(r.disponible_en) : 'en un minuto') + '.' }); return; }
      setPeticion({ tono: 'neutral', texto: r.codigo === 'SOLICITUD_EN_CURSO' ? 'Ya hay un análisis en curso para este cultivo. ' + TEXTO_SOLICITUD.en_proceso : TEXTO_SOLICITUD.pendiente });
      setPedidaEn(Date.now() - 2000); setEspera(30);
    }).catch(e => setPeticion({ tono: 'error', texto: e instanceof Error ? e.message : 'No pudimos registrar la petición.' })).finally(() => setPidiendo(false));
  }
  useEffect(() => {
    if (!espera) return;
    const t = window.setTimeout(() => {
      ultimaSolicitud(client, cultivo.id, origen).then(sol => {
        if (sol && ['rechazada', 'sin_datos', 'error'].includes(sol.estado)) { setPeticion({ tono: sol.estado === 'error' ? 'error' : 'advertencia', texto: TEXTO_SOLICITUD[sol.estado] }); setEspera(0); return; }
        if (sol?.estado === 'en_proceso') setPeticion({ tono: 'neutral', texto: TEXTO_SOLICITUD.en_proceso });
        setRefresco(r => r + 1); setEspera(n => n - 1);
        if (espera === 1) setPeticion({ tono: 'advertencia', texto: 'El análisis está tardando más de lo normal. Actualiza las sugerencias en un momento; si sigue igual, avisa al equipo de AgroVigía.' });
      }).catch(() => { setRefresco(r => r + 1); setEspera(n => n - 1); });
    }, 4000);
    return () => window.clearTimeout(t);
  }, [espera, client, cultivo.id, origen]);
  useEffect(() => {
    const abort = new AbortController(); setCargando(true); setError('');
    cargarSugerencias(client, cultivo.id, origen, abort.signal).then(filas => setDatos({ clave, filas, fecha: new Date().toISOString() }))
      .catch(e => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : 'No pudimos consultar las sugerencias.'); })
      .finally(() => { if (!abort.signal.aborted) setCargando(false); });
    return () => abort.abort();
  }, [client, cultivo.id, origen, clave, revision, refresco]);
  useEffect(() => { const t = window.setInterval(() => { setRefresco(r => r + 1); setAhora(Date.now()); }, 60_000); return () => window.clearInterval(t); }, []);
  const vigente = datos?.clave === clave ? datos : null;
  const ultimaGenerada = vigente?.filas.find(s => s.estado === 'generada' && s.respuesta);
  const ultimoIntento = vigente?.filas[0];
  const llego = !!espera && !!ultimaGenerada?.completada_en && Date.parse(ultimaGenerada.completada_en) >= pedidaEn;
  useEffect(() => { if (llego) { setEspera(0); setPeticion({ tono: 'exito', texto: 'Análisis listo. Es la sugerencia que ves abajo.' }); } }, [llego]);
  const minutos = ultimaGenerada?.completada_en ? (ahora - Date.parse(ultimaGenerada.completada_en)) / 60_000 : 0;
  return <section className="sugerencias-cultivo" aria-label="Sugerencias de IA" aria-busy={cargando}>
    <div className="cabecera-alertas"><span className={'etiqueta-origen' + (origen === 'simulado' ? ' simulado' : '')}>{origen === 'simulado' ? 'Datos simulados' : 'Datos reales'}</span>
      <div className="acciones-ia"><button className="btn boton-secundario" disabled={cargando} onClick={() => setRefresco(r => r + 1)}>Actualizar sugerencias</button>
        <button className="btn boton-principal" disabled={pidiendo || !!espera || !!cultivo.archivado_en} onClick={analizar}>{pidiendo ? 'Enviando…' : espera ? 'Analizando…' : 'Analizar ahora'}</button></div></div>
    <p className="ayuda-gestion">Analizar ahora prepara una sugerencia con las condiciones de este momento{origen === 'simulado' ? ', incluido el clima simulado activo' : ''}. Hay un número máximo de análisis por día para cada cultivo.</p>
    {peticion && <p className={'aviso ' + peticion.tono} role="status">{peticion.texto}</p>}
    <p className="aviso advertencia">Sugerencias generadas por IA (Gemini) con las lecturas guardadas. Son orientativas y no reemplazan la asistencia técnica.</p>
    <Informacion titulo="Qué datos usa la IA">{origen === 'simulado' ? 'Los nodos virtuales traen humedad del suelo simulada. ' : 'No hay sensor de humedad del suelo: el riego se orienta con la temperatura y la humedad del aire. '}La luz es un índice relativo, no lux. Cada sugerencia indica sus propias limitaciones y los datos que usó.</Informacion>
    {error && <p className="aviso error" role="alert">{error}{vigente ? ' Se conserva la última consulta correcta.' : ''}</p>}
    {cargando && !vigente && <p role="status">Consultando sugerencias…</p>}
    {vigente && <>
      {ultimoIntento?.estado === 'pendiente' && <p className="aviso neutral" role="status">Generando una sugerencia nueva desde {fechaBogota(ultimoIntento.solicitada_en)}…</p>}
      {ultimoIntento?.estado === 'fallida' && <p className="aviso error" role="status">El último intento ({fechaBogota(ultimoIntento.solicitada_en)}) no se completó. {textoFallo(ultimoIntento.error_codigo)}</p>}
      {!ultimaGenerada ? <div className="vacio"><h3>Aún no hay sugerencias para este cultivo</h3>
        <p>Se genera una como máximo cada 30 minutos, o cuando se abre una alerta, si llegan lecturas recientes. También puedes pedirla con Analizar ahora. Que no haya sugerencias no indica el estado del cultivo.</p></div>
        : <article className="tarjeta-sugerencia">
          <span className="sobre-titulo">ÚLTIMA SUGERENCIA · {fechaBogota(ultimaGenerada.completada_en ?? ultimaGenerada.solicitada_en)}</span>
          {minutos > 60 && <p className="aviso advertencia">Sugerencia de {antiguedad(ultimaGenerada.completada_en!, ahora).toLowerCase()}: puede no reflejar la condición actual.</p>}
          <Detalle s={ultimaGenerada} r={ultimaGenerada.respuesta!} /><Evidencia s={ultimaGenerada} />
        </article>}
      {vigente.filas.filter(s => s !== ultimaGenerada).length > 0 && <section className="historial-sugerencias"><h2>Intentos anteriores</h2>
        <ul>{vigente.filas.filter(s => s !== ultimaGenerada).map(s => <li key={s.id}><details><summary>
          <span className={'estado ' + (s.estado === 'generada' ? ESTADOS_GENERALES[s.respuesta!.estado_general].clase : s.estado === 'fallida' ? 'revisar' : 'neutral')}>
            {s.estado === 'generada' ? ESTADOS_GENERALES[s.respuesta!.estado_general].texto : s.estado === 'fallida' ? 'No completada' : 'En curso'}</span> {fechaBogota(s.solicitada_en)}</summary>
          {s.estado === 'generada' && s.respuesta ? <Detalle s={s} r={s.respuesta} /> : <p>{s.estado === 'fallida' ? textoFallo(s.error_codigo) : 'Esperando la respuesta del análisis.'}</p>}
        </details></li>)}</ul></section>}
      <p className="pie-consulta">Consulta correcta: {fechaBogota(vigente.fecha)} · se actualiza cada minuto</p>
    </>}
  </section>;
}
