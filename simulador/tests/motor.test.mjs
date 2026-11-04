import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { VARIABLES, ESCENARIOS, crearZonas, prepararEscenario, avanzar, editarValor, crearCaptura, crearExportacion, validarValor, validarSemilla, PASOS } from '../public/motor.mjs';

test('cuatro puntos independientes y diez variables distintas', () => {
  const nodes = crearZonas();
  assert.equal(nodes.length, 4); assert.equal(new Set(nodes.map(n => n.nodo)).size, 4);
  assert.equal(VARIABLES.length, 10); assert.equal(new Set(VARIABLES.map(v => v.codigo)).size, 10);
  assert.notDeepEqual(nodes[0].valores, nodes[1].valores);
  const original = structuredClone(nodes[0]); nodes[1] = editarValor(nodes[1], 'temperatura_aire', 42.5);
  assert.deepEqual(nodes[0], original);
});
test('semilla reproducible y valores distintos entre semillas sin salir de límites', () => {
  assert.deepEqual(crearZonas(123), crearZonas('123')); assert.notDeepEqual(crearZonas(123), crearZonas(124));
  for (const seed of [1,20261103,999999999]) for (const n of crearZonas(seed)) for (const v of VARIABLES) validarValor(v.codigo,n.valores[v.codigo]);
});
test('rechaza datos vacíos, no finitos, rangos y precisiones incorrectos', () => {
  for (const value of ['', ' ', 'Infinity', NaN, null, false, {}, 81, -41, 23.123, '1e2']) assert.throws(() => validarValor('temperatura_aire', value));
  assert.throws(() => validarValor('humedad_suelo', 30));
  assert.equal(validarValor('temperatura_aire', '-5.2'), -5.2); assert.equal(validarValor('precipitacion_60min', 0), 0);
  for (const seed of ['', '0', '2.5', 0, null, -3, 1000000000]) assert.throws(() => validarSemilla(seed));
});
test('preparar escenario no cambia valores; avanzar interpola sin modificar el estado anterior', () => {
  const original=crearZonas()[0], prepared=prepararEscenario(original,'calor-seco'), first=avanzar(prepared);
  assert.deepEqual(prepared.valores,original.valores); assert.equal(prepared.paso,0); assert.equal(first.paso,1);
  assert.ok(first.valores.temperatura_aire>original.valores.temperatura_aire);
  assert.ok(first.valores.humedad_suelo_vwc<original.valores.humedad_suelo_vwc);
});
test('todos los escenarios llegan al destino en doce pasos y conservan valores válidos', () => {
  for(const scenario of ESCENARIOS) for(const base of crearZonas(927)) {
    let n=prepararEscenario(base,scenario.id); const target={...n.destino};
    for(let i=0;i<PASOS;i++){n=avanzar(n);for(const v of VARIABLES)validarValor(v.codigo,n.valores[v.codigo]);}
    assert.equal(n.paso,PASOS);assert.deepEqual(n.valores,target);assert.deepEqual(avanzar(n),n);
  }
});
test('misma secuencia genera los mismos valores y la edición manual abandona la transición', () => {
  const sequence=()=>{let n=prepararEscenario(crearZonas(29)[1],'lluvia');const out=[];for(let i=0;i<12;i++){n=avanzar(n);out.push(n.valores);}return out;};
  assert.deepEqual(sequence(),sequence());
  const n=editarValor(prepararEscenario(crearZonas()[0],'lluvia'),'ph_suelo',5.2);
  assert.equal(n.modo,'manual');assert.equal(n.paso,0);assert.deepEqual(avanzar(n).valores,n.valores);
});
test('capturas identifican cada variable simulada, preservan metadatos y reciben UUID nuevos', () => {
  const n=crearZonas()[0],ctx={fecha:new Date('2026-11-04T01:00:00Z'),ejecucion:randomUUID(),cultivo:'Maíz'};
  const a=crearCaptura(n,ctx),b=crearCaptura(n,ctx);assert.notEqual(a.mensaje_id,b.mensaje_id);
  assert.equal(a.origen,'simulado');assert.equal(a.mediciones.length,10);assert.ok(a.mediciones.every(m=>m.origen==='simulado'));
  assert.equal(a.tomada_en,'2026-11-04T01:00:00.000Z');
  assert.equal(a.mediciones.find(m=>m.variable_codigo==='iluminacion_relativa').metadatos.metodo,'indice_relativo_sintetico_v1');
  assert.equal(a.mediciones.find(m=>m.variable_codigo==='ph_suelo').unidad,'sin unidad');
  assert.equal(a.mediciones.find(m=>m.variable_codigo==='conductividad_suelo_ece').metadatos.metodo,'extracto_pasta_saturada_ECe');
  for(const key of ['adc_promedio','alertas','persistido'])assert.equal(key in a,false);
});
test('lluvia tiene ventana móvil explícita y sus acumulados no se suman entre capturas', () => {
  const a=crearCaptura(crearZonas()[0],{fecha:new Date('2026-11-04T01:00:00Z'),ejecucion:randomUUID()});
  const rain=a.mediciones.find(m=>m.variable_codigo==='precipitacion_60min');
  assert.equal(rain.metadatos.inicio_periodo,'2026-11-04T00:00:00.000Z');assert.equal(rain.metadatos.fin_periodo,a.tomada_en);
  assert.equal(rain.metadatos.periodo_segundos,3600);assert.equal(rain.metadatos.acumulados_no_sumables,true);
});
test('rechaza nodos físicos y contexto inválido', () => {
  const n=crearZonas()[0],ctx={ejecucion:randomUUID()};
  assert.throws(()=>crearCaptura({...n,nodo:'agv-dht22-01'},ctx));
  assert.throws(()=>crearCaptura(n,{...ctx,fecha:new Date('invalid')}));assert.throws(()=>crearCaptura(n,{...ctx,id:'1'}));
  assert.throws(()=>crearCaptura(n,{...ctx,cultivo:'cultivo-ajeno'}));assert.throws(()=>prepararEscenario(n,'inexistente'));
});
test('editar el borrador o el archivo exportado no reescribe capturas previas', () => {
  const n=crearZonas()[0],a=crearCaptura(n,{ejecucion:randomUUID()}),original=structuredClone(a);
  n.valores.ph_suelo=3;const exp=crearExportacion([a],7,new Date('2026-11-04T02:00:00Z'));
  exp.capturas[0].mediciones[0].valor=66;assert.deepEqual(a,original);
  assert.equal(exp.capturas_descartadas,7);assert.equal(exp.enviado_mqtt,false);assert.equal(exp.persistido_supabase,false);
  assert.throws(()=>crearExportacion([{...a,origen:'real'}]));const altered=structuredClone(a);altered.mediciones[0].origen='real';assert.throws(()=>crearExportacion([altered]));
});
