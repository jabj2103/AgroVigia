export interface Cultivo {
  id: string; nombre: string; tipo: string; area: number; unidad_area: string; archivado_en?: string | null;
}
export interface Nodo {
  id: string; codigo: string; cultivo_id: string | null; habilitado: boolean;
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
export interface LecturaNodo { nodo: Nodo; lote: LoteDht | null; error: string | null }
