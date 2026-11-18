// Explicacion plegable: queda a un toque, sin ocupar la pantalla en cada visita.
// Los avisos que cambian la lectura de un dato (simulado, sin lux, sin alertas no es sano) no van aqui: se muestran siempre.
import type { ReactNode } from 'react';

export function Informacion({ titulo = 'Más información', children }: { titulo?: string; children: ReactNode }) {
  return <details className="informacion">
    <summary><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.2" /></svg>{titulo}</summary>
    <div className="informacion-cuerpo">{children}</div>
  </details>;
}
