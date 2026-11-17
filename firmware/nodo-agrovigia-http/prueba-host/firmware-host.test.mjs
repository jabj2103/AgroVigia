// Ejecuta la logica real de nodo-agrovigia-http.ino en el computador, con hardware falso
// (arduino-falso.h), y la compara con el emulador. Ejecutar:
//   node --test firmware/nodo-agrovigia-http/prueba-host/firmware-host.test.mjs
// Necesita g++ y la biblioteca ArduinoJson del arduino-cli local; si faltan, se omite.
// Comprueba el protocolo serie, las validaciones, el lote y los reintentos del sketch.
// No comprueba la placa, el Wi-Fi, TLS, la memoria NVS real ni los sensores.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { NodoEmulado, armarLote } from '../emulador.mjs';
import { URLS_ADMITIDAS, URLS_RECHAZADAS } from '../casos-url.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SKETCH = join(AQUI, '..');
const RAIZ = join(SKETCH, '..', '..');
const ARDUINO = process.env.AGV_ARDUINO_DIR ?? join(RAIZ, '.local', 'herramientas', 'arduino');
const ARDUINOJSON = join(ARDUINO, 'usuario', 'libraries', 'ArduinoJson', 'src');
const FALTA = spawnSync('g++', ['--version']).status !== 0 ? 'No hay g++ en este equipo.'
  : !existsSync(join(ARDUINOJSON, 'ArduinoJson.h')) ? 'Falta ArduinoJson: ejecutar compilar.sh --instalar.' : false;

const CLAVE_NODO = 'clave-de-prueba-0123456789';
const CLAVE_WIFI = 'wifi-de-prueba';
const COMPLETA = { cmd: 'config', wifi_ssid: 'Finca "Norte"', wifi_clave: CLAVE_WIFI, url: 'https://ejemplo.invalid/webhook/agrovigia/nodo', codigo: 'agv-dht22-01', clave: CLAVE_NODO, intervalo: 60, sensores: ['dht22', 'ldr'] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let carpeta, binario;
before(() => {
  if (FALTA) return;
  carpeta = mkdtempSync(join(tmpdir(), 'agv-host-'));
  const inc = join(carpeta, 'inc');
  mkdirSync(inc);
  for (const h of ['Arduino', 'WiFi', 'WiFiClientSecure', 'HTTPClient', 'Preferences', 'DHT', 'esp_random', 'esp_sntp']) writeFileSync(join(inc, `${h}.h`), '#include "arduino-falso.h"\n');
  binario = join(carpeta, 'nodo-host');
  execFileSync('g++', ['-std=c++17', '-O1', '-Wall', '-Wextra', '-Werror', '-DARDUINOJSON_ENABLE_ARDUINO_STRING=1', '-DARDUINOJSON_ENABLE_ARDUINO_PRINT=1',
    `-I${inc}`, `-I${AQUI}`, `-I${SKETCH}`, `-I${ARDUINOJSON}`, '-o', binario, join(AQUI, 'principal.cpp')], { stdio: 'inherit' });
});
after(() => { if (carpeta) rmSync(carpeta, { recursive: true, force: true }); });

// Una "placa" en el computador. paso() envia una linea y devuelve lo que salio hasta "#fin".
class Placa {
  constructor(entorno = {}) {
    this.p = spawn(binario, [], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, ...entorno } });
    this.p.stdout.setEncoding('utf8');
    this.resto = ''; this.lineas = []; this.espera = null; this.todo = [];
    this.p.stdout.on('data', d => {
      this.resto += d;
      let i;
      while ((i = this.resto.indexOf('\n')) >= 0) {
        const l = this.resto.slice(0, i); this.resto = this.resto.slice(i + 1);
        if (l === '#fin') { const listas = this.lineas; this.lineas = []; this.espera?.(listas); this.espera = null; } else { this.lineas.push(l); this.todo.push(l); }
      }
    });
  }
  static async nueva(entorno) { const p = new Placa(entorno); p.arranque = await new Promise(r => { p.espera = r; }); return p; }
  paso(linea) { return new Promise(r => { this.espera = r; this.p.stdin.write(`${typeof linea === 'string' ? linea : JSON.stringify(linea)}\n`); }); }
  // Respuesta AGV de una orden, como texto. Exige exactamente una.
  async texto(orden) { const r = (await this.paso(orden)).filter(l => l.startsWith('AGV ')); assert.equal(r.length, 1, `una respuesta AGV por orden: ${JSON.stringify(r)}`); return r[0]; }
  async orden(o) { return JSON.parse((await this.texto(o)).slice(4)); }
  async lista(extra = {}) { await this.paso('#red 1'); await this.paso('#reloj'); assert.deepEqual(await this.orden({ ...COMPLETA, ...extra }), { ok: true, guardado: true, configurado: true }); return this; }
  cerrar() { return new Promise(r => { this.p.on('close', r); this.p.stdin.end(); }); }
}
const envios = lineas => lineas.filter(l => l.startsWith('#POST ')).map(l => ({ linea: l, cuerpo: l.slice(l.indexOf(' cuerpo=') + 8) }));

test('el sketch responde igual que el emulador a las ordenes sin envio', { skip: FALTA }, async () => {
  const placa = await Placa.nueva();
  const emulado = new NodoEmulado();
  try {
    assert.match(placa.arranque[0], /^\[LISTO\] fw=agv-http version=1\.1\.0 placa=esp32 .*tls=raices_del_core configurado=0$/);
    assert.equal((await placa.orden({ cmd: 'info' })).reloj, false, 'sin sincronizacion NTP no hay reloj');
    await placa.paso('#red 1'); await placa.paso('#reloj');
    const ordenes = [
      { cmd: 'info' }, { cmd: 'leer' }, { cmd: 'enviar' }, 'esto no es json', '[1,2]', '"info"', { cmd: 'reiniciar' }, { sin: 'cmd' }, { cmd: 7 },
      JSON.stringify({ cmd: 'info', relleno: 'x'.repeat(1100) }),
      ...[{ url: 'http://ejemplo.invalid/x' }, { url: 'https://' }, { url: 'https://a b' }, { url: `https://e.invalid/${'a'.repeat(260)}` }, { url: 7 }, { url: 'https://e.invalid/"x' },
        { wifi_ssid: '' }, { wifi_ssid: 'x'.repeat(33) }, { wifi_ssid: 5 }, { wifi_clave: 'corta' }, { wifi_clave: 'x'.repeat(65) },
        { codigo: 'AGV-01' }, { codigo: 'agv"01' }, { codigo: '' }, { codigo: 'a'.repeat(65) }, { clave: '' }, { clave: 'con espacio' }, { clave: 'x'.repeat(129) }, { clave: 'eñe-no-ascii' },
        { intervalo: 9 }, { intervalo: 3601 }, { intervalo: '60' }, { intervalo: 60.5 }, { intervalo: -60 }, { intervalo: true },
        { sensores: [] }, { sensores: ['dht22', 'dht22'] }, { sensores: ['suelo'] }, { sensores: 'ldr' }, { sensores: [1] }].map(c => ({ cmd: 'config', ...c })),
      ...[...URLS_RECHAZADAS, ...URLS_ADMITIDAS, ...URLS_RECHAZADAS.slice(0, 3)].map(url => ({ cmd: 'config', url })), { cmd: 'info' },
      { ...COMPLETA, url: 'http://sin-tls.invalid' }, { cmd: 'info' },
      { cmd: 'config', wifi_ssid: 'Finca', wifi_clave: CLAVE_WIFI }, { cmd: 'info' },
      COMPLETA, { cmd: 'info' }, { cmd: 'leer' },
      { cmd: 'config', wifi_ssid: 'Otra red ñ', wifi_clave: '', intervalo: 3600, sensores: ['ldr'] }, { cmd: 'info' }, { cmd: 'leer' },
      { cmd: 'config', sensores: ['ldr', 'dht22'], intervalo: 10, wifi_clave: null }, { cmd: 'info' },
      { cmd: 'config', sensores: ['dht22'] }, { cmd: 'leer' }, { cmd: 'config' }, { cmd: 'info' },
      { cmd: 'borrar' }, { cmd: 'info' }, { cmd: 'enviar' }, { cmd: 'borrar' },
    ];
    for (const o of ordenes) {
      const linea = typeof o === 'string' ? o : JSON.stringify(o);
      assert.equal(await placa.texto(linea), await emulado.procesarLinea(linea), linea.slice(0, 120));
    }
    assert.deepEqual(await placa.paso('   '), [], 'una linea en blanco no responde');
    assert.equal(await placa.texto('{"cmd":"info"}\r'), await emulado.procesarLinea('{"cmd":"info"}\r'), 'admite CRLF');
    const salida = placa.todo.join('\n');
    assert.ok(!salida.includes(CLAVE_NODO) && !salida.includes(CLAVE_WIFI), 'ni respuestas ni registros llevan claves');
    assert.ok(placa.todo.every(l => /^AGV \{.*\}$/.test(l) || /^\[[A-Z_]+\] /.test(l)), 'solo respuestas AGV o registros [ETIQUETA]');
  } finally { await placa.cerrar(); }
});

test('enviar: cabeceras, lote identico al contrato y mismas respuestas que el emulador', { skip: FALTA }, async () => {
  const guion = [
    [200, '{"estado":"insertado","codigo":"LOTE_GUARDADO","intervalo_segundos":120,"pausado":false}'],
    [400, '{"estado":"rechazado","codigo":"VENTANA_TEMPORAL <b>"}'],
    [200, '{"estado":"duplicado","codigo":"LOTE_IDENTICO","intervalo_segundos":9999,"pausado":true}'],
    [200, 'sin json'],
    [403, 'Authorization data is wrong!'],
    [503, '{"estado":"pendiente","codigo":"RPC_SIN_CONFIRMACION"}'],
    [404, ''],
    [200, `{"estado":"insertado","codigo":"${'C'.repeat(600)}"}`],
  ];
  let t = 1_800_000_000_000;
  let siguiente = null;  // Como en la placa falsa: una sola respuesta preparada; despues, fallo de red.
  const emulado = new NodoEmulado({ ahora: () => t, fetch: async () => { const r = siguiente; siguiente = null; if (!r) throw new Error('sin red'); return r; } });
  await emulado.procesarLinea(JSON.stringify(COMPLETA));
  const placa = await (await Placa.nueva()).lista();
  const sinId = l => l.replace(/"mensaje_id":"[0-9a-f-]{36}"/, '"mensaje_id":"ID"');
  const require = createRequire(import.meta.url);
  const validador = join(RAIZ, 'n8n', 'validar-ambiental.cjs');
  try {
    for (const [estado, cuerpo] of guion) {
      await placa.paso(`#http ${estado} ${cuerpo}`);
      siguiente = new Response(cuerpo || null, { status: estado });
      const salida = await placa.paso({ cmd: 'enviar' });
      const [envio] = envios(salida);
      const respuesta = salida.find(l => l.startsWith('AGV '));
      assert.equal(sinId(respuesta), sinId(await emulado.procesarLinea('{"cmd":"enviar"}')), `respuesta a enviar con ${estado}`);
      assert.equal(envio.linea.split(' cuerpo=')[0],
        `#POST tls=raices url=${COMPLETA.url} Content-Type=application/json X-AgroVigia-Nodo=agv-dht22-01 X-AgroVigia-Clave=${CLAVE_NODO}`);
      const lote = JSON.parse(envio.cuerpo);
      assert.match(lote.mensaje_id, UUID);
      assert.equal(JSON.parse(respuesta.slice(4)).mensaje_id, lote.mensaje_id);
      assert.equal(lote.origen, 'real');
      assert.ok(Math.abs(Date.parse(lote.tomada_en) - Date.now()) < 5000, 'fecha UTC del reloj, sin milisegundos');
      assert.equal(envio.cuerpo, armarLote({ codigo: 'agv-dht22-01', id: lote.mensaje_id, fecha: lote.tomada_en, sensores: ['dht22', 'ldr'], temperatura: 29.4, humedad: 67, adc: 1234, origen: 'real' }),
        'el emulador arma el mismo texto que el sketch');
      if (existsSync(validador)) {
        const r = require(validador).prevalidarAmbiental({ topic: 'agrovigia/v2/real/nodos/agv-dht22-01/telemetria', message: envio.cuerpo, retained: false });
        assert.equal(r.estado, 'prevalidado', r.codigo);
      }
      if (estado === 503) {
        // El 503 deja el lote pendiente: se deja agotar o caducar en los dos lados antes de seguir.
        await placa.paso('#avanzar 300000'); t += 300000; await emulado.tic();
        continue;
      }
      await placa.paso('#avanzar 7000'); t += 7000;
      assert.equal(await placa.texto({ cmd: 'info' }), await emulado.procesarLinea('{"cmd":"info"}'), `info tras ${estado}`);
    }
    assert.ok(!placa.todo.filter(l => !l.startsWith('#POST ')).join('\n').includes(CLAVE_NODO), 'la clave solo viaja en la cabecera');
  } finally { await placa.cerrar(); }
});

test('en red local por http usa el cliente sin TLS y avisa; por https verifica con las raices', { skip: FALTA }, async () => {
  const local = 'http://192.168.1.19:5678/webhook/agrovigia/nodo';
  const placa = await Placa.nueva();
  try {
    await placa.paso('#red 1'); await placa.paso('#reloj');
    const alConfigurar = await placa.paso({ ...COMPLETA, url: local, codigo: 'agv-esp4c1d-27' });
    assert.ok(alConfigurar.includes('[AVISO] envio sin cifrar en red local'), 'avisa al configurar');
    await placa.paso('#http 200 {"estado":"insertado","codigo":"LOTE_GUARDADO","intervalo_segundos":60,"pausado":false}');
    let salida = await placa.paso({ cmd: 'enviar' });
    assert.equal(envios(salida)[0].linea.split(' cuerpo=')[0],
      `#POST tls=sin_cifrar url=${local} Content-Type=application/json X-AgroVigia-Nodo=agv-esp4c1d-27 X-AgroVigia-Clave=${CLAVE_NODO}`);
    assert.equal(JSON.parse(envios(salida)[0].cuerpo).nodo_codigo, 'agv-esp4c1d-27');
    assert.ok(salida.indexOf('[AVISO] envio sin cifrar en red local') >= 0 && salida.indexOf('[AVISO] envio sin cifrar en red local') < salida.findIndex(l => l.startsWith('#POST ')), 'avisa antes de cada envio');
    assert.equal(JSON.parse(salida.find(l => l.startsWith('AGV ')).slice(4)).ok, true);
    // El 401 del receptor 03i detiene los envios tambien por http.
    await placa.paso('#http 401 {"estado":"rechazado","codigo":"CLAVE_INVALIDA"}');
    assert.deepEqual({ ...await placa.orden({ cmd: 'enviar' }), mensaje_id: '' },
      { ok: false, error: 'CLAVE_RECHAZADA', estado: 'clave_invalida', http: 401, servidor: 'rechazado', codigo: 'CLAVE_INVALIDA', mensaje_id: '', intervalo: 60, pausado: false });
    assert.equal((await placa.orden({ cmd: 'info' })).envio, 'clave_invalida');
    // Paso a la nube: la misma placa, solo cambia la direccion.
    const aNube = await placa.paso({ cmd: 'config', url: COMPLETA.url });
    assert.ok(!aNube.some(l => l.startsWith('[AVISO]')));
    await placa.paso('#http 200 {}');
    salida = await placa.paso({ cmd: 'enviar' });
    assert.match(envios(salida)[0].linea, /^#POST tls=raices url=https:/);
    assert.ok(!salida.some(l => l.startsWith('[AVISO]')), 'por https no hay aviso');
    assert.ok(!placa.todo.filter(l => !l.startsWith('#POST ')).join('\n').includes(CLAVE_NODO));
  } finally { await placa.cerrar(); }
});

test('ciclo automatico: espera red y reloj, reintenta 2, 4 y 8 s y descarta', { skip: FALTA }, async () => {
  const placa = await Placa.nueva();
  try {
    assert.equal((await placa.orden(COMPLETA)).configurado, true);
    assert.equal(envios(await placa.paso('#avanzar 20000')).length, 0, 'sin Wi-Fi no captura');
    assert.deepEqual(await placa.orden({ cmd: 'enviar' }), { ok: false, error: 'SIN_WIFI' });
    await placa.paso('#red 1');
    const sinReloj = await placa.paso('#avanzar 20000');
    assert.equal(envios(sinReloj).length, 0, 'sin reloj sincronizado no captura');
    assert.ok(sinReloj.some(l => l.startsWith('[RELOJ_ESPERA]')));
    assert.deepEqual(await placa.orden({ cmd: 'enviar' }), { ok: false, error: 'SIN_RELOJ' });
    await placa.paso('#reloj');
    for (let i = 0; i < 4; i += 1) await placa.paso('#http 503 {"estado":"pendiente","codigo":"RPC_SIN_CONFIRMACION"}');
    assert.equal(envios(await placa.paso('#avanzar 1')).length, 1, 'primer envio apenas hay red y reloj');
    const cuerpos = [];
    for (const espera of [2000, 4000, 8000]) {
      assert.equal(envios(await placa.paso(`#avanzar ${espera - 30}`)).length, 0, `antes de ${espera} ms no reintenta`);
      const e = envios(await placa.paso('#avanzar 40'));
      assert.equal(e.length, 1);
      cuerpos.push(e[0].cuerpo);
    }
    assert.equal(new Set(cuerpos).size, 1, 'los reintentos conservan JSON, identificador y fecha');
    const resto = await placa.paso('#avanzar 40000');
    assert.equal(envios(resto).length, 0, 'tras el cuarto fallo no hay mas intentos de ese lote');
    assert.ok(placa.todo.some(l => l.startsWith('[LOTE_DESCARTADO]')));
    await placa.paso('#http 200 {"estado":"insertado","codigo":"OK"}');
    const nuevo = envios(await placa.paso('#avanzar 10000'));
    assert.equal(nuevo.length, 1, 'el siguiente intervalo captura un lote nuevo');
    assert.notEqual(nuevo[0].cuerpo, cuerpos[0]);
  } finally { await placa.cerrar(); }
});

test('pausa, clave rechazada y caducidad del lote', { skip: FALTA }, async () => {
  const placa = await (await Placa.nueva()).lista();
  try {
    await placa.paso('#http 200 {"estado":"insertado","codigo":"OK","pausado":true}');
    assert.equal(envios(await placa.paso('#avanzar 3100')).length, 1, 'no captura antes de 3 s de arranque');
    assert.equal((await placa.orden({ cmd: 'info' })).envio, 'pausado');
    assert.equal(envios(await placa.paso('#avanzar 299000')).length, 0, 'en pausa no envia cada intervalo');
    await placa.paso('#http 200 {"estado":"insertado","codigo":"OK","pausado":false}');
    assert.equal(envios(await placa.paso('#avanzar 1100')).length, 1, 'consulta a los 5 minutos con un envio normal');
    await placa.paso('#http 400 {"estado":"rechazado","codigo":"NODO_PAUSADO"}');
    assert.equal(envios(await placa.paso('#avanzar 60000')).length, 1, 'reanudado: vuelve al intervalo');
    assert.equal((await placa.orden({ cmd: 'info' })).envio, 'pausado', 'NODO_PAUSADO en un 400 tambien pausa');
    await placa.paso('#http 401 {}');
    assert.equal(envios(await placa.paso('#avanzar 300000')).length, 1);
    let info = await placa.orden({ cmd: 'info' });
    assert.equal(info.envio, 'clave_invalida');
    assert.equal(info.ultimo_envio.http, 401);
    assert.equal(envios(await placa.paso('#avanzar 900000')).length, 0, 'con la clave rechazada deja de enviar');
    // Cambiar la clave reanuda. Un lote sin respuesta caduca a los 300 s aunque no haya red.
    assert.equal(envios(await placa.paso({ cmd: 'config', clave: 'otra-clave-0123456789' })).length, 1, 'tras configurar envia de inmediato');
    await placa.paso('#red 0');
    const sinRed = await placa.paso('#avanzar 400000');
    assert.equal(envios(sinRed).length, 0);
    assert.ok(sinRed.some(l => l.startsWith('[LOTE_DESCARTADO]') || l.startsWith('[LOTE_CADUCADO]')));
    info = await placa.orden({ cmd: 'info' });
    assert.equal(info.wifi, 'desconectado');
    assert.equal(info.ip, '');
  } finally { await placa.cerrar(); }
});

test('sensores: sin lotes parciales, rangos del DHT22 y perfiles de un solo sensor', { skip: FALTA }, async () => {
  const placa = await (await Placa.nueva()).lista({ intervalo: 3600 });
  const require = createRequire(import.meta.url);
  const validador = join(RAIZ, 'n8n', 'validar-telemetria.cjs');
  try {
    await placa.paso('#avanzar 5000');  // Deja salir (y fallar) el primer envio automatico.
    await placa.paso('#avanzar 400000');
    for (const fallo of ['#dht nan', '#dht 80.1 50', '#dht -40.1 50', '#dht 25 100.1', '#dht 25 -0.1']) {
      await placa.paso(fallo);
      assert.deepEqual(await placa.orden({ cmd: 'leer' }), { ok: false, error: 'SENSOR_ERROR', sensor: 'dht22' }, fallo);
      const salida = await placa.paso({ cmd: 'enviar' });
      assert.equal(envios(salida).length, 0, 'no se envia un lote parcial');
      assert.deepEqual(JSON.parse(salida.find(l => l.startsWith('AGV ')).slice(4)), { ok: false, error: 'SENSOR_ERROR' });
    }
    // Con solo el LDR activo, el DHT22 en fallo no importa.
    await placa.paso('#adc 4095');
    await placa.paso('#http 200 {}');
    const soloLdr = envios(await placa.paso({ cmd: 'config', sensores: ['ldr'] }))[0].cuerpo;  // Tras configurar envia de inmediato.
    assert.equal(await placa.texto({ cmd: 'leer' }), 'AGV {"ok":true,"adc":4095,"iluminacion":100.0}');
    assert.deepEqual(JSON.parse(soloLdr).mediciones, [{ variable_codigo: 'iluminacion_relativa', valor: 100, unidad: '% relativo' }]);
    await placa.paso('#dht -40 0'); await placa.paso('#adc 0');
    await placa.paso('#http 200 {}');
    const soloDht = envios(await placa.paso({ cmd: 'config', sensores: ['dht22'] }))[0].cuerpo;
    assert.equal(await placa.texto({ cmd: 'leer' }), 'AGV {"ok":true,"temperatura":-40.0,"humedad":0.0}');
    assert.deepEqual(JSON.parse(soloDht).mediciones.map(m => m.variable_codigo), ['temperatura_aire', 'humedad_aire']);
    if (existsSync(validador)) {
      const { prevalidarTelemetria } = require(validador);
      for (const [cuerpo, perfil] of [[soloLdr, 'LDR'], [soloDht, 'DHT22']]) {
        const r = prevalidarTelemetria({ topic: 'agrovigia/v1/real/nodos/agv-dht22-01/telemetria', message: cuerpo, retained: false });
        assert.equal(r.estado, 'prevalidado', r.codigo);
        assert.equal(r.perfil_payload, perfil);
      }
    }
  } finally { await placa.cerrar(); }
});

test('la configuracion sobrevive a un reinicio y el intervalo del servidor queda guardado', { skip: FALTA }, async () => {
  const nvs = join(carpeta, 'nvs.txt');
  let placa = await (await Placa.nueva({ AGV_NVS: nvs })).lista();
  await placa.paso('#http 200 {"estado":"insertado","codigo":"OK","intervalo_segundos":300}');
  assert.equal((await placa.orden({ cmd: 'enviar' })).intervalo, 300);
  const antes = await placa.orden({ cmd: 'info' });
  await placa.cerrar();
  placa = await Placa.nueva({ AGV_NVS: nvs });
  try {
    assert.match(placa.arranque[0], /configurado=1$/);
    assert.ok(placa.arranque.some(l => l.startsWith('[WIFI_INICIO]')), 'con configuracion completa inicia la red al arrancar');
    await placa.paso('#red 1'); await placa.paso('#reloj');
    assert.deepEqual({ ...await placa.orden({ cmd: 'info' }), ultimo_envio: null }, { ...antes, ultimo_envio: null });
    assert.equal(antes.intervalo, 300);
    assert.deepEqual(await placa.orden({ cmd: 'borrar' }), { ok: true, borrado: true });
  } finally { await placa.cerrar(); }
  placa = await Placa.nueva({ AGV_NVS: nvs });
  try {
    assert.match(placa.arranque[0], /configurado=0$/);
    assert.ok(placa.arranque.some(l => l.startsWith('[CONFIG_ESPERA]')), 'sin configuracion no inicia la red');
    assert.equal((await placa.orden({ cmd: 'info' })).intervalo, 60);
  } finally { await placa.cerrar(); }
});
