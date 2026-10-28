import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { validarEntornoPublico } from '../src/config.ts';
import { antiguedad, esDht22, esAmbiental, estadoDatos, formarLote } from '../src/domain.ts';
import { cargarContexto, cargarUltimoLote } from '../src/data.ts';
import type { Medicion } from '../src/types.ts';

// Fixtures inventados. No se publican ni se escriben en una base de datos.
const nodoId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const cultivoId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const mensajeId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const tomada = '2026-10-26T12:00:00Z';
const recibida = '2026-10-26T12:00:01Z';
const filas = (): Medicion[] => [
  { id: '1', cultivo_id: cultivoId, nodo_id: nodoId, mensaje_id: mensajeId,
    variable_codigo: 'temperatura_aire', valor: 24, tomada_en: tomada, recibida_en: recibida, origen: 'real' },
  { id: '2', cultivo_id: cultivoId, nodo_id: nodoId, mensaje_id: mensajeId,
    variable_codigo: 'humedad_aire', valor: 65, tomada_en: tomada, recibida_en: recibida, origen: 'real' },
];

test('la web acepta Publishable key y bloquea claves de servidor sin imprimirlas', () => {
  const base = { VITE_SUPABASE_URL: 'https://proyecto-prueba.supabase.co' };
  assert.equal(validarEntornoPublico({ ...base, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_ficticia' }).lista, true);
  assert.throws(() => validarEntornoPublico({ ...base, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_no_es_real' }), /clave privada/);
  assert.throws(() => validarEntornoPublico({ ...base, VITE_SUPABASE_SERVICE_ROLE_KEY: 'no_es_real' }), /clave privada/);
  assert.throws(() => validarEntornoPublico({ ...base, VITE_GEMINI_KEY: 'no_es_real' }), /clave privada/);
  assert.throws(() => validarEntornoPublico({ ...base, VITE_SUPABASE_PUBLISHABLE_KEY: 'eyJlegacy' }), /Publishable key/);
  assert.equal(validarEntornoPublico({}).lista, false);
});
test('la URL debe apuntar al proyecto HTTPS sin ruta', () => {
  for (const url of ['http://proyecto.supabase.co', 'https://otro.example',
    'https://proyecto.supabase.co/rest/v1', 'https://proyecto.supabase.co@otro.example']) {
    assert.throws(() => validarEntornoPublico({
      VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_ficticia',
    }), /URL HTTPS/);
  }
});
test('no combina capacidades de nodos distintos ni asigna iluminacion al DHT22', () => {
  const caps = [
    { nodo_id: nodoId, variable_codigo: 'temperatura_aire', sensor_modelo: 'DHT22' },
    { nodo_id: 'otro', variable_codigo: 'humedad_aire', sensor_modelo: 'DHT22' },
  ];
  assert.equal(esDht22(nodoId, caps), false);
  const completas = [...caps, { nodo_id: nodoId, variable_codigo: 'humedad_aire', sensor_modelo: 'DHT22' }];
  assert.equal(esDht22(nodoId, completas), true);
  assert.equal(esDht22(nodoId, [...completas, {
    nodo_id: nodoId, variable_codigo: 'iluminacion_relativa', sensor_modelo: 'LDR',
  }]), false);
});
test('solo forma un lote completo y coherente del mismo nodo/cultivo/origen/mensaje', () => {
  assert.equal(formarLote(filas().reverse(), nodoId, cultivoId, mensajeId).temperatura, 24);
  assert.throws(() => formarLote(filas().slice(0, 1), nodoId, cultivoId, mensajeId), /dos variables/);
  for (const cambio of [
    { origen: 'simulado' }, { nodo_id: 'otro' }, { cultivo_id: 'otro' },
    { mensaje_id: 'otro' }, { tomada_en: 'ayer' }, { valor: Infinity },
    { recibida_en: '2026-10-26T12:01:00Z' },
  ]) {
    const datos = filas(); datos[1] = { ...datos[1]!, ...cambio };
    assert.throws(() => formarLote(datos, nodoId, cultivoId, mensajeId));
  }
  const repetidas = [filas()[0]!, filas()[0]!];
  assert.throws(() => formarLote(repetidas, nodoId, cultivoId, mensajeId), /dos variables/);
});
test('cero no se transforma en ausencia y valores fuera de rango se rechazan', () => {
  const ceros = filas().map(f => ({ ...f, valor: 0 }));
  const lote = formarLote(ceros, nodoId, cultivoId, mensajeId);
  assert.equal(lote.temperatura, 0); assert.equal(lote.humedad, 0);
  const datos = filas(); datos[1]!.valor = 101;
  assert.throws(() => formarLote(datos, nodoId, cultivoId, mensajeId), /rangos/);
});
test('antiguedad y falta de datos no se presentan como salud o desconexion', () => {
  const lote = formarLote(filas(), nodoId, cultivoId, mensajeId);
  assert.equal(estadoDatos(null, Date.now()).texto, 'Sin datos reales');
  assert.equal(estadoDatos(lote, Date.parse(tomada) + 180_000).clase, 'reciente');
  assert.equal(estadoDatos(lote, Date.parse(tomada) + 180_001).clase, 'antiguo');
  assert.equal(estadoDatos(lote, Date.parse(tomada) - 1000).clase, 'revisar');
  assert.equal(antiguedad(tomada, Date.parse(tomada) - 1000), 'Posterior al reloj local');
});

function clienteSimulado(responder: (url: URL) => unknown) {
  const urls: URL[] = [];
  const client = createClient('https://prueba.supabase.co', 'sb_publishable_ficticia', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      urls.push(url);
      return new Response(JSON.stringify(responder(url)), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  return { client, urls };
}
test('consulta real: filtra ambas peticiones por cultivo, nodo y origen; el lote por UUID', async () => {
  const { client, urls } = clienteSimulado(url => url.searchParams.get('select') === 'mensaje_id'
    ? { mensaje_id: mensajeId } : filas());
  const lote = await cargarUltimoLote(client, cultivoId, nodoId);
  assert.equal(lote?.mensajeId, mensajeId); assert.equal(urls.length, 2);
  for (const url of urls) {
    assert.equal(url.searchParams.get('origen'), 'eq.real');
    assert.equal(url.searchParams.get('nodo_id'), 'eq.' + nodoId);
    assert.equal(url.searchParams.get('cultivo_id'), 'eq.' + cultivoId);
  }
  assert.ok(urls[0]!.searchParams.get('order')!.startsWith('tomada_en.desc'));
  assert.equal(urls[1]!.searchParams.get('mensaje_id'), 'eq.' + mensajeId);
});
test('si no hay lecturas reales no intenta inventar un lote ni usa simulados', async () => {
  const { client, urls } = clienteSimulado(() => null);
  assert.equal(await cargarUltimoLote(client, cultivoId, nodoId), null);
  assert.equal(urls.length, 1);
});
test('una cuenta sin cultivos obtiene contexto vacio, sin reutilizar datos de otra', async () => {
  const { client, urls } = clienteSimulado(url => url.pathname.endsWith('/perfiles') ? null : []);
  const contexto = await cargarContexto(client, 'usuario-sin-cultivos');
  assert.deepEqual(contexto.cultivos, []); assert.deepEqual(contexto.nodos, []);
  assert.deepEqual(contexto.capacidades, []); assert.equal(contexto.nombre, null);
  assert.equal(urls.length, 3);
});

function filasAmbientales(): Medicion[] {
  const meta = { version_payload: 2, ldr: { metodo: 'adc12_10k_11db_v1', adc_promedio: 625 } };
  return [...filas(), { ...filas()[0]!, id: '3', variable_codigo: 'iluminacion_relativa', valor: 15.3 }]
    .map(f => ({ ...f, metadatos: structuredClone(meta) }));
}
test('reconoce dos nodos ambientales sin combinar sus capacidades', () => {
  const caps = [
    { nodo_id: nodoId, variable_codigo: 'temperatura_aire', sensor_modelo: 'DHT22' },
    { nodo_id: nodoId, variable_codigo: 'humedad_aire', sensor_modelo: 'DHT22' },
    { nodo_id: nodoId, variable_codigo: 'iluminacion_relativa', sensor_modelo: 'LDR' },
  ];
  assert.equal(esAmbiental(nodoId, caps), true);
  assert.equal(esAmbiental('otro', caps), false);
  assert.equal(esAmbiental(nodoId, caps.slice(0, 2)), false);
  assert.equal(esAmbiental(nodoId, caps.map(c => ({ ...c, sensor_modelo: 'LDR' }))), false);
});
test('lote ambiental exige tres filas coherentes y ADC/metodo identicos; conserva historia DHT22', () => {
  const datos = filasAmbientales();
  const lote = formarLote(datos, nodoId, cultivoId, mensajeId, true);
  assert.equal(lote.iluminacion, 15.3); assert.equal(lote.adcLdr, 625);
  assert.equal(formarLote(filas(), nodoId, cultivoId, mensajeId, true).iluminacion, undefined);
  assert.throws(() => formarLote(datos, nodoId, cultivoId, mensajeId));
  assert.throws(() => formarLote(datos.slice(0, 2), nodoId, cultivoId, mensajeId, true), /incompleto/);
  for (const cambio of [
    { valor: 30 }, { nodo_id: 'otro' }, { tomada_en: '2026-10-26T12:00:05Z' },
    { metadatos: { version_payload: 2, ldr: { metodo: 'lux', adc_promedio: 625 } } },
    { metadatos: { version_payload: 2, ldr: { metodo: 'adc12_10k_11db_v1', adc_promedio: 626 } } },
  ]) {
    const copia = filasAmbientales(); copia[2] = { ...copia[2]!, ...cambio };
    assert.throws(() => formarLote(copia, nodoId, cultivoId, mensajeId, true));
  }
});
test('consulta ambiental conserva filtros y pide metadatos solo para perfil ampliado', async () => {
  const { client, urls } = clienteSimulado(url => url.searchParams.get('select') === 'mensaje_id'
    ? { mensaje_id: mensajeId } : filasAmbientales());
  assert.equal((await cargarUltimoLote(client, cultivoId, nodoId, true))?.adcLdr, 625);
  assert.ok(urls[1]!.searchParams.get('select')!.includes('metadatos'));
  for (const url of urls) {
    assert.equal(url.searchParams.get('origen'), 'eq.real');
    assert.equal(url.searchParams.get('nodo_id'), 'eq.' + nodoId);
    assert.equal(url.searchParams.get('cultivo_id'), 'eq.' + cultivoId);
  }
});