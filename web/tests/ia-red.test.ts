import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { formarLote, origenesCultivo, origenNodo, estadoDatos } from '../src/domain.ts';
import { cargarContexto, cargarUltimoLote } from '../src/data.ts';
import { cargarSugerencias, respuestaValida, textoFallo } from '../src/sugerencia-data.ts';
import { RADIO_HEXAGONO, cargarEstadoRed, estadoConexion, lotesNuevos, panalRed, tonoConexion, ventanaConexionMs } from '../src/red-data.ts';
import { CAMPOS_RANGOS, configurarDispositivo, establecerClima, pausarNodo, validarRangos } from '../src/escenario-data.ts';
import { compararConPlantilla, rangoPlantilla, tendenciaHistorial } from '../src/history-domain.ts';
import type { EstadoNodoRed } from '../src/red-data.ts';
import { aplicarPlantilla, cargarEpisodios, cargarReglas, guardarRegla } from '../src/alert-data.ts';
import type { Medicion } from '../src/types.ts';

const crop = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', node = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const id = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
function cliente(responder: (u: URL, body: unknown) => unknown, urls: URL[] = []) {
  return createClient('https://fixture.supabase.co', 'sb_publishable_ficticia', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
    const u = new URL(String(input)); urls.push(u);
    const data = responder(u, init?.body ? JSON.parse(String(init.body)) : null);
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Range': '0-0/*' } });
  } } });
}
const respuesta = () => ({ resumen: 'Calor sobre el limite.', estado_general: 'atencion', riego: 'Verificar suelo.', luz: 'Indice alto, no lux.', limitaciones: 'Datos simulados.',
  recomendaciones: [{ titulo: 'Sombra', accion: 'Evaluar sombra temporal.', prioridad: 'alta', variable: 'temperatura_aire', evidencia: '36 C frente a 35 C.' }] });

test('origen: nodo simulado y cultivo con todos sus nodos simulados; el resto es real', () => {
  assert.equal(origenNodo({ simulado: true }), 'simulado'); assert.equal(origenNodo({}), 'real'); assert.equal(origenNodo(undefined), 'real');
  assert.equal(estadoDatos(null, Date.now(), 'simulado').texto, 'Sin datos simulados');
  assert.deepEqual(origenesCultivo([{ simulado: true }, { simulado: false }]), ['real', 'simulado']);
  assert.deepEqual(origenesCultivo([{ simulado: true }]), ['simulado']); assert.deepEqual(origenesCultivo([]), []);
});

test('lote simulado: se consulta y valida con origen simulado, sin aceptar filas reales', async () => {
  const t = '2026-11-03T19:00:00Z', fila = (v: string, valor: number, origen = 'simulado'): Medicion => ({ id: id(valor), cultivo_id: crop, nodo_id: node, mensaje_id: id(1), variable_codigo: v, valor, tomada_en: t, recibida_en: t, origen,
    metadatos: { version_payload: 2, ldr: { metodo: 'adc12_10k_11db_v1', adc_promedio: 625 } } });
  const filas = [fila('temperatura_aire', 30), fila('humedad_aire', 70), fila('iluminacion_relativa', 15.3)];
  assert.equal(formarLote(filas, node, crop, id(1), true, 'simulado').temperatura, 30);
  assert.throws(() => formarLote(filas, node, crop, id(1), true, 'real'), /origen/);
  assert.throws(() => formarLote([...filas.slice(0, 2), fila('iluminacion_relativa', 15.3, 'real')], node, crop, id(1), true, 'simulado'));
  const urls: URL[] = [];
  const c = cliente(u => u.searchParams.get('select') === 'mensaje_id' ? { mensaje_id: id(1) } : filas, urls);
  assert.equal((await cargarUltimoLote(c, crop, node, true, 'simulado'))?.humedad, 70);
  assert.ok(urls.every(u => u.searchParams.get('origen') === 'eq.simulado'));
});

test('alertas y plantillas: el origen viaja en consultas y RPC; plantilla confirmada por la respuesta', async () => {
  const urls: URL[] = [], cuerpos: unknown[] = [];
  const c = cliente((u, b) => { cuerpos.push(b); const n = u.pathname.split('/').at(-1);
    if (n === 'configurar_regla_alerta') return { id: id(5), cultivo_id: crop, origen: 'simulado', variable_codigo: 'temperatura_aire', minimo: null, maximo: 35, habilitada: true };
    if (n === 'aplicar_plantilla_cultivo') return { id: crop, plantilla_codigo: (b as { p_plantilla: string }).p_plantilla };
    return []; }, urls);
  await cargarReglas(c, crop, undefined, 'simulado'); await cargarEpisodios(c, crop, { estado: 'activas', revision: 'todas' }, null, undefined, 'simulado');
  assert.ok(urls.slice(0, 2).every(u => u.searchParams.get('origen') === 'eq.simulado'));
  await guardarRegla(c, crop, 'temperatura_aire', '', '35', 'simulado');
  assert.equal((cuerpos.at(-1) as { p_origen: string }).p_origen, 'simulado');
  await aplicarPlantilla(c, crop, 'yuca', true, 'real');
  assert.deepEqual(cuerpos.at(-1), { p_cultivo_id: crop, p_plantilla: 'yuca', p_configurar_reglas: true, p_origen: 'real' });
  const otra = cliente(() => ({ id: crop, plantilla_codigo: 'mango' }));
  await assert.rejects(aplicarPlantilla(otra, crop, 'yuca', false), /No pudimos confirmar/);
});

test('sugerencias: validan forma, cultivo y origen; fallos se traducen sin inventar resultados', async () => {
  assert.equal(respuestaValida(respuesta()), true);
  for (const malo of [{ ...respuesta(), extra: 1 }, { ...respuesta(), estado_general: 'excelente' }, { ...respuesta(), recomendaciones: [] }, null, []])
    assert.equal(respuestaValida(malo), false);
  const fila = (extra = {}) => ({ id: id(9), cultivo_id: crop, origen: 'simulado', motivo: 'alerta', estado: 'generada', plantilla_codigo: 'yuca', respuesta: respuesta(), modelo: 'gemini-3.5-flash-lite',
    error_codigo: null, solicitada_en: '2026-11-03T19:00:00Z', completada_en: '2026-11-03T19:00:05Z', contexto: {}, ...extra });
  const urls: URL[] = [];
  const filas = await cargarSugerencias(cliente(() => [fila()], urls), crop, 'simulado');
  assert.equal(filas[0]!.respuesta?.recomendaciones.length, 1);
  assert.equal(urls[0]!.searchParams.get('origen'), 'eq.simulado'); assert.equal(urls[0]!.searchParams.get('cultivo_id'), 'eq.' + crop);
  await assert.rejects(cargarSugerencias(cliente(() => [fila({ respuesta: { resumen: 'x' } })]), crop, 'simulado'), /inconsistente/);
  await assert.rejects(cargarSugerencias(cliente(() => [fila({ origen: 'real' })]), crop, 'simulado'), /inconsistente/);
  assert.match(textoFallo('GEMINI_HTTP_429'), /saldo/); assert.match(textoFallo('GEMINI_HTTP_403'), /API key/); assert.match(textoFallo('OTRO_CODIGO'), /OTRO_CODIGO/);
});

test('red: conectado hasta 180 s, reloj adelantado, pulso por lote nuevo y un hexagono por cultivo', async () => {
  const ahora = Date.parse('2026-11-03T19:00:00Z');
  const base = (extra: Partial<EstadoNodoRed> = {}): EstadoNodoRed => ({ nodo_id: id(1), codigo: 'agv-sim-01', simulado: true, habilitado: true, cultivo_id: crop, cultivo_nombre: 'Simulado · Yuca',
    plantilla_codigo: 'yuca', origen: 'simulado', mensaje_id: id(50), tomada_en: new Date(ahora - 60_000).toISOString(), recibida_en: new Date(ahora - 59_000).toISOString(),
    temperatura: 30, humedad: 70, iluminacion: 40, ...extra });
  assert.equal(estadoConexion(base(), ahora), 'conectado');
  assert.equal(estadoConexion(base({ tomada_en: new Date(ahora - 181_000).toISOString() }), ahora), 'antiguo');
  assert.equal(estadoConexion(base({ tomada_en: null, recibida_en: null }), ahora), 'sin_datos');
  assert.equal(estadoConexion(base({ habilitado: false }), ahora), 'deshabilitado');
  assert.equal(estadoConexion(base({ cultivo_id: null }), ahora), 'sin_cultivo');
  assert.equal(estadoConexion(base({ tomada_en: new Date(ahora + 200_000).toISOString() }), ahora), 'reloj');
  assert.deepEqual([...lotesNuevos([base()], [base({ mensaje_id: id(51) })])], [id(1)]);
  assert.equal(lotesNuevos([base()], [base()]).size, 0); assert.equal(lotesNuevos(null, [base()]).size, 0);
  // Tres cultivos: platano (fisico + 5 simulados), yuca y hortalizas (6 simulados cada uno).
  const otro = (n: number) => '00000000-0000-4000-8000-' + String(900 + n).padStart(12, '0');
  const filas = [base({ nodo_id: id(100), codigo: 'agv-dht22-01', simulado: false, origen: 'real', cultivo_nombre: 'Lote Plátano' }),
    ...Array.from({ length: 5 }, (_, i) => base({ nodo_id: id(i + 1), codigo: 'agv-sim-0' + (i + 1), cultivo_nombre: 'Lote Plátano' })),
    ...Array.from({ length: 6 }, (_, i) => base({ nodo_id: id(i + 6), codigo: 'agv-sim-' + String(i + 6).padStart(2, '0'), cultivo_id: otro(1), cultivo_nombre: 'Simulado · Yuca' })),
    ...Array.from({ length: 6 }, (_, i) => base({ nodo_id: id(i + 12), codigo: 'agv-sim-' + String(i + 12), cultivo_id: otro(2), cultivo_nombre: 'Simulado · Hortalizas' })),
    base({ nodo_id: id(99), codigo: 'agv-sim-99', cultivo_id: null, cultivo_nombre: null })];
  const panal = panalRed(filas);
  assert.deepEqual(panal.grupos.map(g => g.nodos.length), [6, 6, 6, 1]);
  assert.equal(panal.grupos[0]!.cultivo_id, crop, 'el cultivo con nodo fisico va primero');
  assert.equal(panal.grupos.at(-1)!.nombre, 'Sin cultivo asignado');
  assert.equal(panal.grupos[0]!.nodos[0]!.codigo, 'agv-dht22-01', 'el fisico ocupa el primer vertice');
  for (const g of panal.grupos.slice(0, 3)) {
    const vs = g.nodos.map(n => panal.posiciones.get(n.nodo_id)!);
    for (const v of vs) assert.ok(Math.abs(Math.hypot(v.x - g.x, v.z - g.z) - RADIO_HEXAGONO) < 0.01, 'cada nodo en un vertice de su hexagono');
    for (let i = 0; i < 6; i++) { const p = vs[i]!, q = vs[(i + 1) % 6]!; assert.ok(Math.abs(Math.hypot(p.x - q.x, p.z - q.z) - RADIO_HEXAGONO) < 0.01, 'lado = radio'); }
  }
  assert.ok(panal.posiciones.get(id(100))!.fisico && panal.posiciones.get(id(100))!.z < panal.grupos[0]!.z, 'el fisico arriba del hexagono');
  // Hexagonos lado a lado sin superponerse.
  for (let i = 0; i < panal.grupos.length; i++) for (let j = i + 1; j < panal.grupos.length; j++) {
    const g = panal.grupos[i]!, h = panal.grupos[j]!; assert.ok(Math.hypot(g.x - h.x, g.z - h.z) > 2 * (RADIO_HEXAGONO + 1.2) - 0.01);
  }
  assert.ok(panal.semiAncho > RADIO_HEXAGONO * 2 && panal.semiFondo > RADIO_HEXAGONO);
  const urls: URL[] = [];
  assert.equal((await cargarEstadoRed(cliente(() => filas, urls))).length, 19);
  assert.ok(urls[0]!.pathname.endsWith('/rpc/estado_red_nodos'));
  await assert.rejects(cargarEstadoRed(cliente(() => [base({ origen: 'real' })])), /inconsistente/);
});

test('historial frente a la plantilla: porcentajes en optimo y fuera de limites, y tendencia', () => {
  const plantilla = { nombre: 'Plátano', temperatura_min: 18, temperatura_max: 35, temperatura_optima_min: 25, temperatura_optima_max: 30,
    humedad_min: 60, humedad_max: 95, humedad_optima_min: 70, humedad_optima_max: 85 };
  assert.equal(rangoPlantilla(plantilla, 'iluminacion_relativa'), null); assert.equal(rangoPlantilla(null, 'temperatura_aire'), null);
  const r = rangoPlantilla(plantilla, 'temperatura_aire')!;
  assert.deepEqual([r.optimoMin, r.optimoMax, r.minimo, r.maximo], [25, 30, 18, 35]);
  assert.deepEqual(rangoPlantilla(plantilla, 'humedad_aire')!.minimo, 60);
  const fila = (valor: number, i: number): Medicion => ({ id: id(i), cultivo_id: crop, nodo_id: node, mensaje_id: id(i), variable_codigo: 'temperatura_aire', valor,
    tomada_en: new Date(Date.UTC(2026, 10, 4, 12, i)).toISOString(), recibida_en: new Date(Date.UTC(2026, 10, 4, 12, i)).toISOString(), origen: 'simulado' });
  const valores = [26, 27, 28, 29, 31, 33, 34, 36, 37, 17];
  const c = compararConPlantilla(valores.map(fila), r);
  assert.deepEqual(c, { enOptimo: 40, sobreMaximo: 20, bajoMinimo: 10, entreOptimoYLimite: 30 });
  const sube = tendenciaHistorial([26, 26.2, 26.5, 27, 28, 29, 30, 31.5].map(fila), 'temperatura_aire');
  assert.equal(sube.direccion, 'sube'); assert.ok(sube.cambio! > 4);
  assert.equal(tendenciaHistorial([70, 70.5, 70, 69.8, 70.2, 70, 70.1, 69.9].map(fila), 'humedad_aire').direccion, 'estable');
  assert.equal(tendenciaHistorial([30, 29, 28, 26, 25, 24].map(fila), 'temperatura_aire').direccion, 'baja');
  assert.equal(tendenciaHistorial([30, 29].map(fila), 'temperatura_aire').direccion, 'insuficiente');
});

test('contexto: sin la 0009 (columna plantilla_codigo ausente) carga cultivos sin plantilla; tipo_nodo define simulado', async () => {
  const urls: URL[] = [];
  const c = createClient('https://fixture.supabase.co', 'sb_publishable_ficticia', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async input => {
    const u = new URL(String(input)); urls.push(u); const n = u.pathname.split('/').at(-1);
    const r = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
    if (n === 'cultivos' && u.searchParams.get('select')?.includes('plantilla_codigo')) return r({ code: '42703', message: 'column cultivos.plantilla_codigo does not exist' }, 400);
    if (n === 'cultivos') return r([{ id: crop, nombre: 'Lote', tipo: 'Plátano', area: 1, unidad_area: 'ha', archivado_en: null }]);
    if (n === 'perfiles') return r({ nombre: 'Cuenta' });
    if (n === 'nodos') return r([{ id: node, codigo: 'agv-dht22-01', cultivo_id: crop, habilitado: true, tipo_nodo: 'fisico' }, { id: id(2), codigo: 'sim-abc123def456-01', cultivo_id: crop, habilitado: true, tipo_nodo: 'virtual' }]);
    return r([]);
  } } });
  const ctx = await cargarContexto(c, '11111111-1111-4111-8111-111111111111');
  assert.equal(ctx.cultivos.length, 1); assert.equal(ctx.cultivos[0]!.plantilla_codigo, undefined);
  assert.deepEqual(ctx.nodos.map(n => n.simulado), [false, true]);
  // Tres intentos: con medidas del terreno (0012), solo con plantilla (0009) y sin columnas nuevas.
  assert.equal(urls.filter(u => u.pathname.endsWith('/cultivos')).length, 3);
});

test('conexion por dispositivo: ventana de tres intervalos, pausa y tonos verde, naranja y gris', () => {
  const ahora = Date.parse('2026-11-14T15:00:00Z');
  const nodo = (segundos: number, extra: Partial<EstadoNodoRed> = {}): EstadoNodoRed => ({ nodo_id: id(1), codigo: 'sim-abc-01', simulado: true, habilitado: true, cultivo_id: crop, cultivo_nombre: 'Yuca',
    plantilla_codigo: 'yuca', origen: 'simulado', mensaje_id: id(50), tomada_en: new Date(ahora - segundos * 1000).toISOString(), recibida_en: new Date(ahora - segundos * 1000 + 500).toISOString(),
    temperatura: 30, humedad: 70, iluminacion: 40, intervalo_segundos: 30, ...extra });
  assert.equal(ventanaConexionMs({ intervalo_segundos: 30 }), 90_000); assert.equal(ventanaConexionMs({ intervalo_segundos: 120 }), 360_000);
  assert.equal(ventanaConexionMs({}), 180_000, 'sin intervalo conocido: 180 s');
  assert.equal(estadoConexion(nodo(80), ahora), 'conectado'); assert.equal(estadoConexion(nodo(100), ahora), 'antiguo');
  assert.equal(estadoConexion(nodo(300, { intervalo_segundos: 120 }), ahora), 'conectado', 'un equipo lento tiene una ventana mayor');
  assert.equal(estadoConexion(nodo(10, { recepcion_pausada: true }), ahora), 'pausado');
  assert.equal(estadoConexion(nodo(10, { recepcion_pausada: true, habilitado: false }), ahora), 'deshabilitado');
  assert.deepEqual(['conectado', 'antiguo', 'sin_datos', 'reloj', 'pausado', 'deshabilitado', 'sin_cultivo'].map(c => tonoConexion(c as Parameters<typeof tonoConexion>[0])),
    ['recibe', 'no_recibe', 'no_recibe', 'no_recibe', 'inactivo', 'inactivo', 'inactivo']);
});

test('parametros del cultivo: el formulario acepta coma decimal y rechaza orden, limites y precision', () => {
  const base = { temperatura_min: '18', temperatura_optima_min: '25', temperatura_optima_max: '29,5', temperatura_max: '35',
    humedad_min: '40', humedad_optima_min: '60', humedad_optima_max: '80', humedad_max: '90',
    suelo_vwc_min: '15', suelo_vwc_optima_min: '20', suelo_vwc_optima_max: '30', suelo_vwc_max: '40' };
  const r = validarRangos(base);
  assert.equal(Object.keys(r).length, 12); assert.equal(r.temperatura_optima_max, 29.5); assert.deepEqual(Object.keys(r).sort(), [...CAMPOS_RANGOS].sort());
  assert.equal(validarRangos({ ...base, temperatura_min: '25' }).temperatura_min, 25, 'el limite puede coincidir con el borde del optimo');
  for (const [campo, valor, patron] of [['temperatura_max', '20', /Temperatura del aire: el orden/], ['humedad_max', '101', /entre 0 y 100/], ['suelo_vwc_min', '15,25', /un decimal/],
    ['humedad_min', '', /Humedad del aire/], ['suelo_vwc_optima_min', '30', /Humedad del suelo: el orden/], ['temperatura_min', 'abc', /números/]] as const)
    assert.throws(() => validarRangos({ ...base, [campo]: valor }), patron, campo);
});

test('acciones del escenario: clima, pausa y dispositivo validan la respuesta antes de dar por hecho el cambio', async () => {
  const cuerpos: Record<string, unknown>[] = [];
  const c = cliente((u, b) => { const n = u.pathname.split('/').at(-1); cuerpos.push({ n, ...(b as object) });
    if (n === 'establecer_clima') return { codigo: 'CLIMA_ESTABLECIDO', evento: (b as { p_evento: string }).p_evento, cultivos_cambiados: 2 };
    if (n === 'pausar_nodo') return { id: node, recepcion_pausada: (b as { p_pausar: boolean }).p_pausar };
    if (n === 'configurar_dispositivo') return { id: node, tipo_dispositivo: 'esp32' };
    return null; });
  assert.equal(await establecerClima(c, crop, 'lluvia', 3, true), 2);
  assert.deepEqual(cuerpos.at(-1), { n: 'establecer_clima', p_cultivo_id: crop, p_evento: 'lluvia', p_intensidad: 3, p_todos: true });
  await assert.rejects(establecerClima(c, crop, 'lluvia', 5, false), /evento y una intensidad/);
  await pausarNodo(c, node, true); assert.equal(cuerpos.at(-1)!.p_pausar, true);
  await configurarDispositivo(c, node, 'esp32', null, null); assert.deepEqual([cuerpos.at(-1)!.p_protocolo, cuerpos.at(-1)!.p_intervalo], [null, null]);
  await assert.rejects(configurarDispositivo(c, node, 'esp32', 'mqtt_wifi', 5), /10 a 3600/);
  await assert.rejects(configurarDispositivo(c, node, 'arduino_uno', null, null), /No pudimos confirmar/, 'la base respondio otro tipo');
  const otro = cliente(() => ({ id: node, recepcion_pausada: false }));
  await assert.rejects(pausarNodo(otro, node, true), /No pudimos confirmar/);
});
