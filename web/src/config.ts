export type ConfiguracionWeb =
  | { lista: true; url: string; clave: string }
  | { lista: false; motivo: string };

// Dos destinos admitidos: el proyecto en la nube (https) o un Supabase de desarrollo en este equipo o en la
// red local (http solo a 127.0.0.1, localhost o una IPv4 privada). Nunca http hacia internet.
const IPV4_PRIVADA = String.raw`(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})`;
export const URL_NUBE = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/;
export const URL_LOCAL = new RegExp(String.raw`^http:\/\/(?:127\.0\.0\.1|localhost|${IPV4_PRIVADA})(?::\d{2,5})?\/?$`);
// La CLI local de Supabase entrega una clave publicable o, en versiones anteriores, un JWT con rol anon.
function rolDeJwt(clave: string): string | null {
  try { const cuerpo = clave.split('.')[1]; if (!cuerpo) return null; return String((JSON.parse(atob(cuerpo.replace(/-/g, '+').replace(/_/g, '/'))) as { role?: unknown }).role ?? ''); } catch { return null; }
}

export function validarEntornoPublico(env: Record<string, string | undefined>): ConfiguracionWeb {
  for (const [nombre, valor] of Object.entries(env)) {
    if (!nombre.startsWith('VITE_')) continue;
    if (/secret|service_role|password|gemini/i.test(nombre) ||
        valor?.startsWith('sb_secret_') || (valor && rolDeJwt(valor) === 'service_role')) {
      throw new Error('Hay una clave privada en las variables VITE_. Retirala antes de iniciar la web.');
    }
  }
  const url = env.VITE_SUPABASE_URL?.trim();
  const clave = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  const local = !!url && URL_LOCAL.test(url);
  if (clave && !clave.startsWith('sb_publishable_') && !(local && rolDeJwt(clave) === 'anon')) {
    throw new Error('La web requiere una Publishable key sb_publishable_. No uses la Secret key de n8n.');
  }
  if (!url || !clave) return {
    lista: false, motivo: 'Completa VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY en web/.env.local.',
  };
  if (!URL_NUBE.test(url) && !local) {
    throw new Error('VITE_SUPABASE_URL debe ser la URL HTTPS del proyecto, sin /rest/v1, o la de un Supabase local (http://127.0.0.1:54321).');
  }
  return { lista: true, url: url.replace(/\/$/, ''), clave };
}
