'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ajustarFlujos } = require('./preparar-windows.cjs');

function archivos(t) {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'agv-importacion-'));
  t.after(() => fs.rmSync(carpeta, { recursive: true, force: true }));
  fs.writeFileSync(path.join(carpeta, 'flujos.txt'), '03e.json:nuevo03e\n03f.json:nuevo03f\n03h.json:nuevo03h\n');
  for (const codigo of ['03e', '03f', '03h']) fs.writeFileSync(path.join(carpeta, codigo + '.json'), JSON.stringify([{id:'nuevo'+codigo,nodes:[],name:'AgroVigia - '+codigo+' actualizado'}]));
  return carpeta;
}
const previo = (id, codigo, active=1) => ({ id, name:'AgroVigia - '+codigo+' anterior', active, nodes:'[]', projectId:'proyectoPropietario' });

test('Windows: actualizar 03e y 03f conserva IDs y propietario; 03h nuevo queda en el mismo proyecto', t => {
  const carpeta = archivos(t);
  const resumen = ajustarFlujos(carpeta,[previo('realExistente','03e'),previo('simExistente','03f')],[{id:'proyectoPropietario'}]);
  assert.equal(resumen.proyecto,'proyectoPropietario');
  assert.deepEqual(resumen.flujos.map(f=>f.id),['realExistente','simExistente','nuevo03h']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(carpeta,'03e.json'),'utf8'))[0].id,'realExistente');
});

test('Windows: la preparacion se detiene ante receptores duplicados y propietarios ambiguos', t => {
  const carpeta = archivos(t);
  assert.throws(()=>ajustarFlujos(carpeta,[previo('uno','03e'),previo('dos','03e')],[]),/varios flujos/);
  const ajeno = {...previo('ajeno','03c'), nodes:JSON.stringify([{type:'n8n-nodes-base.mqttTrigger',parameters:{topics:'agrovigia/v2/real/nodos/+/telemetria:1'}}])};
  assert.throws(()=>ajustarFlujos(carpeta,[previo('uno','03e'),ajeno],[]),/otro receptor/);
  assert.throws(()=>ajustarFlujos(carpeta,[previo('uno','03e'),{...previo('dos','03f'),projectId:'otro'}],[]),/unico proyecto/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(carpeta,'03e.json'),'utf8'))[0].id,'nuevo03e');
});
