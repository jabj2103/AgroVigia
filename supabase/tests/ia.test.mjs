// Pruebas locales de 0009 (plantillas, sugerencias IA y red) sobre las zonas y la ingesta v3 de 0007/0008,
// en PGlite (PostgreSQL en memoria). No es Supabase remoto, ni JWT/HTTP real. Todos los datos son ficticios.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { crearZonas, crearCaptura, editarValor } from '../../simulador/public/motor.mjs';
import { prepararCapturaV3 } from '../../simulador/contrato-v3.mjs';
const db = new PGlite();
const owner = '3611e8b0-13ba-45ec-a66f-b066315a7341';
const other = 'f11baaf9-0461-4b73-94d6-d8eff18c6fa8';
const crop = '52ea4628-c470-48f4-a09a-0f9a697d22b4';
const sql = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const one = async (q, p = []) => (await db.query(q, p)).rows[0];
before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;`);
  await db.query('INSERT INTO auth.users VALUES ($1),($2)', [owner, other]);
  await db.exec(sql('migrations/202610260001_base_recepcion.sql'));
  await db.exec(sql('migrations/202610260002_ingesta_dht22.sql'));
  await db.query('INSERT INTO public.perfiles (id,nombre) VALUES ($1,$2),($3,$4)', [owner, 'Fixture', other, 'Otra cuenta']);
  await db.query(`INSERT INTO public.cultivos (id,agricultor_id,nombre,tipo,area,unidad_area,solicitud_id)
    VALUES ($1,$2,'Fixture','Demostracion',1,'m2','b8aff795-b68e-4559-99c8-e596d567e677')`, [crop, owner]);
  await db.exec(sql('provisionar-demo.sql'));
  await db.exec(sql('migrations/202610260003_ingesta_ambiental.sql'));
  await db.exec(sql('habilitar-ldr-nodo.sql'));
  for (const m of ['202610270004_gestion_cultivos', '202610270005_gestion_nodos', '202610270006_alertas',
    '202611030007_zonas_y_nodos_virtuales', '202611030008_ingesta_simulada_v3', '202611030009_cultivos_clima_dispositivos', '202611030010_ia_red_simulacion',
    '202611030011_simulacion_manual_y_solicitudes', '202611030012_terreno_sectores_nodos_fisicos']) // la 0011 sustituye reservar_sugerencia_ia, estado_simulacion y estado_red_nodos: estas pruebas son su regresion
    await db.exec(sql('migrations/' + m + '.sql'));
  // Estado remoto reportado por Juan: cuatro sectores y cuatro nodos virtuales en el cultivo del fisico.
  await db.exec(sql('provisionar-simulacion.sql').replace('p_cultivo_id uuid := NULL;', `p_cultivo_id uuid := '${crop}';`));
  await db.exec(sql('provisionar-hexagonos.sql'));
});
after(async () => { await db.close(); });

const ahoraIso = (segundos = 0) => new Date(Date.now() - segundos * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
async function comoServidor(fn) { await db.exec('SET ROLE service_role'); try { return await fn(); } finally { await db.exec('RESET ROLE'); } }
async function comoUsuario(uid, fn) {
  await db.exec('SET ROLE authenticated');
  try { await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [uid]); return await fn(); }
  finally { await db.query("SELECT set_config('request.jwt.claim.sub','',false)"); await db.exec('RESET ROLE'); }
}
const nodo = async codigo => one('SELECT * FROM public.nodos WHERE codigo=$1', [codigo]);
const virtuales = async cultivo => (await db.query("SELECT codigo FROM public.nodos WHERE cultivo_id=$1 AND tipo_nodo='virtual' ORDER BY codigo", [cultivo])).rows.map(r => r.codigo);
const cultivoDe = async plantilla => (await one('SELECT id FROM public.cultivos WHERE plantilla_codigo=$1 ORDER BY creado_en LIMIT 1', [plantilla])).id;
// Lote v3 de diez variables con el motor y el contrato de Juan; valores ajustados a mano.
async function loteV3(codigo, valores = {}) {
  const n = await nodo(codigo);
  let punto = crearZonas()[0];
  for (const [k, v] of Object.entries(valores)) punto = editarValor(punto, k, v);
  const local = crearCaptura(punto, { ejecucion: randomUUID() });
  return prepararCapturaV3(local, { nodo_local: local.nodo_codigo, nodo_codigo: codigo, asignacion_version: n.asignacion_version });
}
const ingerirV3 = p => comoServidor(async () => (await one(
  'SELECT public.registrar_lote_simulado_v3($1,$2,clock_timestamp(),true,NULL,true) AS r', [p.topico, p.mensaje])).r);
function payloadReal(t = 28, h = 70, adc = 2048) {
  return { version: 2, nodo_codigo: 'agv-dht22-01', mensaje_id: randomUUID(), origen: 'real', tomada_en: ahoraIso(),
    ldr: { metodo: 'adc12_10k_11db_v1', adc_promedio: adc },
    mediciones: [
      { variable_codigo: 'temperatura_aire', valor: t, unidad: '°C' },
      { variable_codigo: 'humedad_aire', valor: h, unidad: '% HR' },
      { variable_codigo: 'iluminacion_relativa', valor: Math.round(adc * 1000 / 4095) / 10, unidad: '% relativo' },
    ] };
}
const ingerirReal = p => comoServidor(async () => (await db.query(
  'SELECT public.registrar_lote_ambiental($1,$2,clock_timestamp(),true,NULL,true) AS r',
  ['agrovigia/v2/real/nodos/agv-dht22-01/telemetria', JSON.stringify(p)])).rows[0].r);
const evaluar = async (codigo, mensaje) => comoServidor(async () => (await one('SELECT public.evaluar_alertas_lote($1,$2) AS r', [(await nodo(codigo)).id, mensaje])).r);
const reservar = async (codigo, mensaje) => comoServidor(async () => (await one('SELECT public.reservar_sugerencia_ia($1,$2) AS r', [(await nodo(codigo)).id, mensaje])).r);
const completar = (id, respuesta, error = null) => comoServidor(async () => (await one(
  'SELECT public.completar_sugerencia_ia($1,$2,$3,$4,$5,$6) AS r', [id, respuesta === null ? null : JSON.stringify(respuesta), 'gemini-3.5-flash-lite', 900, 300, error])).r);
const respuestaValida = () => ({
  resumen: 'Temperatura sobre el límite de la plantilla y suelo seco en la última hora.', estado_general: 'atencion',
  recomendaciones: [{ titulo: 'Revisar riego', accion: 'Comprobar el riego del sector norte.', prioridad: 'alta', variable: 'humedad_suelo_vwc', evidencia: 'Humedad del suelo 18 % VWC frente a un mínimo de 25 %.' }],
  riego: 'El suelo simulado está bajo el rango de la plantilla.', luz: 'Índice relativo alto de día; no equivale a lux.', limitaciones: 'Datos simulados.',
});
async function envejecerSugerencias(cultivoId, minutos) {
  await db.exec('ALTER TABLE public.sugerencias_ia DISABLE TRIGGER sugerencia_inmutable');
  try { await db.query(`UPDATE public.sugerencias_ia SET solicitada_en=solicitada_en-make_interval(mins=>$2),
      completada_en=CASE WHEN completada_en IS NULL THEN NULL ELSE completada_en-make_interval(mins=>$2) END WHERE cultivo_id=$1`, [cultivoId, minutos]); }
  finally { await db.exec('ALTER TABLE public.sugerencias_ia ENABLE TRIGGER sugerencia_inmutable'); }
  await db.query('UPDATE public.alertas SET abierta_en=abierta_en-make_interval(mins=>$2) WHERE cultivo_id=$1', [cultivoId, minutos]);
}
const prefijo = id => 'sim-' + id.replaceAll('-', '').slice(0, 12) + '-';

test('hexagonos: platano reutiliza los 4 virtuales de Juan + 1; yuca y hortalizas con 6; idempotente y real intacto', async () => {
  const resumen = async () => (await db.query(`SELECT c.id, c.plantilla_codigo, count(n.id)::int nodos,
      count(n.id) FILTER (WHERE n.tipo_nodo='virtual')::int virtuales,
      (SELECT count(*)::int FROM public.zonas z WHERE z.cultivo_id=c.id) sectores,
      (SELECT count(*)::int FROM public.reglas_alerta r WHERE r.cultivo_id=c.id AND r.origen='simulado' AND r.habilitada) reglas
    FROM public.cultivos c JOIN public.nodos n ON n.cultivo_id=c.id GROUP BY c.id ORDER BY min(n.codigo)`)).rows;
  const antes = await resumen();
  assert.deepEqual(antes.map(f => [f.plantilla_codigo, f.nodos, f.virtuales, f.sectores, f.reglas]).sort(),
    [['hortalizas', 6, 6, 4, 3], ['platano', 6, 5, 4, 3], ['yuca', 6, 6, 4, 3]]);
  const platano = await virtuales(crop);
  assert.deepEqual(platano, [1, 2, 3, 4, 5].map(i => prefijo(crop) + '0' + i), 'los 4 de provisionar-simulacion.sql se conservan');
  for (const plantilla of ['yuca', 'hortalizas']) { const c = await cultivoDe(plantilla); assert.equal((await virtuales(c)).length, 6); assert.ok((await virtuales(c)).every(x => x.startsWith(prefijo(c)))); }
  assert.equal((await db.query("SELECT count(*)::int n FROM public.nodo_variables v JOIN public.nodos n ON n.id=v.nodo_id WHERE n.tipo_nodo='virtual' AND v.sensor_modelo='SIMULADOR_V3'")).rows[0].n, 170);
  await db.exec(sql('provisionar-hexagonos.sql'));
  assert.deepEqual(await resumen(), antes);
  assert.deepEqual(await one("SELECT cultivo_id,tipo_nodo,zona_id FROM public.nodos WHERE codigo='agv-dht22-01'"), { cultivo_id: crop, tipo_nodo: 'fisico', zona_id: null });
  assert.equal((await one("SELECT count(*)::int n FROM public.reglas_alerta WHERE cultivo_id=$1 AND origen='real'", [crop])).n, 0);
  assert.equal((await one('SELECT plantilla_codigo FROM public.cultivos WHERE id=$1', [crop])).plantilla_codigo, 'platano');
  const suelo = await one("SELECT minimo::float8 mn, maximo::float8 mx FROM public.reglas_alerta WHERE cultivo_id=$1 AND variable_codigo='humedad_suelo_vwc' AND habilitada", [crop]);
  assert.deepEqual(suelo, { mn: 25, mx: 50 });
});

test('plantillas: reglas del aire por origen; la del suelo solo con origen simulado; validacion y permisos', async () => {
  const yuca = await cultivoDe('yuca');
  await assert.rejects(comoUsuario(other, () => db.query("SELECT public.aplicar_plantilla_cultivo($1,'yuca')", [crop])), /CULTIVO_NO_AUTORIZADO/);
  await assert.rejects(comoUsuario(owner, () => db.query("SELECT public.aplicar_plantilla_cultivo($1,'cafe')", [crop])), /PLANTILLA_INVALIDA/);
  await comoUsuario(owner, () => db.query("SELECT public.aplicar_plantilla_cultivo($1,'platano',true,'real')", [crop]));
  const reales = (await db.query("SELECT variable_codigo FROM public.reglas_alerta WHERE cultivo_id=$1 AND origen='real' AND habilitada ORDER BY 1", [crop])).rows.map(r => r.variable_codigo);
  assert.deepEqual(reales, ['humedad_aire', 'temperatura_aire'], 'el fisico no mide suelo: sin regla real de suelo');
  // Cambiar la plantilla de yuca a mango con origen simulado sustituye las tres reglas simuladas.
  await comoUsuario(owner, () => db.query("SELECT public.aplicar_plantilla_cultivo($1,'mango',true,'simulado')", [yuca]));
  const suelo = await one("SELECT minimo::float8 mn, maximo::float8 mx FROM public.reglas_alerta WHERE cultivo_id=$1 AND variable_codigo='humedad_suelo_vwc' AND habilitada", [yuca]);
  assert.deepEqual(suelo, { mn: 12, mx: 40 });
  assert.equal((await one("SELECT count(*)::int n FROM public.reglas_alerta WHERE cultivo_id=$1 AND origen='simulado' AND habilitada", [yuca])).n, 3);
  await comoUsuario(owner, () => db.query("SELECT public.aplicar_plantilla_cultivo($1,'yuca',true,'simulado')", [yuca]));
  assert.equal((await one("SELECT count(*)::int n FROM public.reglas_alerta WHERE cultivo_id=$1 AND origen='simulado' AND habilitada", [yuca])).n, 3);
  assert.equal((await one("SELECT has_function_privilege('authenticated','public.configurar_regla_suelo(uuid,numeric,numeric)','EXECUTE') a")).a, false);
  await assert.rejects(comoUsuario(owner, () => db.query('UPDATE public.cultivo_plantillas SET temperatura_max=50')), /permission denied/);
  // Las reglas reales de prueba se retiran para no afectar las pruebas siguientes.
  await db.query("UPDATE public.reglas_alerta SET habilitada=false,desactivada_en=now() WHERE cultivo_id=$1 AND origen='real'", [crop]);
});

test('IA: lote v3 de un virtual abre alerta de suelo y reserva con contexto de 10 variables, sin el fisico', async () => {
  const codigo = prefijo(crop) + '02';
  const p = await loteV3(codigo, { temperatura_aire: 37, humedad_suelo_vwc: 18 });
  const g = await ingerirV3(p);
  assert.equal(g.estado, 'insertado', JSON.stringify(g));
  const ev = await evaluar(codigo, p.payload.mensaje_id);
  assert.equal(ev.abiertas, 2, 'temperatura sobre 35 y suelo bajo 25');
  const r = await reservar(codigo, p.payload.mensaje_id);
  assert.equal(r.codigo, 'RESERVADA'); assert.equal(r.motivo, 'alerta');
  const ctx = r.contexto;
  assert.equal(ctx.origen_datos, 'simulado'); assert.equal(ctx.plantilla.codigo, 'platano'); assert.equal(ctx.plantilla.suelo_vwc_min, 25);
  assert.deepEqual(ctx.nodos.map(x => x.codigo), await virtuales(crop), 'solo los virtuales del hexagono, nunca agv-dht22-01');
  const propio = ctx.nodos.find(x => x.codigo === codigo);
  assert.equal(propio.tipo_nodo, 'virtual'); assert.equal(propio.zona, 'Sector sur');
  assert.equal(Object.keys(propio.valores).length, 10); assert.equal(Number(propio.valores.humedad_suelo_vwc), 18);
  assert.equal(ctx.sensores.tipo_nodo, 'virtual'); assert.equal(Object.keys(ctx.sensores.variables).length, 10);
  assert.deepEqual(ctx.sensores.sin_sensor_de, ['radiacion en lux']);
  assert.equal(ctx.alertas_abiertas.length, 2);
  assert.equal((await one('SELECT count(*)::int n FROM public.sugerencia_mediciones WHERE sugerencia_id=$1', [r.sugerencia_id])).n, 10);
  assert.equal((await reservar(codigo, p.payload.mensaje_id)).codigo, 'SUGERENCIA_EN_CURSO');
  // Mismo cultivo, lote real v2 del fisico: reserva aparte, contexto solo del fisico, sin suelo.
  const pr = payloadReal(30, 75); assert.equal((await ingerirReal(pr)).estado, 'insertado');
  const rr = await reservar('agv-dht22-01', pr.mensaje_id);
  assert.equal(rr.codigo, 'RESERVADA'); assert.equal(rr.contexto.origen_datos, 'real');
  assert.deepEqual(rr.contexto.nodos.map(x => x.codigo), ['agv-dht22-01']);
  assert.ok(rr.contexto.sensores.sin_sensor_de.includes('humedad del suelo')); assert.equal(rr.contexto.sensores.tipo_nodo, 'fisico');
  assert.equal((await completar(rr.sugerencia_id, respuestaValida())).codigo, 'SUGERENCIA_GUARDADA');
  assert.equal((await completar(r.sugerencia_id, respuestaValida())).codigo, 'SUGERENCIA_GUARDADA');
  assert.equal((await completar(r.sugerencia_id, respuestaValida())).codigo, 'SUGERENCIA_YA_COMPLETADA');
  // Intervalo: no corresponde enseguida; pasados 31 min corresponde una periodica.
  const p2 = await loteV3(codigo, { temperatura_aire: 37.5, humedad_suelo_vwc: 18 }); await ingerirV3(p2); await evaluar(codigo, p2.payload.mensaje_id);
  assert.equal((await reservar(codigo, p2.payload.mensaje_id)).codigo, 'NO_CORRESPONDE');
  await envejecerSugerencias(crop, 31);
  const r3 = await reservar(codigo, p2.payload.mensaje_id);
  assert.equal(r3.codigo, 'RESERVADA'); assert.equal(r3.motivo, 'periodica');
  await envejecerSugerencias(crop, 4);
  const p3 = await loteV3(codigo); await ingerirV3(p3);
  assert.equal((await reservar(codigo, p3.payload.mensaje_id)).codigo, 'NO_CORRESPONDE');
  assert.deepEqual(await one('SELECT estado,error_codigo FROM public.sugerencias_ia WHERE id=$1', [r3.sugerencia_id]), { estado: 'fallida', error_codigo: 'SIN_RESPUESTA' });
  await assert.rejects(db.query("UPDATE public.sugerencias_ia SET respuesta='{}' WHERE id=$1", [r.sugerencia_id]), /SUGERENCIA_INMUTABLE/);
});

test('servicio de simulacion: la RPC v3 acepta sus lotes virtuales y la v2 la proyeccion simulada del fisico', async () => {
  const { loteVirtual, loteProyeccion, faseClima, leerEstado } = await import('../../simulador/clima-modelo.mjs');
  const estado = leerEstado(await comoServidor(async () => (await one('SELECT public.estado_simulacion() AS r')).r));
  assert.equal(estado.length, 3);
  const ahora = new Date(), hace = s => new Date(ahora.getTime() - s * 1000).toISOString();
  const fases = [faseClima(null, null, ahora.getTime()), faseClima({ evento: 'lluvia', intensidad: 3, iniciado_en: hace(300) }, null, ahora.getTime()),
    faseClima({ evento: 'tierra_seca', intensidad: 2, iniciado_en: hace(40) }, null, ahora.getTime()),
    faseClima(null, { evento: 'viento', intensidad: 1, iniciado_en: hace(600), finalizado_en: hace(30) }, ahora.getTime())];
  for (const c of estado) {
    const n = c.nodos.filter(x => x.tipo_nodo === 'virtual').at(-1);
    for (const fase of fases) {
      const r = await ingerirV3(loteVirtual(n, c.parametros, fase, new Date(), { ejecucion: randomUUID() }));
      assert.equal(r.estado, 'insertado', c.nombre + ' ' + fase.fase + ' ' + JSON.stringify(r));
    }
  }
  // Proyeccion del fisico: lote v2 de origen simulado para el mismo codigo; la lectura real queda intacta.
  const real = payloadReal(30.2, 68, 2400); assert.equal((await ingerirReal(real)).estado, 'insertado');
  const fisico = { codigo: 'agv-dht22-01', tipo_nodo: 'fisico', ultima_real: { temperatura: 30.2, humedad: 68, adc: 2400 } };
  const proy = loteProyeccion(fisico, fases[1], new Date());
  const g = await comoServidor(async () => (await one('SELECT public.registrar_lote_ambiental($1,$2,clock_timestamp(),true,NULL,true) AS r', [proy.topico, proy.mensaje])).r);
  assert.equal(g.estado, 'insertado', JSON.stringify(g));
  const filas = (await db.query("SELECT origen, valor::float8 v FROM public.mediciones WHERE nodo_id=$1 AND variable_codigo='temperatura_aire' AND mensaje_id IN ($2,$3) ORDER BY origen",
    [(await nodo('agv-dht22-01')).id, real.mensaje_id, proy.payload.mensaje_id])).rows;
  assert.deepEqual(filas, [{ origen: 'real', v: 30.2 }, { origen: 'simulado', v: 25.7 }]);
});

test('IA: respuestas invalidas quedan como fallidas; variables nuevas del suelo se aceptan', async () => {
  const yuca = await cultivoDe('yuca'), codigo = prefijo(yuca) + '01';
  const invalidas = [
    { ...respuestaValida(), extra: 'x' },
    { ...respuestaValida(), estado_general: 'excelente' },
    { ...respuestaValida(), resumen: '<script>alert(1)</script>' },
    { ...respuestaValida(), recomendaciones: [] },
    { ...respuestaValida(), recomendaciones: [{ ...respuestaValida().recomendaciones[0], variable: 'humedad_hoja' }] },
    ['no', 'objeto'],
  ];
  for (const respuesta of invalidas) {
    await envejecerSugerencias(yuca, 11);
    const p = await loteV3(codigo); await ingerirV3(p);
    const r = await reservar(codigo, p.payload.mensaje_id);
    assert.equal(r.codigo, 'RESERVADA', JSON.stringify(respuesta).slice(0, 60));
    assert.equal(r.contexto.plantilla.codigo, 'yuca'); assert.equal(r.contexto.nodos.length, 6);
    const c = await completar(r.sugerencia_id, respuesta);
    assert.deepEqual([c.codigo, c.error_codigo], ['SUGERENCIA_FALLIDA', 'RESPUESTA_INVALIDA']);
  }
  for (const variable of ['ph_suelo', 'precipitacion_60min', 'general']) {
    await envejecerSugerencias(yuca, 31); // tras una sugerencia generada la siguiente periodica es a los 30 min
    const p = await loteV3(codigo); await ingerirV3(p);
    const r = await reservar(codigo, p.payload.mensaje_id);
    const ok = { ...respuestaValida(), recomendaciones: [{ ...respuestaValida().recomendaciones[0], variable }] };
    assert.equal((await completar(r.sugerencia_id, ok)).codigo, 'SUGERENCIA_GUARDADA', variable);
  }
});

test('IA: topes diarios por origen; el cupo simulado no bloquea al fisico del mismo cultivo', async () => {
  const llenar = (cultivo, origen) => db.query(`INSERT INTO public.sugerencias_ia (cultivo_id,origen,motivo,estado,contexto,error_codigo,completada_en,solicitada_en)
    SELECT $1,$2,'periodica','fallida','{}','PRUEBA',now()-interval '20 hours',now()-interval '20 hours' FROM generate_series(1,60)`, [cultivo, origen]);
  const hort = await cultivoDe('hortalizas'), codigo = prefijo(hort) + '03';
  await llenar(hort, 'simulado');
  const p = await loteV3(codigo); await ingerirV3(p);
  assert.equal((await reservar(codigo, p.payload.mensaje_id)).codigo, 'LIMITE_DIARIO_CULTIVO');
  await llenar(crop, 'simulado');
  const s = await loteV3(prefijo(crop) + '01'); await ingerirV3(s);
  assert.equal((await reservar(prefijo(crop) + '01', s.payload.mensaje_id)).codigo, 'LIMITE_DIARIO_CULTIVO');
  const pr = payloadReal(); await ingerirReal(pr);
  assert.notEqual((await reservar('agv-dht22-01', pr.mensaje_id)).codigo, 'LIMITE_DIARIO_CULTIVO');
});

test('IA: permisos y RLS; la web solo lee lo propio y no ejecuta RPC de servidor', async () => {
  for (const f of ['reservar_sugerencia_ia(uuid,text)', 'completar_sugerencia_ia(uuid,jsonb,text,integer,integer,text)']) {
    assert.equal((await one(`SELECT has_function_privilege('authenticated','public.${f}','EXECUTE') a`)).a, false);
    assert.equal((await one(`SELECT has_function_privilege('service_role','public.${f}','EXECUTE') s`)).s, true);
  }
  assert.equal((await one("SELECT has_function_privilege('anon','public.estado_red_nodos()','EXECUTE') n")).n, false);
  assert.ok(await comoUsuario(owner, async () => (await one('SELECT count(*)::int n FROM public.sugerencias_ia')).n) > 0);
  assert.equal(await comoUsuario(other, async () => (await one('SELECT count(*)::int n FROM public.sugerencias_ia')).n), 0);
  assert.equal(await comoUsuario(other, async () => (await one('SELECT count(*)::int n FROM public.sugerencia_mediciones')).n), 0);
  await assert.rejects(comoUsuario(owner, () => db.query("INSERT INTO public.sugerencias_ia (cultivo_id,origen,motivo,contexto) VALUES ($1,'real','periodica','{}')", [crop])), /permission denied/);
  assert.equal(await comoUsuario(other, async () => (await one('SELECT count(*)::int n FROM public.cultivo_plantillas')).n), 6);
});

test('red: 18 nodos en tres hexagonos, con sector, origen por tipo y humedad del suelo de los virtuales', async () => {
  const filas = await comoUsuario(owner, async () => (await db.query('SELECT codigo,simulado,origen,cultivo_id,zona_nombre,humedad_suelo::float8 hs FROM public.estado_red_nodos()')).rows);
  assert.equal(filas.length, 18); assert.equal(filas[0].codigo, 'agv-dht22-01'); assert.equal(filas[0].simulado, false);
  assert.equal(filas[0].origen, 'real'); assert.equal(filas[0].zona_nombre, null); assert.equal(filas[0].hs, null);
  assert.ok(filas.filter(f => f.simulado && f.origen).every(f => f.origen === 'simulado' && f.zona_nombre));
  assert.equal(filas.find(f => f.codigo === prefijo(crop) + '02').hs, crearZonas()[0].valores.humedad_suelo_vwc, 'ultimo lote v3 de ese nodo');
  const grupos = Object.values(Object.groupBy(filas, f => f.cultivo_id)).map(g => g.length);
  assert.deepEqual(grupos, [6, 6, 6]);
  assert.equal(await comoUsuario(other, async () => (await db.query('SELECT * FROM public.estado_red_nodos()')).rows.length), 0);
});

test('regresion: pruebas previas de alertas, nodos, cultivos e ingesta siguen pasando despues de 0007-0009', async () => {
  for (const f of ['probar-alertas.sql', 'probar-gestion-nodos.sql', 'probar-gestion-cultivos.sql'])
    assert.match((await db.exec(sql(f))).at(-1).rows[0].resultado, /^OK:/, f);
  assert.equal((await db.exec(sql('probar-ingesta-ambiental.sql'))).at(-1).rows.length, 6);
});

test('verificar-ia-hexagonos.sql: todas las columnas true en el estado aprovisionado', async () => {
  const fila = (await db.exec(sql('verificar-ia-hexagonos.sql'))).at(-1).rows[0];
  for (const [k, v] of Object.entries(fila)) assert.equal(v, true, k);
});

// ---- 0009/0010: parametros por cultivo, clima simulado, dispositivos, pausa, preferencias y estado en vivo ----
const rpcUsuario = (uid, q, p = []) => comoUsuario(uid, async () => (await db.query(q, p)).rows[0]);
const PARAMS = { temperatura_min: 20, temperatura_optima_min: 24, temperatura_optima_max: 28, temperatura_max: 33,
  humedad_min: 45, humedad_optima_min: 55, humedad_optima_max: 75, humedad_max: 88,
  suelo_vwc_min: 18, suelo_vwc_optima_min: 22, suelo_vwc_optima_max: 32, suelo_vwc_max: 42 };
const ajustar = (uid, cultivo, p, reglas = true, origen = 'simulado') => rpcUsuario(uid,
  'SELECT public.ajustar_parametros_cultivo($1,$2,$3,$4) AS r', [cultivo, JSON.stringify(p), reglas, origen]);
const payloadSimFisico = (t, h, adc) => ({ ...payloadReal(t, h, adc), origen: 'simulado' });
const ingerirSimFisico = p => comoServidor(async () => (await db.query(
  'SELECT public.registrar_lote_ambiental($1,$2,clock_timestamp(),true,NULL,true) AS r',
  ['agrovigia/v2/simulado/nodos/agv-dht22-01/telemetria', JSON.stringify(p)])).rows[0].r);

test('parametros por cultivo: ajuste validado, sustituye reglas y contexto IA; restablecer y plantilla lo retiran', async () => {
  const yuca = await cultivoDe('yuca');
  const reglasSim = async () => Object.fromEntries((await db.query(
    "SELECT variable_codigo, minimo::float8 mn, maximo::float8 mx FROM public.reglas_alerta WHERE cultivo_id=$1 AND origen='simulado' AND habilitada", [yuca])).rows.map(r => [r.variable_codigo, [r.mn, r.mx]]));
  await assert.rejects(ajustar(other, yuca, PARAMS), /CULTIVO_NO_AUTORIZADO/);
  for (const malo of [{ ...PARAMS, extra: 1 }, { ...PARAMS, temperatura_min: 30 }, { ...PARAMS, humedad_max: 101 }, { ...PARAMS, suelo_vwc_min: 18.25 },
    { ...PARAMS, temperatura_max: '33' }, (({ suelo_vwc_max, ...r }) => r)(PARAMS)])
    await assert.rejects(ajustar(owner, yuca, malo), /PARAMETROS_INVALIDOS/, JSON.stringify(malo).slice(0, 50));
  const r = (await ajustar(owner, yuca, PARAMS)).r;
  assert.equal(r.ajustada, true); assert.equal(r.codigo, 'yuca'); assert.equal(Number(r.temperatura_max), 33); assert.equal(r.riego_referencia.length > 10, true);
  assert.deepEqual(await reglasSim(), { temperatura_aire: [20, 33], humedad_aire: [45, 88], humedad_suelo_vwc: [18, 42] });
  // Repetir es idempotente; con origen real no crea regla de suelo.
  await ajustar(owner, yuca, PARAMS); assert.equal((await one('SELECT count(*)::int n FROM public.cultivo_parametros WHERE cultivo_id=$1', [yuca])).n, 1);
  await ajustar(owner, yuca, PARAMS, true, 'real');
  assert.equal((await one("SELECT count(*)::int n FROM public.reglas_alerta WHERE cultivo_id=$1 AND origen='real' AND habilitada", [yuca])).n, 2);
  await db.query("UPDATE public.reglas_alerta SET habilitada=false,desactivada_en=now() WHERE cultivo_id=$1 AND origen='real'", [yuca]);
  // La IA recibe los rangos ajustados.
  const codigo = prefijo(yuca) + '02'; await envejecerSugerencias(yuca, 31);
  const p = await loteV3(codigo); await ingerirV3(p);
  const ia = await reservar(codigo, p.payload.mensaje_id);
  assert.equal(ia.codigo, 'RESERVADA'); assert.equal(ia.contexto.plantilla.ajustada, true); assert.equal(Number(ia.contexto.plantilla.suelo_vwc_optima_min), 22);
  assert.equal(ia.contexto.clima_simulado, null);
  await completar(ia.sugerencia_id, respuestaValida());
  // RLS y vuelta a la plantilla.
  assert.equal(await comoUsuario(other, async () => (await one('SELECT count(*)::int n FROM public.cultivo_parametros')).n), 0);
  await assert.rejects(comoUsuario(owner, () => db.query('UPDATE public.cultivo_parametros SET temperatura_max=50')), /permission denied/);
  const vuelta = (await rpcUsuario(owner, 'SELECT public.restablecer_parametros_cultivo($1) AS r', [yuca])).r;
  assert.equal(vuelta.ajustada, false); assert.equal(Number(vuelta.temperatura_max), 35);
  await ajustar(owner, yuca, PARAMS, false);
  await comoUsuario(owner, () => db.query("SELECT public.aplicar_plantilla_cultivo($1,'yuca',true,'simulado')", [yuca]));
  assert.equal((await one('SELECT count(*)::int n FROM public.cultivo_parametros WHERE cultivo_id=$1', [yuca])).n, 0, 'aplicar plantilla retira el ajuste');
  assert.deepEqual((await reglasSim()).humedad_suelo_vwc, [15, 40]);
});

test('clima simulado: un evento activo por cultivo, cambio e idempotencia, todos los cultivos, normal y permisos', async () => {
  const yuca = await cultivoDe('yuca'), hort = await cultivoDe('hortalizas');
  const clima = (uid, c, evento, intensidad = 2, todos = false) => rpcUsuario(uid, 'SELECT public.establecer_clima($1,$2,$3,$4) AS r', [c, evento, intensidad, todos]);
  const activos = async () => (await db.query('SELECT cultivo_id, evento, intensidad::int FROM public.clima_cultivo WHERE finalizado_en IS NULL ORDER BY cultivo_id')).rows;
  await assert.rejects(clima(other, yuca, 'lluvia'), /CULTIVO_NO_AUTORIZADO/);
  for (const [e, i] of [['granizo', 2], ['lluvia', 0], ['lluvia', 4], [null, 2]]) await assert.rejects(clima(owner, yuca, e, i), /CLIMA_INVALIDO/);
  assert.equal((await clima(owner, yuca, 'lluvia', 2)).r.cultivos_cambiados, 1);
  assert.equal((await clima(owner, yuca, 'lluvia', 2)).r.cultivos_cambiados, 0, 'mismo evento e intensidad no cambia nada');
  assert.deepEqual(await activos(), [{ cultivo_id: yuca, evento: 'lluvia', intensidad: 2 }]);
  await clima(owner, yuca, 'lluvia', 3);
  assert.equal((await one('SELECT count(*)::int n FROM public.clima_cultivo WHERE cultivo_id=$1', [yuca])).n, 2, 'el cambio conserva el historial');
  assert.equal((await activos())[0].intensidad, 3);
  // La IA de datos simulados conoce el evento; la de datos reales no.
  const codigo = prefijo(yuca) + '03'; await envejecerSugerencias(yuca, 31);
  const p = await loteV3(codigo, { precipitacion_60min: 40 }); await ingerirV3(p);
  const ia = await reservar(codigo, p.payload.mensaje_id);
  assert.equal(ia.contexto.clima_simulado.evento, 'lluvia'); assert.equal(ia.contexto.clima_simulado.intensidad, 3);
  await completar(ia.sugerencia_id, respuestaValida());
  // Todos los cultivos activos de la cuenta y vuelta a normal.
  assert.equal((await clima(owner, yuca, 'sol_fuerte', 1, true)).r.cultivos_cambiados, 3);
  assert.deepEqual((await activos()).map(a => a.evento), ['sol_fuerte', 'sol_fuerte', 'sol_fuerte']);
  assert.equal(await comoUsuario(other, async () => (await one('SELECT count(*)::int n FROM public.clima_cultivo')).n), 0);
  await assert.rejects(comoUsuario(owner, () => db.query("INSERT INTO public.clima_cultivo (cultivo_id,evento,intensidad,actor_id) VALUES ($1,'viento',1,$2)", [hort, owner])), /permission denied/);
  assert.equal((await clima(owner, hort, 'normal')).r.cultivos_cambiados, 1);
  assert.equal((await activos()).length, 2);
  assert.equal((await clima(owner, yuca, 'normal', 2, true)).r.cultivos_cambiados, 2);
  assert.equal((await activos()).length, 0);
  assert.equal((await clima(owner, yuca, 'normal')).r.cultivos_cambiados, 0);
});

test('dispositivos: catalogo, perfil automatico o manual por nodo y coherencia fisico/virtual', async () => {
  const tipos = (await db.query('SELECT codigo, protocolo_defecto, intervalo_defecto, adc_bits::int, probado FROM public.tipos_dispositivo ORDER BY codigo')).rows;
  assert.deepEqual(tipos.map(t => t.codigo), ['arduino_uno', 'esp32', 'raspberry_pi', 'virtual']);
  assert.deepEqual(tipos.filter(t => t.probado).map(t => t.codigo), ['esp32', 'virtual'], 'solo se declara probado lo que existe en el repositorio');
  const fisico = await nodo('agv-dht22-01'), virtual = await nodo(prefijo(crop) + '01');
  assert.deepEqual([fisico.tipo_dispositivo, fisico.protocolo, fisico.intervalo_segundos, fisico.configuracion_manual], ['esp32', 'mqtt_wifi', 60, false]);
  assert.deepEqual([virtual.tipo_dispositivo, virtual.protocolo, virtual.intervalo_segundos], ['virtual', 'mqtt_simulado', 30]);
  assert.equal((await one("SELECT count(*)::int n FROM public.nodos WHERE tipo_nodo='virtual' AND tipo_dispositivo<>'virtual'")).n, 0);
  const conf = (uid, id, ...a) => rpcUsuario(uid, 'SELECT (public.configurar_dispositivo($1,$2,$3,$4)).*', [id, a[0], a[1] ?? null, a[2] ?? null]);
  const auto = await conf(owner, fisico.id, 'arduino_uno');
  assert.deepEqual([auto.tipo_dispositivo, auto.protocolo, auto.intervalo_segundos, auto.configuracion_manual], ['arduino_uno', 'serie_puente_mqtt', 60, false]);
  const manual = await conf(owner, fisico.id, 'raspberry_pi', 'mqtt_ethernet', 120);
  assert.deepEqual([manual.tipo_dispositivo, manual.protocolo, manual.intervalo_segundos, manual.configuracion_manual], ['raspberry_pi', 'mqtt_ethernet', 120, true]);
  assert.equal(manual.asignacion_version, fisico.asignacion_version, 'configurar no cambia la version de asignacion');
  for (const a of [['esp32', 'mqtt_ethernet'], ['esp32', null, 5], ['esp32', null, 4000], ['virtual'], ['inexistente']])
    await assert.rejects(conf(owner, fisico.id, ...a), /DISPOSITIVO_INVALIDO/, JSON.stringify(a));
  await assert.rejects(conf(owner, virtual.id, 'esp32'), /DISPOSITIVO_INVALIDO/);
  await assert.rejects(conf(other, fisico.id, 'esp32'), /NODO_NO_AUTORIZADO/);
  assert.equal((await conf(owner, virtual.id, 'virtual', null, 15)).intervalo_segundos, 15);
  await conf(owner, virtual.id, 'virtual'); await conf(owner, fisico.id, 'esp32');
  assert.equal(await comoUsuario(other, async () => (await one('SELECT count(*)::int n FROM public.tipos_dispositivo')).n), 4);
});

test('pausa de recepcion: los lotes v3 y v2 se rechazan con NODO_PAUSADO sin guardar; reanudar vuelve a aceptar', async () => {
  const codigo = prefijo(crop) + '04', v = await nodo(codigo), f = await nodo('agv-dht22-01');
  const pausar = (uid, id, valor) => rpcUsuario(uid, 'SELECT (public.pausar_nodo($1,$2)).*', [id, valor]);
  const filas = async id => (await one('SELECT count(*)::int n FROM public.mediciones WHERE nodo_id=$1', [id])).n;
  await assert.rejects(pausar(other, v.id, true), /NODO_NO_AUTORIZADO/);
  const pausado = await pausar(owner, v.id, true);
  assert.equal(pausado.recepcion_pausada, true); assert.ok(pausado.pausada_en); assert.equal(pausado.asignacion_version, v.asignacion_version);
  const antes = await filas(v.id), lote = await loteV3(codigo);
  assert.deepEqual(await ingerirV3(lote), { estado: 'rechazado', codigo: 'NODO_PAUSADO' });
  assert.equal(await filas(v.id), antes, 'no queda ninguna fila parcial');
  await pausar(owner, f.id, true);
  const antesF = await filas(f.id);
  assert.deepEqual(await ingerirReal(payloadReal()), { estado: 'rechazado', codigo: 'NODO_PAUSADO' });
  assert.equal(await filas(f.id), antesF);
  // Reanudar: el mismo lote v3 (aun en ventana) y uno real nuevo se guardan.
  assert.equal((await pausar(owner, v.id, false)).pausada_en, null); await pausar(owner, f.id, false);
  assert.equal((await ingerirV3(lote)).estado, 'insertado'); assert.equal(await filas(v.id), antes + 10);
  assert.equal((await ingerirReal(payloadReal())).estado, 'insertado');
  assert.equal((await pausar(owner, v.id, false)).recepcion_pausada, false, 'repetir no falla');
});

test('preferencias por usuario: valores por defecto, guardado validado y aislamiento', async () => {
  const guardar = (uid, ...a) => rpcUsuario(uid, 'SELECT (public.guardar_preferencias($1,$2,$3)).*', a);
  assert.equal(await comoUsuario(owner, async () => (await one('SELECT count(*)::int n FROM public.preferencias_usuario')).n), 0);
  const r = await guardar(owner, false, 5, 'todos');
  assert.deepEqual([r.tiempo_real, r.refresco_segundos, r.clima_alcance], [false, 5, 'todos']);
  assert.equal((await guardar(owner, true, 30, 'cultivo')).refresco_segundos, 30);
  for (const a of [[true, 7, 'cultivo'], [true, 10, 'finca'], [null, 10, 'cultivo']]) await assert.rejects(guardar(owner, ...a), /PREFERENCIAS_INVALIDAS/);
  assert.equal(await comoUsuario(other, async () => (await one('SELECT count(*)::int n FROM public.preferencias_usuario')).n), 0);
  await assert.rejects(comoUsuario(owner, () => db.query('UPDATE public.preferencias_usuario SET refresco_segundos=5')), /permission denied/);
});

test('estado en vivo: red con dispositivo, pausa, clima y proyeccion del fisico; estado para el servicio de simulacion', async () => {
  const red = () => comoUsuario(owner, async () => (await db.query('SELECT * FROM public.estado_red_nodos()')).rows);
  let fisico = (await red()).find(f => f.codigo === 'agv-dht22-01');
  assert.deepEqual([fisico.tipo_dispositivo, fisico.intervalo_segundos, fisico.recepcion_pausada, fisico.clima_evento, fisico.proyeccion], ['esp32', 60, false, null, null]);
  // Evento activo: el servicio proyecta la lectura real del fisico como dato SIMULADO de ese nodo.
  await rpcUsuario(owner, "SELECT public.establecer_clima($1,'lluvia',2,false) AS r", [crop]);
  const real = payloadReal(29.4, 71, 2600); assert.equal((await ingerirReal(real)).estado, 'insertado');
  const sim = payloadSimFisico(26.4, 93, 780); assert.equal((await ingerirSimFisico(sim)).estado, 'insertado');
  const filas = await red(); fisico = filas.find(f => f.codigo === 'agv-dht22-01');
  assert.equal(fisico.origen, 'real'); assert.equal(Number(fisico.temperatura), 29.4, 'la lectura real no cambia');
  assert.equal(fisico.clima_evento, 'lluvia'); assert.equal(fisico.clima_intensidad, 2);
  assert.equal(Number(fisico.proyeccion.temperatura), 26.4); assert.equal(Number(fisico.proyeccion.humedad), 93); assert.equal(fisico.proyeccion.mensaje_id, sim.mensaje_id);
  const virtual = filas.find(f => f.codigo === prefijo(crop) + '01');
  assert.equal(virtual.clima_evento, 'lluvia'); assert.equal(virtual.proyeccion, null); assert.equal(virtual.tipo_dispositivo, 'virtual');
  assert.equal(filas.filter(f => f.cultivo_id !== crop).every(f => f.clima_evento === null), true);
  // Estado para el servicio: solo service_role.
  assert.equal((await one("SELECT has_function_privilege('authenticated','public.estado_simulacion()','EXECUTE') a")).a, false);
  await rpcUsuario(owner, "SELECT (public.pausar_nodo($1,true)).id", [(await nodo(prefijo(crop) + '05')).id]);
  const estado = await comoServidor(async () => (await one('SELECT public.estado_simulacion() AS r')).r);
  assert.equal(estado.cultivos.length, 3);
  const platano = estado.cultivos.find(c => c.cultivo_id === crop);
  assert.deepEqual(platano.clima.evento, 'lluvia'); assert.equal(platano.parametros.codigo, 'platano'); assert.equal(platano.nodos.length, 6);
  const nf = platano.nodos.find(n => n.codigo === 'agv-dht22-01');
  assert.equal(nf.tipo_nodo, 'fisico'); assert.equal(Number(nf.ultima_real.temperatura), 29.4); assert.equal(nf.ultima_real.adc, 2600);
  const nv = platano.nodos.find(n => n.codigo === prefijo(crop) + '05');
  assert.equal(nv.pausado, true); assert.equal(nv.zona, 'Sector norte'); assert.match(nv.asignacion_version, /^[0-9a-f-]{36}$/); assert.equal(nv.ultima_real, null);
  // Al volver a normal queda el evento anterior durante 5 min para regresar de forma gradual.
  await rpcUsuario(owner, "SELECT public.establecer_clima($1,'normal',2,false) AS r", [crop]);
  const despues = (await comoServidor(async () => (await one('SELECT public.estado_simulacion() AS r')).r)).cultivos.find(c => c.cultivo_id === crop);
  assert.equal(despues.clima, null); assert.equal(despues.clima_anterior.evento, 'lluvia'); assert.ok(despues.clima_anterior.finalizado_en);
  assert.equal((await red()).find(f => f.codigo === 'agv-dht22-01').proyeccion, null, 'sin evento activo no se muestra proyeccion');
  await rpcUsuario(owner, "SELECT (public.pausar_nodo($1,false)).id", [(await nodo(prefijo(crop) + '05')).id]);
});
