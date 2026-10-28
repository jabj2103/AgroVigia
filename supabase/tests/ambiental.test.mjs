import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const owner = '3611e8b0-13ba-45ec-a66f-b066315a7341';
const other = 'f11baaf9-0461-4b73-94d6-d8eff18c6fa8';
const crop = '52ea4628-c470-48f4-a09a-0f9a697d22b4';
const sql = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
let node;
before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;`);
  await db.query('INSERT INTO auth.users VALUES ($1),($2)', [owner, other]);
  await db.exec(sql('migrations/202610260001_base_recepcion.sql'));
  await db.exec(sql('migrations/202610260002_ingesta_dht22.sql'));
  await db.query('INSERT INTO public.perfiles (id,nombre) VALUES ($1,$2)', [owner, 'Fixture de prueba']);
  await db.query(`INSERT INTO public.cultivos (id,agricultor_id,nombre,tipo,area,unidad_area,solicitud_id)
    VALUES ($1,$2,'Fixture','Demostracion',1,'m2','b8aff795-b68e-4559-99c8-e596d567e677')`, [crop, owner]);
  await db.exec(sql('provisionar-demo.sql'));
  await db.exec(sql('migrations/202610260003_ingesta_ambiental.sql'));
  node = (await db.query("SELECT id FROM public.nodos WHERE codigo='agv-dht22-01'")).rows[0].id;
});
after(async () => { await db.close(); });
function payload(adc = 625) {
  return { version: 2, nodo_codigo: 'agv-dht22-01', mensaje_id: randomUUID(), origen: 'simulado',
    tomada_en: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    ldr: { metodo: 'adc12_10k_11db_v1', adc_promedio: adc },
    mediciones: [
      { variable_codigo: 'temperatura_aire', valor: 27.5, unidad: '\u00b0C' },
      { variable_codigo: 'humedad_aire', valor: 47.8, unidad: '% HR' },
      { variable_codigo: 'iluminacion_relativa', valor: Math.round(adc * 1000 / 4095) / 10, unidad: '% relativo' },
    ] };
}
async function rpc(p) {
  await db.exec('SET ROLE service_role');
  try {
    return (await db.query(`SELECT public.registrar_lote_ambiental($1,$2,clock_timestamp(),true,NULL,true) AS r`,
      ['agrovigia/v2/simulado/nodos/agv-dht22-01/telemetria', JSON.stringify(p)])).rows[0].r;
  } finally { await db.exec('RESET ROLE'); }
}
test('regresion SQL DHT22 v1 y columna nueva conservan compatibilidad', async () => {
  await db.exec(sql('probar-ingesta-dht22.sql'));
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.mediciones')).rows[0].n, 0);
});
test('script SQL v2 comprueba permisos, tres filas, duplicados, conversion y rollback', async () => {
  const results = await db.exec(sql('probar-ingesta-ambiental.sql'));
  assert.equal(results.at(-1).rows.length, 6);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.mediciones')).rows[0].n, 0);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.nodo_variables')).rows[0].n, 2);
});
test('habilitacion es idempotente; capacidad y revocacion se exigen', async () => {
  assert.equal((await rpc(payload())).codigo, 'CAPACIDAD_NODO');
  await db.exec(sql('habilitar-ldr-nodo.sql'));
  await db.exec(sql('habilitar-ldr-nodo.sql'));
  const p = payload();
  assert.equal((await rpc(p)).estado, 'insertado');
  await db.query('UPDATE public.nodos SET habilitado=false WHERE id=$1', [node]);
  assert.equal((await rpc(p)).codigo, 'NODO_DESHABILITADO');
  await db.query('UPDATE public.nodos SET habilitado=true WHERE id=$1', [node]);
});
test('un fallo de trigger durante el lote revierte todas las filas', async () => {
  const p = payload();
  await db.exec(`CREATE FUNCTION public.fallo_prueba() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.variable_codigo='iluminacion_relativa' THEN RAISE EXCEPTION 'Fallo inyectado' USING ERRCODE='23514'; END IF;
    RETURN NEW; END $$;
    CREATE TRIGGER fallo_inyectado BEFORE INSERT ON public.mediciones FOR EACH ROW EXECUTE FUNCTION public.fallo_prueba();`);
  try {
    await assert.rejects(rpc(p), /Fallo inyectado/);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.mediciones WHERE mensaje_id=$1', [p.mensaje_id])).rows[0].n, 0);
  } finally { await db.exec('DROP TRIGGER fallo_inyectado ON public.mediciones; DROP FUNCTION public.fallo_prueba();'); }
});
test('formula entera usada por firmware coincide con numeric de SQL en todo el ADC', async () => {
  const { rows } = await db.query('SELECT a,round(a::numeric*100/4095,1)::float8 AS indice FROM generate_series(0,4095) a');
  for (const r of rows) {
    assert.equal(Math.floor((r.a * 1000 + 2047) / 4095) / 10, r.indice);
  }
});
test('RLS SQL oculta valores y metadatos a otra identidad; no es prueba JWT/API', async () => {
  const p = payload(); await rpc(p);
  await db.exec('SET ROLE authenticated');
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [owner]);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.mediciones WHERE mensaje_id=$1', [p.mensaje_id])).rows[0].n, 3);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [other]);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.mediciones WHERE mensaje_id=$1', [p.mensaje_id])).rows[0].n, 0);
  } finally { await db.exec('RESET ROLE'); }
});
test('despues de habilitar LDR el recorrido DHT22 v1 sigue aceptando sus dos filas', async () => {
  await db.exec(sql('probar-ingesta-dht22.sql'));
});
test('gestion de cultivos: permisos, asignacion atomica, validaciones, RLS y archivado con rollback', async () => {
  await db.exec(sql('migrations/202610270004_gestion_cultivos.sql'));
  const counts = (await db.query('SELECT (SELECT count(*) FROM public.cultivos) AS c,(SELECT count(*) FROM public.nodos) AS n,(SELECT count(*) FROM public.mediciones) AS m')).rows[0];
  const results = await db.exec(sql('probar-gestion-cultivos.sql'));
  assert.match(results.at(-1).rows[0].resultado, /^OK:/);
  assert.deepEqual((await db.query('SELECT (SELECT count(*) FROM public.cultivos) AS c,(SELECT count(*) FROM public.nodos) AS n,(SELECT count(*) FROM public.mediciones) AS m')).rows[0], counts);
  await db.exec(sql('probar-ingesta-ambiental.sql'));
  await db.exec(sql('probar-ingesta-dht22.sql'));
});

test('nodos: vinculo/desvinculo, limite, aislamiento, auditoria, conservacion historica y regresion', async () => {
  await db.exec(sql('migrations/202610270005_gestion_nodos.sql'));
  const prev=(await db.query('SELECT count(*)::int AS n FROM public.nodo_asignaciones')).rows[0].n;
  const results=await db.exec(sql('probar-gestion-nodos.sql'));
  assert.match(results.at(-1).rows[0].resultado,/^OK:/);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.nodo_asignaciones')).rows[0].n,prev);
  await db.exec(sql('probar-gestion-cultivos.sql'));
  await db.exec(sql('probar-ingesta-ambiental.sql'));
  await db.exec(sql('probar-ingesta-dht22.sql'));
});

test('alertas: reglas, episodios, revision, duplicados, orden, RLS y rollback',async()=>{
 await db.exec(sql('migrations/202610270006_alertas.sql'));
 const prev=(await db.query('SELECT count(*)::int AS n FROM public.mediciones')).rows[0].n;
 const r=await db.exec(sql('probar-alertas.sql'));
 assert.match(r.at(-1).rows[0].resultado,/^OK:/);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM public.reglas_alerta')).rows[0].n,0);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM public.alertas')).rows[0].n,0);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM public.mediciones')).rows[0].n,prev);
 await db.exec(sql('probar-gestion-nodos.sql'));
 await db.exec(sql('probar-ingesta-ambiental.sql'));
});
