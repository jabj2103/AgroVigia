'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { prevalidarAmbiental, indiceLdr } = require('./validar-ambiental.cjs');
const { prepararIngestaAmbiental, resumirPersistenciaAmbiental } = require('./preparar-ambiental.cjs');
const fecha = '2026-10-27T02:07:43.000Z';
const cfg = { acl_verificada: true, retencion_broker_desactivada: true };
const p = () => ({ version: 2, nodo_codigo: 'agv-dht22-01', mensaje_id: '11111111-1111-4111-8111-111111111111',
  origen: 'simulado', tomada_en: '2026-10-27T02:07:43Z',
  ldr: { metodo: 'adc12_10k_11db_v1', adc_promedio: 625 }, mediciones: [
    { variable_codigo: 'temperatura_aire', valor: 27.5, unidad: '\u00b0C' },
    { variable_codigo: 'humedad_aire', valor: 47.8, unidad: '% HR' },
    { variable_codigo: 'iluminacion_relativa', valor: 15.3, unidad: '% relativo' },
  ] });
const entrada = (payload = p()) => ({ topic: 'agrovigia/v2/simulado/nodos/agv-dht22-01/telemetria',
  message: JSON.stringify(payload), supabase_url: 'https://prueba.supabase.co' });
test('v2 requiere tres variables y formula ADC coherente con trazabilidad', () => {
  assert.equal(prevalidarAmbiental(entrada()).perfil_payload, 'DHT22_LDR');
  const reverso = p(); reverso.mediciones.reverse();
  assert.equal(prevalidarAmbiental(entrada(reverso)).estado, 'prevalidado');
  for (const mutar of [
    x => { x.mediciones.pop(); }, x => { x.mediciones[2].valor = 40; },
    x => { x.mediciones[2].unidad = 'lux'; }, x => { x.mediciones[1].valor = 101; },
    x => { x.mediciones[0].valor = 27.12345; }, x => { x.mediciones[0].valor = '27.5'; },
    x => { x.mediciones[1] = x.mediciones[0]; }, x => { x.version = 1; },
    x => { x.ldr.adc_promedio = 4096; }, x => { x.ldr.adc_promedio = 1.5; },
    x => { x.ldr.metodo = 'otra'; }, x => { x.ldr.extra = true; },
    x => { x.tomada_en = '2026-02-30T12:00:00Z'; },
  ]) { const x = p(); mutar(x); assert.equal(prevalidarAmbiental(entrada(x)).estado, 'rechazar'); }
});
test('toda la escala ADC conserva extremos, no inventa lux ni oculta ceros', () => {
  for (let adc = 0; adc <= 4095; adc++) {
    const x = p(); x.ldr.adc_promedio = adc; x.mediciones[2].valor = indiceLdr(adc);
    assert.equal(prevalidarAmbiental(entrada(x)).estado, 'prevalidado');
  }
  const x = p(); x.ldr.adc_promedio = 4095; x.mediciones[2].valor = 100;
  assert.ok(prevalidarAmbiental(entrada(x)).advertencias.includes('LDR_EN_EXTREMO_ADC'));
});
test('el canal v2 es obligatorio; raw duplicado, BOM y retain se rechazan', () => {
  const e = entrada();
  assert.equal(prevalidarAmbiental({ ...e, topic: e.topic.replace('/v2/', '/v1/') }).codigo, 'TOPICO_NO_COINCIDE');
  for (const message of ['{"version":2,' + e.message.slice(1),
    e.message.replace('"adc_promedio":625', '"adc_promedio":625,"adc_promedio":625'), '\ufeff' + e.message]) {
    assert.equal(prevalidarAmbiental({ ...e, message }).estado, 'rechazar');
  }
  assert.equal(prevalidarAmbiental({ ...e, retained: true }).codigo, 'RETAIN_NO_ADMITIDO');
});
test('preparacion fija mensaje/fecha y solo usa RPC ambiental con canal autorizado', () => {
  const e = entrada(); const r = prepararIngestaAmbiental(e, cfg, fecha);
  assert.equal(r.solicitud_rpc.p_mensaje, e.message);
  assert.equal(r.solicitud_rpc.p_recibida_en, fecha);
  assert.equal(r.solicitud_rpc.p_retenido, null);
  assert.equal(r.persistido, false);
  assert.ok(r.destino_rpc.endsWith('/rpc/registrar_lote_ambiental'));
  assert.equal(prepararIngestaAmbiental(e, {}, fecha).estado, 'rechazado');
  assert.equal(prepararIngestaAmbiental({ ...e, supabase_url: 'https://otro.example' }, cfg, fecha).estado, 'rechazado');
});
test('respuesta confirmada exige tres IDs distintos; dos no acreditan lote ambiental', () => {
  const r = { estado: 'insertado', mensaje_id: p().mensaje_id, recibida_en: fecha,
    medicion_ids: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'] };
  assert.equal(resumirPersistenciaAmbiental(r).persistido, true);
  assert.equal(resumirPersistenciaAmbiental({ ...r, estado: 'duplicado' }).nuevo_lote, false);
  assert.throws(() => resumirPersistenciaAmbiental({ ...r, medicion_ids: r.medicion_ids.slice(0, 2) }));
  assert.equal(resumirPersistenciaAmbiental({ estado: 'rechazado', persistido: true }).persistido, false);
});
test('workflow exportado ejecuta preparacion y resultado sin credenciales ni red', () => {
  const flujo = JSON.parse(fs.readFileSync(path.join(__dirname, '03c-ingesta-ambiental.json'), 'utf8'));
  assert.equal(flujo.active, false);
  assert.ok(flujo.nodes.every(n => !n.credentials));
  assert.ok(flujo.nodes.find(n => n.name === 'MQTT receptor').parameters.topics.includes('/v2/real/'));
  class Fecha extends Date { constructor(v) { super(v ?? fecha); } }
  const code = flujo.nodes.find(n => n.name === 'Preparar ingesta').parameters.jsCode;
  const result = vm.runInNewContext('(function(){' + code + '})()', { Buffer, Date: Fecha, $input: { all: () => [{ json: entrada() }] } });
  assert.equal(result[0].json.solicitud_rpc.p_recibida_en, fecha);
  const resumen = flujo.nodes.find(n => n.name === 'Resultado de persistencia').parameters.jsCode;
  const salida = vm.runInNewContext('(function(){' + resumen + '})()', { $input: { all: () => [{ json: { estado: 'rechazado' } }] } });
  assert.equal(salida[0].json.persistido, false);
});
test('el formato JSON real del sketch emite un lote v2 valido y cabe en el buffer', () => {
  const ino = fs.readFileSync(path.join(__dirname, '../firmware/nodo-dht22-mqtt/nodo-dht22-mqtt.ino'), 'utf8');
  const inicio = ino.indexOf('const int longitud = snprintf');
  const formatoC = ino.slice(inicio, ino.indexOf('NODO_CODIGO, lote.id', inicio));
  const formatoLatin = [...formatoC.matchAll(/"(?:\\.|[^"\\])*"/g)].map(m =>
    JSON.parse(m[0].replace(/\\x([0-9a-f]{2})/gi, '\\u00$1'))).join('');
  const formato = Buffer.from(formatoLatin, 'latin1').toString('utf8');
  const args = ['agv-dht22-01', p().mensaje_id, p().tomada_en, 625, 27.5, 47.8, 15.3];
  let i = 0;
  const message = formato.replace(/%(?:\.1)?[suf%]/g, token => token === '%%' ? '%' :
    token === '%.1f' ? Number(args[i++]).toFixed(1) : String(args[i++]));
  assert.equal(i, args.length);
  assert.ok(Buffer.byteLength(message, 'utf8') < 768);
  const r = prevalidarAmbiental({ topic: 'agrovigia/v2/real/nodos/agv-dht22-01/telemetria', message });
  assert.equal(r.estado, 'prevalidado');
  assert.equal(r.payload.ldr.adc_promedio, 625);
  assert.equal(r.payload.mediciones.length, 3);
  assert.match(ino, /adc\) \* 1000UL \+ 2047UL\) \/ 4095UL/);
});

test('multinodo: export sin credenciales, topico comun y validacion individual de dos nodos',()=>{
 const f=JSON.parse(fs.readFileSync(path.join(__dirname,'03d-ingesta-multinodo.json'),'utf8'));
 assert.equal(f.active,false);assert.ok(f.nodes.every(n=>!n.credentials));
 assert.equal(f.nodes.find(n=>n.name==='MQTT receptor').parameters.topics,'agrovigia/v2/real/nodos/+/telemetria:1');
 const code=f.nodes.find(n=>n.name==='Preparar ingesta').parameters.jsCode;
 class Fecha extends Date{constructor(v){super(v??fecha);}}
 const items=['agv-dht22-01','agv-ambiente-02'].map(n=>{const e=entrada();const payload=JSON.parse(e.message);payload.nodo_codigo=n;payload.origen="real";return {json:{...e,topic:`agrovigia/v2/real/nodos/${n}/telemetria`,message:JSON.stringify(payload)}};});
 const r=vm.runInNewContext('(function(){'+code+'})()',{Buffer,Date:Fecha,$input:{all:()=>items}});
 assert.equal(r.length,2);assert.equal(r[1].json.payload.nodo_codigo,'agv-ambiente-02');assert.ok(r.every(i=>i.json.solicitud_rpc));
 const mal={...items[1].json,topic:items[0].json.topic};assert.equal(prevalidarAmbiental(mal).estado,'rechazar');
});
