'use strict';
// Codigo de preparacion que se incrusta en los nodos Code de los flujos de ingesta. Una sola fuente para
// 03c/03d/03e (lotes v2), 03f (lotes simulados v3) y 03g (ambos por HTTP): los generadores toman de aqui
// exactamente los mismos modulos que cubren las pruebas.
const fs = require('node:fs'), path = require('node:path');
const leer = nombre => fs.readFileSync(path.join(__dirname, nombre), 'utf8');
const cargar = nombre => leer(nombre).split('// EXPORTACIONES_LOCALES:')[0];
const sinExportar = s => s.replace(/^export /gm, '');
const sinImportar = s => s.replace(/^import .*;\r?\n/gm, '');

// Lotes v2 (DHT22 + LDR): validador del contrato, validador ambiental y preparacion de la RPC.
function baseAmbiental() {
  return ['validar-telemetria.cjs', 'validar-ambiental.cjs', 'preparar-ambiental.cjs'].map(cargar).join('\n');
}
// Lotes simulados v3 (diez variables): motor y contrato del panel de Juan y preparacion de la RPC.
function baseSimulada() {
  const motor = sinExportar(leer('../simulador/public/motor.mjs'));
  const contrato = sinExportar(sinImportar(leer('../simulador/contrato-v3.mjs')))
    .replace('new TextEncoder().encode(JSON.stringify(p)).length', "Buffer.byteLength(JSON.stringify(p), 'utf8')");
  const preparacion = sinExportar(sinImportar(leer('preparar-simulada.mjs')).replace(/^const \{ leerJsonEstricto \} = validador;\r?\n/m, ''));
  // El Code solo maneja JSON validado; no depender de structuredClone en el sandbox.
  return 'const structuredClone = value => JSON.parse(JSON.stringify(value));\n' + motor + '\n' + contrato + '\n' +
    require('./validar-telemetria.cjs').leerJsonEstricto.toString() + '\n' + preparacion;
}
module.exports = { cargar, baseAmbiental, baseSimulada };
