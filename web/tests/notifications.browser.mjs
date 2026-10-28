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
  server=await createServer({root:web,configFile:path.join(web,'vite.config.ts'),cacheDir:path.resolve(web,'../.local/vite-qa-notifications'),server:{host:'127.0.0.1',port:5187,strictPort:true,open:false},plugins:[{name:'qa-crops',configureServer(s){s.middlewares.use('/__crops_qa',async(_req,res,next)=>{try{const html=await s.transformIndexHtml('/__crops_qa','<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/alerts-fixture.tsx"></script></body></html>');res.setHeader('Content-Type','text/html');res.end(html);}catch(e){next(e);}});}}]});await server.listen();
  browser=await chromium.launch({executablePath:chrome,headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  // Ningun servicio remoto: todos los datos pasan por el fetch ficticio del SDK.
  await page.route('https://**/*',r=>r.abort());
  await page.goto('http://127.0.0.1:5187/__crops_qa');
  await page.getByText('agv-prueba-01',{exact:true}).waitFor();
  const badge=page.locator('.campana-alertas .contador-alertas');
  await badge.filter({hasText:/^23$/}).waitFor();
  const nav=page.getByRole('navigation',{name:'Navegación móvil'});assert.equal(await nav.locator('.contador-alertas').innerText(),'23');
  await page.getByRole('complementary',{name:'Aviso de alertas pendientes'}).waitFor();
  await page.getByRole('button',{name:'Ocultar aviso',exact:true}).click();
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(()=>document.querySelector('.campana-alertas .contador-alertas')?.textContent==='23');
  assert.equal(await page.locator('.notificacion-alertas').count(),0);
  await page.evaluate(()=>{window.qaBadgeNueva();window.dispatchEvent(new Event('focus'));});
  await badge.filter({hasText:/^24$/}).waitFor();await page.getByText('Tienes 24 alertas pendientes',{exact:true}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'Panel',exact:true}).count(),1);
  await page.getByRole('button',{name:'Ver alertas pendientes',exact:true}).click();
  await page.locator('.tarjeta-alerta').first().waitFor();await page.getByRole('button',{name:'Marcar como revisada',exact:true}).first().click();
  await badge.filter({hasText:/^23$/}).waitFor();assert.equal(await page.locator('.tarjeta-alerta.activa').count(),20);
  await page.evaluate(()=>{window.qaAlertsError=true;window.dispatchEvent(new Event('focus'));});await badge.filter({hasText:/^\?$/}).waitFor();
  await page.getByText('No pudimos actualizar el contador de alertas.',{exact:false}).waitFor();
  await page.evaluate(()=>{window.qaAlertsError=false;window.qaBadgeCerrar();window.dispatchEvent(new Event('focus'));});await badge.filter({hasText:/^0$/}).waitFor();assert.equal(await nav.locator('.contador-alertas').count(),0);
  await page.evaluate(()=>{window.qaBadgeNueva();window.dispatchEvent(new Event('focus'));});await badge.filter({hasText:/^1$/}).waitFor();
  for(const width of [360,390,768,1280]){await page.setViewportSize({width,height:844});await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth);if(width===390)await page.screenshot({path:path.join(images,'contador-movil.png'),fullPage:false});}
  await page.getByRole('button',{name:'Cuenta vacía',exact:true}).click();await page.getByRole('heading',{name:'No tienes cultivos activos'}).waitFor();await badge.filter({hasText:/^0$/}).waitFor();assert.equal(await page.locator('.notificacion-alertas').count(),0);
  assert.deepEqual(errors,[]);console.log('QA avisos OK: contador en Inicio/nav, aviso inicial/nuevo, ocultar sin repeticion, abrir Alertas, revisar reduce sin cerrar, error no es cero, cierre limpia, cambio cuenta y 360/390/768/1280. Fixtures.');

}finally{if(browser)await browser.close();if(server)await server.close();}
