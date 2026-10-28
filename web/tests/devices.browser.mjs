import assert from 'node:assert/strict';
import { existsSync,mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
const web=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const images=path.resolve(web,'../.local/qa-cultivos');mkdirSync(images,{recursive:true});
const chrome=process.env.AGROVIGIA_CHROME??['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
let server,browser;
try{
  server=await createServer({root:web,configFile:path.join(web,'vite.config.ts'),cacheDir:path.resolve(web,'../.local/vite-qa-devices'),server:{host:'127.0.0.1',port:5185,strictPort:true,open:false},plugins:[{name:'qa-crops',configureServer(s){s.middlewares.use('/__crops_qa',async(_req,res,next)=>{try{const html=await s.transformIndexHtml('/__crops_qa','<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/crops-fixture.tsx"></script></body></html>');res.setHeader('Content-Type','text/html');res.end(html);}catch(e){next(e);}});}}]});await server.listen();
  browser=await chromium.launch({executablePath:chrome,headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  // Ningun servicio remoto: todos los datos pasan por el fetch ficticio del SDK.
  await page.route('https://**/*',r=>r.abort());
  await page.goto('http://127.0.0.1:5185/__crops_qa');
  await page.getByText('agv-prueba-01',{exact:true}).waitFor();
  await page.getByRole('navigation',{name:'Navegación móvil'}).getByRole('button',{name:'Dispositivos',exact:true}).click();
  await page.getByRole('heading',{name:'agv-prueba-02',exact:true}).waitFor();
  const card=page.locator('.tarjeta-cultivo').filter({has:page.getByRole('heading',{name:'agv-prueba-02',exact:true})});
  await card.getByRole('button',{name:'Vincular a cultivo',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Confirmar vinculación',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();assert.equal((await page.evaluate(()=>window.qaCropsRequests)).length,0);
  await card.getByRole('button',{name:'Vincular a cultivo',exact:true}).click();await page.getByRole('checkbox').check();
  await page.evaluate(()=>{window.qaCropError=true;});await page.getByRole('button',{name:'Confirmar vinculación',exact:true}).click();await page.getByRole('alert').waitFor();
  await page.getByRole('button',{name:'Confirmar vinculación',exact:true}).click();await page.getByText('Nodo vinculado.',{exact:false}).waitFor();
  await card.getByRole('button',{name:'Desvincular',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Confirmar desvinculación',exact:true}).isDisabled(),true);
  await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Confirmar desvinculación',exact:true}).click();
  await card.getByRole('button',{name:'Vincular a cultivo',exact:true}).waitFor();
  await page.getByText('Últimos cambios de asignación (hasta 20)',{exact:true}).click();
  await page.locator('.actividad-nodos li').first().waitFor();assert.equal(await page.locator('.actividad-nodos li').count(),2);
  const calls=await page.evaluate(()=>window.qaCropsRequests);assert.deepEqual(calls[0].args,calls[1].args);assert.equal(calls[2].args.p_cultivo_esperado_id,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  for(const width of [360,390,768,1280]){await page.setViewportSize({width,height:844});await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth);if(width===390)await page.screenshot({path:path.join(images,'dispositivos-movil.png'),fullPage:true});}
  assert.deepEqual(errors,[]);console.log('QA dispositivos OK: cancelar, confirmar vinculacion/desvinculacion, error y reintento, auditoria y movil 360/390/768/1280. Fixtures, sin servicios remotos.');
}finally{if(browser)await browser.close();if(server)await server.close();}
