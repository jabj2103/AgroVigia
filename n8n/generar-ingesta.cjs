'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cargar = nombre => fs.readFileSync(path.join(__dirname, nombre), 'utf8')
  .split('// EXPORTACIONES_LOCALES:')[0];
const base = cargar('validar-telemetria.cjs') + '\n' + cargar('preparar-ingesta.cjs');
function entradaCode() {
  // Decision documentada: recepcion aproximada al comenzar este Code.
  const recibidaEn = new Date().toISOString();
  // Solo valido con Mosquitto del proyecto y las ACL probadas.
  const configuracion = { acl_verificada: true, retencion_broker_desactivada: true };
  return $input.all().map((item, index) => ({
    json: prepararIngesta(item.json, configuracion, recibidaEn),
    pairedItem: { item: index },
  }));
}
function resultadoCode() {
  return $input.all().map((item, index) => ({
    json: resumirPersistencia(item.json), pairedItem: { item: index },
  }));
}
const enlace = node => ({ node, type: 'main', index: 0 });
const flujo = {
  name: 'AgroVigia - 03b DHT22 MQTT a Supabase',
  active: false,
  nodes: [
    {
      id: 'agv-ingesta-mqtt', name: 'MQTT receptor', type: 'n8n-nodes-base.mqttTrigger',
      typeVersion: 1, position: [0, 0],
      parameters: {
        topics: 'agrovigia/v1/simulado/nodos/agv-dht22-01/telemetria:1',
        options: { jsonParseBody: false, onlyMessage: false, parallelProcessing: true },
      },
    },
    {
      id: 'agv-destino', name: 'Proyecto Supabase', type: 'n8n-nodes-base.set',
      typeVersion: 3.4, position: [250, 0],
      parameters: {
        assignments: { assignments: [{
          id: 'agv-url', name: 'supabase_url',
          value: 'https://TU_PROYECTO.supabase.co', type: 'string',
        }] },
        includeOtherFields: true, options: {},
      },
    },
    {
      id: 'agv-preparar-rpc', name: 'Preparar ingesta', type: 'n8n-nodes-base.code',
      typeVersion: 2, position: [500, 0],
      parameters: {
        mode: 'runOnceForAllItems',
        jsCode: base + '\nreturn (' + entradaCode.toString() + ')();\n',
      },
    },
    {
      id: 'agv-solo-validos', name: 'Forma valida', type: 'n8n-nodes-base.if',
      typeVersion: 2.2, position: [750, 0],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [{
            id: 'agv-condicion', leftValue: '={{ $json.estado }}', rightValue: 'prevalidado',
            operator: { type: 'string', operation: 'equals' },
          }],
          combinator: 'and',
        }, options: {},
      },
    },
    {
      id: 'agv-http-rpc', name: 'Guardar lote en Supabase',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1010, -90],
      retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
      parameters: {
        method: 'POST', url: '={{ $json.destino_rpc }}',
        authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
        sendBody: true, contentType: 'json', specifyBody: 'json',
        jsonBody: '={{ $json.solicitud_rpc }}',
        options: { timeout: 15000, redirect: { redirect: { followRedirects: false } } },
      },
    },
    {
      id: 'agv-resultado-rpc', name: 'Resultado de persistencia',
      type: 'n8n-nodes-base.code', typeVersion: 2, position: [1290, -90],
      parameters: {
        mode: 'runOnceForAllItems',
        jsCode: base + '\nreturn (' + resultadoCode.toString() + ')();\n',
      },
    },
    {
      id: 'agv-rechazo-forma', name: 'Rechazado antes de RPC',
      type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [1010, 150], parameters: {},
    },
    {
      id: 'agv-nota-03b', name: 'Guia de prueba', type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1, position: [0, -380],
      parameters: {
        width: 850, height: 280,
        content: '## Prueba DHT22 a Supabase\nConfigura supabase_url y credencial MQTT receptor (18883).\nEn Guardar lote, Header Auth: Name=apikey; Value=Secret Key de Supabase.\nNo poner claves en nodos ni en el JSON exportado.\nPrimero ejecutar todo y publicar SIMULADO nuevo. No usar datos fijados/pinned.\nrecibida_en = inicio de validacion AUTOMATICA, aproximado; no hora exacta del broker.\nretain no observado: requiere broker del proyecto con retain_available false y ACL probada.\nSin cola duradera ni alertas. Revisar Resultado de persistencia, no solo color verde.',
      },
    },
  ],
  connections: {
    'MQTT receptor': { main: [[enlace('Proyecto Supabase')]] },
    'Proyecto Supabase': { main: [[enlace('Preparar ingesta')]] },
    'Preparar ingesta': { main: [[enlace('Forma valida')]] },
    'Forma valida': { main: [[enlace('Guardar lote en Supabase')], [enlace('Rechazado antes de RPC')]] },
    'Guardar lote en Supabase': { main: [[enlace('Resultado de persistencia')]] },
  },
  settings: {
    executionOrder: 'v1', saveManualExecutions: true,
    saveDataErrorExecution: 'all', saveDataSuccessExecution: 'all',
  },
  pinData: {},
};
fs.writeFileSync(path.join(__dirname, '03b-ingesta-dht22.json'), JSON.stringify(flujo, null, 2) + '\n');
console.log('03b generado, inactivo y sin credenciales. Pendiente ejecucion HTTP/n8n.');
