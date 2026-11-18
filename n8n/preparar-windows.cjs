'use strict';
// Adapta los archivos de importacion al n8n de Windows. El inventario SQLite se lee sin modificarlo.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const raiz = path.resolve(__dirname, '..');
const url = 'https://vzylofqutecvfcbmcjac.supabase.co';

function leerSecretos() {
  const texto = fs.readFileSync(path.join(raiz, '.local/secretos.env'), 'utf8');
  return Object.fromEntries(texto.split(/\r?\n/).filter(l => /^[A-Z_0-9]+=/.test(l))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
}

async function verificar(secretos) {
  if (secretos.SUPABASE_URL !== url) throw new Error('La URL no corresponde al proyecto AgroVigia.');
  const respuestas = await Promise.all([
    fetch(url + '/rest/v1/rpc/estado_simulacion', { method: 'POST', headers: { apikey: secretos.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15000) }),
    fetch('https://generativelanguage.googleapis.com/v1beta/models/' + secretos.GEMINI_MODELO, { headers: { 'x-goog-api-key': secretos.GEMINI_API_KEY }, signal: AbortSignal.timeout(15000) }),
  ]);
  for (const [i, respuesta] of respuestas.entries()) {
    if (!respuesta.ok) throw new Error((i === 0 ? 'Supabase' : 'Gemini') + ' no acepto la configuracion (HTTP ' + respuesta.status + ').');
    await respuesta.json();
  }
  console.log('Supabase y el modelo de Gemini respondieron.');
}

function ajustarFlujos(destino, existentes, proyectos) {
  const ids = new Set();
  const filas = fs.readFileSync(path.join(destino, 'flujos.txt'), 'utf8').trim().split('\n');
  const flujos = filas.map(fila => {
    const [archivo] = fila.split(':');
    const flujo = JSON.parse(fs.readFileSync(path.join(destino, archivo), 'utf8'))[0];
    const prefijo = 'AgroVigia - ' + archivo.slice(0, 3) + ' ';
    const candidatos = existentes.filter(f => f.name.startsWith(prefijo));
    if (candidatos.length > 1) throw new Error('Hay varios flujos ' + archivo.slice(0, 3) + '. Revisa cuales deben actualizarse.');
    const previo = candidatos[0];
    if (previo) flujo.id = previo.id;
    else if (existentes.some(f => f.id === flujo.id)) throw new Error('El identificador ya pertenece a otro flujo.');
    if (ids.has(flujo.id)) throw new Error('Identificadores repetidos.');
    ids.add(flujo.id);
    return { archivo, flujo, previo };
  });
  const anteriores = existentes.filter(f => ids.has(f.id));
  const propietarios = new Set(anteriores.map(f => f.projectId));
  const proyecto = anteriores.length ? (propietarios.size === 1 ? anteriores[0].projectId : null)
    : (proyectos.length === 1 ? proyectos[0].id : null);
  if (!proyecto || !/^[A-Za-z0-9_-]+$/.test(proyecto)) throw new Error('No se pudo identificar un unico proyecto propietario de n8n.');
  for (const existente of existentes.filter(f => f.active && !ids.has(f.id))) {
    const nodos = JSON.parse(existente.nodes);
    if (nodos.some(n => n.type === 'n8n-nodes-base.mqttTrigger' && String(n.parameters?.topics).includes('agrovigia/'))) {
      throw new Error('Hay otro receptor AgroVigia publicado. Revisa sus topicos antes de continuar.');
    }
  }
  for (const { archivo, flujo } of flujos) {
    fs.writeFileSync(path.join(destino, archivo), JSON.stringify([flujo], null, 2), { mode: 0o600 });
  }
  const resumen = { proyecto, flujos: flujos.map(({archivo,flujo}) => ({ archivo, id: flujo.id })) };
  fs.writeFileSync(path.join(destino, 'resumen.json'), JSON.stringify(resumen, null, 2));
  return resumen;
}

function preparar(destino, secretos) {
  const ruta = path.resolve(destino);
  const relativo = path.relative(path.join(raiz, '.local'), ruta);
  if (!relativo || relativo.startsWith('..') || path.isAbsolute(relativo)) throw new Error('La salida debe estar dentro de .local.');
  const receptor = fs.readFileSync(path.join(raiz, '.local/mqtt/receptor.conf'), 'utf8').split(/\r?\n/);
  const opcion = f => receptor.find(l => l.startsWith(f + ' '))?.slice(f.length + 1).trim();
  const claveIngesta = process.env.AGROVIGIA_INGESTA_CLAVE || fs.readFileSync(path.join(raiz, '.local/ingesta-http/clave'), 'utf8').trim();
  if (opcion('-u') !== 'receptor' || !opcion('-P')) throw new Error('Faltan las credenciales del receptor MQTT.');
  const db = new DatabaseSync(path.join(raiz, '.local/n8n/.n8n/database.sqlite'), { readOnly: true });
  let existentes, proyectos;
  try {
    existentes = db.prepare("SELECT w.id,w.name,w.active,w.nodes,s.projectId FROM workflow_entity w LEFT JOIN shared_workflow s ON s.workflowId=w.id AND s.role='workflow:owner'").all();
    proyectos = db.prepare('SELECT id FROM project').all();
  } finally { db.close(); }
  const resultado = spawnSync(process.execPath, [path.join(raiz, 'local/preparar-n8n.cjs'), '--entorno', ruta], {
    env: { ...process.env, ...secretos, AGROVIGIA_INGESTA_CLAVE: claveIngesta,
      AGROVIGIA_MQTT_HOST: '127.0.0.1', AGROVIGIA_MQTT_PUERTO: '18883', AGROVIGIA_MQTT_USUARIO: opcion('-u'), AGROVIGIA_MQTT_CLAVE: opcion('-P') },
    encoding: 'utf8', windowsHide: true,
  });
  if (resultado.status !== 0) throw new Error('No se pudieron preparar los flujos. Revisa las claves y la configuracion MQTT.');
  return ajustarFlujos(ruta, existentes, proyectos);
}

module.exports = { ajustarFlujos, preparar };
if (require.main === module) {
  (async () => {
    const secretos = leerSecretos();
    if (process.argv[2] === '--verificar') await verificar(secretos);
    else if (process.argv[2]) { preparar(process.argv[2], secretos); console.log('Flujos preparados para Windows conservando los identificadores existentes.'); }
    else throw new Error('Falta la carpeta de salida.');
  })().catch(error => { console.error('Error: ' + error.message); process.exitCode = 1; });
}
