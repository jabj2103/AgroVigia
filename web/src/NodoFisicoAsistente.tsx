// Asistente para poner en marcha un nodo fisico sin recompilar: registrarlo con su clave, cargarle el
// firmware desde el navegador y enviarle por USB el Wi-Fi, el servidor y la clave. Todo lo del cable
// necesita Chrome o Edge en un computador. El firmware compila, pero no se ha probado en una placa real.
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Dialogo } from './Dialogo.tsx';
import { PlacaSerie, placaSimulada, regenerarClaveNodo, registrarNodoFisico, serieDisponible, textoErrorPlaca, validarConfig } from './nodo-fisico-data.ts';
import type { InfoPlaca } from './nodo-fisico-data.ts';
import type { Nodo } from './types.ts';

const URL_DEFECTO = (import.meta.env.VITE_AGROVIGIA_NODO_URL as string | undefined) ?? '';
const WIFI: Record<string, string> = { conectado: 'Conectada al Wi-Fi', desconectado: 'Sin conexión Wi-Fi', sin_configurar: 'Sin configurar' };

export default function NodoFisicoAsistente({ client, nodo: inicial, alCambiar, alCerrar }: { client: SupabaseClient; nodo?: Nodo; alCambiar: () => void; alCerrar: () => void }) {
  const [nodo, setNodo] = useState<Nodo | null>(inicial ?? null), [clave, setClave] = useState('');
  const [ocupado, setOcupado] = useState(false), [error, setError] = useState(''), [aviso, setAviso] = useState('');
  const [info, setInfo] = useState<InfoPlaca | null>(null), [lectura, setLectura] = useState('');
  const [wifi, setWifi] = useState(''), [wifiClave, setWifiClave] = useState(''), [url, setUrl] = useState(URL_DEFECTO), [intervalo, setIntervalo] = useState('60');
  const placa = useRef<PlacaSerie | null>(null), boton = useRef<HTMLDivElement>(null), usb = serieDisponible(), demo = placaSimulada();
  useEffect(() => () => { void placa.current?.cerrar(); }, []);
  // El instalador de firmware es un componente web aparte: se carga solo cuando hace falta.
  useEffect(() => { if (usb && nodo && !demo) void import('esp-web-tools/dist/install-button.js').catch(() => undefined); }, [usb, nodo, demo]);

  function tarea(p: Promise<string | void>) {
    if (ocupado) return; setOcupado(true); setError(''); setAviso('');
    p.then(m => { if (m) setAviso(m); }).catch(e => setError(e instanceof Error ? e.message : 'No pudimos completar el paso.')).finally(() => setOcupado(false));
  }
  const registrar = () => tarea(registrarNodoFisico(client, 'esp32').then(r => { setNodo(r.nodo); setClave(r.clave); alCambiar(); return `Nodo ${r.nodo.codigo} registrado. Su clave se muestra una sola vez: llega a la placa en el paso 3.`; }));
  const nuevaClave = () => { if (nodo) tarea(regenerarClaveNodo(client, nodo.id).then(k => { setClave(k); return 'Clave nueva generada. La anterior dejó de servir: envíala a la placa en el paso 3.'; })); };
  async function conectar() {
    setInfo(null);
    setLectura('');
    const anterior = placa.current;
    placa.current = null;
    await anterior?.cerrar();
    placa.current = await PlacaSerie.conectar();
    const r = await ordenar({ cmd: 'info' }) as unknown as InfoPlaca;
    setInfo(r); if (r.wifi_ssid && !wifi) setWifi(r.wifi_ssid); if (r.url && !url) setUrl(r.url);
    return `Placa conectada: firmware ${r.fw ?? 'desconocido'} ${r.version ?? ''}.`;
  }
  async function ordenar(o: Record<string, unknown>, espera?: number) {
    const conexion = placa.current;
    if (!conexion) throw new Error('Conecta primero la placa por USB.');
    let r;
    try { r = await conexion.orden(o, espera); }
    catch (error) {
      if (!conexion.conectada && placa.current === conexion) {
        placa.current = null;
        setInfo(null);
        setLectura('');
      }
      throw error;
    }
    if (r.ok !== true && o.cmd !== 'enviar') throw new Error(textoErrorPlaca(typeof r.error === 'string' ? r.error : undefined));
    return r;
  }
  function configurar(e: FormEvent) {
    e.preventDefault(); if (!nodo) return;
    const c = { wifi_ssid: wifi.trim(), wifi_clave: wifiClave, url: url.trim(), codigo: nodo.codigo, clave, intervalo: Number(intervalo) };
    const problema = !clave ? 'Genera primero una clave para este nodo: la anterior no se puede volver a mostrar.' : validarConfig(c);
    if (problema) { setError(problema); return; }
    tarea(ordenar({ cmd: 'config', ...c }).then(async () => { setWifiClave(''); setInfo(await ordenar({ cmd: 'info' }) as unknown as InfoPlaca); return 'Configuración guardada en la placa. Se conecta al Wi-Fi y empieza a enviar.'; }));
  }
  const leer = () => tarea(ordenar({ cmd: 'leer' }).then(r => { setLectura([typeof r.temperatura === 'number' ? `${r.temperatura} °C` : '', typeof r.humedad === 'number' ? `${r.humedad} % HR` : '', typeof r.iluminacion === 'number' ? `luz ${r.iluminacion} %` : ''].filter(Boolean).join(' · ')); return 'Lectura tomada de los sensores, sin enviarla.'; }));
  const enviar = () => tarea(ordenar({ cmd: 'enviar' }, 50_000).then(async r => { setInfo(await ordenar({ cmd: 'info' }) as unknown as InfoPlaca);
    if (r.ok !== true) throw new Error(`El envío no se aceptó (${String(r.error ?? r.estado ?? 'sin detalle')}). Revisa el Wi-Fi, la dirección del servidor y la clave.`);
    return 'El servidor aceptó el lote. El nodo ya puede vincularse a un cultivo.'; }));

  return <Dialogo titulo={inicial ? 'Configurar ' + inicial.codigo : 'Registrar nodo físico'} alCerrar={alCerrar}
    detalle="ESP32 con DHT22 (temperatura y humedad del aire) y LDR (índice de luz).">
    {error && <p className="aviso error" role="alert">{error}</p>}{aviso && <p className="aviso exito" role="status">{aviso}</p>}
    <p className="aviso advertencia">Este firmware compila pero todavía no se ha probado en una placa real. Úsalo como prueba y revisa el resultado en Dispositivos.</p>

    <section className="dlg-seccion asistente-paso" aria-label="Paso 1: registro"><h3>1. Registro y clave</h3>
      {!nodo ? <><p className="dlg-nota">Se crea el nodo en tu cuenta con un código y una clave propia. Con esa clave la placa demuestra quién es al enviar sus datos.</p>
        <div className="dlg-acciones"><button type="button" className="btn boton-principal" disabled={ocupado} onClick={registrar}>{ocupado ? 'Registrando…' : 'Registrar nodo'}</button></div></>
        : <><dl className="dlg-datos"><div><dt>Código del nodo</dt><dd>{nodo.codigo}</dd></div><div><dt>Clave</dt><dd>{clave ? 'Lista para enviar' : 'No disponible'}</dd></div></dl>
          {clave ? <p className="dlg-nota">La clave no se muestra ni se guarda en el navegador. Si cierras esta ventana antes del paso 3 tendrás que generar otra.</p>
            : <p className="dlg-nota">La clave de este nodo solo se pudo ver al crearla. Para configurar la placa genera una nueva: la anterior deja de servir.</p>}
          <div className="dlg-acciones"><button type="button" className="btn boton-secundario" disabled={ocupado} onClick={nuevaClave}>Generar clave nueva</button></div></>}
    </section>

    {nodo && <section className="dlg-seccion asistente-paso" aria-label="Paso 2: firmware"><h3>2. Cargar el firmware</h3>
      {demo ? <p className="aviso neutral">Estás en la demo: aquí la placa es simulada y no se le puede grabar firmware. En la aplicación real este paso abre el instalador, que graba la placa conectada por USB. El instalador es una herramienta externa y sus textos están en inglés.</p>
      : usb ? <><p className="dlg-nota">Conecta la placa por USB y pulsa el botón. Se abre el instalador (una herramienta externa, con textos en inglés): elige "Install" y espera a que termine antes de seguir. El navegador te pedirá elegir el puerto. Instalar borra la configuración anterior de la placa.</p>
        <div ref={boton} className="dlg-acciones"><esp-web-install-button manifest="/firmware/manifest.json"><button slot="activate" type="button" className="btn boton-secundario">Instalar firmware en la placa</button>
          <span slot="unsupported">Este navegador no puede instalar firmware.</span><span slot="not-allowed">La instalación necesita una dirección segura (https).</span></esp-web-install-button></div></>
        : <p className="aviso neutral">Este navegador no puede hablar con la placa por USB. Abre esta pantalla en Chrome o Edge en un computador.</p>}
    </section>}

    {nodo && usb && <section className="dlg-seccion asistente-paso" aria-label="Paso 3: configuración"><h3>3. Configurar la placa por USB</h3>
      {demo && <p className="dlg-nota">En la demo, "Conectar placa" abre una placa simulada que responde igual que el firmware.</p>}
      <div className="dlg-acciones"><button type="button" className="btn boton-secundario" disabled={ocupado} onClick={() => tarea(conectar())}>{info ? 'Volver a conectar' : 'Conectar placa'}</button></div>
      {info && <dl className="dlg-datos"><div><dt>Firmware</dt><dd>{info.fw} <span>{info.version}</span></dd></div><div><dt>Wi-Fi</dt><dd>{WIFI[info.wifi ?? ''] ?? 'Sin dato'}</dd></div>
        <div><dt>Nodo en la placa</dt><dd>{info.codigo || 'Sin configurar'}</dd></div><div><dt>Reloj</dt><dd>{info.reloj ? 'Sincronizado' : 'Sin hora todavía'}</dd></div>
        <div><dt>Último envío</dt><dd>{info.ultimo_envio ? `${info.ultimo_envio.estado ?? 'sin dato'}${info.ultimo_envio.http ? ' (' + info.ultimo_envio.http + ')' : ''}` : 'Ninguno'}</dd></div>
        {lectura && <div><dt>Lectura de prueba</dt><dd>{lectura}</dd></div>}</dl>}
      <form onSubmit={configurar} noValidate>
        <div className="rangos-campos asistente-campos">
          <div><label className="form-label" htmlFor="nf-wifi">Red Wi-Fi</label><input id="nf-wifi" className="form-control" autoComplete="off" maxLength={32} value={wifi} disabled={ocupado} onChange={e => setWifi(e.target.value)} /></div>
          <div><label className="form-label" htmlFor="nf-clave">Contraseña del Wi-Fi</label><input id="nf-clave" className="form-control" type="password" autoComplete="off" maxLength={63} value={wifiClave} disabled={ocupado} onChange={e => setWifiClave(e.target.value)} /></div>
          <div><label className="form-label" htmlFor="nf-url">Dirección del servidor</label><input id="nf-url" className="form-control" inputMode="url" autoComplete="off" placeholder="https://tu-n8n/webhook/agrovigia/nodo" value={url} disabled={ocupado} onChange={e => setUrl(e.target.value)} /></div>
          <div><label className="form-label" htmlFor="nf-intervalo">Enviar cada (segundos)</label><input id="nf-intervalo" className="form-control" inputMode="numeric" autoComplete="off" value={intervalo} disabled={ocupado} onChange={e => setIntervalo(e.target.value)} /></div>
        </div>
        <p className="dlg-nota">La contraseña del Wi-Fi y la clave del nodo viajan solo por el cable hacia la placa. No se guardan en la base de datos ni en este navegador.</p>
        <div className="dlg-acciones"><button className="btn boton-principal" disabled={ocupado || !info}>{ocupado ? 'Un momento…' : 'Enviar configuración a la placa'}</button>
          <button type="button" className="btn boton-secundario" disabled={ocupado || !info} onClick={leer}>Leer sensores</button>
          <button type="button" className="btn boton-secundario" disabled={ocupado || !info?.configurado} onClick={enviar}>Enviar un lote ahora</button></div>
      </form>
    </section>}

    {nodo && <section className="dlg-seccion asistente-paso" aria-label="Paso 4: cultivo"><h3>4. Vincular a un cultivo</h3>
      <p className="dlg-nota">Cierra esta ventana y usa "Vincular a cultivo" en la tarjeta de {nodo.codigo}. Después ubícalo en su sector desde Cultivos, Terreno y sectores.</p>
      <div className="dlg-acciones"><button type="button" className="btn boton-secundario" onClick={alCerrar}>Cerrar</button></div>
    </section>}
  </Dialogo>;
}
