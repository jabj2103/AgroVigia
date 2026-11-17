// Busqueda de los filtros: sin tildes ni mayusculas, y todas las palabras deben aparecer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coincide } from '../src/filtros-texto.ts';

test('una consulta vacia coincide con todo', () => {
  assert.equal(coincide('agv-esp4c1d-27 Tomate norte', ''), true);
  assert.equal(coincide('', '   '), true);
});
test('no distingue mayusculas ni tildes', () => {
  assert.equal(coincide('Café del Sector Ñandú', 'cafe'), true);
  assert.equal(coincide('cafe', 'CAFÉ'), true);
  assert.equal(coincide('Sin cultivo asignado', 'SÍN'), true);
});
test('exige todas las palabras, en cualquier orden', () => {
  assert.equal(coincide('sim-tomate-03 Tomate cherry Sector norte', 'norte tomate'), true);
  assert.equal(coincide('sim-tomate-03 Tomate cherry Sector norte', 'norte fresa'), false);
});
test('busca fragmentos de un codigo de nodo', () => {
  assert.equal(coincide('agv-esp4c1d-27', '4c1d'), true);
  assert.equal(coincide('agv-esp4c1d-27', '4c1e'), false);
});
