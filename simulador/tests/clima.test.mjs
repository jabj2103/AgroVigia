import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validarMensajeV3 } from '../contrato-v3.mjs';
import { EVENTOS, SEGUNDOS_TRANSICION, aplicarEvento, faseClima, firmaClima, horaBogota, leerEstado, loteProyeccion, loteVirtual, referencia } from '../clima-modelo.mjs';
import { ciclo } from '../servicio.mjs';
import { PARAMETROS, estadoFicticio } from './fixtures-clima.mjs';

const tarde = new Date('2026-11-04T19:00:00.000Z'), madrugada = new Date('2026-11-04T07:00:00.000Z');
const nodo = (codigo = 'sim-52ea4628c470-01') => ({ codigo, tipo_nodo: 'virtual', asignacion_version: randomUUID(), zona: 'Sector norte', intervalo_segundos: 30, pausado: false });
const NORMAL = faseClima(null, null, Date.now());
const evento = (tipo, intensidad, segundos = SEGUNDOS_TRANSICION) => faseClima({ evento: tipo, intensidad, iniciado_en: new Date(tarde.getTime() - segundos * 1000).toISOString() }, null, tarde.getTime());
const valores = lote => Object.fromEntries(lote.payload.mediciones.map(m => [m.variable_codigo, m.valor]));

test('referencia: 24 h dentro de los limites de alerta del cultivo, tambien con rangos propios estrechos', () => {
  const estrecho = { ...PARAMETROS.yuca, temperatura_min: 26, temperatura_optima_min: 27, temperatura_optima_max: 28, temperatura_max: 29,
    suelo_vwc_min: 24, suelo_vwc_optima_min: 25, suelo_vwc_optima_max: 26, suelo_vwc_max: 27 };
  for (const p of [...Object.values(PARAMETROS), estrecho]) for (let i = 1; i <= 6; i++) for (let m = 0; m < 24 * 60; m += 10) {
    const v = referencia(nodo('sim-x1-0' + i), p, new Date(Date.UTC(2026, 10, 4, 5) + m * 60_000));
    assert.ok(v.temperatura_aire >= p.temperatura_min && v.temperatura_aire <= p.temperatura_max, `T ${v.temperatura_aire} ${p.nombre}`);
    assert.ok(v.humedad_aire >= p.humedad_min && v.humedad_aire <= p.humedad_max, `HR ${v.humedad_aire} ${p.nombre}`);
    assert.ok(v.humedad_suelo_vwc >= p.suelo_vwc_min && v.humedad_suelo_vwc <= p.suelo_vwc_max, `suelo ${v.humedad_suelo_vwc} ${p.nombre}`);
    assert.equal(v.precipitacion_60min, 0);
  }
});

test('referencia: ciclo del dia, diferencias entre nodos, cultivo ajustado y cultivo sin parametros', () => {
  assert.equal(horaBogota(tarde), 14); assert.equal(horaBogota(madrugada), 2);
  const a = referencia(nodo(), PARAMETROS.platano, tarde), b = referencia(nodo(), PARAMETROS.platano, madrugada);
  assert.ok(a.temperatura_aire > b.temperatura_aire + 3 && a.humedad_aire < b.humedad_aire - 8);
  assert.ok(b.radiacion_solar === 0 && b.iluminacion_relativa <= 1.1 && a.radiacion_solar > 650);
  const t = [1, 2, 3, 4, 5].map(i => referencia(nodo('sim-52ea4628c470-0' + i), PARAMETROS.platano, tarde).temperatura_aire);
  assert.ok(new Set(t).size > 1 && Math.max(...t) - Math.min(...t) < 1.5, 'parecidos pero no identicos');
  // Ajustar el cultivo mueve la simulacion: el suelo sigue el nuevo rango optimo.
  const humedo = { ...PARAMETROS.yuca, suelo_vwc_optima_min: 34, suelo_vwc_optima_max: 38, suelo_vwc_max: 45 };
  assert.ok(referencia(nodo(), humedo, tarde).humedad_suelo_vwc > referencia(nodo(), PARAMETROS.yuca, tarde).humedad_suelo_vwc + 8);
  const generico = referencia(nodo(), null, tarde);
  assert.ok(generico.temperatura_aire > 25 && generico.humedad_suelo_vwc > 20, 'sin plantilla usa las bases del motor');
});

test('fases del clima: sube en dos minutos, se mantiene, regresa de forma gradual y vuelve a normal', () => {
  assert.deepEqual([NORMAL.fase, NORMAL.escenario, NORMAL.modo, NORMAL.paso, firmaClima(NORMAL)], ['normal', 'referencia', 'manual', 0, 'normal']);
  const pasos = [0, 30, 60, 120, 900].map(s => evento('lluvia', 2, s));
  assert.deepEqual(pasos.map(f => f.paso), [1, 3, 6, 12, 12]); assert.deepEqual(pasos.map(f => f.fase), Array(5).fill('evento'));
  assert.ok(pasos[0].progreso > 0 && pasos[2].progreso === 0.5 && pasos[4].progreso === 1);
  assert.deepEqual(Object.values(EVENTOS).map(e => e.escenario), ['lluvia', 'calor-seco', 'calor-seco', 'viento'], 'identificadores del contrato v3');
  const fin = s => faseClima(null, { evento: 'lluvia', intensidad: 2, iniciado_en: '2026-11-04T18:00:00Z', finalizado_en: new Date(tarde.getTime() - s * 1000).toISOString() }, tarde.getTime());
  assert.deepEqual([fin(30).fase, fin(30).escenario, fin(30).progreso], ['regreso', 'recuperacion', 0.75]);
  assert.equal(fin(121).fase, 'normal');
  assert.equal(firmaClima(evento('lluvia', 2)), 'evento:lluvia:2'); assert.notEqual(firmaClima(evento('lluvia', 3)), firmaClima(evento('lluvia', 2)));
  for (const malo of [{ evento: 'granizo', intensidad: 2, iniciado_en: tarde.toISOString() }, { evento: 'lluvia', intensidad: 9, iniciado_en: tarde.toISOString() }])
    assert.equal(faseClima(malo, null, tarde.getTime()).fase, 'normal');
});

test('eventos: lluvia, sol fuerte, tierra seca y viento cambian las variables esperadas y cruzan los limites', () => {
  const p = PARAMETROS.platano, base = referencia(nodo(), p, tarde);
  const lluvia = aplicarEvento(base, evento('lluvia', 3));
  assert.equal(lluvia.precipitacion_60min, 55); assert.ok(lluvia.humedad_aire > p.humedad_max && lluvia.humedad_aire <= 100);
  assert.ok(lluvia.temperatura_aire < base.temperatura_aire - 4 && lluvia.humedad_suelo_vwc > p.suelo_vwc_max && lluvia.radiacion_solar < base.radiacion_solar * 0.15);
  const medio = aplicarEvento(base, evento('lluvia', 3, 60));
  assert.ok(medio.precipitacion_60min > 20 && medio.precipitacion_60min < 35, 'a mitad de la transicion va a medio camino');
  const sol = aplicarEvento(referencia(nodo(), p, madrugada), evento('sol_fuerte', 2));
  assert.equal(sol.radiacion_solar, 1050); assert.equal(sol.iluminacion_relativa, 92);
  assert.ok(aplicarEvento(base, evento('sol_fuerte', 3)).temperatura_aire > p.temperatura_max);
  const seca = aplicarEvento(base, evento('tierra_seca', 2));
  assert.ok(seca.humedad_suelo_vwc < p.suelo_vwc_min && seca.temperatura_aire === base.temperatura_aire && seca.precipitacion_60min === 0);
  assert.ok(aplicarEvento(base, evento('tierra_seca', 1)).humedad_suelo_vwc > seca.humedad_suelo_vwc, 'la intensidad gradua el efecto');
  const viento = aplicarEvento(base, evento('viento', 3));
  assert.equal(viento.velocidad_viento, 22); assert.equal(viento.humedad_suelo_vwc, base.humedad_suelo_vwc);
  assert.deepEqual(aplicarEvento(base, NORMAL), base);
});

test('lote virtual: contrato v3 de Juan, topico simulado, etiqueta del evento y tamano', () => {
  const n = nodo('sim-aaaaaaaa0001-03'), ejecucion = randomUUID();
  const normal = loteVirtual(n, PARAMETROS.yuca, NORMAL, tarde, { ejecucion });
  assert.equal(normal.topico, 'agrovigia/v3/simulado/nodos/sim-aaaaaaaa0001-03/telemetria');
  validarMensajeV3(normal.payload); assert.ok(Buffer.byteLength(normal.mensaje) <= 8192);
  assert.deepEqual([normal.payload.origen, normal.payload.asignacion_version, normal.payload.simulacion.escenario_id, normal.payload.simulacion.modo, normal.payload.simulacion.paso],
    ['simulado', n.asignacion_version, 'referencia', 'manual', 0]);
  const seca = loteVirtual(n, PARAMETROS.yuca, evento('tierra_seca', 3, 60), tarde, { ejecucion });
  validarMensajeV3(seca.payload);
  assert.deepEqual([seca.payload.simulacion.escenario_id, seca.payload.simulacion.modo, seca.payload.simulacion.paso], ['calor-seco', 'escenario', 6]);
  assert.ok(valores(seca).humedad_suelo_vwc < valores(normal).humedad_suelo_vwc - 5);
  assert.notEqual(seca.payload.mensaje_id, normal.payload.mensaje_id);
});

test('proyeccion del fisico: lectura real + evento como lote v2 SIMULADO; sin evento o sin lectura no hay lote', () => {
  const real = { tomada_en: tarde.toISOString(), temperatura: 29.4, humedad: 71, adc: 2600 }, copia = { ...real };
  const fisico = { codigo: 'agv-dht22-01', tipo_nodo: 'fisico', ultima_real: real };
  const lote = loteProyeccion(fisico, evento('lluvia', 2), tarde);
  assert.equal(lote.topico, 'agrovigia/v2/simulado/nodos/agv-dht22-01/telemetria');
  assert.deepEqual([lote.payload.version, lote.payload.origen, lote.payload.tomada_en], [2, 'simulado', '2026-11-04T19:00:00Z']);
  const [t, h, luz] = lote.payload.mediciones;
  assert.deepEqual([t.valor, h.valor], [26.4, 93]);
  assert.equal(lote.payload.ldr.adc_promedio, 778, 'indice 63,5 x 0,3 = 19,0 y de vuelta a ADC'); assert.equal(luz.valor, 19);
  assert.deepEqual(real, copia, 'la lectura real no se modifica');
  assert.equal(loteProyeccion(fisico, evento('sol_fuerte', 3), tarde).payload.mediciones[1].valor, 47);
  assert.equal(loteProyeccion(fisico, NORMAL, tarde), null);
  assert.equal(loteProyeccion({ ...fisico, ultima_real: null }, evento('lluvia', 2), tarde), null, 'no se inventa una base');
  assert.equal(loteProyeccion({ ...fisico, ultima_real: { temperatura: 29, humedad: 70, adc: null } }, evento('lluvia', 2), tarde), null);
});

test('servicio: publica cada virtual a su intervalo, reacciona al cambio de clima, respeta la pausa y proyecta el fisico solo con evento', async () => {
  const enviados = [], cliente = { connected: true, publish(topico, mensaje, opciones, cb) { enviados.push({ topico, payload: JSON.parse(mensaje), opciones }); cb(null); } };
  // Hora actual: el servicio descarta, como el firmware, las capturas de mas de 300 s.
  const memoria = new Map(), ejecucion = randomUUID(), t0 = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000);
  const sinEco = console.log; console.log = () => {};
  try {
    const estado = estadoFicticio(); estado.cultivos[1].nodos[5].pausado = true; estado.cultivos[2].nodos[5].zona = null;
    assert.equal(leerEstado(estado).length, 3);
    assert.equal(await ciclo({ estado, memoria, cliente, ejecucion, ahora: t0 }), 15, '17 virtuales menos el pausado y el que no tiene sector; el fisico no se proyecta en clima normal');
    assert.ok(enviados.every(e => e.topico.startsWith('agrovigia/v3/simulado/nodos/sim-') && e.opciones.qos === 1 && e.opciones.retain === false));
    assert.equal(await ciclo({ estado, memoria, cliente, ejecucion, ahora: new Date(t0.getTime() + 5000) }), 0, 'antes del intervalo no repite');
    // El agricultor activa lluvia en el platano: sus 5 virtuales y la proyeccion del fisico salen al instante.
    estado.cultivos[0].clima = { evento: 'lluvia', intensidad: 2, iniciado_en: new Date(t0.getTime() + 8000).toISOString() };
    enviados.length = 0;
    assert.equal(await ciclo({ estado, memoria, cliente, ejecucion, ahora: new Date(t0.getTime() + 10_000) }), 6);
    assert.equal(enviados.filter(e => e.topico === 'agrovigia/v2/simulado/nodos/agv-dht22-01/telemetria').length, 1);
    assert.ok(enviados.filter(e => e.payload.version === 3).every(e => e.payload.simulacion.escenario_id === 'lluvia' && e.topico.includes('sim-52ea4628c470-')));
    // A los 30 s vuelven a salir todos los que no estan pausados; el fisico sigue proyectado.
    enviados.length = 0;
    assert.equal(await ciclo({ estado, memoria, cliente, ejecucion, ahora: new Date(t0.getTime() + 41_000) }), 16);
    // Vuelta a normal: los virtuales del platano publican el regreso y el fisico deja de proyectarse.
    estado.cultivos[0].clima_anterior = { ...estado.cultivos[0].clima, finalizado_en: new Date(t0.getTime() + 50_000).toISOString() }; estado.cultivos[0].clima = null;
    enviados.length = 0;
    assert.equal(await ciclo({ estado, memoria, cliente, ejecucion, ahora: new Date(t0.getTime() + 52_000) }), 5);
    assert.ok(enviados.every(e => e.payload.version === 3 && e.payload.simulacion.escenario_id === 'recuperacion'));
    assert.throws(() => leerEstado({ cultivos: 'x' }), /no valido/); assert.throws(() => leerEstado({ cultivos: [{ nodos: [] }] }), /no valido/);
  } finally { console.log = sinEco; }
});
