// Broker aislado en puerto efimero y credenciales efimeras. Sin n8n/Supabase ni datos reales.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepararCapturaV3 } from '../simulador/contrato-v3.mjs';
import { publicarMqtt } from '../simulador/transporte-mqtt.mjs';
import { captura, filas } from '../simulador/tests/fixtures.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const bin = path.join(homedir(), 'Documents', 'Mosquitto');
const children = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function iniciar(nombre, args) {
  const p = spawn(path.join(bin, nombre + '.exe'), args, { cwd: root, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  p.stdout.on('data', d => { output += d.toString('utf8'); }); p.stderr.on('data', d => { output += d.toString('utf8'); });
  p.done = new Promise((resolve, reject) => { p.on('error', reject); p.on('close', code => resolve({ code, output })); });
  p.done.catch(() => {}); children.push(p); return p;
}
async function libre() { const s = net.createServer(); await new Promise(resolve => s.listen(0, '127.0.0.1', resolve)); const p = s.address().port; await new Promise(resolve => s.close(resolve)); return p; }
async function puertoListo(port) {
  for (let i = 0; i < 80; i++) {
    const ok = await new Promise(resolve => {
      const s = net.connect(port, '127.0.0.1');
      s.on('error', () => resolve(false)); s.on('connect', () => { s.destroy(); resolve(true); });
    });
    if (ok) return; await pause(50);
  }
  throw new Error('El broker aislado no abrió su puerto.');
}
function cadena(s) { const b = Buffer.from(s, 'utf8'), len = Buffer.alloc(2); len.writeUInt16BE(b.length); return Buffer.concat([len, b]); }
function paquete(header, body) {
  const bytes = []; let n = body.length;
  do { let digit = n % 128; n = Math.floor(n / 128); if (n) digit |= 128; bytes.push(digit); } while (n);
  return Buffer.concat([Buffer.from([header, ...bytes]), body]);
}
function comprobarRetainForzado(port, password, topic) {
  // mosquitto_pub 2.1.2 rebaja -r a r0 al recibir Retain Available=0.
  // Cliente mínimo de prueba para comprobar que el broker rechaza un r1 real.
  return new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1'); let conectado = false, buf = Buffer.alloc(0);
    s.setTimeout(3000, () => { s.destroy(); reject(new Error('El broker no rechazó retain forzado.')); });
    s.on('error', reject);
    s.on('connect', () => s.write(paquete(0x10, Buffer.concat([cadena('MQTT'), Buffer.from([4, 0xc2, 0, 60]), cadena('qa-retain'), cadena('simulador'), cadena(password)]))));
    s.on('data', data => {
      buf = Buffer.concat([buf, data]);
      if (!conectado && buf.length >= 4) {
        try { assert.deepEqual(buf.subarray(0, 4), Buffer.from([0x20, 2, 0, 0])); }
        catch (e) { s.destroy(); reject(e); return; }
        conectado = true; buf = Buffer.alloc(0);
        s.write(paquete(0x33, Buffer.concat([cadena(topic), Buffer.from([0, 1]), Buffer.from('PRUEBA_RETAIN_FORZADO')])));
      } else if (conectado) { s.destroy(); reject(new Error('El broker respondió a un PUBLISH retain prohibido.')); }
    });
    s.on('close', () => conectado ? resolve() : reject(new Error('Conexión de prueba retain no autenticada.')));
  });
}
let timer;
try {
  timer = setTimeout(() => { for (const p of children) p.kill(); }, 30000);
  const qa = path.join(root, '.local', 'qa-mqtt-v3'); await mkdir(qa, { recursive: true });
  const dir = await mkdtemp(path.join(qa, 'prueba-'));
  const users = ['simulador', 'receptor', 'nodo_dht22', 'nodo_ldr'];
  const claves = Object.fromEntries(users.map(u => [u, randomBytes(24).toString('hex')]));
  const pass = path.join(dir, 'passwd'); await writeFile(pass, users.map(u => `${u}:${claves[u]}`).join('\n') + '\n');
  assert.equal((await iniciar('mosquitto_passwd', ['-U', pass]).done).code, 0);
  const port = await libre(), conf = user => path.join(dir, user + '.conf');
  for (const u of users) await writeFile(conf(u), `-h 127.0.0.1\n-p ${port}\n-u ${u}\n-P ${claves[u]}\n`);
  const config = (await readFile(path.join(root, 'mqtt', 'agrovigia.conf'), 'utf8'))
    .replace('listener 18883 127.0.0.1', `listener ${port} 127.0.0.1`).replace('password_file .local/mqtt/passwd', `password_file ${pass}`);
  const cfg = path.join(dir, 'broker.conf'); await writeFile(cfg, config);
  iniciar('mosquitto', ['-c', cfg]); await puertoListo(port);
  const f = filas()[0], p = prepararCapturaV3(captura(), { nodo_local: f.nodo_local, nodo_codigo: f.nodo_codigo, asignacion_version: f.asignacion_version });
  assert.ok(Buffer.byteLength(p.mensaje, 'utf8') > 2048);
  const opts = { binario: path.join(bin, 'mosquitto_pub.exe'), opciones: conf('simulador'), puerto: port };
  const sub = iniciar('mosquitto_sub', ['-o', conf('receptor'), '-V', 'mqttv5', '-t', p.topico, '-q', '1', '-C', '1', '-W', '6']);
  await pause(250);
  for (let i = 0; i < 5 && sub.exitCode === null; i++) { assert.equal((await publicarMqtt(p, opts)).estado, 'mqtt_confirmado'); await pause(150); }
  const got = await sub.done; assert.equal(got.code, 0); assert.deepEqual(JSON.parse(got.output.trim()), p.payload);
  for (const u of ['receptor', 'nodo_dht22', 'nodo_ldr']) await assert.rejects(publicarMqtt(p, { ...opts, opciones: conf(u) }), /no confirmó/);
  await assert.rejects(publicarMqtt({ ...p, topico: p.topico.replace('/simulado/', '/real/') }, opts), /no confirmó/);
  // Confirma ACK negativo aunque el ejecutable pueda salir con codigo cero.
  for (const [u, topic] of [['nodo_dht22', 'agrovigia/v2/real/nodos/agv-dht22-01/telemetria'],
    ['nodo_ldr', 'agrovigia/v2/real/nodos/agv-ambiente-02/telemetria'],
    ['simulador', 'agrovigia/v1/simulado/nodos/agv-dht22-01/telemetria']]) {
    assert.equal((await publicarMqtt({ topico: topic, mensaje: 'PRUEBA_ACL_AISLADA_SIN_TELEMETRIA' }, { ...opts, opciones: conf(u) })).estado, 'mqtt_confirmado');
  }
  const retenido = await iniciar('mosquitto_pub', ['-o', conf('simulador'), '-V', 'mqttv5', '-q', '1', '-d', '-t', p.topico, '-r', '-m', 'PRUEBA_RETAIN_AISLADA']).done;
  assert.match(retenido.output, /sending PUBLISH \(d0, q1, r0/);
  await comprobarRetainForzado(port, claves.simulador, p.topico);
  assert.equal((await publicarMqtt({ topico: p.topico, mensaje: 'x'.repeat(8192) }, opts)).estado, 'mqtt_confirmado');
  const exceso = await iniciar('mosquitto_pub', ['-o', conf('simulador'), '-V', 'mqttv5', '-q', '1', '-d', '-t', p.topico, '-m', 'x'.repeat(8193)]).done;
  assert.ok(exceso.code !== 0 || /RC:149/.test(exceso.output));
  assert.doesNotMatch(exceso.output, /received PUBACK[^\r\n]*RC:(0|16)\)/);
  console.log('MQTT v3 OK: diez variables UTF-8 completas >2KB, QoS1, ACL separadas, ACK negativo detectado, retain/8193 rechazados y v1/v2 compatibles. Broker aislado; no guardado remoto.');
} finally {
  clearTimeout(timer);
  for (const p of children) if (p.exitCode === null) p.kill();
  await Promise.allSettled(children.map(p => p.done));
}
