import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createPanelServer } from '../server.mjs';
let server,base;
before(async()=>{server=createPanelServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;});
after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
test('panel UTF-8 y recursos locales con CSP sin conexiones externas',async()=>{
  const r=await fetch(base);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/utf-8/);
  assert.match(r.headers.get('content-security-policy'),/connect-src 'self'/);assert.equal(r.headers.get('cache-control'),'no-store');
  assert.match(await r.text(),/todos los datos son simulados/);
  for(const file of ['/app.mjs','/motor.mjs','/styles.css','/favicon.svg']){const res=await fetch(base+file);assert.equal(res.status,200);await res.arrayBuffer();}
  assert.equal((await fetch(base,{method:'HEAD'})).status,200);
});
test('no expone configuración ni archivos fuera del panel',async()=>{
  for(const route of ['/.env.local','/.local/mqtt/simulador.conf','/server.mjs','/%2e%2e%2fweb/.env.local','/api/publicar']) {const r=await fetch(base+route);assert.equal(r.status,404);await r.text();}
  const r=await fetch(base+'/%ZZ');assert.equal(r.status,400);await r.text();
});
test('rechaza escrituras y nombres de host externos',async()=>{
  const r=await fetch(base,{method:'POST',body:'{}'});assert.equal(r.status,405);assert.equal(r.headers.get('allow'),'GET, HEAD');await r.text();
  // fetch normaliza Host: usar HTTP directo para comprobar el encabezado real.
  const foreign=await new Promise((resolve,reject)=>{const req=request(base,{headers:{Host:'externo.invalid'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end();});
  assert.equal(foreign,403);
});
