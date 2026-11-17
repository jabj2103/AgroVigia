#!/usr/bin/env node
// Servicio de simulacion de AgroVigia. Cada pocos segundos lee de Supabase (RPC estado_simulacion, clave
// de servidor) los cultivos, sus parametros vigentes, el clima simulado y el ajuste manual que el agricultor
// activo en la web, y sus nodos. Publica:
//   - un lote v3 de diez variables por cada nodo virtual, con su intervalo y al instante si cambia el clima o el ajuste;
//   - mientras hay un evento activo o un ajuste manual de temperatura o humedad del aire, la proyeccion v2
//     simulada de cada nodo fisico con lectura real reciente. La lectura real nunca se modifica.
// Transporte: MQTT (por defecto) o HTTP hacia el webhook de n8n (--http), para desplegar sin broker.
// No escribe en Supabase: los datos entran por n8n como cualquier otro lote. Respeta la pausa de cada nodo.
// Uso: node simulador/servicio.mjs [--sondeo 5] [--broker mqtt://...] [--http https://.../webhook/agrovigia/telemetria]
//                                  [--puerto 10000] [--estado archivo.json] [--una-vez] [--transicion 120]
// --transicion: segundos que tarda un ajuste manual en llegar a su valor (0 lo aplica de una vez).
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AJUSTES_FISICO, REINTENTOS_MS, caducado, faseClima, firmaAjustes, firmaClima, leerAjustes, leerEstado, loteProyeccion, loteVirtual, transicionAjustes } from './clima-modelo.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INTERVALO_PROYECCION_S = 30;
// Mientras el clima o el ajuste manual van de un valor a otro se publica mas seguido, para que el cambio se vea gradual.
const INTERVALO_TRANSICION_S = 10;
const CABECERA_CLAVE = 'X-AgroVigia-Clave';
const NORMAL = faseClima(null, null, 0);

// La URL del webhook no lleva usuario, clave ni parametros: la clave viaja solo en la cabecera.
export function urlIngesta(texto) {
  let u;
  try { u = new URL(texto); } catch { throw new Error('La URL de ingesta HTTP no es valida.'); }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash)
    throw new Error('La URL de ingesta HTTP debe ser http(s)://servidor/ruta, sin usuario, clave ni parametros.');
  return u.href;
}
export function argumentos(lista, entorno = process.env) {
  const r = { sondeo: 5, unaVez: false, estado: null, broker: entorno.AGROVIGIA_MQTT_URL ?? 'mqtt://127.0.0.1:18883',
    http: entorno.AGROVIGIA_INGESTA_URL || null, puerto: entorno.PORT ? Number(entorno.PORT) : null };
  for (let i = 0; i < lista.length; i++) {
    const a = lista[i], v = () => lista[++i];
    if (a === '--sondeo') r.sondeo = Number(v());
    else if (a === '--transicion') r.transicion = Number(v());
    else if (a === '--una-vez') r.unaVez = true;
    else if (a === '--estado') r.estado = path.resolve(v());
    else if (a === '--broker') r.broker = v();
    else if (a === '--http') r.http = v() ?? '';
    else if (a === '--puerto') r.puerto = Number(v());
    else throw new Error('Opcion desconocida: ' + a);
  }
  if (!Number.isFinite(r.sondeo) || r.sondeo < 2 || r.sondeo > 60) throw new Error('--sondeo va de 2 a 60 segundos.');
  if (r.transicion !== undefined && (!Number.isFinite(r.transicion) || r.transicion < 0 || r.transicion > 600)) throw new Error('--transicion va de 0 a 600 segundos.');
  if (r.http !== null) r.http = urlIngesta(r.http);
  if (r.puerto !== null && (!Number.isInteger(r.puerto) || r.puerto < 1 || r.puerto > 65535)) throw new Error('El puerto de salud (--puerto o PORT) va de 1 a 65535.');
  return r;
}
const leerLineas = archivo => { try { return readFileSync(archivo, 'utf8').split(/\r?\n/); } catch { return []; } };
// Usuario y clave MQTT del archivo privado generado al preparar el broker (formato mosquitto_pub -o).
export function credenciales(archivo = path.join(raiz, '.local/mqtt/simulador.conf')) {
  const lineas = leerLineas(archivo), valor = f => lineas.find(l => l.startsWith(f + ' '))?.slice(f.length + 1).trim();
  const username = process.env.AGROVIGIA_MQTT_USUARIO ?? valor('-u'), password = process.env.AGROVIGIA_MQTT_CLAVE ?? valor('-P');
  if (!username || !password) throw new Error('Faltan las credenciales MQTT del simulador (.local/mqtt/simulador.conf o variables AGROVIGIA_MQTT_*).');
  return { username, password };
}
// Clave del webhook de ingesta: variable AGROVIGIA_INGESTA_CLAVE o el archivo privado que genera
// local/agrovigia.sh configurar-n8n. Nunca se imprime.
export function claveIngesta(entorno = process.env, archivo = path.join(raiz, '.local/ingesta-http/clave')) {
  const clave = (entorno.AGROVIGIA_INGESTA_CLAVE ?? leerLineas(archivo)[0] ?? '').trim();
  if (clave.length < 16 || /\s/.test(clave)) throw new Error('Falta la clave de ingesta HTTP (variable AGROVIGIA_INGESTA_CLAVE o .local/ingesta-http/clave, minimo 16 caracteres).');
  return clave;
}
// URL y clave de servidor de Supabase: variables de entorno o .local/secretos.env. La clave nunca se imprime.
// AGROVIGIA_ENTORNO elige otro archivo, por ejemplo .local/entorno-local.env del Supabase local.
export function configuracionSupabase(archivo = process.env.AGROVIGIA_ENTORNO ?? path.join(raiz, '.local/secretos.env')) {
  const lineas = leerLineas(archivo), valor = k => process.env[k] ?? lineas.find(l => l.startsWith(k + '='))?.slice(k.length + 1).trim();
  const url = (valor('SUPABASE_URL') ?? '').replace(/\/$/, ''), clave = valor('SUPABASE_SECRET_KEY') ?? '';
  if (!/^(?:https:\/\/[a-z0-9-]+\.supabase\.co|http:\/\/(?:127\.0\.0\.1|localhost|host\.docker\.internal):[0-9]{2,5})$/.test(url)) throw new Error('Falta SUPABASE_URL: https://<proyecto>.supabase.co o un Supabase local (http://127.0.0.1:<puerto>, localhost u host.docker.internal).');
  if (!clave.startsWith('sb_secret_')) throw new Error('Falta SUPABASE_SECRET_KEY (sb_secret_...). El servicio la usa solo para leer el estado de simulacion.');
  return { url, clave };
}
export function proveedorSupabase({ url, clave }) {
  return async () => {
    const r = await fetch(url + '/rest/v1/rpc/estado_simulacion', { method: 'POST', signal: AbortSignal.timeout(10_000),
      headers: { apikey: clave, 'Content-Type': 'application/json' }, body: '{}' });
    if (!r.ok) throw new Error('Supabase respondio ' + r.status + ' al leer el estado de simulacion.');
    return r.json();
  };
}
const hora = () => new Date().toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour12: false });
const log = (codigo, texto) => console.log(`${hora()}  ${codigo.padEnd(22)}  ${texto}`);
const esperar = ms => new Promise(r => setTimeout(r, ms));

// Un transporte entrega un lote y dice si quedo confirmado. 'definitivo' significa que reintentar no sirve.
export function transporteMqtt(cliente) {
  return { nombre: 'mqtt', confirmacion: 'PUBACK',
    enviar: lote => new Promise(resolve => {
      if (!cliente.connected) return resolve({ ok: false, definitivo: false, motivo: 'sin conexion' });
      cliente.publish(lote.topico, lote.mensaje, { qos: 1, retain: false }, err => resolve(err ? { ok: false, definitivo: false, motivo: err.message } : { ok: true }));
    }),
    cerrar: async () => { await cliente.endAsync?.(); } };
}
// HTTP hacia el webhook de n8n (flujo 03g): mismo topico y mismo JSON del lote que por MQTT.
// 200: registrado o duplicado. 4xx: el receptor lo rechazo (lote invalido o clave incorrecta) y no se
// reintenta. Sin respuesta, 408, 429 o 5xx: se reintenta con el mismo mensaje_id (el guardado es idempotente).
export function transporteHttp({ url, clave, timeoutMs = 30_000, fetchImpl = fetch }) {
  return { nombre: 'http', confirmacion: 'HTTP 200',
    async enviar(lote) {
      let r;
      try {
        r = await fetchImpl(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
          headers: { 'Content-Type': 'application/json', [CABECERA_CLAVE]: clave },
          body: JSON.stringify({ topico: lote.topico, payload: lote.payload }) });
      } catch { return { ok: false, definitivo: false, motivo: 'sin respuesta del receptor HTTP' }; }
      let cuerpo = null;
      try { cuerpo = await r.json(); } catch { /* el rechazo de la clave llega como texto plano */ }
      const codigo = typeof cuerpo?.codigo === 'string' ? ' ' + cuerpo.codigo.replace(/[^A-Za-z0-9_]/g, '').slice(0, 60) : '';
      if (r.status === 200) return { ok: true };
      const reintentable = r.status >= 500 || r.status === 408 || r.status === 429;
      return { ok: false, definitivo: !reintentable, motivo: `HTTP ${r.status}${codigo}${[401, 403].includes(r.status) ? ' (clave de ingesta no aceptada)' : ''}` };
    },
    cerrar: async () => {} };
}

async function publicar(transporte, codigo, lote, tomadaMs, reintentos) {
  const id = lote.payload.mensaje_id.slice(0, 8);
  for (let intento = 0; ; intento++) {
    if (caducado(tomadaMs, Date.now())) { log(codigo, `captura ${id} caducada (300 s); se descarta`); return false; }
    const r = await transporte.enviar(lote);
    if (r.ok) return true;
    if (r.definitivo) { log(codigo, `captura ${id} rechazada por el receptor: ${r.motivo}; no se reintenta`); return false; }
    if (intento >= reintentos.length) { log(codigo, `captura ${id} NO confirmada tras ${reintentos.length} reintentos: ${r.motivo}`); return false; }
    await esperar(reintentos[intento]);
  }
}

// Un ciclo: decide que nodos publican ahora y los entrega (hasta 'concurrencia' a la vez). 'memoria' guarda por
// nodo la ultima publicacion y el clima y el ajuste vistos. Devuelve cuantos lotes quedaron confirmados.
// 'cliente' (cliente MQTT) se acepta por compatibilidad; lo normal es pasar 'transporte'.
export async function ciclo({ estado, memoria, transporte, cliente, ejecucion, ahora = new Date(), reintentos = REINTENTOS_MS, concurrencia = 4, contador = null, transicion }) {
  const via = transporte ?? transporteMqtt(cliente), envios = [];
  for (const c of leerEstado(estado)) {
    const fase = faseClima(c.clima, c.clima_anterior, ahora.getTime());
    // El ajuste manual no se aplica de golpe: avanza hacia su objetivo y eso es lo que reciben los nodos.
    const tr = transicionAjustes(memoria.get('ajuste:' + c.cultivo_id) ?? null, c.ajustes, c.ajustes_iniciado_en, ahora.getTime(), transicion);
    memoria.set('ajuste:' + c.cultivo_id, tr.estado);
    const vigentes = tr.ajustes, ajustesFisico = leerAjustes(vigentes, AJUSTES_FISICO);
    const cambiando = tr.enTransicion || fase.fase === 'regreso' || (fase.fase === 'evento' && fase.progreso < 1);
    for (const n of c.nodos) {
      const m = memoria.get(n.codigo) ?? { ultima: 0, firma: null, aviso: '' };
      const avisar = texto => { if (m.aviso !== texto) { m.aviso = texto; if (texto) log(n.codigo, texto); } memoria.set(n.codigo, m); };
      if (n.pausado) { avisar('en pausa: no se publica'); continue; }
      // La firma incluye el clima y el ajuste que afecta a este nodo: si cambia, publica de inmediato.
      const firma = firmaClima(fase) + '|' + firmaAjustes(n.tipo_nodo === 'virtual' ? c.ajustes : leerAjustes(c.ajustes, AJUSTES_FISICO));
      const cambio = m.firma !== null && m.firma !== firma;
      let lote = null, etiqueta = '';
      if (n.tipo_nodo === 'virtual') {
        if (!n.zona || !n.asignacion_version) { avisar('sin sector asignado: no se publica'); continue; }
        if (!cambio && ahora.getTime() - m.ultima < (cambiando ? Math.min(n.intervalo_segundos, INTERVALO_TRANSICION_S) : n.intervalo_segundos) * 1000) continue;
        lote = loteVirtual(n, c.parametros, fase, ahora, { ejecucion, ajustes: vigentes });
        const v = Object.fromEntries(lote.payload.mediciones.map(x => [x.variable_codigo, x.valor]));
        etiqueta = `${v.temperatura_aire} C  ${v.humedad_aire} %HR  suelo ${v.humedad_suelo_vwc} %VWC  lluvia ${v.precipitacion_60min} mm`;
      } else {
        // El fisico solo se proyecta con evento activo o con ajuste manual de lo que mide (temperatura y humedad del aire).
        if (fase.fase !== 'evento' && !ajustesFisico) { m.firma = firma; avisar(''); continue; }
        if (!cambio && ahora.getTime() - m.ultima < (cambiando ? INTERVALO_TRANSICION_S : INTERVALO_PROYECCION_S) * 1000) continue;
        lote = loteProyeccion(n, fase.fase === 'evento' ? fase : NORMAL, ahora, undefined, ajustesFisico);
        if (!lote) { avisar('sin lectura real reciente: no hay base para proyectar'); continue; }
        const [t, h] = lote.payload.mediciones;
        etiqueta = `proyeccion sobre lectura real: ${t.valor} C  ${h.valor} %HR`;
      }
      m.ultima = ahora.getTime(); m.firma = firma; m.aviso = ''; memoria.set(n.codigo, m);
      const notas = [fase.fase === 'normal' ? '' : `${fase.fase} ${fase.evento} ${fase.intensidad}, paso ${fase.paso}`,
        (n.tipo_nodo === 'virtual' ? vigentes : ajustesFisico) ? 'ajuste manual' + (tr.enTransicion ? ` al ${Math.round(tr.progreso * 100)} %` : '') : ''].filter(Boolean).join('; ');
      envios.push({ codigo: n.codigo, lote, texto: etiqueta + (notas ? `  [${notas}]` : '') });
    }
  }
  let publicados = 0, siguiente = 0;
  const trabajador = async () => {
    while (siguiente < envios.length) {
      const e = envios[siguiente++];
      if (await publicar(via, e.codigo, e.lote, ahora.getTime(), reintentos)) {
        publicados++;
        log(e.codigo, `${via.confirmacion} ${e.lote.payload.mensaje_id.slice(0, 8)}  ${e.texto}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrencia, envios.length)) }, trabajador));
  if (contador) { contador.lotes_publicados += publicados; contador.lotes_fallidos += envios.length - publicados; }
  return publicados;
}

// Servidor de salud para correr como servicio web (Render): GET / y GET /salud. No expone claves ni URL.
export function servidorSalud(puerto, salud, anfitrion = '0.0.0.0') {
  const servidor = createServer((req, res) => {
    const ruta = (req.url ?? '').split('?')[0];
    const responder = (codigo, cuerpo) => { res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(cuerpo)); };
    if (!['GET', 'HEAD'].includes(req.method)) return responder(405, { estado: 'error', codigo: 'METODO_NO_ADMITIDO' });
    if (ruta !== '/' && ruta !== '/salud') return responder(404, { estado: 'error', codigo: 'RUTA_DESCONOCIDA' });
    responder(200, { servicio: 'agrovigia-simulacion', ...salud, ahora: new Date().toISOString() });
  });
  return new Promise((resolve, reject) => { servidor.once('error', reject); servidor.listen(puerto, anfitrion, () => resolve(servidor)); });
}

export async function iniciar(opciones) {
  const obtener = opciones.estado ? async () => JSON.parse(readFileSync(opciones.estado, 'utf8')) : proveedorSupabase(configuracionSupabase());
  let transporte;
  if (opciones.http) {
    transporte = transporteHttp({ url: opciones.http, clave: claveIngesta() });
    const u = new URL(opciones.http);
    if (u.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && u.hostname.includes('.'))
      console.error(`${hora()}  aviso: la URL de ingesta usa http sin cifrar; la clave viaja en claro. Usa https fuera de una red privada.`);
  } else {
    const { default: mqtt } = await import('mqtt');
    const cliente = mqtt.connect(opciones.broker, { ...credenciales(), protocolVersion: 4, clean: true, reconnectPeriod: 5000,
      clientId: 'agv-simulacion-' + Math.random().toString(16).slice(2, 10), connectTimeout: 10_000, queueQoSZero: false });
    cliente.on('error', e => console.error(`${hora()}  error MQTT: ${e.message}`));
    await new Promise((resolve, reject) => { cliente.once('connect', resolve); cliente.once('error', reject); });
    transporte = transporteMqtt(cliente);
  }
  const salud = { estado: 'iniciando', transporte: transporte.nombre, estado_desde: opciones.estado ? 'archivo' : 'supabase', sondeo_segundos: opciones.sondeo,
    iniciado_en: new Date().toISOString(), ciclos: 0, ultimo_ciclo: null, lotes_publicados: 0, lotes_fallidos: 0 };
  const servidor = opciones.puerto ? await servidorSalud(opciones.puerto, salud) : null;
  const destino = opciones.http ? 'HTTP ' + new URL(opciones.http).host : opciones.broker;
  console.log(`AgroVigia servicio de simulacion · sondeo cada ${opciones.sondeo} s · ${destino} · estado desde ${opciones.estado ? 'archivo' : 'Supabase'}${servidor ? ` · salud en el puerto ${opciones.puerto}` : ''}`);
  console.log('Datos SIMULADOS: nodos virtuales por agrovigia/v3/simulado/... y proyeccion de fisicos por agrovigia/v2/simulado/...');
  const memoria = new Map(), ejecucion = randomUUID();
  let fallo = '', ocupado = false;
  const paso = async () => {
    if (ocupado) return; ocupado = true;
    const en = new Date().toISOString();
    try {
      const estado = await obtener();
      if (fallo) { console.log(`${hora()}  estado de simulacion disponible otra vez`); fallo = ''; }
      const publicados = await ciclo({ estado, memoria, transporte, ejecucion, contador: salud, transicion: opciones.transicion });
      salud.estado = 'activo'; salud.ultimo_ciclo = { en, publicados, error: null };
    } catch (e) {
      if (fallo !== e.message) { fallo = e.message; console.error(`${hora()}  ${e.message} Se reintenta en el proximo sondeo.`); }
      salud.estado = 'degradado'; salud.ultimo_ciclo = { en, publicados: 0, error: 'NO_SE_PUDO_COMPLETAR_EL_CICLO' };
    } finally { salud.ciclos++; ocupado = false; }
  };
  const cerrar = async () => { servidor?.close(); await transporte.cerrar(); };
  await paso();
  if (opciones.unaVez) { await cerrar(); if (fallo) throw new Error(fallo); return; }
  const temporizador = setInterval(() => { void paso(); }, opciones.sondeo * 1000);
  const terminar = async () => { clearInterval(temporizador); await cerrar(); };
  process.once('SIGINT', () => { console.log('\nDeteniendo el servicio de simulacion...'); void terminar().then(() => process.exit(0)); });
  process.once('SIGTERM', () => { void terminar().then(() => process.exit(0)); });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  iniciar(argumentos(process.argv.slice(2))).catch(e => { console.error('Error: ' + e.message); process.exit(1); });
}
