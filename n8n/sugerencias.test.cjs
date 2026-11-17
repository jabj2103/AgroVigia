'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { prepararReservaIA, prepararGemini, interpretarGemini, resultadoIA, salidaSinIA, normalizarRespuestaIA, INSTRUCCION_IA, ESQUEMA_IA } = require('./preparar-sugerencias.cjs');
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const final = () => ({ codigo: 'LOTE_AMBIENTAL_GUARDADO', estado: 'insertado', persistido: true, nuevo_lote: true, mensaje_id: id(10), cultivo_id: id(20),
  medicion_ids: [id(1), id(2), id(3)], alertas: { estado: 'evaluada', codigo: 'LOTE_EVALUADO', evaluadas: 2, abiertas: 1, actualizadas: 0, cerradas: 0 } });
const rpcAlertas = () => ({ destino_alertas: 'https://fixture.supabase.co/rest/v1/rpc/evaluar_alertas_lote', solicitud_alertas: { p_nodo_id: id(30), p_mensaje_id: id(10) } });
const contexto = () => ({ cultivo: { nombre: 'Simulado · Yuca' }, origen_datos: 'simulado', periodo_del_dia: 'dia', nodos: [{ codigo: 'agv-sim-01', valores: { temperatura_aire: 36.1 } }] });
const reserva = () => ({ statusCode: 200, body: { codigo: 'RESERVADA', sugerencia_id: id(40), motivo: 'alerta', contexto: contexto() } });
const respuestaIA = () => ({ resumen: 'Temperatura sobre el maximo de la plantilla.', estado_general: 'atencion',
  recomendaciones: [{ titulo: 'Reducir estres por calor', accion: 'Verifica el suelo y riega temprano si esta seco.', prioridad: 'alta', variable: 'temperatura_aire', evidencia: '36.1 C frente a maximo 35 C.' }],
  riego: 'Sin sensor de suelo: comprobar con la prueba del puno.', luz: 'Indice relativo alto de dia, no lux.', limitaciones: 'Datos simulados.' });
const gemini = (cuerpo = respuestaIA(), extra = {}) => ({ statusCode: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify(cuerpo) }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 812, candidatesTokenCount: 233 }, modelVersion: 'gemini-3.5-flash-lite', ...extra } });
const flujo = () => JSON.parse(fs.readFileSync(path.join(__dirname, '03e-ingesta-alertas.json'), 'utf8'));

test('IA: solo lotes nuevos con alertas evaluadas reservan; duplicados, fallos y modelo invalido no gastan', () => {
  const ok = prepararReservaIA(final(), rpcAlertas(), 'gemini-3.5-flash-lite');
  assert.equal(ok.lista, true);
  assert.equal(ok.destino_reserva, 'https://fixture.supabase.co/rest/v1/rpc/reservar_sugerencia_ia');
  assert.deepEqual(ok.solicitud_reserva, { p_nodo_id: id(30), p_mensaje_id: id(10) });
  const casos = [
    [{ ...final(), estado: 'duplicado' }, rpcAlertas(), 'LOTE_NO_NUEVO'],
    [{ ...final(), persistido: false }, rpcAlertas(), 'LOTE_NO_NUEVO'],
    [{ ...final(), alertas: { estado: 'pendiente' } }, rpcAlertas(), 'ALERTAS_NO_EVALUADAS'],
    [final(), { ...rpcAlertas(), destino_alertas: 'https://externo.example/rest/v1/rpc/evaluar_alertas_lote' }, 'CONTEXTO_IA_INCONSISTENTE'],
    [final(), { ...rpcAlertas(), solicitud_alertas: { p_nodo_id: id(30), p_mensaje_id: id(99) } }, 'CONTEXTO_IA_INCONSISTENTE'],
  ];
  for (const [f, r, codigo] of casos) { const x = prepararReservaIA(f, r, 'gemini-3.5-flash-lite'); assert.equal(x.lista, false); assert.equal(x.ia.codigo, codigo); assert.equal(x.persistido, f.persistido); }
  for (const m of ['', 'gpt-4', 'gemini-2.5 flash', undefined]) assert.equal(prepararReservaIA(final(), rpcAlertas(), m).ia.codigo, 'CONFIGURAR_MODELO_GEMINI');
});

test('IA: arma la solicitud a Gemini con esquema JSON, instruccion sin claves y sin razonamiento cobrado', () => {
  const previo = prepararReservaIA(final(), rpcAlertas(), 'gemini-3.5-flash-lite');
  const g = prepararGemini(previo, reserva());
  assert.equal(g.lista, true);
  assert.equal(g.destino_gemini, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
  assert.equal(g.solicitud_gemini.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(g.solicitud_gemini.generationConfig.responseSchema, ESQUEMA_IA);
  assert.deepEqual(g.solicitud_gemini.generationConfig.thinkingConfig, { thinkingLevel: 'minimal' });
  // La familia 2.5 usa thinkingBudget 0; la 3.x lo rechaza con HTTP 400 (comprobado contra la API el 4 nov 2026).
  assert.deepEqual(prepararGemini(prepararReservaIA(final(), rpcAlertas(), 'gemini-2.5-flash'), reserva()).solicitud_gemini.generationConfig.thinkingConfig, { thinkingBudget: 0 });
  assert.match(g.solicitud_gemini.contents[0].parts[0].text, /agv-sim-01/);
  assert.match(INSTRUCCION_IA, /NO lux/); assert.match(INSTRUCCION_IA, /humedad del suelo/); assert.match(INSTRUCCION_IA, /simulado/);
  assert.ok(!/key|clave/i.test(JSON.stringify(g.solicitud_gemini)));
  assert.equal(prepararGemini(prepararReservaIA(final(), rpcAlertas(), 'gemini-3-pro'), reserva()).solicitud_gemini.generationConfig.thinkingConfig, undefined);
  for (const [r, codigo, estado] of [[{ statusCode: 200, body: { codigo: 'NO_CORRESPONDE' } }, 'NO_CORRESPONDE', 'omitida'], [{ statusCode: 500, body: {} }, 'RESERVA_NO_CONFIRMADA', 'pendiente'],
    [{ error: { message: 'secreto' } }, 'RESERVA_NO_CONFIRMADA', 'pendiente'], [{ statusCode: 200, body: { ...reserva().body, sugerencia_id: 'x' } }, 'RESERVA_INCOMPLETA', 'pendiente']]) {
    const x = prepararGemini(previo, r); assert.equal(x.lista, false); assert.equal(x.ia.codigo, codigo); assert.equal(x.ia.estado, estado);
  }
});

test('IA: interpreta Gemini; errores HTTP, bloqueo, truncado y JSON malo se guardan como fallo sin cuerpo', () => {
  const g = prepararGemini(prepararReservaIA(final(), rpcAlertas(), 'gemini-3.5-flash-lite'), reserva());
  const bien = interpretarGemini(g, gemini());
  assert.deepEqual(bien.solicitud_completar.p_respuesta, respuestaIA());
  assert.equal(bien.solicitud_completar.p_error_codigo, null);
  assert.equal(bien.solicitud_completar.p_tokens_entrada, 812);
  assert.equal(bien.solicitud_completar.p_sugerencia_id, id(40));
  const casos = [
    [{ statusCode: 429, body: { error: { message: 'API key AIza_FICTICIA quota' } } }, 'GEMINI_HTTP_429'],
    [{ error: { message: 'AIza_FICTICIA' } }, 'GEMINI_SIN_RESPUESTA'],
    [{ statusCode: 200, body: { promptFeedback: { blockReason: 'SAFETY' } } }, 'GEMINI_BLOQUEADA'],
    [{ statusCode: 200, body: { candidates: [] } }, 'GEMINI_SIN_CANDIDATOS'],
    [{ statusCode: 200, body: { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"resu' }] } }] } }, 'GEMINI_RESPUESTA_TRUNCADA'],
    [{ statusCode: 200, body: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'no es json' }] } }] } }, 'GEMINI_JSON_INVALIDO'],
    [gemini({ ...respuestaIA(), estado_general: 'excelente' }), 'GEMINI_FORMA_INVALIDA'],
    [gemini({ ...respuestaIA(), resumen: '<b>hola</b>' }), 'GEMINI_FORMA_INVALIDA'],
  ];
  for (const [r, codigo] of casos) {
    const x = interpretarGemini(g, r);
    assert.equal(x.solicitud_completar.p_error_codigo, codigo); assert.equal(x.solicitud_completar.p_respuesta, null);
    assert.ok(!JSON.stringify(x).includes('AIza_FICTICIA'));
  }
  // Las partes de razonamiento no se mezclan con la respuesta.
  const conPensamiento = gemini(); conPensamiento.body.candidates[0].content.parts.unshift({ thought: true, text: 'razonando...' });
  assert.deepEqual(interpretarGemini(g, conPensamiento).solicitud_completar.p_respuesta, respuestaIA());
});

test('IA: normaliza textos largos recortando y rechaza forma o enums distintos a los de la base', () => {
  const largo = { ...respuestaIA(), resumen: 'palabra '.repeat(200) };
  const n = normalizarRespuestaIA(largo);
  assert.ok(n.resumen.length <= 600 && n.resumen.endsWith('…'));
  assert.equal(normalizarRespuestaIA({ ...respuestaIA(), extra: 1 }), null);
  assert.equal(normalizarRespuestaIA({ ...respuestaIA(), recomendaciones: [] }), null);
  assert.equal(normalizarRespuestaIA({ ...respuestaIA(), riego: '  ' }), null);
  assert.equal(normalizarRespuestaIA({ ...respuestaIA(), recomendaciones: [{ ...respuestaIA().recomendaciones[0], variable: 'suelo' }] }), null);
});

test('IA: el resumen final conserva persistencia y alertas; retira destinos y solicitudes', () => {
  const g = prepararGemini(prepararReservaIA(final(), rpcAlertas(), 'gemini-3.5-flash-lite'), reserva());
  const i = interpretarGemini(g, gemini());
  const r = resultadoIA(i, { statusCode: 200, body: { codigo: 'SUGERENCIA_GUARDADA', estado: 'generada', sugerencia_id: id(40), error_codigo: null } });
  assert.equal(r.ia.estado, 'generada'); assert.equal(r.persistido, true); assert.equal(r.alertas.abiertas, 1);
  assert.deepEqual(r.ia.tokens, { entrada: 812, salida: 233 });
  for (const k of ['destino_gemini', 'solicitud_gemini', 'solicitud_completar', 'destino_reserva']) assert.equal(r[k], undefined);
  assert.equal(resultadoIA(i, { statusCode: 500 }).ia.codigo, 'GUARDADO_IA_NO_CONFIRMADO');
  assert.equal(salidaSinIA(prepararReservaIA({ ...final(), estado: 'duplicado' }, rpcAlertas(), 'gemini-3.5-flash-lite')).ia.codigo, 'LOTE_NO_NUEVO');
});

test('03e: rama IA conectada, sin credenciales, receptor real y simulado, HTTP con limites', () => {
  const f = flujo();
  assert.equal(f.active, false); assert.ok(f.nodes.every(n => !n.credentials));
  assert.equal(f.nodes.find(n => n.name === 'MQTT receptor').parameters.topics, 'agrovigia/v2/+/nodos/+/telemetria:1');
  const modelo = f.nodes.find(n => n.name === 'Proyecto Supabase').parameters.assignments.assignments.find(a => a.name === 'gemini_modelo');
  assert.match(modelo.value, /^gemini-/);
  for (const c of Object.values(f.connections)) for (const out of c.main) for (const e of out) assert.ok(f.nodes.some(n => n.name === e.node), e.node);
  assert.equal(f.connections['Resultado de alertas'].main[0][0].node, 'Preparar reserva IA');
  assert.equal(f.connections['IA corresponde'].main[1][0].node, 'Sin sugerencia IA');
  assert.equal(f.connections['Sugerencia reservada'].main[1][0].node, 'Sin sugerencia IA');
  const g = f.nodes.find(n => n.name === 'Consultar Gemini');
  assert.equal(g.onError, 'continueRegularOutput'); assert.equal(g.maxTries, 2); assert.equal(g.parameters.options.timeout, 45000);
  assert.equal(g.parameters.options.redirect.redirect.followRedirects, false);
  for (const n of ['Reservar sugerencia IA', 'Guardar sugerencia IA']) assert.equal(f.nodes.find(x => x.name === n).parameters.genericAuthType, 'httpHeaderAuth');
  assert.ok(!/AIza|sb_secret_/.test(JSON.stringify(f)));
});

test('03e: Code IA incrustados respetan pairedItem con dos lotes y no mezclan sugerencias', () => {
  const f = flujo();
  const ejecutar = (name, inputs, linked) => vm.runInNewContext('(function(){' + f.nodes.find(n => n.name === name).parameters.jsCode + '})()',
    { $input: { all: () => inputs.map(json => ({ json })) }, $: node => ({ itemMatching: i => ({ json: linked[node][i] }) }) });
  const finales = [final(), { ...final(), mensaje_id: id(11) }];
  const rpcs = [rpcAlertas(), { ...rpcAlertas(), solicitud_alertas: { p_nodo_id: id(31), p_mensaje_id: id(11) } }];
  const conf = [{ gemini_modelo: 'gemini-3.5-flash-lite' }, { gemini_modelo: 'gemini-3.5-flash-lite' }];
  const r = ejecutar('Preparar reserva IA', finales, { 'Preparar RPC alertas': rpcs, 'Proyecto Supabase': conf });
  assert.equal(r[1].pairedItem.item, 1); assert.equal(r[1].json.solicitud_reserva.p_nodo_id, id(31));
  const reservas = [reserva(), { statusCode: 200, body: { ...reserva().body, sugerencia_id: id(41) } }];
  const g = ejecutar('Preparar Gemini', reservas, { 'Preparar reserva IA': r.map(x => x.json) });
  assert.equal(g[1].json.ia.sugerencia_id, id(41));
  const i = ejecutar('Interpretar Gemini', [gemini(), { statusCode: 503 }], { 'Preparar Gemini': g.map(x => x.json) });
  assert.equal(i[0].json.solicitud_completar.p_sugerencia_id, id(40)); assert.equal(i[1].json.solicitud_completar.p_error_codigo, 'GEMINI_HTTP_503');
  const out = ejecutar('Resultado IA', [{ statusCode: 200, body: { codigo: 'SUGERENCIA_GUARDADA', estado: 'generada' } }, { statusCode: 200, body: { codigo: 'SUGERENCIA_FALLIDA', estado: 'fallida', error_codigo: 'GEMINI_HTTP_503' } }],
    { 'Interpretar Gemini': i.map(x => x.json) });
  assert.deepEqual(out.map(o => o.json.ia.estado), ['generada', 'fallida']); assert.equal(out[1].json.mensaje_id, id(11));
});

test('03f: lote simulado v3 de diez mediciones pasa a alertas y a la rama IA; pairedItem y origen simulado', () => {
  const f = JSON.parse(fs.readFileSync(path.join(__dirname, '03f-ingesta-simulada-v3.json'), 'utf8'));
  assert.equal(f.active, false); assert.ok(f.nodes.every(n => !n.credentials)); assert.ok(!/AIza|sb_secret_/.test(JSON.stringify(f)));
  assert.equal(f.nodes.find(n => n.name === 'MQTT receptor').parameters.topics, 'agrovigia/v3/simulado/nodos/+/telemetria:1');
  assert.equal(f.connections['Resultado de persistencia'].main[0][0].node, 'Preparar evaluacion');
  assert.equal(f.connections['Resultado de alertas'].main[0][0].node, 'Preparar reserva IA');
  for (const c of Object.values(f.connections)) for (const out of c.main) for (const e of out) assert.ok(f.nodes.some(n => n.name === e.node), e.node);
  const ejecutar = (name, inputs, linked) => vm.runInNewContext('(function(){' + f.nodes.find(n => n.name === name).parameters.jsCode + '})()',
    { $input: { all: () => inputs.map(json => ({ json })) }, $: node => ({ itemMatching: i => ({ json: linked[node][i] }) }), Buffer });
  const persistencia = m => ({ estado: 'insertado', codigo: 'LOTE_SIMULADO_GUARDADO', persistido: true, nuevo_lote: true, origen: 'simulado', mensaje_id: id(m),
    cultivo_id: id(20), zona_id: id(21), medicion_ids: Array.from({ length: 10 }, (_, k) => id(m * 100 + k)) });
  const ingesta = m => ({ estado: 'prevalidado', origen: 'simulado', mensaje_id: id(m), destino_rpc: 'https://fixture.supabase.co/rest/v1/rpc/registrar_lote_simulado_v3' });
  const ev = ejecutar('Preparar evaluacion', [persistencia(10), persistencia(11)], { 'Preparar ingesta': [ingesta(10), ingesta(11)] });
  assert.equal(ev[1].pairedItem.item, 1); assert.ok(ev.every(x => x.json.lista));
  assert.match(ev[0].json.consulta_nodo_url, /origen=eq\.simulado/); assert.match(ev[1].json.consulta_nodo_url, new RegExp('id=eq\\.' + id(1100)));
  // Un lote v3 con 3 mediciones o un destino v2 mezclado no llega a HTTP.
  const malo = ejecutar('Preparar evaluacion', [{ ...persistencia(10), medicion_ids: persistencia(10).medicion_ids.slice(0, 3) }], { 'Preparar ingesta': [ingesta(10)] });
  assert.equal(malo[0].json.lista, false);
  const rpc = ejecutar('Preparar RPC alertas', [{ statusCode: 200, body: [{ id: id(1000), nodo_id: id(30), cultivo_id: id(20), mensaje_id: id(10), origen: 'simulado' }] }], { 'Preparar evaluacion': [ev[0].json] });
  assert.deepEqual(JSON.parse(JSON.stringify(rpc[0].json.solicitud_alertas)), { p_nodo_id: id(30), p_mensaje_id: id(10) });
  const res = ejecutar('Resultado de alertas', [{ statusCode: 200, body: { codigo: 'LOTE_EVALUADO', evaluadas: 10, abiertas: 2, actualizadas: 0, cerradas: 0 } }], { 'Preparar RPC alertas': [rpc[0].json] });
  assert.equal(res[0].json.alertas.estado, 'evaluada'); assert.equal(res[0].json.alertas.evaluadas, 10);
  const r = ejecutar('Preparar reserva IA', [res[0].json], { 'Preparar RPC alertas': [rpc[0].json], 'Proyecto Supabase': [{ gemini_modelo: 'gemini-3.5-flash-lite' }] });
  assert.equal(r[0].json.lista, true); assert.deepEqual(JSON.parse(JSON.stringify(r[0].json.solicitud_reserva)), { p_nodo_id: id(30), p_mensaje_id: id(10) });
});

test('IA v3: recomendaciones sobre humedad del suelo, pH o lluvia son validas; la instruccion usa el suelo si existe', () => {
  for (const variable of ['humedad_suelo_vwc', 'ph_suelo', 'precipitacion_60min', 'velocidad_viento'])
    assert.ok(normalizarRespuestaIA({ ...respuestaIA(), recomendaciones: [{ ...respuestaIA().recomendaciones[0], variable }] }), variable);
  assert.equal(normalizarRespuestaIA({ ...respuestaIA(), recomendaciones: [{ ...respuestaIA().recomendaciones[0], variable: 'humedad_hoja' }] }), null);
  assert.match(INSTRUCCION_IA, /humedad_suelo_vwc/); assert.match(INSTRUCCION_IA, /suelo_vwc_optima_min/); assert.match(INSTRUCCION_IA, /sin_sensor_de/);
  assert.match(INSTRUCCION_IA, /clima_simulado/); assert.match(INSTRUCCION_IA, /no es el clima real/); assert.match(INSTRUCCION_IA, /plantilla\.ajustada/);
  assert.ok(ESQUEMA_IA.properties.recomendaciones.items.properties.variable.enum.includes('humedad_suelo_vwc'));
});
