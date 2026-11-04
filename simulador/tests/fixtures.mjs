import { randomUUID } from 'node:crypto';
import { ZONAS, crearZonas, crearCaptura } from '../public/motor.mjs';
export function filas() {
  const cultivo_id = '52ea4628-c470-48f4-a09a-0f9a697d22b4';
  return ZONAS.map((z, i) => ({ nodo_local: z.nodo, nodo_codigo: `sim-52ea4628c470-0${i + 1}`,
    asignacion_version: randomUUID(), cultivo_id, zona_id: randomUUID(), zona_codigo: z.codigo,
    zona_nombre: z.nombre, habilitado: true, variables_simuladas: 10 }));
}
export function captura() { return crearCaptura(crearZonas()[0], { ejecucion: randomUUID() }); }
