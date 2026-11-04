import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { prepararIngestaSimulada, resumirPersistenciaSimulada } from './preparar-simulada.mjs';
import { prepararCapturaV3 } from '../simulador/contrato-v3.mjs';
import { captura, filas } from '../simulador/tests/fixtures.mjs';
const cfg = { acl_verificada: true, retencion_broker_desactivada: true };
function entrada() {
  const f = filas()[0], { topico, mensaje } = prepararCapturaV3(captura(), { nodo_local: f.nodo_local, nodo_codigo: f.nodo_codigo, asignacion_version: f.asignacion_version });
  return { topic: topico, message: mensaje, supabase_url: 'https://prueba.supabase.co' };
}
const preparar = e => prepararIngestaSimulada(e, cfg, new Date().toISOString());
function resultado(p) {
  return { estado: 'insertado', origen: 'simulado', mensaje_id: p.mensaje_id, tomada_en: p.tomada_en,
    recibida_en: p.recibida_en, cultivo_id: randomUUID(), zona_id: randomUUID(), medicion_ids: Array.from({ length: 10 }, () => randomUUID()) };
}
test('v3 prepara RPC exclusiva y conserva mensaje original, origen y recepción', () => {
  const e = entrada(), p = preparar(e); assert.equal(p.estado, 'prevalidado');
  assert.equal(p.solicitud_rpc.p_mensaje, e.message); assert.equal(p.solicitud_rpc.p_recibida_en, p.recibida_en);
  assert.equal(p.solicitud_rpc.p_retenido, null); assert.equal(p.persistido, false);
  assert.match(p.destino_rpc, /registrar_lote_simulado_v3$/);
});
test('v3 rechaza campos/claves repetidos, origen, retain, tamaño, canal y destino', () => {
  const e = entrada();
  for (const bad of [
    { ...e, topic: e.topic.replace('/simulado/', '/real/') }, { ...e, retained: true }, { ...e, retain: true },
    { ...e, message: '\ufeff' + e.message }, { ...e, message: e.message.replace('"version":3', '"version":3,"version":3') },
    { ...e, message: e.message.replace('"origen":"simulado"', '"origen":"real"') },
    { ...e, message: ' '.repeat(8193) }, { ...e, message: JSON.parse(e.message) },
    { ...e, supabase_url: 'https://otra.invalid' },
  ]) assert.equal(preparar(bad).estado, 'rechazado');
  assert.equal(prepararIngestaSimulada(e, {}, new Date().toISOString()).codigo, 'CANAL_LOCAL_NO_VERIFICADO');
});
test('v3 confirma diez IDs y correspondencia, devuelve pendiente ante error HTTP o respuesta parcial', () => {
  const p = preparar(entrada()), r = resultado(p);
  assert.equal(resumirPersistenciaSimulada(r, p).persistido, true);
  assert.equal(resumirPersistenciaSimulada({ ...r, estado: 'duplicado' }, p).nuevo_lote, false);
  for (const bad of [{ error: 'HTTP 500' }, { ...r, medicion_ids: r.medicion_ids.slice(1) },
    { ...r, mensaje_id: randomUUID() }, { ...r, origen: 'real' },
    { ...r, medicion_ids: Array(10).fill(r.medicion_ids[0]) }, { ...r, tomada_en: new Date(0).toISOString() }]) {
    assert.equal(resumirPersistenciaSimulada(bad, p).persistido, null);
  }
  assert.equal(resumirPersistenciaSimulada({ estado: 'rechazado', codigo: 'ASIGNACION_CAMBIO' }, p).persistido, false);
});
test('03f exportado usa tópico independiente, sin credenciales y ejecuta el Code real del flujo', async () => {
  const f = JSON.parse(await readFile(new URL('03f-ingesta-simulada-v3.json', import.meta.url), 'utf8'));
  assert.equal(f.active, false); assert.deepEqual(f.pinData, {}); assert.ok(f.nodes.every(n => !n.credentials));
  assert.equal(f.nodes.find(n => n.name === 'MQTT receptor').parameters.topics, 'agrovigia/v3/simulado/nodos/+/telemetria:1');
  const e = entrada(), node = name => f.nodes.find(n => n.name === name);
  assert.ok(node('Preparar ingesta').parameters.jsCode.includes(prepararIngestaSimulada.toString()), 'Regenerar 03f tras modificar la preparación.');
  assert.ok(node('Resultado de persistencia').parameters.jsCode.includes(resumirPersistenciaSimulada.toString()), 'Regenerar 03f tras modificar el resumen.');
  const p = vm.runInNewContext('(function(){' + node('Preparar ingesta').parameters.jsCode + '})()', {
    $input: { all: () => [{ json: e }] }, Buffer,
  })[0].json;
  assert.equal(p.estado, 'prevalidado'); assert.equal(p.solicitud_rpc.p_mensaje, e.message);
  const r = vm.runInNewContext('(function(){' + node('Resultado de persistencia').parameters.jsCode + '})()', {
    $input: { all: () => [{ json: resultado(p) }] }, $: () => ({ itemMatching: () => ({ json: p }) }), Buffer,
  })[0].json;
  assert.equal(r.persistido, true); assert.equal(r.medicion_ids.length, 10);
});
