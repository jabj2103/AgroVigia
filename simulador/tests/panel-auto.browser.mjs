// QA del envio automatico del panel: elegir cultivo, prellenar sus valores, cargar su mapa local y
// publicar cada captura (manual y de secuencia) sin pausar la secuencia. Publicador ficticio: sin broker.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createPanelServer } from '../server.mjs';
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { chromium } = require('playwright-core');
const chrome = process.env.AGROVIGIA_CHROME ?? ['/usr/bin/google-chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
if (!chrome) throw new Error('Se necesita Chrome, o AGROVIGIA_CHROME.');
const cultivo = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', prefijo = 'sim-cccccccccccc-';
const sectores = ['zona-norte', 'zona-sur', 'zona-central', 'zona-drenaje'], zonas = sectores.map(() => randomUUID());
const mapa = Array.from({ length: 6 }, (_, i) => ({ nodo_codigo: prefijo + String(i + 1).padStart(2, '0'), asignacion_version: randomUUID(), plantilla: 'yuca',
  cultivo: 'Simulado · Yuca', zona: 'Sector', cultivo_id: cultivo, zona_id: zonas[i % 4], zona_codigo: sectores[i % 4], habilitado: true, variables_simuladas: 10 }));
const dir = mkdtempSync(path.join(tmpdir(), 'agv-panel-auto-')), archivoMapa = path.join(dir, 'nodos.json');
writeFileSync(archivoMapa, JSON.stringify(mapa));
const publicados = [];
let server, browser;
try {
  server = createPanelServer({ archivoMapa, publicar: async p => { publicados.push(p.payload); await new Promise(r => setTimeout(r, 30));
    return { estado: 'mqtt_confirmado', codigo: 'PUBACK_RECIBIDO', persistido: null, nodo_codigo: p.payload.nodo_codigo }; } });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } }), errores = [];
  page.on('pageerror', e => errores.push(e.message));
  await page.goto(base); await page.locator('#mqtt-status').filter({ hasText: 'Pega las cuatro filas' }).waitFor();
  assert.equal(await page.locator('#mqtt-auto').isDisabled(), true, 'sin mapeo no hay envio automatico');
  // Cultivo con plantilla: prellena sus valores y carga sus cuatro nodos desde el mapa local.
  await page.locator('#crop').selectOption('Yuca'); await page.locator('#reset').click();
  await page.getByText('valores de referencia de Yuca', { exact: false }).first().waitFor();
  await page.locator('#mqtt-mapa').click();
  await page.locator('#mqtt-status').filter({ hasText: 'Nodos de Yuca configurados' }).waitFor();
  await page.locator('#mqtt-auto').check();
  // Captura manual: se publica sola.
  await page.locator('#capture').click();
  await page.waitForFunction(() => /1 capturas confirmadas/.test(document.getElementById('mqtt-status').textContent));
  // Secuencia de lluvia en todos los puntos cada 2 s: cada paso se publica y la secuencia sigue.
  await page.locator('button[data-escenario="lluvia"]').click();
  await page.locator('#scope').selectOption('all'); await page.locator('#interval').selectOption('2');
  await page.locator('#auto').click();
  await page.waitForFunction(() => /(5|6|7|8|9) capturas confirmadas/.test(document.getElementById('mqtt-status').textContent), null, { timeout: 15000 });
  assert.equal(await page.locator('#auto').innerText(), 'Pausar secuencia', 'el envio automatico no pausa la secuencia');
  await page.locator('#auto').click();
  assert.ok(publicados.length >= 5);
  assert.ok(publicados.every(p => p.nodo_codigo.startsWith(prefijo) && p.origen === 'simulado' && p.version === 3));
  assert.deepEqual([...new Set(publicados.slice(1).map(p => p.nodo_codigo))].sort(), [1, 2, 3, 4].map(i => prefijo + '0' + i), 'un nodo por sector');
  assert.ok(publicados.slice(1).every(p => p.simulacion.escenario_id === 'lluvia' && p.simulacion.modo === 'escenario'));
  assert.equal(new Set(publicados.map(p => p.mensaje_id)).size, publicados.length, 'UUID nuevo por captura');
  // Al desactivarlo deja de publicar.
  await page.locator('#mqtt-auto').uncheck(); const antes = publicados.length;
  await page.locator('#capture').click(); await page.waitForTimeout(400);
  assert.equal(publicados.length, antes);
  assert.deepEqual(errores, []);
  console.log(`QA panel automatico OK: Yuca prellenada, mapa local de 4 nodos, ${publicados.length} capturas publicadas en orden (manual y secuencia) sin pausar, y se detiene al desactivarlo.`);
} finally { if (browser) await browser.close(); if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); } rmSync(dir, { recursive: true, force: true }); }
