'use strict';
// Regla unica de destino de Supabase en todos los flujos: la nube (https://<proyecto>.supabase.co) o un Supabase
// de desarrollo en http://127.0.0.1:<puerto>, http://localhost:<puerto> o http://host.docker.internal:<puerto>.
// Cualquier otro destino, y sobre todo cualquier otro http, se rechaza antes de enviar nada.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const { prepararIngestaAmbiental } = require('./preparar-ambiental.cjs');
const { prepararEvaluacionAlertas } = require('./preparar-alertas.cjs');
const { prepararReservaIA } = require('./preparar-sugerencias.cjs');
const { prepararToma } = require('./preparar-solicitudes.cjs');
const { prepararAutenticacionNodo } = require('./preparar-nodo.cjs');
const canal = { acl_verificada: true, retencion_broker_desactivada: true };
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const ADMITIDAS = ['https://abcdefghijklmnop.supabase.co', 'http://127.0.0.1:54321', 'http://localhost:54321', 'http://host.docker.internal:54321'];
const RECHAZADAS = ['http://abcdefghijklmnop.supabase.co', 'https://127.0.0.1:54321', 'http://192.168.1.20:54321', 'http://10.0.0.5:54321', 'http://host.docker.internal', 'http://localhost',
  'http://127.0.0.1:54321/rest', 'http://127.0.0.1:543210', 'http://localhost.evil.example:54321', 'http://evil.example/127.0.0.1:54321', 'https://evil.example', 'http://127.0.0.1:54321@evil.example',
  'http://[::1]:54321', 'ftp://127.0.0.1:54321', '', null];
function lote() {
  return { version: 2, nodo_codigo: 'agv-dht22-01', mensaje_id: randomUUID(), origen: 'real', tomada_en: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    mediciones: [{ variable_codigo: 'temperatura_aire', valor: 28, unidad: '°C' }, { variable_codigo: 'humedad_aire', valor: 70, unidad: '% HR' },
      { variable_codigo: 'iluminacion_relativa', valor: 50, unidad: '% relativo' }], ldr: { metodo: 'adc12_10k_11db_v1', adc_promedio: 2048 } };
}

test('destino: los lotes v2 y v3, las alertas, la IA, las solicitudes y la autenticacion de nodos aceptan la nube y el Supabase local', async () => {
  const { prepararIngestaSimulada } = await import('./preparar-simulada.mjs'), contrato = await import('../simulador/contrato-v3.mjs'), fx = await import('../simulador/tests/fixtures.mjs');
  const f = fx.filas()[0], v3 = contrato.prepararCapturaV3(fx.captura(), { nodo_local: f.nodo_local, nodo_codigo: f.nodo_codigo, asignacion_version: f.asignacion_version });
  for (const url of ADMITIDAS) for (const u of [url, url + '/']) {
    const l = lote(), p2 = prepararIngestaAmbiental({ topic: 'agrovigia/v2/real/nodos/agv-dht22-01/telemetria', message: JSON.stringify(l), supabase_url: u }, canal, new Date().toISOString());
    assert.equal(p2.estado, 'prevalidado', u); assert.equal(p2.destino_rpc, url + '/rest/v1/rpc/registrar_lote_ambiental');
    const p3 = prepararIngestaSimulada({ topic: v3.topico, message: v3.mensaje, supabase_url: u }, canal, new Date().toISOString());
    assert.equal(p3.estado, 'prevalidado', u); assert.equal(p3.destino_rpc, url + '/rest/v1/rpc/registrar_lote_simulado_v3');
    const persistencia = { estado: 'insertado', persistido: true, mensaje_id: l.mensaje_id, cultivo_id: id(20), medicion_ids: [id(1), id(2), id(3)] };
    const ev = prepararEvaluacionAlertas(persistencia, p2);
    assert.equal(ev.lista, true, u); assert.equal(ev.destino_alertas, url + '/rest/v1/rpc/evaluar_alertas_lote'); assert.ok(ev.consulta_nodo_url.startsWith(url + '/rest/v1/mediciones?'));
    const ia = prepararReservaIA({ ...persistencia, alertas: { estado: 'evaluada' } }, { destino_alertas: ev.destino_alertas, solicitud_alertas: { p_nodo_id: id(30), p_mensaje_id: l.mensaje_id } }, 'gemini-3.5-flash-lite');
    assert.equal(ia.lista, true, u); assert.equal(ia.destino_reserva, url + '/rest/v1/rpc/reservar_sugerencia_ia');
    assert.equal(prepararToma({ supabase_url: u, gemini_modelo: 'gemini-3.5-flash-lite' }).destino_tomar, url + '/rest/v1/rpc/tomar_solicitudes_ia');
    assert.equal(prepararAutenticacionNodo({ headers: { 'x-agrovigia-nodo': 'agv-esp4c1d-27', 'x-agrovigia-clave': 'CLAVE_FICTICIA_DE_NODO_0123456789' }, body: l, supabase_url: u }).destino_autenticar, url + '/rest/v1/rpc/autenticar_nodo');
  }
  for (const url of RECHAZADAS) {
    const l = lote(), etiqueta = String(url);
    assert.equal(prepararIngestaAmbiental({ topic: 'agrovigia/v2/real/nodos/agv-dht22-01/telemetria', message: JSON.stringify(l), supabase_url: url }, canal, new Date().toISOString()).codigo, 'CONFIGURAR_URL_SUPABASE', etiqueta);
    assert.equal(prepararIngestaSimulada({ topic: v3.topico, message: v3.mensaje, supabase_url: url }, canal, new Date().toISOString()).codigo, 'CONFIGURAR_URL_SUPABASE', etiqueta);
    const persistencia = { estado: 'insertado', persistido: true, mensaje_id: l.mensaje_id, cultivo_id: id(20), medicion_ids: [id(1), id(2), id(3)] };
    assert.equal(prepararEvaluacionAlertas(persistencia, { destino_rpc: url + '/rest/v1/rpc/registrar_lote_ambiental', payload: l }).lista, false, etiqueta);
    assert.equal(prepararReservaIA({ ...persistencia, alertas: { estado: 'evaluada' } }, { destino_alertas: url + '/rest/v1/rpc/evaluar_alertas_lote', solicitud_alertas: { p_nodo_id: id(30), p_mensaje_id: l.mensaje_id } }, 'gemini-3.5-flash-lite').lista, false, etiqueta);
    assert.equal(prepararToma({ supabase_url: url, gemini_modelo: 'gemini-3.5-flash-lite' }).lista, false, etiqueta);
    assert.equal(prepararAutenticacionNodo({ headers: { 'x-agrovigia-nodo': 'agv-esp4c1d-27', 'x-agrovigia-clave': 'CLAVE_FICTICIA_DE_NODO_0123456789' }, body: l, supabase_url: url }).lista, false, etiqueta);
  }
});

test('destino: los flujos generados llevan la misma regla incrustada y ningun destino fijo', () => {
  const regla = String.raw`(?:https:\/\/[a-z0-9-]+\.supabase\.co|http:\/\/(?:127\.0\.0\.1|localhost|host\.docker\.internal):[0-9]{2,5})`;
  for (const archivo of ['03e-ingesta-alertas.json', '03f-ingesta-simulada-v3.json', '03g-ingesta-http.json', '03h-sugerencias-a-peticion.json', '03i-ingesta-nodo-https.json']) {
    const f = JSON.parse(fs.readFileSync(path.join(__dirname, archivo), 'utf8')), codigo = f.nodes.filter(n => n.type === 'n8n-nodes-base.code').map(n => n.parameters.jsCode).join('\n');
    assert.ok(codigo.includes(regla), archivo + ': regenerar');
    assert.ok(!/\^\(?https:\\\/\\\/\[a-z0-9-\]\+\\\.supabase\\\.co\)?(\\\/|\$)/.test(codigo), archivo + ': queda una regla antigua solo para la nube');
    assert.equal(f.nodes.find(n => n.name === 'Proyecto Supabase').parameters.assignments.assignments.find(a => a.name === 'supabase_url').value, 'https://TU_PROYECTO.supabase.co');
  }
});
