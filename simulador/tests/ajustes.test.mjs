// Ajuste manual de la simulacion: deltas que el usuario suma en la web. Sin red; todo es simulado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validarMensajeV3 } from '../contrato-v3.mjs';
import { AJUSTES, AJUSTES_FISICO, aplicarAjustes, aplicarEvento, faseClima, firmaAjustes, leerAjustes, leerEstado, loteProyeccion, loteVirtual, referencia, transicionAjustes } from '../clima-modelo.mjs';
import { ciclo } from '../servicio.mjs';
import { PARAMETROS, estadoFicticio } from './fixtures-clima.mjs';

const tarde = new Date('2026-11-04T19:00:00.000Z');
const nodo = (codigo = 'sim-52ea4628c470-01') => ({ codigo, tipo_nodo: 'virtual', asignacion_version: randomUUID(), zona: 'Sector norte', intervalo_segundos: 30, pausado: false });
const NORMAL = faseClima(null, null, Date.now());
const lluvia = faseClima({ evento: 'lluvia', intensidad: 3, iniciado_en: new Date(tarde.getTime() - 600_000).toISOString() }, null, tarde.getTime());
const valores = lote => Object.fromEntries(lote.payload.mediciones.map(m => [m.variable_codigo, m.valor]));
const silencio = async fn => { const eco = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = eco; } };

test('ajustes: se leen solo las seis claves permitidas, dentro de su rango, con un decimal y distintas de cero', () => {
  assert.deepEqual(Object.keys(AJUSTES), ['temperatura_aire', 'humedad_aire', 'humedad_suelo_vwc', 'ph_suelo', 'precipitacion_60min', 'velocidad_viento']);
  assert.deepEqual(leerAjustes({ temperatura_aire: 4, humedad_aire: 0, ph_suelo: -1.5, radiacion_solar: 200, velocidad_viento: '3', humedad_suelo_vwc: NaN }), { temperatura_aire: 4, ph_suelo: -1.5 });
  assert.deepEqual(leerAjustes({ temperatura_aire: 99, velocidad_viento: 15, precipitacion_60min: -80, ph_suelo: 0.26 }), { temperatura_aire: 10, velocidad_viento: 15, precipitacion_60min: -50, ph_suelo: 0.3 }, 'fuera de rango se recorta al limite');
  for (const vacio of [null, undefined, {}, [], 'x', { temperatura_aire: 0 }, { otra: 3 }]) assert.equal(leerAjustes(vacio), null);
  assert.deepEqual(leerAjustes({ temperatura_aire: 2, ph_suelo: 1, humedad_aire: -5 }, AJUSTES_FISICO), { temperatura_aire: 2, humedad_aire: -5 }, 'el fisico solo mide aire');
  assert.equal(leerAjustes({ ph_suelo: 1, humedad_suelo_vwc: -9 }, AJUSTES_FISICO), null);
  assert.equal(firmaAjustes(null), ''); assert.equal(firmaAjustes({ ph_suelo: 1, humedad_aire: -5 }), firmaAjustes({ humedad_aire: -5, ph_suelo: 1 }));
  assert.notEqual(firmaAjustes({ ph_suelo: 1 }), firmaAjustes({ ph_suelo: 1.1 }));
});

test('ajustes: se suman despues del evento de clima y respetan los limites fisicos del contrato', () => {
  const base = referencia(nodo(), PARAMETROS.platano, tarde), copia = { ...base };
  const a = aplicarAjustes(base, { temperatura_aire: 4, humedad_suelo_vwc: -10.5, ph_suelo: 0.5 });
  assert.equal(a.temperatura_aire, Number((base.temperatura_aire + 4).toFixed(1))); assert.equal(a.humedad_suelo_vwc, Number((base.humedad_suelo_vwc - 10.5).toFixed(1)));
  assert.equal(a.ph_suelo, Number((base.ph_suelo + 0.5).toFixed(1))); assert.equal(a.humedad_aire, base.humedad_aire); assert.equal(a.radiacion_solar, base.radiacion_solar);
  assert.deepEqual(base, copia, 'no modifica la entrada'); assert.deepEqual(aplicarAjustes(base, null), base);
  // Despues del evento: lluvia extrema deja 55 mm y el ajuste suma o resta sobre ese valor.
  const conLluvia = aplicarEvento(base, lluvia);
  assert.equal(aplicarAjustes(conLluvia, { precipitacion_60min: 20 }).precipitacion_60min, 75);
  assert.equal(aplicarAjustes(conLluvia, { precipitacion_60min: -50 }).precipitacion_60min, 5);
  // Limites: nada negativo donde no aplica, humedad del aire hasta 100, del suelo hasta 80, pH de 0 a 14.
  const piso = aplicarAjustes(base, { precipitacion_60min: -50, velocidad_viento: -10, humedad_aire: -30, humedad_suelo_vwc: -30, ph_suelo: -2 });
  assert.equal(piso.precipitacion_60min, 0); assert.equal(piso.velocidad_viento, 0); assert.ok(piso.humedad_suelo_vwc >= 0 && piso.humedad_aire >= 0 && piso.ph_suelo >= 0);
  assert.equal(aplicarAjustes(conLluvia, { humedad_aire: 30 }).humedad_aire, 100);
  assert.equal(aplicarAjustes({ humedad_suelo_vwc: 70, ph_suelo: 13 }, { humedad_suelo_vwc: 30, ph_suelo: 2 }).humedad_suelo_vwc, 80);
  assert.equal(aplicarAjustes({ ph_suelo: 13 }, { ph_suelo: 2 }).ph_suelo, 14);
});

test('lote virtual con ajuste: sigue siendo un v3 valido en todos los extremos, con y sin evento', () => {
  const n = nodo('sim-aaaaaaaa0001-02'), ejecucion = randomUUID();
  const extremos = [Object.fromEntries(Object.entries(AJUSTES).map(([c, [min]]) => [c, min])), Object.fromEntries(Object.entries(AJUSTES).map(([c, [, max]]) => [c, max]))];
  for (const ajustes of extremos) for (const fase of [NORMAL, lluvia]) for (const p of Object.values(PARAMETROS)) {
    const lote = loteVirtual(n, p, fase, tarde, { ejecucion, ajustes });
    validarMensajeV3(lote.payload);
    assert.equal(lote.payload.origen, 'simulado'); assert.equal(lote.topico, 'agrovigia/v3/simulado/nodos/sim-aaaaaaaa0001-02/telemetria');
  }
  const sin = valores(loteVirtual(n, PARAMETROS.yuca, NORMAL, tarde, { ejecucion })), con = valores(loteVirtual(n, PARAMETROS.yuca, NORMAL, tarde, { ejecucion, ajustes: { temperatura_aire: -3, velocidad_viento: 6 } }));
  assert.equal(con.temperatura_aire, Number((sin.temperatura_aire - 3).toFixed(1))); assert.equal(con.velocidad_viento, Number((sin.velocidad_viento + 6).toFixed(1)));
  assert.equal(con.humedad_suelo_vwc, sin.humedad_suelo_vwc);
});

test('proyeccion del fisico con ajuste: solo temperatura y humedad del aire, tambien sin evento; la lectura real no cambia', () => {
  const real = { tomada_en: tarde.toISOString(), temperatura: 29.4, humedad: 71, adc: 2600 }, copia = { ...real };
  const fisico = { codigo: 'agv-dht22-01', tipo_nodo: 'fisico', ultima_real: real };
  const lote = loteProyeccion(fisico, NORMAL, tarde, undefined, { temperatura_aire: 3.5, humedad_aire: -11, ph_suelo: 2, humedad_suelo_vwc: -20 });
  assert.equal(lote.topico, 'agrovigia/v2/simulado/nodos/agv-dht22-01/telemetria'); assert.equal(lote.payload.origen, 'simulado');
  assert.deepEqual(lote.payload.mediciones.map(m => m.valor), [32.9, 60, 63.5], 'la luz no tiene ajuste: queda la real');
  assert.equal(lote.payload.ldr.adc_promedio, 2600); assert.deepEqual(real, copia);
  // Con evento: primero el evento y despues el delta.
  const conEvento = loteProyeccion(fisico, lluvia, tarde, undefined, { temperatura_aire: 2 });
  assert.equal(conEvento.payload.mediciones[0].valor, Number((29.4 - 4.5 + 2).toFixed(1)));
  assert.equal(loteProyeccion(fisico, NORMAL, tarde, undefined, { ph_suelo: 1, precipitacion_60min: 30 }), null, 'ajustes que el fisico no mide: no hay proyeccion');
  assert.equal(loteProyeccion(fisico, NORMAL, tarde, undefined, null), null);
  assert.equal(loteProyeccion({ ...fisico, ultima_real: null }, NORMAL, tarde, undefined, { temperatura_aire: 2 }), null, 'sin lectura real no se inventa una base');
  assert.equal(loteProyeccion(fisico, NORMAL, tarde, undefined, { humedad_aire: 30 }).payload.mediciones[1].valor, 100);
});

test('servicio: un cambio de ajuste publica de inmediato; el fisico se proyecta con ajuste de aire sin evento y deja de hacerlo al quitarlo', async () => {
  const enviados = [], transporte = { nombre: 'prueba', confirmacion: 'OK', async enviar(lote) { enviados.push(lote); return { ok: true }; }, async cerrar() {} };
  const memoria = new Map(), ejecucion = randomUUID(), t0 = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000), en = s => new Date(t0.getTime() + s * 1000);
  const estado = estadoFicticio();
  assert.equal(leerEstado(estado)[0].ajustes, null);
  await silencio(async () => {
    assert.equal(await ciclo({ estado, memoria, transporte, ejecucion, transicion: 0, ahora: t0 }), 17, 'clima normal y sin ajuste: solo los virtuales');
    assert.equal(await ciclo({ estado, memoria, transporte, ejecucion, transicion: 0, ahora: en(5) }), 0);
    // Ajuste de suelo y pH en el platano: salen ya sus 5 virtuales; el fisico no mide eso y no se proyecta.
    estado.cultivos[0].ajustes = { humedad_suelo_vwc: -12, ph_suelo: 1 }; enviados.length = 0;
    assert.equal(await ciclo({ estado, memoria, transporte, ejecucion, transicion: 0, ahora: en(10) }), 5);
    assert.ok(enviados.every(l => l.topico.includes('/v3/simulado/nodos/sim-52ea4628c470-')));
    assert.equal(await ciclo({ estado, memoria, transporte, ejecucion, transicion: 0, ahora: en(15) }), 0, 'el mismo ajuste no vuelve a publicar antes del intervalo');
    // Se agrega temperatura: vuelven a salir los 5 virtuales y ahora tambien la proyeccion v2 simulada del fisico.
    estado.cultivos[0].ajustes = { humedad_suelo_vwc: -12, ph_suelo: 1, temperatura_aire: 4 }; enviados.length = 0;
    assert.equal(await ciclo({ estado, memoria, transporte, ejecucion, transicion: 0, ahora: en(20) }), 6);
    const proyeccion = enviados.find(l => l.topico === 'agrovigia/v2/simulado/nodos/agv-dht22-01/telemetria');
    assert.deepEqual([proyeccion.payload.origen, proyeccion.payload.mediciones[0].valor, proyeccion.payload.mediciones[1].valor], ['simulado', 33.4, 71]);
    assert.ok(enviados.filter(l => l.payload.version === 3).every(l => l.payload.simulacion.escenario_id === 'referencia' && l.payload.simulacion.modo === 'manual'));
    // Cambiar solo el pH no afecta al fisico: publican los virtuales, la proyeccion espera su intervalo de 30 s.
    estado.cultivos[0].ajustes = { humedad_suelo_vwc: -12, ph_suelo: -1, temperatura_aire: 4 }; enviados.length = 0;
    assert.equal(await ciclo({ estado, memoria, transporte, ejecucion, transicion: 0, ahora: en(25) }), 5);
    assert.ok(enviados.every(l => l.payload.version === 3));
    enviados.length = 0;
    assert.equal(await ciclo({ estado, memoria, transporte, ejecucion, transicion: 0, ahora: en(56) }), 18, 'a su intervalo salen todos, con la proyeccion');
    // Vuelta a automatico: los virtuales publican sin delta y el fisico deja de proyectarse.
    estado.cultivos[0].ajustes = null; enviados.length = 0;
    assert.equal(await ciclo({ estado, memoria, transporte, ejecucion, transicion: 0, ahora: en(60) }), 5);
    assert.ok(enviados.every(l => l.payload.version === 3));
    assert.equal(await ciclo({ estado, memoria, transporte, ejecucion, transicion: 0, ahora: en(95) }), 17);
  });
});

test('servicio: fallo definitivo no se reintenta, fallo temporal si, y el contador distingue publicados de fallidos', async () => {
  const intentos = new Map(), contador = { lotes_publicados: 0, lotes_fallidos: 0 };
  const transporte = { nombre: 'prueba', confirmacion: 'OK', async cerrar() {}, async enviar(lote) {
    const n = (intentos.get(lote.topico) ?? 0) + 1; intentos.set(lote.topico, n);
    if (lote.topico.endsWith('-01/telemetria')) return { ok: false, definitivo: true, motivo: 'HTTP 400 PAYLOAD_V3_INVALIDO' };
    if (lote.topico.endsWith('-02/telemetria')) return n < 3 ? { ok: false, definitivo: false, motivo: 'HTTP 503' } : { ok: true };
    if (lote.topico.endsWith('-03/telemetria')) return { ok: false, definitivo: false, motivo: 'sin respuesta' };
    return { ok: true };
  } };
  const t0 = new Date(Math.floor(Date.now() / 1000) * 1000 - 1000);
  const publicados = await silencio(() => ciclo({ estado: estadoFicticio(), memoria: new Map(), transporte, ejecucion: randomUUID(), ahora: t0, reintentos: [5, 5], contador }));
  assert.equal(publicados, 11, '17 virtuales menos tres rechazados (-01) y tres que nunca responden (-03)');
  assert.deepEqual(contador, { lotes_publicados: 11, lotes_fallidos: 6 });
  const veces = sufijo => [...intentos].filter(([t]) => t.endsWith(sufijo + '/telemetria')).map(([, n]) => n);
  assert.deepEqual(veces('-01'), [1, 1, 1], 'rechazo definitivo: un solo intento');
  assert.deepEqual(veces('-02'), [3, 3, 3], 'fallo temporal: reintenta hasta confirmar');
  assert.deepEqual(veces('-03'), [3, 3, 3], 'se rinde tras agotar los reintentos');
});

test('ajuste gradual: los valores avanzan por pasos hasta el objetivo y vuelven igual al quitarlo', () => {
  const t0 = Date.parse('2026-11-16T15:00:00Z');
  // Primera vez con un ajuste recien activado: parte de cero.
  let r = transicionAjustes(null, { temperatura_aire: 6, ph_suelo: -1.2 }, new Date(t0).toISOString(), t0);
  assert.equal(r.ajustes, null); assert.equal(r.enTransicion, true);
  r = transicionAjustes(r.estado, { temperatura_aire: 6, ph_suelo: -1.2 }, null, t0 + 30_000);
  assert.deepEqual(r.ajustes, { temperatura_aire: 1.5, ph_suelo: -0.3 }, 'a los 30 s va por la cuarta parte');
  r = transicionAjustes(r.estado, { temperatura_aire: 6, ph_suelo: -1.2 }, null, t0 + 60_000);
  assert.deepEqual(r.ajustes, { temperatura_aire: 3, ph_suelo: -0.6 });
  r = transicionAjustes(r.estado, { temperatura_aire: 6, ph_suelo: -1.2 }, null, t0 + 120_000);
  assert.deepEqual(r.ajustes, { temperatura_aire: 6, ph_suelo: -1.2 }); assert.equal(r.enTransicion, false);
  // Cambio de objetivo a mitad de camino: sigue desde donde iba, sin salto.
  r = transicionAjustes(r.estado, { temperatura_aire: 2 }, null, t0 + 200_000);
  assert.deepEqual(r.ajustes, { temperatura_aire: 6, ph_suelo: -1.2 }, 'en el instante del cambio conserva el valor que tenia');
  r = transicionAjustes(r.estado, { temperatura_aire: 2 }, null, t0 + 260_000);
  assert.deepEqual(r.ajustes, { temperatura_aire: 4, ph_suelo: -0.6 });
  // Volver a automatico tambien es gradual y termina en nada.
  r = transicionAjustes(r.estado, null, null, t0 + 260_000);
  r = transicionAjustes(r.estado, null, null, t0 + 320_000);
  assert.deepEqual(r.ajustes, { temperatura_aire: 2, ph_suelo: -0.3 });
  r = transicionAjustes(r.estado, null, null, t0 + 380_000);
  assert.equal(r.ajustes, null); assert.equal(r.enTransicion, false);
  // Con transicion 0 se aplica de una vez (pruebas y capturas de un solo ciclo).
  assert.deepEqual(transicionAjustes(null, { humedad_suelo_vwc: -12 }, new Date(t0).toISOString(), t0, 0).ajustes, { humedad_suelo_vwc: -12 });
});
