// Iconos de clima en SVG (sin emojis). Los mismos trazos sirven para React y para las etiquetas de la
// escena 3D, que se construyen con DOM directo.
import type { EventoClima } from './escenario-data.ts';

export const TRAZOS_CLIMA: Record<EventoClima, string[]> = {
  normal: ['M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Z', 'm8.3 12.2 2.5 2.5 4.9-5.2'],
  lluvia: ['M7 14.5a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17.2 7.6 3.5 3.5 0 0 1 17 14.5Z', 'M8 17.5v2.5M12 17.5v3.5M16 17.5v2.5'],
  sol_fuerte: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z', 'M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8'],
  tierra_seca: ['M12 3.5s5 5.2 5 9a5 5 0 0 1-10 0c0-3.8 5-9 5-9Z', 'M4.5 4.5l15 15'],
  viento: ['M3 9h10.5a2.5 2.5 0 1 0-2.5-2.5', 'M3 14h15a2.5 2.5 0 1 1-2.5 2.5', 'M3 19h7'],
};
export function IconoClima({ evento, className }: { evento: EventoClima; className?: string }) {
  return <svg className={className} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {TRAZOS_CLIMA[evento].map(d => <path key={d} d={d} />)}
  </svg>;
}
// Mismo icono como nodo DOM, para las etiquetas CSS2D de three.js.
export function iconoClimaDom(evento: EventoClima): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  for (const d of TRAZOS_CLIMA[evento]) { const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); svg.appendChild(p); }
  return svg;
}
