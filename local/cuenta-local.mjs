// Crea o actualiza las cuentas de Auth del Supabase LOCAL de desarrollo con la API de administracion.
// Lee .local/entorno-local.env (URL local, clave de servidor, correo y contrasena de la cuenta de prueba).
// No imprime claves ni contrasenas. Uso: node local/cuenta-local.mjs <ruta de entorno-local.env>
// Los identificadores son los que esperan provisionar-demo.sql, habilitar-ldr-nodo.sql y probar-*.sql.
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const archivo = process.argv[2];
if (!archivo) throw new Error('Falta la ruta de entorno-local.env');
const env = Object.fromEntries(readFileSync(archivo, 'utf8').split(/\r?\n/).filter(l => /^[A-Z_0-9]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const url = env.SUPABASE_URL, clave = env.SUPABASE_SECRET_KEY;
if (!/^http:\/\/(127\.0\.0\.1|localhost):[0-9]{2,5}$/.test(url ?? '')) throw new Error('Este guion solo trabaja contra el Supabase local (http://127.0.0.1:<puerto>).');
if (!clave || !env.AGROVIGIA_USUARIO_CORREO || !env.AGROVIGIA_USUARIO_CLAVE) throw new Error('Faltan variables en entorno-local.env');
const cabeceras = { apikey: clave, Authorization: 'Bearer ' + clave, 'Content-Type': 'application/json' };
async function cuenta(id, correo, contrasena) {
  const datos = { email: correo, password: contrasena, email_confirm: true };
  const existe = await fetch(`${url}/auth/v1/admin/users/${id}`, { headers: cabeceras });
  const r = existe.status === 200
    ? await fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'PUT', headers: cabeceras, body: JSON.stringify(datos) })
    : await fetch(`${url}/auth/v1/admin/users`, { method: 'POST', headers: cabeceras, body: JSON.stringify({ id, ...datos }) });
  const cuerpo = await r.json().catch(() => ({}));
  if (!r.ok || cuerpo.id !== id) throw new Error(`Auth local respondio ${r.status} al preparar la cuenta ${correo}: ${String(cuerpo.msg ?? cuerpo.message ?? cuerpo.error_code ?? '').slice(0, 120)}`);
  return existe.status === 200 ? 'actualizada' : 'creada';
}
console.log('Cuenta de prueba ' + env.AGROVIGIA_USUARIO_CORREO + ': ' + await cuenta('3611e8b0-13ba-45ec-a66f-b066315a7341', env.AGROVIGIA_USUARIO_CORREO, env.AGROVIGIA_USUARIO_CLAVE));
// Segunda cuenta solo para las comprobaciones de aislamiento (probar-*.sql). Contrasena aleatoria que no se guarda.
console.log('Cuenta de aislamiento: ' + await cuenta('f11baaf9-0461-4b73-94d6-d8eff18c6fa8', 'otra.cuenta@agrovigia.test', randomBytes(24).toString('base64url')));
