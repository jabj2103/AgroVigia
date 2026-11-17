// Escenario: una sola pantalla para ver los nodos en vivo, activar el clima simulado, abrir el detalle
// de cada nodo, ajustar los parametros del cultivo y las preferencias del usuario.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { TEXTO_CONEXION, cargarEstadoRed, estadoConexion, lotesNuevos, panalRed, tonoConexion } from './red-data.ts';
import type { EstadoNodoRed, GrupoRed } from './red-data.ts';
import { EVENTOS_CLIMA, INTENSIDADES, PREFERENCIAS_DEFECTO, cargarPreferencias, establecerClima, guardarPreferencias, suscribirCambios } from './escenario-data.ts';
import type { EventoClima, Preferencias } from './escenario-data.ts';
import { crearEscena } from './escena-3d.ts';
import type { Escena } from './escena-3d.ts';
import { IconoClima } from './iconos-clima.tsx';
import { Buscador, Selector, coincide } from './Filtros.tsx';
import { Dialogo } from './Dialogo.tsx';
import NodoDialogo from './NodoDialogo.tsx';
import ParametrosDialogo from './ParametrosDialogo.tsx';
import AjusteManual from './AjusteManual.tsx';
import { cargarCondiciones } from './simulacion-data.ts';
import { cargarPlanos } from './terreno-data.ts';
import type { Terreno } from './terreno-data.ts';
import type { Ajustes } from './simulacion-data.ts';
import { antiguedad, origenesCultivo } from './domain.ts';
import type { Cultivo } from './types.ts';
import './escenario.css';

const EVENTOS = Object.keys(EVENTOS_CLIMA) as EventoClima[];
const SIN_AJUSTE: Ajustes = {};
const nombreCorto = (n: string) => n.replace(/^Simulado · /, '');
const codigoCorto = (f: EstadoNodoRed) => f.simulado ? f.codigo.replace(/^sim-[a-z0-9]+-(?=[a-z0-9]+$)/, 'sim-') : f.codigo;
const valor = (v: number | null | undefined, u: string) => v === null || v === undefined ? 'Sin dato' : v.toLocaleString('es-CO', { maximumFractionDigits: 1 }) + ' ' + u;
const climaDe = (g: GrupoRed | undefined) => g?.nodos.find(n => n.clima_evento) ?? null;

function Ajustes({ client, prefs, alGuardar, alCerrar }: { client: SupabaseClient; prefs: Preferencias; alGuardar: (p: Preferencias) => void; alCerrar: () => void }) {
  const [p, setP] = useState(prefs), [ocupado, setOcupado] = useState(false), [error, setError] = useState('');
  function guardar(e: FormEvent) {
    e.preventDefault(); if (ocupado) return;
    setOcupado(true); setError('');
    guardarPreferencias(client, p).then(g => { alGuardar(g); alCerrar(); }).catch(err => setError(err instanceof Error ? err.message : 'No pudimos guardar.')).finally(() => setOcupado(false));
  }
  return <Dialogo titulo="Ajustes" detalle="Se guardan en tu cuenta y aplican en cualquier equipo." alCerrar={alCerrar}>
    {error && <p className="aviso error" role="alert">{error}</p>}
    <form onSubmit={guardar}>
      <div className="dlg-interruptor">
        <button type="button" role="switch" aria-checked={p.tiempo_real} className="interruptor" disabled={ocupado} onClick={() => setP({ ...p, tiempo_real: !p.tiempo_real })}>
          <span aria-hidden="true" /><span className="visually-hidden">Actualización en tiempo real</span></button>
        <div><strong>Tiempo real</strong><p>La pantalla se actualiza en cuanto llega un dato. Si se apaga, o si la conexión en vivo falla, se consulta cada cierto tiempo.</p></div>
      </div>
      <fieldset className="grupo-opciones"><legend>Consultar cada</legend>
        {([5, 10, 30] as const).map(s => <label key={s} className="opcion-ficha"><input type="radio" name="ajuste-refresco" checked={p.refresco_segundos === s} disabled={ocupado} onChange={() => setP({ ...p, refresco_segundos: s })} /><span>{s} segundos</span></label>)}
      </fieldset>
      <fieldset className="grupo-opciones"><legend>Al activar un evento de clima, aplicarlo por defecto a</legend>
        <label className="opcion-ficha"><input type="radio" name="ajuste-alcance" checked={p.clima_alcance === 'cultivo'} disabled={ocupado} onChange={() => setP({ ...p, clima_alcance: 'cultivo' })} /><span>El cultivo elegido</span></label>
        <label className="opcion-ficha"><input type="radio" name="ajuste-alcance" checked={p.clima_alcance === 'todos'} disabled={ocupado} onChange={() => setP({ ...p, clima_alcance: 'todos' })} /><span>Todos mis cultivos</span></label>
      </fieldset>
      <div className="dlg-acciones"><button className="btn boton-principal" disabled={ocupado}>{ocupado ? 'Guardando…' : 'Guardar ajustes'}</button></div>
    </form>
  </Dialogo>;
}

export default function Escenario({ client, cultivos, cultivoId, elegirCultivo, verHistorial, alCambiarCultivo }: {
  client: SupabaseClient; cultivos: Cultivo[]; cultivoId: string; elegirCultivo: (id: string) => void; verHistorial: (id: string) => void; alCambiarCultivo: () => void;
}) {
  const lienzo = useRef<HTMLDivElement>(null), escena = useRef<Escena | null>(null), previas = useRef<EstadoNodoRed[] | null>(null);
  const elegir = useRef(elegirCultivo); elegir.current = elegirCultivo;
  const [filas, setFilas] = useState<EstadoNodoRed[] | null>(null), [nuevos, setNuevos] = useState<Set<string>>(new Set());
  const [error, setError] = useState(''), [sinWebgl, setSinWebgl] = useState(false), [ahora, setAhora] = useState(Date.now()), [refresco, setRefresco] = useState(0);
  const [prefs, setPrefs] = useState<Preferencias | null>(null), [enVivo, setEnVivo] = useState(false);
  const [seleccion, setSeleccion] = useState(''), [dialogo, setDialogo] = useState<'parametros' | 'ajustes' | null>(null);
  const [evento, setEvento] = useState<EventoClima>('normal'), [intensidad, setIntensidad] = useState(2), [todos, setTodos] = useState(false);
  const [aplicando, setAplicando] = useState(false), [errorClima, setErrorClima] = useState(''), [avisoClima, setAvisoClima] = useState('');
  const [ajustes, setAjustes] = useState<Map<string, Ajustes>>(new Map()), [planos, setPlanos] = useState<Map<string, Terreno>>(new Map());
  // Filtros de las fichas de nodos: no cambian la escena, solo la lista de abajo.
  const [qNodo, setQNodo] = useState(''), [fEstado, setFEstado] = useState('todos'), [fGrupo, setFGrupo] = useState('todos');

  useEffect(() => {
    if (!lienzo.current) return;
    try { escena.current = crearEscena(lienzo.current, setSeleccion, id => elegir.current(id)); } catch { setSinWebgl(true); }
    return () => { escena.current?.destruir(); escena.current = null; };
  }, []);
  // Preferencias de la cuenta. Si no se pueden leer se usa sondeo, sin abrir la conexion en vivo.
  useEffect(() => {
    const abort = new AbortController();
    cargarPreferencias(client, abort.signal).then(p => { setPrefs(p); setTodos(p.clima_alcance === 'todos'); })
      .catch(() => { if (!abort.signal.aborted) setPrefs({ ...PREFERENCIAS_DEFECTO, tiempo_real: false }); });
    return () => abort.abort();
  }, [client]);
  useEffect(() => {
    const abort = new AbortController();
    cargarEstadoRed(client, abort.signal).then(actuales => {
      setNuevos(lotesNuevos(previas.current, actuales)); previas.current = actuales; setFilas(actuales); setError('');
    }).catch(e => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : 'No pudimos consultar la red.'); });
    return () => abort.abort();
  }, [client, refresco]);
  // Ajustes manuales activos por cultivo. Si no se pueden leer, la pantalla sigue con el clima.
  const idsCultivos = cultivos.map(x => x.id).join(',');
  useEffect(() => {
    const abort = new AbortController();
    cargarCondiciones(client, idsCultivos.split(',').filter(Boolean), true, abort.signal)
      .then(l => setAjustes(new Map(l.filter(x => x.tipo === 'ajuste' && x.ajustes).map(x => [x.cultivo_id, x.ajustes!])))).catch(() => undefined);
    return () => abort.abort();
  }, [client, idsCultivos, refresco]);
  // Plano real de cada cultivo (medidas, sectores y posicion de los nodos). Se relee cada seis consultas.
  const turnoPlano = Math.floor(refresco / 6);
  useEffect(() => {
    const abort = new AbortController();
    cargarPlanos(client, cultivos, abort.signal).then(setPlanos).catch(() => undefined);
    return () => abort.abort();
  }, [client, cultivos, turnoPlano]);
  // Tiempo real (Supabase Realtime) con sondeo de respaldo: mas espaciado mientras el canal esta activo.
  useEffect(() => {
    if (!prefs?.tiempo_real) { setEnVivo(false); return; }
    return suscribirCambios(client, () => setRefresco(r => r + 1), setEnVivo);
  }, [client, prefs?.tiempo_real]);
  const cadaSegundos = enVivo ? 30 : prefs?.refresco_segundos ?? 10;
  useEffect(() => {
    const t = window.setInterval(() => { if (!document.hidden) setRefresco(r => r + 1); }, cadaSegundos * 1000);
    return () => window.clearInterval(t);
  }, [cadaSegundos]);
  useEffect(() => { const s = window.setInterval(() => setAhora(Date.now()), 1000); return () => window.clearInterval(s); }, []);

  const panal = useMemo(() => filas ? panalRed(filas, planos) : null, [filas, planos]);
  const grupos = panal?.grupos.filter(g => g.cultivo_id) ?? [];
  const actual = grupos.find(g => g.cultivo_id === cultivoId) ?? grupos[0];
  const idActual = actual?.cultivo_id ?? '';
  useEffect(() => { if (filas) escena.current?.actualizar(filas, nuevos, ahora, idActual, ajustes, planos); }, [filas, nuevos, ahora, idActual, ajustes, planos]);
  // El formulario de clima refleja el evento activo del cultivo elegido.
  const activo = climaDe(actual), eventoActivo = activo?.clima_evento ?? 'normal', intensidadActiva = activo?.clima_intensidad ?? 2;
  useEffect(() => { setEvento(eventoActivo); setIntensidad(intensidadActiva); setErrorClima(''); }, [idActual, eventoActivo, intensidadActiva]);

  function aplicarClima(e: FormEvent) {
    e.preventDefault(); if (aplicando || !idActual) return;
    setAplicando(true); setErrorClima(''); setAvisoClima('');
    establecerClima(client, idActual, evento, intensidad, todos).then(n => {
      setAvisoClima(n === 0 ? 'Ese clima ya estaba activo.' : evento === 'normal' ? 'Clima normal. Los nodos vuelven a sus valores de referencia en unos dos minutos.'
        : `${EVENTOS_CLIMA[evento].nombre} activo en ${n === 1 ? 'un cultivo' : n + ' cultivos'}. Los nodos empiezan a cambiar en segundos y llegan al efecto completo en unos dos minutos.`);
      setRefresco(r => r + 1);
    }).catch(err => setErrorClima(err instanceof Error ? err.message : 'No pudimos cambiar el clima.')).finally(() => setAplicando(false));
  }
  const recibiendo = filas?.filter(f => estadoConexion(f, ahora) === 'conectado').length ?? 0;
  const elegido = filas?.find(f => f.nodo_id === seleccion);
  const cultivoActual = cultivos.find(c => c.id === idActual);
  const gruposVisibles = (panal?.grupos ?? []).filter(g => fGrupo === 'todos' || g.clave === fGrupo || !panal?.grupos.some(x => x.clave === fGrupo))
    .map(g => ({ ...g, total: g.nodos, nodos: g.nodos.filter(f => (fEstado === 'todos' || tonoConexion(estadoConexion(f, ahora)) === fEstado)
      && coincide([f.codigo, g.nombre, f.zona_nombre ?? '', f.simulado ? 'simulado virtual' : 'fisico'].join(' '), qNodo)) })).filter(g => g.nodos.length);
  const sinCambio = evento === eventoActivo && (evento === 'normal' || intensidad === intensidadActiva) && !todos;
  return <section className="escenario" aria-label="Escenario del cultivo">
    <div className="esc-barra">
      <p className="esc-resumen" role="status">{filas ? <><strong>{recibiendo} de {filas.length}</strong> nodos recibiendo</> : 'Consultando los nodos…'}</p>
      <span className="pastilla-tono" data-tono={enVivo ? 'recibe' : 'inactivo'}><i aria-hidden="true" />{enVivo ? 'En vivo' : `Consulta cada ${cadaSegundos} s`}</span>
      <div className="esc-acciones">
        <button type="button" className="btn boton-secundario" disabled={!cultivoActual} onClick={() => setDialogo('parametros')}>Parámetros del cultivo</button>
        <button type="button" className="btn boton-secundario" disabled={!prefs} onClick={() => setDialogo('ajustes')}>Ajustes</button>
      </div>
    </div>
    {error && <p className="aviso error" role="alert">{error}</p>}

    {grupos.length > 4 && <div className="esc-cultivo-selector"><Selector id="esc-cultivo" etiqueta="Cultivo" valor={idActual} alCambiar={elegirCultivo} conBusqueda
      opciones={grupos.map(g => ({ valor: g.cultivo_id!, texto: nombreCorto(g.nombre), detalle: g.nodos.length + (g.nodos.length === 1 ? ' nodo' : ' nodos') + (climaDe(g)?.clima_evento ? ' · ' + EVENTOS_CLIMA[climaDe(g)!.clima_evento!].nombre : '') }))} /></div>}
    {grupos.length > 0 && grupos.length <= 4 && <fieldset className="grupo-opciones esc-cultivos"><legend>Cultivo</legend>
      {grupos.map(g => { const k = climaDe(g); return <label key={g.clave} className="opcion-ficha"><input type="radio" name="esc-cultivo" checked={g.cultivo_id === idActual} onChange={() => elegirCultivo(g.cultivo_id!)} />
        <span>{k?.clima_evento && <IconoClima evento={k.clima_evento} />}{nombreCorto(g.nombre)}</span></label>; })}
    </fieldset>}

    <form className="esc-clima" onSubmit={aplicarClima} aria-labelledby="esc-clima-titulo">
      <div className="esc-clima-cabecera">
        <h2 id="esc-clima-titulo">Clima simulado</h2>
        <p role="status" className="esc-clima-activo" data-clima={eventoActivo}><IconoClima evento={eventoActivo} />
          {activo?.clima_evento ? <>{EVENTOS_CLIMA[activo.clima_evento].nombre} · {INTENSIDADES[intensidadActiva]}{activo.clima_iniciado_en ? ' · desde ' + antiguedad(activo.clima_iniciado_en, ahora).toLowerCase() : ''}</> : 'Clima normal'}</p>
      </div>
      <fieldset className="grupo-opciones esc-eventos"><legend>Evento</legend>
        {EVENTOS.map(ev => <label key={ev} className="opcion-ficha opcion-evento"><input type="radio" name="esc-evento" checked={evento === ev} disabled={aplicando} onChange={() => setEvento(ev)} />
          <span><IconoClima evento={ev} />{EVENTOS_CLIMA[ev].nombre}</span></label>)}
      </fieldset>
      {evento !== 'normal' && <fieldset className="grupo-opciones"><legend>Intensidad</legend>
        {[1, 2, 3].map(i => <label key={i} className="opcion-ficha"><input type="radio" name="esc-intensidad" checked={intensidad === i} disabled={aplicando} onChange={() => setIntensidad(i)} /><span>{INTENSIDADES[i]}</span></label>)}
      </fieldset>}
      <p className="esc-efecto">{EVENTOS_CLIMA[evento].efecto}</p>
      <div className="esc-clima-pie">
        <label className="opcion-nodo"><input type="checkbox" checked={todos} disabled={aplicando} onChange={e => setTodos(e.target.checked)} />Aplicar a todos mis cultivos</label>
        <button className="btn boton-principal" disabled={aplicando || !idActual || sinCambio}>{aplicando ? 'Aplicando…' : evento === 'normal' ? 'Volver a clima normal' : 'Aplicar clima'}</button>
      </div>
      {errorClima && <p className="aviso error" role="alert">{errorClima}</p>}{avisoClima && <p className="aviso exito" role="status">{avisoClima}</p>}
      <p className="esc-nota">Evento de prueba. Cambia los nodos virtuales y proyecta su efecto sobre la lectura real del nodo físico como dato simulado: la lectura real no se modifica. Requiere el servicio de simulación en marcha.</p>
    </form>

    {idActual && <AjusteManual client={client} cultivoId={idActual} activos={ajustes.get(idActual) ?? SIN_AJUSTE} todosDefecto={prefs?.clima_alcance === 'todos'} alCambiar={() => setRefresco(r => r + 1)} />}

    <div className="escena-red" ref={lienzo}>{sinWebgl && <p className="aviso neutral">Este navegador no permite gráficos 3D (WebGL). La lista de abajo muestra el mismo estado.</p>}</div>
    <ul className="esc-leyenda" aria-label="Leyenda">
      <li><span className="pastilla-tono" data-tono="recibe"><i aria-hidden="true" />Recibiendo</span></li>
      <li><span className="pastilla-tono" data-tono="no_recibe"><i aria-hidden="true" />Sin recibir</span></li>
      <li><span className="pastilla-tono" data-tono="inactivo"><i aria-hidden="true" />En pausa o fuera de servicio</span></li>
    </ul>
    <p className="esc-nota">Cada cultivo se dibuja con la forma de su terreno, sus sectores y cada nodo en el punto donde está, a escala. El nodo alto con antena es el físico. Toca un nodo para ver qué datos envía, pausarlo o configurar su dispositivo. Los sectores y las ubicaciones se cambian en Cultivos, Terreno y sectores.</p>

    {(filas?.length ?? 0) > 4 && <div className="barra-filtros" role="search" aria-label="Filtrar nodos">
      <Buscador etiqueta="Buscar nodo" valor={qNodo} alCambiar={setQNodo} marcador="Código, cultivo o sector" />
      <Selector etiqueta="Cultivo" valor={panal?.grupos.some(g => g.clave === fGrupo) ? fGrupo : 'todos'} alCambiar={setFGrupo} opciones={[{ valor: 'todos', texto: 'Todos los cultivos' }, ...(panal?.grupos ?? []).map(g => ({ valor: g.clave, texto: nombreCorto(g.nombre), detalle: g.nodos.length + (g.nodos.length === 1 ? ' nodo' : ' nodos') }))]} />
      <Selector etiqueta="Estado" valor={fEstado} alCambiar={setFEstado} opciones={[{ valor: 'todos', texto: 'Cualquier estado' }, { valor: 'recibe', texto: 'Recibiendo' }, { valor: 'no_recibe', texto: 'Sin recibir' }, { valor: 'inactivo', texto: 'En pausa o fuera de servicio' }]} />
      <p className="filtro-cuenta" role="status">{gruposVisibles.reduce((t, g) => t + g.nodos.length, 0)} de {filas?.length}</p>
    </div>}
    {(filas?.length ?? 0) > 0 && !gruposVisibles.length && <div className="vacio"><h2>Ningún nodo coincide</h2><p>Cambia la búsqueda o los filtros para ver más nodos.</p>
      <button type="button" className="btn boton-principal" onClick={() => { setQNodo(''); setFEstado('todos'); setFGrupo('todos'); }}>Quitar filtros</button></div>}
    {gruposVisibles.map(g => <section className="esc-grupo" key={g.clave} aria-label={'Nodos de ' + nombreCorto(g.nombre)}>
      <h3>{nombreCorto(g.nombre)}<span>{g.total.filter(n => estadoConexion(n, ahora) === 'conectado').length} de {g.total.length} recibiendo</span></h3>
      <ul className="esc-nodos">{g.nodos.map(f => { const c = estadoConexion(f, ahora); return <li key={f.nodo_id}>
        <button type="button" className="ficha-nodo" data-tono={tonoConexion(c)} onClick={() => setSeleccion(f.nodo_id)} aria-label={`${f.codigo}, ${TEXTO_CONEXION[c]}. Ver detalle`}>
          <span className="pastilla-tono" data-tono={tonoConexion(c)}><i aria-hidden="true" />{TEXTO_CONEXION[c]}</span>
          <strong>{codigoCorto(f)}</strong>
          <span className="ficha-sub">{f.simulado ? 'Virtual' + (f.zona_nombre ? ' · ' + f.zona_nombre : '') : 'Físico'}</span>
          <span className="ficha-valores">{valor(f.temperatura, '°C')} · {valor(f.humedad, '% HR')}</span>
        </button></li>; })}</ul>
    </section>)}

    {filas && cultivos.some(c => !c.archivado_en && !grupos.some(g => g.cultivo_id === c.id)) && <p className="aviso neutral" role="status">
      Cultivos sin nodos todavía: {cultivos.filter(c => !c.archivado_en && !grupos.some(g => g.cultivo_id === c.id)).map(c => c.nombre).join(', ')}. Agrégales un nodo simulado desde Cultivos y aparecerán aquí con su propio hexágono.</p>}

    {elegido && <NodoDialogo key={elegido.nodo_id} client={client} nodo={elegido} ahora={ahora} alCambiar={() => setRefresco(r => r + 1)} alCerrar={() => setSeleccion('')} verHistorial={id => { setSeleccion(''); verHistorial(id); }} />}
    {dialogo === 'parametros' && cultivoActual && <ParametrosDialogo client={client} cultivo={cultivoActual} origenes={origenesCultivo(actual?.nodos ?? [])} alGuardar={alCambiarCultivo} alCerrar={() => setDialogo(null)} />}
    {dialogo === 'ajustes' && prefs && <Ajustes client={client} prefs={prefs} alGuardar={p => { setPrefs(p); setTodos(p.clima_alcance === 'todos'); }} alCerrar={() => setDialogo(null)} />}
  </section>;
}
