import type { SupabaseClient } from '@supabase/supabase-js';
import type { Medicion } from './types.ts';
import { MAX_MUESTRAS_HISTORIAL, validarFilaHistorial, validarFiltroHistorial } from './history-domain.ts';
import type { FiltroHistorial } from './history-domain.ts';

// Paginacion por captura/UUID, sin OFFSET. No supone que una pagina corta sea la ultima.
export async function cargarHistorial(client: SupabaseClient, filtro: FiltroHistorial, signal?: AbortSignal): Promise<Medicion[]> {
  validarFiltroHistorial(filtro);
  const filas: Medicion[] = [];
  const ids = new Set<string>(), mensajes = new Set<string>();
  let anterior: Medicion | undefined;
  for (let pagina = 0; pagina < 50; pagina++) {
    if (signal?.aborted) throw new DOMException('Consulta cancelada', 'AbortError');
    let consulta = client.from('mediciones')
      .select(filtro.variable === 'iluminacion_relativa'
        ? 'id,cultivo_id,nodo_id,mensaje_id,variable_codigo,valor,tomada_en,recibida_en,origen,metadatos'
        : 'id,cultivo_id,nodo_id,mensaje_id,variable_codigo,valor,tomada_en,recibida_en,origen')
      .eq('cultivo_id', filtro.cultivoId).eq('nodo_id', filtro.nodoId)
      .eq('variable_codigo', filtro.variable).eq('origen', 'real')
      .gte('tomada_en', filtro.inicio).lte('tomada_en', filtro.fin)
      .lte('recibida_en', filtro.recibidasHasta)
      .order('tomada_en', { ascending: true }).order('id', { ascending: true })
      .limit(Math.min(500, MAX_MUESTRAS_HISTORIAL + 1 - filas.length));
    if (anterior) {
      const fecha = new Date(anterior.tomada_en).toISOString();
      consulta = consulta.or('tomada_en.gt.' + fecha + ',and(tomada_en.eq.' + fecha + ',id.gt.' + anterior.id + ')');
    }
    if (signal) consulta = consulta.abortSignal(signal);
    const r = await consulta.overrideTypes<Medicion[], { merge: false }>();
    if (signal?.aborted) throw new DOMException('Consulta cancelada', 'AbortError');
    if (r.error) throw new Error('No pudimos completar el historial. Reintenta; no se muestran estadísticas parciales.');
    if (!Array.isArray(r.data)) throw new Error('La respuesta del historial no es válida.');
    if (!r.data.length) return filas;
    for (const fila of r.data) {
      validarFilaHistorial(fila, filtro);
      const a = anterior ? Date.parse(anterior.tomada_en) : -Infinity;
      const t = Date.parse(fila.tomada_en);
      if (ids.has(fila.id) || mensajes.has(fila.mensaje_id) || t < a ||
          (anterior && t === a && fila.id <= anterior.id)) {
        throw new Error('El historial contiene lecturas repetidas o un orden inconsistente.');
      }
      filas.push(fila); ids.add(fila.id); mensajes.add(fila.mensaje_id); anterior = fila;
      if (filas.length > MAX_MUESTRAS_HISTORIAL) throw new Error('Hay demasiadas muestras. Reduce el período para consultar el historial completo.');
    }
  }
  throw new Error('No pudimos completar todas las páginas. Reduce el período y vuelve a consultar.');
}