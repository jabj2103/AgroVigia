// Pruebas locales de 0011 (ajuste manual de la simulacion, sugerencias de IA a peticion y nodos virtuales
// gestionables) en PGlite (PostgreSQL en memoria). No es Supabase remoto, ni JWT/HTTP real. Datos ficticios.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { crearZonas, crearCaptura, editarValor } from '../../simulador/public/motor.mjs';
import { prepararCapturaV3 } from '../../simulador/contrato-v3.mjs';
import { faseClima, leerEstado, loteProyeccion, loteVirtual } from '../../simulador/clima-modelo.mjs';
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
    '202611030007_zonas_y_nodos_virtuales', '202611030008_ingesta_simulada_v3', '202611030009_cultivos_clima_dispositivos',
    '202611030010_ia_red_simulacion', '202611030011_simulacion_manual_y_solicitudes', '202611030012_terreno_sectores_nodos_fisicos'])
    await db.exec(sql('migrations/' + m + '.sql'));
  await db.exec(sql('provisionar-simulacion.sql').replace('p_cultivo_id uuid := NULL;', `p_cultivo_id uuid := '${crop}';`));
  await db.exec(sql('provisionar-hexagonos.sql'));
});
after(async () => { await db.close(); });

const ahoraIso = (segundos = 0) => new Date(Date.now() - segundos * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
async function comoServidor(fn) { await db.exec('SET ROLE service_role'); try { return await fn(); } finally { await db.exec('RESET ROLE'); } }
async function comoAnonimo(fn) { await db.exec('SET ROLE anon'); try { return await fn(); } finally { await db.exec('RESET ROLE'); } }
async function comoUsuario(uid, fn) {
  await db.exec('SET ROLE authenticated');
  try { await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [uid]); return await fn(); }
  finally { await db.query("SELECT set_config('request.jwt.claim.sub','',false)"); await db.exec('RESET ROLE'); }
}
const rpcUsuario = (uid, q, p = []) => comoUsuario(uid, async () => (await db.query(q, p)).rows[0]);
const rpcServidor = (q, p = []) => comoServidor(async () => (await db.query(q, p)).rows[0]);
const nodo = async codigo => one('SELECT * FROM public.nodos WHERE codigo=$1', [codigo]);
const cultivoDe = async plantilla => (await one('SELECT id FROM public.cultivos WHERE plantilla_codigo=$1 ORDER BY creado_en LIMIT 1', [plantilla])).id;
const prefijo = id => 'sim-' + id.replaceAll('-', '').slice(0, 12) + '-';
async function loteV3(codigo, valores = {}) {
  const n = await nodo(codigo);
  let punto = crearZonas()[0];
  for (const [k, v] of Object.entries(valores)) punto = editarValor(punto, k, v);
  const local = crearCaptura(punto, { ejecucion: randomUUID() });
  return prepararCapturaV3(local, { nodo_local: local.nodo_codigo, nodo_codigo: codigo, asignacion_version: n.asignacion_version });
}
const ingerirV3 = p => comoServidor(async () => (await one(
  'SELECT public.registrar_lote_simulado_v3($1,$2,clock_timestamp(),true,NULL,true) AS r', [p.topico, p.mensaje])).r);
const ingerirV2 = (topico, mensaje) => comoServidor(async () => (await one(
  'SELECT public.registrar_lote_ambiental($1,$2,clock_timestamp(),true,NULL,true) AS r', [topico, mensaje])).r);
function payloadReal(t = 28, h = 70, adc = 2048) {
  return { version: 2, nodo_codigo: 'agv-dht22-01', mensaje_id: randomUUID(), origen: 'real', tomada_en: ahoraIso(),
    ldr: { metodo: 'adc12_10k_11db_v1', adc_promedio: adc },
    mediciones: [
      { variable_codigo: 'temperatura_aire', valor: t, unidad: '°C' },
      { variable_codigo: 'humedad_aire', valor: h, unidad: '% HR' },
      { variable_codigo: 'iluminacion_relativa', valor: Math.round(adc * 1000 / 4095) / 10, unidad: '% relativo' },
    ] };
}
const ingerirReal = p => ingerirV2('agrovigia/v2/real/nodos/agv-dht22-01/telemetria', JSON.stringify(p));
const reservar = async (codigo, mensaje) => (await rpcServidor('SELECT public.reservar_sugerencia_ia($1,$2) AS r', [(await nodo(codigo)).id, mensaje])).r;
const completarSugerencia = (id, respuesta) => rpcServidor('SELECT public.completar_sugerencia_ia($1,$2,$3,$4,$5,$6) AS r',
  [id, JSON.stringify(respuesta), 'gemini-3.5-flash-lite', 900, 300, null]);
const respuestaValida = () => ({
  resumen: 'Suelo simulado bajo el rango del cultivo tras un ajuste manual.', estado_general: 'atencion',
  recomendaciones: [{ titulo: 'Revisar riego', accion: 'Comprobar el riego del sector.', prioridad: 'media', variable: 'humedad_suelo_vwc', evidencia: 'Humedad del suelo 18 % VWC.' }],
  riego: 'El suelo simulado está bajo el rango.', luz: 'Índice relativo normal para la hora.', limitaciones: 'Datos simulados con ajuste manual.',
});
const ajustar = (uid, cultivo, ajustes, todos = false) => rpcUsuario(uid, 'SELECT public.ajustar_simulacion($1,$2,$3) AS r', [cultivo, JSON.stringify(ajustes), todos]);
const activos = async () => (await db.query('SELECT cultivo_id, ajustes FROM public.ajustes_simulacion WHERE finalizado_en IS NULL ORDER BY cultivo_id')).rows;
const estadoSimulacion = async () => (await rpcServidor('SELECT public.estado_simulacion() AS r')).r;
const solicitar = (uid, cultivo, origen) => rpcUsuario(uid, 'SELECT public.solicitar_sugerencia_ia($1,$2) AS r', [cultivo, origen]);
const tomar = async (limite = 3) => (await rpcServidor('SELECT public.tomar_solicitudes_ia($1) AS r', [limite])).r;
const preparar = async id => (await rpcServidor('SELECT public.preparar_solicitud_ia($1) AS r', [id])).r;
const completar = async (id, respuesta, error = null) => (await rpcServidor('SELECT public.completar_solicitud_ia($1,$2,$3,$4,$5,$6) AS r',
  [id, respuesta === null ? null : JSON.stringify(respuesta), 'gemini-3.5-flash-lite', 1200, 400, error])).r;
const solicitud = async id => one('SELECT * FROM public.solicitudes_ia WHERE id=$1', [id]);
// Deja pasar el enfriamiento de 60 s y cierra lo abierto, para que cada prueba empiece limpia.
const envejecerSolicitudes = segundos => db.query(`UPDATE public.solicitudes_ia SET creada_en=creada_en-make_interval(secs=>$1),
  en_proceso_desde=en_proceso_desde-make_interval(secs=>$1), cerrada_en=cerrada_en-make_interval(secs=>$1)`, [segundos]);

test('ajuste manual: validacion, normalizacion, historial, idempotencia, todos los cultivos y vuelta a automatico', async () => {
  const yuca = await cultivoDe('yuca');
  await assert.rejects(ajustar(other, yuca, { temperatura_aire: 2 }), /CULTIVO_NO_AUTORIZADO/);
  for (const malo of [{ luz: 1 }, { temperatura_aire: 10.5 }, { temperatura_aire: -10.1 }, { humedad_aire: 31 }, { humedad_suelo_vwc: -30.1 }, { ph_suelo: 2.1 },
    { precipitacion_60min: 51 }, { velocidad_viento: 15.1 }, { velocidad_viento: -10.1 }, { temperatura_aire: 1.25 }, { temperatura_aire: '2' },
    { temperatura_aire: null }, { ph_suelo: [1] }, [1, 2], 'x', null])
    await assert.rejects(ajustar(owner, yuca, malo), /AJUSTE_INVALIDO/, JSON.stringify(malo));
  await assert.rejects(rpcUsuario(owner, 'SELECT public.ajustar_simulacion($1,$2,NULL)', [yuca, '{}']), /AJUSTE_INVALIDO/);
  // Se guardan solo las claves distintas de cero, sin ceros decimales de sobra. Los extremos del rango valen.
  const r = (await ajustar(owner, yuca, { temperatura_aire: 4.0, humedad_aire: 0, humedad_suelo_vwc: -10.5, ph_suelo: 0.0, velocidad_viento: 15, precipitacion_60min: -50 })).r;
  assert.deepEqual(r, { codigo: 'AJUSTE_ESTABLECIDO', ajustes: { temperatura_aire: 4, humedad_suelo_vwc: -10.5, velocidad_viento: 15, precipitacion_60min: -50 }, cultivos_cambiados: 1 });
  assert.deepEqual(await activos(), [{ cultivo_id: yuca, ajustes: r.ajustes }]);
  assert.equal((await ajustar(owner, yuca, { humedad_suelo_vwc: -10.5, temperatura_aire: 4, velocidad_viento: 15.0, precipitacion_60min: -50, ph_suelo: 0 })).r.cultivos_cambiados, 0, 'mismo ajuste no cambia nada');
  // Un cambio cierra el anterior y conserva el historial.
  assert.equal((await ajustar(owner, yuca, { temperatura_aire: -2 })).r.cultivos_cambiados, 1);
  const historial = (await db.query('SELECT ajustes, finalizado_en IS NULL AS activo, actor_id FROM public.ajustes_simulacion WHERE cultivo_id=$1 ORDER BY iniciado_en', [yuca])).rows;
  assert.deepEqual(historial.map(h => [h.activo, h.actor_id]), [[false, owner], [true, owner]]);
  assert.deepEqual(historial[1].ajustes, { temperatura_aire: -2 });
  // Todos los cultivos activos de la cuenta, y vuelta a automatico con objeto vacio o todo en cero.
  assert.equal((await ajustar(owner, yuca, { ph_suelo: -1.5 }, true)).r.cultivos_cambiados, 3);
  assert.deepEqual((await activos()).map(a => a.ajustes), Array(3).fill({ ph_suelo: -1.5 }));
  const auto = (await ajustar(owner, crop, { ph_suelo: 0, temperatura_aire: 0 })).r;
  assert.deepEqual(auto, { codigo: 'AJUSTE_ESTABLECIDO', ajustes: {}, cultivos_cambiados: 1 });
  assert.equal((await activos()).length, 2);
  assert.equal((await ajustar(owner, yuca, {}, true)).r.cultivos_cambiados, 2);
  assert.equal((await activos()).length, 0);
  assert.equal((await ajustar(owner, yuca, {})).r.cultivos_cambiados, 0, 'ya estaba en automatico');
  assert.equal((await one('SELECT count(*)::int n FROM public.ajustes_simulacion')).n, 5, 'el historial se conserva completo');
});

test('ajuste manual: cultivo archivado, permisos y RLS (anonimo sin acceso, la web sin escritura directa, otra cuenta sin lectura)', async () => {
  const yuca = await cultivoDe('yuca'), archivado = randomUUID();
  await db.query(`INSERT INTO public.cultivos (id,agricultor_id,nombre,tipo,area,unidad_area,solicitud_id,archivado_en)
    VALUES ($1,$2,'Archivado','Prueba',1,'ha',$3,now())`, [archivado, owner, randomUUID()]);
  await assert.rejects(ajustar(owner, archivado, { temperatura_aire: 1 }), /CULTIVO_ARCHIVADO/);
  assert.equal((await ajustar(owner, archivado, { temperatura_aire: 1 }, true)).r.cultivos_cambiados, 3, 'con todos, el archivado se omite');
  assert.equal(await comoUsuario(owner, async () => (await one('SELECT count(*)::int n FROM public.ajustes_simulacion WHERE finalizado_en IS NULL')).n), 3);
  assert.equal(await comoUsuario(other, async () => (await one('SELECT count(*)::int n FROM public.ajustes_simulacion')).n), 0);
  await assert.rejects(comoUsuario(owner, () => db.query("INSERT INTO public.ajustes_simulacion (cultivo_id,ajustes,actor_id) VALUES ($1,'{\"ph_suelo\":1}',$2)", [yuca, owner])), /permission denied/);
  await assert.rejects(comoUsuario(owner, () => db.query('UPDATE public.ajustes_simulacion SET finalizado_en=now()')), /permission denied/);
  await assert.rejects(comoUsuario(owner, () => db.query('DELETE FROM public.ajustes_simulacion')), /permission denied/);
  await assert.rejects(comoAnonimo(() => db.query('SELECT * FROM public.ajustes_simulacion')), /permission denied/);
  await assert.rejects(comoAnonimo(() => db.query("SELECT public.ajustar_simulacion($1,'{}')", [yuca])), /permission denied/);
  await assert.rejects(comoServidor(() => db.query("SELECT public.ajustar_simulacion($1,'{}')", [yuca])), /permission denied/);
  for (const f of ['normalizar_ajustes_simulacion(jsonb)', 'contexto_sugerencia_ia(uuid,uuid,text,text,timestamptz)', 'depurar_solicitudes_ia(timestamptz)'])
    for (const rol of ['anon', 'authenticated', 'service_role'])
      assert.equal((await one(`SELECT has_function_privilege('${rol}','public.${f}','EXECUTE') a`)).a, false, f + ' ' + rol);
  await ajustar(owner, yuca, {}, true);
});

test('ajuste manual: llega al servicio de simulacion y al contexto de la IA solo para datos simulados', async () => {
  const yuca = await cultivoDe('yuca');
  let estado = await estadoSimulacion();
  assert.ok(estado.cultivos.every(c => c.ajustes === null && c.ajustes_iniciado_en === null), 'sin ajuste: null');
  await ajustar(owner, crop, { temperatura_aire: 5, humedad_suelo_vwc: -12 });
  estado = await estadoSimulacion();
  const platano = estado.cultivos.find(c => c.cultivo_id === crop);
  assert.deepEqual(platano.ajustes, { temperatura_aire: 5, humedad_suelo_vwc: -12 }); assert.ok(Date.parse(platano.ajustes_iniciado_en) > Date.now() - 60_000);
  assert.equal(estado.cultivos.find(c => c.cultivo_id === yuca).ajustes, null);
  assert.deepEqual(leerEstado(estado).find(c => c.cultivo_id === crop).ajustes, { temperatura_aire: 5, humedad_suelo_vwc: -12 });
  // La reserva automatica de un lote simulado trae ajustes_manuales junto a clima_simulado; la de un lote real no.
  const codigo = prefijo(crop) + '01', p = await loteV3(codigo); assert.equal((await ingerirV3(p)).estado, 'insertado');
  const sim = await reservar(codigo, p.payload.mensaje_id);
  assert.equal(sim.codigo, 'RESERVADA');
  assert.deepEqual(sim.contexto.ajustes_manuales, { temperatura_aire: 5, humedad_suelo_vwc: -12 }); assert.equal(sim.contexto.clima_simulado, null);
  assert.deepEqual(Object.keys(sim.contexto).sort(), ['ajustes_manuales', 'alertas_abiertas', 'clima_simulado', 'cultivo', 'estadisticas', 'hora_local', 'motivo',
    'nodos', 'origen_datos', 'periodo_del_dia', 'plantilla', 'reglas_activas', 'sensores'], 'el contexto de la 0010 mas ajustes_manuales');
  const real = payloadReal(); assert.equal((await ingerirReal(real)).estado, 'insertado');
  const rr = await reservar('agv-dht22-01', real.mensaje_id);
  assert.equal(rr.codigo, 'RESERVADA'); assert.equal(rr.contexto.ajustes_manuales, null, 'el ajuste no aplica a datos reales');
  await completarSugerencia(sim.sugerencia_id, respuestaValida()); await completarSugerencia(rr.sugerencia_id, respuestaValida());
  await ajustar(owner, crop, {});
  assert.equal((await estadoSimulacion()).cultivos.find(c => c.cultivo_id === crop).ajustes, null);
});

test('servicio de simulacion con ajuste manual: la RPC v3 acepta el lote virtual y la v2 la proyeccion simulada del fisico sin evento', async () => {
  await ajustar(owner, crop, { temperatura_aire: 4, humedad_aire: -30, humedad_suelo_vwc: -30, ph_suelo: 2, precipitacion_60min: 50, velocidad_viento: 15 });
  const estado = leerEstado(await estadoSimulacion()).find(c => c.cultivo_id === crop), normal = faseClima(null, null, Date.now());
  const virtual = estado.nodos.find(n => n.codigo === prefijo(crop) + '03');
  const sin = loteVirtual(virtual, estado.parametros, normal, new Date(), { ejecucion: randomUUID() });
  const con = loteVirtual(virtual, estado.parametros, normal, new Date(), { ejecucion: randomUUID(), ajustes: estado.ajustes });
  const v = l => Object.fromEntries(l.payload.mediciones.map(m => [m.variable_codigo, m.valor]));
  assert.equal(v(con).precipitacion_60min, 50); assert.ok(Math.abs(v(con).temperatura_aire - v(sin).temperatura_aire - 4) < 0.11);
  assert.ok(v(con).humedad_suelo_vwc >= 0 && v(con).humedad_aire >= 0 && v(con).ph_suelo <= 14);
  const g = await ingerirV3(con); assert.equal(g.estado, 'insertado', JSON.stringify(g));
  // Fisico: sin evento de clima, el ajuste de temperatura y humedad se publica como proyeccion SIMULADA; la real no cambia.
  const real = payloadReal(30.2, 68, 2400); assert.equal((await ingerirReal(real)).estado, 'insertado');
  const antes = (await comoUsuario(owner, async () => (await db.query('SELECT * FROM public.estado_red_nodos()')).rows)).find(f => f.codigo === 'agv-dht22-01');
  assert.equal(antes.proyeccion, null, 'con ajuste activo pero sin lote proyectado todavia');
  const fisico = { codigo: 'agv-dht22-01', tipo_nodo: 'fisico', ultima_real: { temperatura: 30.2, humedad: 68, adc: 2400 } };
  const proy = loteProyeccion(fisico, normal, new Date(), randomUUID(), estado.ajustes);
  assert.deepEqual(proy.payload.mediciones.map(m => m.valor), [34.2, 38, 58.6]);
  const gp = await ingerirV2(proy.topico, proy.mensaje); assert.equal(gp.estado, 'insertado', JSON.stringify(gp));
  const red = (await comoUsuario(owner, async () => (await db.query('SELECT * FROM public.estado_red_nodos()')).rows)).find(f => f.codigo === 'agv-dht22-01');
  assert.equal(red.origen, 'real'); assert.equal(Number(red.temperatura), 30.2, 'la lectura real no se modifica'); assert.equal(red.clima_evento, null);
  assert.deepEqual([Number(red.proyeccion.temperatura), Number(red.proyeccion.humedad), red.proyeccion.mensaje_id], [34.2, 38, proy.payload.mensaje_id]);
  const filas = (await db.query("SELECT origen, valor::float8 v FROM public.mediciones WHERE nodo_id=$1 AND variable_codigo='temperatura_aire' AND mensaje_id IN ($2,$3) ORDER BY origen",
    [(await nodo('agv-dht22-01')).id, real.mensaje_id, proy.payload.mensaje_id])).rows;
  assert.deepEqual(filas, [{ origen: 'real', v: 30.2 }, { origen: 'simulado', v: 34.2 }]);
  // Un ajuste que el fisico no mide (pH) no muestra proyeccion; sin ajuste tampoco.
  await ajustar(owner, crop, { ph_suelo: 1 });
  assert.equal((await comoUsuario(owner, async () => (await db.query('SELECT * FROM public.estado_red_nodos()')).rows)).find(f => f.codigo === 'agv-dht22-01').proyeccion, null);
  await ajustar(owner, crop, {});
});

test('solicitud de IA: registro, una sola abierta por cultivo y origen, enfriamiento de 60 s, validacion y permisos', async () => {
  const yuca = await cultivoDe('yuca');
  await assert.rejects(solicitar(other, yuca, 'simulado'), /CULTIVO_NO_AUTORIZADO/);
  for (const malo of ['mixto', '', null]) await assert.rejects(solicitar(owner, yuca, malo), /SOLICITUD_INVALIDA/);
  const archivado = (await one("SELECT id FROM public.cultivos WHERE nombre='Archivado'")).id;
  await assert.rejects(solicitar(owner, archivado, 'simulado'), /CULTIVO_ARCHIVADO/);
  const r = (await solicitar(owner, yuca, 'simulado')).r;
  assert.equal(r.codigo, 'SOLICITUD_REGISTRADA'); assert.match(r.solicitud_id, /^[0-9a-f-]{36}$/);
  assert.deepEqual((await solicitar(owner, yuca, 'simulado')).r, { codigo: 'SOLICITUD_EN_CURSO', solicitud_id: r.solicitud_id });
  const fila = await solicitud(r.solicitud_id);
  assert.deepEqual([fila.cultivo_id, fila.origen, fila.estado, fila.detalle, fila.sugerencia_id, fila.cerrada_en, fila.actor_id], [yuca, 'simulado', 'pendiente', null, null, null, owner]);
  // Otro origen del mismo cultivo y otro cultivo son independientes.
  assert.equal((await solicitar(owner, yuca, 'real')).r.codigo, 'SOLICITUD_REGISTRADA');
  assert.equal((await solicitar(owner, crop, 'simulado')).r.codigo, 'SOLICITUD_REGISTRADA');
  // Cerrada hace menos de 60 s: en espera, con la hora desde la que se puede volver a pedir.
  await rpcServidor("SELECT public.cerrar_solicitud_ia($1,'error','PRUEBA')", [r.solicitud_id]);
  const espera = (await solicitar(owner, yuca, 'simulado')).r;
  assert.equal(espera.codigo, 'SOLICITUD_EN_ESPERA');
  assert.equal(Date.parse(espera.disponible_en), fila.creada_en.getTime() + 60_000);
  await envejecerSolicitudes(61);
  assert.equal((await solicitar(owner, yuca, 'simulado')).r.codigo, 'SOLICITUD_REGISTRADA');
  // RLS y permisos.
  assert.equal(await comoUsuario(owner, async () => (await one('SELECT count(*)::int n FROM public.solicitudes_ia')).n), 4);
  assert.equal(await comoUsuario(other, async () => (await one('SELECT count(*)::int n FROM public.solicitudes_ia')).n), 0);
  await assert.rejects(comoUsuario(owner, () => db.query("INSERT INTO public.solicitudes_ia (cultivo_id,origen,actor_id) VALUES ($1,'real',$2)", [crop, owner])), /permission denied/);
  await assert.rejects(comoUsuario(owner, () => db.query("UPDATE public.solicitudes_ia SET estado='atendida'")), /permission denied/);
  await assert.rejects(comoAnonimo(() => db.query('SELECT * FROM public.solicitudes_ia')), /permission denied/);
  await assert.rejects(comoAnonimo(() => db.query("SELECT public.solicitar_sugerencia_ia($1,'real')", [yuca])), /permission denied/);
  for (const f of ['tomar_solicitudes_ia(integer)', 'preparar_solicitud_ia(uuid)', 'cerrar_solicitud_ia(uuid,text,text)', 'completar_solicitud_ia(uuid,jsonb,text,integer,integer,text)']) {
    assert.equal((await one(`SELECT has_function_privilege('authenticated','public.${f}','EXECUTE') a`)).a, false, f);
    assert.equal((await one(`SELECT has_function_privilege('anon','public.${f}','EXECUTE') a`)).a, false, f);
    assert.equal((await one(`SELECT has_function_privilege('service_role','public.${f}','EXECUTE') a`)).a, true, f);
  }
  assert.equal((await one("SELECT has_function_privilege('service_role','public.solicitar_sugerencia_ia(uuid,text)','EXECUTE') a")).a, false);
  await assert.rejects(comoUsuario(owner, () => db.query('SELECT public.tomar_solicitudes_ia(3)')), /permission denied/);
  await db.query("UPDATE public.solicitudes_ia SET estado='error', detalle='PRUEBA', cerrada_en=now(), en_proceso_desde=NULL WHERE cerrada_en IS NULL");
  await envejecerSolicitudes(61);
});

test('solicitud de IA: n8n la toma de forma atomica, recibe el contexto sin exigir alerta ni intervalo y la cierra como atendida', async () => {
  const yuca = await cultivoDe('yuca'), codigo = prefijo(yuca) + '04';
  await ajustar(owner, yuca, { humedad_suelo_vwc: -8 });
  await rpcUsuario(owner, "SELECT public.establecer_clima($1,'sol_fuerte',2,false)", [yuca]);
  // Una sugerencia automatica recien generada: la siguiente automatica no corresponde, la peticion explicita si.
  const p = await loteV3(codigo, { humedad_suelo_vwc: 21 }); assert.equal((await ingerirV3(p)).estado, 'insertado');
  const auto = await reservar(codigo, p.payload.mensaje_id); assert.equal(auto.codigo, 'RESERVADA');
  await completarSugerencia(auto.sugerencia_id, respuestaValida());
  const p2 = await loteV3(codigo, { humedad_suelo_vwc: 20 }); await ingerirV3(p2);
  assert.equal((await reservar(codigo, p2.payload.mensaje_id)).codigo, 'NO_CORRESPONDE');
  const s = (await solicitar(owner, yuca, 'simulado')).r.solicitud_id;
  const toma = await tomar();
  assert.equal(toma.codigo, 'SOLICITUDES_TOMADAS');
  assert.deepEqual(toma.solicitudes.map(x => [x.solicitud_id, x.cultivo_id, x.origen, x.intento]), [[s, yuca, 'simulado', 1]]);
  assert.deepEqual((await tomar()).solicitudes, [], 'una solicitud tomada no se entrega dos veces');
  assert.equal((await solicitud(s)).estado, 'en_proceso');
  assert.deepEqual((await solicitar(owner, yuca, 'simulado')).r, { codigo: 'SOLICITUD_EN_CURSO', solicitud_id: s });
  const r = await preparar(s);
  assert.equal(r.codigo, 'RESERVADA'); assert.equal(r.motivo, 'solicitud'); assert.equal(r.solicitud_id, s);
  assert.equal(r.contexto.motivo, 'solicitud'); assert.equal(r.contexto.origen_datos, 'simulado');
  assert.deepEqual(r.contexto.ajustes_manuales, { humedad_suelo_vwc: -8 }); assert.equal(r.contexto.clima_simulado.evento, 'sol_fuerte');
  assert.equal(r.contexto.sensores.tipo_nodo, 'virtual'); assert.equal(r.contexto.nodos.length, 6);
  assert.equal(Number(r.contexto.nodos.find(x => x.codigo === codigo).valores.humedad_suelo_vwc), 20, 'usa el ultimo lote del origen');
  assert.equal((await one('SELECT count(*)::int n FROM public.sugerencia_mediciones WHERE sugerencia_id=$1', [r.sugerencia_id])).n, 10);
  assert.deepEqual(await one('SELECT motivo, estado, origen FROM public.sugerencias_ia WHERE id=$1', [r.sugerencia_id]), { motivo: 'solicitud', estado: 'pendiente', origen: 'simulado' });
  // Reintento de n8n: devuelve la misma reserva, sin crear otra.
  const repetida = await preparar(s);
  assert.deepEqual([repetida.codigo, repetida.sugerencia_id], ['RESERVADA', r.sugerencia_id]); assert.deepEqual(repetida.contexto, r.contexto);
  const c = await completar(s, respuestaValida());
  assert.deepEqual(c, { codigo: 'SOLICITUD_CERRADA', solicitud_id: s, estado: 'atendida', detalle: null, sugerencia_id: r.sugerencia_id, sugerencia_estado: 'generada' });
  const fila = await solicitud(s);
  assert.deepEqual([fila.estado, fila.sugerencia_id, fila.detalle, fila.en_proceso_desde], ['atendida', r.sugerencia_id, null, null]); assert.ok(fila.cerrada_en);
  assert.equal((await completar(s, respuestaValida())).codigo, 'SOLICITUD_YA_CERRADA');
  assert.equal((await preparar(s)).codigo, 'SOLICITUD_NO_EN_PROCESO');
  assert.equal((await one('SELECT estado FROM public.sugerencias_ia WHERE id=$1', [r.sugerencia_id])).estado, 'generada');
  await assert.rejects(preparar(randomUUID()), /SOLICITUD_DESCONOCIDA/);
  await assert.rejects(rpcServidor("SELECT public.cerrar_solicitud_ia($1,'abierta',NULL)", [s]), /CIERRE_INVALIDO/);
  await assert.rejects(tomar(0), /LIMITE_INVALIDO/);
  await ajustar(owner, yuca, {}); await rpcUsuario(owner, "SELECT public.establecer_clima($1,'normal',2,false)", [yuca]);
  await envejecerSolicitudes(61);
});

test('solicitud de IA: datos reales del fisico, respuesta invalida o error de Gemini cierran como error; sin lote reciente, sin_datos', async () => {
  const hort = await cultivoDe('hortalizas');
  // Real: el contexto es el del nodo fisico, sin humedad del suelo.
  const real = payloadReal(31, 66); assert.equal((await ingerirReal(real)).estado, 'insertado');
  const sr = (await solicitar(owner, crop, 'real')).r.solicitud_id;
  assert.equal((await tomar()).solicitudes.length, 1);
  const pr = await preparar(sr);
  assert.equal(pr.codigo, 'RESERVADA'); assert.equal(pr.contexto.origen_datos, 'real'); assert.equal(pr.contexto.ajustes_manuales, null);
  assert.deepEqual(pr.contexto.nodos.map(x => x.codigo), ['agv-dht22-01']); assert.ok(pr.contexto.sensores.sin_sensor_de.includes('humedad del suelo'));
  const invalida = await completar(sr, { ...respuestaValida(), estado_general: 'excelente' });
  assert.deepEqual([invalida.codigo, invalida.estado, invalida.detalle, invalida.sugerencia_estado], ['SOLICITUD_CERRADA', 'error', 'RESPUESTA_INVALIDA', 'fallida']);
  await envejecerSolicitudes(61);
  const real2 = payloadReal(31.5, 65); await ingerirReal(real2);
  const sr2 = (await solicitar(owner, crop, 'real')).r.solicitud_id; await tomar(); await preparar(sr2);
  const caida = await completar(sr2, null, 'GEMINI_HTTP_503');
  assert.deepEqual([caida.estado, caida.detalle], ['error', 'GEMINI_HTTP_503']);
  // Sin reserva previa no se puede completar.
  await envejecerSolicitudes(61);
  const sr3 = (await solicitar(owner, crop, 'real')).r.solicitud_id;
  assert.equal((await completar(sr3, respuestaValida())).codigo, 'SOLICITUD_SIN_RESERVA');
  await rpcServidor("SELECT public.cerrar_solicitud_ia($1,'error','PRUEBA')", [sr3]);
  // Hortalizas no tiene ningun lote: sin_datos. Un cultivo simulado sin fisico pidiendo datos reales: sin_datos.
  for (const origen of ['simulado', 'real']) {
    const s = (await solicitar(owner, hort, origen)).r.solicitud_id;
    assert.deepEqual((await tomar()).solicitudes.map(x => x.solicitud_id), [s]);
    assert.deepEqual(await preparar(s), { codigo: 'SOLICITUD_CERRADA', solicitud_id: s, estado: 'sin_datos', detalle: 'SIN_LOTE_RECIENTE', sugerencia_id: null });
    assert.equal((await solicitud(s)).estado, 'sin_datos');
  }
  assert.equal((await one("SELECT count(*)::int n FROM public.sugerencias_ia WHERE cultivo_id=$1", [hort])).n, 0, 'sin datos no gasta IA');
  await envejecerSolicitudes(61);
});

test('solicitud de IA: tope diario la rechaza; una sugerencia automatica en curso la aplaza; atendida exige sugerencia generada', async () => {
  const hort = await cultivoDe('hortalizas'), codigo = prefijo(hort) + '02';
  // Una reserva automatica pendiente (n8n aun consulta a Gemini): la solicitud vuelve a pendiente y se reintenta.
  const p = await loteV3(codigo); assert.equal((await ingerirV3(p)).estado, 'insertado');
  const auto = await reservar(codigo, p.payload.mensaje_id); assert.equal(auto.codigo, 'RESERVADA');
  const s = (await solicitar(owner, hort, 'simulado')).r.solicitud_id; await tomar();
  assert.deepEqual(await preparar(s), { codigo: 'SOLICITUD_APLAZADA', solicitud_id: s, motivo: 'SUGERENCIA_EN_CURSO' });
  assert.deepEqual([(await solicitud(s)).estado, (await solicitud(s)).intentos], ['pendiente', 0]);
  await completarSugerencia(auto.sugerencia_id, respuestaValida());
  assert.deepEqual((await tomar()).solicitudes.map(x => x.solicitud_id), [s]);
  const r = await preparar(s); assert.equal(r.codigo, 'RESERVADA');
  await assert.rejects(rpcServidor("SELECT public.cerrar_solicitud_ia($1,'atendida',NULL)", [s]), /CIERRE_INVALIDO/, 'la sugerencia aun no esta generada');
  assert.equal((await completar(s, respuestaValida())).estado, 'atendida');
  // Tope diario por cultivo y origen: 60 en 24 h.
  await db.query(`INSERT INTO public.sugerencias_ia (cultivo_id,origen,motivo,estado,contexto,error_codigo,completada_en,solicitada_en)
    SELECT $1,'simulado','periodica','fallida','{}','PRUEBA',now()-interval '20 hours',now()-interval '20 hours' FROM generate_series(1,60)`, [hort]);
  await envejecerSolicitudes(61);
  const p2 = await loteV3(codigo); await ingerirV3(p2);
  const s2 = (await solicitar(owner, hort, 'simulado')).r.solicitud_id; await tomar();
  assert.deepEqual(await preparar(s2), { codigo: 'SOLICITUD_CERRADA', solicitud_id: s2, estado: 'rechazada', detalle: 'LIMITE_DIARIO_CULTIVO', sugerencia_id: null });
  await envejecerSolicitudes(61);
});

test('solicitud de IA: en proceso mas de 5 minutos vuelve a pendiente y a la segunda caida es error; pendiente mas de 15 minutos caduca', async () => {
  const yuca = await cultivoDe('yuca'), codigo = prefijo(yuca) + '05';
  const p = await loteV3(codigo); assert.equal((await ingerirV3(p)).estado, 'insertado');
  const s = (await solicitar(owner, yuca, 'simulado')).r.solicitud_id; await tomar();
  const r = await preparar(s); assert.equal(r.codigo, 'RESERVADA');
  // n8n se cae despues de reservar: a los 5 minutos la solicitud vuelve a pendiente y su reserva se da por fallida.
  await db.query("UPDATE public.solicitudes_ia SET en_proceso_desde=en_proceso_desde-interval '4 minutes' WHERE id=$1", [s]);
  assert.deepEqual((await tomar()).solicitudes, [], 'a los 4 minutos sigue en proceso');
  await db.query("UPDATE public.solicitudes_ia SET en_proceso_desde=en_proceso_desde-interval '61 seconds' WHERE id=$1", [s]);
  const segunda = await tomar();
  assert.deepEqual(segunda.solicitudes.map(x => [x.solicitud_id, x.intento]), [[s, 2]], 'se recupera y se vuelve a tomar');
  assert.deepEqual(await one('SELECT estado, error_codigo FROM public.sugerencias_ia WHERE id=$1', [r.sugerencia_id]), { estado: 'fallida', error_codigo: 'SIN_RESPUESTA' });
  assert.equal((await solicitud(s)).sugerencia_id, null);
  // Segunda caida: se cierra como error y el agricultor puede volver a pedir.
  await db.query("UPDATE public.solicitudes_ia SET en_proceso_desde=en_proceso_desde-interval '6 minutes' WHERE id=$1", [s]);
  assert.deepEqual((await tomar()).solicitudes, []);
  const caida = await solicitud(s);
  assert.deepEqual([caida.estado, caida.detalle, caida.en_proceso_desde], ['error', 'PROCESO_INTERRUMPIDO', null]); assert.ok(caida.cerrada_en);
  // n8n apagado: una solicitud que nadie toma en 15 minutos caduca al pedir de nuevo, y se registra otra.
  await envejecerSolicitudes(61);
  const s2 = (await solicitar(owner, yuca, 'simulado')).r.solicitud_id;
  await db.query("UPDATE public.solicitudes_ia SET creada_en=creada_en-interval '16 minutes' WHERE id=$1", [s2]);
  const s3 = (await solicitar(owner, yuca, 'simulado')).r;
  assert.equal(s3.codigo, 'SOLICITUD_REGISTRADA'); assert.notEqual(s3.solicitud_id, s2);
  assert.deepEqual([(await solicitud(s2)).estado, (await solicitud(s2)).detalle], ['error', 'SOLICITUD_CADUCADA']);
  await rpcServidor("SELECT public.cerrar_solicitud_ia($1,'error','PRUEBA')", [s3.solicitud_id]);
  await envejecerSolicitudes(61);
});

test('nodos virtuales: crear con el siguiente codigo libre, diez capacidades y sector; limite de 16; permisos', async () => {
  const yuca = await cultivoDe('yuca');
  const zonas = Object.fromEntries((await db.query('SELECT codigo, id FROM public.zonas WHERE cultivo_id=$1', [yuca])).rows.map(z => [z.codigo, z.id]));
  // SELECT * FROM f(): una sola ejecucion, como hace PostgREST. (f()).* la repetiria por cada columna.
  const crear = (uid, cultivo, zona = null) => rpcUsuario(uid, 'SELECT * FROM public.crear_nodo_virtual($1,$2)', [cultivo, zona]);
  await assert.rejects(crear(other, yuca, zonas['zona-norte']), /CULTIVO_NO_AUTORIZADO/);
  const zonaAjena = (await one('SELECT id FROM public.zonas WHERE cultivo_id=$1 LIMIT 1', [crop])).id;
  await assert.rejects(crear(owner, yuca, zonaAjena), /ZONA_NO_AUTORIZADA/);
  await assert.rejects(crear(owner, (await one("SELECT id FROM public.cultivos WHERE nombre='Archivado'")).id), /CULTIVO_ARCHIVADO/);
  await assert.rejects(comoAnonimo(() => db.query('SELECT public.crear_nodo_virtual($1,$2)', [yuca, zonas['zona-norte']])), /permission denied/);
  await assert.rejects(comoServidor(() => db.query('SELECT public.crear_nodo_virtual($1,$2)', [yuca, zonas['zona-norte']])), /permission denied/);
  await assert.rejects(comoUsuario(owner, () => db.query("INSERT INTO public.nodos (codigo,agricultor_id,tipo_nodo) VALUES ('sim-directo-01',$1,'virtual')", [owner])), /permission denied/);
  const n = await crear(owner, yuca, zonas['zona-central']);
  assert.deepEqual([n.codigo, n.tipo_nodo, n.cultivo_id, n.zona_id, n.habilitado, n.agricultor_id, n.tipo_dispositivo, n.protocolo, n.intervalo_segundos, n.recepcion_pausada],
    [prefijo(yuca) + '07', 'virtual', yuca, zonas['zona-central'], true, owner, 'virtual', 'mqtt_simulado', 30, false]);
  assert.deepEqual([Number(n.posicion_x), Number(n.posicion_y)], [0.25, 0.3], 'el centro del sector ya lo ocupa el nodo 03');
  assert.equal((await one("SELECT count(*)::int n FROM public.nodo_variables WHERE nodo_id=$1 AND sensor_modelo='SIMULADOR_V3'", [n.id])).n, 10);
  assert.equal((await one("SELECT motivo FROM public.nodo_asignaciones WHERE nodo_id=$1", [n.id])).motivo, 'asignacion');
  // El nodo nuevo recibe lotes v3 del servicio de simulacion y aparece en su estado y en la red.
  const g = await ingerirV3(await loteV3(n.codigo)); assert.equal(g.estado, 'insertado', JSON.stringify(g));
  assert.ok((await estadoSimulacion()).cultivos.find(c => c.cultivo_id === yuca).nodos.some(x => x.codigo === n.codigo && x.zona === 'Sector central'));
  assert.ok((await comoUsuario(owner, async () => (await db.query('SELECT codigo FROM public.estado_red_nodos()')).rows)).some(f => f.codigo === n.codigo));
  // Sin sector indicado: el que menos nodos tiene, con desempate por codigo. Yuca: central 2, drenaje 1, norte 2, sur 2.
  const auto = await crear(owner, yuca);
  assert.deepEqual([auto.codigo, auto.zona_id], [prefijo(yuca) + '08', zonas['zona-drenaje']]);
  // Limite de la 0007: dieciseis virtuales por cultivo.
  for (let i = 9; i <= 16; i++) assert.equal((await crear(owner, yuca)).codigo, prefijo(yuca) + String(i).padStart(2, '0'));
  await assert.rejects(crear(owner, yuca), /LIMITE_NODOS_CULTIVO/);
  assert.deepEqual((await db.query("SELECT z.codigo, count(*)::int n FROM public.nodos x JOIN public.zonas z ON z.id=x.zona_id WHERE x.cultivo_id=$1 GROUP BY z.codigo ORDER BY 1", [yuca])).rows.map(f => f.n), [4, 4, 4, 4], 'reparto parejo entre sectores');
  assert.equal((await one('SELECT count(*)::int n FROM (SELECT zona_id, posicion_x, posicion_y FROM public.nodos WHERE cultivo_id=$1 GROUP BY 1,2,3 HAVING count(*)>1) d', [yuca])).n, 0, 'sin nodos encimados');
});

test('nodos virtuales: un cultivo nuevo sin sectores recibe los cuatro del croquis; queda sin reglas simuladas hasta aplicar la plantilla', async () => {
  const nuevo = randomUUID();
  await db.query(`INSERT INTO public.cultivos (id,agricultor_id,nombre,tipo,area,unidad_area,solicitud_id,plantilla_codigo)
    VALUES ($1,$2,'Lote nuevo','Mango',2,'ha',$3,'mango')`, [nuevo, owner, randomUUID()]);
  const n = await rpcUsuario(owner, 'SELECT * FROM public.crear_nodo_virtual($1)', [nuevo]);
  const zonas = (await db.query('SELECT codigo, nombre, plano_x::float8 x, plano_y::float8 y, plano_ancho::float8 w, plano_alto::float8 h FROM public.zonas WHERE cultivo_id=$1 ORDER BY codigo', [nuevo])).rows;
  const referencia = (await db.query('SELECT codigo, nombre, plano_x::float8 x, plano_y::float8 y, plano_ancho::float8 w, plano_alto::float8 h FROM public.zonas WHERE cultivo_id=$1 ORDER BY codigo', [crop])).rows;
  assert.deepEqual(zonas, referencia, 'mismos codigos, nombres y geometria que provisionar-hexagonos.sql');
  assert.equal(n.codigo, prefijo(nuevo) + '01'); assert.equal(n.zona_id, (await one("SELECT id FROM public.zonas WHERE cultivo_id=$1 AND codigo='zona-central'", [nuevo])).id);
  const otro = await rpcUsuario(owner, 'SELECT * FROM public.crear_nodo_virtual($1,NULL)', [nuevo]);
  assert.equal(otro.codigo, prefijo(nuevo) + '02'); assert.equal((await one('SELECT codigo FROM public.zonas WHERE id=$1', [otro.zona_id])).codigo, 'zona-drenaje');
  assert.equal((await one('SELECT count(*)::int n FROM public.zonas WHERE cultivo_id=$1', [nuevo])).n, 4, 'no se duplican los sectores');
  assert.equal((await ingerirV3(await loteV3(n.codigo))).estado, 'insertado');
  // crear_nodo_virtual no crea reglas: las simuladas salen de aplicar_plantilla_cultivo con origen simulado.
  assert.equal((await one("SELECT count(*)::int n FROM public.reglas_alerta WHERE cultivo_id=$1", [nuevo])).n, 0);
  await rpcUsuario(owner, "SELECT public.aplicar_plantilla_cultivo($1,'mango',true,'simulado')", [nuevo]);
  assert.deepEqual((await db.query("SELECT variable_codigo FROM public.reglas_alerta WHERE cultivo_id=$1 AND origen='simulado' AND habilitada ORDER BY 1", [nuevo])).rows.map(r => r.variable_codigo),
    ['humedad_aire', 'humedad_suelo_vwc', 'temperatura_aire']);
});

test('nodos virtuales: retirar conserva el historial y permite volver a vincular con vincular_nodo y asignar_zona_nodo', async () => {
  const yuca = await cultivoDe('yuca'), hort = await cultivoDe('hortalizas'), codigo = prefijo(yuca) + '07', antes = await nodo(codigo);
  const retirar = (uid, id) => rpcUsuario(uid, 'SELECT * FROM public.retirar_nodo_virtual($1)', [id]);
  const mediciones = async () => (await one('SELECT count(*)::int n FROM public.mediciones WHERE nodo_id=$1', [antes.id])).n;
  assert.equal(await mediciones(), 10);
  await assert.rejects(retirar(other, antes.id), /NODO_NO_AUTORIZADO/);
  await assert.rejects(retirar(owner, (await nodo('agv-dht22-01')).id), /NODO_NO_VIRTUAL/);
  await assert.rejects(comoAnonimo(() => db.query('SELECT public.retirar_nodo_virtual($1)', [antes.id])), /permission denied/);
  const suelto = await retirar(owner, antes.id);
  assert.deepEqual([suelto.cultivo_id, suelto.zona_id, suelto.posicion_x, suelto.habilitado, suelto.codigo], [null, null, null, true, codigo]);
  assert.notEqual(suelto.asignacion_version, antes.asignacion_version);
  assert.equal(await mediciones(), 10, 'las mediciones se conservan');
  assert.equal((await one('SELECT count(*)::int n FROM public.nodo_variables WHERE nodo_id=$1', [antes.id])).n, 10);
  assert.deepEqual((await db.query('SELECT motivo FROM public.nodo_asignaciones WHERE nodo_id=$1 ORDER BY realizado_en', [antes.id])).rows.map(r => r.motivo), ['asignacion', 'desvinculacion']);
  assert.equal((await retirar(owner, antes.id)).cultivo_id, null, 'repetir no falla');
  // Suelto no recibe datos ni lo publica el servicio de simulacion.
  assert.equal((await ingerirV3(await loteV3(codigo))).estado, 'rechazado');
  assert.ok(!(await estadoSimulacion()).cultivos.some(c => c.nodos.some(x => x.codigo === codigo)));
  // El numero liberado en yuca no se reutiliza mientras el nodo retirado conserve su codigo.
  assert.equal((await rpcUsuario(owner, 'SELECT * FROM public.crear_nodo_virtual($1)', [yuca])).codigo, prefijo(yuca) + '17');
  // Secuencia de la web para vincular un virtual suelto: vincular_nodo y despues asignar_zona_nodo.
  const zona = (await one("SELECT id FROM public.zonas WHERE cultivo_id=$1 AND codigo='zona-sur'", [hort])).id;
  const vinculado = await rpcUsuario(owner, 'SELECT * FROM public.vincular_nodo($1,$2)', [antes.id, hort]);
  assert.deepEqual([vinculado.cultivo_id, vinculado.zona_id], [hort, null]);
  assert.equal((await ingerirV3(await loteV3(codigo))).codigo, 'NODO_SIN_ZONA_O_CULTIVO', 'vinculado sin sector todavia no recibe');
  const ubicado = await rpcUsuario(owner, 'SELECT * FROM public.asignar_zona_nodo($1,$2,$3,$4)', [antes.id, zona, 0.25, 0.3]);
  assert.deepEqual([ubicado.cultivo_id, ubicado.zona_id, Number(ubicado.posicion_x), Number(ubicado.posicion_y)], [hort, zona, 0.25, 0.3]);
  const g = await ingerirV3(await loteV3(codigo)); assert.equal(g.estado, 'insertado', JSON.stringify(g)); assert.equal(g.cultivo_id, hort);
  assert.deepEqual((await db.query('SELECT cultivo_id, count(*)::int n FROM public.mediciones WHERE nodo_id=$1 GROUP BY 1 ORDER BY 2', [antes.id])).rows.map(r => r.n), [10, 10], 'historial de ambos cultivos');
  assert.ok((await estadoSimulacion()).cultivos.find(c => c.cultivo_id === hort).nodos.some(x => x.codigo === codigo && x.zona === 'Sector sur'));
});

test('cultivo sin nodos (0011): crear_cultivo admite de 0 a 2 nodos; despues crear_nodo_virtual crea sectores y nodo y la plantilla deja las tres reglas simuladas', async () => {
  const literal = nodos => nodos === null ? null : '{' + nodos.map(x => x ?? 'NULL').join(',') + '}';
  const crear = (uid, nodos, solicitud = randomUUID(), nombre = 'Lote sin nodos') => rpcUsuario(uid,
    'SELECT * FROM public.crear_cultivo($1,$2,$3,$4,$5::uuid[],$6)', [nombre, 'Papaya', 1.5, 'ha', typeof nodos === 'string' ? nodos : literal(nodos), solicitud]);
  const nodosDe = async id => (await db.query('SELECT codigo FROM public.nodos WHERE cultivo_id=$1 ORDER BY codigo', [id])).rows.map(r => r.codigo);
  const solicitud = randomUUID(), c = await crear(owner, [], solicitud);
  assert.deepEqual([c.nombre, c.tipo, Number(c.area), c.unidad_area, c.agricultor_id, c.archivado_en, c.plantilla_codigo], ['Lote sin nodos', 'Papaya', 1.5, 'ha', owner, null, null]);
  assert.deepEqual(await nodosDe(c.id), []); assert.equal((await one('SELECT count(*)::int n FROM public.zonas WHERE cultivo_id=$1', [c.id])).n, 0);
  // Idempotencia por solicitud intacta: repetir (vacio o NULL) devuelve el mismo cultivo; otros datos, conflicto.
  assert.equal((await crear(owner, [], solicitud)).id, c.id); assert.equal((await crear(owner, null, solicitud)).id, c.id);
  await assert.rejects(crear(owner, [], solicitud, 'Otro nombre'), /SOLICITUD_EN_CONFLICTO/);
  const porNull = await crear(owner, null, randomUUID(), 'Lote con NULL');
  assert.notEqual(porNull.id, c.id); assert.deepEqual(await nodosDe(porNull.id), []);
  // Con nodos, las validaciones de siempre: maximo dos, sin repetidos ni nulos, una dimension, propios y libres.
  const libre = randomUUID(), ocupado = (await nodo('agv-dht22-01')).id;
  await db.query("INSERT INTO public.nodos (id,codigo,agricultor_id) VALUES ($1,'agv-libre-01',$2)", [libre, owner]);
  for (const malo of [[randomUUID(), randomUUID(), randomUUID()], [libre, libre], [libre, null], '{{' + libre + '},{' + randomUUID() + '}}'])
    await assert.rejects(crear(owner, malo), /DATOS_CULTIVO_INVALIDOS/, JSON.stringify(malo));
  for (const noDisponible of [[ocupado], [randomUUID()], [libre, ocupado]]) await assert.rejects(crear(owner, noDisponible), /NODOS_NO_DISPONIBLES/);
  await assert.rejects(crear(other, [libre]), /NODOS_NO_DISPONIBLES/, 'nodo de otra cuenta');
  await assert.rejects(rpcUsuario(owner, 'SELECT * FROM public.crear_cultivo($1,$2,$3,$4,$5::uuid[],$6)', ['', 'Papaya', 1, 'ha', '{}', randomUUID()]), /DATOS_CULTIVO_INVALIDOS/);
  await assert.rejects(comoAnonimo(() => db.query("SELECT public.crear_cultivo('X','Y',1,'ha','{}'::uuid[],$1)", [randomUUID()])), /permission denied/);
  const conNodo = await crear(owner, [libre], randomUUID(), 'Lote con un nodo');
  assert.deepEqual(await nodosDe(conNodo.id), ['agv-libre-01']);
  assert.equal((await crear(other, [], randomUUID(), 'De otra cuenta')).agricultor_id, other);
  assert.equal(await comoUsuario(other, async () => (await one('SELECT count(*)::int n FROM public.cultivos')).n), 1, 'cada cuenta solo ve los suyos');
  // Sin nodos el servicio de simulacion no lo lista; editar funciona igual.
  assert.ok(!(await estadoSimulacion()).cultivos.some(x => x.cultivo_id === c.id));
  assert.equal((await rpcUsuario(owner, 'SELECT * FROM public.editar_cultivo($1,$2,$3,$4,$5)', [c.id, 'Lote de papaya', 'Papaya', 2, 'ha'])).nombre, 'Lote de papaya');
  // Primer nodo simulado: nacen los cuatro sectores y el nodo 01 en el sector con menos nodos.
  const n = await rpcUsuario(owner, 'SELECT * FROM public.crear_nodo_virtual($1)', [c.id]);
  assert.deepEqual((await db.query('SELECT codigo FROM public.zonas WHERE cultivo_id=$1 ORDER BY codigo', [c.id])).rows.map(z => z.codigo), ['zona-central', 'zona-drenaje', 'zona-norte', 'zona-sur']);
  assert.deepEqual([n.codigo, n.tipo_nodo, n.cultivo_id, n.habilitado], [prefijo(c.id) + '01', 'virtual', c.id, true]);
  assert.equal((await one('SELECT codigo FROM public.zonas WHERE id=$1', [n.zona_id])).codigo, 'zona-central');
  assert.equal((await one("SELECT count(*)::int n FROM public.nodo_variables WHERE nodo_id=$1 AND sensor_modelo='SIMULADOR_V3'", [n.id])).n, 10);
  assert.ok((await estadoSimulacion()).cultivos.find(x => x.cultivo_id === c.id).nodos.some(x => x.codigo === n.codigo && x.zona === 'Sector central'));
  // La plantilla con origen simulado deja las tres reglas simuladas y ninguna real.
  assert.equal((await one('SELECT count(*)::int n FROM public.reglas_alerta WHERE cultivo_id=$1', [c.id])).n, 0);
  const conPlantilla = await rpcUsuario(owner, "SELECT * FROM public.aplicar_plantilla_cultivo($1,'papaya',true,'simulado')", [c.id]);
  assert.equal(conPlantilla.plantilla_codigo, 'papaya');
  const reglas = (await db.query('SELECT variable_codigo, origen, minimo::float8 mn, maximo::float8 mx FROM public.reglas_alerta WHERE cultivo_id=$1 AND habilitada ORDER BY 1', [c.id])).rows;
  assert.deepEqual(reglas, [{ variable_codigo: 'humedad_aire', origen: 'simulado', mn: 50, mx: 90 }, { variable_codigo: 'humedad_suelo_vwc', origen: 'simulado', mn: 20, mx: 40 },
    { variable_codigo: 'temperatura_aire', origen: 'simulado', mn: 18, mx: 34 }]);
  // De punta a punta: un lote v3 del nodo nuevo se guarda y abre la alerta de temperatura de la plantilla.
  const lote = await loteV3(n.codigo, { temperatura_aire: 36 }), g = await ingerirV3(lote);
  assert.equal(g.estado, 'insertado', JSON.stringify(g)); assert.equal(g.cultivo_id, c.id);
  const ev = (await rpcServidor('SELECT public.evaluar_alertas_lote($1,$2) AS r', [n.id, lote.payload.mensaje_id])).r;
  assert.equal(ev.abiertas, 1, JSON.stringify(ev));
  // Como antes de la 0011, repetir la solicitud original cuando los nodos del cultivo ya cambiaron es un conflicto.
  await assert.rejects(crear(owner, [], solicitud, 'Lote de papaya'), /SOLICITUD_EN_CONFLICTO/);
  // Archivar un cultivo sin nodos tambien funciona.
  assert.ok((await rpcUsuario(owner, 'SELECT * FROM public.archivar_cultivo($1)', [porNull.id])).archivado_en);
});

// ---- 0011: mover y eliminar nodos virtuales, eliminar cultivos sin historial ----
const cultivoNuevo = async (nombre, uid = owner, nodos = '{}') => rpcUsuario(uid, 'SELECT * FROM public.crear_cultivo($1,$2,$3,$4,$5::uuid[],$6)', [nombre, 'Yuca', 1, 'ha', nodos, randomUUID()]);
const virtualNuevo = (cultivo, zona = null) => rpcUsuario(owner, 'SELECT * FROM public.crear_nodo_virtual($1,$2)', [cultivo, zona]);
const mover = (uid, n, cultivo, zona = null) => rpcUsuario(uid, 'SELECT * FROM public.mover_nodo_virtual($1,$2,$3)', [n, cultivo, zona]);
const eliminarNodo = async (uid, n) => (await rpcUsuario(uid, 'SELECT public.eliminar_nodo_virtual($1) AS r', [n])).r;
const eliminarCultivo = async (uid, c) => (await rpcUsuario(uid, 'SELECT public.eliminar_cultivo($1) AS r', [c])).r;
const zonaDe = async (cultivo, codigo) => (await one('SELECT id FROM public.zonas WHERE cultivo_id=$1 AND codigo=$2', [cultivo, codigo])).id;
const codigoZona = async id => id === null ? null : (await one('SELECT codigo FROM public.zonas WHERE id=$1', [id])).codigo;
const red = uid => comoUsuario(uid, async () => (await db.query('SELECT codigo FROM public.estado_red_nodos()')).rows.map(r => r.codigo));
const enSimulacion = async codigo => (await estadoSimulacion()).cultivos.filter(c => c.nodos.some(x => x.codigo === codigo)).map(c => c.cultivo_id);

test('mover nodo virtual: a otro cultivo (creando sus sectores), de sector, desde suelto; conserva codigo, capacidades e historial; limite y permisos', async () => {
  const a = await cultivoNuevo('Origen de nodos'), b = await cultivoNuevo('Destino de nodos');
  await rpcUsuario(owner, "SELECT * FROM public.aplicar_plantilla_cultivo($1,'yuca',true,'simulado')", [a.id]);
  const n1 = await virtualNuevo(a.id), n2 = await virtualNuevo(a.id), n3 = await virtualNuevo(a.id);
  // n1 deja historial en el cultivo de origen: un lote con temperatura alta que abre una alerta.
  const lote = await loteV3(n1.codigo, { temperatura_aire: 40 }); assert.equal((await ingerirV3(lote)).estado, 'insertado');
  assert.equal((await rpcServidor('SELECT public.evaluar_alertas_lote($1,$2) AS r', [n1.id, lote.payload.mensaje_id])).r.abiertas, 1);
  // Errores con los codigos ya usados.
  const ajeno = (await comoUsuario(other, async () => one('SELECT id FROM public.cultivos LIMIT 1'))).id;
  await assert.rejects(mover(other, n1.id, b.id), /CULTIVO_NO_AUTORIZADO/); await assert.rejects(mover(other, n1.id, ajeno), /NODO_NO_AUTORIZADO/);
  await assert.rejects(mover(owner, n1.id, ajeno), /CULTIVO_NO_AUTORIZADO/); await assert.rejects(mover(owner, randomUUID(), b.id), /NODO_NO_AUTORIZADO/);
  await assert.rejects(mover(owner, (await nodo('agv-dht22-01')).id, b.id), /NODO_NO_VIRTUAL/);
  await assert.rejects(mover(owner, n1.id, (await one("SELECT id FROM public.cultivos WHERE nombre='Archivado'")).id), /CULTIVO_ARCHIVADO/);
  await assert.rejects(mover(owner, n1.id, b.id, await zonaDe(a.id, 'zona-norte')), /ZONA_NO_AUTORIZADA/);
  assert.equal((await one('SELECT count(*)::int n FROM public.zonas WHERE cultivo_id=$1', [b.id])).n, 0, 'un movimiento rechazado no deja sectores a medias');
  await assert.rejects(comoAnonimo(() => db.query('SELECT public.mover_nodo_virtual($1,$2)', [n1.id, b.id])), /permission denied/);
  await assert.rejects(comoServidor(() => db.query('SELECT public.mover_nodo_virtual($1,$2)', [n1.id, b.id])), /permission denied/);
  // A otro cultivo sin sectores: se crean los cuatro y el nodo va al de menos nodos.
  const m = await mover(owner, n1.id, b.id);
  assert.deepEqual([m.id, m.codigo, m.cultivo_id, await codigoZona(m.zona_id), m.habilitado, Number(m.posicion_x), Number(m.posicion_y)], [n1.id, n1.codigo, b.id, 'zona-central', true, 0.5, 0.5]);
  assert.notEqual(m.asignacion_version, n1.asignacion_version);
  assert.equal((await one('SELECT count(*)::int n FROM public.zonas WHERE cultivo_id=$1', [b.id])).n, 4);
  assert.equal((await one("SELECT count(*)::int n FROM public.nodo_variables WHERE nodo_id=$1 AND sensor_modelo='SIMULADOR_V3'", [n1.id])).n, 10);
  assert.deepEqual((await db.query('SELECT cultivo_id, count(*)::int n FROM public.mediciones WHERE nodo_id=$1 GROUP BY 1', [n1.id])).rows, [{ cultivo_id: a.id, n: 10 }], 'las mediciones anteriores siguen en su cultivo');
  assert.deepEqual(await one('SELECT motivo_cierre, cerrada_en IS NOT NULL AS cerrada FROM public.alertas WHERE nodo_id=$1', [n1.id]), { motivo_cierre: 'nodo_desvinculado', cerrada: true });
  assert.deepEqual((await db.query('SELECT motivo, cultivo_anterior_id, cultivo_nuevo_id FROM public.nodo_asignaciones WHERE nodo_id=$1 ORDER BY realizado_en', [n1.id])).rows.map(r => [r.motivo, r.cultivo_anterior_id, r.cultivo_nuevo_id]),
    [['asignacion', null, a.id], ['cambio', a.id, b.id], ['cambio', b.id, b.id]], 'auditoria: alta, cambio de cultivo y sector nuevo');
  // El servicio de simulacion lo lista en su cultivo nuevo y sus lotes se guardan alli.
  assert.deepEqual(await enSimulacion(n1.codigo), [b.id]);
  const g = await ingerirV3(await loteV3(n1.codigo)); assert.equal(g.estado, 'insertado', JSON.stringify(g)); assert.equal(g.cultivo_id, b.id);
  // Mismo cultivo: solo cambia de sector. Repetir no cambia nada. Sin sector indicado va al de menos nodos sin contarse a si mismo.
  const norte = await zonaDe(b.id, 'zona-norte'), s1 = await mover(owner, n1.id, b.id, norte);
  assert.deepEqual([s1.cultivo_id, s1.zona_id], [b.id, norte]); assert.notEqual(s1.asignacion_version, m.asignacion_version);
  assert.equal((await mover(owner, n1.id, b.id, norte)).asignacion_version, s1.asignacion_version);
  assert.equal(await codigoZona((await mover(owner, n1.id, b.id)).zona_id), 'zona-central');
  // Desde suelto: queda vinculado y ubicado en una sola llamada.
  await rpcUsuario(owner, 'SELECT * FROM public.retirar_nodo_virtual($1)', [n2.id]);
  const m2 = await mover(owner, n2.id, b.id);
  assert.deepEqual([m2.cultivo_id, await codigoZona(m2.zona_id), m2.codigo], [b.id, 'zona-drenaje', n2.codigo]);
  // Limite de 16 virtuales en el destino; dentro del mismo cultivo se puede seguir cambiando de sector.
  for (let i = 0; i < 14; i++) await virtualNuevo(b.id);
  await assert.rejects(mover(owner, n3.id, b.id), /LIMITE_NODOS_CULTIVO/);
  assert.equal((await nodo(n3.codigo)).cultivo_id, a.id, 'el nodo rechazado sigue donde estaba');
  assert.equal((await mover(owner, n1.id, b.id, norte)).zona_id, norte);
  assert.equal((await one('SELECT count(*)::int n FROM (SELECT zona_id, posicion_x, posicion_y FROM public.nodos WHERE cultivo_id=$1 GROUP BY 1,2,3 HAVING count(*)>1) d', [b.id])).n, 0, 'sin nodos encimados');
});

test('eliminar nodo virtual: sin mediciones se borra de verdad; con mediciones queda retirado, invisible para la red y la simulacion, y no vuelve a usarse', async () => {
  const a = (await one("SELECT id FROM public.cultivos WHERE nombre='Origen de nodos'")).id, b = (await one("SELECT id FROM public.cultivos WHERE nombre='Destino de nodos'")).id;
  const conDatos = await nodo(prefijo(a) + '01'), sinDatos = await virtualNuevo(a);
  assert.equal(conDatos.cultivo_id, b); assert.equal((await one('SELECT count(*)::int n FROM public.mediciones WHERE nodo_id=$1', [conDatos.id])).n, 20);
  await assert.rejects(eliminarNodo(other, sinDatos.id), /NODO_NO_AUTORIZADO/); await assert.rejects(eliminarNodo(owner, randomUUID()), /NODO_NO_AUTORIZADO/);
  await assert.rejects(eliminarNodo(owner, (await nodo('agv-dht22-01')).id), /NODO_NO_VIRTUAL/);
  await assert.rejects(comoAnonimo(() => db.query('SELECT public.eliminar_nodo_virtual($1)', [sinDatos.id])), /permission denied/);
  await assert.rejects(comoServidor(() => db.query('SELECT public.eliminar_nodo_virtual($1)', [sinDatos.id])), /permission denied/);
  await assert.rejects(comoUsuario(owner, () => db.query('DELETE FROM public.nodos WHERE id=$1', [sinDatos.id])), /permission denied/);
  await assert.rejects(comoUsuario(owner, () => db.query('UPDATE public.nodos SET eliminado_en=now() WHERE id=$1', [sinDatos.id])), /permission denied/);
  // Sin mediciones: desaparece con sus capacidades y su historial de asignaciones, y su codigo vuelve a estar libre.
  assert.deepEqual(await eliminarNodo(owner, sinDatos.id), { codigo: 'NODO_ELIMINADO', modo: 'borrado', nodo_id: sinDatos.id });
  for (const tabla of ['nodos WHERE id', 'nodo_variables WHERE nodo_id', 'nodo_asignaciones WHERE nodo_id'])
    assert.equal((await one(`SELECT count(*)::int n FROM public.${tabla}=$1`, [sinDatos.id])).n, 0, tabla);
  await assert.rejects(eliminarNodo(owner, sinDatos.id), /NODO_NO_AUTORIZADO/);
  assert.equal((await virtualNuevo(a)).codigo, sinDatos.codigo, 'un codigo que nunca tuvo datos se puede reutilizar');
  // Con mediciones (y vinculado): se desvincula y queda marcado; no se pierde nada.
  const r = await eliminarNodo(owner, conDatos.id);
  assert.deepEqual(r, { codigo: 'NODO_ELIMINADO', modo: 'retirado', nodo_id: conDatos.id });
  const fila = await nodo(conDatos.codigo);
  assert.deepEqual([fila.cultivo_id, fila.zona_id, fila.habilitado, fila.tipo_nodo], [null, null, false, 'virtual']); assert.ok(fila.eliminado_en);
  assert.equal((await one('SELECT count(*)::int n FROM public.mediciones WHERE nodo_id=$1', [conDatos.id])).n, 20, 'las mediciones se conservan');
  assert.equal((await one('SELECT count(*)::int n FROM public.nodo_variables WHERE nodo_id=$1', [conDatos.id])).n, 10);
  assert.deepEqual(await eliminarNodo(owner, conDatos.id), r, 'repetir devuelve lo mismo');
  // No aparece en la red ni en la simulacion; la tabla nodos si lo muestra a su cuenta, con la columna para filtrar.
  assert.ok(!(await red(owner)).includes(conDatos.codigo)); assert.deepEqual(await enSimulacion(conDatos.codigo), []);
  const visibles = await comoUsuario(owner, async () => (await db.query('SELECT codigo, eliminado_en FROM public.nodos WHERE codigo=$1', [conDatos.codigo])).rows);
  assert.equal(visibles.length, 1); assert.ok(visibles[0].eliminado_en, 'la web filtra con eliminado_en is null');
  assert.equal(await comoUsuario(owner, async () => (await one('SELECT count(*)::int n FROM public.nodos WHERE eliminado_en IS NULL AND codigo=$1', [conDatos.codigo])).n), 0);
  assert.equal(await comoUsuario(other, async () => (await one('SELECT count(*)::int n FROM public.nodos WHERE codigo=$1', [conDatos.codigo])).n), 0);
  // No se vincula, no se mueve, no recibe lotes, no sirve para crear un cultivo y su codigo no se reutiliza.
  await assert.rejects(rpcUsuario(owner, 'SELECT * FROM public.vincular_nodo($1,$2)', [conDatos.id, a]), /NODO_ELIMINADO/);
  await assert.rejects(mover(owner, conDatos.id, a), /NODO_ELIMINADO/);
  assert.deepEqual(await ingerirV3(await loteV3(conDatos.codigo)), { estado: 'rechazado', codigo: 'NODO_DESHABILITADO' });
  assert.equal((await one('SELECT count(*)::int n FROM public.mediciones WHERE nodo_id=$1', [conDatos.id])).n, 20);
  await assert.rejects(cultivoNuevo('Con nodo eliminado', owner, '{' + conDatos.id + '}'), /NODOS_NO_DISPONIBLES/);
  assert.equal((await rpcUsuario(owner, 'SELECT * FROM public.retirar_nodo_virtual($1)', [conDatos.id])).cultivo_id, null);
  const codigos = []; for (let i = 0; i < 3; i++) codigos.push((await virtualNuevo(a)).codigo);
  assert.ok(!codigos.includes(conDatos.codigo), 'el codigo de un nodo retirado con historial queda reservado');
  // El estado eliminado no se deshace ni con permisos de administracion; la auditoria sigue siendo inmutable.
  await assert.rejects(db.query('UPDATE public.nodos SET habilitado=true WHERE id=$1', [conDatos.id]), /nodo_eliminado_inactivo/);
  await assert.rejects(db.query('UPDATE public.nodos SET cultivo_id=$2 WHERE id=$1', [conDatos.id, a]), /nodo_eliminado_inactivo/);
  await assert.rejects(db.query('DELETE FROM public.nodo_asignaciones WHERE nodo_id=$1', [conDatos.id]), /no se modifica ni se borra/);
  await assert.rejects(db.query("UPDATE public.nodo_asignaciones SET motivo='cambio' WHERE nodo_id=$1", [conDatos.id]), /no se modifica ni se borra/);
  // Un nodo suelto sin mediciones tambien se borra.
  const suelto = await virtualNuevo(a); await rpcUsuario(owner, 'SELECT * FROM public.retirar_nodo_virtual($1)', [suelto.id]);
  assert.equal((await eliminarNodo(owner, suelto.id)).modo, 'borrado');
});

test('eliminar cultivo: solo sin historial; libera fisicos y virtuales y borra sectores, parametros, reglas, clima, ajustes, solicitudes y auditoria', async () => {
  const a = (await one("SELECT id FROM public.cultivos WHERE nombre='Origen de nodos'")).id;
  // Con historial no se elimina: mediciones y alertas (cultivo de origen) o una sugerencia.
  await assert.rejects(eliminarCultivo(owner, a), /CULTIVO_CON_HISTORIAL/); await assert.rejects(eliminarCultivo(owner, crop), /CULTIVO_CON_HISTORIAL/);
  const conSugerencia = await cultivoNuevo('Solo con sugerencia');
  await db.query("INSERT INTO public.sugerencias_ia (cultivo_id,origen,motivo,estado,contexto,error_codigo,completada_en) VALUES ($1,'simulado','solicitud','fallida','{}','PRUEBA',now())", [conSugerencia.id]);
  await assert.rejects(eliminarCultivo(owner, conSugerencia.id), /CULTIVO_CON_HISTORIAL/);
  assert.ok(await one('SELECT 1 AS x FROM public.cultivos WHERE id=$1', [a]), 'el rechazo no borra nada');
  // Cultivo completo sin historial: un fisico, dos virtuales, sectores, reglas, parametros, clima, ajuste y una solicitud abierta.
  const fisico = randomUUID(); await db.query("INSERT INTO public.nodos (id,codigo,agricultor_id) VALUES ($1,'agv-libre-02',$2)", [fisico, owner]);
  const c = await cultivoNuevo('Para eliminar', owner, '{' + fisico + '}');
  const v1 = await virtualNuevo(c.id), v2 = await virtualNuevo(c.id);
  await rpcUsuario(owner, "SELECT * FROM public.aplicar_plantilla_cultivo($1,'mango',true,'simulado')", [c.id]);
  await rpcUsuario(owner, "SELECT * FROM public.aplicar_plantilla_cultivo($1,'mango',true,'real')", [c.id]);
  await rpcUsuario(owner, 'SELECT public.ajustar_parametros_cultivo($1,$2,false,$3)', [c.id, JSON.stringify({ temperatura_min: 20, temperatura_optima_min: 24, temperatura_optima_max: 28, temperatura_max: 33,
    humedad_min: 45, humedad_optima_min: 55, humedad_optima_max: 75, humedad_max: 88, suelo_vwc_min: 18, suelo_vwc_optima_min: 22, suelo_vwc_optima_max: 32, suelo_vwc_max: 42 }), 'simulado']);
  await rpcUsuario(owner, "SELECT public.establecer_clima($1,'lluvia',2,false)", [c.id]); await rpcUsuario(owner, "SELECT public.establecer_clima($1,'viento',1,false)", [c.id]);
  await ajustar(owner, c.id, { temperatura_aire: 3 }); await ajustar(owner, c.id, { ph_suelo: 1 });
  assert.equal((await solicitar(owner, c.id, 'simulado')).r.codigo, 'SOLICITUD_REGISTRADA');
  await mover(owner, v2.id, c.id, await zonaDe(c.id, 'zona-norte'));
  const cuenta = async () => Object.fromEntries(await Promise.all(['zonas', 'reglas_alerta', 'cultivo_parametros', 'clima_cultivo', 'ajustes_simulacion', 'solicitudes_ia'].map(async t =>
    [t, (await one(`SELECT count(*)::int n FROM public.${t} WHERE cultivo_id=$1`, [c.id])).n])));
  const auditoria = async () => (await one(`SELECT count(*)::int n FROM public.nodo_asignaciones WHERE cultivo_anterior_id=$1 OR cultivo_nuevo_id=$1`, [c.id])).n;
  assert.deepEqual(await cuenta(), { zonas: 4, reglas_alerta: 5, cultivo_parametros: 1, clima_cultivo: 2, ajustes_simulacion: 2, solicitudes_ia: 1 }); assert.ok(await auditoria() >= 4);
  await assert.rejects(eliminarCultivo(other, c.id), /CULTIVO_NO_AUTORIZADO/); await assert.rejects(eliminarCultivo(owner, randomUUID()), /CULTIVO_NO_AUTORIZADO/);
  await assert.rejects(comoAnonimo(() => db.query('SELECT public.eliminar_cultivo($1)', [c.id])), /permission denied/);
  await assert.rejects(comoServidor(() => db.query('SELECT public.eliminar_cultivo($1)', [c.id])), /permission denied/);
  await assert.rejects(comoUsuario(owner, () => db.query('DELETE FROM public.cultivos WHERE id=$1', [c.id])), /permission denied/);
  const totalAntes = (await one('SELECT count(*)::int n FROM public.mediciones')).n;
  assert.deepEqual(await eliminarCultivo(owner, c.id), { codigo: 'CULTIVO_ELIMINADO', cultivo_id: c.id, nodos_liberados: 3 });
  assert.equal((await one('SELECT count(*)::int n FROM public.cultivos WHERE id=$1', [c.id])).n, 0);
  assert.deepEqual(await cuenta(), { zonas: 0, reglas_alerta: 0, cultivo_parametros: 0, clima_cultivo: 0, ajustes_simulacion: 0, solicitudes_ia: 0 }); assert.equal(await auditoria(), 0);
  assert.equal((await one('SELECT count(*)::int n FROM public.mediciones')).n, totalAntes, 'no se toca ninguna medicion');
  await assert.rejects(eliminarCultivo(owner, c.id), /CULTIVO_NO_AUTORIZADO/, 'ya no existe');
  // El fisico queda disponible y los virtuales sueltos, sin borrarlos ni marcarlos.
  const libres = (await db.query('SELECT codigo, tipo_nodo, cultivo_id, zona_id, habilitado, eliminado_en FROM public.nodos WHERE id = ANY($1::uuid[]) ORDER BY codigo', ['{' + [fisico, v1.id, v2.id].join(',') + '}'])).rows;
  assert.deepEqual(libres.map(n => [n.tipo_nodo, n.cultivo_id, n.zona_id, n.habilitado, n.eliminado_en]), [['fisico', null, null, true, null], ['virtual', null, null, true, null], ['virtual', null, null, true, null]]);
  assert.equal((await one("SELECT count(*)::int n FROM public.nodo_variables WHERE nodo_id=$1", [v1.id])).n, 10);
  // Se reutilizan: el fisico en un cultivo nuevo y un virtual movido a otro cultivo.
  const otro = await cultivoNuevo('Reutiliza nodos', owner, '{' + fisico + '}');
  assert.equal((await nodo('agv-libre-02')).cultivo_id, otro.id);
  const movido = await mover(owner, v1.id, otro.id);
  assert.deepEqual([movido.cultivo_id, movido.codigo, await codigoZona(movido.zona_id)], [otro.id, v1.codigo, 'zona-central']);
  assert.equal((await ingerirV3(await loteV3(v1.codigo))).estado, 'insertado');
  await assert.rejects(eliminarCultivo(owner, otro.id), /CULTIVO_CON_HISTORIAL/, 'con su primera medicion ya tiene historial');
  // Un cultivo archivado y sin historial tambien se puede eliminar; uno vacio recien creado, igual.
  const archivado = (await one("SELECT id FROM public.cultivos WHERE nombre='Lote con NULL'")).id;
  assert.deepEqual(await eliminarCultivo(owner, archivado), { codigo: 'CULTIVO_ELIMINADO', cultivo_id: archivado, nodos_liberados: 0 });
  const vacio = await cultivoNuevo('Vacio');
  assert.equal((await eliminarCultivo(owner, vacio.id)).nodos_liberados, 0);
});

test('regresion: las pruebas previas de alertas, nodos, cultivos e ingesta siguen pasando despues de 0011', async () => {
  for (const f of ['probar-alertas.sql', 'probar-gestion-nodos.sql', 'probar-gestion-cultivos.sql'])
    assert.match((await db.exec(sql(f))).at(-1).rows[0].resultado, /^OK:/, f);
  assert.equal((await db.exec(sql('probar-ingesta-ambiental.sql'))).at(-1).rows.length, 6);
});
