'use strict';
// Genera 03h: sugerencias de IA a peticion del agricultor (tabla solicitudes_ia, migracion 0011).
// Mismo armado de Gemini que la rama automatica: el codigo sale de preparar-sugerencias.cjs.
const fs = require('node:fs'), path = require('node:path');
const { cargar } = require('./codigo-ingesta.cjs');
const base = cargar('preparar-sugerencias.cjs') + '\n' + cargar('preparar-solicitudes.cjs');
const edge = node => [{ node, type: 'main', index: 0 }];
const id = name => 'agv-' + name.replaceAll(' ', '-').toLowerCase() + '-sol';
const code = (name, fn, position) => ({ id: id(name), name, type: 'n8n-nodes-base.code', typeVersion: 2, position, parameters: { mode: 'runOnceForAllItems', jsCode: base + '\nreturn (' + fn.toString() + ')();\n' } });
const gate = (name, position) => ({ id: id(name), name, type: 'n8n-nodes-base.if', typeVersion: 2.2, position, parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
  conditions: [{ id: 'lista', leftValue: '={{ $json.lista ? "si" : "no" }}', rightValue: 'si', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' }, options: {} } });
const http = (name, url, cuerpo, position, { timeout = 15000, maxTries = 3, wait = 2000 } = {}) => ({ id: id(name), name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position,
  retryOnFail: true, maxTries, waitBetweenTries: wait, onError: 'continueRegularOutput', alwaysOutputData: true,
  parameters: { method: 'POST', url, authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: '={{ $json.' + cuerpo + ' }}',
    options: { timeout, redirect: { redirect: { followRedirects: false } }, response: { response: { fullResponse: true, responseFormat: 'json' } } } } });
function toma() { return $input.all().map((item, i) => ({ json: prepararToma(item.json), pairedItem: { item: i } })); }
function repartir() { return repartirSolicitudes($('Preparar toma').first().json, $input.first().json).map(json => ({ json, pairedItem: { item: 0 } })); }
function gemini() { return $input.all().map((item, i) => ({ json: prepararGeminiSolicitud($('Repartir solicitudes').itemMatching(i).json, item.json), pairedItem: { item: i } })); }
function interpretar() { return $input.all().map((item, i) => ({ json: completarSolicitud($('Preparar Gemini').itemMatching(i).json, item.json), pairedItem: { item: i } })); }
function resultado() { return $input.all().map((item, i) => ({ json: resultadoSolicitud($('Interpretar Gemini').itemMatching(i).json, item.json), pairedItem: { item: i } })); }
function sinIA() { return $input.all().map((item, i) => ({ json: solicitudSinIA(item.json), pairedItem: { item: i } })); }
const flujo = {
  name: 'AgroVigia - 03h sugerencias IA a peticion', active: false,
  nodes: [
    { id: id('Cada 30 segundos'), name: 'Cada 30 segundos', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 0],
      parameters: { rule: { interval: [{ field: 'seconds', secondsInterval: 30 }] } } },
    { id: id('Proyecto Supabase'), name: 'Proyecto Supabase', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [250, 0],
      parameters: { assignments: { assignments: [{ id: 'agv-url', name: 'supabase_url', value: 'https://TU_PROYECTO.supabase.co', type: 'string' },
        { id: 'agv-modelo-ia', name: 'gemini_modelo', value: 'gemini-3.5-flash-lite', type: 'string' }] }, includeOtherFields: false, options: {} } },
    code('Preparar toma', toma, [500, 0]), gate('Configuracion valida', [750, 0]),
    http('Tomar solicitudes', '={{ $json.destino_tomar }}', 'solicitud_tomar', [1000, 0]),
    code('Repartir solicitudes', repartir, [1250, 0]),
    http('Preparar solicitud', '={{ $json.destino_preparar }}', 'solicitud_preparar', [1500, 0]),
    code('Preparar Gemini', gemini, [1750, 0]), gate('Sugerencia reservada', [2000, 0]),
    http('Consultar Gemini', '={{ $json.destino_gemini }}', 'solicitud_gemini', [2250, -100], { timeout: 45000, maxTries: 2, wait: 5000 }),
    code('Interpretar Gemini', interpretar, [2500, -100]),
    http('Completar solicitud', '={{ $json.destino_completar }}', 'solicitud_completar', [2750, -100]),
    code('Resultado solicitud', resultado, [3000, -100]), code('Solicitud sin IA', sinIA, [2250, 200]),
    { id: id('Guia'), name: 'Guia de prueba', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [0, -380], parameters: { width: 850, height: 280,
      content: '## Sugerencias IA a peticion\nRequiere migracion 0011. La web registra la solicitud (solicitar_sugerencia_ia) y este flujo la atiende cada 30 s.\nConfigurar supabase_url y gemini_modelo. Misma apikey privada de Supabase en Tomar solicitudes, Preparar solicitud y Completar solicitud. En Consultar Gemini: credencial Header Auth x-goog-api-key.\nLa base decide: sin lote reciente cierra como sin_datos; con el tope diario agotado, como rechazada. No exige alerta nueva ni el intervalo de las automaticas.\nUn fallo de Gemini cierra la solicitud como error con su codigo. Si n8n se cae a mitad, la base la recupera a los 5 minutos.\nLas ejecuciones correctas no se guardan (casi todas estan vacias). El resultado queda en solicitudes_ia y sugerencias_ia.\nSolo una copia activa de este flujo.' } },
  ],
  connections: {
    'Cada 30 segundos': { main: [edge('Proyecto Supabase')] },
    'Proyecto Supabase': { main: [edge('Preparar toma')] },
    'Preparar toma': { main: [edge('Configuracion valida')] },
    'Configuracion valida': { main: [edge('Tomar solicitudes'), []] },
    'Tomar solicitudes': { main: [edge('Repartir solicitudes')] },
    'Repartir solicitudes': { main: [edge('Preparar solicitud')] },
    'Preparar solicitud': { main: [edge('Preparar Gemini')] },
    'Preparar Gemini': { main: [edge('Sugerencia reservada')] },
    'Sugerencia reservada': { main: [edge('Consultar Gemini'), edge('Solicitud sin IA')] },
    'Consultar Gemini': { main: [edge('Interpretar Gemini')] },
    'Interpretar Gemini': { main: [edge('Completar solicitud')] },
    'Completar solicitud': { main: [edge('Resultado solicitud')] },
  },
  settings: { executionOrder: 'v1', saveManualExecutions: true, saveDataErrorExecution: 'all', saveDataSuccessExecution: 'none' },
  pinData: {},
};
fs.writeFileSync(path.join(__dirname, '03h-sugerencias-a-peticion.json'), JSON.stringify(flujo, null, 2) + '\n');
console.log('03h generado (sugerencias IA a peticion), inactivo y sin credenciales.');
