import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const images = path.resolve(web, '../.local/qa-zonas'); mkdirSync(images, { recursive: true });
const chrome = process.env.AGROVIGIA_CHROME ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
let server, browser;
try {
  server = await createServer({ root: web, configFile: path.join(web, 'vite.config.ts'), cacheDir: path.resolve(web, '../.local/vite-qa-zones'), server: { host: '127.0.0.1', port: 5187, strictPort: true, open: false }, plugins: [{ name: 'qa-zones', configureServer(s) {
    s.middlewares.use('/__zonas_qa', async (_req, res, next) => { try {
      const html = await s.transformIndexHtml('/__zonas_qa', '<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/zones-fixture.tsx"></script></body></html>');
      res.setHeader('Content-Type', 'text/html'); res.end(html);
    } catch (e) { next(e); } });
  } }] }); await server.listen();
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = [], externos = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://**/*', r => { externos.push(r.request().url()); return r.abort(); });
  await page.goto('http://127.0.0.1:5187/__zonas_qa');
  await page.getByRole('heading', { name: 'agv-fisico-01', exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.qaZonas.requests.filter(u => u.includes('/zonas?')).length)), 0);
  await page.getByRole('button', { name: 'Zonas y nodos', exact: true }).click();
  await page.getByRole('heading', { name: 'sim-bbbbbbbbbbbb-01', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.variable-zona').length === 10);
  assert.equal(await page.locator('.contador-sin-actualizar').count(), 0);
  assert.equal(await page.locator('.zona-croquis').count(), 4); assert.equal(await page.locator('.nodo-croquis').count(), 4);
  assert.equal(await page.locator('.variable-zona .procedencia-zona.simulada').count(), 10);
  for (const width of [360, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 }); await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
    if ([390, 1440].includes(width)) { await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: path.join(images, `zonas-${width}.png`), fullPage: true }); }
  }
  await page.getByRole('button', { name: 'Seleccionar nodo sim-bbbbbbbbbbbb-02, simulado', exact: true }).click();
  await page.getByRole('heading', { name: 'sim-bbbbbbbbbbbb-02', exact: true }).waitFor();
  const central = page.getByRole('button', { name: 'Seleccionar zona Sector central', exact: true });
  await central.focus(); await central.press('Enter');
  await page.getByRole('heading', { name: 'sim-bbbbbbbbbbbb-03', exact: true }).waitFor();
  await page.getByLabel('Tipo de nodo', { exact: true }).selectOption('fisico');
  await page.getByLabel('Zona', { exact: true }).selectOption('sin-ubicar');
  await page.getByRole('heading', { name: 'agv-fisico-01', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.variable-zona').length === 3);
  assert.equal(await page.locator('.variable-zona .procedencia-zona.real').count(), 3); assert.equal(await page.locator('.nodo-croquis').count(), 0);
  await page.getByLabel('Tipo de nodo', { exact: true }).selectOption('virtual'); await page.getByLabel('Zona', { exact: true }).selectOption('todas');
  await page.waitForFunction(() => document.querySelectorAll('.variable-zona').length === 10);
  await page.evaluate(() => { window.qaZonas.errorLectura = true; }); await page.getByRole('button', { name: 'Actualizar zonas', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'No pudimos consultar' }).waitFor(); assert.equal(await page.locator('.variable-zona').count(), 10);
  await page.evaluate(() => { window.qaZonas.errorLectura = false; window.qaZonas.antigua('cccccccc-cccc-4ccc-8ccc-ccccccccccc0'); });
  await page.getByRole('button', { name: 'Actualizar zonas', exact: true }).click(); await page.getByText('Datos desactualizados', { exact: true }).waitFor();
  await page.evaluate(() => window.qaZonas.futuro('cccccccc-cccc-4ccc-8ccc-ccccccccccc0'));
  await page.getByRole('button', { name: 'Actualizar zonas', exact: true }).click(); await page.getByText('Revisar reloj', { exact: true }).waitFor();
  await page.evaluate(() => window.qaZonas.mover()); await page.getByRole('button', { name: 'Actualizar zonas', exact: true }).click();
  await page.getByText('Esta captura corresponde a una ubicación o asignación anterior.', { exact: false }).waitFor();
  await page.evaluate(() => { window.qaZonas.vacio = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3'; });
  await page.getByRole('button', { name: 'Seleccionar nodo sim-bbbbbbbbbbbb-04, simulado', exact: true }).click();
  await page.getByText('Sin datos simulados', { exact: true }).waitFor(); assert.equal(await page.locator('.variable-zona').count(), 0);
  await page.getByLabel('CULTIVO SELECCIONADO', { exact: true }).selectOption('ffffffff-ffff-4fff-8fff-ffffffffffff');
  await page.getByText('Este cultivo todavía no tiene zonas configuradas.', { exact: false }).waitFor(); assert.equal(await page.locator('.nodo-croquis').count(), 0); assert.equal(await page.locator('.variable-zona').count(), 0);
  await page.getByRole('navigation', { name: 'Secciones', exact: true }).getByRole('button', { name: 'Dispositivos', exact: true }).click();
  const cardVirtual = page.locator('.tarjeta-cultivo').filter({ has: page.getByRole('heading', { name: 'sim-bbbbbbbbbbbb-01', exact: true }) });
  await cardVirtual.waitFor(); assert.equal(await cardVirtual.getByRole('button', { name: 'Desvincular', exact: true }).count(), 0);
  await cardVirtual.getByText('Nodo virtual · Simulada.', { exact: false }).waitFor();
  const libre = page.locator('.tarjeta-cultivo').filter({ has: page.getByRole('heading', { name: 'agv-fisico-02', exact: true }) });
  await libre.getByRole('button', { name: 'Vincular a cultivo', exact: true }).click();
  assert.equal(await page.getByLabel('Cultivo de destino', { exact: true }).locator('option').count(), 2, 'Los cuatro virtuales no consumen el límite de dos físicos.');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('navigation', { name: 'Secciones', exact: true }).getByRole('button', { name: 'Inicio', exact: true }).click();
  await page.evaluate(() => window.qaZonas.cambiarCuenta()); await page.getByRole('heading', { name: 'No tienes cultivos activos', exact: true }).waitFor();
  assert.equal(await page.locator('.zona-croquis').count(), 0); assert.equal(await page.locator('.detalle-zona').count(), 0);
  assert.deepEqual(errors, []); assert.deepEqual(externos, []);
  console.log('QA zonas OK: croquis 4 sectores, marcadores/teclado/lista, diez simuladas y tres reales sin ubicar, error conservando captura, antigüedad/reloj, asignación anterior, ausencia, cambio de cultivo/cuenta y 360/390/768/1280/1440px. Fixtures; sin servicios remotos.');
} finally { if (browser) await browser.close(); if (server) await server.close(); }
