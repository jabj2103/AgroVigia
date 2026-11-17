'use strict';
// Flujo 03g: ingesta por HTTP. Logica pura y Code incrustado ejecutado en un contexto aislado.
// No es una ejecucion real de n8n ni una llamada a Supabase. Datos ficticios.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const { prepararIngestaHttp, resumirPersistenciaHttp, respuestaHttp } = require('./preparar-http.cjs');
const { prepararIngestaAmbiental, resumirPersistenciaAmbiental } = require('./preparar-ambiental.cjs');
const canal = { acl_verificada: true, retencion_broker_desactivada: true };
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const flujo = () => JSON.parse(fs.readFileSync(path.join(__dirname, '03g-ingesta-http.json'), 'utf8'));
const ahora = () => new Date().toISOString();
function loteV2(origen = 'simulado', nodo = 'agv-dht22-01') {
  const payload = { version: 2, nodo_codigo: nodo, mensaje_id: randomUUID(), origen, tomada_en: ahora().replace(/\.\d{3}Z$/, 'Z'),
    mediciones: [{ variable_codigo: 'temperatura_aire', valor: 31.4, unidad: '°C' }, { variable_codigo: 'humedad_aire', valor: 64, unidad: '% HR' },
      { variable_codigo: 'iluminacion_relativa', valor: 50, unidad: '% relativo' }], ldr: { metodo: 'adc12_10k_11db_v1', adc_promedio: 2048 } };
  payload.mediciones[2].valor = Math.round(2048 * 1000 / 4095) / 10;
  return { topico: `agrovigia/v2/${origen}/nodos/${nodo}/telemetria`, payload };
}
const webhook = (body, extra = {}) => ({ headers: { 'x-agrovigia-clave': 'CLAVE_FICTICIA_DE_PRUEBA' }, params: {}, query: {}, body, supabase_url: 'https://fixture.supabase.co', gemini_modelo: 'gemini-3.5-flash-lite', http_admite_real: 'no', ...extra });
// Lote v3 con el motor y el contrato del simulador (modulos ES: se cargan una vez).
let mods;
const cargar = async () => mods ??= { sim: await import('./preparar-simulada.mjs'), contrato: await import('../simulador/contrato-v3.mjs'), fx: await import('../simulador/tests/fixtures.mjs') };
async function loteV3() {
  const { contrato, fx } = await cargar(), f = fx.filas()[0];
  const { topico, payload } = contrato.prepararCapturaV3(fx.captura(), { nodo_local: f.nodo_local, nodo_codigo: f.nodo_codigo, asignacion_version: f.asignacion_version });
  return { topico, payload };
}
const preparar = async (json) => { const { sim } = await cargar(); return prepararIngestaHttp(json, canal, ahora(), prepararIngestaAmbiental, sim.prepararIngestaSimulada); };

test('HTTP: {topico, payload} v2 simulado y v3 simulado producen la misma solicitud de RPC que por MQTT', async () => {
  const { sim } = await cargar(), recibida = ahora();
  const b2 = loteV2(), p2 = prepararIngestaHttp(webhook(b2), canal, recibida, prepararIngestaAmbiental, sim.prepararIngestaSimulada);
  const mqtt2 = prepararIngestaAmbiental({ topic: b2.topico, message: JSON.stringify(b2.payload), supabase_url: 'https://fixture.supabase.co' }, canal, recibida);
  assert.equal(p2.estado, 'prevalidado'); assert.deepEqual(p2.solicitud_rpc, mqtt2.solicitud_rpc); assert.equal(p2.destino_rpc, mqtt2.destino_rpc);
  assert.match(p2.destino_rpc, /registrar_lote_ambiental$/); assert.equal(p2.payload.origen, 'simulado');
  assert.deepEqual([p2.canal_entrada, p2.fuente_recibida_en, p2.respuesta_http], ['http', 'inicio_validacion_http_aproximado', undefined]);
  const b3 = await loteV3(), p3 = prepararIngestaHttp(webhook(b3), canal, recibida, prepararIngestaAmbiental, sim.prepararIngestaSimulada);
  const mqtt3 = sim.prepararIngestaSimulada({ topic: b3.topico, message: JSON.stringify(b3.payload), supabase_url: 'https://fixture.supabase.co' }, canal, recibida);
  assert.equal(p3.estado, 'prevalidado', p3.codigo); assert.deepEqual(p3.solicitud_rpc, mqtt3.solicitud_rpc);
  assert.match(p3.destino_rpc, /registrar_lote_simulado_v3$/); assert.equal(p3.mensaje_id, b3.payload.mensaje_id);
  // El lote tambien puede llegar como su texto exacto.
  const texto = prepararIngestaHttp(webhook({ topico: b3.topico, payload: JSON.stringify(b3.payload) }), canal, recibida, prepararIngestaAmbiental, sim.prepararIngestaSimulada);
  assert.deepEqual(texto.solicitud_rpc, mqtt3.solicitud_rpc);
  assert.ok(!JSON.stringify([p2, p3]).includes('CLAVE_FICTICIA'), 'la cabecera con la clave no pasa al resultado');
});

test('HTTP: cuerpo, topico u origen no admitidos y lotes invalidos se rechazan con 400 y su codigo, sin llegar a la RPC', async () => {
  const b2 = loteV2(), b3 = await loteV3(), real = loteV2('real');
  const casos = [
    [webhook(undefined), 'CUERPO_HTTP_INVALIDO'], [webhook([b2]), 'CUERPO_HTTP_INVALIDO'], [webhook({ ...b2, extra: 1 }), 'CUERPO_HTTP_INVALIDO'], [webhook({ topico: b2.topico }), 'CUERPO_HTTP_INVALIDO'],
    [webhook({ topico: 7, payload: b2.payload }), 'TOPICO_NO_ADMITIDO'], [webhook({ topico: 'agrovigia/v1/simulado/nodos/agv-dht22-01/telemetria', payload: b2.payload }), 'TOPICO_NO_ADMITIDO'],
    [webhook({ topico: 'agrovigia/v3/real/nodos/sim-x-01/telemetria', payload: b3.payload }), 'TOPICO_NO_ADMITIDO'], [webhook({ topico: 'agrovigia/v2/simulado/nodos/+/telemetria', payload: b2.payload }), 'TOPICO_NO_ADMITIDO'],
    [webhook({ topico: b2.topico + '/otro', payload: b2.payload }), 'TOPICO_NO_ADMITIDO'],
    [webhook({ topico: b2.topico, payload: [1] }), 'PAYLOAD_DEBE_SER_OBJETO'], [webhook({ topico: b2.topico, payload: null }), 'PAYLOAD_DEBE_SER_OBJETO'], [webhook({ topico: b2.topico, payload: 5 }), 'PAYLOAD_DEBE_SER_OBJETO'],
    [webhook(real), 'ORIGEN_REAL_NO_ADMITIDO_POR_HTTP'],
    [webhook({ topico: b2.topico, payload: { ...b2.payload, version: 1 } }), 'VERSION'], [webhook({ topico: b2.topico, payload: { ...b2.payload, origen: 'real' } }), 'TOPICO_NO_COINCIDE'],
    [webhook({ topico: b2.topico.replace('agv-dht22-01', 'agv-otro-09'), payload: b2.payload }), 'TOPICO_NO_COINCIDE'], [webhook({ topico: b2.topico, payload: '{"version":2,"version":2}' }), 'CLAVE_REPETIDA'],
    [webhook({ topico: b3.topico, payload: { ...b3.payload, origen: 'real' } }), 'PAYLOAD_V3_INVALIDO'], [webhook({ topico: b3.topico, payload: { ...b3.payload, mediciones: b3.payload.mediciones.slice(1) } }), 'PAYLOAD_V3_INVALIDO'],
    [webhook({ topico: b3.topico.replace(b3.payload.nodo_codigo, 'sim-otro-nodo-01'), payload: b3.payload }), 'TOPICO_NO_COINCIDE'],
    [webhook(b2, { supabase_url: 'https://TU_PROYECTO.supabase.co' }), 'CONFIGURAR_URL_SUPABASE'], [webhook(b3, { supabase_url: 'https://externo.example' }), 'CONFIGURAR_URL_SUPABASE'],
  ];
  for (const [json, codigo] of casos) {
    const r = await preparar(json);
    assert.equal(r.estado, 'rechazado', codigo); assert.equal(r.codigo, codigo); assert.equal(r.persistido, false);
    assert.deepEqual(r.respuesta_http, { codigo_http: 400, cuerpo: { estado: 'rechazado', codigo } });
    assert.equal(r.solicitud_rpc, undefined, codigo); assert.equal(r.destino_rpc, undefined, codigo);
  }
  // El origen real solo entra si el flujo lo habilita de forma expresa; el resto de la validacion no cambia.
  const abierto = await preparar(webhook(real, { http_admite_real: 'si' }));
  assert.equal(abierto.estado, 'prevalidado'); assert.equal(abierto.payload.origen, 'real');
  assert.equal((await preparar(webhook(real, { http_admite_real: true }))).codigo, 'ORIGEN_REAL_NO_ADMITIDO_POR_HTTP');
});

test('HTTP: 200 solo con guardado o duplicado confirmado; rechazo de la base 400; sin confirmacion 503 para reintentar', async () => {
  const { sim } = await cargar();
  const p2 = await preparar(webhook(loteV2())), p3 = await preparar(webhook(await loteV3()));
  const ok2 = { estado: 'insertado', codigo: 'LOTE_AMBIENTAL_GUARDADO', mensaje_id: p2.payload.mensaje_id, cultivo_id: id(20), medicion_ids: [id(1), id(2), id(3)], recibida_en: p2.recibida_en };
  const ok3 = { estado: 'insertado', codigo: 'LOTE_SIMULADO_GUARDADO', origen: 'simulado', mensaje_id: p3.mensaje_id, tomada_en: p3.tomada_en, recibida_en: p3.recibida_en, cultivo_id: id(20), zona_id: id(21),
    medicion_ids: Array.from({ length: 10 }, (_, k) => id(100 + k)) };
  const resumir = (r, p) => resumirPersistenciaHttp(r, p, resumirPersistenciaAmbiental, sim.resumirPersistenciaSimulada);
  for (const [r, p] of [[ok2, p2], [ok3, p3], [{ ...ok2, estado: 'duplicado', codigo: 'LOTE_IDENTICO_NO_REINSERTADO' }, p2], [{ ...ok3, estado: 'duplicado', codigo: 'LOTE_IDENTICO_NO_REINSERTADO' }, p3]]) {
    const x = resumir(r, p);
    assert.equal(x.persistido, true); assert.deepEqual(x.respuesta_http, { codigo_http: 200, cuerpo: { estado: r.estado, codigo: r.codigo } });
    assert.equal(x.mensaje_id, r.mensaje_id); assert.equal(x.nuevo_lote, r.estado === 'insertado');
  }
  for (const [r, p] of [[{ estado: 'rechazado', codigo: 'NODO_PAUSADO' }, p2], [{ estado: 'rechazado', codigo: 'ASIGNACION_CAMBIO' }, p3], [{ estado: 'conflicto_id', codigo: 'MISMO_ID_OTRO_CONTENIDO' }, p3]]) {
    const x = resumir(r, p);
    assert.equal(x.persistido, false); assert.deepEqual(x.respuesta_http, { codigo_http: 400, cuerpo: { estado: r.estado, codigo: r.codigo } });
  }
  // Error HTTP de Supabase (el nodo continua con {error}) o respuesta incompleta: pendiente, sin filtrar el error.
  for (const [r, p] of [[{ error: { message: 'CLAVE_PRIVADA_FICTICIA' } }, p2], [{ error: { message: 'CLAVE_PRIVADA_FICTICIA' } }, p3], [{ ...ok2, medicion_ids: [id(1)] }, p2], [{ ...ok3, medicion_ids: ok3.medicion_ids.slice(1) }, p3], [undefined, p2]]) {
    const x = resumir(r, p);
    assert.notEqual(x.persistido, true); assert.equal(x.respuesta_http.codigo_http, 503); assert.equal(x.respuesta_http.cuerpo.estado, 'pendiente');
    assert.ok(!JSON.stringify(x).includes('CLAVE_PRIVADA_FICTICIA'));
  }
  assert.deepEqual(respuestaHttp(undefined), { codigo_http: 503, cuerpo: { estado: 'pendiente', codigo: 'SIN_CODIGO' } });
  assert.equal(respuestaHttp({ estado: 'insertado', codigo: 'X', persistido: false }).codigo_http, 503, 'insertado sin confirmar no es 200');
});

test('03g: webhook POST con clave en cabecera, respuesta antes de alertas e IA, sin credenciales ni claves en el archivo', () => {
  const f = flujo(), nodo = name => f.nodes.find(n => n.name === name);
  assert.equal(f.active, false); assert.deepEqual(f.pinData, {}); assert.ok(f.nodes.every(n => !n.credentials)); assert.ok(!/AIza|sb_secret_/.test(JSON.stringify(f)));
  assert.ok(!f.nodes.some(n => n.type === 'n8n-nodes-base.mqttTrigger'), 'sin MQTT');
  const w = nodo('Webhook ingesta');
  assert.deepEqual([w.type, w.parameters.httpMethod, w.parameters.path, w.parameters.authentication, w.parameters.responseMode],
    ['n8n-nodes-base.webhook', 'POST', 'agrovigia/telemetria', 'headerAuth', 'responseNode']);
  for (const c of Object.values(f.connections)) for (const out of c.main) for (const e of out) assert.ok(nodo(e.node), e.node);
  assert.equal(f.connections['Webhook ingesta'].main[0][0].node, 'Proyecto Supabase');
  // Guardado confirmado: primero responde y despues evalua alertas. Rechazo de forma: responde sin llamar a Supabase.
  assert.equal(f.connections['Resultado de persistencia'].main[0][0].node, 'Responder ingesta');
  assert.equal(f.connections['Responder ingesta'].main[0][0].node, 'Preparar evaluacion');
  assert.equal(f.connections['Forma valida'].main[1][0].node, 'Rechazado antes de RPC'); assert.equal(f.connections['Rechazado antes de RPC'].main[0][0].node, 'Responder rechazo');
  assert.equal(f.connections['Resultado de alertas'].main[0][0].node, 'Preparar reserva IA');
  for (const name of ['Responder ingesta', 'Responder rechazo']) {
    const r = nodo(name);
    assert.deepEqual([r.type, r.parameters.respondWith, r.parameters.responseBody, r.parameters.options.responseCode],
      ['n8n-nodes-base.respondToWebhook', 'json', '={{ $json.respuesta_http.cuerpo }}', '={{ $json.respuesta_http.codigo_http }}']);
  }
  const g = nodo('Guardar lote en Supabase'); assert.equal(g.onError, 'continueRegularOutput'); assert.equal(g.retryOnFail, true);
  const conf = Object.fromEntries(nodo('Proyecto Supabase').parameters.assignments.assignments.map(a => [a.name, a.value]));
  assert.deepEqual(conf, { supabase_url: 'https://TU_PROYECTO.supabase.co', gemini_modelo: 'gemini-3.5-flash-lite', http_admite_real: 'no' });
  assert.deepEqual([f.settings.saveDataSuccessExecution, f.settings.saveDataErrorExecution], ['none', 'all'], 'no se guardan ejecuciones correctas ni su cabecera');
});

test('03g: el Code incrustado es el de los modulos probados y ejecuta v2 y v3 de punta a punta hasta la reserva de IA', async () => {
  const { sim } = await cargar(), f = flujo(), nodo = name => f.nodes.find(n => n.name === name);
  const { baseAmbiental, baseSimulada } = require('./codigo-ingesta.cjs');
  for (const name of ['Preparar ingesta', 'Resultado de persistencia']) {
    const codigo = nodo(name).parameters.jsCode;
    assert.ok(codigo.includes(baseAmbiental()), 'Regenerar 03g: base v2'); assert.ok(codigo.includes(baseSimulada()), 'Regenerar 03g: base v3');
    for (const fn of [prepararIngestaHttp, resumirPersistenciaHttp, respuestaHttp, prepararIngestaAmbiental, resumirPersistenciaAmbiental, sim.prepararIngestaSimulada, sim.resumirPersistenciaSimulada])
      assert.ok(codigo.includes(fn.toString()), 'Regenerar 03g tras modificar ' + fn.name);
  }
  const e03e = JSON.parse(fs.readFileSync(path.join(__dirname, '03e-ingesta-alertas.json'), 'utf8')), e03f = JSON.parse(fs.readFileSync(path.join(__dirname, '03f-ingesta-simulada-v3.json'), 'utf8'));
  for (const name of ['Preparar evaluacion', 'Preparar RPC alertas', 'Resultado de alertas', 'Preparar reserva IA', 'Preparar Gemini', 'Interpretar Gemini', 'Resultado IA']) {
    assert.equal(nodo(name).parameters.jsCode, e03e.nodes.find(n => n.name === name).parameters.jsCode, name + ' igual que 03e');
    assert.equal(nodo(name).parameters.jsCode, e03f.nodes.find(n => n.name === name).parameters.jsCode, name + ' igual que 03f');
  }
  const ejecutar = (name, inputs, linked = {}) => JSON.parse(JSON.stringify(vm.runInNewContext('(function(){' + nodo(name).parameters.jsCode + '})()',
    { $input: { all: () => inputs.map(json => ({ json })) }, $: n => ({ itemMatching: i => ({ json: linked[n][i] }) }), Buffer })));
  const b2 = loteV2(), b3 = await loteV3();
  const prep = ejecutar('Preparar ingesta', [webhook(b2), webhook(b3), webhook(loteV2('real')), webhook({ topico: 'otro', payload: {} })]);
  assert.deepEqual(prep.map(x => x.json.estado), ['prevalidado', 'prevalidado', 'rechazado', 'rechazado']); assert.deepEqual(prep.map(x => x.pairedItem.item), [0, 1, 2, 3]);
  assert.deepEqual(prep.slice(2).map(x => [x.json.respuesta_http.codigo_http, x.json.respuesta_http.cuerpo.codigo]), [[400, 'ORIGEN_REAL_NO_ADMITIDO_POR_HTTP'], [400, 'TOPICO_NO_ADMITIDO']]);
  assert.equal(prep[0].json.solicitud_rpc.p_mensaje, JSON.stringify(b2.payload)); assert.equal(prep[1].json.solicitud_rpc.p_topico, b3.topico);
  const ok2 = { estado: 'insertado', codigo: 'LOTE_AMBIENTAL_GUARDADO', mensaje_id: b2.payload.mensaje_id, cultivo_id: id(20), medicion_ids: [id(1), id(2), id(3)], recibida_en: prep[0].json.recibida_en };
  const ok3 = { estado: 'insertado', codigo: 'LOTE_SIMULADO_GUARDADO', origen: 'simulado', mensaje_id: b3.payload.mensaje_id, tomada_en: b3.payload.tomada_en, recibida_en: prep[1].json.recibida_en,
    cultivo_id: id(20), zona_id: id(21), medicion_ids: Array.from({ length: 10 }, (_, k) => id(100 + k)) };
  const res = ejecutar('Resultado de persistencia', [ok2, ok3, { error: { message: 'fallo' } }], { 'Preparar ingesta': [prep[0].json, prep[1].json, prep[1].json] });
  assert.deepEqual(res.map(x => x.json.respuesta_http.codigo_http), [200, 200, 503]);
  assert.deepEqual(res[0].json.respuesta_http.cuerpo, { estado: 'insertado', codigo: 'LOTE_AMBIENTAL_GUARDADO' });
  // El nodo Responder deja pasar el mismo item: la rama de alertas e IA recibe el guardado v2 (3 mediciones) y v3 (10).
  const ev = ejecutar('Preparar evaluacion', res.map(x => x.json), { 'Preparar ingesta': [prep[0].json, prep[1].json, prep[1].json] });
  assert.deepEqual(ev.map(x => x.json.lista), [true, true, false]);
  assert.match(ev[0].json.consulta_nodo_url, /origen=eq\.simulado/); assert.match(ev[1].json.consulta_nodo_url, new RegExp('id=eq\\.' + id(100)));
  const rpc = ejecutar('Preparar RPC alertas', [{ statusCode: 200, body: [{ id: id(1), nodo_id: id(30), cultivo_id: id(20), mensaje_id: b2.payload.mensaje_id, origen: 'simulado' }] },
    { statusCode: 200, body: [{ id: id(100), nodo_id: id(31), cultivo_id: id(20), mensaje_id: b3.payload.mensaje_id, origen: 'simulado' }] }], { 'Preparar evaluacion': ev.map(x => x.json) });
  const al = ejecutar('Resultado de alertas', [{ statusCode: 200, body: { codigo: 'LOTE_EVALUADO', evaluadas: 2, abiertas: 1, actualizadas: 0, cerradas: 0 } },
    { statusCode: 200, body: { codigo: 'LOTE_EVALUADO', evaluadas: 3, abiertas: 0, actualizadas: 0, cerradas: 0 } }], { 'Preparar RPC alertas': rpc.map(x => x.json) });
  assert.deepEqual(al.map(x => x.json.alertas.estado), ['evaluada', 'evaluada']);
  const ia = ejecutar('Preparar reserva IA', al.map(x => x.json), { 'Preparar RPC alertas': rpc.map(x => x.json), 'Proyecto Supabase': [{ gemini_modelo: 'gemini-3.5-flash-lite' }, { gemini_modelo: 'gemini-3.5-flash-lite' }] });
  assert.deepEqual(ia.map(x => x.json.lista), [true, true]);
  assert.deepEqual(ia.map(x => x.json.solicitud_reserva), [{ p_nodo_id: id(30), p_mensaje_id: b2.payload.mensaje_id }, { p_nodo_id: id(31), p_mensaje_id: b3.payload.mensaje_id }]);
});
