// Pruebas locales de 0012 (terreno real, sectores libres, ubicacion de nodos y nodos fisicos autogestionados
// con clave propia) en PGlite (PostgreSQL en memoria). No es Supabase remoto, ni JWT/HTTP real. Datos ficticios.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { faseClima, leerEstado, loteVirtual } from '../../simulador/clima-modelo.mjs';
import { prepararIngestaSimulada } from '../../n8n/preparar-simulada.mjs';
import { createRequire } from 'node:module';
const { prevalidarAmbiental } = createRequire(import.meta.url)('../../n8n/validar-ambiental.cjs');
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

async function comoServidor(fn) { await db.exec('SET ROLE service_role'); try { return await fn(); } finally { await db.exec('RESET ROLE'); } }
async function comoAnonimo(fn) { await db.exec('SET ROLE anon'); try { return await fn(); } finally { await db.exec('RESET ROLE'); } }
async function comoUsuario(uid, fn) {
  await db.exec('SET ROLE authenticated');
  try { await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [uid]); return await fn(); }
  finally { await db.query("SELECT set_config('request.jwt.claim.sub','',false)"); await db.exec('RESET ROLE'); }
}
const rpc = (uid, q, p = []) => comoUsuario(uid, async () => (await db.query(q, p)).rows[0]);
const servidor = (q, p = []) => comoServidor(async () => (await db.query(q, p)).rows[0]);
const nodo = async codigo => one('SELECT * FROM public.nodos WHERE codigo=$1', [codigo]);
const cultivoNuevo = (nombre, uid = owner) => rpc(uid, "SELECT * FROM public.crear_cultivo($1,'Yuca',1,'ha','{}'::uuid[],$2)", [nombre, randomUUID()]);
const sector = (uid, cultivo, nombre, x, y, w, h) => rpc(uid, 'SELECT * FROM public.crear_sector($1,$2,$3,$4,$5,$6)', [cultivo, nombre, x, y, w, h]);
const editar = (uid, zona, nombre, x, y, w, h) => rpc(uid, 'SELECT * FROM public.editar_sector($1,$2,$3,$4,$5,$6)', [zona, nombre, x, y, w, h]);
const eliminarSector = async (uid, zona) => (await rpc(uid, 'SELECT public.eliminar_sector($1) AS r', [zona])).r;
const virtual = (cultivo, zona = null) => rpc(owner, 'SELECT * FROM public.crear_nodo_virtual($1,$2)', [cultivo, zona]);
const ubicar = (uid, n, zona, x, y) => rpc(uid, 'SELECT * FROM public.ubicar_nodo($1,$2,$3,$4)', [n, zona, x, y]);
const registrar = async (uid, tipo, sensores) => (await rpc(uid, 'SELECT public.registrar_nodo_fisico($1,$2::text[]) AS r', [tipo, sensores === null ? null : '{' + sensores.join(',') + '}'])).r;
const autenticar = async (codigo, clave) => (await servidor('SELECT public.autenticar_nodo($1,$2) AS r', [codigo, clave])).r;
const estadoSimulacion = async () => (await servidor('SELECT public.estado_simulacion() AS r')).r;
const ahoraIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
function loteReal(codigo, t = 28.4, h = 70, adc = 2048) {
  return { version: 2, nodo_codigo: codigo, mensaje_id: randomUUID(), origen: 'real', tomada_en: ahoraIso(),
    mediciones: [{ variable_codigo: 'temperatura_aire', valor: t, unidad: '°C' }, { variable_codigo: 'humedad_aire', valor: h, unidad: '% HR' },
      { variable_codigo: 'iluminacion_relativa', valor: Math.round(adc * 1000 / 4095) / 10, unidad: '% relativo' }], ldr: { metodo: 'adc12_10k_11db_v1', adc_promedio: adc } };
}
const ingerirReal = async lote => (await servidor('SELECT public.registrar_lote_ambiental($1,$2,clock_timestamp(),true,NULL,true) AS r',
  ['agrovigia/v2/real/nodos/' + lote.nodo_codigo + '/telemetria', JSON.stringify(lote)])).r;
const ingerirV3 = async p => (await servidor('SELECT public.registrar_lote_simulado_v3($1,$2,clock_timestamp(),true,NULL,true) AS r', [p.topico, p.mensaje])).r;

test('terreno real: ancho y largo en metros, ambos o ninguno, entre 1 y 20000; validacion, permisos y RLS', async () => {
  const c = await cultivoNuevo('Con terreno');
  assert.deepEqual([c.ancho_m, c.largo_m], [null, null]);
  const terreno = (uid, id, a, l) => rpc(uid, 'SELECT * FROM public.definir_terreno($1,$2,$3)', [id, a, l]);
  const t = await terreno(owner, c.id, 120.456, 80);
  assert.deepEqual([Number(t.ancho_m), Number(t.largo_m), t.id], [120.46, 80, c.id], 'dos decimales');
  assert.deepEqual([Number((await terreno(owner, c.id, 1, 20000)).ancho_m), Number((await one('SELECT largo_m FROM public.cultivos WHERE id=$1', [c.id])).largo_m)], [1, 20000]);
  for (const [a, l] of [[null, 50], [50, null], [0.5, 50], [50, 0.99], [20000.01, 50], [50, 30000], [-3, 50], ['NaN', 50], [50, 'Infinity']])
    await assert.rejects(terreno(owner, c.id, a, l), /TERRENO_INVALIDO/, JSON.stringify([a, l]));
  await assert.rejects(terreno(other, c.id, 10, 10), /CULTIVO_NO_AUTORIZADO/);
  await assert.rejects(comoAnonimo(() => db.query('SELECT public.definir_terreno($1,10,10)', [c.id])), /permission denied/);
  await assert.rejects(comoUsuario(owner, () => db.query('UPDATE public.cultivos SET ancho_m=5, largo_m=5 WHERE id=$1', [c.id])), /permission denied/);
  await assert.rejects(db.query('UPDATE public.cultivos SET ancho_m=5, largo_m=NULL WHERE id=$1', [c.id]), /cultivo_terreno/);
  assert.equal(Number((await comoUsuario(owner, async () => one('SELECT ancho_m FROM public.cultivos WHERE id=$1', [c.id]))).ancho_m), 1, 'la cuenta lee sus columnas');
  const sin = await terreno(owner, c.id, null, null);
  assert.deepEqual([sin.ancho_m, sin.largo_m], [null, null], 'ambos NULL lo borra');
  await rpc(owner, 'SELECT * FROM public.archivar_cultivo($1)', [c.id]);
  await assert.rejects(terreno(owner, c.id, 10, 10), /CULTIVO_ARCHIVADO/);
});

test('sectores libres: crear con codigo sector-NN, solapados, limite de 24, editar (tambien los de defecto) y validacion', async () => {
  const c = await cultivoNuevo('Sectores libres');
  const s1 = await sector(owner, c.id, '  Lote alto  ', 0.1, 0.123456, 0.3, 0.25);
  assert.deepEqual([s1.codigo, s1.nombre, Number(s1.plano_x), Number(s1.plano_y), Number(s1.plano_ancho), Number(s1.plano_alto), s1.cultivo_id, s1.eliminada_en],
    ['sector-01', 'Lote alto', 0.1, 0.1235, 0.3, 0.25, c.id, null]);
  const s2 = await sector(owner, c.id, 'Encima del primero', 0.2, 0.2, 0.3, 0.3);
  assert.equal(s2.codigo, 'sector-02', 'pueden solaparse');
  assert.equal((await sector(owner, c.id, 'Todo el terreno', 0, 0, 1, 1)).codigo, 'sector-03');
  assert.equal((await sector(owner, c.id, 'Minimo', 0.98, 0.98, 0.02, 0.02)).codigo, 'sector-04');
  for (const [nombre, x, y, w, h] of [['', 0, 0, 0.5, 0.5], ['   ', 0, 0, 0.5, 0.5], ['x'.repeat(61), 0, 0, 0.5, 0.5], [null, 0, 0, 0.5, 0.5], ['A', -0.01, 0, 0.5, 0.5], ['A', 0, 1.2, 0.5, 0.5],
    ['A', 0, 0, 0.019, 0.5], ['A', 0, 0, 0.5, 0.01], ['A', 0.6, 0, 0.5, 0.5], ['A', 0, 0.9, 0.5, 0.2], ['A', null, 0, 0.5, 0.5], ['A', 'NaN', 0, 0.5, 0.5], ['A', 0, 0, 1.5, 0.5]])
    await assert.rejects(sector(owner, c.id, nombre, x, y, w, h), /SECTOR_INVALIDO/, JSON.stringify([nombre, x, y, w, h]).slice(0, 60));
  await assert.rejects(sector(other, c.id, 'Ajeno', 0, 0, 0.5, 0.5), /CULTIVO_NO_AUTORIZADO/);
  await assert.rejects(comoAnonimo(() => db.query("SELECT public.crear_sector($1,'A',0,0,0.5,0.5)", [c.id])), /permission denied/);
  await assert.rejects(comoUsuario(owner, () => db.query("INSERT INTO public.zonas (cultivo_id,codigo,nombre,plano_x,plano_y,plano_ancho,plano_alto) VALUES ($1,'directa','X',0,0,0.5,0.5)", [c.id])), /permission denied/);
  assert.equal(await comoUsuario(other, async () => (await one('SELECT count(*)::int n FROM public.zonas WHERE cultivo_id=$1', [c.id])).n), 0);
  // Editar: nombre y geometria; los nodos del sector conservan su posicion relativa.
  const n = await virtual(c.id, s1.id); await ubicar(owner, n.id, s1.id, 0.2, 0.8);
  const e = await editar(owner, s1.id, 'Lote alto ampliado', 0.05, 0.05, 0.5, 0.4);
  assert.deepEqual([e.id, e.codigo, e.nombre, Number(e.plano_x), Number(e.plano_ancho), Number(e.plano_alto)], [s1.id, 'sector-01', 'Lote alto ampliado', 0.05, 0.5, 0.4]);
  const despues = await nodo(n.codigo);
  assert.deepEqual([despues.zona_id, Number(despues.posicion_x), Number(despues.posicion_y), despues.asignacion_version], [s1.id, 0.2, 0.8, (await nodo(n.codigo)).asignacion_version]);
  await assert.rejects(editar(owner, s1.id, 'Mal', 0.9, 0, 0.5, 0.5), /SECTOR_INVALIDO/);
  await assert.rejects(editar(other, s1.id, 'Ajeno', 0, 0, 0.5, 0.5), /ZONA_NO_AUTORIZADA/); await assert.rejects(editar(owner, randomUUID(), 'Nada', 0, 0, 0.5, 0.5), /ZONA_NO_AUTORIZADA/);
  const defecto = await one("SELECT id FROM public.zonas WHERE cultivo_id=$1 AND codigo='zona-norte'", [crop]);
  const ed = await editar(owner, defecto.id, 'Norte ampliado', 0, 0, 0.6, 0.5);
  assert.deepEqual([ed.codigo, ed.nombre, Number(ed.plano_ancho)], ['zona-norte', 'Norte ampliado', 0.6], 'sirve para los cuatro por defecto');
  // Limite de 24 sectores activos por cultivo.
  for (let i = 5; i <= 24; i++) assert.equal((await sector(owner, c.id, 'Sector ' + i, 0, 0, 0.1, 0.1)).codigo, 'sector-' + String(i).padStart(2, '0'));
  await assert.rejects(sector(owner, c.id, 'El 25', 0, 0, 0.1, 0.1), /LIMITE_SECTORES/);
  await rpc(owner, 'SELECT * FROM public.archivar_cultivo($1)', [(await cultivoNuevo('Archivado con sector')).id]);
  const archivado = (await one("SELECT id FROM public.cultivos WHERE nombre='Archivado con sector'")).id;
  await assert.rejects(sector(owner, archivado, 'A', 0, 0, 0.5, 0.5), /CULTIVO_ARCHIVADO/);
});

test('eliminar sector: con nodos se rechaza; sin historial se borra; con historial queda retirado y deja de ofrecerse', async () => {
  const c = (await one("SELECT id FROM public.cultivos WHERE nombre='Sectores libres'")).id;
  const z = async codigo => one('SELECT * FROM public.zonas WHERE cultivo_id=$1 AND codigo=$2', [c, codigo]);
  const s1 = await z('sector-01'), s2 = await z('sector-02'), s3 = await z('sector-03'), n = await one("SELECT * FROM public.nodos WHERE cultivo_id=$1", [c]);
  await assert.rejects(eliminarSector(owner, s1.id), /SECTOR_CON_NODOS/);
  await assert.rejects(eliminarSector(other, s2.id), /ZONA_NO_AUTORIZADA/); await assert.rejects(eliminarSector(owner, randomUUID()), /ZONA_NO_AUTORIZADA/);
  await assert.rejects(comoAnonimo(() => db.query('SELECT public.eliminar_sector($1)', [s2.id])), /permission denied/);
  await assert.rejects(comoUsuario(owner, () => db.query('DELETE FROM public.zonas WHERE id=$1', [s2.id])), /permission denied/);
  // Sin historial: se borra de verdad y su codigo vuelve a estar libre.
  assert.deepEqual(await eliminarSector(owner, s2.id), { codigo: 'SECTOR_ELIMINADO', zona_id: s2.id, modo: 'borrado' });
  assert.equal((await one('SELECT count(*)::int n FROM public.zonas WHERE id=$1', [s2.id])).n, 0);
  assert.equal((await sector(owner, c, 'Reemplazo', 0.5, 0.5, 0.2, 0.2)).codigo, 'sector-02');
  // Con historial: el nodo deja un lote en el sector 01 y despues pasa al 03. El 01 ya no puede borrarse sin romper sus mediciones.
  const estado = leerEstado(await estadoSimulacion()).find(x => x.cultivo_id === c);
  const lote = loteVirtual(estado.nodos.find(x => x.codigo === n.codigo), estado.parametros, faseClima(null, null, Date.now()), new Date(), { ejecucion: randomUUID() });
  const g = await ingerirV3(lote); assert.equal(g.estado, 'insertado', JSON.stringify(g)); assert.equal(g.zona_id, s1.id);
  await ubicar(owner, n.id, s3.id, 0.5, 0.5);
  assert.deepEqual(await eliminarSector(owner, s1.id), { codigo: 'SECTOR_ELIMINADO', zona_id: s1.id, modo: 'retirado' });
  const retirado = await z('sector-01');
  assert.ok(retirado.eliminada_en, 'la fila se conserva marcada');
  assert.equal((await one('SELECT count(*)::int n FROM public.mediciones WHERE zona_id=$1', [s1.id])).n, 10, 'las mediciones siguen apuntando a su sector');
  assert.equal((await one("SELECT zona_contexto->>'codigo' AS c FROM public.mediciones WHERE zona_id=$1 LIMIT 1", [s1.id])).c, 'sector-01');
  await assert.rejects(eliminarSector(owner, s1.id), /ZONA_NO_AUTORIZADA/, 'ya no existe para la cuenta');
  await assert.rejects(editar(owner, s1.id, 'Revivir', 0, 0, 0.5, 0.5), /ZONA_NO_AUTORIZADA/);
  await assert.rejects(ubicar(owner, n.id, s1.id, 0.5, 0.5), /ZONA_NO_AUTORIZADA/);
  await assert.rejects(rpc(owner, 'SELECT * FROM public.asignar_zona_nodo($1,$2,0.5,0.5)', [n.id, s1.id]), /ZONA_NO_AUTORIZADA/);
  await assert.rejects(virtual(c, s1.id), /ZONA_NO_AUTORIZADA/);
  assert.equal(await comoUsuario(owner, async () => (await one('SELECT count(*)::int n FROM public.zonas WHERE cultivo_id=$1 AND eliminada_en IS NULL', [c])).n), 23, 'la web filtra eliminada_en is null');
  assert.equal((await sector(owner, c, 'Cabe otro', 0, 0, 0.2, 0.2)).codigo, 'sector-25', 'el retirado no cuenta para el limite y su codigo no se reutiliza');
  // Sin sector indicado, un nodo nuevo nunca cae en un sector retirado.
  for (let i = 0; i < 3; i++) assert.notEqual((await virtual(c)).zona_id, s1.id);
  // Si se retiran todos los sectores de un cultivo, el siguiente nodo vuelve a crear los cuatro por defecto.
  const d = await cultivoNuevo('Sin sectores despues'), v = await virtual(d.id);
  const ingresado = await ingerirV3(loteVirtual({ codigo: v.codigo, tipo_nodo: 'virtual', asignacion_version: v.asignacion_version, zona: 'Sector central', intervalo_segundos: 30 }, null, faseClima(null, null, Date.now()), new Date(), { ejecucion: randomUUID() }));
  assert.equal(ingresado.estado, 'insertado');
  await rpc(owner, 'SELECT * FROM public.retirar_nodo_virtual($1)', [v.id]);
  const modos = []; for (const fila of (await db.query('SELECT id FROM public.zonas WHERE cultivo_id=$1 ORDER BY codigo', [d.id])).rows) modos.push((await eliminarSector(owner, fila.id)).modo);
  assert.deepEqual(modos, ['retirado', 'borrado', 'borrado', 'borrado'], 'solo el central tenia historial');
  const nuevo = await virtual(d.id);
  assert.deepEqual((await db.query('SELECT codigo, eliminada_en IS NULL AS activa FROM public.zonas WHERE cultivo_id=$1 ORDER BY codigo', [d.id])).rows.map(r => [r.codigo, r.activa]),
    [['zona-central', true], ['zona-drenaje', true], ['zona-norte', true], ['zona-sur', true]]);
  assert.ok(nuevo.zona_id);
});

test('sector libre de punta a punta: un nodo virtual en un sector de codigo libre se simula, pasa la validacion de n8n y la RPC v3 lo guarda', async () => {
  const c = await cultivoNuevo('Solo sectores propios');
  await rpc(owner, "SELECT * FROM public.aplicar_plantilla_cultivo($1,'yuca',true,'simulado')", [c.id]);
  const s = await sector(owner, c.id, 'Vivero', 0.4, 0.1, 0.3, 0.3), n = await virtual(c.id, s.id);
  assert.deepEqual((await db.query('SELECT codigo FROM public.zonas WHERE cultivo_id=$1', [c.id])).rows.map(r => r.codigo), ['sector-01'], 'con un sector propio no se crean los cuatro por defecto');
  assert.equal(n.zona_id, s.id);
  // El servicio de simulacion lo recibe con el nombre de su sector y arma el lote v3 con el contrato de siempre.
  const estado = leerEstado(await estadoSimulacion()).find(x => x.cultivo_id === c.id), enEstado = estado.nodos.find(x => x.codigo === n.codigo);
  assert.deepEqual([enEstado.zona, enEstado.tipo_nodo, enEstado.asignacion_version], ['Vivero', 'virtual', n.asignacion_version]);
  const lote = loteVirtual(enEstado, estado.parametros, faseClima({ evento: 'sol_fuerte', intensidad: 2, iniciado_en: new Date(Date.now() - 300_000).toISOString() }, null, Date.now()), new Date(), { ejecucion: randomUUID() });
  assert.ok(!lote.mensaje.includes('zona-') && !lote.mensaje.includes('sector-'), 'el mensaje v3 no lleva el codigo del sector');
  const previo = prepararIngestaSimulada({ topic: lote.topico, message: lote.mensaje, supabase_url: 'https://fixture-local.supabase.co' }, { acl_verificada: true, retencion_broker_desactivada: true }, new Date().toISOString());
  assert.equal(previo.estado, 'prevalidado', previo.codigo);
  const g = await ingerirV3(lote);
  assert.equal(g.estado, 'insertado', JSON.stringify(g)); assert.deepEqual([g.cultivo_id, g.zona_id], [c.id, s.id]);
  const ctx = await one("SELECT zona_id, zona_contexto FROM public.mediciones WHERE mensaje_id=$1 AND variable_codigo='temperatura_aire'", [lote.payload.mensaje_id]);
  assert.deepEqual([ctx.zona_id, ctx.zona_contexto.codigo, ctx.zona_contexto.nombre, Number(ctx.zona_contexto.plano_x)], [s.id, 'sector-01', 'Vivero', 0.4], 'se guarda el sector real, sin disfrazarlo de uno de los cuatro');
  assert.equal((await servidor('SELECT public.evaluar_alertas_lote($1,$2) AS r', [n.id, lote.payload.mensaje_id])).r.codigo, 'LOTE_EVALUADO');
  assert.equal((await comoUsuario(owner, async () => one('SELECT zona_nombre FROM public.estado_red_nodos() WHERE codigo=$1', [n.codigo]))).zona_nombre, 'Vivero');
  // Ubicar: cualquier posicion dentro del sector y cambio a otro sector del mismo cultivo.
  const p = await ubicar(owner, n.id, s.id, 0.123456, 0.9);
  assert.deepEqual([Number(p.posicion_x), Number(p.posicion_y), p.zona_id], [0.1235, 0.9, s.id]);
  const s2 = await sector(owner, c.id, 'Fondo', 0, 0.6, 1, 0.4);
  assert.equal((await ubicar(owner, n.id, s2.id, 0, 1)).zona_id, s2.id);
  assert.equal((await rpc(owner, 'SELECT * FROM public.mover_nodo_virtual($1,$2,$3)', [n.id, c.id, s.id])).zona_id, s.id, 'mover_nodo_virtual tambien acepta sectores libres');
  for (const [x, y] of [[-0.1, 0.5], [0.5, 1.1], [null, 0.5]]) await assert.rejects(ubicar(owner, n.id, s.id, x, y), /POSICION_NODO_INVALIDA/);
  await assert.rejects(ubicar(owner, n.id, null, 0.5, 0.5), /ZONA_NO_AUTORIZADA/);
  await assert.rejects(ubicar(owner, n.id, (await one("SELECT id FROM public.zonas WHERE cultivo_id=$1 LIMIT 1", [crop])).id, 0.5, 0.5), /ZONA_NO_AUTORIZADA/, 'sector de otro cultivo');
  await assert.rejects(ubicar(other, n.id, s.id, 0.5, 0.5), /NODO_SIN_CULTIVO_AUTORIZADO/);
  await assert.rejects(comoAnonimo(() => db.query('SELECT public.ubicar_nodo($1,$2,0.5,0.5)', [n.id, s.id])), /permission denied/);
});

test('nodo fisico autogestionado: registro con clave que solo se entrega una vez, hash en la base, clave ilegible, validacion y limites', async () => {
  const r = await registrar(owner, 'esp32', ['dht22', 'ldr']);
  assert.deepEqual(Object.keys(r).sort(), ['clave', 'codigo', 'nodo']); assert.equal(r.codigo, 'NODO_REGISTRADO');
  assert.match(r.nodo.codigo, /^agv-esp[0-9a-f]{4}-[0-9]{2}$/); assert.match(r.nodo.codigo, /^agv-[a-z0-9]+-[0-9]{2}$/, 'cumple el patron del contrato v2');
  assert.deepEqual([r.nodo.tipo_nodo, r.nodo.tipo_dispositivo, r.nodo.protocolo, r.nodo.intervalo_segundos, r.nodo.habilitado, r.nodo.cultivo_id, r.nodo.agricultor_id, r.nodo.eliminado_en],
    ['fisico', 'esp32', 'https_wifi', 60, true, null, owner, null]);
  assert.match(r.clave, /^[A-Za-z0-9_-]{43}$/, '32 bytes en base64url');
  assert.deepEqual((await db.query('SELECT variable_codigo, sensor_modelo FROM public.nodo_variables WHERE nodo_id=$1 ORDER BY 1', [r.nodo.id])).rows,
    [{ variable_codigo: 'humedad_aire', sensor_modelo: 'DHT22' }, { variable_codigo: 'iluminacion_relativa', sensor_modelo: 'LDR' }, { variable_codigo: 'temperatura_aire', sensor_modelo: 'DHT22' }]);
  // En la base solo queda el hash sha256; la clave no aparece en ninguna columna.
  const fila = await one('SELECT * FROM public.nodo_claves WHERE nodo_id=$1', [r.nodo.id]);
  assert.equal(fila.clave_hash, createHash('sha256').update(r.clave).digest('hex')); assert.ok(!JSON.stringify(fila).includes(r.clave));
  for (const rol of [comoAnonimo, comoServidor, fn => comoUsuario(owner, fn)]) {
    await assert.rejects(rol(() => db.query('SELECT * FROM public.nodo_claves')), /permission denied/);
    await assert.rejects(rol(() => db.query("UPDATE public.nodo_claves SET clave_hash=repeat('0',64)")), /permission denied/);
  }
  for (const privilegio of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) for (const rol of ['anon', 'authenticated', 'service_role'])
    assert.equal((await one(`SELECT has_table_privilege('${rol}','public.nodo_claves','${privilegio}') a`)).a, false, rol + ' ' + privilegio);
  for (const f of ['emitir_clave_nodo(uuid)', 'autenticar_nodo(text,text)']) assert.equal((await one(`SELECT has_function_privilege('authenticated','public.${f}','EXECUTE') a`)).a, false, f);
  // La web solo sabe que existe, desde cuando y cuando se uso.
  const visibles = await comoUsuario(owner, async () => (await db.query('SELECT * FROM public.claves_nodos()')).rows);
  assert.deepEqual(visibles.map(v => [v.nodo_id, v.ultimo_uso_en, Object.keys(v).sort().join()]), [[r.nodo.id, null, 'creada_en,nodo_id,ultimo_uso_en']]);
  assert.equal(await comoUsuario(other, async () => (await db.query('SELECT * FROM public.claves_nodos()')).rows.length), 0);
  // Otros tipos y sensores. Solo DHT22 o solo LDR tambien se registran.
  const uno = await registrar(owner, 'arduino_uno', ['dht22']), rpi = await registrar(owner, 'raspberry_pi', ['ldr']);
  assert.match(uno.nodo.codigo, /^agv-uno[0-9a-f]{4}-[0-9]{2}$/); assert.equal(uno.nodo.protocolo, 'serie_puente_mqtt');
  assert.match(rpi.nodo.codigo, /^agv-rpi[0-9a-f]{4}-[0-9]{2}$/); assert.equal(rpi.nodo.protocolo, 'https_wifi'); assert.notEqual(uno.clave, r.clave);
  assert.equal((await one('SELECT count(*)::int n FROM public.nodo_variables WHERE nodo_id=$1', [uno.nodo.id])).n, 2); assert.equal((await one('SELECT count(*)::int n FROM public.nodo_variables WHERE nodo_id=$1', [rpi.nodo.id])).n, 1);
  for (const tipo of ['virtual', 'pico', '', null]) await assert.rejects(registrar(owner, tipo, ['dht22']), /DISPOSITIVO_INVALIDO/, String(tipo));
  for (const sensores of [[], null, ['dht22', 'dht22'], ['dht22', 'ldr', 'ldr'], ['bme280'], ['dht22', 'NULL']]) await assert.rejects(registrar(owner, 'esp32', sensores), /SENSORES_INVALIDOS/, JSON.stringify(sensores));
  await assert.rejects(comoAnonimo(() => db.query("SELECT public.registrar_nodo_fisico('esp32','{dht22}')")), /permission denied/);
  await assert.rejects(comoServidor(() => db.query("SELECT public.registrar_nodo_fisico('esp32','{dht22}')")), /permission denied/);
  // Cada cuenta ve solo sus nodos. Limite de 50 fisicos por cuenta (la otra cuenta empieza en cero).
  assert.equal(await comoUsuario(other, async () => (await one('SELECT count(*)::int n FROM public.nodos')).n), 0);
  for (let i = 0; i < 50; i++) await registrar(other, 'esp32', ['dht22', 'ldr']);
  await assert.rejects(registrar(other, 'esp32', ['dht22', 'ldr']), /LIMITE_NODOS_CUENTA/);
  assert.equal((await one("SELECT count(DISTINCT codigo)::int n FROM public.nodos WHERE agricultor_id=$1", [other])).n, 50, 'codigos unicos');
});

test('de punta a punta: registrar un nodo fisico, autenticarlo con su clave, ubicarlo en un sector libre y guardar su lote real v2', async () => {
  const c = await cultivoNuevo('Con placa propia'), s = await sector(owner, c.id, 'Invernadero', 0.1, 0.1, 0.5, 0.5);
  const r = await registrar(owner, 'esp32', ['dht22', 'ldr']), codigo = r.nodo.codigo;
  // Autenticacion: solo el servidor, misma respuesta para clave mala, nodo inexistente, nodo sin clave o virtual.
  assert.deepEqual(await autenticar(codigo, r.clave), { codigo: 'NODO_AUTENTICADO', nodo_codigo: codigo, intervalo_segundos: 60, pausado: false });
  const invalida = { codigo: 'CLAVE_INVALIDA' };
  for (const [cod, clave] of [[codigo, r.clave.slice(0, -1) + (r.clave.endsWith('A') ? 'B' : 'A')], [codigo, 'x'.repeat(43)], [codigo, ''], [codigo, null], ['agv-noexiste-99', r.clave], [null, r.clave],
    ['agv-dht22-01', r.clave], [(await one("SELECT codigo FROM public.nodos WHERE tipo_nodo='virtual' LIMIT 1")).codigo, r.clave], [codigo, 'y'.repeat(300)]])
    assert.deepEqual(await autenticar(cod, clave), invalida, String(cod));
  const uso = await one('SELECT intentos_fallidos, ultimo_fallo_en, ultimo_uso_en FROM public.nodo_claves WHERE nodo_id=$1', [r.nodo.id]);
  assert.equal(uso.intentos_fallidos, 2, 'cuenta los fallos con clave de forma valida'); assert.ok(uso.ultimo_fallo_en && uso.ultimo_uso_en);
  assert.equal((await autenticar(codigo, r.clave)).codigo, 'NODO_AUTENTICADO', 'los fallos no bloquean al nodo legitimo');
  assert.equal((await one('SELECT intentos_fallidos FROM public.nodo_claves WHERE nodo_id=$1', [r.nodo.id])).intentos_fallidos, 0);
  await assert.rejects(comoUsuario(owner, () => db.query('SELECT public.autenticar_nodo($1,$2)', [codigo, r.clave])), /permission denied/);
  await assert.rejects(comoAnonimo(() => db.query('SELECT public.autenticar_nodo($1,$2)', [codigo, r.clave])), /permission denied/);
  assert.ok((await comoUsuario(owner, async () => (await db.query('SELECT * FROM public.claves_nodos()')).rows)).find(v => v.nodo_id === r.nodo.id).ultimo_uso_en);
  // Sin cultivo el lote se rechaza; vinculado y ubicado en un sector libre se guarda como dato REAL con su sector.
  const suelto = loteReal(codigo);
  assert.equal(prevalidarAmbiental({ topic: 'agrovigia/v2/real/nodos/' + codigo + '/telemetria', message: JSON.stringify(suelto) }).estado, 'prevalidado', 'el codigo pasa el validador de n8n');
  assert.equal((await ingerirReal(suelto)).estado, 'rechazado');
  await rpc(owner, 'SELECT * FROM public.vincular_nodo($1,$2)', [r.nodo.id, c.id]);
  const sinSector = loteReal(codigo, 27.1, 66); assert.equal((await ingerirReal(sinSector)).estado, 'insertado', 'un fisico sin sector sigue entrando como hoy');
  const u = await ubicar(owner, r.nodo.id, s.id, 0.25, 0.75);
  assert.deepEqual([u.zona_id, Number(u.posicion_x), Number(u.posicion_y), u.tipo_nodo], [s.id, 0.25, 0.75, 'fisico']);
  const lote = loteReal(codigo, 29.3, 61.5, 3000), g = await ingerirReal(lote);
  assert.equal(g.estado, 'insertado', JSON.stringify(g)); assert.equal(g.cultivo_id, c.id);
  const filas = (await db.query('SELECT variable_codigo, origen, valor::float8 v, zona_id, zona_contexto FROM public.mediciones WHERE mensaje_id=$1 ORDER BY 1', [lote.mensaje_id])).rows;
  assert.deepEqual(filas.map(f => [f.variable_codigo, f.origen, f.v, f.zona_id, f.zona_contexto.codigo]),
    [['humedad_aire', 'real', 61.5, s.id, 'sector-01'], ['iluminacion_relativa', 'real', 73.3, s.id, 'sector-01'], ['temperatura_aire', 'real', 29.3, s.id, 'sector-01']]);
  assert.equal((await ingerirReal(lote)).estado, 'duplicado');
  assert.equal((await one('SELECT zona_id FROM public.mediciones WHERE mensaje_id=$1 LIMIT 1', [sinSector.mensaje_id])).zona_id, null, 'lo guardado antes no cambia');
  const red = await comoUsuario(owner, async () => one('SELECT origen, zona_nombre, temperatura::float8 t FROM public.estado_red_nodos() WHERE codigo=$1', [codigo]));
  assert.deepEqual(red, { origen: 'real', zona_nombre: 'Invernadero', t: 29.3 });
  // Pausa e intervalo llegan al nodo en la respuesta de autenticacion.
  await rpc(owner, 'SELECT * FROM public.pausar_nodo($1,true)', [r.nodo.id]); await rpc(owner, "SELECT * FROM public.configurar_dispositivo($1,'esp32','https_wifi',120)", [r.nodo.id]);
  assert.deepEqual(await autenticar(codigo, r.clave), { codigo: 'NODO_AUTENTICADO', nodo_codigo: codigo, intervalo_segundos: 120, pausado: true });
  assert.deepEqual(await ingerirReal(loteReal(codigo)), { estado: 'rechazado', codigo: 'NODO_PAUSADO' });
  await rpc(owner, 'SELECT * FROM public.pausar_nodo($1,false)', [r.nodo.id]);
  // Regenerar invalida la clave anterior.
  const nueva = (await rpc(owner, 'SELECT public.regenerar_clave_nodo($1) AS r', [r.nodo.id])).r;
  assert.deepEqual([nueva.codigo, nueva.nodo_id], ['CLAVE_REGENERADA', r.nodo.id]); assert.match(nueva.clave, /^[A-Za-z0-9_-]{43}$/); assert.notEqual(nueva.clave, r.clave);
  assert.deepEqual(await autenticar(codigo, r.clave), invalida); assert.equal((await autenticar(codigo, nueva.clave)).codigo, 'NODO_AUTENTICADO');
  await assert.rejects(rpc(other, 'SELECT public.regenerar_clave_nodo($1)', [r.nodo.id]), /NODO_NO_AUTORIZADO/);
  await assert.rejects(rpc(owner, 'SELECT public.regenerar_clave_nodo($1)', [(await one("SELECT id FROM public.nodos WHERE tipo_nodo='virtual' AND agricultor_id=$1 LIMIT 1", [owner])).id]), /NODO_NO_FISICO/);
  // El nodo aprovisionado antes no tiene clave y sigue entrando por MQTT; puede recibir una si se quiere pasar a HTTPS.
  assert.equal((await one("SELECT count(*)::int n FROM public.nodo_claves k JOIN public.nodos x ON x.id=k.nodo_id WHERE x.codigo='agv-dht22-01'")).n, 0);
  assert.equal((await ingerirReal(loteReal('agv-dht22-01'))).estado, 'insertado');
  // Un nodo registrado solo con DHT22 no cumple el lote v2 completo: la RPC lo rechaza por capacidades.
  const solo = await registrar(owner, 'esp32', ['dht22']); await rpc(owner, 'SELECT * FROM public.vincular_nodo($1,$2)', [solo.nodo.id, c.id]);
  assert.deepEqual(await ingerirReal(loteReal(solo.nodo.codigo)), { estado: 'rechazado', codigo: 'CAPACIDAD_NODO' });
});

test('eliminar nodo fisico: sin datos se borra con su clave; con datos queda retirado, sin clave y fuera de la red; limite de 16 fisicos por cultivo', async () => {
  const c = (await one("SELECT id FROM public.cultivos WHERE nombre='Con placa propia'")).id;
  const conDatos = await one("SELECT n.* FROM public.nodos n WHERE n.cultivo_id=$1 AND n.tipo_nodo='fisico' AND EXISTS (SELECT 1 FROM public.mediciones m WHERE m.nodo_id=n.id)", [c]);
  const clave = (await rpc(owner, 'SELECT public.regenerar_clave_nodo($1) AS r', [conDatos.id])).r.clave;
  const eliminar = async (uid, id) => (await rpc(uid, 'SELECT public.eliminar_nodo_fisico($1) AS r', [id])).r;
  const sinDatos = await registrar(owner, 'esp32', ['dht22', 'ldr']);
  await assert.rejects(eliminar(other, sinDatos.nodo.id), /NODO_NO_AUTORIZADO/);
  await assert.rejects(eliminar(owner, (await one("SELECT id FROM public.nodos WHERE tipo_nodo='virtual' AND agricultor_id=$1 LIMIT 1", [owner])).id), /NODO_NO_FISICO/);
  await assert.rejects(rpc(owner, 'SELECT public.eliminar_nodo_virtual($1)', [sinDatos.nodo.id]), /NODO_NO_VIRTUAL/);
  await assert.rejects(comoAnonimo(() => db.query('SELECT public.eliminar_nodo_fisico($1)', [sinDatos.nodo.id])), /permission denied/);
  assert.deepEqual(await eliminar(owner, sinDatos.nodo.id), { codigo: 'NODO_ELIMINADO', modo: 'borrado', nodo_id: sinDatos.nodo.id });
  for (const tabla of ['nodos WHERE id', 'nodo_claves WHERE nodo_id', 'nodo_variables WHERE nodo_id', 'nodo_asignaciones WHERE nodo_id'])
    assert.equal((await one(`SELECT count(*)::int n FROM public.${tabla}=$1`, [sinDatos.nodo.id])).n, 0, tabla);
  assert.deepEqual(await autenticar(sinDatos.nodo.codigo, sinDatos.clave), { codigo: 'CLAVE_INVALIDA' });
  // Con mediciones: retirado, deshabilitado, suelto, sin clave; sus mediciones reales se conservan.
  const total = (await one('SELECT count(*)::int n FROM public.mediciones WHERE nodo_id=$1', [conDatos.id])).n;
  assert.deepEqual(await eliminar(owner, conDatos.id), { codigo: 'NODO_ELIMINADO', modo: 'retirado', nodo_id: conDatos.id });
  const fila = await nodo(conDatos.codigo);
  assert.deepEqual([fila.cultivo_id, fila.zona_id, fila.habilitado], [null, null, false]); assert.ok(fila.eliminado_en);
  assert.equal((await one('SELECT count(*)::int n FROM public.mediciones WHERE nodo_id=$1', [conDatos.id])).n, total);
  assert.equal((await one('SELECT count(*)::int n FROM public.nodo_claves WHERE nodo_id=$1', [conDatos.id])).n, 0);
  assert.deepEqual(await autenticar(conDatos.codigo, clave), { codigo: 'CLAVE_INVALIDA' });
  assert.equal(await comoUsuario(owner, async () => (await db.query('SELECT 1 FROM public.estado_red_nodos() WHERE codigo=$1', [conDatos.codigo])).rows.length), 0);
  await assert.rejects(rpc(owner, 'SELECT * FROM public.vincular_nodo($1,$2)', [conDatos.id, c]), /NODO_ELIMINADO/);
  await assert.rejects(rpc(owner, 'SELECT public.regenerar_clave_nodo($1)', [conDatos.id]), /NODO_ELIMINADO/);
  assert.deepEqual(await eliminar(owner, conDatos.id), { codigo: 'NODO_ELIMINADO', modo: 'retirado', nodo_id: conDatos.id }, 'repetir devuelve lo mismo');
  // Hasta dieciseis fisicos por cultivo (antes dos), contados aparte de los virtuales.
  const d = await cultivoNuevo('Muchas placas');
  for (let i = 1; i <= 17; i++) {
    const r = await registrar(owner, 'esp32', ['dht22', 'ldr']);
    if (i <= 16) assert.equal((await rpc(owner, 'SELECT * FROM public.vincular_nodo($1,$2)', [r.nodo.id, d.id])).cultivo_id, d.id);
    else await assert.rejects(rpc(owner, 'SELECT * FROM public.vincular_nodo($1,$2)', [r.nodo.id, d.id]), /LIMITE_NODOS_CULTIVO/);
  }
  assert.ok((await virtual(d.id)).id, 'los virtuales tienen su propio limite');
});

test('regresion y verificacion: las pruebas previas siguen pasando despues de 0012 y los dos verificadores dan todo true', async () => {
  for (const f of ['probar-alertas.sql', 'probar-gestion-nodos.sql', 'probar-gestion-cultivos.sql'])
    assert.match((await db.exec(sql(f))).at(-1).rows[0].resultado, /^OK:/, f);
  assert.equal((await db.exec(sql('probar-ingesta-ambiental.sql'))).at(-1).rows.length, 6);
  const fila = (await db.exec(sql('verificar-terreno-nodos.sql'))).at(-1).rows[0];
  assert.ok(Object.keys(fila).length >= 10);
  for (const [k, v] of Object.entries(fila)) assert.equal(v, true, k);
});
