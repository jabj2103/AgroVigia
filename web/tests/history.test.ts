import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import type { Medicion } from '../src/types.ts';
import { cargarHistorial } from '../src/history-data.ts';
import { desdeFechaBogota, fechaLocalBogota, puntosHistorial, resumirHistorial, validarFilaHistorial, validarFiltroHistorial } from '../src/history-domain.ts';
import type { FiltroHistorial } from '../src/history-domain.ts';
const node = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', crop = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const filtro = (): FiltroHistorial => ({ cultivoId: crop, nodoId: node, variable: 'temperatura_aire',
  inicio: '2026-10-26T20:00:00.000Z', fin: '2026-10-26T21:00:00.000Z', recibidasHasta: '2026-10-26T21:00:01.000Z' });
const id = (n: number) => '00000000-0000-4000-8000-' + n.toString(16).padStart(12, '0');
const fila = (n: number, cambios: Partial<Medicion> = {}): Medicion => ({ id: id(n), mensaje_id: id(n + 10000),
  nodo_id: node, cultivo_id: crop, variable_codigo: 'temperatura_aire', valor: 27,
  tomada_en: '2026-10-26T20:30:00Z', recibida_en: '2026-10-26T20:30:01Z', origen: 'real', ...cambios });
function simular(responder: (url: URL, numero: number) => unknown) {
  const urls: URL[] = [];
  const client = createClient('https://prueba.supabase.co', 'sb_publishable_ficticia', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async input => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      urls.push(url); const r = responder(url, urls.length);
      return r instanceof Response ? r : new Response(JSON.stringify(r), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  return { client, urls };
}
test('historial: fechas Bogota, calendario y limite de siete dias', () => {
  assert.equal(desdeFechaBogota('2026-10-26T15:30'), '2026-10-26T20:30:00.000Z');
  assert.equal(fechaLocalBogota('2026-10-27T02:07:43Z'), '2026-10-26T21:07');
  assert.throws(() => desdeFechaBogota('2026-02-30T10:00'));
  assert.throws(() => desdeFechaBogota('2026-10-26'));
  validarFiltroHistorial(filtro());
  for (const cambio of [ { inicio: '2026-10-18T20:00:00.000Z' }, { fin: filtro().inicio },
    { fin: '2026-10-27T20:00:00.000Z' }, { nodoId: 'invalido' } ]) {
    assert.throws(() => validarFiltroHistorial({ ...filtro(), ...cambio }));
  }
});
test('historial: cuenta ceros y promedio de muestras, ausencia no es cero', () => {
  assert.deepEqual(resumirHistorial([]), { cantidad: 0, minimo: null, maximo: null, promedio: null });
  assert.deepEqual(resumirHistorial([fila(1, { valor: -10 }), fila(2, { valor: 0 }), fila(3, { valor: 25 })]),
    { cantidad: 3, minimo: -10, maximo: 25, promedio: 5 });
});
test('historial: cada lectura debe ser real y pertenecer a filtro y rango', () => {
  validarFilaHistorial(fila(1, { valor: 0 }), filtro());
  for (const cambio of [ { nodo_id: crop }, { cultivo_id: node }, { origen: 'simulado' },
    { variable_codigo: 'humedad_aire' }, { valor: NaN }, { valor: 81 },
    { tomada_en: '2026-10-26T19:59:59Z' }, { recibida_en: '2026-10-26T21:01:00Z' } ]) {
    assert.throws(() => validarFilaHistorial(fila(1, cambio), filtro()));
  }
});
test('historial: LDR conserva extremos y solo compara metodo ADC conocido', () => {
  const f = { ...filtro(), variable: 'iluminacion_relativa' as const };
  const dato = fila(1, { variable_codigo: 'iluminacion_relativa', valor: 100,
    metadatos: { version_payload: 2, ldr: { metodo: 'adc12_10k_11db_v1', adc_promedio: 4095 } } });
  validarFilaHistorial(dato, f);
  assert.throws(() => validarFilaHistorial({ ...dato, valor: 99 }, f));
  assert.throws(() => validarFilaHistorial({ ...dato, metadatos: {} }, f));
});
test('historial: los huecos mayores de tres minutos interrumpen la grafica', () => {
  const filas = [fila(1, { valor: 0 }), fila(2, { tomada_en: '2026-10-26T20:33:00Z' }), fila(3, { tomada_en: '2026-10-26T20:36:01Z' })];
  const puntos = puntosHistorial(filas);
  assert.equal(puntos.length, 4); assert.equal(puntos[0]!.y, 0);
  assert.equal(puntos[2]!.y, null); assert.equal(puntos[3]!.y, 27);
});
test('historial: pagina corta no trunca; cursor por captura/UUID y filtros en TODAS las paginas', async () => {
  const { client, urls } = simular((_u, n) => n === 1 ? [fila(1), fila(2)] : n === 2 ? [fila(3)] : []);
  const filas = await cargarHistorial(client, filtro());
  assert.equal(filas.length, 3); assert.equal(urls.length, 3);
  for (const u of urls) {
    assert.equal(u.searchParams.get('cultivo_id'), 'eq.' + crop);
    assert.equal(u.searchParams.get('nodo_id'), 'eq.' + node);
    assert.equal(u.searchParams.get('variable_codigo'), 'eq.temperatura_aire');
    assert.equal(u.searchParams.get('origen'), 'eq.real');
    assert.deepEqual(u.searchParams.getAll('tomada_en'), ['gte.' + filtro().inicio, 'lte.' + filtro().fin]);
    assert.equal(u.searchParams.get('recibida_en'), 'lte.' + filtro().recibidasHasta);
    assert.equal(u.searchParams.get('order'), 'tomada_en.asc,id.asc');
    assert.equal(u.searchParams.get('offset'), null);
  }
  assert.ok(urls[1]!.searchParams.get('or')!.includes('id.gt.' + id(2)));
  assert.ok(urls[2]!.searchParams.get('or')!.includes('id.gt.' + id(3)));
});
test('historial: mas de mil filas se recuperan sin perder muestras', async () => {
  const todas = Array.from({ length: 1101 }, (_, i) => fila(i + 1));
  const { client, urls } = simular((_u, n) => todas.slice((n - 1) * 500, n * 500));
  assert.equal((await cargarHistorial(client, filtro())).length, 1101);
  assert.equal(urls.length, 4);
});
test('historial: pagina fallida o repetida aborta el resultado completo', async () => {
  const repetidas = simular(() => [fila(1)]);
  await assert.rejects(cargarHistorial(repetidas.client, filtro()), /repetidas|orden/);
  const error = simular((_u, n) => n === 1 ? [fila(1)] : new Response(JSON.stringify({ message: 'Fallo de prueba' }), { status: 400 }));
  await assert.rejects(cargarHistorial(error.client, filtro()), /completar el historial/);
  const contaminado = simular(() => [fila(1, { origen: 'simulado' })]);
  await assert.rejects(cargarHistorial(contaminado.client, filtro()), /origen/);
});
test('historial: sin datos devuelve vacio y cancelado no consulta', async () => {
  const { client, urls } = simular(() => []);
  assert.deepEqual(await cargarHistorial(client, filtro()), []);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(cargarHistorial(client, filtro(), abort.signal), { name: 'AbortError' });
  assert.equal(urls.length, 1);
});