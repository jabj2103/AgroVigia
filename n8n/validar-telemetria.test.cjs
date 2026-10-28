'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prevalidarTelemetria, evaluarContexto } = require('./validar-telemetria.cjs');
const base = path.join(__dirname, '../docs/mqtt');
const leer = name => fs.readFileSync(path.join(base, 'ejemplos', name), 'utf8');
const casos = JSON.parse(fs.readFileSync(path.join(base, 'casos.json')));

for (const c of casos) {
  test(`contrato: ${c.id}`, () => {
    const ctx = c.contexto;
    const pre = prevalidarTelemetria({ topic: c.topico, message: leer(c.archivo), recibida_en: ctx.recibida_en, retained: ctx.retained });
    const nodoCodigo = c.topico.split('/')[4];
    const resultado = evaluarContexto(pre, {
      acl_verificada: ctx.acl_verificada,
      nodo: ctx.nodo_conocido ? {
        codigo: nodoCodigo, perfil: nodoCodigo === 'agv-ldr-01' ? 'LDR' : 'DHT22',
        habilitado: ctx.habilitado, cultivo_id: ctx.cultivo_misma_cuenta ? 'cultivo-ficticio' : null,
        agricultor_id: 'cuenta-ficticia', cultivo_agricultor_id: 'cuenta-ficticia',
      } : null,
      conversion_ldr_real_aprobada: ctx.conversion_ldr_real_aprobada,
      lote_previo: ctx.lote_previo ? JSON.parse(leer(ctx.lote_previo)) : null,
    });
    assert.equal(resultado.estado, c.resultado, `${c.motivo}: ${JSON.stringify(resultado)}`);
  });
}

const topic = 'agrovigia/v1/simulado/nodos/agv-dht22-01/telemetria';
const raw = leer('dht22-simulado.json');
const payload = JSON.parse(raw);
const entrada = (message = raw) => ({ topic, message, recibida_en: '2026-10-25T14:00:05Z', retained: false });
const contexto = () => ({ acl_verificada: true, nodo: {
  codigo: 'agv-dht22-01', perfil: 'DHT22', habilitado: true,
  cultivo_id: 'cultivo-ficticio', agricultor_id: 'cuenta-ficticia', cultivo_agricultor_id: 'cuenta-ficticia',
} });

test('rechaza clave repetida con escape equivalente', () => {
  assert.equal(prevalidarTelemetria(entrada(raw.replace('"version": 1', '"version": 1, "ver\\u0073ion": 1'))).codigo, 'CLAVE_REPETIDA');
});
test('rechaza mas de 2048 bytes aunque el JSON sea valido', () => {
  assert.equal(prevalidarTelemetria(entrada(raw + ' '.repeat(2048))).codigo, 'CODIFICACION_O_TAMANO');
});
test('rechaza BOM', () => assert.equal(prevalidarTelemetria(entrada('\ufeff' + raw)).codigo, 'CODIFICACION_O_TAMANO'));
test('rechaza payload convertido a objeto antes de validar', () => assert.equal(prevalidarTelemetria(entrada(payload)).estado, 'rechazar'));
test('tipos incorrectos de variable se rechazan sin abortar el flujo', () => {
  for (const value of [null, 5, true, [], { toString: 'invalido' }]) {
    const p = structuredClone(payload); p.mediciones[0].variable_codigo = value;
    assert.equal(prevalidarTelemetria(entrada(JSON.stringify(p))).codigo, 'CAMPOS_MEDICION');
  }
});
test('rechaza decimales fuera del contrato incluso con underflow', () => {
  for (const n of ['28.50001', '1e-999', '1e400']) {
    assert.equal(prevalidarTelemetria(entrada(raw.replace('28.5', n))).estado, 'rechazar');
  }
});
test('no confunde cero/cero con ausencia de lectura', () => {
  const p = structuredClone(payload); p.mediciones.forEach(m => m.valor = 0);
  const pre = prevalidarTelemetria(entrada(JSON.stringify(p)));
  assert.equal(pre.estado, 'prevalidado');
  assert.ok(pre.advertencias.includes('PAR_CERO_REQUIERE_REVISION'));
  assert.equal(evaluarContexto(pre, contexto()).estado, 'aceptar');
});
test('no declara origen verificado sin evidencia de ACL', () => assert.equal(evaluarContexto(prevalidarTelemetria(entrada()), {}).codigo, 'ORIGEN_NO_VERIFICADO'));
test('metadata retain ausente no se convierte silenciosamente en false', () => {
  const e = entrada(); delete e.retained;
  const pre = prevalidarTelemetria(e);
  assert.equal(pre.retain_verificado, false);
  assert.equal(evaluarContexto(pre, contexto()).codigo, 'RETAIN_NO_VERIFICADO');
});
test('no admite cultivo de otra cuenta', () => {
  const c = contexto(); c.nodo.cultivo_agricultor_id = 'otra-cuenta';
  assert.equal(evaluarContexto(prevalidarTelemetria(entrada()), c).codigo, 'CULTIVO_NO_AUTORIZADO');
});
test('recepcion exige UTC real del servidor; admite milisegundos', () => {
  for (const recibida_en of ['2026-02-30T14:00:05Z', '2026-10-25', null]) {
    assert.equal(evaluarContexto(prevalidarTelemetria({ ...entrada(), recibida_en }), contexto()).codigo, 'FECHA_RECEPCION');
  }
  assert.equal(evaluarContexto(prevalidarTelemetria({ ...entrada(), recibida_en: '2026-10-25T14:00:05.123Z' }), contexto()).estado, 'aceptar');
});
test('duplicado identico ignora orden, espacios, vinculo nuevo y antiguedad', () => {
  const c = contexto(); c.lote_previo = structuredClone(payload); c.nodo.cultivo_id = null;
  const p = structuredClone(payload); p.mediciones.reverse();
  const e = entrada(JSON.stringify(p)); e.recibida_en = '2026-10-26T14:00:05Z';
  assert.equal(evaluarContexto(prevalidarTelemetria(e), c).estado, 'duplicado');
});
test('lote previo parcial no se completa silenciosamente', () => {
  const c = contexto(); c.lote_previo = structuredClone(payload); c.lote_previo.mediciones.pop();
  assert.equal(evaluarContexto(prevalidarTelemetria(entrada()), c).estado, 'conflicto_id');
});
test('lote previo inconsistente no rompe el comparador', () => {
  const c = contexto(); c.lote_previo = structuredClone(payload); c.lote_previo.mediciones = [null];
  assert.equal(evaluarContexto(prevalidarTelemetria(entrada()), c).codigo, 'LOTE_PREVIO_INCONSISTENTE');
});
test('revocacion del nodo bloquea incluso duplicados', () => {
  const c = contexto(); c.lote_previo = payload; c.nodo.habilitado = false;
  assert.equal(evaluarContexto(prevalidarTelemetria(entrada()), c).codigo, 'NODO_DESHABILITADO');
});
test('no acepta UUID con salto de linea final', () => {
  const p = structuredClone(payload); p.mensaje_id += '\n';
  assert.equal(prevalidarTelemetria(entrada(JSON.stringify(p))).codigo, 'MENSAJE_ID');
});
test('las nueve evidencias fisicas se comprueban con advertencias, sin reproducirlas', () => {
  const record = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/pruebas/2026-10-25-dht22-mqtt.json')));
  let cuestionadas = 0;
  for (const m of record.mensajes) {
    const pre = prevalidarTelemetria({ topic: m.topico, message: JSON.stringify(m.payload) });
    assert.equal(pre.estado, 'prevalidado');
    if (pre.advertencias.includes('PAR_CERO_REQUIERE_REVISION')) cuestionadas++;
    assert.equal(pre.recibida_en, null); // No inventar la fecha que falta en esa evidencia.
  }
  assert.equal(cuestionadas, 2);
});

test('flujo generado usa exactamente el validador probado y conserva rechazo por item', () => {
  const w = JSON.parse(fs.readFileSync(path.join(__dirname, '03a-inspeccion-mqtt.json')));
  const code = w.nodes.find(n => n.name === 'Prevalidar contrato').parameters.jsCode;
  const local = fs.readFileSync(path.join(__dirname, 'validar-telemetria.cjs'), 'utf8').split('// EXPORTACIONES_LOCALES:')[0];
  assert.ok(code.startsWith(local));
  const ejecutar = new Function('$input', 'Buffer', code);
  const output = ejecutar({ all: () => [{ json: { topic, message: raw } }, { json: { topic, message: '{}' } }] }, Buffer);
  assert.equal(output[0].json.estado, 'prevalidado');
  assert.equal(output[0].json.persistido, false);
  assert.equal(output[0].json.recibida_en, null);
  assert.equal(output[1].json.estado, 'rechazar');
  assert.equal(w.active, false);
  assert.equal(w.nodes[0].parameters.topics, 'agrovigia/v1/+/nodos/+/telemetria:1');
  assert.ok(w.nodes.every(n => !n.credentials));
});
test('ejemplo manual incrustado produce solo datos simulados prevalidables', () => {
  const w = JSON.parse(fs.readFileSync(path.join(__dirname, '03a-inspeccion-mqtt.json')));
  const generar = new Function(w.nodes.find(n => n.name === 'Crear ejemplo simulado').parameters.jsCode);
  const e = generar()[0].json;
  assert.equal(prevalidarTelemetria(e).estado, 'prevalidado');
  assert.equal(JSON.parse(e.message).origen, 'simulado');
});
