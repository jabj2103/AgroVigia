'use strict';
// Genera los archivos que n8n importa por linea de comandos: credenciales.json (n8n lo cifra al importar y
// quien invoca lo borra enseguida), un JSON por flujo con sus credenciales enlazadas y flujos.txt con una
// linea "archivo:id" por flujo. No imprime claves.
//
// Flujos: 03e (MQTT, lotes v2 real y simulado), 03f (MQTT, simulado v3 por zonas), 03g (HTTP, webhook
// agrovigia/telemetria para v2 y v3), 03h (sugerencias de IA a peticion) y 03i (HTTPS, webhook agrovigia/nodo
// para lotes reales con la clave propia de cada nodo fisico). Cada flujo MQTT tiene su propio
// clientId para no desconectarse entre si.
//
// Dos formas de uso:
//   local    lo invoca local/agrovigia.sh configurar-n8n con RAIZ, PRIV, URL y MODELO. Lee .local/secretos.env,
//            .local/mqtt/receptor.conf y .local/ingesta-http/clave.
//   entorno  node preparar-n8n.cjs --entorno <carpeta>: para un contenedor (por ejemplo Render). Todo sale de
//            variables de entorno. Sin AGROVIGIA_MQTT_HOST prepara solo los flujos sin MQTT (03g, 03h y 03i).
const fs = require('node:fs'), path = require('node:path');
const argumentos = process.argv.slice(2), porEntorno = argumentos[0] === '--entorno';
const destino = porEntorno ? argumentos[1] : argumentos[0];
const raiz = process.env.RAIZ ?? (porEntorno ? path.resolve(__dirname, '..') : undefined), priv = process.env.PRIV;
if (!destino || !raiz || (!porEntorno && !priv)) throw new Error('Ejecutar mediante local/agrovigia.sh configurar-n8n, o con --entorno <carpeta> dentro de un contenedor.');
const leerEnv = archivo => Object.fromEntries(fs.readFileSync(archivo, 'utf8').split(/\r?\n/)
  .filter(l => /^[A-Z_0-9]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const leerOpcional = archivo => { try { return fs.readFileSync(archivo, 'utf8'); } catch { return ''; } };

// ARCHIVO_SECRETOS elige entre .local/secretos.env (nube) y .local/entorno-local.env (Supabase local).
const secretos = porEntorno ? process.env : leerEnv(process.env.ARCHIVO_SECRETOS || path.join(priv, 'secretos.env'));
const url = (porEntorno ? secretos.SUPABASE_URL ?? '' : process.env.URL ?? '').replace(/\/$/, '');
const modelo = (porEntorno ? secretos.GEMINI_MODELO : process.env.MODELO) || 'gemini-3.5-flash-lite';
const claveIngesta = (porEntorno ? secretos.AGROVIGIA_INGESTA_CLAVE ?? '' : leerOpcional(path.join(priv, 'ingesta-http/clave')).split(/\r?\n/)[0]).trim();
const admiteReal = (secretos.AGROVIGIA_INGESTA_ADMITE_REAL ?? '').trim() === 'si' ? 'si' : 'no';
let mqtt = null;
if (porEntorno) {
  if (secretos.AGROVIGIA_MQTT_HOST) mqtt = { host: secretos.AGROVIGIA_MQTT_HOST, port: Number(secretos.AGROVIGIA_MQTT_PUERTO || 1883),
    username: secretos.AGROVIGIA_MQTT_USUARIO, password: secretos.AGROVIGIA_MQTT_CLAVE };
} else {
  const receptor = fs.readFileSync(path.join(priv, 'mqtt/receptor.conf'), 'utf8').split(/\r?\n/);
  const opcion = f => receptor.find(l => l.startsWith(f + ' '))?.slice(f.length + 1).trim();
  if (opcion('-u') !== 'receptor' || !opcion('-P')) throw new Error('Falta .local/mqtt/receptor.conf valido');
  mqtt = { host: 'mosquitto', port: 18883, username: opcion('-u'), password: opcion('-P') };
}
if (!/^(?:https:\/\/[a-z0-9-]+\.supabase\.co|http:\/\/(?:127\.0\.0\.1|localhost|host\.docker\.internal):[0-9]{2,5})$/.test(url)) throw new Error('URL de Supabase invalida: https://<proyecto>.supabase.co o un Supabase local (http://127.0.0.1:<puerto>, localhost u host.docker.internal)');
if (!/^gemini-[a-z0-9.\-]{1,50}$/.test(modelo)) throw new Error('GEMINI_MODELO invalido');
if (!secretos.SUPABASE_SECRET_KEY?.startsWith('sb_secret_')) throw new Error('SUPABASE_SECRET_KEY debe ser la Secret key sb_secret_');
if (!secretos.GEMINI_API_KEY) throw new Error('Falta GEMINI_API_KEY');
if (claveIngesta.length < 16 || /\s/.test(claveIngesta)) throw new Error('Falta la clave de ingesta HTTP (minimo 16 caracteres, sin espacios)');
if (mqtt && (!mqtt.username || !mqtt.password || !Number.isInteger(mqtt.port))) throw new Error('Credenciales MQTT incompletas (AGROVIGIA_MQTT_USUARIO, AGROVIGIA_MQTT_CLAVE, AGROVIGIA_MQTT_PUERTO)');

const ids = { mqtt: 'agvMqttReceptor1', mqttV3: 'agvMqttReceptor3', supabase: 'agvSupabaseSrv01', gemini: 'agvGeminiApiKey1', ingesta: 'agvIngestaHttp01' };
const credencialMqtt = (id, name, clientId) => ({ id, name, type: 'mqtt', data: { protocol: 'mqtt', host: mqtt.host, port: mqtt.port, username: mqtt.username, password: mqtt.password, clean: true, clientId, ssl: false } });
const cred = {
  ...(mqtt ? { mqtt: credencialMqtt(ids.mqtt, 'AgroVigia MQTT receptor', 'agv-n8n-receptor'), mqttV3: credencialMqtt(ids.mqttV3, 'AgroVigia MQTT receptor v3', 'agv-n8n-receptor-v3') } : {}),
  supabase: { id: ids.supabase, name: 'AgroVigia Supabase (secret)', type: 'httpHeaderAuth', data: { name: 'apikey', value: secretos.SUPABASE_SECRET_KEY } },
  gemini: { id: ids.gemini, name: 'AgroVigia Gemini API', type: 'httpHeaderAuth', data: { name: 'x-goog-api-key', value: secretos.GEMINI_API_KEY } },
  // El webhook 03g exige esta cabecera; la misma clave la usa el servicio de simulacion (AGROVIGIA_INGESTA_CLAVE).
  ingesta: { id: ids.ingesta, name: 'AgroVigia ingesta HTTP', type: 'httpHeaderAuth', data: { name: 'X-AgroVigia-Clave', value: claveIngesta } },
};
const RAMAS = { 'Consultar nodo guardado': 'supabase', 'Evaluar alertas': 'supabase', 'Reservar sugerencia IA': 'supabase', 'Guardar sugerencia IA': 'supabase', 'Consultar Gemini': 'gemini' };
const FLUJOS = [
  { archivo: '03e-ingesta-alertas.json', salida: '03e.json', id: 'agrovigia03eIA01', mqtt: true, enlaces: { 'MQTT receptor': 'mqtt', 'Guardar lote en Supabase': 'supabase', ...RAMAS } },
  { archivo: '03f-ingesta-simulada-v3.json', salida: '03f.json', id: 'agrovigia03fSIM01', mqtt: true, enlaces: { 'MQTT receptor': 'mqttV3', 'Guardar lote en Supabase': 'supabase', ...RAMAS } },
  { archivo: '03g-ingesta-http.json', salida: '03g.json', id: 'agrovigia03gHTTP1', enlaces: { 'Webhook ingesta': 'ingesta', 'Guardar lote en Supabase': 'supabase', ...RAMAS } },
  // 03i no lleva credencial en el webhook: cada nodo fisico se autentica con su propia clave (autenticar_nodo).
  { archivo: '03i-ingesta-nodo-https.json', salida: '03i.json', id: 'agrovigia03iNODO1', enlaces: { 'Autenticar nodo': 'supabase', 'Guardar lote en Supabase': 'supabase', ...RAMAS } },
  { archivo: '03h-sugerencias-a-peticion.json', salida: '03h.json', id: 'agrovigia03hSOL01',
    enlaces: { 'Tomar solicitudes': 'supabase', 'Preparar solicitud': 'supabase', 'Completar solicitud': 'supabase', 'Consultar Gemini': 'gemini' } },
].filter(f => mqtt || !f.mqtt);

function preparar({ archivo, id, enlaces }) {
  const flujo = JSON.parse(fs.readFileSync(path.join(raiz, 'n8n', archivo), 'utf8'));
  flujo.id = id;
  for (const [nombre, clave] of Object.entries(enlaces)) {
    const n = flujo.nodes.find(x => x.name === nombre);
    if (!n) throw new Error('Nodo no encontrado: ' + nombre + ' en ' + archivo);
    n.credentials = { [cred[clave].type]: { id: cred[clave].id, name: cred[clave].name } };
  }
  const conf = flujo.nodes.find(n => n.name === 'Proyecto Supabase').parameters.assignments.assignments;
  conf.find(a => a.name === 'supabase_url').value = url;
  conf.find(a => a.name === 'gemini_modelo').value = modelo;
  const real = conf.find(a => a.name === 'http_admite_real');
  if (real) real.value = admiteReal;
  return flujo;
}
fs.mkdirSync(destino, { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(destino, 'credenciales.json'), JSON.stringify(Object.values(cred)), { mode: 0o600 });
for (const f of FLUJOS) fs.writeFileSync(path.join(destino, f.salida), JSON.stringify([preparar(f)], null, 2), { mode: 0o600 });
fs.writeFileSync(path.join(destino, 'flujos.txt'), FLUJOS.map(f => f.salida + ':' + f.id).join('\n') + '\n', { mode: 0o600 });
console.log('Archivos de importacion preparados (sin mostrar claves): ' + FLUJOS.map(f => f.salida.slice(0, 3)).join(', ') +
  '. Modelo IA: ' + modelo + '. Origen real por HTTP: ' + admiteReal + '.');
