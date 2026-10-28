'use strict';
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'validar-telemetria.cjs'), 'utf8').split('// EXPORTACIONES_LOCALES:')[0];
const code = source + `
// El Trigger oficial consultado entrega topic/message, no la bandera retain ni
// la fecha del callback MQTT. Esta es fecha de INICIO DEL CODE, no llegada exacta.
const inicioCode = new Date().toISOString();
return $input.all().map((item, index) => ({
  json: {
    ...prevalidarTelemetria({ topic: item.json.topic, message: item.json.message }),
    procesamiento_iniciado_en: inicioCode,
    persistido: false,
    observacion_integracion: 'Vista previa. Falta catalogo autorizado, recepcion exacta y transaccion Supabase.'
  },
  pairedItem: { item: index }
}));
`;
const workflow = {
  name: 'AgroVigia - 03a inspeccion MQTT v1 (sin persistencia)',
  active: false,
  nodes: [
    {
      id: 'agv-mqtt-trigger', name: 'MQTT receptor', type: 'n8n-nodes-base.mqttTrigger', typeVersion: 1,
      position: [0, 0], parameters: {
        topics: 'agrovigia/v1/+/nodos/+/telemetria:1',
        options: { jsonParseBody: false, onlyMessage: false, parallelProcessing: true },
      },
    },
    {
      id: 'agv-prevalidar', name: 'Prevalidar contrato', type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [520, 0], parameters: { mode: 'runOnceForAllItems', jsCode: code },
    },
    {
      id: 'agv-manual', name: 'Probar ejemplo sin broker', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1,
      position: [0, 260], parameters: {},
    },
    {
      id: 'agv-ejemplo', name: 'Crear ejemplo simulado', type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [260, 260], parameters: {
        mode: 'runOnceForAllItems',
        jsCode: `const p = {
  version: 1, nodo_codigo: 'agv-dht22-01',
  mensaje_id: '11111111-1111-4111-8111-111111111111', origen: 'simulado',
  tomada_en: new Date().toISOString().replace(/\\.\\d{3}Z$/, 'Z'),
  mediciones: [
    { variable_codigo: 'temperatura_aire', valor: 28.5, unidad: '\\u00b0C' },
    { variable_codigo: 'humedad_aire', valor: 72, unidad: '% HR' }
  ]
};
// ID fijo solo para inspeccion manual sin persistencia, no para publicar lotes nuevos.
return [{ json: { topic: 'agrovigia/v1/simulado/nodos/agv-dht22-01/telemetria', message: JSON.stringify(p) } }];`,
      },
    },
    {
      id: 'agv-nota', name: 'Alcance', type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
      position: [0, -300], parameters: {
        content: '## Vista previa de recepcion\nAsignar credencial MQTT del usuario receptor. QoS 1 con sufijo :1.\nSin HTTP, Supabase, alertas ni secretos.\nprevalidado NO significa autorizado ni almacenado.\nEl Trigger consultado no conserva retain ni fecha exacta de llegada. Ver n8n/README.md.',
        width: 700, height: 220,
      },
    },
  ],
  connections: {
    'MQTT receptor': { main: [[{ node: 'Prevalidar contrato', type: 'main', index: 0 }]] },
    'Probar ejemplo sin broker': { main: [[{ node: 'Crear ejemplo simulado', type: 'main', index: 0 }]] },
    'Crear ejemplo simulado': { main: [[{ node: 'Prevalidar contrato', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1' }, pinData: {},
};
fs.writeFileSync(path.join(__dirname, '03a-inspeccion-mqtt.json'), JSON.stringify(workflow, null, 2) + '\n');
console.log('Flujo de inspeccion regenerado, inactivo y sin credenciales ni persistencia.');
