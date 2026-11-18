// Inicio (E2 de la auditoria UX): que pide atencion, donde esta y el detalle de cada nodo, en una sola pantalla.
// Reales y simulados se muestran juntos pero nunca se mezclan: cada fila, alerta y sugerencia lleva su procedencia.
// Un error de consulta nunca se presenta como "sin alertas" ni como "sin datos": se dice que fallo y se conservan los ultimos datos.
import { useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Cultivo, Origen } from './types.ts';
import { cargarPlano } from './zone-data.ts';
import type { NodoPlano, Plano } from './zone-domain.ts';
import { TEXTO_CONEXION, cargarEstadoRed, estadoConexion } from './red-data.ts';
import type { Conexion, EstadoNodoRed } from './red-data.ts';
import { cargarAlertasActivas } from './alert-data.ts';
import type { AlertaActiva } from './alert-data.ts';
import { ESTADOS_GENERALES, cargarSugerencias } from './sugerencia-data.ts';
import type { Sugerencia } from './sugerencia-data.ts';
import { antiguedad, fechaBogota } from './domain.ts';
import { CroquisCultivo } from './Croquis.tsx';
import VisorCultivo from './VisorCultivo.tsx';
import { medidasDe } from './terreno-data.ts';
import type { CultivoTerreno, Terreno } from './terreno-data.ts';
import type { MarcaNodo } from './Croquis.tsx';
import DetalleNodo, { Procedencia } from './DetalleNodo.tsx';
import { Informacion } from './Informacion.tsx';

type PorOrigen<T> = Partial<Record<Origen, T>>;
interface Activas { filas: AlertaActiva[]; total: number }
const origenDe = (n: NodoPlano): Origen => n.tipo_nodo === 'virtual' ? 'simulado' : 'real';
const DATOS: Record<Origen, string> = { real: 'Datos reales', simulado: 'Datos simulados' };
const CON: Record<Origen, string> = { real: 'con datos reales', simulado: 'con datos simulados' };
const numero = (v: number) => v.toLocaleString('es-CO', { maximumFractionDigits: 1 });
const plural = (n: number, uno: string, varios: string) => n + ' ' + (n === 1 ? uno : varios);
// Estados que piden atencion. En pausa, deshabilitado o sin cultivo son decisiones del usuario o del equipo.
const PROBLEMA: Conexion[] = ['antiguo', 'sin_datos', 'reloj'];

function Icono({ tipo }: { tipo: 'alerta' | 'aviso' | 'info' | 'error' }) {
  return <span className={'ico-resumen ico-' + tipo} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{
    tipo === 'alerta' || tipo === 'error' ? <><path d="M12 3 2.5 20h19Z" /><path d="M12 10v4.5M12 17.3v.2" /></>
    : tipo === 'aviso' ? <><path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M9 16a4.5 4.5 0 0 1 6 0M12 19.5v.01" /><path d="M3.5 3.5l17 17" /></>
    : <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.2" /></>}</svg></span>;
}

export default function Inicio({ client, cultivo, usuarioId, revision, verAlertas, verSugerencias, verHistorial, verDispositivos }: {
  client: SupabaseClient; cultivo: Cultivo; usuarioId: string; revision: number;
  verAlertas: (o: Origen) => void; verSugerencias: (o: Origen) => void; verHistorial: (nodoId: string) => void; verDispositivos: () => void;
}) {
  const [plano, setPlano] = useState<Plano | null>(null), [errorPlano, setErrorPlano] = useState('');
  const [red, setRed] = useState<EstadoNodoRed[] | null>(null), [errorRed, setErrorRed] = useState(false);
  const [alertas, setAlertas] = useState<PorOrigen<Activas>>({}), [errorAlertas, setErrorAlertas] = useState<PorOrigen<boolean>>({});
  const [sugerencia, setSugerencia] = useState<Sugerencia | null | undefined>(undefined), [errorSugerencia, setErrorSugerencia] = useState(false);
  const [consulta, setConsulta] = useState<string | null>(null), [cargando, setCargando] = useState(true), [intento, setIntento] = useState(0);
  const [ahora, setAhora] = useState(Date.now());
  const [zona, setZona] = useState<string | null>(null), [abierto, setAbierto] = useState('');
  // Antigüedad contra el reloj más reciente: una consulta recién llegada no debe verse «posterior al reloj local».
  const hace = (fecha: string) => antiguedad(fecha, Math.max(ahora, Date.now())).toLowerCase();

  useEffect(() => { const t = window.setInterval(() => setAhora(Date.now()), 1000); return () => window.clearInterval(t); }, []);
  useEffect(() => {
    const abort = new AbortController(); let pendiente = false;
    async function actualizar() {
      if (pendiente || abort.signal.aborted) return;
      pendiente = true; setCargando(true);
      let todoBien = true;
      try {
        let actual: Plano | null = null;
        try { actual = await cargarPlano(client, cultivo.id, usuarioId, abort.signal); if (!abort.signal.aborted) { setPlano(p => JSON.stringify(p) === JSON.stringify(actual) ? p : actual); setErrorPlano(''); } }
        catch (e) { todoBien = false; if (!abort.signal.aborted) setErrorPlano(e instanceof Error ? e.message : 'No pudimos consultar los nodos del cultivo.'); }
        if (abort.signal.aborted) return;
        const nodos = actual?.nodos ?? [];
        const origenes = (['real', 'simulado'] as Origen[]).filter(o => nodos.some(n => origenDe(n) === o));
        const [r, ...resto] = await Promise.allSettled([
          cargarEstadoRed(client, abort.signal),
          ...origenes.map(o => cargarAlertasActivas(client, cultivo.id, o, abort.signal)),
          ...origenes.map(o => cargarSugerencias(client, cultivo.id, o, abort.signal)),
        ]);
        if (abort.signal.aborted) return;
        if (r.status === 'fulfilled') { setRed((r.value as EstadoNodoRed[]).filter(f => f.cultivo_id === cultivo.id)); setErrorRed(false); } else { todoBien = false; setErrorRed(true); }
        const nuevas: PorOrigen<Activas> = {}, fallos: PorOrigen<boolean> = {};
        origenes.forEach((o, i) => { const x = resto[i]!; if (x.status === 'fulfilled') nuevas[o] = x.value as Activas; else { fallos[o] = true; todoBien = false; } });
        setAlertas(prev => ({ ...Object.fromEntries(origenes.filter(o => fallos[o] && prev[o]).map(o => [o, prev[o]])), ...nuevas }));
        setErrorAlertas(fallos);
        const sug = resto.slice(origenes.length);
        if (sug.some(x => x.status === 'rejected')) { setErrorSugerencia(true); todoBien = false; }
        else {
          const generadas = sug.flatMap(x => (x as PromiseFulfilledResult<Sugerencia[]>).value).filter(s => s.estado === 'generada' && s.respuesta);
          const fecha = (s: Sugerencia) => Date.parse(s.completada_en ?? s.solicitada_en);
          setSugerencia(generadas.sort((a, b) => fecha(b) - fecha(a))[0] ?? null); setErrorSugerencia(false);
        }
        if (todoBien) setConsulta(new Date().toISOString());
      } finally { pendiente = false; if (!abort.signal.aborted) setCargando(false); }
    }
    void actualizar(); const t = window.setInterval(() => { if (!document.hidden) void actualizar(); }, 30_000);
    return () => { abort.abort(); window.clearInterval(t); };
  }, [client, cultivo.id, usuarioId, revision, intento]);

  const nodos = useMemo(() => plano?.nodos ?? [], [plano]);
  const zonas = plano?.zonas ?? [];
  const origenes = (['real', 'simulado'] as Origen[]).filter(o => nodos.some(n => origenDe(n) === o));
  const alertasDe = (n: NodoPlano) => alertas[origenDe(n)]?.filas.filter(a => a.nodo_id === n.id) ?? [];
  const filaRed = (n: NodoPlano) => red?.find(f => f.nodo_id === n.id);
  const conexion = (n: NodoPlano): Conexion | null => { const f = filaRed(n); return f ? estadoConexion(f, ahora) : null; };
  // Mismo numero R1/S1 en el croquis y en la lista.
  const codigoCorto = (n: NodoPlano) => (n.tipo_nodo === 'virtual' ? 'S' : 'R') + String(nodos.filter(x => x.tipo_nodo === n.tipo_nodo).findIndex(x => x.id === n.id) + 1);
  const marcas = new Map<string, MarcaNodo>(nodos.map(n => {
    const c = conexion(n), alerta = alertasDe(n).length > 0;
    return [n.id, { codigo: codigoCorto(n), alerta, sinRecibir: !!c && PROBLEMA.includes(c),
      texto: `${n.codigo}, ${n.tipo_nodo === 'virtual' ? 'simulado' : 'real'}${c ? ', ' + TEXTO_CONEXION[c].toLowerCase() : ''}${alerta ? ', con alerta activa' : ''}. Ver detalle` }];
  }));
  const problemas = nodos.filter(n => { const c = conexion(n); return n.habilitado && !!c && PROBLEMA.includes(c); });
  const grupos = [...zonas.map(z => ({ clave: z.id, nombre: z.nombre, nodos: nodos.filter(n => n.zona_id === z.id) })),
    { clave: 'sin-ubicar', nombre: 'Sin ubicar', nodos: nodos.filter(n => n.zona_id === null) }]
    .filter(g => g.nodos.length && (!zona || g.clave === zona));
  const elegido = nodos.find(n => n.id === abierto);
  const fallo = !!errorPlano || errorRed || Object.values(errorAlertas).some(Boolean) || errorSugerencia;
  // Visor 3D: el terreno se arma con los sectores y nodos ya validados del croquis, sin otra consulta.
  const terreno = useMemo<Terreno>(() => ({ medidas: medidasDe(cultivo as CultivoTerreno), sectores: plano?.zonas ?? [],
    nodos: (plano?.nodos ?? []).map(n => ({ id: n.id, codigo: n.codigo, cultivo_id: n.cultivo_id, tipo_nodo: n.tipo_nodo, zona_id: n.zona_id, posicion_x: n.posicion_x, posicion_y: n.posicion_y })) }), [cultivo, plano]);
  const filasVisor = useMemo(() => red ?? [], [red]);
  const conAlerta = useMemo(() => new Set(Object.values(alertas).flatMap(a => a?.filas.map(x => x.nodo_id) ?? [])), [alertas]);

  if (!plano && cargando) return <p className="vacio" role="status">Consultando el cultivo…</p>;
  if (!plano) return <div className="aviso error" role="alert">{errorPlano}<button className="enlace-boton" onClick={() => setIntento(i => i + 1)}>Reintentar</button></div>;
  if (!nodos.length) return <section className="vacio"><h2>Este cultivo no tiene nodos vinculados</h2><p>Vincula un nodo físico o crea uno simulado para ver aquí sus lecturas.</p>
    <button className="btn boton-principal" onClick={verDispositivos}>Ir a Dispositivos</button></section>;

  return <section className="inicio-cultivo" aria-label="Estado del cultivo" aria-busy={cargando}>
    <p className="frescura" aria-live="polite"><i aria-hidden="true" className={fallo ? 'con-fallo' : ''} />
      {consulta ? 'Actualizado ' + hace(consulta) : 'Sin una consulta completa todavía'} · se actualiza cada 30 s</p>
    {fallo && <p className="aviso error" role="alert">Algunas consultas fallaron. Se muestran los últimos datos confirmados, con su fecha.
      <button className="enlace-boton" onClick={() => setIntento(i => i + 1)}>Reintentar</button></p>}

    <section className="inicio-resumen" aria-labelledby="titulo-resumen">
      <h2 id="titulo-resumen" className="visually-hidden">Qué pide atención</h2>
      <ul className="lista-resumen">
        {origenes.map(o => {
          const a = alertas[o], sin = a?.filas.filter(x => !x.revisada_en) ?? [], revisadas = (a?.filas.length ?? 0) - sin.length, mas = a && a.total > a.filas.length;
          if (!a) return <li key={o}><Icono tipo="error" /><span className="txt"><strong>No pudimos consultar las alertas</strong><small>{DATOS[o]}</small></span></li>;
          const sufijo = errorAlertas[o] ? ' · sin actualizar' : '';
          return [
            sin.length > 0 && <li key={o + 'sin'}><button type="button" onClick={() => verAlertas(o)}><Icono tipo="alerta" />
              <span className="txt"><strong>{plural(sin.length, 'alerta sin revisar', 'alertas sin revisar')}{mas ? ' o más' : ''}</strong>
                <small>{DATOS[o]} · {[...new Set(sin.map(x => nodos.find(n => n.id === x.nodo_id)?.codigo ?? 'nodo'))].join(', ')}{sufijo}</small></span><span className="flecha" aria-hidden="true">›</span></button></li>,
            revisadas > 0 && <li key={o + 'rev'}><button type="button" onClick={() => verAlertas(o)}><Icono tipo="alerta" />
              <span className="txt"><strong>{plural(revisadas, 'alerta revisada sigue activa', 'alertas revisadas siguen activas')}</strong><small>{DATOS[o]}{sufijo}</small></span><span className="flecha" aria-hidden="true">›</span></button></li>,
            a.total === 0 && <li key={o + 'cero'}><Icono tipo="info" /><span className="txt"><strong>Sin alertas activas {CON[o]}</strong><small>Eso no confirma que el cultivo esté sano.{sufijo}</small></span></li>,
          ];
        })}
        {problemas.slice(0, 3).map(n => { const f = filaRed(n), c = conexion(n)!; return <li key={'p' + n.id}><button type="button" onClick={() => setAbierto(n.id)}><Icono tipo="aviso" />
          <span className="txt"><strong>{n.codigo}: {TEXTO_CONEXION[c].toLowerCase()}</strong>
            <small>{DATOS[origenDe(n)]} · {f?.tomada_en ? 'última captura ' + hace(f.tomada_en) : 'aún no ha llegado ninguna captura'}</small></span><span className="flecha" aria-hidden="true">›</span></button></li>; })}
        {problemas.length > 3 && <li><Icono tipo="aviso" /><span className="txt"><strong>Y {plural(problemas.length - 3, 'nodo más', 'nodos más')} sin recibir</strong><small>Están marcados en la lista.</small></span></li>}
        {errorRed && <li><Icono tipo="error" /><span className="txt"><strong>No pudimos consultar el estado de los nodos</strong><small>No sabemos si están enviando datos ahora.</small></span></li>}
      </ul>
    </section>

    <section className="inicio-mapa" aria-labelledby="titulo-mapa">
      <div className="cabecera-seccion"><h2 id="titulo-mapa">Tu cultivo</h2>
        {zona && <button type="button" className="boton-fila" onClick={() => setZona(null)}>Ver todo el cultivo</button>}</div>
      {errorRed && !red && <p className="aviso error" role="status">No pudimos consultar el estado de los nodos; el dibujo aparecerá al reintentar.</p>}
      <VisorCultivo cultivoId={cultivo.id} filas={filasVisor} terreno={terreno} alertas={conAlerta} elegido={abierto || null} alElegir={setAbierto}
        alternativa={<CroquisCultivo zonas={zonas} nodos={nodos} marcas={marcas} zonaActiva={zona} nodoActivo={abierto || null}
          alElegirZona={id => setZona(z => z === id ? null : id)} alElegirNodo={setAbierto} />} />
      <ul className="esc-leyenda leyenda-visor" aria-label="Leyenda del dibujo">
        <li><span className="pastilla-tono" data-tono="recibe"><i aria-hidden="true" />Recibiendo</span></li>
        <li><span className="pastilla-tono" data-tono="no_recibe"><i aria-hidden="true" />Sin recibir</span></li>
        <li><span className="pastilla-tono" data-tono="inactivo"><i aria-hidden="true" />En pausa o fuera de servicio</span></li>
        <li><span className="pastilla-tono alerta-leyenda"><i aria-hidden="true">▲</i>Alerta activa</span></li>
      </ul>
      <Informacion titulo="Cómo usar el dibujo">Toca o haz clic en un nodo para ver su detalle; también puedes elegirlo en la lista. Con ratón, arrastra para girar el dibujo y usa Ctrl + rueda para acercarlo. En el teléfono, usa dos dedos para acercar. El nodo alto con antena es el físico. Es una representación aproximada: no son coordenadas GPS ni indica la salud del cultivo.</Informacion>
    </section>

    <section className="inicio-lista" aria-labelledby="titulo-lista">
      <h2 id="titulo-lista">Nodos {zona ? 'de ' + (zonas.find(z => z.id === zona)?.nombre ?? 'la zona') : 'por sector'}</h2>
      <div className="grupos-nodos">{grupos.map(g => <div className="grupo-nodos" key={g.clave}>
        <h3>{g.nombre}</h3>
        <ul>{g.nodos.map(n => {
          const f = filaRed(n), c = conexion(n), lista = alertasDe(n), virtual = n.tipo_nodo === 'virtual';
          return <li key={n.id}><button type="button" className={'fila-nodo' + (abierto === n.id ? ' activa' : '')} onClick={() => setAbierto(n.id)}>
            <span className={'marcador-nodo ' + (virtual ? 'simulado' : 'fisico')} aria-hidden="true">{codigoCorto(n)}</span>
            <span className="txt"><span className="linea-1"><strong>{n.codigo}</strong><Procedencia virtual={virtual} /></span>
              <small className={'estado-nodo ' + (c ? (c === 'conectado' ? 'recibe' : PROBLEMA.includes(c) ? 'no-recibe' : 'inactivo') : 'desconocido')}>
                <i aria-hidden="true" />{c ? TEXTO_CONEXION[c] : errorRed ? 'Estado sin consultar' : 'Consultando…'}{f?.tomada_en ? ' · ' + hace(f.tomada_en) : ''}</small></span>
            <span className={'dato-nodo' + (lista.length ? ' con-alerta' : '') + (c && c !== 'conectado' ? ' viejo' : '')}>
              {lista.length > 0 && <><span aria-hidden="true">▲ </span><span className="visually-hidden">Alerta activa. </span></>}{f?.temperatura !== null && f?.temperatura !== undefined ? numero(f.temperatura) + ' °C' : '—'}
              {f?.humedad !== null && f?.humedad !== undefined && <small>{numero(f.humedad)} % HR</small>}</span>
          </button></li>;
        })}</ul>
      </div>)}</div>
    </section>

    <section className="inicio-sugerencia" aria-labelledby="titulo-sugerencia">
      <h2 id="titulo-sugerencia">Última sugerencia</h2>
      {errorSugerencia && !sugerencia ? <p className="aviso error" role="status">No pudimos consultar las sugerencias.</p>
        : sugerencia === undefined ? <p role="status">Consultando sugerencias…</p>
        : sugerencia === null ? <p className="texto-secundario">Aún no hay sugerencias para este cultivo. Eso no indica su estado.</p>
        : <div className="tarjeta-mini">
          <p className="meta-sugerencia"><span className="etiqueta-ia">Generada por IA</span> {fechaBogota(sugerencia.completada_en ?? sugerencia.solicitada_en)} · {DATOS[sugerencia.origen]}</p>
          <p className="estado-sugerencia"><span className={'estado ' + ESTADOS_GENERALES[sugerencia.respuesta!.estado_general].clase}>{ESTADOS_GENERALES[sugerencia.respuesta!.estado_general].texto}</span></p>
          <p>{sugerencia.respuesta!.resumen}</p>
          {ahora - Date.parse(sugerencia.completada_en ?? sugerencia.solicitada_en) > 3_600_000 && <p className="aviso advertencia">Tiene más de una hora: puede no reflejar la condición actual.</p>}
          <button type="button" className="btn boton-secundario" onClick={() => verSugerencias(sugerencia.origen)}>Ver sugerencia completa</button>
        </div>}
    </section>

    {elegido && plano && <DetalleNodo key={elegido.id + ':' + elegido.asignacion_version} client={client} cultivoId={cultivo.id} nodo={elegido} capacidades={plano.capacidades}
      zonaNombre={zonas.find(z => z.id === elegido.zona_id)?.nombre ?? null} alertas={alertasDe(elegido)} errorAlertas={!!errorAlertas[origenDe(elegido)]} revision={revision + intento}
      alCerrar={() => setAbierto('')} verAlertas={() => { setAbierto(''); verAlertas(origenDe(elegido)); }}
      verHistorial={() => { setAbierto(''); verHistorial(elegido.id); }} verDispositivos={() => { setAbierto(''); verDispositivos(); }} />}
  </section>;
}
