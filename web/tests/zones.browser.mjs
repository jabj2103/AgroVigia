// QA del Inicio de E2 con el fixture de zonas: resumen, croquis, lista por sector y detalle de nodo.
// Conserva las comprobaciones de integridad de la antigua vista de zonas. Solo fixtures; sin servicios remotos.
import assert from 'node:assert/strict';
import { elegir, opcionesDe, valorDe } from './selector-qa.mjs';
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
  const dialogo = page.locator('dialog.dialogo-panel');
  const fila = codigo => page.locator('.fila-nodo').filter({ has: page.getByText(codigo, { exact: true }) });
  const abrir = async codigo => { await fila(codigo).click(); await dialogo.getByRole('heading', { name: codigo, exact: true }).waitFor(); };
  const cerrar = async () => { await page.keyboard.press('Escape'); await dialogo.waitFor({ state: 'detached' }); };
  const consultarDeNuevo = () => dialogo.getByRole('button', { name: 'Consultar de nuevo', exact: true }).click();

  // 1. Inicio sin conmutador: resumen, croquis de cuatro sectores y lista con los cinco nodos (cuatro simulados y uno real sin ubicar).
  await fila('agv-fisico-01').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Zonas y nodos', exact: true }).count(), 0, 'sin conmutador de vistas');
  // Visor 3D de Simulación como elemento principal: un cultivo, sus cuatro sectores y una etiqueta por nodo. Sin croquis plano.
  await page.locator('.escena-inicio canvas').waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.escena-inicio .etiqueta-nodo').length === 5 && document.querySelectorAll('.escena-inicio .etiqueta-sector').length === 4);
  assert.equal(await page.locator('.zona-croquis').count(), 0); assert.equal(await page.locator('.escena-inicio .etiqueta-cultivo').count(), 1);
  assert.equal(await page.locator('.fila-nodo').count(), 5);
  assert.equal(await page.locator('.fila-nodo .procedencia-zona.simulada').count(), 4); assert.equal(await page.locator('.fila-nodo .procedencia-zona.real').count(), 1);
  await page.getByText('Sin alertas activas con datos reales', { exact: true }).waitFor();
  await page.getByText('Sin alertas activas con datos simulados', { exact: true }).waitFor();
  assert.ok(await page.getByText('Eso no confirma que el cultivo esté sano.', { exact: false }).count() >= 1, 'ausencia de alertas sin inferir salud');
  await page.getByText('Aún no hay sugerencias para este cultivo.', { exact: false }).waitFor();
  for (const width of [360, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 }); await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
    if ([390, 1440].includes(width)) { await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: path.join(images, `inicio-${width}.png`), fullPage: true }); }
  }
  await page.setViewportSize({ width: 390, height: 844 });

  // 2. La fila abre el detalle del nodo (pantalla completa en el teléfono) con sus diez variables simuladas.
  await abrir('sim-bbbbbbbbbbbb-02');
  await page.waitForFunction(() => document.querySelectorAll('dialog .variable-zona').length === 10);
  assert.equal(await dialogo.locator('.variable-zona .procedencia-zona.simulada').count(), 10);
  await dialogo.getByText('Ninguna alerta activa en este nodo.', { exact: false }).waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(images, 'detalle-390.png') });
  await cerrar();

  // 3. En el teléfono la página se sigue desplazando sobre el visor (un dedo no gira el dibujo).
  assert.equal(await page.locator('.escena-inicio .capa-etiquetas').evaluate(e => e.style.touchAction), 'pan-y');

  // 4. Nodo físico sin ubicar: tres variables reales.
  await abrir('agv-fisico-01');
  await page.waitForFunction(() => document.querySelectorAll('dialog .variable-zona').length === 3);
  assert.equal(await dialogo.locator('.variable-zona .procedencia-zona.real').count(), 3);
  await cerrar();

  // 5. Error conservando la captura, antigüedad, reloj adelantado y ubicación anterior (nodo sim-01).
  await abrir('sim-bbbbbbbbbbbb-01'); await page.waitForFunction(() => document.querySelectorAll('dialog .variable-zona').length === 10);
  await page.evaluate(() => { window.qaZonas.errorLectura = true; }); await consultarDeNuevo();
  await dialogo.getByRole('alert').filter({ hasText: 'No pudimos consultar' }).waitFor(); assert.equal(await dialogo.locator('.variable-zona').count(), 10);
  await dialogo.getByText('Se conserva la última captura consultada', { exact: false }).waitFor();
  await page.evaluate(() => { window.qaZonas.errorLectura = false; window.qaZonas.antigua('cccccccc-cccc-4ccc-8ccc-ccccccccccc0'); });
  await consultarDeNuevo(); await dialogo.getByText('Datos desactualizados', { exact: true }).waitFor();
  await page.evaluate(() => window.qaZonas.futuro('cccccccc-cccc-4ccc-8ccc-ccccccccccc0'));
  await consultarDeNuevo(); await dialogo.getByText('Revisar reloj', { exact: true }).waitFor();
  await cerrar();
  await page.evaluate(() => window.qaZonas.mover()); await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
  await page.waitForTimeout(400); await abrir('sim-bbbbbbbbbbbb-01');
  await dialogo.getByText('Esta captura corresponde a una ubicación o asignación anterior.', { exact: false }).waitFor();
  await cerrar();

  // 6. Nodo sin capturas: «Sin datos simulados» en el detalle y «Sin recibir todavía» en la lista, sin inventar valores.
  await page.evaluate(() => { window.qaZonas.vacio = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3'; }); await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
  await fila('sim-bbbbbbbbbbbb-04').getByText('Sin recibir todavía', { exact: false }).waitFor();
  await page.getByText('sim-bbbbbbbbbbbb-04: sin recibir todavía', { exact: true }).waitFor();
  await abrir('sim-bbbbbbbbbbbb-04'); await dialogo.getByText('Sin datos simulados', { exact: true }).waitFor(); assert.equal(await dialogo.locator('.variable-zona').count(), 0);
  await cerrar();

  // 7. Desde el detalle, Historial se abre con ese nodo elegido.
  await abrir('sim-bbbbbbbbbbbb-02');
  await dialogo.getByRole('button', { name: 'Ver historial de este nodo', exact: true }).click();
  await page.getByRole('heading', { name: 'Historial y estadísticas', exact: true }).waitFor();
  assert.equal(await valorDe(page, '#hist-nodo'), 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1');
  await page.getByRole('navigation', { name: 'Navegación móvil' }).getByRole('button', { name: 'Inicio', exact: true }).click();
  await fila('agv-fisico-01').waitFor();

  // 8. Cultivo sin nodos, Dispositivos sin acciones físicas para virtuales y cambio de cuenta.
  await elegir(page, '#cultivo', 'ffffffff-ffff-4fff-8fff-ffffffffffff');
  await page.getByRole('heading', { name: 'Este cultivo no tiene nodos vinculados', exact: true }).waitFor();
  assert.equal(await page.locator('.nodo-croquis').count(), 0); assert.equal(await page.locator('.fila-nodo').count(), 0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('navigation', { name: 'Secciones', exact: true }).getByRole('button', { name: 'Dispositivos', exact: true }).click();
  const cardVirtual = page.locator('.tarjeta-cultivo').filter({ has: page.getByRole('heading', { name: 'sim-bbbbbbbbbbbb-01', exact: true }) });
  await cardVirtual.waitFor(); assert.equal(await cardVirtual.getByRole('button', { name: 'Desvincular', exact: true }).count(), 0);
  await cardVirtual.getByText('Nodo virtual · Simulada.', { exact: false }).waitFor();
  const libre = page.locator('.tarjeta-cultivo').filter({ has: page.getByRole('heading', { name: 'agv-fisico-02', exact: true }) });
  await libre.getByRole('button', { name: 'Vincular a cultivo', exact: true }).click();
  assert.equal((await opcionesDe(page, '#destino-nodo')).opciones.length, 2, 'Los cuatro virtuales no consumen el límite de dos físicos.');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('navigation', { name: 'Secciones', exact: true }).getByRole('button', { name: 'Inicio', exact: true }).click();
  // En escritorio el detalle es un panel lateral.
  await elegir(page, '#cultivo', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'); await abrir('sim-bbbbbbbbbbbb-02');
  const caja = await dialogo.boundingBox(); assert.ok(caja && caja.x > 900 && caja.width < 520, 'panel lateral derecho en escritorio');
  await page.waitForTimeout(400); // fin de la animacion de apertura
  await page.screenshot({ path: path.join(images, 'detalle-1440.png') });
  await cerrar();
  await page.evaluate(() => window.qaZonas.cambiarCuenta()); await page.getByRole('heading', { name: 'No tienes cultivos activos', exact: true }).waitFor();
  assert.equal(await page.locator('.zona-croquis').count(), 0); assert.equal(await page.locator('.fila-nodo').count(), 0);
  assert.deepEqual(errors, []); assert.deepEqual(externos, []);

  // 9. Sin WebGL: aviso y croquis plano como alternativa, con marcadores y sectores que funcionan con teclado.
  const sinGl = await chromium.launch({ executablePath: chrome, headless: true, args: ['--disable-3d-apis', '--disable-webgl'] });
  try {
    const p2 = await sinGl.newPage({ viewport: { width: 390, height: 844 } }), errores2 = [];
    p2.on('pageerror', e => errores2.push(e.message)); await p2.route('https://**/*', r => r.abort());
    await p2.goto('http://127.0.0.1:5187/__zonas_qa');
    await p2.getByText('Este navegador no permite gráficos 3D (WebGL).', { exact: false }).waitFor();
    assert.equal(await p2.locator('.zona-croquis').count(), 4); assert.equal(await p2.locator('.nodo-croquis').count(), 4);
    await p2.locator('.croquis').getByRole('button', { name: /^sim-bbbbbbbbbbbb-02, simulado/ }).click();
    await p2.locator('dialog.dialogo-panel').getByRole('heading', { name: 'sim-bbbbbbbbbbbb-02', exact: true }).waitFor();
    await p2.keyboard.press('Escape');
    const central = p2.getByRole('button', { name: 'Ver solo Sector central', exact: true });
    await central.focus(); await central.press('Enter');
    await p2.getByRole('heading', { name: 'Nodos de Sector central', exact: true }).waitFor(); assert.equal(await p2.locator('.fila-nodo').count(), 1);
    assert.deepEqual(errores2, []);
  } finally { await sinGl.close(); }
  console.log('QA Inicio/zonas OK: visor 3D principal y croquis plano sin WebGL, sin conmutador, resumen sin inferir salud, croquis 4 sectores y lista de 5 nodos, marcador y sector con teclado, detalle 10 simuladas y 3 reales, error conservando captura, antigüedad/reloj, ubicación anterior, nodo sin datos, historial con el nodo elegido, cultivo sin nodos, panel lateral en escritorio, cambio de cuenta y 360/390/768/1280/1440px. Fixtures; sin servicios remotos.');
} finally { if (browser) await browser.close(); if (server) await server.close(); }
