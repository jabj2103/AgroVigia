// Transporte HTTP y servidor de salud del servicio de simulacion contra un servidor local de prueba.
// No usa n8n, Supabase ni el broker. El estado sale de un archivo ficticio y la clave es de prueba.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { argumentos, claveIngesta, servidorSalud, transporteHttp, urlIngesta } from '../servicio.mjs';
import { faseClima, loteVirtual } from '../clima-modelo.mjs';
import { prepararIngestaSimulada } from '../../n8n/preparar-simulada.mjs';
import { PARAMETROS, estadoFicticio } from './fixtures-clima.mjs';
const { prevalidarAmbiental } = createRequire(import.meta.url)('../../n8n/validar-ambiental.cjs');

const aqui = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLAVE = 'clave-de-prueba-solo-local-0123456789';
// Receptor de prueba con el contrato del webhook 03g: clave en la cabecera y cuerpo {topico, payload}.
async function receptor(responder = () => ({ codigo: 200, cuerpo: { estado: 'insertado', codigo: 'LOTE_SIMULADO_GUARDADO' } })) {
  const recibidos = [];
  const servidor = createServer((req, res) => {
    let texto = ''; req.setEncoding('utf8'); req.on('data', d => { texto += d; });
    req.on('end', () => {
      const entrada = { metodo: req.method, ruta: req.url, clave: req.headers['x-agrovigia-clave'], tipo: req.headers['content-type'], texto };
      recibidos.push(entrada);
      if (entrada.clave !== CLAVE) { res.writeHead(403); return res.end('Authorization data is wrong!'); }
      const r = responder(entrada, recibidos.length);
      res.writeHead(r.codigo, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r.cuerpo));
    });
  });
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  return { recibidos, url: `http://127.0.0.1:${servidor.address().port}/webhook/agrovigia/telemetria`, cerrar: () => new Promise(r => servidor.close(r)) };
}
const lote = () => loteVirtual({ codigo: 'sim-52ea4628c470-01', tipo_nodo: 'virtual', asignacion_version: randomUUID(), zona: 'Sector norte', intervalo_segundos: 30 },
  PARAMETROS.platano, faseClima(null, null, Date.now()), new Date(), { ejecucion: randomUUID(), ajustes: { temperatura_aire: 2 } });

test('opciones: --http y AGROVIGIA_INGESTA_URL eligen el transporte HTTP; PORT o --puerto abren el servidor de salud', () => {
  assert.deepEqual([argumentos([], {}).http, argumentos([], {}).puerto], [null, null]);
  assert.equal(argumentos(['--http', 'https://n8n.example.com/webhook/agrovigia/telemetria'], {}).http, 'https://n8n.example.com/webhook/agrovigia/telemetria');
  assert.equal(argumentos([], { AGROVIGIA_INGESTA_URL: 'http://n8n:5678/webhook/agrovigia/telemetria', PORT: '10000' }).http, 'http://n8n:5678/webhook/agrovigia/telemetria');
  assert.equal(argumentos([], { PORT: '10000' }).puerto, 10000); assert.equal(argumentos(['--puerto', '8080'], { PORT: '10000' }).puerto, 8080);
  for (const mala of ['ftp://x/y', 'no-es-url', 'https://usuario:clave@x/y', 'https://x/y?clave=1', ''])
    assert.throws(() => urlIngesta(mala), /URL de ingesta/, mala);
  assert.throws(() => argumentos(['--http'], {}), /URL de ingesta/);
  for (const malo of ['0', '70000', 'abc', '80.5']) assert.throws(() => argumentos(['--puerto', malo], {}), /puerto/);
  assert.throws(() => argumentos(['--otra'], {}), /Opcion desconocida/);
  assert.equal(claveIngesta({ AGROVIGIA_INGESTA_CLAVE: ' ' + CLAVE + ' ' }, '/no/existe'), CLAVE);
  for (const entorno of [{}, { AGROVIGIA_INGESTA_CLAVE: 'corta' }, { AGROVIGIA_INGESTA_CLAVE: 'con espacios dentro de la clave' }])
    assert.throws(() => claveIngesta(entorno, '/no/existe'), /clave de ingesta HTTP/);
});

test('transporte HTTP: POST con la clave en la cabecera y el mismo topico y JSON del lote; 200 insertado confirma', async () => {
  const r = await receptor();
  try {
    const l = lote(), resultado = await transporteHttp({ url: r.url, clave: CLAVE }).enviar(l);
    assert.deepEqual(resultado, { ok: true });
    const [e] = r.recibidos;
    assert.deepEqual([e.metodo, e.ruta, e.clave, e.tipo], ['POST', '/webhook/agrovigia/telemetria', CLAVE, 'application/json']);
    const cuerpo = JSON.parse(e.texto);
    assert.deepEqual(Object.keys(cuerpo), ['topico', 'payload']); assert.equal(cuerpo.topico, l.topico); assert.deepEqual(cuerpo.payload, l.payload);
    // Lo que n8n reconstruye del cuerpo pasa el mismo validador que por MQTT.
    const previo = prepararIngestaSimulada({ topic: cuerpo.topico, message: JSON.stringify(cuerpo.payload), supabase_url: 'https://fixture-local.supabase.co' },
      { acl_verificada: true, retencion_broker_desactivada: true }, new Date().toISOString());
    assert.equal(previo.estado, 'prevalidado', previo.codigo);
  } finally { await r.cerrar(); }
});

test('transporte HTTP: 200 vacio, malformado o rechazado queda sin confirmacion', async () => {
  const casos = ['', '<html>OK</html>', '{}', '{"estado":"rechazado","codigo":"NO_GUARDADO"}', '{"estado":"pendiente"}'];
  const captura = lote();
  for (const cuerpo of casos) {
    const t = transporteHttp({ url: 'http://localhost/webhook', clave: CLAVE, fetchImpl: async () => new Response(cuerpo) });
    assert.deepEqual(await t.enviar(captura), { ok: false, definitivo: false, motivo: 'HTTP 200 sin confirmación de guardado' }, cuerpo);
  }
});

test('transporte HTTP: 400 y clave rechazada son definitivos; 503, 429 y sin respuesta se reintentan; nunca devuelve la clave', async () => {
  const casos = [[400, { estado: 'rechazado', codigo: 'PAYLOAD_V3_INVALIDO' }, true, 'HTTP 400 PAYLOAD_V3_INVALIDO'], [404, {}, true, 'HTTP 404'],
    [503, { estado: 'pendiente', codigo: 'RPC_SIN_CONFIRMACION' }, false, 'HTTP 503 RPC_SIN_CONFIRMACION'], [429, {}, false, 'HTTP 429'], [500, { message: 'error interno' }, false, 'HTTP 500']];
  for (const [codigo, cuerpo, definitivo, motivo] of casos) {
    const r = await receptor(() => ({ codigo, cuerpo }));
    try { assert.deepEqual(await transporteHttp({ url: r.url, clave: CLAVE }).enviar(lote()), { ok: false, definitivo, motivo }); } finally { await r.cerrar(); }
  }
  const r = await receptor();
  try {
    const mala = await transporteHttp({ url: r.url, clave: 'otra-clave-que-no-es-la-correcta' }).enviar(lote());
    assert.deepEqual(mala, { ok: false, definitivo: true, motivo: 'HTTP 403 (clave de ingesta no aceptada)' });
    assert.ok(!JSON.stringify(mala).includes('otra-clave'));
  } finally { await r.cerrar(); }
  const caido = await transporteHttp({ url: r.url, clave: CLAVE, timeoutMs: 500 }).enviar(lote());
  assert.deepEqual(caido, { ok: false, definitivo: false, motivo: 'sin respuesta del receptor HTTP' });
});

test('servidor de salud: GET / y GET /salud devuelven el estado sin secretos; otras rutas y metodos se rechazan', async () => {
  const salud = { estado: 'activo', transporte: 'http', estado_desde: 'supabase', sondeo_segundos: 5, iniciado_en: new Date().toISOString(), ciclos: 3,
    ultimo_ciclo: { en: new Date().toISOString(), publicados: 17, error: null }, lotes_publicados: 51, lotes_fallidos: 0 };
  const servidor = await servidorSalud(0, salud, '127.0.0.1'), base = `http://127.0.0.1:${servidor.address().port}`;
  try {
    for (const ruta of ['/', '/salud', '/salud?x=1']) {
      const r = await fetch(base + ruta); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /application\/json/);
      const j = await r.json();
      assert.deepEqual([j.servicio, j.estado, j.transporte, j.lotes_publicados, j.ultimo_ciclo.publicados], ['agrovigia-simulacion', 'activo', 'http', 51, 17]);
      assert.ok(Number.isFinite(Date.parse(j.ahora)));
    }
    salud.lotes_publicados = 68;
    assert.equal((await (await fetch(base + '/salud')).json()).lotes_publicados, 68, 'refleja el estado vivo');
    assert.equal((await fetch(base + '/otra')).status, 404); assert.equal((await fetch(base + '/salud', { method: 'POST' })).status, 405);
  } finally { await new Promise(r => servidor.close(r)); }
});

test('proceso completo por HTTP: un ciclo con ajuste manual entrega 17 lotes v3 y la proyeccion v2 sin conectarse a MQTT', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agv-http-')), archivo = path.join(dir, 'estado.json');
  const estado = estadoFicticio({ ajustes: { temperatura_aire: 3, humedad_suelo_vwc: -9 } });
  writeFileSync(archivo, JSON.stringify(estado));
  // El primer intento del nodo 02 devuelve 200 sin estado: se reintenta con el mismo mensaje_id.
  const vistos = new Map();
  const r = await receptor(entrada => {
    const cuerpo = JSON.parse(entrada.texto), n = (vistos.get(cuerpo.payload.mensaje_id) ?? 0) + 1; vistos.set(cuerpo.payload.mensaje_id, n);
    if (cuerpo.topico.endsWith('sim-52ea4628c470-02/telemetria')) {
      if (n === 1) return { codigo: 200, cuerpo: {} };
      return { codigo: 200, cuerpo: { estado: 'duplicado', codigo: 'LOTE_YA_GUARDADO' } };
    }
    return { codigo: 200, cuerpo: { estado: 'insertado', codigo: 'LOTE_GUARDADO' } };
  });
  try {
    // Broker inexistente a proposito: con --http el servicio no debe intentar conectarse a MQTT.
    const sim = spawn(process.execPath, ['servicio.mjs', '--una-vez', '--transicion', '0', '--estado', archivo, '--http', r.url, '--broker', 'mqtt://127.0.0.1:1'], { cwd: aqui, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, AGROVIGIA_INGESTA_CLAVE: CLAVE } });
    let salida = ''; sim.stdout.on('data', d => { salida += d; }); sim.stderr.on('data', d => { salida += d; });
    assert.equal(await new Promise(done => sim.on('exit', done)), 0, salida);
    assert.ok(!salida.includes(CLAVE), 'la clave no aparece en la salida');
    const cuerpos = r.recibidos.map(e => JSON.parse(e.texto));
    assert.ok(r.recibidos.every(e => e.clave === CLAVE && e.metodo === 'POST'));
    assert.equal(cuerpos.length, 19, '18 lotes mas un reintento'); assert.equal(vistos.size, 18); assert.equal([...vistos.values()].filter(n => n === 2).length, 1);
    const v3 = cuerpos.filter(c => c.topico.startsWith('agrovigia/v3/simulado/')), v2 = cuerpos.filter(c => c.topico.startsWith('agrovigia/v2/simulado/'));
    assert.equal(new Set(v3.map(c => c.topico)).size, 17); assert.equal(v2.length, 1);
    for (const c of v3) {
      const previo = prepararIngestaSimulada({ topic: c.topico, message: JSON.stringify(c.payload), supabase_url: 'https://fixture-local.supabase.co' },
        { acl_verificada: true, retencion_broker_desactivada: true }, new Date().toISOString());
      assert.equal(previo.estado, 'prevalidado', previo.codigo);
    }
    assert.equal(v2[0].topico, 'agrovigia/v2/simulado/nodos/agv-dht22-01/telemetria');
    const previo = prevalidarAmbiental({ topic: v2[0].topico, message: JSON.stringify(v2[0].payload) });
    assert.equal(previo.estado, 'prevalidado', previo.codigo);
    assert.deepEqual([v2[0].payload.origen, v2[0].payload.mediciones[0].valor], ['simulado', 32.4], 'lectura real 29,4 mas el ajuste de 3');
    assert.equal((salida.match(/HTTP 200/g) ?? []).length, 18, salida);
  } finally { await r.cerrar(); rmSync(dir, { recursive: true, force: true }); }
});
