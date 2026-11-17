// Integracion con el Mosquitto local (Docker, ACL v3 y limite 8192). Requiere local/agrovigia.sh iniciar.
// El estado sale de un archivo ficticio: no necesita Supabase. Solo datos simulados.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mqtt from 'mqtt';
import { credenciales } from '../servicio.mjs';
import { prepararIngestaSimulada } from '../../n8n/preparar-simulada.mjs';
import { estadoFicticio } from './fixtures-clima.mjs';
const { prevalidarAmbiental } = createRequire(import.meta.url)('../../n8n/validar-ambiental.cjs');

const aqui = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), raiz = path.resolve(aqui, '..');
const broker = process.env.AGROVIGIA_MQTT_URL ?? 'mqtt://127.0.0.1:18883';
const cred = u => credenciales(path.join(raiz, `.local/mqtt/${u}.conf`));
const conectar = (u, extra = {}) => mqtt.connectAsync(broker, { ...cred(u), clean: true, reconnectPeriod: 0, connectTimeout: 5000, ...extra });

test('un ciclo con lluvia en el platano: 17 lotes v3 y la proyeccion v2 del fisico llegan por QoS 1 y son validos para n8n', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agv-estado-')), archivo = path.join(dir, 'estado.json');
  const estado = estadoFicticio({ clima: { evento: 'lluvia', intensidad: 3, iniciado_en: new Date(Date.now() - 200_000).toISOString() } });
  writeFileSync(archivo, JSON.stringify(estado));
  const receptor = await conectar('receptor'), recibidos = [];
  receptor.on('message', (topic, payload, packet) => recibidos.push({ topic, texto: payload.toString('utf8'), retain: packet.retain, qos: packet.qos }));
  await receptor.subscribeAsync(['agrovigia/v3/simulado/nodos/+/telemetria', 'agrovigia/v2/simulado/nodos/+/telemetria'], { qos: 1 });
  try {
    const sim = spawn(process.execPath, ['servicio.mjs', '--una-vez', '--estado', archivo], { cwd: aqui, stdio: ['ignore', 'pipe', 'pipe'] });
    let salida = ''; sim.stdout.on('data', d => { salida += d; }); sim.stderr.on('data', d => { salida += d; });
    assert.equal(await new Promise(r => sim.on('exit', r)), 0, salida);
    const codigos = estado.cultivos.flatMap(c => c.nodos.map(n => n.codigo)), limite = Date.now() + 5000;
    const propios = () => recibidos.filter(m => codigos.some(c => m.topic.endsWith(`/nodos/${c}/telemetria`)));
    while (propios().length < 18 && Date.now() < limite) await new Promise(r => setTimeout(r, 100));
    const v3 = propios().filter(m => m.topic.startsWith('agrovigia/v3/')), v2 = propios().filter(m => m.topic.startsWith('agrovigia/v2/'));
    assert.equal(v3.length, 17, salida); assert.equal(new Set(v3.map(m => m.topic)).size, 17); assert.equal(v2.length, 1, salida);
    for (const m of [...v3, ...v2]) { assert.equal(m.retain, false); assert.equal(m.qos, 1); }
    for (const m of v3) {
      const r = prepararIngestaSimulada({ topic: m.topic, message: m.texto, supabase_url: 'https://fixture-local.supabase.co' },
        { acl_verificada: true, retencion_broker_desactivada: true }, new Date().toISOString());
      assert.equal(r.estado, 'prevalidado', r.codigo);
      const p = JSON.parse(m.texto), enPlatano = m.topic.includes('sim-52ea4628c470-');
      assert.equal(p.simulacion.escenario_id, enPlatano ? 'lluvia' : 'referencia');
      assert.equal(p.mediciones.find(x => x.variable_codigo === 'precipitacion_60min').valor, enPlatano ? 55 : 0);
    }
    assert.equal(v2[0].topic, 'agrovigia/v2/simulado/nodos/agv-dht22-01/telemetria');
    const previo = prevalidarAmbiental({ topic: v2[0].topic, message: v2[0].texto });
    assert.equal(previo.estado, 'prevalidado', previo.codigo); assert.equal(previo.payload.origen, 'simulado');
    assert.equal((salida.match(/PUBACK/g) ?? []).length, 18);
  } finally { await receptor.endAsync(); rmSync(dir, { recursive: true, force: true }); }
});

test('ACL: el simulador no escribe en topicos reales ni proyecta nodos fisicos no previstos; el receptor no publica', async () => {
  const sim = await conectar('simulador', { protocolVersion: 5 }), rec = await conectar('receptor', { protocolVersion: 5 });
  try {
    for (const t of ['agrovigia/v3/real/nodos/sim-52ea4628c470-01/telemetria', 'agrovigia/v2/real/nodos/agv-dht22-01/telemetria', 'agrovigia/v2/simulado/nodos/otro-fisico-99/telemetria'])
      await assert.rejects(sim.publishAsync(t, 'X', { qos: 1 }), /135|Not authorized/i, t);
    await assert.rejects(rec.publishAsync('agrovigia/v3/simulado/nodos/sim-52ea4628c470-01/telemetria', 'X', { qos: 1 }), /135|Not authorized/i);
  } finally { await sim.endAsync(); await rec.endAsync(); }
});
