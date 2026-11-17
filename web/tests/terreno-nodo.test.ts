import test from 'node:test';
import assert from 'node:assert/strict';
import { ajustarRect, distanciaMetros, medidasDe, posicionNodo, sectorEn } from '../src/terreno-data.ts';
import type { Sector } from '../src/terreno-data.ts';
import { extraerRespuesta, PlacaSerie, validarConfig } from '../src/nodo-fisico-data.ts';
import { panalRed } from '../src/red-data.ts';
import type { EstadoNodoRed } from '../src/red-data.ts';

const cultivo = { id: 'c', nombre: 'Lote', tipo: 'Plátano', area: 1, unidad_area: 'ha' };
const sector = (id: string, x: number, y: number, ancho: number, alto: number): Sector => ({ id, cultivo_id: 'c', codigo: id, nombre: id, plano_x: x, plano_y: y, plano_ancho: ancho, plano_alto: alto });

test('terreno: medidas declaradas o cuadrado estimado con el area; posiciones y distancias en metros', () => {
  assert.deepEqual(medidasDe(cultivo), { ancho: 100, largo: 100, declaradas: false }, '1 ha sin medidas se estima como 100 por 100 m');
  assert.deepEqual(medidasDe({ ...cultivo, area: 2500, unidad_area: 'm2' }), { ancho: 50, largo: 50, declaradas: false });
  const m = medidasDe({ ...cultivo, ancho_m: 200, largo_m: 50 });
  assert.deepEqual(m, { ancho: 200, largo: 50, declaradas: true });
  const sectores = [sector('norte', 0, 0, 1, 0.4), sector('vivero', 0.1, 0.5, 0.2, 0.4)];
  // Un nodo en el centro del vivero esta a 40 m del borde izquierdo y 35 m del superior.
  const a = posicionNodo({ zona_id: 'vivero', posicion_x: 0.5, posicion_y: 0.5 }, sectores, m)!;
  assert.deepEqual([a.x, a.y], [40, 35]);
  const b = posicionNodo({ zona_id: 'norte', posicion_x: 0.275, posicion_y: 0.5 }, sectores, m)!;
  assert.deepEqual([b.x, b.y], [55, 10]);
  assert.equal(distanciaMetros(a, b), 29.2, 'hipotenusa de 15 y 25 m');
  assert.equal(posicionNodo({ zona_id: null, posicion_x: null, posicion_y: null }, sectores, m), null, 'sin sector no hay posicion: no se inventa');
  assert.equal(posicionNodo({ zona_id: 'otro', posicion_x: 0.5, posicion_y: 0.5 }, sectores, m), null);
});

test('terreno: el punto cae en el sector mas pequeno que lo contiene y los rectangulos se recortan al terreno', () => {
  const sectores = [sector('grande', 0, 0, 1, 1), sector('chico', 0.4, 0.4, 0.2, 0.2)];
  assert.equal(sectorEn(0.5, 0.5, sectores)?.id, 'chico');
  assert.equal(sectorEn(0.1, 0.1, sectores)?.id, 'grande');
  assert.equal(sectorEn(0.5, 0.5, [sector('lejos', 0, 0, 0.2, 0.2)]), null);
  assert.deepEqual(ajustarRect(0.9, 0.95, 0.5, 0.001), { x: 0.5, y: 0.95, ancho: 0.5, alto: 0.02 }, 'se corre hacia adentro y respeta el minimo');
  assert.deepEqual(ajustarRect(-1, -1, 3, 3), { x: 0, y: 0, ancho: 1, alto: 1 });
});

test('escenario: con plano cada nodo va en su posicion real a escala; sin plano se conserva el hexagono', () => {
  const fila = (id: string, simulado: boolean): EstadoNodoRed => ({ nodo_id: id, codigo: id, simulado, habilitado: true, cultivo_id: 'c', cultivo_nombre: 'Lote', plantilla_codigo: null,
    origen: null, mensaje_id: null, tomada_en: null, recibida_en: null, temperatura: null, humedad: null, iluminacion: null });
  const filas = [fila('a', true), fila('b', true), fila('f', false)];
  const sinPlano = panalRed(filas);
  assert.equal(sinPlano.grupos[0]!.plano, undefined);
  const planos = new Map([['c', { medidas: { ancho: 200, largo: 50, declaradas: true }, sectores: [sector('s', 0, 0, 1, 1)],
    nodos: [{ id: 'a', codigo: 'a', cultivo_id: 'c', tipo_nodo: 'virtual' as const, zona_id: 's', posicion_x: 0, posicion_y: 0 }, { id: 'b', codigo: 'b', cultivo_id: 'c', tipo_nodo: 'virtual' as const, zona_id: 's', posicion_x: 1, posicion_y: 1 }] }]]);
  const p = panalRed(filas, planos), g = p.grupos[0]!;
  assert.deepEqual([g.plano!.W, g.plano!.L], [8, 2], 'el lado mayor ocupa 8 unidades y el otro guarda la proporcion 4 a 1');
  const a = p.posiciones.get('a')!, b = p.posiciones.get('b')!, f = p.posiciones.get('f')!;
  assert.deepEqual([b.x - a.x, b.z - a.z], [8, 2], 'de esquina a esquina del terreno');
  assert.ok(f.z > b.z, 'el nodo sin ubicar queda fuera del terreno, al borde');
});

test('placa por USB: solo cuenta la linea que empieza por AGV; registros y lineas a medias se ignoran', () => {
  assert.deepEqual(extraerRespuesta('[LISTO] fw=agv-http\n[WIFI] conectando\n'), { respuesta: null, resto: '' });
  assert.deepEqual(extraerRespuesta('[WIFI] ok\nAGV {"ok":true,"fw":"agv-http"}\n[RELOJ] ok\nAGV {"ok":fal'), { respuesta: { ok: true, fw: 'agv-http' }, resto: '[RELOJ] ok\nAGV {"ok":fal' });
  assert.deepEqual(extraerRespuesta('AGV {"ok":tr'), { respuesta: null, resto: 'AGV {"ok":tr' }, 'una respuesta incompleta espera el resto');
  assert.deepEqual(extraerRespuesta('AGV no es json\nAGV [1,2]\nAGV {"ok":false,"error":"URL_INVALIDA"}\n').respuesta, { ok: false, error: 'URL_INVALIDA' });
});

test('placa por USB: el timeout cancela la lectura y permite reconectar el mismo puerto', async t => {
  let aperturas = 0, cancelaciones = 0, cierres = 0;
  let entrada: ReadableStreamDefaultController<Uint8Array>;
  const ordenes: string[] = [];
  const puerto = {
    readable: null as ReadableStream<Uint8Array> | null,
    writable: null as WritableStream<Uint8Array> | null,
    async open() {
      aperturas++;
      this.readable = new ReadableStream<Uint8Array>({ start: c => { entrada = c; }, cancel: () => { cancelaciones++; } });
      this.writable = new WritableStream<Uint8Array>({ write(bytes) {
        ordenes.push(JSON.parse(new TextDecoder().decode(bytes)).cmd);
        if (aperturas === 2) entrada.enqueue(new TextEncoder().encode('AGV {"ok":true,"fw":"agv-http"}\n'));
      } });
    },
    async close() {
      assert.equal(this.readable?.locked, false);
      assert.equal(this.writable?.locked, false);
      this.readable = this.writable = null;
      cierres++;
    },
  };
  Object.defineProperty(navigator, 'serial', { configurable: true, value: { requestPort: async () => puerto } });
  t.after(() => { Reflect.deleteProperty(navigator, 'serial'); });

  const primera = await PlacaSerie.conectar();
  await assert.rejects(primera.orden({ cmd: 'leer' }, 30), /Vuelve a conectarla por USB/);
  assert.deepEqual([cancelaciones, cierres], [1, 1]);
  await assert.rejects(primera.orden({ cmd: 'leer' }), /Vuelve a conectar/);
  const segunda = await PlacaSerie.conectar();
  try {
    assert.deepEqual(await segunda.orden({ cmd: 'info' }, 500), { ok: true, fw: 'agv-http' });
    assert.deepEqual(ordenes, ['leer', 'info']);
  } finally { await segunda.cerrar(); }
});

test('placa por USB: la configuracion se valida antes de enviarla y exige https y clave', () => {
  const base = { wifi_ssid: 'Finca', wifi_clave: 'clave-wifi-1', url: 'https://n8n.example/webhook/agrovigia/nodo', codigo: 'agv-esp4c1d-27', clave: 'k'.repeat(43), intervalo: 60 };
  assert.equal(validarConfig(base), '');
  assert.equal(validarConfig({ ...base, wifi_clave: '' }), '', 'red abierta admitida');
  assert.equal(validarConfig({ ...base, url: 'http://192.168.1.19:5678/webhook/agrovigia/nodo' }), '', 'sin cifrar solo hacia una IP privada de la red local');
  for (const cambio of [{ wifi_ssid: ' ' }, { wifi_clave: 'corta' }, { url: 'http://n8n.example/webhook/agrovigia/nodo' }, { url: 'http://8.8.8.8/webhook/agrovigia/nodo' }, { url: 'http://localhost:5678/webhook/agrovigia/nodo' }, { url: 'http://192.168.01.5/webhook' }, { url: 'http://172.32.0.1/webhook' }, { url: 'http://127.0.0.1:5678/webhook/agrovigia/nodo' }, { clave: '' }, { intervalo: 5 }, { intervalo: 60.5 }])
    assert.notEqual(validarConfig({ ...base, ...cambio }), '', JSON.stringify(cambio));
});

test('configuracion de la web: nube por https o Supabase local por http; nunca una clave de servidor', async () => {
  const { validarEntornoPublico } = await import('../src/config.ts');
  const jwt = (rol: string) => 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ role: rol })).toString('base64url') + '.firma';
  assert.deepEqual(validarEntornoPublico({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local' }), { lista: true, url: 'http://127.0.0.1:54321', clave: 'sb_publishable_local' });
  assert.equal(validarEntornoPublico({ VITE_SUPABASE_URL: 'http://192.168.1.19:54321/', VITE_SUPABASE_PUBLISHABLE_KEY: jwt('anon') }).lista, true, 'JWT anon admitido solo en local');
  assert.throws(() => validarEntornoPublico({ VITE_SUPABASE_URL: 'https://proyecto.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: jwt('anon') }), /Publishable key/);
  assert.throws(() => validarEntornoPublico({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_PUBLISHABLE_KEY: jwt('service_role') }), /clave privada/);
  for (const url of ['http://8.8.8.8:54321', 'http://ejemplo.com', 'http://127.0.0.1:54321/rest/v1', 'http://127.0.0.1.ejemplo.com'])
    assert.throws(() => validarEntornoPublico({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' }), /VITE_SUPABASE_URL/, url);
});
