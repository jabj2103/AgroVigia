// QA en navegador de IA, plantillas, datos simulados y red 3D con datos inventados. Sin servicios remotos.
import assert from 'node:assert/strict';
import { elegir, opcionesDe } from './selector-qa.mjs';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const images = path.resolve(web, '../.local/qa-ia'); mkdirSync(images, { recursive: true });
const chrome = process.env.AGROVIGIA_CHROME ?? ['/usr/bin/google-chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
let server, browser;
try {
  server = await createServer({ root: web, configFile: path.join(web, 'vite.config.ts'), cacheDir: path.resolve(web, '../.local/vite-qa-ia'),
    server: { host: '127.0.0.1', port: 5187, strictPort: true, open: false }, plugins: [{ name: 'qa-ia', configureServer(s) { s.middlewares.use('/__ia_qa', async (_req, res, next) => {
      try { const html = await s.transformIndexHtml('/__ia_qa', '<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/ia-fixture.tsx"></script></body></html>');
        res.setHeader('Content-Type', 'text/html'); res.end(html); } catch (e) { next(e); } }); } }] });
  await server.listen();
  // SwiftShader: WebGL por software en headless, igual que un equipo sin GPU.
  browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('https://**/*', r => r.abort());
  // La demo cambia los valores poco a poco; aqui se aplica de una vez para no esperar la transicion.
  await page.addInitScript(() => { window.qaTransicionMs = 0; });
  await page.goto('http://127.0.0.1:5187/__ia_qa');
  await page.locator('#cultivo').waitFor();
  const nav = page.getByRole('navigation', { name: 'Navegación móvil' });

  const P = 'sim-bbbbbbbbbbbb-', Y = 'sim-cccccccccccc-', H = 'sim-dddddddddddd-';
  // Inicio muestra cada nodo simulado con sus valores; el que aun no envia queda sin dato.
  const notasVirtuales = () => page.waitForFunction(() => document.querySelectorAll('.sim-nodo').length === 6 && [...document.querySelectorAll('.sim-nodo')].filter(x => /\d/.test(x.querySelector('dd')?.textContent ?? '')).length === 6);
  const visibles = sel => page.evaluate(q => [...document.querySelectorAll(q)].filter(e => e.style.display !== 'none').length, sel);

  // 1. Cultivo de nodos virtuales: Inicio > Lecturas reales lista cada nodo simulado con sus seis valores principales.
  await elegir(page, '#cultivo', { label: 'Simulado · Yuca' });
  await notasVirtuales();

  // 2. Cultivo mixto (fisico + 5 simulados): IA separa origenes con un selector; nunca los mezcla.
  await elegir(page, '#cultivo', { label: 'Lote Plátano QA' });
  await nav.getByRole('button', { name: 'IA', exact: true }).click();
  const origenes = page.getByRole('group', { name: 'Origen de los datos' });
  await origenes.getByRole('button', { name: 'Datos reales', exact: true, pressed: true }).waitFor();
  await page.getByText('Requiere atención', { exact: true }).first().waitFor();
  await page.getByText('Ver datos usados', { exact: true }).click(); await page.getByText('agv-dht22-01:', { exact: false }).waitFor();
  await origenes.getByRole('button', { name: 'Datos simulados', exact: true }).click();
  await origenes.getByRole('button', { name: 'Datos simulados', exact: true, pressed: true }).waitFor();
  await page.locator('.tarjeta-sugerencia .recomendacion').nth(1).waitFor(); // espera la carga tras cambiar de origen
  assert.equal(await page.locator('.tarjeta-sugerencia .recomendacion').count(), 2);
  await page.getByText('Agua y riego', { exact: false }).waitFor();
  await page.getByText('no reemplazan la asistencia técnica', { exact: false }).waitFor();
  await page.getByText('Ver datos usados', { exact: true }).click(); await page.getByText(P + '02:', { exact: false }).waitFor();
  await page.screenshot({ path: path.join(images, 'sugerencias-movil.png'), fullPage: true });
  // Fallo del ultimo intento: se informa y se conserva la ultima sugerencia valida, marcada como antigua.
  await page.evaluate(() => { window.qaIA = 'fallida'; }); await page.getByRole('button', { name: 'Actualizar sugerencias', exact: true }).click();
  await page.getByText('límite de uso o saldo agotado', { exact: false }).first().waitFor();
  await page.getByText('puede no reflejar la condición actual', { exact: false }).waitFor();
  await page.evaluate(() => { window.qaIA = 'vacia'; }); await page.getByRole('button', { name: 'Actualizar sugerencias', exact: true }).click();
  await page.getByRole('heading', { name: 'Aún no hay sugerencias para este cultivo' }).waitFor();
  await page.evaluate(() => { window.qaIA = 'generada'; });

  // 3. Plantillas en Alertas > Reglas: confirmacion obligatoria y el origen elegido viaja en la RPC.
  await nav.getByRole('button', { name: 'Alertas', exact: true }).click();
  const aplicarCon = async origen => {
    await page.getByRole('group', { name: 'Origen de los datos' }).getByRole('button', { name: origen === 'real' ? 'Datos reales' : 'Datos simulados', exact: true }).click();
    await page.getByRole('button', { name: 'Reglas', exact: true }).click();
    await elegir(page, '#plantilla', 'platano');
    const aplicar = page.getByRole('button', { name: 'Aplicar plantilla', exact: true });
    assert.equal(await aplicar.isDisabled(), true);
    await page.getByText('Entiendo que son rangos orientativos', { exact: false }).click(); await aplicar.click();
    await page.getByText('Plantilla aplicada', { exact: false }).waitFor();
    return (await page.evaluate(() => window.qaCalls)).filter(c => c.name === 'aplicar_plantilla_cultivo').at(-1).args;
  };
  assert.deepEqual(await aplicarCon('real'), { p_cultivo_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', p_plantilla: 'platano', p_configurar_reglas: true, p_origen: 'real' });
  assert.equal((await aplicarCon('simulado')).p_origen, 'simulado');

  // 4. Historial: nodos del cultivo primero, comparacion del hexagono simulado y estadisticas frente a la plantilla.
  await nav.getByRole('button', { name: 'Historial', exact: true }).click();
  await page.locator('.linea-contexto .etiqueta-origen', { hasText: 'Datos reales y simulados' }).waitFor();
  await page.locator('.cabecera-historial', { hasText: 'DATOS REALES' }).waitFor();
  assert.equal((await opcionesDe(page, '#hist-nodo')).grupos[0], 'En este cultivo');
  await elegir(page, '#hist-nodo', 'todos:simulado');
  await page.getByRole('button', { name: 'Consultar historial', exact: true }).click();
  await page.getByRole('heading', { name: 'Estadísticas por nodo' }).waitFor();
  await page.locator('.cabecera-historial', { hasText: 'DATOS SIMULADOS' }).waitFor();
  assert.equal(await page.locator('[aria-label="Estadísticas por nodo"] tbody tr').count(), 5);
  await page.getByRole('heading', { name: 'Frente a la plantilla Plátano' }).waitFor();
  assert.match(await page.locator('[aria-label="Estadísticas por nodo"] tbody tr', { hasText: P + '02' }).innerText(), /Sube \(\+/);
  await elegir(page, '#hist-nodo', { label: P + '02 (simulado)' });
  await page.getByRole('button', { name: 'Consultar historial', exact: true }).click();
  await page.locator('.estadisticas-historial .tendencia', { hasText: 'Sube' }).waitFor();
  await page.locator('.barras-plantilla li', { hasText: 'En el óptimo' }).waitFor();
  // Humedad del suelo (solo nodos virtuales v3): franja y porcentajes frente al rango de suelo de la plantilla.
  await elegir(page, '#hist-variable', 'humedad_suelo_vwc');
  await page.getByRole('button', { name: 'Consultar historial', exact: true }).click();
  await page.getByRole('heading', { name: 'Humedad del suelo', exact: true }).waitFor();
  await page.locator('.frente-plantilla', { hasText: '30 a 40 % VWC' }).waitFor();
  // En vivo: disponible para periodos relativos; con fechas elegidas a mano se deshabilita.
  const enVivo = page.getByLabel('Actualizar en vivo cada 30 s', { exact: false });
  assert.equal(await enVivo.isDisabled(), false); await enVivo.check();
  await page.getByText('En vivo: la gráfica y las estadísticas se recalculan', { exact: false }).waitFor();
  await elegir(page, '#hist-periodo', 'personalizado'); assert.equal(await enVivo.isDisabled(), true);
  await elegir(page, '#hist-periodo', '1h');
  await page.screenshot({ path: path.join(images, 'historial-movil.png'), fullPage: true });

  // Dispositivos por cultivo y sector: el fisico sin sector; virtuales con su ultima recepcion simulada.
  await nav.getByRole('button', { name: 'Dispositivos', exact: true }).click();
  const platanoDisp = page.getByRole('region', { name: 'Dispositivos de Lote Plátano QA' });
  await platanoDisp.waitFor();
  await platanoDisp.locator('.sector-dispositivos', { hasText: 'Sin sector (físicos)' }).locator('h2', { hasText: 'agv-dht22-01' }).waitFor();
  const norte = platanoDisp.locator('.sector-dispositivos').filter({ has: page.locator('h3', { hasText: 'Sector norte' }) });
  assert.deepEqual(await norte.locator('.tarjeta-cultivo h2').allInnerTexts(), [P + '01', P + '05']);
  await norte.getByText('Última recepción simulada', { exact: false }).first().waitFor();
  assert.equal(await page.locator('.grupo-dispositivos').count(), 3);
  await page.screenshot({ path: path.join(images, 'dispositivos-movil.png'), fullPage: true });

  // 5. Escenario: un hexagono por cultivo, WebGL dibujando, nodos en tres tonos y detalle en dialogo.
  await nav.getByRole('button', { name: 'Escenario', exact: true }).click();
  await page.locator('.escena-red canvas').waitFor();
  await page.locator('.esc-resumen', { hasText: '16 de 18' }).waitFor();
  await page.locator('.esc-barra .pastilla-tono', { hasText: 'Consulta cada 10 s' }).waitFor();
  // three.js solo inserta en la pagina las etiquetas visibles: en movil, las 6 del cultivo elegido.
  await page.waitForFunction(() => document.querySelectorAll('.etiqueta-cultivo').length === 3 && [...document.querySelectorAll('.etiqueta-nodo')].filter(e => e.style.display !== 'none').length === 6);
  assert.equal(await page.locator('.etiqueta-cultivo.activo').innerText().then(t => t.includes('Lote Plátano QA')), true);
  assert.equal(await page.locator('.etiqueta-nodo.central').innerText().then(t => t.includes('agv-dht22-01')), true);
  assert.equal(await page.locator('.esc-grupo').count(), 3);
  assert.deepEqual(await page.locator('.ficha-nodo[data-tono=no_recibe] strong').allInnerTexts(), ['sim-06', 'sim-06'], 'sin recibir: el atrasado y el que nunca envio');
  const webgl = await page.evaluate(() => { const c = document.querySelector('.escena-red canvas'); const g = c.getContext('webgl2') ?? c.getContext('webgl'); return !!g && c.width > 0; });
  assert.equal(webgl, true, 'WebGL debe estar activo');
  await page.waitForTimeout(800);
  // El lienzo no esta vacio. Se copia en el mismo cuadro, justo despues del render.
  const pintado = await page.evaluate(() => new Promise(res => requestAnimationFrame(() => {
    const c = document.querySelector('.escena-red canvas'), o = document.createElement('canvas'); o.width = c.width; o.height = c.height;
    const x = o.getContext('2d'); x.drawImage(c, 0, 0); const d = x.getImageData(0, 0, o.width, o.height).data; const colores = new Set();
    for (let i = 0; i < d.length; i += 4 * 97) if (d[i + 3] > 0) colores.add((d[i] >> 3) + ',' + (d[i + 1] >> 3) + ',' + (d[i + 2] >> 3));
    res(colores.size); })));
  assert.ok(pintado > 15, 'la escena 3D debe dibujar los hexagonos y sus nodos (colores distintos: ' + pintado + ')');
  const llamada = async nombre => (await page.evaluate(() => window.qaCalls)).filter(c => c.name === nombre).at(-1)?.args;
  const dialogo = page.locator('dialog.dialogo-agv[open]');
  const grupo = nombre => page.getByRole('region', { name: 'Nodos de ' + nombre });

  // 6. Clima simulado: evento e intensidad, icono sobre el cultivo y proyeccion del nodo fisico.
  const clima = page.locator('.esc-clima');
  assert.equal(await clima.getByRole('button', { name: 'Volver a clima normal' }).isDisabled(), true, 'sin cambio no hay nada que aplicar');
  await clima.getByRole('radio', { name: 'Lluvia fuerte' }).check();
  await clima.getByRole('radio', { name: 'Extremo' }).check();
  await clima.getByRole('button', { name: 'Aplicar clima', exact: true }).click();
  await clima.getByText('Lluvia fuerte activo en un cultivo', { exact: false }).waitFor();
  assert.deepEqual(await llamada('establecer_clima'), { p_cultivo_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', p_evento: 'lluvia', p_intensidad: 3, p_todos: false });
  await page.locator('.esc-clima-activo[data-clima=lluvia]', { hasText: 'Lluvia fuerte · Extremo' }).waitFor();
  await page.locator('.etiqueta-cultivo[data-clima=lluvia] .clima-etiqueta', { hasText: 'Lluvia fuerte' }).waitFor();
  assert.equal(await page.locator('.etiqueta-cultivo[data-clima=lluvia]').count(), 1, 'solo el cultivo elegido');
  await grupo('Lote Plátano QA').locator('.ficha-nodo', { hasText: 'agv-dht22-01' }).click();
  await dialogo.getByRole('heading', { name: 'agv-dht22-01' }).waitFor();
  await dialogo.getByText('Lecturas reales del sensor.', { exact: false }).waitFor();
  await dialogo.getByRole('heading', { name: 'Con el evento simulado: Lluvia fuerte' }).waitFor();
  await dialogo.getByText('La lectura real guardada no cambia.', { exact: false }).waitFor();
  assert.equal(await dialogo.locator('.dlg-proyeccion .dlg-datos > div').count(), 3);
  // Dispositivo del fisico: perfil Arduino Uno en modo manual.
  await dialogo.getByRole('radio', { name: 'Arduino Uno' }).check();
  await dialogo.getByText('todavía no tiene firmware probado', { exact: false }).waitFor();
  await dialogo.getByRole('radio', { name: 'Manual' }).check();
  await dialogo.getByRole('radio', { name: 'USB serie con equipo puente a MQTT' }).waitFor();
  await dialogo.locator('#dlg-intervalo').fill('5'); await dialogo.getByRole('button', { name: 'Guardar dispositivo' }).click();
  await dialogo.getByText('El intervalo va de 10 a 3600', { exact: false }).waitFor();
  await dialogo.locator('#dlg-intervalo').fill('120'); await dialogo.getByRole('button', { name: 'Guardar dispositivo' }).click();
  await dialogo.getByText('Configuración manual guardada.', { exact: false }).waitFor();
  assert.deepEqual(await llamada('configurar_dispositivo'), { p_nodo_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', p_tipo: 'arduino_uno', p_protocolo: 'serie_puente_mqtt', p_intervalo: 120 });
  await dialogo.getByText('Se espera un lote cada 120 s', { exact: false }).waitFor();
  await page.keyboard.press('Escape'); await dialogo.waitFor({ state: 'detached' });

  // 7. Nodo virtual: las diez variables que envia y pausa de recepcion desde el dialogo.
  await grupo('Lote Plátano QA').locator('.ficha-nodo', { hasText: 'sim-02' }).click();
  await dialogo.getByText('Nodo virtual · Lote Plátano QA · Sector sur', { exact: false }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('dialog[open] .dlg-seccion:first-of-type .dlg-datos > div').length === 10);
  assert.match(await dialogo.locator('.dlg-datos > div', { hasText: 'Lluvia en los últimos 60 min' }).innerText(), /37,5/);
  const interruptor = dialogo.getByRole('switch', { name: 'Recepción de datos de este nodo' });
  assert.equal(await interruptor.getAttribute('aria-checked'), 'true');
  await interruptor.focus(); await page.keyboard.press('Space');
  await dialogo.getByText('Recepción en pausa: sus lotes se rechazan', { exact: false }).waitFor();
  assert.equal((await llamada('pausar_nodo')).p_pausar, true);
  await dialogo.locator('.dlg-estado .pastilla-tono', { hasText: 'En pausa' }).waitFor();
  await dialogo.getByRole('button', { name: 'Cerrar' }).click();
  await grupo('Lote Plátano QA').locator('.ficha-nodo[data-tono=inactivo]', { hasText: 'sim-02' }).waitFor();
  await page.locator('.esc-resumen', { hasText: '15 de 18' }).waitFor();
  await grupo('Lote Plátano QA').locator('.ficha-nodo', { hasText: 'sim-02' }).click();
  await dialogo.getByRole('switch').click(); await dialogo.getByText('Recepción reanudada.', { exact: false }).waitFor();
  await page.keyboard.press('Escape');
  // Estados sin recibir, en otros cultivos.
  await grupo('Hortalizas de clima cálido').locator('.ficha-nodo', { hasText: 'sim-06' }).click();
  await dialogo.locator('.dlg-estado', { hasText: 'Sin recibir todavía' }).waitFor(); await dialogo.getByText('Todavía no hay datos guardados', { exact: false }).waitFor();
  await page.keyboard.press('Escape');

  // 8. Parametros del cultivo: catalogo como base, validacion y guardado con reglas.
  await page.getByRole('button', { name: 'Parámetros del cultivo' }).click();
  await dialogo.getByText('Lote Plátano QA · usa la plantilla Plátano', { exact: false }).waitFor();
  assert.equal(await dialogo.locator('#rango-suelo_vwc_optima_min').inputValue(), '30');
  await dialogo.getByRole('radio', { name: 'Yuca' }).check();
  assert.equal(await dialogo.locator('#rango-suelo_vwc_optima_min').inputValue(), '20', 'el catalogo carga sus valores como base');
  await dialogo.locator('#rango-temperatura_max').fill('20'); await dialogo.getByRole('button', { name: 'Guardar parámetros' }).click();
  await dialogo.getByText('Temperatura del aire: el orden debe ser', { exact: false }).waitFor();
  await dialogo.locator('#rango-temperatura_max').fill('33,5'); await dialogo.getByRole('radio', { name: 'Datos simulados' }).check();
  await dialogo.getByRole('button', { name: 'Guardar parámetros' }).click();
  await dialogo.getByText('Parámetros guardados para este cultivo.', { exact: false }).waitFor();
  const ajuste = await llamada('ajustar_parametros_cultivo');
  assert.equal(ajuste.p_parametros.temperatura_max, 33.5); assert.equal(Object.keys(ajuste.p_parametros).length, 12); assert.deepEqual([ajuste.p_configurar_reglas, ajuste.p_origen], [true, 'simulado']);
  await dialogo.getByText('con ajuste propio', { exact: false }).waitFor();
  await dialogo.getByRole('button', { name: 'Volver a la plantilla Plátano' }).waitFor();
  await page.keyboard.press('Escape');

  // 9. Ajustes del usuario y clima para todos los cultivos.
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await dialogo.getByRole('radio', { name: '5 segundos' }).check(); await dialogo.getByRole('radio', { name: 'Todos mis cultivos' }).check();
  await dialogo.getByRole('button', { name: 'Guardar ajustes' }).click(); await dialogo.waitFor({ state: 'detached' });
  assert.deepEqual(await llamada('guardar_preferencias'), { p_tiempo_real: false, p_refresco_segundos: 5, p_clima_alcance: 'todos' });
  await page.locator('.esc-barra .pastilla-tono', { hasText: 'Consulta cada 5 s' }).waitFor();
  assert.equal(await clima.getByRole('checkbox', { name: 'Aplicar a todos mis cultivos' }).isChecked(), true);
  await clima.getByRole('radio', { name: 'Normal' }).check(); await clima.getByRole('button', { name: 'Volver a clima normal' }).click();
  await clima.getByText('Clima normal. Los nodos vuelven', { exact: false }).waitFor();
  assert.equal((await llamada('establecer_clima')).p_todos, true);
  await page.waitForFunction(() => document.querySelectorAll('.etiqueta-cultivo .clima-etiqueta').length === 0);
  // Elegir otro cultivo con los radios y abrir sus lecturas desde el dialogo de un nodo.
  await page.locator('.esc-cultivos').getByRole('radio', { name: 'Yuca' }).check();
  await page.waitForFunction(() => document.querySelector('.etiqueta-cultivo.activo')?.textContent.includes('Yuca'));
  await page.screenshot({ path: path.join(images, 'escenario-movil.png'), fullPage: true });
  await grupo('Yuca').locator('.ficha-nodo', { hasText: 'sim-06' }).click();
  await dialogo.locator('.dlg-estado', { hasText: 'Sin recibir' }).waitFor();
  await dialogo.getByRole('button', { name: 'Ver historial del cultivo' }).click();
  await page.getByRole('heading', { name: 'Historial y estadísticas' }).waitFor();

  for (const width of [360, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    for (const v of ['IA', 'Escenario', 'Historial', 'Dispositivos']) {
      const boton = width < 900 ? nav.getByRole('button', { name: v, exact: true }) : page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: v, exact: true });
      await boton.click(); await page.waitForTimeout(250);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `sin desborde ${v} a ${width}px`);
    }
  }
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Escenario', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.etiqueta-nodo')].filter(e => e.style.display !== 'none').length === 18, null, { timeout: 5000 });
  assert.equal(await page.locator('.etiqueta-cultivo.activo').innerText().then(t => t.includes('Yuca')), true, 'el hexagono del cultivo abierto queda resaltado');
  await page.screenshot({ path: path.join(images, 'escenario-escritorio.png'), fullPage: true });
  // 10. Simulacion manual, alertas, IA a peticion, nodos simulados y cultivos (escritorio, cultivo Yuca).
  const lateral = page.getByRole('navigation', { name: 'Secciones' }), ir = v => lateral.getByRole('button', { name: v, exact: true }).click();
  const regla = page.locator('#regla-humedad_suelo_vwc'); await regla.focus(); for (let k = 0; k < 20; k++) await page.keyboard.press('ArrowLeft');
  assert.equal(await regla.inputValue(), '-20', 'la regla baja con el teclado desde el centro');
  await page.getByRole('button', { name: 'Aplicar ajuste' }).click(); await page.getByText('Ajuste aplicado en', { exact: false }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.qaCalls.findLast(x => x.name === 'ajustar_simulacion').args.p_ajustes), { humedad_suelo_vwc: -20 }, 'solo viajan los deltas distintos de cero');
  await page.locator('.etiqueta-cultivo.activo[data-efectos*="tierra_seca"]').waitFor();
  await page.locator('.esc-ajuste .esc-clima-activo[data-manual=true]', { hasText: 'Humedad del suelo' }).waitFor();
  await ir('Alertas'); await page.locator('.condiciones .condicion', { hasText: 'Ajuste manual' }).waitFor();
  await page.locator('.tarjeta-alerta.activa', { hasText: 'Humedad del suelo por debajo del mínimo' }).first().waitFor();
  await ir('Historial'); await page.locator('.registro-lista .condicion', { hasText: 'Ajuste manual' }).waitFor();
  await ir('IA'); await page.getByRole('button', { name: 'Analizar ahora' }).click(); await page.getByText('Análisis listo', { exact: false }).waitFor({ timeout: 30000 });
  await page.locator('.tarjeta-sugerencia', { hasText: 'Recuperar humedad del suelo' }).waitFor();
  await ir('Inicio'); await notasVirtuales();
  await ir('Cultivos'); const tarjetaYuca = page.locator('.tarjeta-cultivo', { hasText: 'Simulado · Yuca' });
  // Con mas de cuatro nodos la lista viene plegada para no alargar la pagina.
  assert.equal(await tarjetaYuca.locator('.nodos-cultivo li').count(), 0, 'la lista larga de nodos empieza plegada');
  await tarjetaYuca.getByRole('button', { name: 'Ver los 6 nodos' }).click(); await tarjetaYuca.locator('.nodos-cultivo li').nth(5).waitFor();
  await tarjetaYuca.getByRole('button', { name: 'Agregar nodo simulado' }).click(); await page.locator('dialog[open]').getByRole('button', { name: 'Crear nodo simulado' }).click();
  await page.getByText('Nodo simulado sim-cccccccccccc-07 creado', { exact: false }).waitFor(); await tarjetaYuca.locator('.nodos-cultivo li').nth(6).waitFor();
  // Mover el nodo nuevo a otro cultivo en un solo paso: conserva su codigo y aparece en el hexagono destino.
  await tarjetaYuca.getByRole('button', { name: 'Mover sim-cccccccccccc-07 a otro cultivo o sector' }).click();
  const mover = page.locator('dialog[open]'); await mover.getByRole('radio', { name: 'Simulado · Hortalizas de clima cálido' }).check(); await mover.getByRole('button', { name: 'Mover nodo' }).click();
  await page.getByText('sim-cccccccccccc-07 quedó en Simulado · Hortalizas', { exact: false }).waitFor();
  const hortalizas = page.locator('.tarjeta-cultivo', { hasText: 'Simulado · Hortalizas' });
  if (await hortalizas.locator('.nodos-alternar[aria-expanded=false]').count()) await hortalizas.locator('.nodos-alternar').click();
  await hortalizas.locator('.nodos-cultivo li', { hasText: 'sim-cccccccccccc-07' }).waitFor();
  assert.deepEqual(await page.evaluate(() => { const a = window.qaCalls.findLast(x => x.name === 'mover_nodo_virtual').args; return [typeof a.p_nodo_id, a.p_cultivo_id.slice(0, 8)]; }), ['string', 'dddddddd']);
  // Un cultivo con historial no se borra: el servidor lo rechaza y se ofrece archivar.
  await tarjetaYuca.getByRole('button', { name: 'Eliminar', exact: true }).click(); await page.locator('dialog[open]').getByRole('button', { name: 'Eliminar cultivo' }).click();
  await page.locator('dialog[open]').getByText('Para conservarlas no se borra', { exact: false }).waitFor();
  // Tras el rechazo, el boton rojo desaparece y se ofrece la salida segura, que abre la pantalla de archivar.
  assert.equal(await page.locator('dialog[open]').getByRole('button', { name: 'Eliminar cultivo' }).count(), 0);
  await page.locator('dialog[open]').getByRole('button', { name: 'Archivar en su lugar' }).click(); await page.getByRole('heading', { name: 'Archivar Simulado · Yuca' }).waitFor();
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await ir('Escenario'); await page.locator('.esc-grupo', { hasText: 'Hortalizas' }).locator('.ficha-nodo').nth(6).waitFor();
  await ir('Dispositivos'); const tarjetaNueva = page.locator('.tarjeta-cultivo').filter({ has: page.getByRole('heading', { name: 'sim-cccccccccccc-07', exact: true }) });
  await tarjetaNueva.getByRole('button', { name: 'Desvincular nodo simulado' }).click(); await page.getByText('sim-cccccccccccc-07 quedó sin cultivo', { exact: false }).waitFor();
  // Suelto se puede eliminar, con confirmacion.
  await tarjetaNueva.getByRole('button', { name: 'Eliminar', exact: true }).click(); await page.locator('dialog[open]').getByRole('button', { name: 'Eliminar nodo simulado' }).click();
  await page.getByText('sim-cccccccccccc-07 fue eliminado', { exact: false }).waitFor(); await tarjetaNueva.waitFor({ state: 'detached' });
  // 11. Terreno a escala: medidas reales, sector dibujado con el puntero y nodo fisico ubicado por distancias.
  await ir('Cultivos'); await page.locator('.tarjeta-cultivo', { hasText: 'Lote Plátano QA' }).getByRole('button', { name: 'Terreno y sectores' }).click();
  await page.locator('.terreno-plano svg').waitFor();
  await page.getByLabel('Ancho del terreno (m)').fill('200'); await page.getByLabel('Largo del terreno (m)').fill('50'); await page.getByRole('button', { name: 'Guardar medidas' }).click();
  await page.getByText('Terreno de 200 m por 50 m guardado', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Dibujar sector' }).click();
  const caja = await page.locator('.terreno-plano svg').boundingBox();
  await page.mouse.move(caja.x + caja.width * 0.1, caja.y + caja.height * 0.35); await page.mouse.down(); await page.mouse.move(caja.x + caja.width * 0.3, caja.y + caja.height * 0.6, { steps: 4 }); await page.mouse.up();
  await page.getByLabel('Nombre').fill('Vivero'); await page.getByRole('button', { name: 'Crear sector' }).click(); await page.getByText('Sector Vivero creado', { exact: false }).waitFor();
  const sector = await page.evaluate(() => window.qaCalls.findLast(x => x.name === 'crear_sector').args);
  assert.ok(Math.abs(sector.p_x - 0.1) < 0.02 && Math.abs(sector.p_ancho - 0.2) < 0.02 && sector.p_nombre === 'Vivero', 'el sector dibujado viaja como fraccion del terreno');
  await page.getByRole('button', { name: 'Ubicar agv-dht22-01' }).click();
  await page.getByLabel('Desde el borde izquierdo (m)').last().fill('40'); await page.getByLabel('Desde el borde superior (m)').last().fill('22'); await page.getByRole('button', { name: 'Guardar ubicación' }).click();
  await page.getByText('agv-dht22-01 ubicado en Vivero', { exact: false }).waitFor();
  await page.locator('.terreno-distancias li').first().waitFor();
  assert.match(await page.locator('.terreno-distancias li').first().innerText(), /\d+(,\d)? m/, 'muestra la distancia en metros al nodo mas cercano');
  await page.getByRole('button', { name: 'Eliminar sector' }).count();
  await page.getByRole('button', { name: 'Volver a mis cultivos' }).click();
  // Terreno cuadrado: el dibujo queda centrado y mas angosto que su caja. Cada trazo debe caer donde esta el puntero,
  // quedar a la vista mientras se le pone nombre y seguir en el plano despues de guardar.
  await page.locator('.tarjeta-cultivo', { hasText: 'Simulado · Yuca' }).getByRole('button', { name: 'Terreno y sectores' }).click(); await page.locator('.terreno-plano svg').waitFor();
  const fondo = await page.locator('.plano-fondo').boundingBox(), lienzo = await page.locator('.terreno-plano svg').boundingBox();
  assert.ok(lienzo.width - fondo.width > 40, 'en este tamano el dibujo es mas angosto que su caja');
  const trazar = async (x0, y0, x1, y1, nombre) => { await page.getByRole('button', { name: 'Dibujar sector' }).click(); await page.waitForTimeout(400); const f = await page.locator('.plano-fondo').boundingBox();
    await page.mouse.move(f.x + f.width * x0, f.y + f.height * y0); await page.mouse.down(); await page.mouse.move(f.x + f.width * x1, f.y + f.height * y1, { steps: 5 }); await page.mouse.up();
    await page.locator('.plano-trazo').waitFor(); await page.getByLabel('Nombre').fill(nombre); await page.getByRole('button', { name: 'Crear sector' }).click(); await page.getByText(`Sector ${nombre} creado`, { exact: false }).waitFor(); };
  await trazar(0.1, 0.1, 0.3, 0.3, 'Semillero'); await trazar(0.6, 0.55, 0.9, 0.9, 'Bodega');
  const creados = await page.evaluate(() => window.qaCalls.filter(x => x.name === 'crear_sector').slice(-2).map(x => [x.args.p_nombre, x.args.p_x, x.args.p_y, x.args.p_ancho, x.args.p_alto]));
  assert.ok(Math.abs(creados[0][1] - 0.1) < 0.01 && Math.abs(creados[0][3] - 0.2) < 0.01 && Math.abs(creados[1][1] - 0.6) < 0.01 && Math.abs(creados[1][4] - 0.35) < 0.01, 'cada sector queda donde se dibujo: ' + JSON.stringify(creados));
  await page.waitForTimeout(1500); assert.equal(await page.locator('.plano-sector').count(), 6, 'los dos sectores nuevos siguen en el plano junto a los cuatro por defecto');
  await page.getByRole('button', { name: 'Ubicar sim-cccccccccccc-01' }).click(); await page.getByRole('button', { name: 'Tocar en el plano' }).click();
  await page.waitForTimeout(400); const f2 = await page.locator('.plano-fondo').boundingBox();
  assert.ok(f2.y >= 0 && f2.y + f2.height <= 844, 'al pedir tocar en el plano, el plano completo queda a la vista: ' + JSON.stringify(f2) + ' ' + JSON.stringify(page.viewportSize())); await page.mouse.click(f2.x + f2.width * 0.75, f2.y + f2.height * 0.7);
  await page.getByText('sim-cccccccccccc-01 ubicado en Bodega', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Volver a mis cultivos' }).click();
  // En el Escenario el sector nuevo aparece dibujado al elegir ese cultivo.
  await ir('Escenario'); await page.locator('.esc-cultivos').getByRole('radio', { name: 'Lote Plátano QA' }).check();
  await page.locator('.etiqueta-sector', { hasText: 'Vivero' }).waitFor({ state: 'attached' });
  // 12. Nodo fisico: registro con clave propia y configuracion por USB contra la placa simulada de la demo.
  await ir('Dispositivos'); await page.getByRole('button', { name: '+ Registrar nodo físico' }).click();
  const asistente = page.locator('dialog[open]'); await asistente.getByRole('button', { name: 'Registrar nodo', exact: true }).click();
  await asistente.getByText('Nodo agv-esp4c1e-21 registrado', { exact: false }).waitFor();
  assert.equal(await asistente.getByText('clave-de-demostracion', { exact: false }).count(), 0, 'la clave del nodo nunca se muestra en pantalla');
  await asistente.getByText('Estás en la demo: aquí la placa es simulada', { exact: false }).waitFor(); assert.equal(await asistente.locator('esp-web-install-button').count(), 0, 'en la demo no se ofrece grabar firmware en la placa simulada');
  await asistente.getByRole('button', { name: 'Conectar placa' }).click(); await asistente.getByText('Placa conectada: firmware agv-http 1.0.0', { exact: false }).waitFor();
  await asistente.getByLabel('Red Wi-Fi').fill('Finca'); await asistente.getByLabel('Contraseña del Wi-Fi').fill('clave-wifi-1');
  await asistente.getByLabel('Dirección del servidor').fill('http://inseguro.example/webhook'); await asistente.getByRole('button', { name: 'Enviar configuración a la placa' }).click();
  await asistente.getByText('https:// en la nube', { exact: false }).waitFor();
  await asistente.getByLabel('Dirección del servidor').fill('https://n8n.example/webhook/agrovigia/nodo'); await asistente.getByRole('button', { name: 'Enviar configuración a la placa' }).click();
  await asistente.getByText('Configuración guardada en la placa', { exact: false }).waitFor(); await asistente.getByText('Conectada al Wi-Fi').waitFor();
  assert.equal(await asistente.getByLabel('Contraseña del Wi-Fi').inputValue(), '', 'la contrasena del Wi-Fi se borra del formulario al enviarla');
  await asistente.getByRole('button', { name: 'Leer sensores' }).click(); await asistente.getByText('29.4 °C', { exact: false }).waitFor();
  await asistente.getByRole('button', { name: 'Enviar un lote ahora' }).click(); await asistente.getByText('El servidor aceptó el lote', { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => window.qaCalls.some(x => JSON.stringify(x.args).includes('clave-wifi-1'))), false, 'la contrasena del Wi-Fi no viaja a Supabase');
  await asistente.getByRole('button', { name: 'Cerrar', exact: true }).last().click();
  await page.locator('.tarjeta-cultivo').filter({ has: page.getByRole('heading', { name: 'agv-esp4c1e-21', exact: true }) }).getByRole('button', { name: 'Configurar placa' }).waitFor();
  // 13. Filtros: buscador y desplegable propio en Dispositivos, Cultivos y Escenario.
  assert.equal(await page.locator('select').count(), 0, 'los filtros no usan el select del navegador');
  const filtrosD = page.getByRole('search', { name: 'Filtrar dispositivos' }), totalD = await page.locator('.tarjeta-cultivo').count();
  await filtrosD.getByLabel('Buscar dispositivo').fill('ESP4C1E'); await page.waitForFunction(() => document.querySelectorAll('.tarjeta-cultivo').length === 1);
  assert.match(await filtrosD.locator('.filtro-cuenta').innerText(), new RegExp('^1 de ' + totalD + '$'));
  await filtrosD.getByLabel('Buscar dispositivo').fill('no existe'); await page.getByRole('heading', { name: 'Ningún dispositivo coincide' }).waitFor();
  await page.getByRole('button', { name: 'Quitar filtros' }).click(); await page.waitForFunction(n => document.querySelectorAll('.tarjeta-cultivo').length === n, totalD);
  // El desplegable se abre, se recorre con el teclado y se cierra con Escape devolviendo el foco.
  const tipo = filtrosD.getByRole('button', { name: /^Tipo/ }); await tipo.click(); assert.equal(await tipo.getAttribute('aria-expanded'), 'true');
  await page.getByRole('option', { name: 'Solo físicos' }).waitFor(); await page.keyboard.press('Escape');
  assert.equal(await tipo.getAttribute('aria-expanded'), 'false'); assert.equal(await tipo.evaluate(b => b === document.activeElement), true, 'Escape devuelve el foco al boton');
  await tipo.focus(); await page.keyboard.press('ArrowDown'); await page.getByRole('listbox').waitFor(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  assert.match(await tipo.innerText(), /Solo físicos/); const fisicos = await page.locator('.tarjeta-cultivo').count();
  assert.ok(fisicos >= 1 && fisicos < totalD, 'el filtro por tipo deja solo los fisicos: ' + fisicos + ' de ' + totalD);
  assert.equal(await page.locator('.tarjeta-cultivo', { hasText: 'sim-cccccccccccc' }).count(), 0);
  // Con muchos cultivos el desplegable trae su propio buscador.
  const cultivoD = filtrosD.getByRole('button', { name: /^Cultivo/ }); await cultivoD.click(); await page.getByRole('option', { name: /Sin cultivo asignado|Simulado · Yuca/ }).first().waitFor();
  await page.screenshot({ path: path.join(images, 'filtros-desplegable.png') });
  await page.mouse.click(5, 5); assert.equal(await cultivoD.getAttribute('aria-expanded'), 'false', 'un clic fuera cierra el desplegable');
  await page.screenshot({ path: path.join(images, 'filtros-dispositivos.png'), fullPage: true });
  await ir('Cultivos'); const filtrosC = page.getByRole('search', { name: 'Filtrar cultivos' });
  await filtrosC.getByLabel('Buscar cultivo').fill('cccc-03'); await page.waitForFunction(() => document.querySelectorAll('.tarjeta-cultivo').length === 1);
  await page.locator('.tarjeta-cultivo .nodos-cultivo li', { hasText: 'sim-cccccccccccc-03' }).waitFor();
  await filtrosC.getByRole('button', { name: 'Borrar la búsqueda' }).click(); await page.waitForFunction(() => document.querySelectorAll('.tarjeta-cultivo').length > 1);
  await filtrosC.getByRole('button', { name: /^Ver/ }).click(); await page.getByRole('option', { name: /Yuca/ }).click(); await page.waitForFunction(() => document.querySelectorAll('.tarjeta-cultivo').length === 1);
  await page.screenshot({ path: path.join(images, 'filtros-cultivos.png'), fullPage: true });
  await ir('Escenario'); const filtrosE = page.getByRole('search', { name: 'Filtrar nodos' });
  await filtrosE.getByLabel('Buscar nodo').fill('yuca 03'); await page.waitForFunction(() => document.querySelectorAll('.esc-nodos li').length === 1);
  await filtrosE.getByRole('button', { name: 'Borrar la búsqueda' }).click();
  await page.getByRole('button', { name: 'Volver a automático' }).click(); await page.getByText('Simulación en automático', { exact: false }).waitFor();
  assert.deepEqual(errors, []);
  console.log('QA IA/escenario/historial OK: cultivo mixto con origen separado, comparacion frente a la plantilla, tres hexagonos en WebGL, clima con icono y proyeccion del fisico, pausa y dispositivo por nodo, parametros del cultivo, ajustes de usuario, anchos 360/390/768/1280, ajuste manual con reglas, alertas y registro de la simulacion, analisis de IA a peticion, alta, traslado, retiro y eliminacion de nodos simulados rechazo de borrar un cultivo con historial terreno a escala con sectores dibujados y distancias, y registro y configuracion por USB de un nodo fisico con placa simulada. Solo fixtures.');
} finally { if (browser) await browser.close(); if (server) await server.close(); }
