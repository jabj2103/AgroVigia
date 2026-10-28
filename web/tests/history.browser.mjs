// Chrome headless, perfil temporal propio y fixtures. No lee sesiones del usuario.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const capturas = path.resolve(web, '../.local/qa-historial');
const chrome = process.env.AGROVIGIA_CHROME ?? [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
if (!chrome) throw new Error('No se encontro Chrome/Edge. Indicar AGROVIGIA_CHROME; no se descarga un navegador.');
let server, browser;
try {
  server = await createServer({ root: web, configFile: path.join(web, 'vite.config.ts'), cacheDir: path.resolve(web, '../.local/vite-qa-history'),
    server: { host: '127.0.0.1', port: 5183, strictPort: true, open: false },
    plugins: [{ name: 'agv-history-qa', configureServer(s) {
      s.middlewares.use('/__history_qa', async (_req,res,next) => {
        try {
          const html = await s.transformIndexHtml('/__history_qa', '<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/history-fixture.tsx"></script></body></html>');
          res.setHeader('Content-Type','text/html'); res.end(html);
        } catch(e) { next(e); }
      });
    } }] });
  await server.listen();
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errores = []; page.on('pageerror', e => errores.push(e.message));
  await page.goto('http://127.0.0.1:5183/__history_qa');
  await page.locator('.estadisticas-historial dd').first().getByText('45', { exact: true }).waitFor();
  assert.equal(await page.locator('tbody tr').count(),20);
  const canvas = await page.locator('canvas').boundingBox();
  assert.ok(canvas.width > 100 && canvas.height > 100);
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await page.getByText('21–40 de 45', { exact: true }).waitFor();
  await page.locator('#hist-variable').selectOption('iluminacion_relativa');
  await page.getByRole('button', { name: 'Consultar historial', exact: true }).click();
  await page.getByRole('heading', { name: 'Iluminación relativa', exact: true }).waitFor();
  await page.getByText('1–20 de 45', { exact: true }).waitFor();
  mkdirSync(capturas,{recursive:true});
  await page.screenshot({ path: path.join(capturas,'escritorio.png'), fullPage:true });
  await page.evaluate(() => { window.qaError=true; });
  await page.getByRole('button', { name: 'Consultar historial', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.ok((await page.getByRole('alert').innerText()).includes('resultado anterior'));
  assert.equal(await page.locator('.estadisticas-historial dd').first().innerText(),'45');
  await page.evaluate(() => { window.qaError=false; });
  await page.locator('#hist-variable').selectOption('humedad_aire');
  await page.getByRole('button', { name: 'Consultar historial', exact: true }).click();
  await page.getByRole('heading', { name: 'No hay mediciones reales en este período' }).waitFor();
  assert.equal(await page.locator('.estadisticas-historial').count(),0);
  await page.locator('#hist-nodo').selectOption('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  await page.locator('#hist-variable').selectOption('temperatura_aire');
  await page.getByRole('button', { name: 'Consultar historial', exact: true }).click();
  await page.getByText('Nodo: agv-prueba-02', { exact:true }).waitFor();
  assert.ok((await page.locator('.estadisticas-historial dd').nth(1).innerText()).startsWith('30'));
  await page.setViewportSize({ width:390,height:844 });
  await page.waitForFunction(() => document.documentElement.scrollWidth <= window.innerWidth, undefined, { timeout: 4000 }).catch(async e => {
    console.log(await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > window.innerWidth + 1).map(el => ({ tag:el.tagName, clase:el.className, ancho:el.getBoundingClientRect().width, derecha:el.getBoundingClientRect().right })).slice(0,12)));
    await page.screenshot({ path:path.join(capturas,'movil.png'),fullPage:true }); throw e;
  });
  await page.screenshot({ path:path.join(capturas,'movil.png'),fullPage:true });
  await page.getByRole('button',{name:'Cuenta sin nodos',exact:true}).click();
  await page.getByRole('heading',{name:'No hay nodos compatibles para consultar'}).waitFor();
  assert.equal(await page.locator('canvas').count(),0);
  assert.equal(await page.locator('.resultado-historial').count(),0);
  const solicitudes = await page.evaluate(() => window.qaSolicitudes);
  assert.ok(solicitudes.length > 5);
  for (const u of solicitudes.map(u => new URL(u))) {
    assert.equal(u.searchParams.get('origen'),'eq.real');
    assert.equal(u.searchParams.get('cultivo_id'),'eq.bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  }
  assert.deepEqual(errores,[]);
  console.log('QA navegador OK: grafica, filtros, paginacion, error conservando resultado, vacio, dos nodos ficticios, cambio de cuenta y movil sin desbordamiento. Solo fixtures; no prueba Auth/API remoto.');
} finally {
  if (browser) await browser.close();
  if (server) await server.close();
}