import assert from 'node:assert/strict';
import { existsSync,mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createPanelServer } from '../server.mjs';
import { filas } from './fixtures.mjs';
const require=createRequire(new URL('../../web/package.json',import.meta.url));
const {chromium}=require('playwright-core');
const dir=path.dirname(fileURLToPath(import.meta.url)),images=path.resolve(dir,'../../.local/qa-simulador');mkdirSync(images,{recursive:true});
const chrome=process.env.AGROVIGIA_CHROME??['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
if(!chrome)throw new Error('Se necesita Chrome/Edge instalado, o AGROVIGIA_CHROME.');
let server,browser;
try{
  server=createPanelServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({executablePath:chrome,headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  const page=await context.newPage(),errors=[],remote=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(base))remote.push(r.url());});
  await page.clock.install({time:new Date('2026-11-04T01:00:00Z')});
  await page.clock.pauseAt(new Date('2026-11-04T01:05:00Z'));await page.goto(base);
  await page.getByRole('heading',{name:'Laboratorio de escenarios.'}).waitFor();assert.equal(await page.locator('.metric .simulated').count(),10);
  const temp=page.getByRole('spinbutton',{name:'Temperatura del aire',exact:true});
  const capture=page.getByRole('button',{name:'Capturar valores actuales',exact:false});
  const latest=async()=>JSON.parse(await page.locator('#last-json').textContent());
  const north=await temp.inputValue();await capture.click();assert.equal((await latest()).origen,'simulado');
  await page.getByRole('button',{name:'Seleccionar sector sur',exact:true}).click();assert.notEqual(await temp.inputValue(),north);
  await temp.fill('42.5');await temp.press('Tab');
  await page.getByRole('button',{name:'Seleccionar sector norte',exact:true}).click();assert.equal(await temp.inputValue(),north);
  await page.getByRole('button',{name:'Seleccionar sector sur',exact:true}).click();assert.equal(await temp.inputValue(),'42.5');
  await temp.fill('81');await temp.press('Tab');await capture.click();assert.equal(await page.locator('#capture-count').innerText(),'01');assert.equal(await page.locator('#field-error').isVisible(),true);
  await temp.fill('42.5');await temp.press('Tab');await capture.click();assert.equal((await latest()).mediciones.find(m=>m.variable_codigo==='temperatura_aire').valor,42.5);
  await page.getByRole('button',{name:'Preparar calor y suelo seco',exact:true}).click();assert.equal(await temp.inputValue(),'42.5');
  for(let i=0;i<12;i++)await page.getByRole('button',{name:'Avanzar y capturar',exact:false}).click();
  assert.equal((await latest()).simulacion.paso,12);assert.equal(await page.locator('#step').isDisabled(),true);
  const downloadPromise=page.waitForEvent('download');await page.locator('#export').click();const download=await downloadPromise;
  const exported=JSON.parse(await readFile(await download.path(),'utf8'));
  assert.equal(exported.enviado_mqtt,false);assert.equal(exported.persistido_supabase,false);assert.equal(exported.capturas.length,14);
  assert.ok(exported.capturas.every(c=>c.origen==='simulado'&&c.mediciones.length===10&&c.mediciones.every(m=>m.origen==='simulado')));
  assert.equal(exported.capturas.at(-1).mediciones.find(m=>m.variable_codigo==='temperatura_aire').valor,Number(north));
  await page.getByRole('button',{name:'Preparar cambio de ph',exact:true}).click();await page.locator('#scope').selectOption('all');await page.locator('#interval').selectOption('2');await page.locator('#auto').click();
  await page.clock.runFor(24000);assert.equal(await page.locator('#capture-count').innerText(),'62');assert.equal(await page.locator('#run-state').innerText(),'Pausada');assert.equal((await latest()).simulacion.paso,12);
  const counts=await page.locator('.zone-button .zone-sim').allTextContents();assert.deepEqual(counts,['Simulada · 13 capturas','Simulada · 25 capturas','Simulada · 12 capturas','Simulada · 12 capturas']);
  await page.locator('#scope').selectOption('selected');await page.locator('#auto').click();await page.clock.runFor(2000);
  await page.getByRole('button',{name:'Seleccionar sector norte',exact:true}).click();await page.clock.runFor(2000);assert.equal((await latest()).nodo_codigo,'sim-zona-02');
  await temp.fill('29');await temp.press('Tab');assert.equal(await page.locator('#run-state').innerText(),'Pausada');
  const pausedCount=await page.locator('#capture-count').innerText();await page.clock.runFor(6000);assert.equal(await page.locator('#capture-count').innerText(),pausedCount);
  await page.getByRole('button',{name:'Preparar viento fuerte',exact:true}).click();await page.locator('#auto').click();
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'hidden',{configurable:true,value:false});});assert.equal(await page.locator('#run-state').innerText(),'Pausada');
  for(const width of [360,390,768,1280,1440]){
    await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`desbordamiento en ${width}px`);
    if([390,1440].includes(width)){await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(images,`panel-${width}.png`),fullPage:true});}
  }
  await page.locator('#seed').fill('0');await page.locator('#reset').click();assert.match(await page.locator('#app-status').innerText(),/semilla debe/);
  await page.locator('#seed').fill('12345');await page.locator('#reset').click();assert.equal(await page.locator('#capture-count').innerText(),pausedCount);
  await page.reload();assert.equal(await page.locator('#seed').inputValue(),'12345');assert.equal(await page.locator('#capture-count').innerText(),'00');
  await page.evaluate(()=>{for(let i=0;i<301;i++)document.getElementById('capture').click();});assert.match(await page.locator('#history-summary').innerText(),/300 capturas conservadas.*1 anteriores descartadas/);
  const boundedPromise=page.waitForEvent('download');await page.locator('#export').click();const boundedDownload=await boundedPromise;
  const bounded=JSON.parse(await readFile(await boundedDownload.path(),'utf8'));assert.equal(bounded.capturas_conservadas,300);assert.equal(bounded.capturas_descartadas,1);
  assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
  const envios = []; let fallo = true;
  const connected = createPanelServer({ publicar: async p => {
    envios.push(p); if (fallo) { fallo = false; throw new Error('MQTT de prueba sin confirmación.'); }
    return { estado: 'mqtt_confirmado', persistido: null, nodo_codigo: p.payload.nodo_codigo };
  } });
  await new Promise(resolve => connected.listen(0, '127.0.0.1', resolve));
  try {
    const connectedBase = `http://127.0.0.1:${connected.address().port}`, c2 = await browser.newContext({ acceptDownloads: true, viewport: { width: 390, height: 1000 } });
    const p2 = await c2.newPage(); p2.on('pageerror', e => errors.push(e.message));
    await p2.goto(connectedBase); await p2.locator('#mqtt-status').filter({ hasText: 'Pega las cuatro filas' }).waitFor();
    assert.equal(await p2.locator('#mqtt-send').isDisabled(), true);
    await p2.locator('#capture').click(); assert.equal(envios.length, 0);
    await p2.getByText('Configurar los nodos virtuales', { exact: true }).click();
    await p2.locator('#mqtt-mapping').fill(JSON.stringify(filas())); await p2.locator('#mqtt-bind').click();
    await p2.locator('#mqtt-status').filter({ hasText: 'Cuatro nodos configurados' }).waitFor();
    await p2.locator('#mqtt-send').click(); await p2.locator('#mqtt-status').filter({ hasText: 'sin confirmación' }).waitFor();
    await p2.locator('#mqtt-send').click(); await p2.locator('#mqtt-status').filter({ hasText: 'MQTT confirmó' }).waitFor();
    assert.deepEqual(envios[0], envios[1]); assert.equal(envios[0].payload.mediciones.length, 10);
    assert.equal(await p2.locator('#mqtt-bind').isDisabled(), true);
    const d = p2.waitForEvent('download'); await p2.locator('#export').click();
    const result = JSON.parse(await readFile(await (await d).path(), 'utf8'));
    assert.equal(result.enviado_mqtt, true); assert.equal(result.persistido_supabase, null);
    assert.equal(result.transporte.resultados[0].estado, 'mqtt_confirmado');
    assert.equal(await p2.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await p2.screenshot({ path: path.join(images, 'panel-mqtt-390.png'), fullPage: true });
    await c2.close();
  } finally { connected.closeAllConnections(); await new Promise(resolve => connected.close(resolve)); }
  assert.deepEqual(errors, []);
  console.log('QA simulador OK: panel local, diez variables, escenarios/pausas, exportación/límite300 y 360/390/768/1280/1440px; mapeo, fallo/reintento con mismo UUID, ACK y exportación sin afirmar Supabase. Publicador ficticio, sin red externa.');
}finally{if(browser)await browser.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}
