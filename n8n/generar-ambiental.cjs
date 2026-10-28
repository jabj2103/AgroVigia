'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cargar = nombre => fs.readFileSync(path.join(__dirname, nombre), 'utf8').split('// EXPORTACIONES_LOCALES:')[0];
const base = ['validar-telemetria.cjs', 'validar-ambiental.cjs', 'preparar-ambiental.cjs'].map(cargar).join('\n');
const flujo = JSON.parse(fs.readFileSync(path.join(__dirname, '03b-ingesta-dht22.json'), 'utf8'));
flujo.name = 'AgroVigia - 03c DHT22 y LDR v2 a Supabase';
flujo.active = false;
for (const nodo of flujo.nodes) nodo.id += '-v2';
flujo.nodes.find(n => n.name === 'MQTT receptor').parameters.topics = 'agrovigia/v2/real/nodos/agv-dht22-01/telemetria:1';
function entradaCode() {
  const recibidaEn = new Date().toISOString();
  const configuracion = { acl_verificada: true, retencion_broker_desactivada: true };
  return $input.all().map((item, index) => ({
    json: prepararIngestaAmbiental(item.json, configuracion, recibidaEn), pairedItem: { item: index },
  }));
}
function resultadoCode() {
  return $input.all().map((item, index) => ({
    json: resumirPersistenciaAmbiental(item.json), pairedItem: { item: index },
  }));
}
flujo.nodes.find(n => n.name === 'Preparar ingesta').parameters.jsCode = base + '\nreturn (' + entradaCode.toString() + ')();\n';
flujo.nodes.find(n => n.name === 'Resultado de persistencia').parameters.jsCode = base + '\nreturn (' + resultadoCode.toString() + ')();\n';
flujo.nodes.find(n => n.name === 'Guia de prueba').parameters.content = '## DHT22 + LDR v2\nAplicar 0003 y habilitar LDR en el nodo. Reiniciar broker con ACL v2.\nURL publica en supabase_url; mismas credenciales privadas MQTT/Header Auth del flujo 03b.\nPrimera prueba: topico REAL del primer nodo, tres filas por UUID.\nIndice ADC 0..100 relativo, no lux ni calibracion entre sensores.\nrecibida_en es inicio de validacion aproximado. Requiere ACL y retain_available false.\nNunca fijar/pinear datos ni exportar claves. Revisar Resultado de persistencia.';
fs.writeFileSync(path.join(__dirname, '03c-ingesta-ambiental.json'), JSON.stringify(flujo, null, 2) + '\n');
console.log('03c generado, inactivo y sin credenciales.');