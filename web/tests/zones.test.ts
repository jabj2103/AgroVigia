import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { VARIABLES } from '../../simulador/public/motor.mjs';
import { VARIABLES_ZONA, formarCapturaZona, puntoNodo, ubicacionCoincide, validarPlano } from '../src/zone-domain.ts';
import { cargarCapturaZona, cargarPlano } from '../src/zone-data.ts';
import { captureRows, crop, owner, physical, plano, virtuals } from './zones-fixtures.ts';
import type { MedicionZona } from '../src/zone-domain.ts';
const n = virtuals[0]!;
test('catálogo de las diez variables coincide con unidades y rangos del simulador', () => {
  assert.equal(VARIABLES_ZONA.length, 10);
  for (const v of VARIABLES_ZONA) {
    const m = VARIABLES.find((m: { codigo: string }) => m.codigo === v.codigo)!;
    assert.equal(v.unidad, v.codigo === 'ph_suelo' ? 'sin unidad' : m.unidad); assert.equal(v.min, m.min); assert.equal(v.max, m.max);
  }
});
test('croquis valida geometría, cuenta y posiciones sin inventar ubicación de físicos', () => {
  const p = plano(); assert.equal(validarPlano(p, crop, owner), p);
  const punto = puntoNodo(n, p.zonas)!; assert.equal(punto.x, 0.05 + 0.425 * 0.5); assert.equal(punto.y, punto.x);
  assert.equal(puntoNodo(physical, p.zonas), null);
  for (const alterar of [(x: typeof p) => { x.zonas[0]!.plano_ancho = 1; }, (x: typeof p) => { x.nodos[0]!.agricultor_id = 'otra-cuenta'; },
    (x: typeof p) => { x.nodos[0]!.zona_id = 'otra-zona'; }, (x: typeof p) => { x.nodos[0]!.posicion_x = null; },
    (x: typeof p) => { x.capacidades.push(x.capacidades[0]!); }]) {
    const copia = structuredClone(p); alterar(copia); assert.throws(() => validarPlano(copia, crop, owner));
  }
});
test('captura virtual conserva diez variables, cero, origen, fechas, lluvia y método ECe', () => {
  const rows = captureRows(); rows.find(m => m.variable_codigo === 'ph_suelo')!.valor = 0;
  const c = formarCapturaZona(rows, n, crop, rows[0]!.mensaje_id, false);
  assert.equal(c.valores.length, 10); assert.equal(c.origen, 'simulado'); assert.equal(c.valores.find(v => v.codigo === 'ph_suelo')!.valor, 0);
  assert.equal(c.zonaNombre, 'Sector norte'); assert.equal(ubicacionCoincide(c, n), true);
  assert.equal(ubicacionCoincide(c, { ...n, asignacion_version: physical.asignacion_version }), false);
  assert.equal(ubicacionCoincide(c, { ...n, posicion_x: 0.9 }), false);
});
test('rechaza lotes parciales, mixtos, unidades inventadas, identidades y metadatos incoherentes', () => {
  for (const alterar of [(r: MedicionZona[]) => { r.pop(); }, (r: MedicionZona[]) => { r[1]!.origen = 'real'; },
    (r: MedicionZona[]) => { r[1]!.mensaje_id = physical.id; }, (r: MedicionZona[]) => { r[1]!.zona_id = null; },
    (r: MedicionZona[]) => { r[1]!.metadatos!.unidad = 'lux'; }, (r: MedicionZona[]) => { r[1]!.valor = Infinity; },
    (r: MedicionZona[]) => { r[1]!.id = r[0]!.id; }, (r: MedicionZona[]) => { r[1]!.tomada_en = new Date(0).toISOString(); },
    (r: MedicionZona[]) => { (r.find(m => m.variable_codigo === 'precipitacion_60min')!.metadatos!.detalle as Record<string, unknown>).periodo_segundos = 60; },
    (r: MedicionZona[]) => { (r.find(m => m.variable_codigo === 'conductividad_suelo_ece')!.metadatos!.detalle as Record<string, unknown>).metodo = 'sensor_crudo'; },
  ]) { const r = captureRows(); alterar(r); assert.throws(() => formarCapturaZona(r, n, crop, r[0]!.mensaje_id, false)); }
});
function cliente(respuesta: (url: URL) => unknown) {
  const urls: URL[] = [], client = createClient('https://fixture-no-remoto.supabase.co', 'sb_publishable_ficticia', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async input => {
    const u = new URL(String(input)); urls.push(u); return new Response(JSON.stringify(respuesta(u)), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } } });
  return { client, urls };
}
test('consulta croquis acota cuenta/cultivo y capacidades de esos nodos', async () => {
  const p = plano(), { client, urls } = cliente(u => u.pathname.endsWith('/zonas') ? p.zonas : u.pathname.endsWith('/nodos') ? p.nodos : p.capacidades);
  assert.equal((await cargarPlano(client, crop, owner, new AbortController().signal)).nodos.length, 5);
  const nodes = urls.find(u => u.pathname.endsWith('/nodos'))!; assert.equal(nodes.searchParams.get('agricultor_id'), 'eq.' + owner); assert.equal(nodes.searchParams.get('cultivo_id'), 'eq.' + crop);
  assert.equal(urls.find(u => u.pathname.endsWith('/zonas'))!.searchParams.get('cultivo_id'), 'eq.' + crop);
});
test('consulta virtual acota origen, nodo, cultivo y mismo mensaje; no usa otro lote si falta la última captura', async () => {
  const rows = captureRows(), p = plano();
  const { client, urls } = cliente(u => u.searchParams.get('select') === 'mensaje_id' ? { mensaje_id: rows[0]!.mensaje_id } : rows);
  assert.equal((await cargarCapturaZona(client, crop, n, p.capacidades, new AbortController().signal))!.valores.length, 10);
  assert.equal(urls.length, 2);
  for (const u of urls) { assert.equal(u.searchParams.get('origen'), 'eq.simulado'); assert.equal(u.searchParams.get('nodo_id'), 'eq.' + n.id); assert.equal(u.searchParams.get('cultivo_id'), 'eq.' + crop); }
  assert.equal(urls[1]!.searchParams.get('mensaje_id'), 'eq.' + rows[0]!.mensaje_id);
  const vacio = cliente(() => null); assert.equal(await cargarCapturaZona(vacio.client, crop, n, p.capacidades, new AbortController().signal), null); assert.equal(vacio.urls.length, 1);
});
test('perfil físico sigue consultando exclusivamente origen real y conserva historial sin zona', async () => {
  const rows: MedicionZona[] = captureRows().slice(0, 2).map((m, i) => ({ ...m, nodo_id: physical.id, variable_codigo: i === 0 ? 'temperatura_aire' : 'humedad_aire', valor: i === 0 ? 28 : 60, origen: 'real', metadatos: {}, zona_id: null, zona_contexto: {} }));
  const { client, urls } = cliente(u => u.searchParams.get('select') === 'mensaje_id' ? { mensaje_id: rows[0]!.mensaje_id } : rows);
  const c = await cargarCapturaZona(client, crop, physical, plano().capacidades, new AbortController().signal);
  assert.equal(c!.origen, 'real'); assert.equal(c!.valores.length, 2); assert.equal(c!.zonaId, null); assert.ok(urls.every(u => u.searchParams.get('origen') === 'eq.real'));
});
