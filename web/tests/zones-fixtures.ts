const randomUUID = () => globalThis.crypto.randomUUID();
import { crearCaptura, crearZonas, ZONAS } from '../../simulador/public/motor.mjs';
import type { MedicionZona, NodoPlano, Plano, Zona } from '../src/zone-domain.ts';
export const owner = '11111111-1111-4111-8111-111111111111', crop = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const zones: Zona[] = ZONAS.map((z: { codigo: string; nombre: string }, i: number) => ({ id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${i}`, cultivo_id: crop, codigo: z.codigo, nombre: z.nombre,
  plano_x: i % 2 ? 0.525 : 0.05, plano_y: i < 2 ? 0.05 : 0.525, plano_ancho: 0.425, plano_alto: 0.425 }));
export const virtuals: NodoPlano[] = zones.map((z, i) => ({ id: `cccccccc-cccc-4ccc-8ccc-ccccccccccc${i}`, codigo: `sim-bbbbbbbbbbbb-0${i + 1}`, agricultor_id: owner, cultivo_id: crop, habilitado: true,
  tipo_nodo: 'virtual', zona_id: z.id, posicion_x: 0.5, posicion_y: 0.5, asignacion_version: `dddddddd-dddd-4ddd-8ddd-ddddddddddd${i}` }));
export const physical: NodoPlano = { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', codigo: 'agv-fisico-01', agricultor_id: owner, cultivo_id: crop, habilitado: true, tipo_nodo: 'fisico', zona_id: null, posicion_x: null, posicion_y: null, asignacion_version: randomUUID() };
export function captureRows(n: NodoPlano = virtuals[0]!, fecha = new Date()): MedicionZona[] {
  const i = virtuals.findIndex(v => v.id === n.id), zona = zones[i]!;
  const local = crearCaptura(crearZonas()[i], { fecha, ejecucion: randomUUID() });
  return local.mediciones.map((m: { variable_codigo: string; valor: number; unidad: string; metadatos: Record<string, unknown> }) => ({
    id: randomUUID(), cultivo_id: crop, nodo_id: n.id, mensaje_id: local.mensaje_id, origen: 'simulado', variable_codigo: m.variable_codigo, valor: m.valor,
    tomada_en: local.tomada_en, recibida_en: local.tomada_en, zona_id: n.zona_id,
    zona_contexto: { id: zona.id, codigo: zona.codigo, nombre: zona.nombre, plano_x: zona.plano_x, plano_y: zona.plano_y, plano_ancho: zona.plano_ancho, plano_alto: zona.plano_alto, posicion_nodo_x: n.posicion_x, posicion_nodo_y: n.posicion_y },
    metadatos: { version_payload: 3, asignacion_version: n.asignacion_version, simulacion: { ejecucion_id: local.simulacion.ejecucion_id, semilla: local.simulacion.semilla, escenario_id: local.simulacion.escenario_id, modo: local.simulacion.modo, paso: local.simulacion.paso, pasos_transicion: 12 }, detalle: m.metadatos, unidad: m.unidad },
  }));
}
export function plano(): Plano {
  const rows = captureRows();
  return structuredClone({ zonas: zones, nodos: [...virtuals, physical], capacidades: [
    ...virtuals.flatMap(n => rows.map(m => ({ nodo_id: n.id, variable_codigo: m.variable_codigo, sensor_modelo: 'SIMULADOR_V3' }))),
    ...['temperatura_aire', 'humedad_aire', 'iluminacion_relativa'].map(variable_codigo => ({ nodo_id: physical.id, variable_codigo, sensor_modelo: variable_codigo === 'iluminacion_relativa' ? 'LDR' : 'DHT22' })),
  ] });
}
