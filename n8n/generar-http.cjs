'use strict';
// Genera 03g: ingesta por HTTP (webhook) para desplegar sin puerto MQTT publico. Reutiliza el esqueleto de 03b,
// el codigo de preparacion de 03e (v2) y 03f (v3) y las mismas ramas de alertas e IA.
const fs = require('node:fs'), path = require('node:path');
const { cargar, baseAmbiental, baseSimulada, normalizarCodigo } = require('./codigo-ingesta.cjs');
const { agregarModelo, agregarAlertas, agregarIA } = require('./ramas-alertas-ia.cjs');
const RUTA = 'agrovigia/telemetria', CABECERA = 'X-AgroVigia-Clave';
const edge = node => [{ node, type: 'main', index: 0 }];
// Cada contrato en su propio ambito: los dos validadores definen funciones con el mismo nombre.
const base = 'const V2 = (() => {\n' + baseAmbiental() + '\nreturn { prepararIngestaAmbiental, resumirPersistenciaAmbiental };\n})();\n' +
  'const V3 = (() => {\n' + baseSimulada() + '\nreturn { prepararIngestaSimulada, resumirPersistenciaSimulada };\n})();\n' + cargar('preparar-http.cjs');
function entradaCode() {
  const recibida = new Date().toISOString();
  // El nodo Webhook ya comprobo la clave de la cabecera. Por HTTP no existe retain.
  const canal = { acl_verificada: true, retencion_broker_desactivada: true };
  return $input.all().map((item, i) => ({ json: prepararIngestaHttp(item.json, canal, recibida, V2.prepararIngestaAmbiental, V3.prepararIngestaSimulada), pairedItem: { item: i } }));
}
function resultadoCode() {
  return $input.all().map((item, i) => ({ json: resumirPersistenciaHttp(item.json, $('Preparar ingesta').itemMatching(i).json, V2.resumirPersistenciaAmbiental, V3.resumirPersistenciaSimulada), pairedItem: { item: i } }));
}
const flujo = JSON.parse(fs.readFileSync(path.join(__dirname, '03b-ingesta-dht22.json'), 'utf8'));
flujo.name = 'AgroVigia - 03g ingesta por HTTP (v2 y v3), alertas y sugerencias IA'; flujo.active = false;
for (const n of flujo.nodes) { n.id += '-http'; delete n.credentials; }
// El disparador MQTT se sustituye por un webhook con clave en la cabecera. Responde el nodo Responder.
const entrada = flujo.nodes.find(n => n.name === 'MQTT receptor');
Object.assign(entrada, { name: 'Webhook ingesta', type: 'n8n-nodes-base.webhook', typeVersion: 2, webhookId: 'a9000191-7e1e-4e7a-8a11-03906e5ca000',
  parameters: { httpMethod: 'POST', path: RUTA, authentication: 'headerAuth', responseMode: 'responseNode', options: {} } });
flujo.connections['Webhook ingesta'] = flujo.connections['MQTT receptor']; delete flujo.connections['MQTT receptor'];
// Por HTTP la clave es compartida y no hay ACL del broker: el origen real queda cerrado salvo decision expresa.
flujo.nodes.find(n => n.name === 'Proyecto Supabase').parameters.assignments.assignments.push({ id: 'agv-http-real', name: 'http_admite_real', value: 'no', type: 'string' });
flujo.nodes.find(n => n.name === 'Preparar ingesta').parameters.jsCode = base + '\nreturn (' + entradaCode.toString() + ')();\n';
flujo.nodes.find(n => n.name === 'Resultado de persistencia').parameters.jsCode = base + '\nreturn (' + resultadoCode.toString() + ')();\n';
// Un fallo de Supabase no detiene la ejecucion: el remitente recibe 503 y reintenta el mismo lote.
const guardar = flujo.nodes.find(n => n.name === 'Guardar lote en Supabase');
guardar.onError = 'continueRegularOutput'; guardar.alwaysOutputData = true;
agregarModelo(flujo);
agregarAlertas(flujo);
agregarIA(flujo);
// La respuesta sale apenas se conoce el guardado, antes de las alertas y de la IA.
const responder = (name, position) => ({ id: 'agv-' + name.replaceAll(' ', '-').toLowerCase(), name, type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position,
  parameters: { respondWith: 'json', responseBody: '={{ $json.respuesta_http.cuerpo }}', options: { responseCode: '={{ $json.respuesta_http.codigo_http }}' } } });
flujo.nodes.push(responder('Responder ingesta', [1400, -260]), responder('Responder rechazo', [1290, 150]));
Object.assign(flujo.connections, {
  'Resultado de persistencia': { main: [edge('Responder ingesta')] },
  'Responder ingesta': { main: [edge('Preparar evaluacion')] },
  'Rechazado antes de RPC': { main: [edge('Responder rechazo')] },
});
// Los datos de entrada contienen una clave. Desactivar el historial y los puntos de guardado por nodo.
Object.assign(flujo.settings, { saveDataSuccessExecution: 'none', saveDataErrorExecution: 'none', saveManualExecutions: false, saveExecutionProgress: false });
flujo.nodes.find(n => n.name === 'Guia de prueba').parameters.content = '## Ingesta por HTTP (sin puerto MQTT)\nPOST /webhook/' + RUTA + ' con la cabecera ' + CABECERA + ' y el cuerpo {"topico","payload"}.\nMisma validacion, guardado, alertas e IA que 03e (agrovigia/v2/...) y 03f (agrovigia/v3/simulado/...).\nRespuesta {estado, codigo}: 200 guardado o duplicado, 400 lote rechazado, 503 guardado sin confirmar (reintentar el mismo lote). Sin clave o con clave incorrecta el nodo Webhook responde 403.\nCredenciales: Header Auth ' + CABECERA + ' en Webhook ingesta; apikey privada de Supabase en los HTTP de Supabase; x-goog-api-key en Consultar Gemini.\nOrigen real cerrado por defecto (http_admite_real = no): por HTTP la clave es compartida y no hay ACL del broker que separe origenes.\nEl historial de ejecuciones y el guardado por nodo estan desactivados para proteger la clave. El resultado esta en la respuesta y en Supabase.\nRequiere 0001 a 0011. Puede convivir con 03e y 03f: el guardado es idempotente por mensaje_id.';
for (const nodo of flujo.nodes) {
  if (nodo.type === 'n8n-nodes-base.code') nodo.parameters.jsCode = normalizarCodigo(nodo.parameters.jsCode);
}
fs.writeFileSync(path.join(__dirname, '03g-ingesta-http.json'), JSON.stringify(flujo, null, 2) + '\n');
console.log('03g generado (ingesta por HTTP con alertas y sugerencias IA), inactivo y sin credenciales.');
