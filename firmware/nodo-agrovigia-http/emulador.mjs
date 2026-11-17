#!/usr/bin/env node
// Emulador del protocolo serie del firmware agv-http (nodo-agrovigia-http.ino).
// Habla por stdin/stdout lo mismo que la placa por el puerto serie: una orden JSON por
// linea y una respuesta `AGV {...}` por linea. Sirve para probar el asistente de la web
// sin hardware. No es una placa: sus lecturas son inventadas y por eso el lote que envia
// lleva "origen":"simulado", nunca "real".
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export const FW_NOMBRE = 'agv-http';
export const FW_VERSION = '1.1.0';
export const FW_PLACA = 'esp32';
export const LINEA_MAX = 1024;
const INTERVALO_MIN_S = 10, INTERVALO_MAX_S = 3600, INTERVALO_DEFECTO_S = 60;
const CADUCIDAD_MS = 300000, CONSULTA_EN_PAUSA_MS = 300000, RESPUESTA_MAX = 512;
const ESPERAS_MS = [2000, 4000, 8000];
const SENSORES = ['dht22', 'ldr'];

const largo = s => Buffer.byteLength(s, 'utf8');
const imprimible = s => /^[\x21-\x7e]*$/.test(s);
const texto = v => typeof v === 'string';
const seguro = (v, max) => (texto(v) ? v : '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, max);
const configInicial = () => ({ wifi_ssid: '', wifi_clave: '', url: '', codigo: '', clave: '', intervalo: INTERVALO_DEFECTO_S, sensores: [...SENSORES] });

// Direccion admitida sin cifrar: http:// solo hacia una IPv4 privada escrita con numeros
// (10.x.x.x, 172.16.x.x a 172.31.x.x o 192.168.x.x), con puerto y ruta opcionales.
const OCTETO = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const PUERTO = '(?::(?:6553[0-5]|655[0-2]\\d|65[0-4]\\d\\d|6[0-4]\\d{3}|[1-5]\\d{4}|[1-9]\\d{0,3}))?';
const RUTA = '(?:\\/[\\x21-\\x7e]*)?';
export const URL_HTTPS = /^https:\/\/[^/:]/;
export const URL_HTTP_LOCAL = new RegExp(`^http:\\/\\/(?:10(?:\\.${OCTETO}){3}|172\\.(?:1[6-9]|2\\d|3[01])(?:\\.${OCTETO}){2}|192\\.168(?:\\.${OCTETO}){2})${PUERTO}${RUTA}$`);
// Solo para pruebas del emulador en el mismo computador (opcion --permitir-http). La placa no lo admite.
const URL_HTTP_ESTE_EQUIPO = new RegExp(`^http:\\/\\/127\\.0\\.0\\.1${PUERTO}${RUTA}$`);
export const urlSinCifrar = v => v.startsWith('http://');

// Las mismas reglas que aplica el firmware a la orden config.
export const reglas = {
  wifi_ssid: v => texto(v) && largo(v) >= 1 && largo(v) <= 32,
  wifi_clave: v => texto(v) && (largo(v) === 0 || (largo(v) >= 8 && largo(v) <= 64)),
  url: (v, permitirHttp = false) => texto(v) && largo(v) <= 256 && imprimible(v) && !v.includes('"') &&
    (URL_HTTPS.test(v) || URL_HTTP_LOCAL.test(v) || (permitirHttp && URL_HTTP_ESTE_EQUIPO.test(v))),
  codigo: v => texto(v) && /^[a-z0-9-]{1,64}$/.test(v),
  clave: v => texto(v) && largo(v) >= 1 && largo(v) <= 128 && imprimible(v),
  intervalo: v => Number.isInteger(v) && v >= INTERVALO_MIN_S && v <= INTERVALO_MAX_S,
  sensores: v => Array.isArray(v) && v.length >= 1 && v.every(s => SENSORES.includes(s)) && new Set(v).size === v.length,
};

export function indiceLdrDecimas(adc) { return Math.floor((adc * 1000 + 2047) / 4095); }
const decimas = d => `${Math.floor(d / 10)}.${d % 10}`;

// Arma el texto del lote igual que el firmware, salvo el origen.
export function armarLote({ codigo, id, fecha, sensores, temperatura, humedad, adc, origen = 'simulado' }) {
  const cabeza = v => `{"version":${v},"nodo_codigo":"${codigo}","mensaje_id":"${id}","origen":"${origen}","tomada_en":"${fecha}",`;
  const t = `{"variable_codigo":"temperatura_aire","valor":${temperatura.toFixed(1)},"unidad":"°C"}`;
  const h = `{"variable_codigo":"humedad_aire","valor":${humedad.toFixed(1)},"unidad":"% HR"}`;
  const i = `{"variable_codigo":"iluminacion_relativa","valor":${decimas(indiceLdrDecimas(adc))},"unidad":"% relativo"}`;
  const dht = sensores.includes('dht22'), ldr = sensores.includes('ldr');
  if (dht && ldr) return `${cabeza(2)}"ldr":{"metodo":"adc12_10k_11db_v1","adc_promedio":${adc}},"mediciones":[${t},${h},${i}]}`;
  return `${cabeza(1)}"mediciones":[${dht ? `${t},${h}` : i}]}`;
}

function clasificar(http) {
  if (http <= 0) return 'error_red';
  if (http >= 200 && http < 300) return 'ok';
  if (http === 401 || http === 403) return 'clave_invalida';
  if (http >= 500 || http === 408 || http === 429) return 'servidor_no_disponible';
  return 'rechazado';
}
const ERROR_DE = { rechazado: 'ENVIO_RECHAZADO', clave_invalida: 'CLAVE_RECHAZADA', servidor_no_disponible: 'SERVIDOR_NO_DISPONIBLE', error_red: 'ERROR_RED' };

export class NodoEmulado {
  // opciones: permitirHttp (acepta tambien http://127.0.0.1, para un servidor de prueba), red y reloj (false simula que
  // faltan), falloSensor, temperatura, humedad, adc, rutaEstado (archivo que hace de NVS),
  // fetch, ahora y esperasMs (para pruebas), registrar (recibe las lineas `[ETIQUETA] texto`).
  constructor(opciones = {}) {
    this.o = { permitirHttp: false, red: true, reloj: true, falloSensor: false, temperatura: 29.4, humedad: 67.0, adc: 1234,
      rutaEstado: null, esperasMs: ESPERAS_MS, fetch: globalThis.fetch, ahora: Date.now, registrar: () => {}, ...opciones };
    this.cola = Promise.resolve();
    this.cfg = this.#cargar();
    this.o.registrar(`[LISTO] fw=${FW_NOMBRE} version=${FW_VERSION} placa=${FW_PLACA} emulador=1 configurado=${this.configurado ? 1 : 0}`);
    this.#reiniciarConexion();
  }

  get configurado() { return Boolean(this.cfg.wifi_ssid && this.cfg.url && this.cfg.codigo && this.cfg.clave); }
  get conectado() { return this.configurado && this.o.red; }

  // Devuelve la linea de respuesta, o null si la linea estaba vacia. Las ordenes se atienden en fila.
  procesarLinea(linea) { return this.#enFila(() => this.#atender(linea)); }
  // Un paso del ciclo automatico (lo que hace loop() en la placa). Devuelve true si intento un envio.
  tic() { return this.#enFila(() => this.#ciclo()); }

  #enFila(tarea) { const r = this.cola.then(tarea); this.cola = r.catch(() => {}); return r; }

  #cargar() {
    const cfg = configInicial();
    if (!this.o.rutaEstado || !existsSync(this.o.rutaEstado)) return cfg;
    try {
      const g = JSON.parse(readFileSync(this.o.rutaEstado, 'utf8'));
      for (const k of Object.keys(cfg)) if (k === 'url' ? reglas.url(g[k], this.o.permitirHttp) : reglas[k](g[k])) cfg[k] = g[k];
    } catch { /* Un archivo ilegible equivale a una placa sin configurar. */ }
    return cfg;
  }
  #guardar() { if (this.o.rutaEstado) writeFileSync(this.o.rutaEstado, JSON.stringify(this.cfg), { mode: 0o600 }); }

  #reiniciarConexion() {
    this.lote = null; this.ultimo = null; this.pausado = false; this.claveRechazada = false; this.primera = true; this.ultimoCiclo = 0;
    this.o.registrar(this.configurado
      ? `[WIFI_INICIO] nodo=${this.cfg.codigo} intervalo=${this.cfg.intervalo} s; red emulada.`
      : '[CONFIG_ESPERA] Falta configuracion; no se inicia la red. Esperando ordenes por el puerto serie.');
    if (this.configurado && urlSinCifrar(this.cfg.url)) this.o.registrar('[AVISO] envio sin cifrar en red local');
  }

  async #atender(linea) {
    if (typeof linea !== 'string') return null;
    const limpia = linea.replace(/\r/g, '');
    if (largo(limpia) > LINEA_MAX) return error('LINEA_DEMASIADO_LARGA');
    if (!limpia.trim()) return null;
    let orden;
    try { orden = JSON.parse(limpia); } catch { return error('JSON_INVALIDO'); }
    if (orden === null || typeof orden !== 'object' || Array.isArray(orden)) return error('JSON_INVALIDO');
    switch (orden.cmd) {
      case 'info': return this.#info();
      case 'config': return this.#config(orden);
      case 'leer': return this.#leer();
      case 'enviar': return this.#enviar();
      case 'borrar': return this.#borrar();
      default: return error('ORDEN_DESCONOCIDA');
    }
  }

  #info() {
    const u = this.ultimo;
    return agv({
      ok: true, fw: FW_NOMBRE, version: FW_VERSION, placa: FW_PLACA, configurado: this.configurado,
      codigo: this.cfg.codigo, wifi_ssid: this.cfg.wifi_ssid, url: this.cfg.url,
      tiene_clave: this.cfg.clave !== '', tiene_wifi_clave: this.cfg.wifi_clave !== '',
      intervalo: this.cfg.intervalo, sensores: SENSORES.filter(s => this.cfg.sensores.includes(s)),
      wifi: !this.cfg.wifi_ssid ? 'sin_configurar' : (this.conectado ? 'conectado' : 'desconectado'),
      ip: this.conectado ? '192.0.2.10' : '', reloj: this.o.reloj,
      envio: !this.configurado ? 'sin_configurar' : this.claveRechazada ? 'clave_invalida' : this.pausado ? 'pausado' : 'activo',
      ultimo_envio: u ? { estado: u.estado, http: u.http, servidor: u.servidor, codigo: u.codigo, hace_s: Math.floor((this.o.ahora() - u.ms) / 1000) } : null,
    });
  }

  #config(orden) {
    const nueva = { ...this.cfg };
    const errores = { wifi_ssid: 'WIFI_INVALIDO', wifi_clave: 'WIFI_INVALIDO', url: 'URL_INVALIDA', codigo: 'CODIGO_INVALIDO', clave: 'CLAVE_INVALIDA', intervalo: 'INTERVALO_INVALIDO', sensores: 'SENSORES_INVALIDOS' };
    for (const campo of Object.keys(errores)) {
      const v = orden[campo];
      if (v === undefined || v === null) continue;  // Campo omitido: conserva su valor.
      if (!(campo === 'url' ? reglas.url(v, this.o.permitirHttp) : reglas[campo](v))) return error(errores[campo]);
      nueva[campo] = campo === 'sensores' ? [...v] : v;
    }
    this.cfg = nueva;
    try { this.#guardar(); } catch { return error('NVS_ERROR'); }
    this.o.registrar('[CONFIG_GUARDADA] Se reinicia la conexion con la nueva configuracion.');
    this.#reiniciarConexion();
    return agv({ ok: true, guardado: true, configurado: this.configurado });
  }

  #lectura() {
    if (this.o.falloSensor && this.cfg.sensores.includes('dht22')) return null;
    return { temperatura: this.o.temperatura, humedad: this.o.humedad, adc: this.o.adc };
  }

  #leer() {
    const l = this.#lectura();
    if (!l) return agv({ ok: false, error: 'SENSOR_ERROR', sensor: 'dht22' });
    let r = 'AGV {"ok":true';
    if (this.cfg.sensores.includes('dht22')) r += `,"temperatura":${l.temperatura.toFixed(1)},"humedad":${l.humedad.toFixed(1)}`;
    if (this.cfg.sensores.includes('ldr')) r += `,"adc":${l.adc},"iluminacion":${decimas(indiceLdrDecimas(l.adc))}`;
    return `${r}}`;
  }

  #capturar() {
    const l = this.#lectura();
    if (!l) { this.o.registrar('[SENSOR_ERROR] Se descarta la captura completa; no se envian ceros de reemplazo.'); return 'SENSOR_ERROR'; }
    if (!this.o.reloj) { this.o.registrar('[RELOJ_ERROR] Captura descartada: reloj no valido.'); return 'SIN_RELOJ'; }
    const ms = this.o.ahora();
    const id = randomUUID();
    const fecha = new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');
    const payload = armarLote({ codigo: this.cfg.codigo, id, fecha, sensores: this.cfg.sensores, ...l });
    this.lote = { id, payload, capturadoMs: ms, intentoDesdeMs: ms, esperaMs: 0, intentos: 0 };
    this.o.registrar(`[CAPTURA_SIMULADA] ${payload}`);
    return null;
  }

  async #intentar() {
    const lote = this.lote;
    lote.intentos += 1;
    let http = 0, cuerpo = '';
    if (this.conectado && this.o.ahora() - lote.capturadoMs < CADUCIDAD_MS) {
      if (urlSinCifrar(this.cfg.url)) this.o.registrar('[AVISO] envio sin cifrar en red local');
      try {
        const r = await this.o.fetch(this.cfg.url, {
          method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(18000), body: lote.payload,
          headers: { 'Content-Type': 'application/json', 'X-AgroVigia-Nodo': this.cfg.codigo, 'X-AgroVigia-Clave': this.cfg.clave, 'User-Agent': `${FW_NOMBRE}/${FW_VERSION}` },
        });
        http = r.status;
        cuerpo = (await r.text()).slice(0, RESPUESTA_MAX);
      } catch { http = 0; }
    }
    const estado = clasificar(http);
    let resp = null;
    try { const j = JSON.parse(cuerpo); if (j && typeof j === 'object' && !Array.isArray(j)) resp = j; } catch { /* Respuesta sin JSON. */ }
    this.ultimo = { estado, http, servidor: seguro(resp?.estado, 24), codigo: http > 0 ? seguro(resp?.codigo, 48) : 'RED_-1', ms: this.o.ahora() };
    const traePausado = typeof resp?.pausado === 'boolean';
    if (estado === 'ok') {
      this.claveRechazada = false;
      this.pausado = traePausado && resp.pausado;
      if (reglas.intervalo(resp?.intervalo_segundos) && resp.intervalo_segundos !== this.cfg.intervalo) {
        this.cfg.intervalo = resp.intervalo_segundos;
        try { this.#guardar(); } catch { /* Igual que la placa: sigue con el valor en memoria. */ }
        this.o.registrar(`[INTERVALO] El servidor indica ${this.cfg.intervalo} s.`);
      }
      this.o.registrar(`[HTTP_OK] id=${lote.id} intento=${lote.intentos} http=${http} estado=${this.ultimo.servidor} codigo=${this.ultimo.codigo} pausado=${this.pausado ? 1 : 0}`);
      this.lote = null;
    } else if (estado === 'clave_invalida') {
      this.claveRechazada = true;
      this.o.registrar(`[CLAVE_RECHAZADA] http=${http}; se detienen los envios hasta nueva configuracion u orden enviar.`);
      this.lote = null;
    } else if (estado === 'rechazado') {
      if (traePausado) this.pausado = resp.pausado;
      else if (this.ultimo.codigo === 'NODO_PAUSADO') this.pausado = true;
      this.o.registrar(`[LOTE_RECHAZADO] id=${lote.id} http=${http} codigo=${this.ultimo.codigo}; no se reintenta.`);
      this.lote = null;
    } else if (lote.intentos >= 4 || this.o.ahora() - lote.capturadoMs >= CADUCIDAD_MS) {
      this.o.registrar(`[LOTE_DESCARTADO] id=${lote.id} intentos=${lote.intentos} http=${http}; sin confirmacion.`);
      this.lote = null;
    } else {
      lote.intentoDesdeMs = this.o.ahora();
      lote.esperaMs = this.o.esperasMs[lote.intentos - 1];
      this.o.registrar(`[REINTENTO] id=${lote.id} http=${http} en=${lote.esperaMs} ms; se conservan JSON y fecha.`);
    }
    return estado;
  }

  async #enviar() {
    if (!this.configurado) return error('SIN_CONFIGURAR');
    if (!this.conectado) return error('SIN_WIFI');
    if (this.lote && this.o.ahora() - this.lote.capturadoMs >= CADUCIDAD_MS) this.lote = null;
    if (!this.lote) {
      const fallo = this.#capturar();
      if (fallo) return error(fallo);
      this.ultimoCiclo = this.o.ahora(); this.primera = false;
    }
    const id = this.lote.id;
    const estado = await this.#intentar();
    const r = { ok: estado === 'ok' };
    if (estado !== 'ok') r.error = ERROR_DE[estado];
    return agv({ ...r, estado, http: this.ultimo.http, servidor: this.ultimo.servidor, codigo: this.ultimo.codigo, mensaje_id: id, intervalo: this.cfg.intervalo, pausado: this.pausado });
  }

  #borrar() {
    this.cfg = configInicial();
    try { this.#guardar(); } catch { return error('NVS_ERROR'); }
    this.o.registrar('[CONFIG_BORRADA] Se borro toda la configuracion.');
    this.#reiniciarConexion();
    return agv({ ok: true, borrado: true });
  }

  async #ciclo() {
    if (!this.configurado) return false;
    const ahora = this.o.ahora();
    if (this.lote) {
      if (ahora - this.lote.capturadoMs >= CADUCIDAD_MS) { this.o.registrar(`[LOTE_CADUCADO] id=${this.lote.id}; no se cambia su fecha.`); this.lote = null; return false; }
      if (ahora - this.lote.intentoDesdeMs >= this.lote.esperaMs) { await this.#intentar(); return true; }
      return false;
    }
    if (!this.conectado || this.claveRechazada || !this.o.reloj) return false;
    const periodo = this.pausado ? CONSULTA_EN_PAUSA_MS : this.cfg.intervalo * 1000;
    if (!this.primera && ahora - this.ultimoCiclo < periodo) return false;
    this.ultimoCiclo = ahora; this.primera = false;
    if (this.#capturar()) return false;
    await this.#intentar();
    return true;
  }
}

function agv(objeto) { return `AGV ${JSON.stringify(objeto)}`; }
function error(codigo) { return agv({ ok: false, error: codigo }); }

const AYUDA = `Uso: node emulador.mjs [opciones]
  Lee ordenes JSON por la entrada estandar (una por linea) y responde lineas "AGV {...}".
  --auto                 Envia solo, cada intervalo, como la placa (por defecto solo con la orden enviar).
  --permitir-http        Acepta tambien http://127.0.0.1 en la orden config, para un servidor de prueba en este
                         computador. Sin ella admite https:// y http:// hacia una IPv4 privada, como la placa.
  --estado RUTA          Archivo que hace de memoria NVS. Guarda las claves en texto: no lo pongas en Git.
  --sin-red              Simula que el Wi-Fi no conecta.
  --sin-reloj            Simula que falta la hora NTP.
  --fallo-sensor         Simula un DHT22 que no responde.
  --temperatura N, --humedad N, --adc N   Lecturas inventadas (por defecto 29.4, 67.0 y 1234).`;

function principal(args) {
  if (args.includes('--ayuda') || args.includes('--help')) { console.log(AYUDA); return; }
  const valor = nombre => { const i = args.indexOf(nombre); return i >= 0 ? args[i + 1] : undefined; };
  const numero = (nombre, defecto) => { const v = valor(nombre); return v === undefined ? defecto : Number(v); };
  const adc = numero('--adc', 1234);
  if (!Number.isInteger(adc) || adc < 0 || adc > 4095 || ![numero('--temperatura', 0), numero('--humedad', 0)].every(Number.isFinite)) {
    console.error('Lecturas no validas. El ADC va de 0 a 4095.'); process.exitCode = 2; return;
  }
  const nodo = new NodoEmulado({
    permitirHttp: args.includes('--permitir-http'), red: !args.includes('--sin-red'), reloj: !args.includes('--sin-reloj'),
    falloSensor: args.includes('--fallo-sensor'), rutaEstado: valor('--estado') ?? null,
    temperatura: numero('--temperatura', 29.4), humedad: numero('--humedad', 67.0), adc, registrar: l => console.log(l),
  });
  const reloj = args.includes('--auto') ? setInterval(() => { nodo.tic().catch(() => {}); }, 250) : null;
  const lector = createInterface({ input: process.stdin, crlfDelay: Infinity });
  lector.on('line', linea => { nodo.procesarLinea(linea).then(r => { if (r) console.log(r); }); });
  lector.on('close', () => { if (reloj) clearInterval(reloj); nodo.cola.then(() => process.exit(0)); });
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) principal(process.argv.slice(2));
