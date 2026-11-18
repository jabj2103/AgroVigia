// Detalle de un nodo (solo lectura): ultima captura validada, sus alertas activas y enlaces a Historial y Dispositivos.
// En el telefono ocupa la pantalla; desde 900 px es un panel a la derecha que deja ver el croquis.
// Conserva los avisos de la consulta por zonas: error con la captura anterior, reloj, antiguedad y ubicacion anterior.
import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Capacidad } from './types.ts';
import { Dialogo } from './Dialogo.tsx';
import { antiguedad, ANTIGUEDAD_MAXIMA_MS, fechaBogota } from './domain.ts';
import { cargarCapturaZona } from './zone-data.ts';
import { ubicacionCoincide } from './zone-domain.ts';
import type { CapturaZona, NodoPlano } from './zone-domain.ts';
import { VARIABLES_ALERTA } from './alert-data.ts';
import type { AlertaActiva } from './alert-data.ts';

const numero = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 4 });
export function Procedencia({ virtual }: { virtual: boolean }) {
  return <span className={'procedencia-zona ' + (virtual ? 'simulada' : 'real')}>{virtual ? 'Simulada' : 'Real'}</span>;
}

export default function DetalleNodo({ client, cultivoId, nodo, capacidades, zonaNombre, alertas, errorAlertas, revision, alCerrar, verAlertas, verHistorial, verDispositivos }: {
  client: SupabaseClient; cultivoId: string; nodo: NodoPlano; capacidades: Capacidad[]; zonaNombre: string | null;
  alertas: AlertaActiva[]; errorAlertas: boolean; revision: number;
  alCerrar: () => void; verAlertas: () => void; verHistorial: () => void; verDispositivos: () => void;
}) {
  const [captura, setCaptura] = useState<CapturaZona | null>(null);
  const [error, setError] = useState(''), [cargando, setCargando] = useState(true);
  const [consulta, setConsulta] = useState<string | null>(null), [ahora, setAhora] = useState(Date.now()), [intento, setIntento] = useState(0);
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
  }, [client, cultivoId, nodo, capacidades, revision, intento]);
  const futuro = captura && (Date.parse(captura.tomadaEn) > ahora || Date.parse(captura.recibidaEn) > ahora);
  const antigua = captura && (ahora - Date.parse(captura.tomadaEn) > ANTIGUEDAD_MAXIMA_MS || ahora - Date.parse(captura.recibidaEn) > ANTIGUEDAD_MAXIMA_MS);
  const estado = error ? 'Error de actualización' : !nodo.habilitado ? 'Nodo deshabilitado' : cargando && !captura ? 'Consultando captura…' :
    !captura ? virtual ? 'Sin datos simulados' : 'Sin datos reales' : futuro ? 'Revisar reloj' : antigua ? 'Datos desactualizados' : 'Datos recientes';
  const valor = (codigo: string) => captura?.valores.find(v => v.codigo === codigo)?.valor;

  return <Dialogo titulo={nodo.codigo} variante="panel" alCerrar={alCerrar}
    detalle={<>{virtual ? 'Nodo virtual · datos simulados' : 'Nodo físico · datos reales'} · {zonaNombre ?? 'Sin ubicar'}</>}>
    <section className="detalle-zona" aria-label="Última captura del nodo" aria-busy={cargando}>
      <p className="estado-captura-zona"><span className={'estado ' + (error || futuro ? 'revisar' : antigua ? 'antiguo' : !captura || !nodo.habilitado ? 'neutral' : 'reciente')}>{estado}</span>
        {captura && <span> Captura {antiguedad(captura.tomadaEn, ahora).toLowerCase()}</span>}</p>
      {error && <p className="aviso error" role="alert">{error}{captura ? ' Se conserva la última captura consultada; su actualización no está confirmada.' : ''}</p>}
      {!nodo.habilitado && <p className="aviso neutral">Nodo deshabilitado. Las capturas guardadas se conservan como referencia.</p>}
      {!captura && !cargando && !error && <p className="vacio">{virtual ? 'Todavía no hay una captura simulada guardada para este nodo.' : 'Todavía no hay una captura real guardada para este nodo.'}</p>}
      {captura && <>
        {!ubicacionCoincide(captura, nodo) && <p className="aviso advertencia" role="status">Esta captura corresponde a una ubicación o asignación anterior. Zona de captura: {captura.zonaNombre ?? 'Sin ubicar'}. Consulta su fecha antes de relacionarla con el croquis actual.</p>}
        {virtual && <p className="nota-simulacion-zona">Valores sintéticos del simulador. Los escenarios y los rangos de prueba no diagnostican el cultivo.</p>}
        {captura.adcLdr === 4095 && <p className="aviso advertencia">Límite superior del sensor de luz: no distingue más luz en esta captura.</p>}
        {captura.adcLdr === 0 && <p className="aviso advertencia">Límite inferior del sensor de luz; no equivale a una medición de lux.</p>}
        {!virtual && valor('temperatura_aire') === 0 && valor('humedad_aire') === 0 && <p className="aviso advertencia">El par 0 / 0 requiere revisión de la medición.</p>}
        <div className="variables-zona">{captura.valores.map(v => <article className="variable-zona" key={v.codigo}>
          <div><h4>{v.nombre}</h4><Procedencia virtual={virtual}/></div>
          <p className="valor-zona">{numero(v.valor)}<span>{v.unidad}</span></p><p>{v.ayuda}</p>
        </article>)}</div>
        <dl className="fechas-zona"><div><dt>Fecha de captura</dt><dd>{fechaBogota(captura.tomadaEn)}</dd></div><div><dt>Zona de captura</dt><dd>{captura.zonaNombre ?? 'Sin ubicar'}</dd></div></dl>
        <details className="identificacion"><summary>Datos técnicos de la captura</summary>
          <p>Origen: {captura.origen} · Nodo: {nodo.codigo}</p><p>Recepción de aplicación (aprox.): {fechaBogota(captura.recibidaEn)}</p>
          {captura.adcLdr !== undefined && <p>Lectura ADC del sensor de luz: {captura.adcLdr} / 4095</p>}<code>{captura.mensajeId}</code></details>
      </>}
      <p className="pie-consulta" aria-live="polite">{cargando ? 'Consultando captura…' : consulta ? 'Última consulta correcta: ' + fechaBogota(consulta) : 'Sin una consulta correcta todavía.'}
        {!cargando && <button type="button" className="enlace-boton" onClick={() => setIntento(i => i + 1)}>Consultar de nuevo</button>}</p>
    </section>

    <section className="dlg-seccion" aria-labelledby="detalle-alertas">
      <h3 id="detalle-alertas">Alertas activas de este nodo</h3>
      {errorAlertas && <p className="aviso error" role="status">No pudimos actualizar las alertas{alertas.length ? '; se muestran las últimas consultadas.' : '.'}</p>}
      {!alertas.length && !errorAlertas && <p className="dlg-nota">Ninguna alerta activa en este nodo. Eso no confirma que su zona esté bien.</p>}
      {alertas.length > 0 && <ul className="alertas-nodo">{alertas.map(a => { const v = VARIABLES_ALERTA[a.variable_codigo]; return <li key={a.id}>
        <strong>{v.nombre} {a.limite === 'superior' ? 'por encima del máximo' : 'por debajo del mínimo'}</strong>
        <span>Último valor {numero(a.valor_ultimo)} {v.unidad} · límite {numero(a.umbral)} {v.unidad} · desde {fechaBogota(a.abierta_en)}</span>
        <span className={'estado ' + (a.revisada_en ? 'neutral' : 'revisar')}>{a.revisada_en ? 'Activa · revisada' : 'Activa · sin revisar'}</span>
      </li>; })}</ul>}
      {alertas.length > 0 && <button type="button" className="btn boton-secundario" onClick={verAlertas}>Abrir en Alertas</button>}
    </section>

    <div className="detalle-acciones">
      <button type="button" className="btn boton-principal" onClick={verHistorial}>Ver historial de este nodo</button>
      <button type="button" className="enlace-boton" onClick={verDispositivos}>Configurar dispositivo</button>
    </div>
  </Dialogo>;
}
