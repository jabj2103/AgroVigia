'use strict';
// Flujo 03i: ingesta REAL por HTTPS con clave propia de cada nodo. Logica pura y Code incrustado en un
// contexto aislado. No es una ejecucion real de n8n ni una llamada a Supabase. Datos y claves ficticios.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const { baseAmbiental, normalizarCodigo } = require('./codigo-ingesta.cjs');
const { prepararAutenticacionNodo, prepararIngestaNodo, resumirPersistenciaNodo, respuestaNodo } = require('./preparar-nodo.cjs');
const { prepararIngestaAmbiental, resumirPersistenciaAmbiental } = require('./preparar-ambiental.cjs');
const canal = { acl_verificada: true, retencion_broker_desactivada: true };
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const CODIGO = 'agv-esp4c1d-27', CLAVE = 'CLAVE_FICTICIA_DE_NODO_0123456789abcdefghijk';
const flujo = () => JSON.parse(fs.readFileSync(path.join(__dirname, '03i-ingesta-nodo-https.json'), 'utf8'));
const ahora = () => new Date().toISOString();
function lote(codigo = CODIGO, origen = 'real') {
  return { version: 2, nodo_codigo: codigo, mensaje_id: randomUUID(), origen, tomada_en: ahora().replace(/\.\d{3}Z$/, 'Z'),
    mediciones: [{ variable_codigo: 'temperatura_aire', valor: 29.3, unidad: '°C' }, { variable_codigo: 'humedad_aire', valor: 61.5, unidad: '% HR' },
      { variable_codigo: 'iluminacion_relativa', valor: Math.round(3000 * 1000 / 4095) / 10, unidad: '% relativo' }], ldr: { metodo: 'adc12_10k_11db_v1', adc_promedio: 3000 } };
}
const webhook = (body, cabeceras = { 'x-agrovigia-nodo': CODIGO, 'x-agrovigia-clave': CLAVE }, extra = {}) =>
  ({ headers: { 'content-type': 'application/json', ...cabeceras }, params: {}, query: {}, body, supabase_url: 'https://fixture.supabase.co', gemini_modelo: 'gemini-3.5-flash-lite', ...extra });
const autenticado = (extra = {}) => ({ statusCode: 200, body: { codigo: 'NODO_AUTENTICADO', nodo_codigo: CODIGO, intervalo_segundos: 120, pausado: false, ...extra } });
const preparar = (json, auth = autenticado()) => prepararIngestaNodo(prepararAutenticacionNodo(json), auth, canal, ahora(), prepararIngestaAmbiental);
const NO_AUTORIZADO = { codigo_http: 401, cuerpo: { estado: 'rechazado', codigo: 'CLAVE_INVALIDA' } };

test('nodo HTTPS: sin cabeceras validas responde 401 sin consultar la base; con ellas prepara autenticar_nodo', () => {
  const a = prepararAutenticacionNodo(webhook(lote()));
  assert.deepEqual([a.lista, a.nodo_codigo, a.destino_autenticar, a.supabase_url], [true, CODIGO, 'https://fixture.supabase.co/rest/v1/rpc/autenticar_nodo', 'https://fixture.supabase.co']);
  assert.deepEqual(a.solicitud_autenticar, { p_codigo: CODIGO, p_clave: CLAVE });
  for (const cabeceras of [{}, { 'x-agrovigia-nodo': CODIGO }, { 'x-agrovigia-clave': CLAVE }, { 'x-agrovigia-nodo': 'sim-52ea4628c470-01', 'x-agrovigia-clave': CLAVE },
    { 'x-agrovigia-nodo': 'agv-esp4c1d-27/../x', 'x-agrovigia-clave': CLAVE }, { 'x-agrovigia-nodo': CODIGO, 'x-agrovigia-clave': 'corta' }, { 'x-agrovigia-nodo': CODIGO, 'x-agrovigia-clave': 'con espacios dentro de la clave larga' },
    { 'x-agrovigia-nodo': CODIGO, 'x-agrovigia-clave': 'x'.repeat(201) }, { 'x-agrovigia-nodo': [CODIGO], 'x-agrovigia-clave': CLAVE }]) {
    const r = prepararAutenticacionNodo({ ...webhook(lote()), headers: cabeceras });
    assert.equal(r.lista, false); assert.deepEqual(r.respuesta_http, NO_AUTORIZADO); assert.equal(r.destino_autenticar, undefined);
  }
  assert.equal(prepararAutenticacionNodo(undefined).lista, false);
  const sinUrl = prepararAutenticacionNodo(webhook(lote(), undefined, { supabase_url: 'https://TU_PROYECTO.supabase.co' }));
  assert.deepEqual([sinUrl.lista, sinUrl.respuesta_http.codigo_http, sinUrl.respuesta_http.cuerpo.codigo], [false, 503, 'CONFIGURAR_URL_SUPABASE']);
});

test('nodo HTTPS: autenticado, el cuerpo v2 produce la misma solicitud de RPC que por MQTT con el topico real del nodo', () => {
  const cuerpo = lote(), recibida = ahora();
  const p = prepararIngestaNodo(prepararAutenticacionNodo(webhook(cuerpo)), autenticado(), canal, recibida, prepararIngestaAmbiental);
  const mqtt = prepararIngestaAmbiental({ topic: 'agrovigia/v2/real/nodos/' + CODIGO + '/telemetria', message: JSON.stringify(cuerpo), supabase_url: 'https://fixture.supabase.co' }, canal, recibida);
  assert.equal(p.estado, 'prevalidado', p.codigo); assert.deepEqual(p.solicitud_rpc, mqtt.solicitud_rpc); assert.equal(p.destino_rpc, mqtt.destino_rpc);
  assert.match(p.destino_rpc, /registrar_lote_ambiental$/); assert.equal(p.solicitud_rpc.p_topico, 'agrovigia/v2/real/nodos/' + CODIGO + '/telemetria');
  assert.deepEqual([p.payload.origen, p.canal_entrada, p.fuente_recibida_en, p.respuesta_http], ['real', 'https_nodo', 'inicio_validacion_http_aproximado', undefined]);
  assert.deepEqual(p.nodo_http, { intervalo_segundos: 120, pausado: false });
  assert.ok(!JSON.stringify(p).includes(CLAVE), 'la clave del nodo no pasa al resultado');
  // Tambien como texto exacto del lote.
  assert.deepEqual(preparar(webhook(JSON.stringify(cuerpo))).solicitud_rpc.p_mensaje, JSON.stringify(cuerpo));
});

test('nodo HTTPS: clave rechazada 401, autenticacion sin confirmar 503, y un nodo no puede enviar lotes de otro ni datos simulados', () => {
  for (const auth of [{ statusCode: 200, body: { codigo: 'CLAVE_INVALIDA' } }, autenticado({ nodo_codigo: 'agv-otro0000-01' })]) {
    const r = preparar(webhook(lote()), auth);
    assert.equal(r.estado, 'rechazado'); assert.deepEqual(r.respuesta_http, NO_AUTORIZADO); assert.equal(r.solicitud_rpc, undefined);
  }
  for (const auth of [{ statusCode: 500, body: {} }, { error: { message: 'CLAVE_PRIVADA_FICTICIA' } }, { statusCode: 200, body: { codigo: 'OTRO' } }, { statusCode: 200, body: [] }, null]) {
    const r = preparar(webhook(lote()), auth);
    assert.deepEqual(r.respuesta_http, { codigo_http: 503, cuerpo: { estado: 'pendiente', codigo: 'AUTENTICACION_NO_CONFIRMADA' } }); assert.equal(r.solicitud_rpc, undefined);
    assert.ok(!JSON.stringify(r).includes('CLAVE_PRIVADA_FICTICIA'));
  }
  const casos = [[lote('agv-dht22-01'), 'NODO_NO_COINCIDE'], [lote(CODIGO, 'simulado'), 'SOLO_ORIGEN_REAL'], [[lote()], 'CUERPO_HTTP_INVALIDO'], [undefined, 'CUERPO_HTTP_INVALIDO'], [7, 'CUERPO_HTTP_INVALIDO'],
    [{ ...lote(), version: 1 }, 'VERSION'], [{ ...lote(), mediciones: lote().mediciones.slice(1) }, 'LOTE_AMBIENTAL_INCOMPLETO'], [JSON.stringify(lote('agv-dht22-01')), 'TOPICO_NO_COINCIDE'],
    [JSON.stringify(lote(CODIGO, 'simulado')), 'TOPICO_NO_COINCIDE'], ['{"version":2,"version":2}', 'CLAVE_REPETIDA']];
  for (const [cuerpo, codigo] of casos) {
    const r = preparar(webhook(cuerpo));
    assert.equal(r.estado, 'rechazado', codigo); assert.equal(r.codigo, codigo); assert.equal(r.solicitud_rpc, undefined, codigo);
    assert.deepEqual(r.respuesta_http, { codigo_http: 400, cuerpo: { estado: 'rechazado', codigo, intervalo_segundos: 120, pausado: false } });
  }
});

test('nodo HTTPS: la respuesta lleva intervalo y pausa del nodo; 200 solo con guardado confirmado, 400 rechazo de la base, 503 sin confirmacion', () => {
  const p = preparar(webhook(lote()), autenticado({ pausado: true, intervalo_segundos: 300 }));
  const ok = { estado: 'insertado', codigo: 'LOTE_AMBIENTAL_GUARDADO', mensaje_id: p.payload.mensaje_id, cultivo_id: id(20), medicion_ids: [id(1), id(2), id(3)], recibida_en: p.recibida_en };
  const guardado = resumirPersistenciaNodo(ok, p, resumirPersistenciaAmbiental);
  assert.equal(guardado.persistido, true);
  assert.deepEqual(guardado.respuesta_http, { codigo_http: 200, cuerpo: { estado: 'insertado', codigo: 'LOTE_AMBIENTAL_GUARDADO', intervalo_segundos: 300, pausado: true } });
  assert.equal(resumirPersistenciaNodo({ ...ok, estado: 'duplicado', codigo: 'LOTE_IDENTICO_NO_REINSERTADO' }, p, resumirPersistenciaAmbiental).respuesta_http.codigo_http, 200);
  assert.deepEqual(resumirPersistenciaNodo({ estado: 'rechazado', codigo: 'NODO_PAUSADO' }, p, resumirPersistenciaAmbiental).respuesta_http,
    { codigo_http: 400, cuerpo: { estado: 'rechazado', codigo: 'NODO_PAUSADO', intervalo_segundos: 300, pausado: true } }, 'el firmware ve que esta en pausa');
  for (const r of [{ error: { message: 'CLAVE_PRIVADA_FICTICIA' } }, { ...ok, medicion_ids: [id(1)] }, undefined]) {
    const x = resumirPersistenciaNodo(r, p, resumirPersistenciaAmbiental);
    assert.deepEqual(x.respuesta_http, { codigo_http: 503, cuerpo: { estado: 'pendiente', codigo: x.codigo, intervalo_segundos: 300, pausado: true } });
    assert.ok(!JSON.stringify(x).includes('CLAVE_PRIVADA_FICTICIA'));
  }
  assert.deepEqual(respuestaNodo({ estado: 'insertado', codigo: 'X', persistido: true }, { intervalo_segundos: null, pausado: false }).cuerpo, { estado: 'insertado', codigo: 'X', intervalo_segundos: null, pausado: false });
});

test('03i: webhook POST sin credencial compartida, autenticacion por nodo antes de validar, respuesta antes de alertas e IA', () => {
  const f = flujo(), nodo = name => f.nodes.find(n => n.name === name);
  assert.equal(f.active, false); assert.deepEqual(f.pinData, {}); assert.ok(f.nodes.every(n => !n.credentials)); assert.ok(!/AIza|sb_secret_/.test(JSON.stringify(f)));
  assert.deepEqual([f.settings.saveDataSuccessExecution, f.settings.saveDataErrorExecution, f.settings.saveManualExecutions, f.settings.saveExecutionProgress],
    ['none', 'none', false, false], 'las ejecuciones pueden contener la clave del nodo');
  assert.ok(!f.nodes.some(n => n.type === 'n8n-nodes-base.mqttTrigger'));
  const w = nodo('Webhook nodo');
  assert.deepEqual([w.type, w.parameters.httpMethod, w.parameters.path, w.parameters.authentication, w.parameters.responseMode], ['n8n-nodes-base.webhook', 'POST', 'agrovigia/nodo', 'none', 'responseNode']);
  for (const c of Object.values(f.connections)) for (const out of c.main) for (const e of out) assert.ok(nodo(e.node), e.node);
  assert.deepEqual(['Webhook nodo', 'Proyecto Supabase', 'Preparar autenticacion', 'Cabeceras validas', 'Autenticar nodo', 'Preparar ingesta', 'Forma valida', 'Guardar lote en Supabase', 'Resultado de persistencia', 'Responder ingesta']
    .map(n => f.connections[n].main[0][0].node), ['Proyecto Supabase', 'Preparar autenticacion', 'Cabeceras validas', 'Autenticar nodo', 'Preparar ingesta', 'Forma valida', 'Guardar lote en Supabase', 'Resultado de persistencia',
    'Responder ingesta', 'Preparar evaluacion']);
  assert.equal(f.connections['Cabeceras validas'].main[1][0].node, 'Responder sin autenticar');
  assert.equal(f.connections['Forma valida'].main[1][0].node, 'Rechazado antes de RPC'); assert.equal(f.connections['Rechazado antes de RPC'].main[0][0].node, 'Responder rechazo');
  const a = nodo('Autenticar nodo');
  assert.deepEqual([a.parameters.method, a.parameters.url, a.parameters.jsonBody, a.onError, a.parameters.options.response.response.fullResponse], ['POST', '={{ $json.destino_autenticar }}', '={{ $json.solicitud_autenticar }}', 'continueRegularOutput', true]);
  for (const name of ['Responder ingesta', 'Responder rechazo', 'Responder sin autenticar'])
    assert.deepEqual([nodo(name).parameters.responseBody, nodo(name).parameters.options.responseCode], ['={{ $json.respuesta_http.cuerpo }}', '={{ $json.respuesta_http.codigo_http }}']);
  assert.deepEqual([f.settings.saveDataSuccessExecution, f.settings.saveManualExecutions], ['none', false], 'no se guardan ejecuciones correctas ni sus cabeceras');
  const e03e = JSON.parse(fs.readFileSync(path.join(__dirname, '03e-ingesta-alertas.json'), 'utf8'));
  for (const name of ['Preparar evaluacion', 'Preparar RPC alertas', 'Resultado de alertas', 'Preparar reserva IA', 'Preparar Gemini', 'Interpretar Gemini', 'Resultado IA'])
    assert.equal(normalizarCodigo(nodo(name).parameters.jsCode), normalizarCodigo(e03e.nodes.find(n => n.name === name).parameters.jsCode), name + ' igual que 03e');
});

test('03i: el Code incrustado es el de los modulos probados y recorre autenticacion, validacion, guardado y alertas sin exponer la clave', () => {
  const f = flujo(), nodo = name => f.nodes.find(n => n.name === name);
  for (const name of ['Preparar ingesta', 'Resultado de persistencia']) {
    const codigo = normalizarCodigo(nodo(name).parameters.jsCode);
    assert.ok(codigo.includes(baseAmbiental()), 'Regenerar 03i: base v2');
    for (const fn of [prepararAutenticacionNodo, prepararIngestaNodo, resumirPersistenciaNodo, respuestaNodo, prepararIngestaAmbiental, resumirPersistenciaAmbiental])
      assert.ok(codigo.includes(normalizarCodigo(fn.toString())), 'Regenerar 03i tras modificar ' + fn.name);
  }
  assert.ok(normalizarCodigo(nodo('Preparar autenticacion').parameters.jsCode).includes(normalizarCodigo(prepararAutenticacionNodo.toString())));
  const ejecutar = (name, inputs, linked = {}) => JSON.parse(JSON.stringify(vm.runInNewContext('(function(){' + nodo(name).parameters.jsCode + '})()',
    { $input: { all: () => inputs.map(json => ({ json })) }, $: n => ({ itemMatching: i => ({ json: linked[n][i] }) }), Buffer })));
  const bueno = lote(), ajeno = lote('agv-dht22-01');
  const auth = ejecutar('Preparar autenticacion', [webhook(bueno), webhook(ajeno), { ...webhook(bueno), headers: {} }]);
  assert.deepEqual(auth.map(x => x.json.lista), [true, true, false]); assert.deepEqual(auth[2].json.respuesta_http, NO_AUTORIZADO); assert.deepEqual(auth.map(x => x.pairedItem.item), [0, 1, 2]);
  const prep = ejecutar('Preparar ingesta', [autenticado(), autenticado(), { statusCode: 200, body: { codigo: 'CLAVE_INVALIDA' } }], { 'Preparar autenticacion': [auth[0].json, auth[1].json, auth[0].json] });
  assert.deepEqual(prep.map(x => [x.json.estado, x.json.respuesta_http?.codigo_http ?? null, x.json.codigo]), [['prevalidado', null, 'FORMA_Y_TOPICO_VALIDOS'], ['rechazado', 400, 'NODO_NO_COINCIDE'], ['rechazado', 401, 'CLAVE_INVALIDA']]);
  assert.ok(!JSON.stringify(prep).includes(CLAVE), 'despues de autenticar la clave ya no viaja');
  const ok = { estado: 'insertado', codigo: 'LOTE_AMBIENTAL_GUARDADO', mensaje_id: bueno.mensaje_id, cultivo_id: id(20), medicion_ids: [id(1), id(2), id(3)], recibida_en: prep[0].json.recibida_en };
  const res = ejecutar('Resultado de persistencia', [ok, { error: { message: 'fallo' } }], { 'Preparar ingesta': [prep[0].json, prep[0].json] });
  assert.deepEqual(res.map(x => x.json.respuesta_http), [{ codigo_http: 200, cuerpo: { estado: 'insertado', codigo: 'LOTE_AMBIENTAL_GUARDADO', intervalo_segundos: 120, pausado: false } },
    { codigo_http: 503, cuerpo: { estado: 'pendiente', codigo: 'RPC_SIN_CONFIRMACION', intervalo_segundos: 120, pausado: false } }]);
  // La rama de alertas e IA recibe el guardado real igual que en 03e.
  const ev = ejecutar('Preparar evaluacion', [res[0].json], { 'Preparar ingesta': [prep[0].json] });
  assert.equal(ev[0].json.lista, true); assert.match(ev[0].json.consulta_nodo_url, /origen=eq\.real/); assert.match(ev[0].json.destino_alertas, /evaluar_alertas_lote$/);
});
