import { createClient } from '@supabase/supabase-js';
import { validarEntornoPublico } from './config.ts';

export const configuracion = validarEntornoPublico({
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
});

const fetchConLimite: typeof fetch = async (entrada, opciones) => {
  const control = new AbortController();
  const cancelar = () => control.abort();
  const reloj = window.setTimeout(cancelar, 15_000);
  opciones?.signal?.addEventListener('abort', cancelar, { once: true });
  if (opciones?.signal?.aborted) cancelar();
  try {
    return await fetch(entrada, { ...opciones, signal: control.signal });
  } finally {
    window.clearTimeout(reloj);
    opciones?.signal?.removeEventListener('abort', cancelar);
  }
};

export const supabase = configuracion.lista
  ? createClient(configuracion.url, configuracion.clave, { global: { fetch: fetchConLimite } })
  : null;
