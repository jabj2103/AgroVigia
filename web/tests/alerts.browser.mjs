import assert from 'node:assert/strict';
import { existsSync,mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
const web=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const images=path.resolve(web,'../.local/qa-alertas');mkdirSync(images,{recursive:true});
const chrome=process.env.AGROVIGIA_CHROME??['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
let server,browser;
try{
  server=await createServer({root:web,configFile:path.join(web,'vite.config.ts'),cacheDir:path.resolve(web,'../.local/vite-qa-alerts'),server:{host:'127.0.0.1',port:5186,strictPort:true,open:false},plugins:[{name:'qa-crops',configureServer(s){s.middlewares.use('/__crops_qa',async(_req,res,next)=>{try{const html=await s.transformIndexHtml('/__crops_qa','<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/alerts-fixture.tsx"></script></body></html>');res.setHeader('Content-Type','text/html');res.end(html);}catch(e){next(e);}});}}]});await server.listen();
  browser=await chromium.launch({executablePath:chrome,headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  // Ningun servicio remoto: todos los datos pasan por el fetch ficticio del SDK.
  await page.route('https://**/*',r=>r.abort());
  await page.goto('http://127.0.0.1:5186/__crops_qa');
  await page.getByText('agv-prueba-01',{exact:true}).waitFor();
  await page.getByRole('navigation',{name:'Navegación móvil'}).getByRole('button',{name:'Alertas',exact:true}).click();
  await page.locator('.tarjeta-alerta').first().waitFor();assert.equal(await page.locator('.tarjeta-alerta').count(),20);
  await page.getByText('Evidencia antigua: no confirma la condición actual.',{exact:true}).first().waitFor();
  await page.getByRole('button',{name:'Marcar como revisada',exact:true}).first().click();
  await page.getByText('Alerta marcada como revisada.',{exact:false}).waitFor();
  await page.locator('.tarjeta-alerta .estado').filter({hasText:/^Revisada$/}).first().waitFor();
  assert.equal(await page.locator('.tarjeta-alerta.activa').count(),20);
  await page.getByRole('button',{name:'Siguiente',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.tarjeta-alerta').length===3);
  await page.getByRole('button',{name:'Anterior',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.tarjeta-alerta').length===20);
  await page.locator('#alerta-revision').selectOption('revisadas');await page.waitForFunction(()=>document.querySelectorAll('.tarjeta-alerta').length===1);
  await page.locator('#alerta-estado').selectOption('cerradas');await page.getByRole('heading',{name:'No hay alertas para estos filtros'}).waitFor();
  await page.locator('#alerta-revision').selectOption('todas');await page.waitForFunction(()=>document.querySelectorAll('.tarjeta-alerta').length===2);
  await page.getByText('Regla desactivada o sustituida',{exact:false}).first().waitFor();
  await page.getByRole('button',{name:'Reglas',exact:true}).click();
  await page.getByRole('button',{name:'Configurar regla',exact:true}).click();
  assert.equal(await page.locator('#regla-min').inputValue(),'');assert.equal(await page.locator('#regla-max').inputValue(),'');
  assert.equal(await page.getByRole('button',{name:'Guardar límites',exact:true}).isDisabled(),true);
  await page.locator('#regla-variable').selectOption('humedad_aire');await page.locator('#regla-min').fill('80');await page.locator('#regla-max').fill('20');await page.getByRole('checkbox').check();
  await page.getByRole('button',{name:'Guardar límites',exact:true}).click();await page.getByText('El mínimo debe ser menor que el máximo.',{exact:true}).waitFor();
  await page.locator('#regla-min').fill('');await page.locator('#regla-max').fill('70');await page.getByRole('checkbox').check();
  await page.evaluate(()=>{window.qaAlertMutationError=true;});await page.getByRole('button',{name:'Guardar límites',exact:true}).click();await page.getByText('No pudimos confirmar el cambio.',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Guardar límites',exact:true}).click();await page.getByText('Límites guardados.',{exact:false}).waitFor();
  const regla=page.locator('.regla-alerta').filter({has:page.getByRole('heading',{name:'Humedad del aire',exact:true})});await regla.waitFor();
  await regla.getByRole('button',{name:'Desactivar regla',exact:true}).click();await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  assert.equal((await page.evaluate(()=>window.qaAlertCalls.filter(x=>x.name==='desactivar_regla_alerta'))).length,0);
  await regla.getByRole('button',{name:'Desactivar regla',exact:true}).click();await page.getByRole('button',{name:'Confirmar desactivación',exact:true}).click();await page.getByText('Regla desactivada. Sus episodios se conservan.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Episodios',exact:true}).click();
  await page.evaluate(()=>{window.qaAlertsError=true;});await page.getByRole('button',{name:'Actualizar alertas',exact:true}).click();await page.getByText('Se conserva la última consulta correcta, con su fecha indicada.',{exact:false}).waitFor();assert.equal(await page.locator('.tarjeta-alerta').count(),2);
  await page.evaluate(()=>{window.qaAlertsError=false;});await page.getByRole('button',{name:'Actualizar alertas',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[role="alert"]'));
  await page.locator('#alerta-estado').selectOption('activas');await page.waitForFunction(()=>document.querySelectorAll('.tarjeta-alerta').length===20);
  for(const width of [360,390,768,1280]){await page.setViewportSize({width,height:844});await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth);if(width===390){await page.locator('.episodios-alertas').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(images,'alertas-movil.png'),fullPage:false});}}
  await page.screenshot({path:path.join(images,'alertas-escritorio.png'),fullPage:false});
  await page.locator('#cultivo').selectOption('dddddddd-dddd-4ddd-8ddd-dddddddddddd');await page.getByRole('heading',{name:'No hay alertas para estos filtros'}).waitFor();assert.equal(await page.getByRole('button',{name:'Configurar regla',exact:true}).count(),0);assert.equal(await page.locator('.tarjeta-alerta').count(),0);
  const queries=await page.evaluate(()=>window.qaAlertQueries);for(const u of queries.map(u=>new URL(u))){assert.equal(u.searchParams.get('origen'),'eq.real');assert.ok(u.searchParams.has('cultivo_id'));}
  await page.getByRole('button',{name:'Cuenta vacía',exact:true}).click();await page.getByRole('heading',{name:'No tienes cultivos activos'}).waitFor();assert.equal(await page.locator('.regla-alerta,.tarjeta-alerta').count(),0);
  assert.deepEqual(errors,[]);console.log('QA alertas OK: filtros, paginacion, revision sin cierre, configuracion sin defaults, validacion, error/reintento, desactivacion, error conservando datos, archivo/cuenta vacia y anchos 360/390/768/1280. Solo fixtures.');

}finally{if(browser)await browser.close();if(server)await server.close();}
