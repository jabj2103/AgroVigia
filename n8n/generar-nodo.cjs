'use strict';
// Genera 03i: ingesta REAL por HTTPS con clave propia de cada nodo fisico (migracion 0012). Reutiliza el
// esqueleto de 03b, la preparacion v2 de 03e y las mismas ramas de alertas e IA.
const fs = require('node:fs'), path = require('node:path');
const { cargar, baseAmbiental, normalizarCodigo } = require('./codigo-ingesta.cjs');
const { agregarModelo, agregarAlertas, agregarIA } = require('./ramas-alertas-ia.cjs');
const RUTA = 'agrovigia/nodo';
const edge = node => [{ node, type: 'main', index: 0 }];
const comun = cargar('preparar-http.cjs') + '\n' + cargar('preparar-nodo.cjs');
const base = 'const V2 = (() => {\n' + baseAmbiental() + '\nreturn { prepararIngestaAmbiental, resumirPersistenciaAmbiental };\n})();\n' + comun;
function autenticacionCode() {
  return $input.all().map((item, i) => ({ json: prepararAutenticacionNodo(item.json), pairedItem: { item: i } }));
}
function entradaCode() {
  const recibida = new Date().toISOString();
  // El origen queda acreditado por la clave propia del nodo. Por HTTP no existe retain.
  const canal = { acl_verificada: true, retencion_broker_desactivada: true };
  return $input.all().map((item, i) => ({ json: prepararIngestaNodo($('Preparar autenticacion').itemMatching(i).json, item.json, canal, recibida, V2.prepararIngestaAmbiental), pairedItem: { item: i } }));
}
function resultadoCode() {
  return $input.all().map((item, i) => ({ json: resumirPersistenciaNodo(item.json, $('Preparar ingesta').itemMatching(i).json, V2.resumirPersistenciaAmbiental), pairedItem: { item: i } }));
}
const flujo = JSON.parse(fs.readFileSync(path.join(__dirname, '03b-ingesta-dht22.json'), 'utf8'));
flujo.name = 'AgroVigia - 03i ingesta REAL por HTTPS con clave de nodo, alertas y sugerencias IA'; flujo.active = false;
for (const n of flujo.nodes) { n.id += '-nodo'; delete n.credentials; }
// Webhook sin credencial compartida: la autenticacion es por nodo y la decide la base (autenticar_nodo).
const entrada = flujo.nodes.find(n => n.name === 'MQTT receptor');
Object.assign(entrada, { name: 'Webhook nodo', type: 'n8n-nodes-base.webhook', typeVersion: 2, webhookId: 'a9000191-7e1e-4e7a-8a11-03906e5ca001',
  parameters: { httpMethod: 'POST', path: RUTA, authentication: 'none', responseMode: 'responseNode', options: {} } });
flujo.connections['Webhook nodo'] = flujo.connections['MQTT receptor']; delete flujo.connections['MQTT receptor'];
const code = (name, fn, codigo, position) => ({ id: 'agv-' + name.replaceAll(' ', '-').toLowerCase() + '-nodo', name, type: 'n8n-nodes-base.code', typeVersion: 2, position,
  parameters: { mode: 'runOnceForAllItems', jsCode: codigo + '\nreturn (' + fn.toString() + ')();\n' } });
const gate = structuredClone(flujo.nodes.find(n => n.name === 'Forma valida'));
Object.assign(gate, { name: 'Cabeceras validas', id: 'agv-cabeceras-validas-nodo', position: [500, -260] });
gate.parameters.conditions.conditions = [{ id: 'lista', leftValue: '={{ $json.lista ? "si" : "no" }}', rightValue: 'si', operator: { type: 'string', operation: 'equals' } }];
const autenticar = { id: 'agv-autenticar-nodo', name: 'Autenticar nodo', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [500, -130],
  retryOnFail: true, maxTries: 2, waitBetweenTries: 1000, onError: 'continueRegularOutput', alwaysOutputData: true,
  parameters: { method: 'POST', url: '={{ $json.destino_autenticar }}', authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendBody: true, contentType: 'json',
    specifyBody: 'json', jsonBody: '={{ $json.solicitud_autenticar }}', options: { timeout: 10000, redirect: { redirect: { followRedirects: false } }, response: { response: { fullResponse: true, responseFormat: 'json' } } } } };
flujo.nodes.push(code('Preparar autenticacion', autenticacionCode, comun, [250, -260]), gate, autenticar);
flujo.nodes.find(n => n.name === 'Preparar ingesta').parameters.jsCode = base + '\nreturn (' + entradaCode.toString() + ')();\n';
flujo.nodes.find(n => n.name === 'Resultado de persistencia').parameters.jsCode = base + '\nreturn (' + resultadoCode.toString() + ')();\n';
const guardar = flujo.nodes.find(n => n.name === 'Guardar lote en Supabase');
guardar.onError = 'continueRegularOutput'; guardar.alwaysOutputData = true;
agregarModelo(flujo);
agregarAlertas(flujo);
agregarIA(flujo);
const responder = (name, position) => ({ id: 'agv-' + name.replaceAll(' ', '-').toLowerCase() + '-nodo', name, type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position,
  parameters: { respondWith: 'json', responseBody: '={{ $json.respuesta_http.cuerpo }}', options: { responseCode: '={{ $json.respuesta_http.codigo_http }}' } } });
flujo.nodes.push(responder('Responder ingesta', [1400, -260]), responder('Responder rechazo', [1290, 150]), responder('Responder sin autenticar', [750, -400]));
Object.assign(flujo.connections, {
  'Proyecto Supabase': { main: [edge('Preparar autenticacion')] },
  'Preparar autenticacion': { main: [edge('Cabeceras validas')] },
  'Cabeceras validas': { main: [edge('Autenticar nodo'), edge('Responder sin autenticar')] },
  'Autenticar nodo': { main: [edge('Preparar ingesta')] },
  'Resultado de persistencia': { main: [edge('Responder ingesta')] },
  'Responder ingesta': { main: [edge('Preparar evaluacion')] },
  'Rechazado antes de RPC': { main: [edge('Responder rechazo')] },
});
// Los datos de entrada contienen una clave. Desactivar el historial y los puntos de guardado por nodo.
Object.assign(flujo.settings, { saveDataSuccessExecution: 'none', saveDataErrorExecution: 'none', saveManualExecutions: false, saveExecutionProgress: false });
flujo.nodes.find(n => n.name === 'Guia de prueba').parameters.content = '## Ingesta REAL por HTTPS con clave de nodo\nPOST /webhook/' + RUTA + ' con las cabeceras X-AgroVigia-Nodo (codigo) y X-AgroVigia-Clave (clave propia del nodo, la que entrega registrar_nodo_fisico). El cuerpo es el mismo JSON v2 que el firmware publica por MQTT.\nLa base valida la clave (autenticar_nodo) y el flujo sigue la ruta de 03e: validar, guardar, alertas e IA, con el topico real de ese nodo.\nRespuesta {estado, codigo, intervalo_segundos, pausado}: 200 guardado o duplicado, 400 lote rechazado, 401 {estado: rechazado, codigo: CLAVE_INVALIDA}, 503 sin confirmacion (reintentar el mismo lote).\nSin credencial en el webhook. Apikey privada de Supabase en Autenticar nodo y en los demas HTTP de Supabase; x-goog-api-key en Consultar Gemini.\nUna clave de nodo solo escribe datos reales de su propio nodo.\nEl historial de ejecuciones y el guardado por nodo estan desactivados para proteger la clave. Requiere 0001 a 0012.';
for (const nodo of flujo.nodes) {
  if (nodo.type === 'n8n-nodes-base.code') nodo.parameters.jsCode = normalizarCodigo(nodo.parameters.jsCode);
}
fs.writeFileSync(path.join(__dirname, '03i-ingesta-nodo-https.json'), JSON.stringify(flujo, null, 2) + '\n');
console.log('03i generado (ingesta real por HTTPS con clave de nodo, alertas y sugerencias IA), inactivo y sin credenciales.');
