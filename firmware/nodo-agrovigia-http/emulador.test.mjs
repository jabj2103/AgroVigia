// Pruebas del emulador del protocolo serie agv-http. Ejecutar: node --test firmware/nodo-agrovigia-http/emulador.test.mjs
// Comprueban el emulador y el contrato del lote. No prueban la placa ni el firmware compilado.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { URLS_ADMITIDAS, URLS_RECHAZADAS } from './casos-url.mjs';
import { NodoEmulado, URL_HTTPS, URL_HTTP_LOCAL, armarLote, indiceLdrDecimas, reglas } from './emulador.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const CLAVE_NODO = 'clave-de-prueba-0123456789';
const CLAVE_WIFI = 'wifi-de-prueba';
const COMPLETA = { cmd: 'config', wifi_ssid: 'Finca "Norte"', wifi_clave: CLAVE_WIFI, url: 'https://ejemplo.invalid/webhook/agrovigia/nodo', codigo: 'agv-dht22-01', clave: CLAVE_NODO, intervalo: 60, sensores: ['dht22', 'ldr'] };

// Envia una orden y devuelve la respuesta ya interpretada. Comprueba el prefijo AGV.
async function orden(nodo, o) {
  const linea = await nodo.procesarLinea(typeof o === 'string' ? o : JSON.stringify(o));
  assert.match(linea, /^AGV \{.*\}$/);
  assert.ok(!linea.includes('\n'));
  return JSON.parse(linea.slice(4));
}

// Servidor HTTP local que responde lo que indique `guion` y guarda lo recibido.
async function servidor(guion) {
  const recibidos = [];
  const s = createServer((req, res) => {
    let cuerpo = '';
    req.setEncoding('utf8');
    req.on('data', d => { cuerpo += d; });
    req.on('end', () => {
      recibidos.push({ metodo: req.method, ruta: req.url, cabeceras: req.headers, cuerpo });
      const [estado, respuesta] = guion(recibidos.length);
      res.writeHead(estado, { 'Content-Type': 'application/json' });
      res.end(typeof respuesta === 'string' ? respuesta : JSON.stringify(respuesta));
    });
  });
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  return { recibidos, url: `http://127.0.0.1:${s.address().port}/webhook/agrovigia/nodo`, cerrar: () => new Promise(r => s.close(r)) };
}

async function nodoLocal(url, extra = {}, config = {}) {
  const nodo = new NodoEmulado({ permitirHttp: true, ...extra });
  assert.deepEqual(await orden(nodo, { ...COMPLETA, url, ...config }), { ok: true, guardado: true, configurado: true });
  return nodo;
}

test('info sin configurar: forma exacta y sin secretos', async () => {
  const r = await orden(new NodoEmulado(), { cmd: 'info' });
  assert.deepEqual(r, {
    ok: true, fw: 'agv-http', version: '1.1.0', placa: 'esp32', configurado: false, codigo: '', wifi_ssid: '', url: '',
    tiene_clave: false, tiene_wifi_clave: false, intervalo: 60, sensores: ['dht22', 'ldr'], wifi: 'sin_configurar', ip: '',
    reloj: true, envio: 'sin_configurar', ultimo_envio: null,
  });
});

test('config valida cada campo y responde codigos estables', async () => {
  const nodo = new NodoEmulado();
  const casos = [
    [{ url: 'http://ejemplo.invalid/x' }, 'URL_INVALIDA'], [{ url: 'https://' }, 'URL_INVALIDA'], [{ url: 'https://a b' }, 'URL_INVALIDA'],
    [{ url: `https://e.invalid/${'a'.repeat(260)}` }, 'URL_INVALIDA'], [{ url: 7 }, 'URL_INVALIDA'],
    [{ wifi_ssid: '' }, 'WIFI_INVALIDO'], [{ wifi_ssid: 'x'.repeat(33) }, 'WIFI_INVALIDO'], [{ wifi_clave: 'corta' }, 'WIFI_INVALIDO'], [{ wifi_clave: 'x'.repeat(65) }, 'WIFI_INVALIDO'],
    [{ codigo: 'AGV-01' }, 'CODIGO_INVALIDO'], [{ codigo: 'agv"01' }, 'CODIGO_INVALIDO'], [{ clave: '' }, 'CLAVE_INVALIDA'], [{ clave: 'con espacio' }, 'CLAVE_INVALIDA'],
    [{ intervalo: 9 }, 'INTERVALO_INVALIDO'], [{ intervalo: 3601 }, 'INTERVALO_INVALIDO'], [{ intervalo: '60' }, 'INTERVALO_INVALIDO'], [{ intervalo: 60.5 }, 'INTERVALO_INVALIDO'],
    [{ sensores: [] }, 'SENSORES_INVALIDOS'], [{ sensores: ['dht22', 'dht22'] }, 'SENSORES_INVALIDOS'], [{ sensores: ['suelo'] }, 'SENSORES_INVALIDOS'], [{ sensores: 'ldr' }, 'SENSORES_INVALIDOS'],
  ];
  for (const [campos, codigo] of casos) assert.deepEqual(await orden(nodo, { cmd: 'config', ...campos }), { ok: false, error: codigo }, JSON.stringify(campos));
  // Un campo malo no guarda los demas de la misma orden.
  assert.deepEqual(await orden(nodo, { ...COMPLETA, url: 'http://sin-tls.invalid' }), { ok: false, error: 'URL_INVALIDA' });
  assert.equal((await orden(nodo, { cmd: 'info' })).wifi_ssid, '');
  assert.deepEqual(await orden(nodo, 'esto no es json'), { ok: false, error: 'JSON_INVALIDO' });
  assert.deepEqual(await orden(nodo, '[1,2]'), { ok: false, error: 'JSON_INVALIDO' });
  assert.deepEqual(await orden(nodo, { cmd: 'reiniciar' }), { ok: false, error: 'ORDEN_DESCONOCIDA' });
  assert.deepEqual(await orden(nodo, { sin: 'cmd' }), { ok: false, error: 'ORDEN_DESCONOCIDA' });
  assert.deepEqual(await orden(nodo, JSON.stringify({ cmd: 'info', relleno: 'x'.repeat(1100) })), { ok: false, error: 'LINEA_DEMASIADO_LARGA' });
  assert.equal(await nodo.procesarLinea('   \r'), null);
});

test('url: https siempre; http solo hacia una IPv4 privada escrita con numeros', async () => {
  const nodo = new NodoEmulado();
  for (const url of URLS_ADMITIDAS) assert.deepEqual(await orden(nodo, { cmd: 'config', url }), { ok: true, guardado: true, configurado: false }, url);
  for (const url of URLS_RECHAZADAS) assert.deepEqual(await orden(nodo, { cmd: 'config', url }), { ok: false, error: 'URL_INVALIDA' }, url);
  // La regla publicada para la web: dos expresiones regulares y dos limites.
  const reglaWeb = u => u.length <= 256 && /^[\x21-\x7e]+$/.test(u) && !u.includes('"') && (URL_HTTPS.test(u) || URL_HTTP_LOCAL.test(u));
  for (const url of [...URLS_ADMITIDAS, ...URLS_RECHAZADAS]) assert.equal(reglaWeb(url), reglas.url(url), url);
  // --permitir-http solo agrega 127.0.0.1, para un servidor de prueba en el mismo computador.
  const pruebas = new NodoEmulado({ permitirHttp: true });
  assert.equal((await orden(pruebas, { cmd: 'config', url: 'http://127.0.0.1:5678/webhook/agrovigia/nodo' })).ok, true);
  for (const url of ['http://localhost:5678/x', 'http://ejemplo.invalid/x', 'http://127.0.0.2/x', 'http://8.8.8.8/x']) assert.deepEqual(await orden(pruebas, { cmd: 'config', url }), { ok: false, error: 'URL_INVALIDA' }, url);
});

test('en red local por http envia igual y avisa en el registro que va sin cifrar', async () => {
  const registros = [], pedidos = [];
  const fetch = async (url, o) => { pedidos.push({ url, ...o }); return new Response('{"estado":"insertado","codigo":"LOTE_GUARDADO","intervalo_segundos":60,"pausado":false}', { status: 200 }); };
  const nodo = new NodoEmulado({ fetch, registrar: l => registros.push(l) });
  await orden(nodo, { ...COMPLETA, url: 'http://192.168.1.19:5678/webhook/agrovigia/nodo', codigo: 'agv-esp4c1d-27' });
  assert.equal((await orden(nodo, { cmd: 'enviar' })).ok, true);
  assert.equal(pedidos[0].url, 'http://192.168.1.19:5678/webhook/agrovigia/nodo');
  assert.equal(pedidos[0].headers['X-AgroVigia-Nodo'], 'agv-esp4c1d-27');
  assert.equal(JSON.parse(pedidos[0].body).nodo_codigo, 'agv-esp4c1d-27');
  assert.equal(registros.filter(l => l === '[AVISO] envio sin cifrar en red local').length, 2, 'avisa al configurar y en cada envio');
  registros.length = 0;
  await orden(nodo, { cmd: 'config', url: COMPLETA.url });
  await orden(nodo, { cmd: 'enviar' });
  assert.ok(!registros.some(l => l.startsWith('[AVISO]')), 'por https no hay aviso');
});

test('config guarda, conserva los campos omitidos y nunca devuelve claves', async () => {
  const nodo = new NodoEmulado();
  assert.deepEqual(await orden(nodo, { cmd: 'config', wifi_ssid: 'Finca', wifi_clave: CLAVE_WIFI }), { ok: true, guardado: true, configurado: false });
  assert.deepEqual(await orden(nodo, COMPLETA), { ok: true, guardado: true, configurado: true });
  // Cambiar solo el Wi-Fi conserva direccion, codigo, clave, intervalo y sensores.
  assert.deepEqual(await orden(nodo, { cmd: 'config', wifi_ssid: 'Otra red', wifi_clave: '', intervalo: 120, sensores: ['ldr'] }), { ok: true, guardado: true, configurado: true });
  const lineaInfo = await nodo.procesarLinea('{"cmd":"info"}\r');
  const info = JSON.parse(lineaInfo.slice(4));
  assert.deepEqual({ ...info, ultimo_envio: null }, {
    ok: true, fw: 'agv-http', version: '1.1.0', placa: 'esp32', configurado: true, codigo: 'agv-dht22-01', wifi_ssid: 'Otra red', url: COMPLETA.url,
    tiene_clave: true, tiene_wifi_clave: false, intervalo: 120, sensores: ['ldr'], wifi: 'conectado', ip: '192.0.2.10', reloj: true, envio: 'activo', ultimo_envio: null,
  });
  assert.ok(!lineaInfo.includes(CLAVE_NODO) && !lineaInfo.includes(CLAVE_WIFI));
  assert.ok(!('clave' in info) && !('wifi_clave' in info));
  assert.deepEqual(await orden(nodo, { cmd: 'borrar' }), { ok: true, borrado: true });
  assert.equal((await orden(nodo, { cmd: 'info' })).configurado, false);
  assert.deepEqual(await orden(nodo, { cmd: 'enviar' }), { ok: false, error: 'SIN_CONFIGURAR' });
});

test('leer devuelve el texto exacto y solo los sensores activos', async () => {
  const nodo = new NodoEmulado();
  assert.equal(await nodo.procesarLinea('{"cmd":"leer"}'), 'AGV {"ok":true,"temperatura":29.4,"humedad":67.0,"adc":1234,"iluminacion":30.1}');
  await orden(nodo, { cmd: 'config', sensores: ['ldr'] });
  assert.equal(await nodo.procesarLinea('{"cmd":"leer"}'), 'AGV {"ok":true,"adc":1234,"iluminacion":30.1}');
  await orden(nodo, { cmd: 'config', sensores: ['dht22'] });
  assert.equal(await nodo.procesarLinea('{"cmd":"leer"}'), 'AGV {"ok":true,"temperatura":29.4,"humedad":67.0}');
  const roto = new NodoEmulado({ falloSensor: true });
  assert.deepEqual(await orden(roto, { cmd: 'leer' }), { ok: false, error: 'SENSOR_ERROR', sensor: 'dht22' });
  for (const adc of [0, 1, 20, 2047, 2048, 4094, 4095]) assert.equal(indiceLdrDecimas(adc), Math.round(adc * 1000 / 4095));
});

test('el lote cumple los validadores de n8n (v2 con ambos sensores, v1 con uno)', t => {
  const ruta = join(AQUI, '..', '..', 'n8n');
  if (!existsSync(join(ruta, 'validar-ambiental.cjs'))) return t.skip('No estan los validadores de n8n en esta copia.');
  const require = createRequire(import.meta.url);
  const { prevalidarAmbiental } = require(join(ruta, 'validar-ambiental.cjs'));
  const { prevalidarTelemetria } = require(join(ruta, 'validar-telemetria.cjs'));
  const base = { codigo: 'agv-dht22-01', id: '3f0c1a2b-4d5e-4f60-8a7b-9c0d1e2f3a4b', fecha: '2026-11-16T21:30:00Z', temperatura: 29.4, humedad: 67, adc: 1234 };
  for (const origen of ['real', 'simulado']) {
    const v2 = armarLote({ ...base, origen, sensores: ['dht22', 'ldr'] });
    const r2 = prevalidarAmbiental({ topic: `agrovigia/v2/${origen}/nodos/agv-dht22-01/telemetria`, message: v2, retained: false });
    assert.equal(r2.estado, 'prevalidado', r2.codigo);
    assert.equal(r2.perfil_payload, 'DHT22_LDR');
    for (const [sensores, perfil] of [[['dht22'], 'DHT22'], [['ldr'], 'LDR']]) {
      const r1 = prevalidarTelemetria({ topic: `agrovigia/v1/${origen}/nodos/agv-dht22-01/telemetria`, message: armarLote({ ...base, origen, sensores }), retained: false });
      assert.equal(r1.estado, 'prevalidado', r1.codigo);
      assert.equal(r1.perfil_payload, perfil);
    }
  }
  // Texto identico al que arma el firmware con snprintf (salvo el origen del emulador).
  assert.equal(armarLote({ ...base, origen: 'real', sensores: ['dht22', 'ldr'] }),
    '{"version":2,"nodo_codigo":"agv-dht22-01","mensaje_id":"3f0c1a2b-4d5e-4f60-8a7b-9c0d1e2f3a4b","origen":"real","tomada_en":"2026-11-16T21:30:00Z",' +
    '"ldr":{"metodo":"adc12_10k_11db_v1","adc_promedio":1234},"mediciones":[{"variable_codigo":"temperatura_aire","valor":29.4,"unidad":"°C"},' +
    '{"variable_codigo":"humedad_aire","valor":67.0,"unidad":"% HR"},{"variable_codigo":"iluminacion_relativa","valor":30.1,"unidad":"% relativo"}]}');
});

test('enviar publica el lote con sus cabeceras y adopta intervalo y pausa', async () => {
  const s = await servidor(n => [200, { estado: n === 1 ? 'insertado' : 'duplicado', codigo: 'LOTE_GUARDADO', intervalo_segundos: n === 1 ? 120 : 9999, pausado: n === 2 }]);
  try {
    const nodo = await nodoLocal(s.url);
    const r = await orden(nodo, { cmd: 'enviar' });
    assert.deepEqual({ ...r, mensaje_id: '' }, { ok: true, estado: 'ok', http: 200, servidor: 'insertado', codigo: 'LOTE_GUARDADO', mensaje_id: '', intervalo: 120, pausado: false });
    const p = s.recibidos[0];
    assert.equal(p.metodo, 'POST');
    assert.equal(p.cabeceras['content-type'], 'application/json');
    assert.equal(p.cabeceras['x-agrovigia-nodo'], 'agv-dht22-01');
    assert.equal(p.cabeceras['x-agrovigia-clave'], CLAVE_NODO);
    const lote = JSON.parse(p.cuerpo);
    assert.deepEqual(Object.keys(lote), ['version', 'nodo_codigo', 'mensaje_id', 'origen', 'tomada_en', 'ldr', 'mediciones']);
    assert.equal(lote.mensaje_id, r.mensaje_id);
    assert.match(lote.mensaje_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.match(lote.tomada_en, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.equal(lote.origen, 'simulado', 'el emulador nunca marca sus lecturas como reales');
    assert.ok(!p.cuerpo.includes(CLAVE_NODO));
    let info = await orden(nodo, { cmd: 'info' });
    assert.equal(info.intervalo, 120);
    assert.equal(info.envio, 'activo');
    assert.deepEqual({ ...info.ultimo_envio, hace_s: 0 }, { estado: 'ok', http: 200, servidor: 'insertado', codigo: 'LOTE_GUARDADO', hace_s: 0 });
    // Segundo envio: intervalo fuera de rango se ignora y la pausa se adopta.
    const r2 = await orden(nodo, { cmd: 'enviar' });
    assert.equal(r2.pausado, true);
    assert.equal(r2.intervalo, 120);
    info = await orden(nodo, { cmd: 'info' });
    assert.equal(info.envio, 'pausado');
    assert.notEqual(JSON.parse(s.recibidos[1].cuerpo).mensaje_id, lote.mensaje_id);
  } finally { await s.cerrar(); }
});

test('400 descarta el lote, 401 y 403 detienen los envios', async () => {
  const s = await servidor(n => (n === 1 ? [400, { estado: 'rechazado', codigo: 'VENTANA_TEMPORAL <b>' }] : n === 2 ? [403, 'Authorization data is wrong!'] : [200, { estado: 'insertado', codigo: 'OK' }]));
  try {
    let t = 1_800_000_000_000;
    const nodo = await nodoLocal(s.url, { ahora: () => t });
    assert.deepEqual({ ...await orden(nodo, { cmd: 'enviar' }), mensaje_id: '' },
      { ok: false, error: 'ENVIO_RECHAZADO', estado: 'rechazado', http: 400, servidor: 'rechazado', codigo: 'VENTANA_TEMPORALb', mensaje_id: '', intervalo: 60, pausado: false });
    const r = await orden(nodo, { cmd: 'enviar' });
    assert.equal(r.error, 'CLAVE_RECHAZADA');
    assert.equal(r.http, 403);
    let info = await orden(nodo, { cmd: 'info' });
    assert.equal(info.envio, 'clave_invalida');
    assert.equal(info.ultimo_envio.estado, 'clave_invalida');
    // Con la clave rechazada el ciclo automatico no envia aunque pase el intervalo.
    t += 600_000;
    assert.equal(await nodo.tic(), false);
    assert.equal(s.recibidos.length, 2);
    assert.equal((await orden(nodo, { cmd: 'info' })).ultimo_envio.hace_s, 600);
    // Una orden enviar aceptada levanta el bloqueo.
    assert.equal((await orden(nodo, { cmd: 'enviar' })).ok, true);
    assert.equal((await orden(nodo, { cmd: 'info' })).envio, 'activo');
  } finally { await s.cerrar(); }
});

test('503 reintenta el mismo lote con esperas 2, 4 y 8 s y lo descarta al cuarto fallo', async () => {
  const s = await servidor(() => [503, { estado: 'pendiente', codigo: 'RPC_SIN_CONFIRMACION' }]);
  try {
    let t = 1_800_000_000_000;
    const nodo = await nodoLocal(s.url, { ahora: () => t });
    assert.equal(await nodo.tic(), true, 'primer envio apenas hay red y reloj');
    for (const espera of [2000, 4000, 8000]) {
      t += espera - 1;
      assert.equal(await nodo.tic(), false, 'todavia no toca reintentar');
      t += 1;
      assert.equal(await nodo.tic(), true);
    }
    assert.equal(s.recibidos.length, 4);
    assert.equal(new Set(s.recibidos.map(p => p.cuerpo)).size, 1, 'los reintentos conservan JSON, identificador y fecha');
    t += 20_000;
    assert.equal(await nodo.tic(), false, 'lote descartado: no hay quinto intento antes del siguiente intervalo');
    assert.equal((await orden(nodo, { cmd: 'info' })).ultimo_envio.estado, 'servidor_no_disponible');
    t += 60_000;
    assert.equal(await nodo.tic(), true);
    assert.notEqual(s.recibidos[4].cuerpo, s.recibidos[0].cuerpo, 'el siguiente ciclo captura un lote nuevo');
  } finally { await s.cerrar(); }
});

test('un lote pendiente caduca a los 300 s sin cambiar su fecha', async () => {
  let t = 1_800_000_000_000, llamadas = 0;
  const nodo = new NodoEmulado({ ahora: () => t, fetch: async () => { llamadas += 1; throw new Error('sin red'); } });
  await orden(nodo, COMPLETA);
  const r = await orden(nodo, { cmd: 'enviar' });
  assert.deepEqual({ ...r, mensaje_id: '' }, { ok: false, error: 'ERROR_RED', estado: 'error_red', http: 0, servidor: '', codigo: 'RED_-1', mensaje_id: '', intervalo: 60, pausado: false });
  t += 300_000;
  assert.equal(await nodo.tic(), false);
  assert.equal(llamadas, 1);
  assert.equal(await nodo.tic(), true, 'tras caducar captura un lote nuevo');
});

test('en pausa consulta cada 5 minutos con un envio normal y reanuda cuando el servidor lo indica', async () => {
  let enPausa = true;
  const s = await servidor(() => [200, { estado: 'insertado', codigo: 'OK', intervalo_segundos: 60, pausado: enPausa }]);
  try {
    let t = 1_800_000_000_000;
    const nodo = await nodoLocal(s.url, { ahora: () => t });
    assert.equal(await nodo.tic(), true);
    t += 299_999;
    assert.equal(await nodo.tic(), false, 'en pausa no envia cada intervalo');
    t += 1;
    enPausa = false;
    assert.equal(await nodo.tic(), true, 'consulta a los 5 minutos');
    t += 60_000;
    assert.equal(await nodo.tic(), true, 'reanudado: vuelve al intervalo normal');
    assert.equal(s.recibidos.length, 3);
    // NODO_PAUSADO en un 400 tambien deja al nodo en pausa.
  } finally { await s.cerrar(); }
  const p = await servidor(() => [400, { estado: 'rechazado', codigo: 'NODO_PAUSADO' }]);
  try {
    const nodo = await nodoLocal(p.url);
    assert.equal((await orden(nodo, { cmd: 'enviar' })).pausado, true);
  } finally { await p.cerrar(); }
});

test('sin red, sin reloj o con sensor en fallo no se envia nada', async () => {
  let llamadas = 0;
  const fetch = async () => { llamadas += 1; return new Response('{}', { status: 200 }); };
  for (const [opciones, codigo] of [[{ red: false }, 'SIN_WIFI'], [{ reloj: false }, 'SIN_RELOJ'], [{ falloSensor: true }, 'SENSOR_ERROR']]) {
    const nodo = new NodoEmulado({ fetch, ...opciones });
    await orden(nodo, COMPLETA);
    assert.deepEqual(await orden(nodo, { cmd: 'enviar' }), { ok: false, error: codigo });
    assert.equal(await nodo.tic(), false);
  }
  assert.equal(llamadas, 0);
  const sinRed = new NodoEmulado({ red: false });
  await orden(sinRed, COMPLETA);
  assert.equal((await orden(sinRed, { cmd: 'info' })).wifi, 'desconectado');
});

test('por linea de ordenes: respuestas AGV, registros sin prefijo y estado en archivo', async () => {
  const carpeta = mkdtempSync(join(tmpdir(), 'agv-emulador-'));
  const estado = join(carpeta, 'nvs.json');
  const ejecutar = lineas => new Promise((resolver, rechazar) => {
    const p = spawn(process.execPath, [join(AQUI, 'emulador.mjs'), '--estado', estado], { stdio: ['pipe', 'pipe', 'inherit'] });
    let salida = '';
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', d => { salida += d; });
    p.on('error', rechazar);
    p.on('close', codigo => (codigo === 0 ? resolver(salida.split('\n').filter(Boolean)) : rechazar(new Error(`salida ${codigo}`))));
    p.stdin.end(lineas.map(l => `${l}\n`).join(''));
  });
  try {
    const salida = await ejecutar(['{"cmd":"info"}', JSON.stringify(COMPLETA), '{"cmd":"leer"}', 'basura']);
    const respuestas = salida.filter(l => l.startsWith('AGV '));
    const registros = salida.filter(l => !l.startsWith('AGV '));
    assert.equal(respuestas.length, 4);
    assert.equal(JSON.parse(respuestas[0].slice(4)).configurado, false);
    assert.equal(respuestas[1], 'AGV {"ok":true,"guardado":true,"configurado":true}');
    assert.equal(respuestas[2], 'AGV {"ok":true,"temperatura":29.4,"humedad":67.0,"adc":1234,"iluminacion":30.1}');
    assert.equal(respuestas[3], 'AGV {"ok":false,"error":"JSON_INVALIDO"}');
    assert.ok(registros.length >= 2 && registros.every(l => /^\[[A-Z_]+\] /.test(l)), registros.join('\n'));
    assert.ok(!salida.join('\n').includes(CLAVE_NODO) && !salida.join('\n').includes(CLAVE_WIFI), 'ni respuestas ni registros llevan claves');
    // El archivo de estado hace de NVS: la configuracion sobrevive a un reinicio del emulador.
    assert.equal(JSON.parse(readFileSync(estado, 'utf8')).codigo, 'agv-dht22-01');
    const otra = await ejecutar(['{"cmd":"info"}']);
    const info = JSON.parse(otra.find(l => l.startsWith('AGV ')).slice(4));
    assert.equal(info.configurado, true);
    assert.equal(info.wifi_ssid, 'Finca "Norte"');
  } finally { rmSync(carpeta, { recursive: true, force: true }); }
});
