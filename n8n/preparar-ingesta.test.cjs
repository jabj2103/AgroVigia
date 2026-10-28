'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { prepararIngesta, resumirPersistencia } = require('./preparar-ingesta.cjs');
const recibida = '2026-10-26T23:45:19.123Z';
const configuracion = { acl_verificada: true, retencion_broker_desactivada: true };
const payload = {
  version: 1, nodo_codigo: 'agv-dht22-01',
  mensaje_id: '11111111-1111-4111-8111-111111111111',
  origen: 'simulado', tomada_en: '2026-10-26T23:45:19Z',
  mediciones: [
    { variable_codigo: 'temperatura_aire', valor: 28.5, unidad: '\u00b0C' },
    { variable_codigo: 'humedad_aire', valor: 72, unidad: '% HR' },
  ],
};
const entrada = () => ({
  topic: 'agrovigia/v1/simulado/nodos/agv-dht22-01/telemetria',
  message: JSON.stringify(payload), supabase_url: 'https://agrovigia-demo.supabase.co',
});
const respuesta = estado => ({
  estado, mensaje_id: payload.mensaje_id, recibida_en: recibida,
  medicion_ids: [
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  ],
});

test('conserva mensaje raw y fecha fijada antes del HTTP, sin afirmar persistencia', () => {
  const e = entrada();
  e.message = JSON.stringify(payload, null, 2);
  const r = prepararIngesta(e, configuracion, recibida);
  assert.equal(r.estado, 'prevalidado');
  assert.equal(r.persistido, false);
  assert.equal(r.solicitud_rpc.p_mensaje, e.message);
  assert.equal(r.solicitud_rpc.p_recibida_en, recibida);
  assert.equal(r.solicitud_rpc.p_retenido, null);
  assert.equal(r.retain_verificado, false);
  assert.equal(r.fuente_recibida_en, 'inicio_validacion_mqtt_aproximado');
});
test('payload no puede declarar configuracion del servidor ni elegir destino HTTP', () => {
  const e = entrada();
  e.message = JSON.stringify({ ...payload, acl_verificada: true, supabase_url: 'https://otro.example' });
  const r = prepararIngesta(e, configuracion, recibida);
  assert.equal(r.estado, 'rechazado');
  assert.equal(r.solicitud_rpc, undefined);
});
test('sin evidencia de canal no prepara solicitud', () => {
  for (const cfg of [{}, { acl_verificada: true }, { retencion_broker_desactivada: true }]) {
    const r = prepararIngesta(entrada(), cfg, recibida);
    assert.equal(r.estado, 'rechazado');
    assert.equal(r.solicitud_rpc, undefined);
  }
});
test('recibida_en exige instante UTC canonico suministrado por el flujo', () => {
  for (const f of [null, 'ayer', '2026-02-30T12:00:00.000Z', '2026-10-26T18:45:19-05:00']) {
    assert.equal(prepararIngesta(entrada(), configuracion, f).codigo, 'FECHA_RECEPCION');
  }
});
test('solo prepara HTTP hacia endpoint HTTPS Supabase permitido', () => {
  for (const url of [
    'https://TU_PROYECTO.supabase.co', 'http://agrovigia-demo.supabase.co',
    'https://otro.example', 'https://agrovigia-demo.supabase.co/otro',
    'https://agrovigia-demo.supabase.co@otro.example', 'https://agrovigia-demo.supabase.co?key=algo',
  ]) {
    const r = prepararIngesta({ ...entrada(), supabase_url: url }, configuracion, recibida);
    assert.equal(r.codigo, 'CONFIGURAR_URL_SUPABASE');
    assert.equal(r.destino_rpc, undefined);
  }
  assert.equal(prepararIngesta({ ...entrada(), supabase_url: entrada().supabase_url + '/' },
    configuracion, recibida).destino_rpc,
    'https://agrovigia-demo.supabase.co/rest/v1/rpc/registrar_lote_dht22');
});
test('rechazo de JSON duplicado mantiene bloqueada la ruta HTTP', () => {
  const e = entrada();
  e.message = '{"version":1,' + e.message.slice(1);
  const r = prepararIngesta(e, configuracion, recibida);
  assert.equal(r.estado, 'rechazado');
  assert.equal(r.solicitud_rpc, undefined);
});
test('LDR no llega a la RPC DHT22', () => {
  const e = entrada();
  e.topic = 'agrovigia/v1/simulado/nodos/agv-ldr-01/telemetria';
  e.message = JSON.stringify({
    ...payload, nodo_codigo: 'agv-ldr-01',
    mediciones: [{ variable_codigo: 'iluminacion_relativa', valor: 40, unidad: '% relativo' }],
  });
  const r = prepararIngesta(e, configuracion, recibida);
  assert.equal(r.codigo, 'PERFIL_NO_ADMITIDO_EN_ESTA_RPC');
  assert.equal(r.solicitud_rpc, undefined);
});
test('captura antigua se envia sin cambiar fecha para resolver duplicado en DB antes de ventana', () => {
  const e = entrada();
  const r = prepararIngesta(e, configuracion, '2026-10-27T00:45:19.123Z');
  assert.equal(r.estado, 'prevalidado');
  assert.equal(JSON.parse(r.solicitud_rpc.p_mensaje).tomada_en, payload.tomada_en);
});
test('solo respuestas RPC confirmadas indican persistido; duplicado no es nuevo lote', () => {
  assert.equal(resumirPersistencia(respuesta('insertado')).nuevo_lote, true);
  const duplicado = resumirPersistencia(respuesta('duplicado'));
  assert.equal(duplicado.persistido, true);
  assert.equal(duplicado.nuevo_lote, false);
  for (const estado of ['rechazado', 'conflicto_id']) {
    const r = resumirPersistencia({ estado, persistido: true });
    assert.equal(r.persistido, false);
    assert.equal(r.nuevo_lote, false);
  }
});
test('respuesta incompleta o desconocida produce error, sin exito aparente', () => {
  for (const r of [null, [], {}, { estado: 'prevalidado' }, { estado: 'insertado' },
    { ...respuesta('insertado'), medicion_ids: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'] },
    { ...respuesta('insertado'), medicion_ids: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'] }]) {
    assert.throws(() => resumirPersistencia(r), /RESPUESTA_RPC/);
  }
});
test('codigo incrustado prepara y resume en sandbox sin requerir modulos ni red', () => {
  const flujo = JSON.parse(fs.readFileSync(path.join(__dirname, '03b-ingesta-dht22.json'), 'utf8'));
  const preparar = flujo.nodes.find(n => n.name === 'Preparar ingesta');
  class FechaFija extends Date { constructor(valor) { super(valor ?? recibida); } }
  const preparado = vm.runInNewContext('(function(){' + preparar.parameters.jsCode + '})()', {
    Buffer, Date: FechaFija, $input: { all: () => [{ json: entrada() }] },
  });
  assert.equal(preparado[0].json.solicitud_rpc.p_recibida_en, recibida);
  assert.equal(preparado[0].json.persistido, false);
  const resumir = flujo.nodes.find(n => n.name === 'Resultado de persistencia');
  const salida = vm.runInNewContext('(function(){' + resumir.parameters.jsCode + '})()', {
    $input: { all: () => [{ json: respuesta('duplicado') }] },
  });
  assert.equal(salida[0].json.persistido, true);
  assert.equal(salida[0].json.nuevo_lote, false);
});
