'use strict';
// Flujo 03h: sugerencias de IA a peticion. Logica pura y Code incrustado en un contexto aislado.
// No es una ejecucion real de n8n, de Supabase ni de Gemini. Datos ficticios.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { prepararToma, repartirSolicitudes, prepararGeminiSolicitud, completarSolicitud, resultadoSolicitud, solicitudSinIA } = require('./preparar-solicitudes.cjs');
const { prepararGemini, INSTRUCCION_IA, ESQUEMA_IA } = require('./preparar-sugerencias.cjs');
const { normalizarCodigo } = require('./codigo-ingesta.cjs');
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const config = () => ({ supabase_url: 'https://fixture.supabase.co', gemini_modelo: 'gemini-3.5-flash-lite' });
const tomadas = (...ns) => ({ statusCode: 200, body: { codigo: 'SOLICITUDES_TOMADAS', solicitudes: ns.map(n => ({ solicitud_id: id(n), cultivo_id: id(20), origen: n % 2 ? 'simulado' : 'real', creada_en: '2026-11-16T15:00:00Z', intento: 1 })) } });
const contexto = () => ({ cultivo: { nombre: 'Simulado · Yuca' }, origen_datos: 'simulado', motivo: 'solicitud', periodo_del_dia: 'dia', clima_simulado: null,
  ajustes_manuales: { temperatura_aire: 4, humedad_suelo_vwc: -10 }, nodos: [{ codigo: 'sim-aaaaaaaa0001-01', valores: { temperatura_aire: 33.2, humedad_suelo_vwc: 15 } }] });
const reserva = n => ({ statusCode: 200, body: { codigo: 'RESERVADA', solicitud_id: id(n), sugerencia_id: id(40 + n), motivo: 'solicitud', contexto: contexto() } });
const respuestaIA = () => ({ resumen: 'Suelo simulado bajo el rango tras un ajuste manual.', estado_general: 'atencion',
  recomendaciones: [{ titulo: 'Revisar riego', accion: 'Comprueba el riego del sector.', prioridad: 'media', variable: 'humedad_suelo_vwc', evidencia: '15 % VWC frente a un mínimo de 20 %.' }],
  riego: 'El suelo simulado está seco.', luz: 'Índice normal para la hora.', limitaciones: 'Condiciones simuladas ajustadas a mano.' });
const gemini = (cuerpo = respuestaIA()) => ({ statusCode: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify(cuerpo) }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 1310, candidatesTokenCount: 420 }, modelVersion: 'gemini-3.5-flash-lite' } });
const flujo = () => JSON.parse(fs.readFileSync(path.join(__dirname, '03h-sugerencias-a-peticion.json'), 'utf8'));

test('solicitudes: la toma exige URL de Supabase y modelo validos; reparte una entrada por solicitud y nada si no hay', () => {
  const t = prepararToma(config());
  assert.deepEqual(t, { lista: true, codigo: 'POR_TOMAR', modelo_ia: 'gemini-3.5-flash-lite', destino_tomar: 'https://fixture.supabase.co/rest/v1/rpc/tomar_solicitudes_ia', solicitud_tomar: { p_limite: 3 },
    destino_preparar: 'https://fixture.supabase.co/rest/v1/rpc/preparar_solicitud_ia', destino_completar: 'https://fixture.supabase.co/rest/v1/rpc/completar_solicitud_ia' });
  assert.equal(prepararToma({ ...config(), supabase_url: 'https://fixture.supabase.co/' }).lista, true);
  for (const [c, codigo] of [[{ ...config(), supabase_url: 'https://TU_PROYECTO.supabase.co' }, 'CONFIGURAR_URL_SUPABASE'], [{ ...config(), supabase_url: 'https://externo.example' }, 'CONFIGURAR_URL_SUPABASE'],
    [{ ...config(), gemini_modelo: 'gpt-4' }, 'CONFIGURAR_MODELO_GEMINI'], [undefined, 'CONFIGURAR_URL_SUPABASE']])
    assert.deepEqual(prepararToma(c), { lista: false, codigo });
  const items = repartirSolicitudes(t, tomadas(1, 2));
  assert.deepEqual(items.map(i => [i.solicitud_id, i.origen, i.lista, i.modelo_ia]), [[id(1), 'simulado', true, 'gemini-3.5-flash-lite'], [id(2), 'real', true, 'gemini-3.5-flash-lite']]);
  assert.deepEqual(items[0].solicitud_preparar, { p_solicitud_id: id(1) }); assert.equal(items[0].destino_preparar, t.destino_preparar);
  for (const r of [tomadas(), { statusCode: 500, body: tomadas(1).body }, { error: { message: 'CLAVE_PRIVADA_FICTICIA' } }, { statusCode: 200, body: { codigo: 'OTRO', solicitudes: tomadas(1).body.solicitudes } },
    { statusCode: 200, body: { codigo: 'SOLICITUDES_TOMADAS', solicitudes: 'x' } }, undefined]) assert.deepEqual(repartirSolicitudes(t, r), []);
  assert.deepEqual(repartirSolicitudes({ lista: false }, tomadas(1)), []);
  assert.equal(repartirSolicitudes(t, { statusCode: 200, body: { codigo: 'SOLICITUDES_TOMADAS', solicitudes: [{ solicitud_id: 'x', origen: 'real' }, { solicitud_id: id(3), origen: 'mixto' }, ...tomadas(5).body.solicitudes] } }).length, 1);
});

test('solicitudes: la consulta a Gemini usa la misma instruccion y esquema que la rama automatica, con ajustes manuales en el contexto', () => {
  const [item] = repartirSolicitudes(prepararToma(config()), tomadas(1)), g = prepararGeminiSolicitud(item, reserva(1));
  assert.equal(g.lista, true); assert.deepEqual(g.solicitud, { estado: 'en_proceso', codigo: 'POR_CONSULTAR_GEMINI' });
  assert.deepEqual([g.ia.sugerencia_id, g.ia.motivo], [id(41), 'solicitud']);
  const automatica = prepararGemini({ modelo_ia: 'gemini-3.5-flash-lite' }, { statusCode: 200, body: { codigo: 'RESERVADA', sugerencia_id: id(41), motivo: 'alerta', contexto: contexto() } });
  assert.deepEqual(g.solicitud_gemini, automatica.solicitud_gemini, 'mismo armado que 03e, 03f y 03g'); assert.equal(g.destino_gemini, automatica.destino_gemini);
  assert.deepEqual(g.solicitud_gemini.generationConfig.responseSchema, ESQUEMA_IA);
  assert.match(g.solicitud_gemini.contents[0].parts[0].text, /"ajustes_manuales":\{"temperatura_aire":4,"humedad_suelo_vwc":-10\}/);
  // La instruccion pide interpretar los ajustes manuales y decir que son condiciones simuladas.
  assert.match(INSTRUCCION_IA, /ajustes_manuales/); assert.match(INSTRUCCION_IA, /condiciones simuladas ajustadas a mano/); assert.match(INSTRUCCION_IA, /motivo es "solicitud"/);
  assert.ok(!/key|clave/i.test(JSON.stringify(g.solicitud_gemini)));
});

test('solicitudes: sin datos, sin cupo o aplazada no consultan a Gemini; respuestas ajenas o fallidas tampoco', () => {
  const [item] = repartirSolicitudes(prepararToma(config()), tomadas(1));
  const cerrada = (estado, detalle) => ({ statusCode: 200, body: { codigo: 'SOLICITUD_CERRADA', solicitud_id: id(1), estado, detalle, sugerencia_id: null } });
  for (const [r, solicitud] of [
    [cerrada('sin_datos', 'SIN_LOTE_RECIENTE'), { estado: 'sin_datos', codigo: 'SOLICITUD_CERRADA', detalle: 'SIN_LOTE_RECIENTE' }],
    [cerrada('rechazada', 'LIMITE_DIARIO_CULTIVO'), { estado: 'rechazada', codigo: 'SOLICITUD_CERRADA', detalle: 'LIMITE_DIARIO_CULTIVO' }],
    [cerrada('error', 'CULTIVO_NO_ACTIVO'), { estado: 'error', codigo: 'SOLICITUD_CERRADA', detalle: 'CULTIVO_NO_ACTIVO' }],
    [{ statusCode: 200, body: { codigo: 'SOLICITUD_APLAZADA', solicitud_id: id(1), motivo: 'SUGERENCIA_EN_CURSO' } }, { estado: 'pendiente', codigo: 'SOLICITUD_APLAZADA', detalle: 'SUGERENCIA_EN_CURSO' }],
    [{ statusCode: 200, body: { codigo: 'SOLICITUD_NO_EN_PROCESO', solicitud_id: id(1), estado: 'atendida' } }, { estado: 'en_proceso', codigo: 'SOLICITUD_NO_EN_PROCESO' }],
    [{ statusCode: 500, body: {} }, { estado: 'en_proceso', codigo: 'PREPARACION_NO_CONFIRMADA' }], [{ error: { message: 'CLAVE_PRIVADA_FICTICIA' } }, { estado: 'en_proceso', codigo: 'PREPARACION_NO_CONFIRMADA' }],
    [reserva(2), { estado: 'en_proceso', codigo: 'RESPUESTA_DE_OTRA_SOLICITUD' }],
  ]) {
    const g = prepararGeminiSolicitud(item, r);
    assert.equal(g.lista, false, JSON.stringify(solicitud)); assert.deepEqual(g.solicitud, solicitud); assert.equal(g.solicitud_gemini, undefined);
    const fin = solicitudSinIA(g);
    assert.deepEqual(Object.keys(fin).sort(), ['cultivo_id', 'ia', 'origen', 'solicitud', 'solicitud_id']); assert.ok(!JSON.stringify(fin).includes('CLAVE_PRIVADA_FICTICIA'));
  }
});

test('solicitudes: la respuesta de Gemini se guarda con completar_solicitud_ia; un fallo de Gemini cierra la solicitud como error', () => {
  const [item] = repartirSolicitudes(prepararToma(config()), tomadas(1)), g = prepararGeminiSolicitud(item, reserva(1));
  const bien = completarSolicitud(g, gemini());
  assert.deepEqual(bien.solicitud_completar, { p_solicitud_id: id(1), p_respuesta: respuestaIA(), p_modelo: 'gemini-3.5-flash-lite', p_tokens_entrada: 1310, p_tokens_salida: 420, p_error_codigo: null });
  assert.equal(bien.solicitud_completar.p_sugerencia_id, undefined, 'la base resuelve la sugerencia desde la solicitud');
  const caido = completarSolicitud(g, { statusCode: 503 });
  assert.deepEqual([caido.solicitud_completar.p_solicitud_id, caido.solicitud_completar.p_respuesta, caido.solicitud_completar.p_error_codigo], [id(1), null, 'GEMINI_HTTP_503']);
  assert.equal(completarSolicitud(g, gemini({ ...respuestaIA(), estado_general: 'excelente' })).solicitud_completar.p_error_codigo, 'GEMINI_FORMA_INVALIDA');
  const ok = resultadoSolicitud(bien, { statusCode: 200, body: { codigo: 'SOLICITUD_CERRADA', solicitud_id: id(1), estado: 'atendida', detalle: null, sugerencia_id: id(41), sugerencia_estado: 'generada' } });
  assert.deepEqual(ok.solicitud, { estado: 'atendida', codigo: 'SOLICITUD_CERRADA', detalle: null });
  assert.deepEqual([ok.ia.estado, ok.ia.codigo, ok.ia.sugerencia_id, ok.ia.tokens.entrada], ['generada', 'SUGERENCIA_GUARDADA', id(41), 1310]);
  assert.deepEqual(Object.keys(ok).sort(), ['cultivo_id', 'ia', 'origen', 'solicitud', 'solicitud_id'], 'sin destinos ni cuerpos de solicitud');
  const mal = resultadoSolicitud(caido, { statusCode: 200, body: { codigo: 'SOLICITUD_CERRADA', solicitud_id: id(1), estado: 'error', detalle: 'GEMINI_HTTP_503', sugerencia_id: id(41), sugerencia_estado: 'fallida' } });
  assert.deepEqual([mal.solicitud.estado, mal.solicitud.detalle, mal.ia.estado, mal.ia.error_codigo], ['error', 'GEMINI_HTTP_503', 'fallida', 'GEMINI_HTTP_503']);
  for (const r of [{ statusCode: 500, body: {} }, { error: { message: 'CLAVE_PRIVADA_FICTICIA' } }, { statusCode: 200, body: { codigo: 'SOLICITUD_CERRADA', solicitud_id: id(9), estado: 'atendida' } }, { statusCode: 200, body: { codigo: 'SOLICITUD_SIN_RESERVA', solicitud_id: id(1) } }]) {
    const x = resultadoSolicitud(bien, r);
    assert.deepEqual([x.solicitud.estado, x.solicitud.codigo, x.ia.estado, x.ia.codigo], ['en_proceso', 'CIERRE_NO_CONFIRMADO', 'pendiente', 'GUARDADO_IA_NO_CONFIRMADO']);
    assert.ok(!JSON.stringify(x).includes('CLAVE_PRIVADA_FICTICIA'));
  }
});

test('03h: disparador cada 30 s, HTTP limitados con reintentos, sin credenciales y con el Code de los modulos probados', () => {
  const f = flujo(), nodo = name => f.nodes.find(n => n.name === name);
  assert.equal(f.active, false); assert.deepEqual(f.pinData, {}); assert.ok(f.nodes.every(n => !n.credentials)); assert.ok(!/AIza|sb_secret_/.test(JSON.stringify(f)));
  const d = nodo('Cada 30 segundos');
  assert.equal(d.type, 'n8n-nodes-base.scheduleTrigger'); assert.deepEqual(d.parameters.rule.interval, [{ field: 'seconds', secondsInterval: 30 }]);
  for (const c of Object.values(f.connections)) for (const out of c.main) for (const e of out) assert.ok(nodo(e.node), e.node);
  assert.deepEqual(['Cada 30 segundos', 'Proyecto Supabase', 'Preparar toma', 'Configuracion valida', 'Tomar solicitudes', 'Repartir solicitudes', 'Preparar solicitud', 'Preparar Gemini', 'Sugerencia reservada',
    'Consultar Gemini', 'Interpretar Gemini', 'Completar solicitud'].map(n => f.connections[n].main[0][0].node),
    ['Proyecto Supabase', 'Preparar toma', 'Configuracion valida', 'Tomar solicitudes', 'Repartir solicitudes', 'Preparar solicitud', 'Preparar Gemini', 'Sugerencia reservada', 'Consultar Gemini',
      'Interpretar Gemini', 'Completar solicitud', 'Resultado solicitud']);
  assert.equal(f.connections['Sugerencia reservada'].main[1][0].node, 'Solicitud sin IA'); assert.deepEqual(f.connections['Configuracion valida'].main[1], []);
  for (const name of ['Tomar solicitudes', 'Preparar solicitud', 'Consultar Gemini', 'Completar solicitud']) {
    const h = nodo(name);
    assert.equal(h.onError, 'continueRegularOutput'); assert.equal(h.retryOnFail, true); assert.equal(h.parameters.method, 'POST');
    assert.equal(h.parameters.options.response.response.fullResponse, true); assert.equal(h.parameters.options.redirect.redirect.followRedirects, false);
  }
  assert.equal(nodo('Consultar Gemini').parameters.options.timeout, 45000);
  for (const fn of [prepararToma, repartirSolicitudes, prepararGeminiSolicitud, completarSolicitud, resultadoSolicitud, prepararGemini])
    assert.ok(normalizarCodigo(nodo('Preparar Gemini').parameters.jsCode).includes(normalizarCodigo(fn.toString())), 'Regenerar 03h tras modificar ' + fn.name);
  assert.equal(f.settings.saveDataSuccessExecution, 'none');
});

test('03h: el Code incrustado procesa dos solicitudes a la vez con pairedItem y cierra cada una con su resultado', () => {
  const f = flujo();
  const ejecutar = (name, inputs, linked = {}) => JSON.parse(JSON.stringify(vm.runInNewContext('(function(){' + f.nodes.find(n => n.name === name).parameters.jsCode + '})()',
    { $input: { all: () => inputs.map(json => ({ json })), first: () => ({ json: inputs[0] }) }, $: n => ({ itemMatching: i => ({ json: linked[n][i] }), first: () => ({ json: linked[n][0] }) }) })));
  const t = ejecutar('Preparar toma', [config()]);
  assert.equal(t[0].json.lista, true);
  const items = ejecutar('Repartir solicitudes', [tomadas(1, 2)], { 'Preparar toma': [t[0].json] });
  assert.deepEqual(items.map(i => [i.json.solicitud_id, i.pairedItem.item]), [[id(1), 0], [id(2), 0]]);
  assert.deepEqual(ejecutar('Repartir solicitudes', [tomadas()], { 'Preparar toma': [t[0].json] }), [], 'sin solicitudes el flujo termina aqui');
  const g = ejecutar('Preparar Gemini', [reserva(1), { statusCode: 200, body: { codigo: 'SOLICITUD_CERRADA', solicitud_id: id(2), estado: 'sin_datos', detalle: 'SIN_LOTE_RECIENTE', sugerencia_id: null } }],
    { 'Repartir solicitudes': items.map(i => i.json) });
  assert.deepEqual(g.map(x => [x.json.lista, x.json.solicitud.estado, x.pairedItem.item]), [[true, 'en_proceso', 0], [false, 'sin_datos', 1]]);
  const sin = ejecutar('Solicitud sin IA', [g[1].json]);
  assert.deepEqual(sin[0].json, { solicitud_id: id(2), cultivo_id: id(20), origen: 'real', solicitud: { estado: 'sin_datos', codigo: 'SOLICITUD_CERRADA', detalle: 'SIN_LOTE_RECIENTE' }, ia: { estado: 'omitida', codigo: 'SOLICITUD_CERRADA' } });
  const i = ejecutar('Interpretar Gemini', [gemini()], { 'Preparar Gemini': [g[0].json] });
  assert.equal(i[0].json.solicitud_completar.p_solicitud_id, id(1)); assert.deepEqual(i[0].json.solicitud_completar.p_respuesta, respuestaIA());
  const out = ejecutar('Resultado solicitud', [{ statusCode: 200, body: { codigo: 'SOLICITUD_CERRADA', solicitud_id: id(1), estado: 'atendida', detalle: null, sugerencia_id: id(41), sugerencia_estado: 'generada' } }],
    { 'Interpretar Gemini': [i[0].json] });
  assert.deepEqual([out[0].json.solicitud.estado, out[0].json.ia.estado, out[0].json.solicitud_id], ['atendida', 'generada', id(1)]);
});
