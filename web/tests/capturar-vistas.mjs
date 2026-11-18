// Capturas de todas las vistas de la demo (escritorio y telefono) y, con --html, copias HTML con el CSS
// en linea para pasarlas por los gates de ux-ui-agent-skills. No usa servicios reales.
// Uso: node tests/capturar-vistas.mjs <carpeta-salida> [--html]
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), out = path.resolve(process.argv[2] ?? 'capturas'), conHtml = process.argv.includes('--html');
mkdirSync(out, { recursive: true });
const m = await import(pathToFileURL(createRequire(web + '/package.json').resolve('playwright-core')).href);
const chromium = m.chromium ?? m.default.chromium;
const PAGINA = '<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>AgroVigía</title></head><body><!-- screen-economy: endless-motion El punto de Recibiendo titila mientras el nodo recibe datos. Es un indicador de estado en vivo y se detiene con movimiento reducido. --><div id="root"></div><script type="module" src="/tests/ia-fixture.tsx"></script></body></html>';
const server = await createServer({ root: web, configFile: path.join(web, 'vite.config.ts'), logLevel: 'error', cacheDir: path.resolve(web, '../.local/vite-captura'), server: { host: '127.0.0.1', port: 5196, strictPort: true },
  plugins: [{ name: 'captura', configureServer(s) { s.middlewares.use('/demo', async (_q, res, next) => { try { res.setHeader('Content-Type', 'text/html'); res.end(await s.transformIndexHtml('/demo', PAGINA)); } catch (e) { next(e); } }); } }] });
await server.listen();
const navegador = await chromium.launch({ executablePath: process.env.AGROVIGIA_CHROME ?? '/usr/bin/google-chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errores = [];
const copia = async (p, nombre, soloDialogo = false) => { if (!conHtml) return; writeFileSync(`${out}/${nombre}.html`, await p.evaluate(solo => {
  const d = document.documentElement.cloneNode(true); d.querySelectorAll('script,canvas,link[rel=modulepreload]').forEach(x => x.remove());
  if (solo) { const dlg = d.querySelector('dialog[open]'), cuerpo = d.querySelector('body'); cuerpo.innerHTML = ''; dlg.style.position = 'static'; dlg.style.margin = '1rem auto'; dlg.style.maxHeight = 'none'; cuerpo.appendChild(dlg); }
  return '<!doctype html>' + d.outerHTML; }, soloDialogo)); };
const VISTAS = ['Inicio', 'Sugerencias', 'Simulación', 'Alertas', 'Historial', 'Cultivos', 'Dispositivos'];
try {
  for (const [ancho, alto, tag] of [[1280, 900, 'e'], [390, 844, 'm']]) {
    const p = await navegador.newPage({ viewport: { width: ancho, height: alto } }); p.on('pageerror', e => errores.push(tag + ': ' + e.message));
    await p.route('https://**/*', r => r.abort());
    await p.goto('http://127.0.0.1:5196/'); await p.locator('.acceso').waitFor({ timeout: 15000 }).catch(() => errores.push(tag + ': sin pantalla de acceso')); await p.waitForTimeout(300);
    await p.screenshot({ path: `${out}/${tag}-0-acceso.png`, fullPage: true }); if (tag === 'e') await copia(p, 'acceso');
    await p.goto('http://127.0.0.1:5196/demo'); await p.locator('#cultivo').waitFor();
    // E1: en el teléfono, Cultivos, Dispositivos y Simulación se abren desde «Más».
    const nav = async nombre => {
      if (ancho < 900 && ['Cultivos', 'Dispositivos', 'Simulación'].includes(nombre)) {
        await p.getByRole('navigation', { name: 'Navegación móvil' }).getByRole('button', { name: /^Más/ }).click();
        return p.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: nombre, exact: true }).click();
      }
      return p.getByRole('navigation', { name: ancho < 900 ? 'Navegación móvil' : 'Secciones' }).getByRole('button', { name: nombre, exact: true }).click();
    };
    // Primero el Escenario, para dejar activos una lluvia y un ajuste manual que las demas vistas reflejan.
    for (const v of ['Simulación', ...VISTAS.filter(x => x !== 'Simulación')]) {
      const i = VISTAS.indexOf(v) + 1;
      try {
        await nav(v); await p.waitForTimeout(900);
        if (v === 'Simulación') {
          await p.locator('.esc-grupo').first().waitFor();
          await p.locator('.esc-clima').first().getByRole('radio', { name: 'Lluvia fuerte' }).check(); await p.getByRole('button', { name: 'Aplicar clima' }).click();
          await p.locator('.etiqueta-cultivo[data-clima=lluvia]').waitFor();
          const regla = p.locator('#regla-ph_suelo'); await regla.focus(); for (let k = 0; k < 6; k++) await p.keyboard.press('ArrowLeft');
          await p.getByRole('button', { name: 'Aplicar ajuste' }).click(); await p.getByText('Ajuste aplicado', { exact: false }).waitFor(); await p.waitForTimeout(1200);
        }
        if (v === 'Historial') { const c = p.getByRole('button', { name: /Consultar/ }); if (await c.count()) { await c.first().click(); await p.waitForTimeout(1200); } }
        if (v === 'Sugerencias') { const b = p.getByRole('button', { name: 'Datos simulados' }); if (await b.count()) { await b.click(); await p.waitForTimeout(600); } }
        await p.screenshot({ path: `${out}/${tag}-${i}-${v.toLowerCase()}.png`, fullPage: true }); if (tag === 'e') await copia(p, v.toLowerCase());
        if (v === 'Cultivos') {
          await p.locator('.tarjeta-cultivo', { hasText: 'Lote Plátano QA' }).getByRole('button', { name: 'Terreno y sectores' }).click(); await p.locator('.terreno-plano svg').waitFor(); await p.waitForTimeout(500);
          await p.getByRole('button', { name: 'Ubicar agv-dht22-01' }).click(); await p.waitForTimeout(300);
          await p.screenshot({ path: `${out}/${tag}-${i}-terreno.png`, fullPage: true }); if (tag === 'e') await copia(p, 'terreno');
          await p.getByRole('button', { name: 'Volver a mis cultivos' }).click();
        }
        if (v === 'Inicio') { await p.getByRole('button', { name: 'Zonas y nodos' }).click(); await p.waitForTimeout(1200); await p.screenshot({ path: `${out}/${tag}-${i}-zonas.png`, fullPage: true }); if (tag === 'e') await copia(p, 'zonas'); await p.getByRole('button', { name: 'Lecturas reales' }).click(); }
        if (v === 'Simulación') {
          await p.locator('.ficha-nodo', { hasText: 'agv-dht22-01' }).click(); await p.locator('dialog[open] .dlg-datos').first().waitFor(); await p.waitForTimeout(400);
          await p.screenshot({ path: `${out}/${tag}-${i}-escenario-nodo.png` }); if (tag === 'e') await copia(p, 'dialogo-nodo', true); await p.keyboard.press('Escape');
          await p.getByRole('button', { name: 'Parámetros del cultivo' }).click(); await p.locator('dialog[open] .rangos-grupo').first().waitFor(); await p.waitForTimeout(300);
          await p.screenshot({ path: `${out}/${tag}-${i}-escenario-parametros.png` }); if (tag === 'e') await copia(p, 'dialogo-parametros', true); await p.keyboard.press('Escape');
        }
      } catch (e) { errores.push(`${tag} ${v}: ${String(e.message).split('\n')[0]}`); }
    }
    await p.close();
  }
} finally { console.log('errores:', JSON.stringify(errores)); await navegador.close(); await server.close(); }
