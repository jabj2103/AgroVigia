export type ConfiguracionWeb =
  | { lista: true; url: string; clave: string }
  | { lista: false; motivo: string };

export function validarEntornoPublico(env: Record<string, string | undefined>): ConfiguracionWeb {
  for (const [nombre, valor] of Object.entries(env)) {
    if (!nombre.startsWith('VITE_')) continue;
    if (/secret|service_role|password|gemini/i.test(nombre) ||
        valor?.startsWith('sb_secret_')) {
      throw new Error('Hay una clave privada en las variables VITE_. Retirala antes de iniciar la web.');
    }
  }
  const url = env.VITE_SUPABASE_URL?.trim();
  const clave = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (clave && !clave.startsWith('sb_publishable_')) {
    throw new Error('La web requiere una Publishable key sb_publishable_. No uses la Secret key de n8n.');
  }
  if (!url || !clave) return {
    lista: false, motivo: 'Completa VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY en web/.env.local.',
  };
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)) {
    throw new Error('VITE_SUPABASE_URL debe ser la URL HTTPS del proyecto, sin /rest/v1.');
  }
  return { lista: true, url: url.replace(/\/$/, ''), clave };
}
