import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import path from 'node:path';
import { vinculosDeMapa } from '../transporte-mqtt.mjs';
import { crearApiMqtt } from '../api-mqtt.mjs';

// Mapa con la forma que exporta local/agrovigia.sh mapa (sin claves).
const ZONAS = ['zona-norte', 'zona-sur', 'zona-central', 'zona-drenaje', 'zona-norte', 'zona-sur'];
function mapa() {
  const filas = [];
  for (const [plantilla, cultivo, n] of [['platano', '52ea4628-c470-48f4-a09a-0f9a697d22b4', 5], ['yuca', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 6]]) {
    const zonas = ZONAS.slice(0, 4).map(() => randomUUID());
    for (let i = 1; i <= n; i++) filas.push({ nodo_codigo: 'sim-' + cultivo.replaceAll('-', '').slice(0, 12) + '-' + String(i).padStart(2, '0'),
      asignacion_version: randomUUID(), plantilla, cultivo: plantilla, zona: 'Sector', cultivo_id: cultivo, zona_id: zonas[(i - 1) % 4 === i - 1 ? i - 1 : (i - 1) % 2],
      zona_codigo: ZONAS[i - 1], habilitado: true, variables_simuladas: 10 });
  }
  return filas;
}

test('mapa del panel: los nodos 01 a 04 del cultivo elegido, uno por sector, validados como al pegarlos', () => {
  const filas = vinculosDeMapa(mapa(), 'Yuca');
  assert.deepEqual(filas.map(f => f.nodo_local), ['sim-zona-01', 'sim-zona-02', 'sim-zona-03', 'sim-zona-04']);
  assert.ok(filas.every((f, i) => f.nodo_codigo.endsWith('-0' + (i + 1)) && f.nodo_codigo.startsWith('sim-cccccccccccc-')));
  assert.equal(vinculosDeMapa(mapa(), 'Plátano')[0].nodo_codigo, 'sim-52ea4628c470-01');
  assert.throws(() => vinculosDeMapa(mapa(), 'Maíz'), /cultivo con plantilla/);
  assert.throws(() => vinculosDeMapa(mapa(), 'Mango'), /no tiene el nodo 01/);
  const malo = mapa().map(f => ({ ...f, variables_simuladas: 3 }));
  assert.throws(() => vinculosDeMapa(malo, 'Yuca'), /diez variables/);
});

test('ruta /api/mapa: lee el mapa local, exige origen local y no expone claves', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agv-panel-')), archivo = path.join(dir, 'nodos.json');
  writeFileSync(archivo, JSON.stringify(mapa()));
  const api = crearApiMqtt(async () => ({}), { archivoMapa: archivo });
  const server = createServer(async (req, res) => { const route = new URL(req.url, 'http://x').pathname; if (!(await api(req, res, route))) { res.writeHead(404); res.end(); } });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const r = await fetch(base + '/api/mapa?cultivo=' + encodeURIComponent('Plátano'));
    assert.equal(r.status, 200);
    const { filas } = await r.json();
    assert.equal(filas.length, 4); assert.ok(!/password|clave|-P /i.test(JSON.stringify(filas)));
    const cruzado = await fetch(base + '/api/mapa?cultivo=Yuca', { headers: { 'Sec-Fetch-Site': 'cross-site' } });
    assert.equal(cruzado.status, 403); await cruzado.text();
    rmSync(archivo);
    const sinMapa = await fetch(base + '/api/mapa?cultivo=Yuca');
    assert.equal(sinMapa.status, 400); assert.match((await sinMapa.json()).error, /agrovigia\.sh mapa/);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); rmSync(dir, { recursive: true, force: true }); }
});
