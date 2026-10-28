'use strict';
// Broker de prueba propio en puerto efimero de loopback. No toca el broker de Juan.
// Mensajes deliberadamente SIN forma de telemetria; no son capturas reales.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const raiz = path.resolve(__dirname, '..');
const bin = process.argv[2] ?? 'C:\\Users\\juann\\Documents\\Mosquitto';
const hijos = [];
function iniciar(nombre, args) {
  const p = spawn(path.join(bin, nombre + '.exe'), args, { cwd: raiz, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
  hijos.push(p); p.texto = '';
  p.stdout.on('data', d => { p.texto += d; }); p.stderr.on('data', d => { p.texto += d; });
  p.salida = new Promise((resolve,reject) => { p.on('error',reject); p.on('exit',code => resolve(code)); });
  p.salida.catch(() => {});
  return p;
}
async function esperarPuerto(puerto, broker) {
  const limite = Date.now()+5000;
  while (Date.now()<limite && broker.exitCode === null) {
    const listo = await new Promise(resolve => {
      const socket = net.createConnection({ host:'127.0.0.1', port:puerto });
      socket.setTimeout(300);
      socket.once('connect',() => { socket.destroy(); resolve(true); });
      socket.once('error',() => { socket.destroy(); resolve(false); });
      socket.once('timeout',() => { socket.destroy(); resolve(false); });
    });
    if (listo) return;
    await new Promise(r => setTimeout(r,50));
  }
  throw new Error('El broker aislado no abrio su puerto de prueba. ' + broker.texto.slice(-1200));
}
async function terminar(p) {
  let timer;
  try { return await Promise.race([p.salida,new Promise((_,reject) => { timer=setTimeout(() => reject(new Error('Timeout proceso de prueba')),7000); })]); }
  finally { clearTimeout(timer); }
}
(async () => {
  const s = net.createServer();
  await new Promise((resolve,reject) => { s.once('error',reject); s.listen(0,'127.0.0.1',resolve); });
  const puerto = s.address().port;
  await new Promise(resolve => s.close(resolve));
  const cfg = path.join(raiz,'.local','mqtt','acl-ambiental-prueba.conf');
  const contenido = fs.readFileSync(path.join(raiz,'mqtt','agrovigia.conf'),'utf8')
    .replace('listener 18883 127.0.0.1','listener '+puerto+' 127.0.0.1');
  fs.writeFileSync(cfg,contenido);
  const broker = iniciar('mosquitto',['-c',cfg,'-v']);
  await esperarPuerto(puerto, broker);
  const real = 'agrovigia/v2/real/nodos/agv-dht22-01/telemetria';
  const segundo = 'agrovigia/v2/real/nodos/agv-ambiente-02/telemetria';
  const comun = usuario => ['-o',path.join(raiz,'.local','mqtt',usuario+'.conf'),'-h','127.0.0.1','-p',String(puerto),'-V','mqttv5'];
  const receptor = iniciar('mosquitto_sub',[...comun('receptor'),'-t',real,'-q','1','-C','1','-W','5','-d']);

  const publicar = async (usuario,topico) => {
    const p = iniciar('mosquitto_pub',[...comun(usuario),'-t',topico,'-q','1','-d','-m','AGV_PRUEBA_ACL_V2_SIN_TELEMETRIA']);
    const codigo = await terminar(p);
    return { codigo, texto: p.texto };
  };
  async function publicarPermitido(usuario, topico) {
    const r = await publicar(usuario, topico);
    assert.equal(r.codigo,0);
    assert.match(r.texto,/received PUBACK.*RC:(0|16)\)/, 'Falta ACK de publicacion permitida.');
  }
  // stdout de los binarios Windows puede estar bufferizado. Repetir el mensaje
  // de prueba hasta que el suscriptor termine tras recibir uno; solo broker aislado.
  for (let i=0; i<5 && receptor.exitCode === null; i++) {
    await publicarPermitido('nodo_dht22',real);
    await new Promise(r => setTimeout(r,200));
  }
  assert.equal(await terminar(receptor),0);
  assert.ok(receptor.texto.includes('AGV_PRUEBA_ACL_V2_SIN_TELEMETRIA'));
  await publicarPermitido('nodo_ldr',segundo);
  for (const [usuario,topico] of [['nodo_dht22',segundo],['nodo_ldr',real],['simulador',real],['receptor',real]]) {
    const r = await publicar(usuario,topico);
    // Mosquitto 2.1.2 puede salir con codigo0 aunque PUBACK sea negativo.
    assert.match(r.texto,/received PUBACK.*RC:135\)/, 'ACL de ' + usuario + ': ' + r.texto);
  }
  await publicarPermitido('simulador',real.replace('/real/','/simulado/'));
  console.log('ACL v2 OK: receptor recibe, cada nodo publica solo su topico, simulador separado y receptor sin escritura. Broker aislado; no es prueba fisica ni guardado.');
})().catch(e => { console.error(e.message); process.exitCode=1; }).finally(async () => {
  for (const p of hijos) if (p.exitCode === null && !p.killed) p.kill();
  await Promise.allSettled(hijos.map(p => p.salida));
});