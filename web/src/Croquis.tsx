// Croquis 2D del cultivo: sectores y nodos en su posicion registrada. Solo dibuja; los datos vienen de Inicio.
// Es la vista accesible por defecto: cada sector y cada nodo es un boton con nombre, estado y alerta.
import { puntoNodo } from './zone-domain.ts';
import type { NodoPlano, Zona } from './zone-domain.ts';

export interface MarcaNodo { codigo: string; texto: string; alerta: boolean; sinRecibir: boolean }

export function CroquisCultivo({ zonas, nodos, marcas, zonaActiva, nodoActivo, alElegirZona, alElegirNodo }: {
  zonas: Zona[]; nodos: NodoPlano[]; marcas: Map<string, MarcaNodo>; zonaActiva: string | null; nodoActivo: string | null;
  alElegirZona: (id: string) => void; alElegirNodo: (id: string) => void;
}) {
  return <div className="croquis" role="group" aria-label="Croquis del cultivo"><div className="area-croquis">
    {zonas.map(z => {
      const cuantos = nodos.filter(n => n.zona_id === z.id).length;
      return <button type="button" key={z.id} className={'zona-croquis' + (zonaActiva === z.id ? ' activa' : '')} aria-pressed={zonaActiva === z.id}
        style={{ left: z.plano_x * 100 + '%', top: z.plano_y * 100 + '%', width: z.plano_ancho * 100 + '%', height: z.plano_alto * 100 + '%' }}
        aria-label={'Ver solo ' + z.nombre} title={z.nombre} onClick={() => alElegirZona(z.id)}>
        <strong>{z.nombre}</strong><span>{cuantos} {cuantos === 1 ? 'nodo' : 'nodos'}</span>
      </button>;
    })}
    {nodos.map(n => {
      const p = puntoNodo(n, zonas), m = marcas.get(n.id); if (!p || !m) return null;
      return <button type="button" key={n.id} title={n.codigo} style={{ left: p.x * 100 + '%', top: p.y * 100 + '%' }}
        className={'nodo-croquis ' + (n.tipo_nodo === 'virtual' ? 'simulado' : 'fisico') + (nodoActivo === n.id ? ' elegido' : '') + (m.sinRecibir ? ' sin-recibir' : '') + (m.alerta ? ' con-alerta' : '')}
        aria-label={m.texto} onClick={() => alElegirNodo(n.id)}>{m.codigo}{m.alerta && <span className="marca-alerta" aria-hidden="true">!</span>}</button>;
    })}
    {!zonas.length && <p className="croquis-vacio">Este cultivo todavía no tiene zonas configuradas. Sus nodos aparecen en la lista.</p>}
  </div></div>;
}
