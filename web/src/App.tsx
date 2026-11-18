import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { configuracion, supabase } from './client.ts';
import { useAvisosAlertas } from './useAvisosAlertas.ts';
import { Selector } from './Filtros.tsx';
import { CondicionesActivas, RegistroSimulacion } from './CondicionesSimuladas.tsx';
import { cargarContexto } from './data.ts';
import { origenesCultivo } from './domain.ts';
import type { Contexto, Origen } from './types.ts';
import Inicio from './Inicio.tsx';

const Alertas = lazy(() => import('./Alertas.tsx'));
const Dispositivos = lazy(() => import('./Dispositivos.tsx'));
const Cultivos = lazy(() => import('./Cultivos.tsx'));

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
        <div className="variables-portada"><span>Temperatura del aire</span><span>Humedad del aire</span><span>Iluminación relativa</span></div>
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
  // Nodo con el que se abre el Historial desde el detalle de nodo de Inicio.
  const [nodoHistorial, setNodoHistorial] = useState('');
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
    // Solo los botones visibles: en el telefono el grupo principal del menu esta oculto (ya va en la barra inferior).
    const botones = () => Array.from(panel?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []).filter(b => b.offsetParent !== null);
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
  function navegar(v: Vista) { setVista(v); setMenu(false); if (v !== 'historial') setNodoHistorial(''); }
  // Desde Inicio: abre Alertas o Sugerencias ya en el origen (real o simulado) de lo que se tocó.
  function irConOrigen(v: 'alertas' | 'sugerencias', o: Origen) { setOrigenPreferido(o); navegar(v); }
  function abrir(id: string, historial: boolean) { setCultivoId(id); navegar(historial ? 'historial' : 'monitoreo'); }
  async function salir() {
    setSaliendo(true);
    try {
      const respuesta = await client.auth.signOut({ scope: 'local' });
      if (respuesta.error) setError('No pudimos cerrar la sesión. Inténtalo otra vez.');
    } catch { setError('No pudimos cerrar la sesión. Inténtalo otra vez.'); }
    finally { setSaliendo(false); }
  }
  const titulos = { monitoreo:'Inicio', sugerencias:'Sugerencias', red:'Simulación', historial:'Historial y estadísticas', cultivos:'Mis cultivos', dispositivos:'Mis dispositivos', alertas:'Alertas' };
  // Lo de uso diario va en la barra inferior del telefono; la configuracion, en Mas (en escritorio, en su propio grupo).
  const principales: {vista:Vista;texto:string}[] = [{vista:'monitoreo',texto:'Inicio'},{vista:'alertas',texto:'Alertas'},{vista:'sugerencias',texto:'Sugerencias'},{vista:'historial',texto:'Historial'}];
  const configuracion: {vista:Vista;texto:string}[] = [{vista:'cultivos',texto:'Cultivos'},{vista:'dispositivos',texto:'Dispositivos'},{vista:'red',texto:'Simulación'}];
  const enMas = configuracion.some(o => o.vista === vista);
  const contador = (v: Vista) => v === 'alertas' && (numeroAvisos > 0 || avisos.error)
    ? <span className={'contador-alertas'+(avisos.error?' incierto':'')} aria-hidden="true">{textoContador}</span> : null;
  const opcion = (o: {vista:Vista;texto:string}) => <button key={o.vista} className={'menu-opcion' + (vista === o.vista ? ' seleccionada' : '')} aria-current={vista === o.vista ? 'page' : undefined}
    aria-describedby={o.vista === 'alertas' ? 'estado-contador-alertas' : undefined} onClick={() => navegar(o.vista)}><span className="icono-con-contador"><Icono tipo={o.vista}/>{contador(o.vista)}</span>{o.texto}</button>;
  return <div className="aplicacion">
    {menu && <button className="fondo-menu" aria-label="Cerrar menú" onClick={() => setMenu(false)} />}
    <aside id="menu-principal" className={'barra-lateral' + (menu ? ' abierta' : '')}>
      <Marca /><button className="cerrar-menu" aria-label="Cerrar navegación" onClick={() => setMenu(false)}>×</button>
      <nav className="navegacion" aria-label="Secciones">
        <div className="grupo-principal">{principales.map(opcion)}</div>
        <p className="titulo-grupo-menu" id="titulo-configuracion">Configuración</p>
        <div className="grupo-configuracion" role="group" aria-labelledby="titulo-configuracion">{configuracion.map(opcion)}</div>
      </nav>
      <div className="cuenta"><span className="sobre-titulo">TU CUENTA</span>
        <strong>{contexto?.nombre ?? 'AgroVigía'}</strong><span className="correo-cuenta">{sesion.user.email}</span>
        <button className="boton-salir" onClick={() => { void salir(); }} disabled={saliendo}>{saliendo ? 'Cerrando…' : 'Cerrar sesión'}</button></div>
    </aside>
    <nav className="navegacion-movil" aria-label="Navegación móvil">
      {principales.map(o => <button key={o.vista} aria-current={vista === o.vista ? 'page' : undefined} aria-describedby={o.vista === 'alertas' ? 'estado-contador-alertas' : undefined} onClick={() => navegar(o.vista)}>
        <span className="icono-con-contador"><Icono tipo={o.vista}/>{contador(o.vista)}</span><span className="etiqueta-nav">{o.texto}</span></button>)}
      <button className={enMas ? 'activa' : undefined} aria-expanded={menu} aria-controls="menu-principal" onClick={() => setMenu(!menu)}>
        <span className="icono-con-contador"><Icono tipo="menu"/></span><span className="etiqueta-nav">Más</span>{enMas && <span className="visually-hidden">, sección actual: {titulos[vista]}</span>}</button>
    </nav>
    <main className="contenido"><header className="encabezado">
      <div className="titulo-pagina"><div><span className="sobre-titulo">AGROVIGÍA</span><h1>{titulos[vista]}</h1></div></div>
      <div className="acciones-encabezado"><button className="btn boton-secundario boton-actualizar" onClick={() => setRevision(v => v + 1)}><Icono tipo="actualizar"/><span>{vista === 'monitoreo' ? 'Actualizar' : 'Actualizar cuenta'}</span></button></div>
    </header>
    {vista === 'historial' && <div className="linea-contexto"><span className={'etiqueta-origen' + (mixto ? ' mixto' : origen === 'simulado' ? ' simulado' : '')}>{mixto ? 'Datos reales y simulados' : origen === 'simulado' ? 'Datos simulados' : 'Datos reales'}</span><span>Historial bajo consulta</span></div>}
    <p id="estado-contador-alertas" className="visually-hidden" role="status">{avisos.error?'Contador de alertas sin actualizar.':avisos.resumen?`${numeroAvisos} alertas reales activas sin revisar en tus cultivos.`:'Consultando alertas pendientes.'}</p>
    {avisos.error&&<p className="contador-sin-actualizar" role="status">No pudimos actualizar el contador de alertas. Reintenta con Actualizar cuenta.</p>}
    {/* En Inicio lo dice el resumen de atención y en Alertas ya se está mirando: el aviso flotante sobraría. */}
    {avisos.aviso&&!avisos.error&&vista!=='monitoreo'&&vista!=='alertas'&&<aside className="notificacion-alertas" aria-label="Aviso de alertas pendientes"><div role="status"><strong>{avisos.aviso.cantidad===1?'Tienes una alerta pendiente':`Tienes ${avisos.aviso.cantidad} alertas pendientes`}</strong><p>Activas y sin revisar, con datos reales, en tus cultivos.</p></div><button className="btn boton-principal" onClick={verPendientes}>Ver alertas</button><button className="cerrar-aviso" aria-label="Ocultar aviso" onClick={avisos.ocultar}>×</button></aside>}
    {error && <div className="aviso error" role="alert">{error}<button className="enlace-boton" onClick={() => setRevision(v => v + 1)}>Reintentar</button></div>}
    {!contexto && !error && <p className="vacio" role="status">Consultando tus cultivos…</p>}
    {contexto && (vista === 'red' ? <Suspense fallback={<p role="status">Cargando la simulación…</p>}><Escenario client={client} cultivos={contexto.cultivos} cultivoId={idActual} elegirCultivo={setCultivoId} verHistorial={id => abrir(id, true)} alCambiarCultivo={() => setRevision(v => v + 1)}/></Suspense> : vista === 'dispositivos' ? <Suspense fallback={<p role="status">Cargando dispositivos…</p>}><Dispositivos client={client} contexto={contexto} revision={revision} actualizado={() => setRevision(v => v + 1)}/></Suspense> : vista === 'cultivos' ? <Suspense fallback={<p role="status">Cargando tus cultivos…</p>}><Cultivos client={client} contexto={contexto} actualizado={() => setRevision(v => v + 1)} abrir={abrir}/></Suspense> : <>
      {!seleccionado && <section className="vacio"><h2>{vista === 'monitoreo' ? 'No tienes cultivos activos' : 'Aún no tienes cultivos'}</h2><p>Puedes gestionar tus cultivos y dispositivos disponibles desde Mis cultivos.</p><button className="btn boton-principal" onClick={() => navegar('cultivos')}>Ir a Mis cultivos</button></section>}
      {seleccionado && <>
        <section className="selector-cultivo"><div><Selector id="cultivo" etiqueta="CULTIVO SELECCIONADO" claseEtiqueta="sobre-titulo" valor={idActual} alCambiar={setCultivoId} opciones={seleccionables.map(c => ({ valor: c.id, texto: c.nombre + (c.archivado_en ? ' (archivado)' : ''), detalle: c.tipo }))} />
        </div><p>{seleccionado.tipo} · {Number(seleccionado.area).toLocaleString('es-CO')} {seleccionado.unidad_area === 'm2' ? 'm²' : seleccionado.unidad_area}</p></section>
        {seleccionado.archivado_en && <p className="aviso neutral">Cultivo archivado. Se conserva su historial; no recibe nuevas mediciones.</p>}
        {mixto && (vista === 'alertas' || vista === 'sugerencias') && <div className="selector-origen" role="group" aria-label="Origen de los datos">
          <span>Este cultivo tiene nodos físicos y simulados. Ver:</span>
          {origenes.map(o => <button key={o} type="button" className={'btn ' + (o === origen ? 'boton-principal' : 'boton-secundario')} aria-pressed={o === origen} onClick={() => setOrigenPreferido(o)}>{o === 'real' ? 'Datos reales' : 'Datos simulados'}</button>)}
        </div>}
        {vista === 'alertas' ? <><CondicionesActivas client={client} cultivo={seleccionado} revision={revision} verEscenario={() => navegar('red')} /><Suspense fallback={<p role="status">Cargando alertas…</p>}><Alertas key={'alertas:' + sesion.user.id + ':' + idActual + ':' + origen + ':' + aperturaAlertas} client={client} cultivo={seleccionado} nodos={contexto.nodos} revision={revision} onCambio={() => setRevisionAvisos(v=>v+1)} origen={origen} onPlantilla={() => setRevision(v => v + 1)}/></Suspense></> : vista === 'sugerencias' ? <Suspense fallback={<p role="status">Cargando sugerencias…</p>}><Sugerencias key={'ia:' + sesion.user.id + ':' + idActual + ':' + origen} client={client} cultivo={seleccionado} origen={origen} revision={revision}/></Suspense> : vista === 'monitoreo' ? <Inicio key={'inicio:' + sesion.user.id + ':' + idActual} client={client} cultivo={seleccionado} usuarioId={sesion.user.id} revision={revision}
            verAlertas={o => irConOrigen('alertas', o)} verSugerencias={o => irConOrigen('sugerencias', o)}
            verHistorial={id => { navegar('historial'); setNodoHistorial(id); }} verDispositivos={() => navegar('dispositivos')} />
          : <><Suspense fallback={<p role="status">Cargando el historial…</p>}><Historial key={'historial:' + sesion.user.id + ':' + idActual + ':' + nodoHistorial} client={client} cultivoId={idActual} nodos={contexto.nodos} capacidades={contexto.capacidades} plantillaCodigo={seleccionado.plantilla_codigo ?? null} nodoInicial={nodoHistorial}/></Suspense><RegistroSimulacion client={client} cultivoId={idActual} revision={revision} /></>}
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
