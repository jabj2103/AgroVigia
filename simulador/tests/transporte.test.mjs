import test from 'node:test';
import assert from 'node:assert/strict';
import { createPanelServer } from '../server.mjs';
import { validarVinculos } from '../transporte-mqtt.mjs';
import { filas, captura } from './fixtures.mjs';

async function servidor(t, publicar) {
  const s = createPanelServer({ publicar });
  await new Promise(resolve => s.listen(0, '127.0.0.1', resolve));
  t.after(async () => { s.closeAllConnections(); await new Promise(resolve => s.close(resolve)); });
  const base = `http://127.0.0.1:${s.address().port}`;
  const estado = await (await fetch(base + '/api/estado')).json();
  const post = (route, data, headers = {}) => fetch(base + route, { method: 'POST', headers: {
    Origin: base, 'Content-Type': 'application/json', 'X-Agrovigia-Token': estado.token, ...headers,
  }, body: typeof data === 'string' ? data : JSON.stringify(data) });
  return { base, estado, post };
}
test('mapeo exige cuatro zonas distintas del mismo cultivo y diez capacidades', () => {
  const f = filas(); assert.equal(validarVinculos(f).length, 4);
  for (const mutate of [x => x.pop(), x => { x[1] = x[0]; }, x => { x[0].habilitado = false; },
    x => { x[0].variables_simuladas = 9; }, x => { x[0].nodo_codigo = 'agv-dht22-01'; },
    x => { x[0].zona_id = x[1].zona_id; }, x => { x[0].asignacion_version = 'otra'; },
    x => { x[0].cultivo_id = x[1].zona_id; }]) {
    const x = structuredClone(f); mutate(x); assert.throws(() => validarVinculos(x));
  }
});
test('API local rechaza origen/token/tamaño y no publica sin mapeo', async t => {
  let calls = 0; const { base, post } = await servidor(t, async () => { calls++; });
  assert.equal((await post('/api/vinculos', filas(), { Origin: 'https://externo.invalid' })).status, 403);
  assert.equal((await post('/api/vinculos', filas(), { 'X-Agrovigia-Token': 'otro' })).status, 403);
  assert.equal((await post('/api/publicar', captura())).status, 400);
  assert.equal((await post('/api/vinculos', 'x'.repeat(16385))).status, 413);
  assert.equal((await fetch(base + '/.local/mqtt/simulador.conf')).status, 404);
  assert.equal(calls, 0);
});
test('API conserva UUID/fecha en reintento, bloquea remapeo y no afirma guardado', async t => {
  const enviados = [];
  const { post } = await servidor(t, async p => {
    enviados.push(p); return { estado: 'mqtt_confirmado', persistido: null, comprobacion_supabase: 'pendiente' };
  });
  assert.equal((await post('/api/vinculos', filas())).status, 200);
  const c = captura();
  for (let i = 0; i < 2; i++) {
    const r = await post('/api/publicar', c); assert.equal(r.status, 200);
    const data = await r.json(); assert.equal(data.mensaje_id, c.mensaje_id); assert.equal(data.persistido, null);
  }
  assert.deepEqual(enviados[0], enviados[1]); assert.equal(enviados[0].payload.mediciones.length, 10);
  assert.equal(enviados[0].payload.tomada_en, c.tomada_en);
  assert.equal((await post('/api/vinculos', filas())).status, 409);
});
test('captura antigua, real o adulterada no llega al publicador', async t => {
  let calls = 0; const { post } = await servidor(t, async () => { calls++; });
  await post('/api/vinculos', filas());
  const old = captura(); old.tomada_en = new Date(Date.now() - 301000).toISOString();
  const real = captura(); real.origen = 'real';
  const extra = captura(); extra.cultivo_id = filas()[0].cultivo_id;
  for (const c of [old, real, extra]) assert.equal((await post('/api/publicar', c)).status, 400);
  assert.equal(calls, 0);
});
test('no superpone publicaciones y distingue fallo MQTT de éxito', async t => {
  let terminar;
  const { post } = await servidor(t, () => new Promise((_, reject) => { terminar = () => reject(new Error('MQTT no confirmó.')); }));
  await post('/api/vinculos', filas());
  const primera = post('/api/publicar', captura());
  for (let i = 0; i < 50 && !terminar; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(terminar);
  const segunda = await post('/api/publicar', captura()); assert.equal(segunda.status, 409);
  terminar(); const r = await primera; assert.equal(r.status, 502); assert.equal((await r.json()).persistido, null);
});
