import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { configuracion, supabase } from './client.ts';
import { useAvisosAlertas } from './useAvisosAlertas.ts';
import { IconoClima } from './iconos-clima.tsx';
import NodosSimulados from './NodosSimulados.tsx';
import { Selector } from './Filtros.tsx';
import { CondicionesActivas, RegistroSimulacion } from './CondicionesSimuladas.tsx';
import { cargarContexto, cargarUltimoLote } from './data.ts';
import { antiguedad, esDht22, esAmbiental, estadoDatos, fechaBogota, origenesCultivo, origenNodo } from './domain.ts';
import type { Capacidad, Contexto, LecturaNodo, Nodo } from './types.ts';

const Alertas = lazy(() => import('./Alertas.tsx'));
const Dispositivos = lazy(() => import('./Dispositivos.tsx'));
const Cultivos = lazy(() => import('./Cultivos.tsx'));
const Zonas = lazy(() => import('./Zonas.tsx'));

const Historial = lazy(() => import('./Historial.tsx'));
const Sugerencias = lazy(() => import('./Sugerencias.tsx'));
const Escenario = lazy(() => import('./Escenario.tsx'));

function Marca() {
  return <span className="marca"><svg aria-hidden="true" viewBox="0 0 40 40"><path d="M31 7C15 5 5 13 9 25c4 12 22 8 22-18Z" /><path d="M10 31 26 14M15 24l-2-9m8 3 8-1" /></svg><span>Agro<span className="marca-fina">Vigía</span></span></span>;
}
function Configuracion() {
  return <main className="configuracion container py-5">
    <Marca /><h1>Prepara la conexión de la web</h1>
    <p>{!configuracion.lista ? configuracion.motivo : ''}</p>
    <p>Usa la <strong>Publishable key</strong> del proyecto, que empieza por <code>sb_publishable_</code>.
      La clave privada de n8n pertenece al servidor.</p>
    <p>Guarda el archivo y reinicia el servidor de desarrollo.</p>
  </main>;
}
function InicioSesion({ client }: { client: SupabaseClient }) {
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  async function entrar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(''); setOcupado(true);
    try {
      const r = await client.auth.signInWithPassword({ email: correo.trim(), password: clave });
      if (r.error) {
        setError(r.error.code === 'email_not_confirmed'
          ? 'La cuenta requiere confirmación. Consulta con el equipo.'
          : 'No pudimos iniciar sesión. Revisa tus datos y tu conexión.');
      } else setClave('');
    } catch {
      setError('No pudimos conectar. Comprueba tu conexión e inténtalo otra vez.');
    } finally { setOcupado(false); }
  }
  return <main className="acceso">
    <section className="acceso-relato">
      <Marca /><div className="relato-centro"><span className="sobre-titulo">MONITOREO AMBIENTAL</span>
        <p className="relato-titular">Tu cultivo,<br />con datos<br />a la vista.</p>
        <p>Consulta las condiciones del aire y la fecha de cada lectura para decidir con contexto.</p>
        <div className="variables-portada"><span>Temperatura del aire</span><span>Humedad del aire</span><span>Iluminacion relativa</span></div>
      </div><p className="nota-prototipo">Prototipo académico · Universidad de Cartagena</p>
    </section>
    <section className="acceso-formulario"><div className="formulario-interior">
      <span className="sobre-titulo">BIENVENIDO A AGROVIGÍA</span>
      <h1>Inicia sesión</h1><p className="texto-secundario">Accede a las lecturas de tu cultivo.</p>
      <form onSubmit={entrar} aria-busy={ocupado}>
        <label className="form-label" htmlFor="correo">Correo electrónico</label>
        <input id="correo" className="form-control" type="email" autoComplete="username"
          value={correo} onChange={e => setCorreo(e.target.value)} required disabled={ocupado} />
        <label className="form-label mt-4" htmlFor="clave">Contraseña</label>
        <input id="clave" className="form-control" type="password" autoComplete="current-password"
          value={clave} onChange={e => setClave(e.target.value)} required disabled={ocupado} />
        {error && <p className="aviso error mt-3" role="alert">{error}</p>}
        <button className="btn boton-principal w-100 mt-4" disabled={ocupado}>
          {ocupado ? 'Conectando…' : 'Entrar a mi cultivo'} <span aria-hidden="true">→</span>
        </button>
      </form>
      <p className="ayuda-acceso">Usa la cuenta que te asignó el equipo de AgroVigía.</p>
    </div></section>
  </main>;
}

function Lecturas({ client, cultivoId, nodos, capacidades, revision }: {
  client: SupabaseClient; cultivoId: string; nodos: Nodo[]; capacidades: Capacidad[]; revision: number;
}) {
  const dht = useMemo(() => nodos.filter(n => esDht22(n.id, capacidades) || esAmbiental(n.id, capacidades)), [nodos, capacidades]);
  const [lecturas, setLecturas] = useState<LecturaNodo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [consulta, setConsulta] = useState<string | null>(null);
  const [ahora, setAhora] = useState(Date.now());
  useEffect(() => {
    const reloj = window.setInterval(() => setAhora(Date.now()), 1000);
    return () => window.clearInterval(reloj);
  }, []);
  useEffect(() => {
    let activo = true; let pendiente = false;
    async function actualizar() {
      if (pendiente) return;
      pendiente = true;
      if (activo) setCargando(true);
      const respuestas = await Promise.all(dht.map(async nodo => {
        try {
          return { nodo, lote: await cargarUltimoLote(client, cultivoId, nodo.id, esAmbiental(nodo.id, capacidades), origenNodo(nodo)), error: null };
        } catch (e) {
          return { nodo, lote: null, error: e instanceof Error ? e.message : 'No se pudo consultar este nodo.' };
        }
      }));
      if (activo) {
        setLecturas(previas => respuestas.map(r => r.error
          ? { ...r, lote: previas.find(p => p.nodo.id === r.nodo.id)?.lote ?? null } : r));
        if (respuestas.every(r => !r.error)) setConsulta(new Date().toISOString());
        setCargando(false);
      }
      pendiente = false;
    }
    void actualizar();
    const intervalo = window.setInterval(() => { void actualizar(); }, 30_000);
    return () => { activo = false; window.clearInterval(intervalo); };
  }, [client, cultivoId, dht, capacidades, revision]);

  if (!nodos.length) return <div className="vacio"><h3>No hay nodos vinculados</h3>
    <p>Este cultivo todavía no tiene un nodo asignado.</p></div>;
  return <section aria-label="Lecturas del cultivo" aria-busy={cargando}>
    {dht.map(nodo => {
      const lectura = lecturas.find(l => l.nodo.id === nodo.id);
      const lote = lectura?.lote ?? null;
      const origen = origenNodo(nodo);
      const estado = estadoDatos(lote, ahora, origen);
      const textoEstado = lectura?.error ? 'Error de actualización' : !nodo.habilitado
        ? 'Nodo deshabilitado' : cargando && !lote ? 'Consultando datos…' : estado.texto;
      return <article className="panel-nodo" key={nodo.id}>
        <div className="cabecera-nodo"><div><span className="sobre-titulo">{nodo.simulado ? 'NODO SIMULADO · DHT22 + LDR' : esAmbiental(nodo.id, capacidades) ? 'NODO DHT22 + LDR' : 'NODO DHT22'}</span>
          <h3>{nodo.codigo}</h3></div>
          <span className={'estado ' + (lectura?.error ? 'revisar' : !nodo.habilitado ? 'neutral' : estado.clase)}>{textoEstado}</span>
        </div>
        {lectura?.error && <p className="aviso error" role="alert">{lectura.error}</p>}
        <div className="tarjetas-mediciones">
          <div className="medicion"><div className="titulo-medicion"><span className="simbolo temperatura" aria-hidden="true">°</span><h4>Temperatura del aire</h4></div>
            <div className="valor">{lote ? lote.temperatura.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 4 }) : '—'} <span>°C</span></div>
            <p>{lote ? 'Captura: ' + antiguedad(lote.tomadaEn, ahora) : `Aún no hay una lectura ${origen === 'simulado' ? 'simulada' : 'real'} disponible.`}</p>
          </div>
          <div className="medicion"><div className="titulo-medicion"><span className="simbolo humedad" aria-hidden="true">%</span><h4>Humedad del aire</h4></div>
            <div className="valor">{lote ? lote.humedad.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 4 }) : '—'} <span>% HR</span></div>
            <p>{lote ? 'Captura: ' + antiguedad(lote.tomadaEn, ahora) : `Aún no hay una lectura ${origen === 'simulado' ? 'simulada' : 'real'} disponible.`}</p>
          </div>
        </div>
        {esAmbiental(nodo.id, capacidades) && <div className="medicion medicion-luz">
          <div className="titulo-medicion"><span className="simbolo" aria-hidden="true"><IconoClima evento="sol_fuerte" /></span><h4>Iluminacion relativa</h4></div>
          <div className="valor">{lote?.iluminacion !== undefined ? lote.iluminacion.toLocaleString('es-CO', { minimumFractionDigits: 1 }) : '—'} <span>% relativo</span></div>
          <p>{lote?.iluminacion !== undefined ? 'Indice del ADC; no mide lux.' : 'Esta captura todavia no incluye el LDR.'}</p>
          {lote?.adcLdr !== undefined && <p>Lectura ADC: {lote.adcLdr} / 4095</p>}
          {lote?.adcLdr === 4095 && <p className="aviso advertencia">Limite superior del ADC: no distingue mas luz en esta captura.</p>}
          {lote?.adcLdr === 0 && <p className="aviso advertencia">Limite inferior del ADC; no equivale a una medicion de lux.</p>}
          <p className="texto-secundario">Las diferencias entre sensores requieren comprobarse antes de comparar ubicaciones.</p>
        </div>}
        {lote && <div className="detalle-captura">
          <div><span>Fecha de captura</span><strong>{fechaBogota(lote.tomadaEn)}</strong></div>
          <div><span>Recepción de aplicación · aprox.</span><strong>{fechaBogota(lote.recibidaEn)}</strong></div>
        </div>}
        {lote?.temperatura === 0 && lote.humedad === 0 &&
          <p className="aviso advertencia">El par 0 / 0 requiere revisión de la medición.</p>}
        {lote && <details className="identificacion"><summary>Identificación de la captura</summary>
          <p>Origen: {origen} · Nodo: {nodo.codigo}</p><code>{lote.mensajeId}</code></details>}
      </article>;
    })}
    {nodos.filter(n => n.tipo_nodo !== 'virtual' && !esDht22(n.id, capacidades) && !esAmbiental(n.id, capacidades)).map(n => <div className="aviso neutral" key={n.id}>
      <strong>{n.codigo}</strong><p>Las variables de este nodo todavía no están integradas en esta pantalla.</p>
    </div>)}
    <p className="pie-consulta" aria-live="polite">{cargando ? 'Actualizando lecturas…' : consulta
      ? 'Última consulta correcta: ' + fechaBogota(consulta) : 'Sin una consulta completa todavía.'}</p>
  </section>;
}

type Vista = 'monitoreo' | 'sugerencias' | 'red' | 'historial' | 'cultivos' | 'dispositivos' | 'alertas';
function Icono({ tipo }: { tipo: Vista | 'menu' | 'actualizar' }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{
    tipo === 'monitoreo' ? <path d="m3 10 9-7 9 7v11h-6v-7H9v7H3Z" /> :
    tipo === 'sugerencias' ? <path d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8ZM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9Z" /> :
    tipo === 'red' ? <><path d="M12 2.5 20.2 7.25v9.5L12 21.5 3.8 16.75v-9.5Z" /><circle cx="12" cy="12" r="2.2" /><path d="M12 9.8V4M13.9 13.1l4.9 2.8M10.1 13.1l-4.9 2.8" /></> :
    tipo === 'historial' ? <path d="M4 3v17h17M8 15l4-6 4 3 5-7" /> :
    tipo === 'alertas' ? <><path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5ZM10 21h4M12 2v2"/></> : tipo === 'dispositivos' ? <><rect x="6" y="3" width="12" height="18" rx="3"/><path d="M10 7h4M10 17h4M3 7h3m12 0h3M3 12h3m12 0h3M3 17h3m12 0h3"/></> : tipo === 'actualizar' ? <><path d="M3 12a9 9 0 0 1 15.7-6L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.7 6L3 16M3 21v-5h5"/></> : tipo === 'cultivos' ? <><path d="M12 22V11M12 14C3 15 2 8 3 5c6-1 10 2 9 9ZM12 11c-1-7 4-9 9-8 0 5-3 9-9 8Z" /></> : <path d="M3 6h18M3 12h18M3 18h18" />
  }</svg>;
}
export function Panel({ client, sesion }: { client: SupabaseClient; sesion: Session }) {
  const [contexto, setContexto] = useState<Contexto | null>(null);
  const [error, setError] = useState('');
  const [cultivoId, setCultivoId] = useState('');
  const [revision, setRevision] = useState(0);
  const [vista, setVista] = useState<Vista>('monitoreo');
  const [vistaMonitor, setVistaMonitor] = useState<'real' | 'zonas'>('real');
  const [menu, setMenu] = useState(false);
  const [saliendo, setSaliendo] = useState(false);
  const [revisionAvisos,setRevisionAvisos]=useState(0);
  const [aperturaAlertas,setAperturaAlertas]=useState(0);
  const avisos=useAvisosAlertas(client,contexto?contexto.cultivos.map(c=>c.id):null,revision+revisionAvisos);
  const numeroAvisos=avisos.resumen?.cantidad??0;
  const textoContador=avisos.error?'?':avisos.resumen?(numeroAvisos>99?'99+':String(numeroAvisos)):'…';
  function verPendientes(){if(avisos.resumen?.ultima)setCultivoId(avisos.resumen.ultima.cultivo_id);setVista('alertas');setMenu(false);setAperturaAlertas(v=>v+1);avisos.ocultar();}
  useEffect(() => {
    let activo = true;
    cargarContexto(client, sesion.user.id).then(datos => {
      if (!activo) return;
      setContexto(datos); setError('');
      setCultivoId(anterior => datos.cultivos.some(c => c.id === anterior) ? anterior : datos.cultivos.find(c => !c.archivado_en)?.id ?? datos.cultivos[0]?.id ?? '');
    }).catch(() => {
      if (activo) setError('No pudimos actualizar los datos de tu cuenta. Reintenta o vuelve a iniciar sesión.');
    });
    return () => { activo = false; };
  }, [client, sesion.user.id, revision]);
  useEffect(() => {
    if (!menu) return;
    const anterior = document.activeElement as HTMLElement | null;
    const panel = document.getElementById('menu-principal');
    const botones = () => Array.from(panel?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    botones()[0]?.focus();
    const cerrar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(false);
      if (e.key === 'Tab') {
        const lista = botones(); const primero = lista[0]; const ultimo = lista.at(-1);
        if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo?.focus(); }
        else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero?.focus(); }
      }
    };
    window.addEventListener('keydown',cerrar);
    return () => { window.removeEventListener('keydown',cerrar); anterior?.focus(); };
  }, [menu]);
  const seleccionables = contexto?.cultivos.filter(c => vista === 'historial' || vista === 'alertas' || vista === 'sugerencias' || !c.archivado_en) ?? [];
  const seleccionado = seleccionables.find(c => c.id === cultivoId) ?? seleccionables[0];
  const idActual = seleccionado?.id ?? '';
  const nodos = useMemo(() => contexto?.nodos.filter(n => n.cultivo_id === idActual) ?? [], [contexto, idActual]);
  // Un hexagono mixto (fisico + simulados) muestra alertas y sugerencias de un origen a la vez, sin mezclarlos.
  const origenes = origenesCultivo(nodos);
  const [origenPreferido, setOrigenPreferido] = useState<'real' | 'simulado'>('real');
  const origen = origenes.includes(origenPreferido) ? origenPreferido : origenes[0] ?? 'real';
  const mixto = origenes.length > 1;
  function navegar(v: Vista) { setVista(v); setMenu(false); }
  function abrir(id: string, historial: boolean) { setCultivoId(id); navegar(historial ? 'historial' : 'monitoreo'); }
  async function salir() {
    setSaliendo(true);
    try {
      const respuesta = await client.auth.signOut({ scope: 'local' });
      if (respuesta.error) setError('No pudimos cerrar la sesión. Inténtalo otra vez.');
    } catch { setError('No pudimos cerrar la sesión. Inténtalo otra vez.'); }
    finally { setSaliendo(false); }
  }
  const titulos = { monitoreo:'Panel', sugerencias:'Sugerencias IA', red:'Escenario', historial:'Historial y estadísticas', cultivos:'Mis cultivos', dispositivos:'Mis dispositivos', alertas:'Alertas' };
  const opciones: {vista:Vista;texto:string}[] = [{vista:'monitoreo',texto:'Inicio'},{vista:'sugerencias',texto:'IA'},{vista:'red',texto:'Escenario'},{vista:'alertas',texto:'Alertas'},{vista:'historial',texto:'Historial'},{vista:'cultivos',texto:'Cultivos'},{vista:'dispositivos',texto:'Dispositivos'}];
  return <div className="aplicacion">
    {menu && <button className="fondo-menu" aria-label="Cerrar menú" onClick={() => setMenu(false)} />}
    <aside id="menu-principal" className={'barra-lateral' + (menu ? ' abierta' : '')}>
      <Marca /><button className="cerrar-menu" aria-label="Cerrar navegación" onClick={() => setMenu(false)}>×</button>
      <nav className="navegacion" aria-label="Secciones">{opciones.map(o =>
        <button key={o.vista} className={'menu-opcion' + (vista === o.vista ? ' seleccionada' : '')} aria-current={vista === o.vista ? 'page' : undefined} onClick={() => navegar(o.vista)}><span className="icono-con-contador"><Icono tipo={o.vista}/>{o.vista==='alertas'&&(numeroAvisos>0||avisos.error)&&<span className={'contador-alertas'+(avisos.error?' incierto':'')} aria-hidden="true">{textoContador}</span>}</span>{o.texto}</button>)}
      </nav>
      <div className="cuenta"><span className="sobre-titulo">TU CUENTA</span>
        <strong>{contexto?.nombre ?? 'AgroVigía'}</strong><span className="correo-cuenta">{sesion.user.email}</span>
        <button className="boton-salir" onClick={() => { void salir(); }} disabled={saliendo}>{saliendo ? 'Cerrando…' : 'Cerrar sesión'}</button></div>
    </aside>
    <nav className="navegacion-movil" aria-label="Navegación móvil">{opciones.map(o => <button key={o.vista} aria-current={vista === o.vista ? 'page' : undefined} onClick={() => navegar(o.vista)}><span className="icono-con-contador"><Icono tipo={o.vista}/>{o.vista==='alertas'&&(numeroAvisos>0||avisos.error)&&<span className={'contador-alertas'+(avisos.error?' incierto':'')} aria-hidden="true">{textoContador}</span>}</span><span>{o.texto}</span></button>)}</nav>
    <main className="contenido"><header className="encabezado">
      <div className="titulo-pagina"><button className="abrir-menu" aria-label="Abrir menú" aria-expanded={menu} aria-controls="menu-principal" onClick={() => setMenu(!menu)}><Icono tipo="menu"/></button>
        <div><span className="sobre-titulo">AGROVIGÍA</span><h1>{titulos[vista]}</h1></div></div>
      <div className="acciones-encabezado"><button className="campana-alertas" aria-label="Ver alertas pendientes" aria-describedby="estado-contador-alertas" title="Alertas reales activas sin revisar de todos tus cultivos" onClick={verPendientes}><Icono tipo="alertas"/><span className={'contador-alertas'+(avisos.error?' incierto':'')} aria-hidden="true">{textoContador}</span></button><button className="btn boton-secundario boton-actualizar" onClick={() => setRevision(v => v + 1)}><Icono tipo="actualizar"/><span>{vista === 'monitoreo' ? 'Actualizar' : 'Actualizar cuenta'}</span></button></div>
    </header>
    <p className="descripcion-vista">{vista === 'monitoreo' ? 'Consulta las lecturas reales o explora los puntos del cultivo por zona.' : vista === 'sugerencias' ? 'Recomendaciones de la IA a partir de tus lecturas, la plantilla y las alertas.' : vista === 'red' ? 'Tus nodos en vivo, el clima simulado y la configuración de cada dispositivo, en un solo lugar.' : vista === 'historial' ? 'Explora las mediciones guardadas de cada nodo y compáralas con la plantilla del cultivo.' : vista === 'cultivos' ? 'Organiza tus lotes y los dispositivos asignados.' : vista === 'alertas' ? 'Configura tus límites y consulta las condiciones detectadas.' : 'Consulta tus sensores y su asignación a los cultivos.'}</p>
    {vista === 'monitoreo' && <div className="vistas-monitoreo" role="group" aria-label="Vista del monitoreo"><button aria-pressed={vistaMonitor === 'real'} onClick={() => setVistaMonitor('real')}>Lecturas reales</button><button aria-pressed={vistaMonitor === 'zonas'} onClick={() => setVistaMonitor('zonas')}>Zonas y nodos</button></div>}
    {(vista === 'historial' || (vista === 'monitoreo' && vistaMonitor === 'real')) && <div className="linea-contexto"><span className={'etiqueta-origen' + (vista === 'historial' && mixto ? ' mixto' : vista === 'historial' && origen === 'simulado' ? ' simulado' : '')}>{vista === 'historial' && mixto ? 'Datos reales y simulados' : vista === 'historial' && origen === 'simulado' ? 'Datos simulados' : 'Datos reales'}</span><span>{vista === 'monitoreo' ? 'Consulta automática cada 30 s' : 'Historial bajo consulta'}</span></div>}
    <p id="estado-contador-alertas" className="visually-hidden" role="status">{avisos.error?'Contador de alertas sin actualizar.':avisos.resumen?`${numeroAvisos} alertas reales activas sin revisar en tus cultivos.`:'Consultando alertas pendientes.'}</p>
    {avisos.error&&<p className="contador-sin-actualizar" role="status">No pudimos actualizar el contador de alertas. Reintenta con Actualizar cuenta.</p>}
    {avisos.aviso&&!avisos.error&&<aside className="notificacion-alertas" aria-label="Aviso de alertas pendientes"><div role="status"><strong>{avisos.aviso.cantidad===1?'Tienes una alerta pendiente':`Tienes ${avisos.aviso.cantidad} alertas pendientes`}</strong><p>Activas y sin revisar en tus cultivos.</p></div><button className="btn boton-principal" onClick={verPendientes}>Ver alertas</button><button className="cerrar-aviso" aria-label="Ocultar aviso" onClick={avisos.ocultar}>×</button></aside>}
    {error && <div className="aviso error" role="alert">{error}<button className="enlace-boton" onClick={() => setRevision(v => v + 1)}>Reintentar</button></div>}
    {!contexto && !error && <p className="vacio" role="status">Consultando tus cultivos…</p>}
    {contexto && (vista === 'red' ? <Suspense fallback={<p role="status">Cargando el escenario…</p>}><Escenario client={client} cultivos={contexto.cultivos} cultivoId={idActual} elegirCultivo={setCultivoId} verHistorial={id => abrir(id, true)} alCambiarCultivo={() => setRevision(v => v + 1)}/></Suspense> : vista === 'dispositivos' ? <Suspense fallback={<p role="status">Cargando dispositivos…</p>}><Dispositivos client={client} contexto={contexto} revision={revision} actualizado={() => setRevision(v => v + 1)}/></Suspense> : vista === 'cultivos' ? <Suspense fallback={<p role="status">Cargando tus cultivos…</p>}><Cultivos client={client} contexto={contexto} actualizado={() => setRevision(v => v + 1)} abrir={abrir}/></Suspense> : <>
      {!seleccionado && <section className="vacio"><h2>{vista === 'monitoreo' ? 'No tienes cultivos activos' : 'Aún no tienes cultivos'}</h2><p>Puedes gestionar tus cultivos y dispositivos disponibles desde Mis cultivos.</p><button className="btn boton-principal" onClick={() => navegar('cultivos')}>Ir a Mis cultivos</button></section>}
      {seleccionado && <>
        <section className="selector-cultivo"><div><Selector id="cultivo" etiqueta="CULTIVO SELECCIONADO" claseEtiqueta="sobre-titulo" valor={idActual} alCambiar={setCultivoId} opciones={seleccionables.map(c => ({ valor: c.id, texto: c.nombre + (c.archivado_en ? ' (archivado)' : ''), detalle: c.tipo }))} />
        </div><p>{seleccionado.tipo} · {Number(seleccionado.area).toLocaleString('es-CO')} {seleccionado.unidad_area === 'm2' ? 'm²' : seleccionado.unidad_area}</p></section>
        {seleccionado.archivado_en && <p className="aviso neutral">Cultivo archivado. Se conserva su historial; no recibe nuevas mediciones.</p>}
        {mixto && (vista === 'alertas' || vista === 'sugerencias') && <div className="selector-origen" role="group" aria-label="Origen de los datos">
          <span>Este cultivo tiene nodos físicos y simulados. Ver:</span>
          {origenes.map(o => <button key={o} type="button" className={'btn ' + (o === origen ? 'boton-principal' : 'boton-secundario')} aria-pressed={o === origen} onClick={() => setOrigenPreferido(o)}>{o === 'real' ? 'Datos reales' : 'Datos simulados'}</button>)}
        </div>}
        {vista === 'alertas' ? <><CondicionesActivas client={client} cultivo={seleccionado} revision={revision} verEscenario={() => navegar('red')} /><Suspense fallback={<p role="status">Cargando alertas…</p>}><Alertas key={'alertas:' + sesion.user.id + ':' + idActual + ':' + origen + ':' + aperturaAlertas} client={client} cultivo={seleccionado} nodos={contexto.nodos} revision={revision} onCambio={() => setRevisionAvisos(v=>v+1)} origen={origen} onPlantilla={() => setRevision(v => v + 1)}/></Suspense></> : vista === 'sugerencias' ? <Suspense fallback={<p role="status">Cargando sugerencias…</p>}><Sugerencias key={'ia:' + sesion.user.id + ':' + idActual + ':' + origen} client={client} cultivo={seleccionado} origen={origen} revision={revision}/></Suspense> : vista === 'monitoreo' ? vistaMonitor === 'zonas' ? <Suspense fallback={<p role="status">Cargando zonas.</p>}><Zonas key={'zonas:' + sesion.user.id + ':' + idActual} client={client} cultivoId={idActual} usuarioId={sesion.user.id} revision={revision}/></Suspense> : <><Lecturas key={'monitor:' + sesion.user.id + ':' + idActual} client={client} cultivoId={idActual} nodos={nodos} capacidades={contexto.capacidades} revision={revision}/>{nodos.some(n => n.tipo_nodo === 'virtual') && <NodosSimulados key={'sim:' + idActual} client={client} cultivoId={idActual} revision={revision} verEscenario={() => navegar('red')} />}</>
          : <><Suspense fallback={<p role="status">Cargando el historial…</p>}><Historial key={'historial:' + sesion.user.id + ':' + idActual} client={client} cultivoId={idActual} nodos={contexto.nodos} capacidades={contexto.capacidades} plantillaCodigo={seleccionado.plantilla_codigo ?? null}/></Suspense><RegistroSimulacion client={client} cultivoId={idActual} revision={revision} /></>}
      </>}
    </>)}
    <footer className="pie-app">AgroVigía · Prototipo académico <span>Fechas en hora de Colombia</span></footer>
    </main>
  </div>;
}

function AplicacionAutenticada({ client }: { client: SupabaseClient }) {
  const [sesion, setSesion] = useState<Session | null>(null);
  const [iniciando, setIniciando] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let activo = true; let eventoRecibido = false;
    const { data } = client.auth.onAuthStateChange((_evento, nueva) => {
      eventoRecibido = true;
      if (activo) { setSesion(nueva); setIniciando(false); setError(''); }
    });
    client.auth.getSession().then(respuesta => {
      if (!activo || eventoRecibido) return;
      setSesion(respuesta.data.session); setIniciando(false);
      if (respuesta.error) setError('No pudimos recuperar tu sesión.');
    }).catch(() => {
      if (activo && !eventoRecibido) { setError('No pudimos recuperar tu sesión.'); setIniciando(false); }
    });
    return () => { activo = false; data.subscription.unsubscribe(); };
  }, [client]);
  if (iniciando) return <main className="pantalla-cargando" role="status"><Marca /><p>Preparando tu sesión…</p></main>;
  if (sesion) return <Panel key={sesion.user.id} client={client} sesion={sesion} />;
  return <>{error && <p className="aviso error" role="alert">{error}</p>}<InicioSesion client={client} /></>;
}

export default function App() {
  return supabase ? <AplicacionAutenticada client={supabase} /> : <Configuracion />;
}
