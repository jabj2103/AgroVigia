// Nodos fisicos gestionados por el agricultor: registro con clave propia y conversacion con la placa por
// USB (Web Serial) para configurarla sin recompilar. La contrasena del Wi-Fi y la clave del nodo viajan
// solo por el cable hacia la placa: nunca se guardan en Supabase ni en el navegador.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Nodo } from './types.ts';

const MENSAJES: Record<string, string> = {
  PERFIL_NO_AUTORIZADO: 'Tu cuenta no está habilitada para registrar dispositivos.',
  NODO_NO_AUTORIZADO: 'Este dispositivo no pertenece a tu cuenta. Actualiza la cuenta.',
  DISPOSITIVO_INVALIDO: 'Ese tipo de dispositivo no se puede registrar.',
  SENSORES_INVALIDOS: 'Elige los sensores que tiene la placa.',
  LIMITE_NODOS_CUENTA: 'Tu cuenta ya tiene el máximo de 50 nodos físicos.',
  SIN_CODIGO_DISPONIBLE: 'No pudimos asignar un código al nodo. Reintenta.',
  NODO_NO_FISICO: 'Esta acción solo aplica a nodos físicos.',
  NODO_ELIMINADO: 'Este nodo fue eliminado y ya no se puede usar.',
};
function fallo(mensaje: string | undefined, generico: string): Error {
  const codigo = Object.keys(MENSAJES).find(k => mensaje?.includes(k));
  return new Error(codigo ? MENSAJES[codigo]! : generico);
}
// La clave llega una sola vez: el servidor guarda solo su huella y no puede volver a mostrarla.
export async function registrarNodoFisico(client: SupabaseClient, tipo: string): Promise<{ nodo: Nodo; clave: string }> {
  // El contrato de datos reales exige las tres mediciones: la placa se registra con DHT22 y LDR.
  const r = await client.rpc('registrar_nodo_fisico', { p_tipo_dispositivo: tipo, p_sensores: ['dht22', 'ldr'] });
  if (r.error) throw fallo(r.error.message, 'No pudimos registrar el nodo. Reintenta.');
  const d = r.data as { codigo?: string; nodo?: Nodo; clave?: string } | null;
  if (d?.codigo !== 'NODO_REGISTRADO' || !d.nodo?.id || typeof d.clave !== 'string' || d.clave.length < 32) throw new Error('No pudimos confirmar el registro del nodo.');
  return { nodo: d.nodo, clave: d.clave };
}
export async function regenerarClaveNodo(client: SupabaseClient, nodoId: string): Promise<string> {
  const r = await client.rpc('regenerar_clave_nodo', { p_nodo_id: nodoId });
  if (r.error) throw fallo(r.error.message, 'No pudimos generar una clave nueva. Reintenta.');
  const d = r.data as { codigo?: string; clave?: string } | null;
  if (d?.codigo !== 'CLAVE_REGENERADA' || typeof d.clave !== 'string' || d.clave.length < 32) throw new Error('No pudimos confirmar la clave nueva.');
  return d.clave;
}
export async function eliminarNodoFisico(client: SupabaseClient, nodoId: string): Promise<'borrado' | 'retirado'> {
  const r = await client.rpc('eliminar_nodo_fisico', { p_nodo_id: nodoId });
  if (r.error) throw fallo(r.error.message, 'No pudimos eliminar el nodo. Reintenta.');
  const d = r.data as { codigo?: string; modo?: string } | null;
  if (d?.codigo !== 'NODO_ELIMINADO' || (d.modo !== 'borrado' && d.modo !== 'retirado')) throw new Error('No pudimos confirmar la eliminación.');
  return d.modo;
}

// ---- Placa por USB: una orden JSON por linea; la respuesta es la linea que empieza por "AGV ". ----
export interface InfoPlaca { ok: boolean; fw?: string; version?: string; configurado?: boolean; codigo?: string; wifi_ssid?: string; url?: string; intervalo?: number;
  wifi?: 'conectado' | 'desconectado' | 'sin_configurar'; ip?: string; reloj?: boolean; tiene_clave?: boolean; ultimo_envio?: { estado?: string; http?: number; hace_s?: number } | null; error?: string }
export interface ConfigPlaca { wifi_ssid: string; wifi_clave: string; url: string; codigo: string; clave: string; intervalo: number }
const ERRORES_PLACA: Record<string, string> = {
  URL_INVALIDA: 'La dirección del servidor debe empezar por https://.', WIFI_INVALIDO: 'Revisa el nombre y la contraseña del Wi-Fi.',
  JSON_INVALIDO: 'La placa no entendió la orden.', ORDEN_DESCONOCIDA: 'Este firmware no reconoce esa orden. Carga la versión actual.',
};
export const textoErrorPlaca = (codigo: string | undefined) => ERRORES_PLACA[codigo ?? ''] ?? 'La placa rechazó la orden' + (codigo ? ` (${codigo}).` : '.');
// Separa del texto recibido la primera respuesta completa; el resto son registros del firmware o datos a medias.
export function extraerRespuesta(buffer: string): { respuesta: Record<string, unknown> | null; resto: string } {
  let resto = buffer;
  for (;;) {
    const fin = resto.indexOf('\n'); if (fin < 0) return { respuesta: null, resto };
    const linea = resto.slice(0, fin).trim(); resto = resto.slice(fin + 1);
    if (!linea.startsWith('AGV ')) continue;
    try { const r = JSON.parse(linea.slice(4)) as unknown; if (r && typeof r === 'object' && !Array.isArray(r)) return { respuesta: r as Record<string, unknown>, resto }; } catch { /* linea danada: se ignora */ }
  }
}
const OCTETO = String.raw`(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)`;
export const URL_HTTPS = /^https:\/\/[^/:]/;
export const URL_HTTP_LOCAL = new RegExp(String.raw`^http:\/\/(?:10(?:\.${OCTETO}){3}|172\.(?:1[6-9]|2\d|3[01])(?:\.${OCTETO}){2}|192\.168(?:\.${OCTETO}){2})(?::(?:6553[0-5]|655[0-2]\d|65[0-4]\d\d|6[0-4]\d{3}|[1-5]\d{4}|[1-9]\d{0,3}))?(?:\/[\x21-\x7e]*)?$`);
export function validarConfig(c: ConfigPlaca): string {
  if (!c.wifi_ssid.trim() || c.wifi_ssid.length > 32) return 'Escribe el nombre de la red Wi-Fi (hasta 32 caracteres).';
  if (c.wifi_clave && (c.wifi_clave.length < 8 || c.wifi_clave.length > 63)) return 'La contraseña del Wi-Fi tiene entre 8 y 63 caracteres. Déjala vacía solo si la red es abierta.';
  // Misma regla que el firmware (firmware/nodo-agrovigia-http): https hacia cualquier servidor, o http solo hacia
  // una IPv4 privada escrita con numeros (el n8n de este equipo en la misma red Wi-Fi).
  if (c.url.length > 256 || !/^[\x21-\x7e]+$/.test(c.url) || c.url.includes('"') || !(URL_HTTPS.test(c.url) || URL_HTTP_LOCAL.test(c.url)))
    return 'Escribe la dirección completa del servidor: https:// en la nube, o http:// con la dirección IP de este equipo en tu red local (por ejemplo http://192.168.1.19:5678/webhook/agrovigia/nodo). No sirven localhost ni 127.0.0.1: la placa es otro equipo.';
  if (!c.codigo || !c.clave) return 'Falta el código o la clave del nodo.';
  if (!Number.isInteger(c.intervalo) || c.intervalo < 10 || c.intervalo > 3600) return 'El intervalo va de 10 a 3600 segundos.';
  return '';
}
interface PuertoSerie { open(o: { baudRate: number }): Promise<void>; close(): Promise<void>; readable: ReadableStream<Uint8Array> | null; writable: WritableStream<Uint8Array> | null }
const serie = () => (globalThis.navigator as (Navigator & { serial?: { requestPort(): Promise<PuertoSerie> } }) | undefined)?.serial;
export const serieDisponible = () => !!serie();
// La demo local reemplaza el puerto por una placa simulada: sirve para configurar, no para grabar firmware.
export const placaSimulada = () => !!(serie() as { agvDemo?: boolean } | undefined)?.agvDemo;
export class PlacaSerie {
  private lector: ReadableStreamDefaultReader<Uint8Array> | null = null; private resto = ''; private texto = new TextDecoder();
  private puerto: PuertoSerie;
  private constructor(puerto: PuertoSerie) { this.puerto = puerto; }
  // El navegador muestra su propio selector de puerto: la pagina no ve ningun dispositivo sin ese permiso.
  static async conectar(): Promise<PlacaSerie> {
    const s = serie(); if (!s) throw new Error('Este navegador no permite hablar con la placa por USB. Usa Chrome o Edge en un computador.');
    let puerto: PuertoSerie;
    try { puerto = await s.requestPort(); } catch { throw new Error('No se eligió ningún puerto. Conecta la placa por USB y vuelve a intentarlo.'); }
    try { await puerto.open({ baudRate: 115200 }); } catch { throw new Error('No pudimos abrir el puerto. Cierra otros programas que lo estén usando, como el monitor serie.'); }
    return new PlacaSerie(puerto);
  }
  async orden(o: Record<string, unknown>, esperaMs = 8000): Promise<Record<string, unknown>> {
    if (!this.puerto.writable || !this.puerto.readable) throw new Error('La conexión con la placa se cerró.');
    const escritor = this.puerto.writable.getWriter();
    try { await escritor.write(new TextEncoder().encode(JSON.stringify(o) + '\n')); } finally { escritor.releaseLock(); }
    this.lector ??= this.puerto.readable.getReader();
    const limite = Date.now() + esperaMs;
    for (;;) {
      const r = extraerRespuesta(this.resto); this.resto = r.resto;
      if (r.respuesta) return r.respuesta;
      const queda = limite - Date.now(); if (queda <= 0) throw new Error('La placa no respondió. Comprueba que tenga cargado el firmware de AgroVigía.');
      let reloj = 0;
      const leido = await Promise.race([this.lector.read(), new Promise<null>(ok => { reloj = window.setTimeout(() => ok(null), queda); })]);
      window.clearTimeout(reloj);
      if (leido === null) throw new Error('La placa no respondió. Comprueba que tenga cargado el firmware de AgroVigía.');
      if (leido.done) throw new Error('La placa se desconectó.');
      this.resto += this.texto.decode(leido.value, { stream: true });
    }
  }
  async cerrar(): Promise<void> {
    try { await this.lector?.cancel(); } catch { /* ya cerrado */ }
    try { this.lector?.releaseLock(); } catch { /* ya liberado */ }
    this.lector = null;
    try { await this.puerto.close(); } catch { /* ya cerrado */ }
  }
}
