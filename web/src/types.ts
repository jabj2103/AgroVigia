export interface Cultivo {
  id: string; nombre: string; tipo: string; area: number; unidad_area: string; archivado_en?: string | null;
  plantilla_codigo?: string | null;
  // Medidas reales del terreno (0012). Sin ellas se estima un cuadrado con el area.
  ancho_m?: number | null; largo_m?: number | null;
}
export interface Nodo {
  id: string; codigo: string; cultivo_id: string | null; habilitado: boolean;
  tipo_nodo?: 'fisico' | 'virtual';
  // Derivado de tipo_nodo al cargar: un nodo virtual solo recibe datos simulados.
  simulado?: boolean;
}
export interface Capacidad { nodo_id: string; variable_codigo: string; sensor_modelo: string }
export interface Contexto {
  nombre: string | null; cultivos: Cultivo[]; nodos: Nodo[]; capacidades: Capacidad[];
}
export interface Medicion {
  id: string; cultivo_id: string; nodo_id: string; mensaje_id: string;
  variable_codigo: string; valor: number; tomada_en: string; recibida_en: string; origen: string; metadatos?: Record<string, unknown>;
}
export interface LoteDht {
  mensajeId: string; nodoId: string; tomadaEn: string; recibidaEn: string;
  temperatura: number; humedad: number; iluminacion?: number; adcLdr?: number;
}
export type Origen = 'real' | 'simulado';
export interface LecturaNodo { nodo: Nodo; lote: LoteDht | null; error: string | null }
