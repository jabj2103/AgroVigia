#!/usr/bin/env node
// Prueba REAL de punta a punta contra el entorno local en marcha (local/agrovigia.sh local-iniciar):
// Supabase local, n8n, Mosquitto, el servicio de simulacion y Gemini. No usa fixtures ni bases en memoria.
// Actua como la cuenta de prueba (inicio de sesion real, RPC con su sesion y RLS) con la misma libreria
// que la web. Tarda unos seis minutos porque espera las transiciones graduales del clima y de los ajustes.
// No imprime claves. Uso: node local/prueba-real.mjs   (o: local/agrovigia.sh local-probar)
// Deja archivado un cultivo "Prueba real ..." con el unico lote que envia como placa de prueba.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { faseClima, loteVirtual } from '../simulador/clima-modelo.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(readFileSync(path.join(raiz, '.local/entorno-local.env'), 'utf8').split(/\r?\n/).filter(l => /^[A-Z_0-9]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const { createClient } = createRequire(path.join(raiz, 'web/package.json'))('@supabase/supabase-js');
const N8N = process.env.AGROVIGIA_N8N_URL ?? 'http://127.0.0.1:5678';
const claveIngesta = readFileSync(path.join(raiz, '.local/ingesta-http/clave'), 'utf8').split(/\r?\n/)[0].trim();
const espera = ms => new Promise(r => setTimeout(r, ms));
const hora = () => new Date().toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour12: false });
const resultados = [];
const anotar = (punto, ok, texto) => { resultados.push({ punto, ok }); console.log(`${hora()}  [${ok ? 'BIEN' : 'FALLA'}] ${punto}) ${texto}`); };

const web = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const servidor = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const rpc = async (nombre, parametros) => { const { data, error } = await web.rpc(nombre, parametros); if (error) throw new Error(`${nombre}: ${error.message}`); return data; };
const contar = async (tabla, filtro = q => q) => { const { count, error } = await filtro(web.from(tabla).select('*', { count: 'exact', head: true })); if (error) throw new Error(tabla + ': ' + error.message); return count; };

const sesion = await web.auth.signInWithPassword({ email: env.AGROVIGIA_USUARIO_CORREO, password: env.AGROVIGIA_USUARIO_CLAVE });
if (sesion.error) throw new Error('Inicio de sesion: ' + sesion.error.message);
console.log(`${hora()}  Sesion real iniciada como ${env.AGROVIGIA_USUARIO_CORREO} en ${env.SUPABASE_URL}`);
const cultivos = (await web.from('cultivos').select('id,nombre,plantilla_codigo').is('archivado_en', null)).data;
const yuca = cultivos.find(c => c.plantilla_codigo === 'yuca' && c.nombre.startsWith('Simulado'));
const nodosYuca = (await web.from('nodos').select('id,codigo').eq('cultivo_id', yuca.id).is('eliminado_en', null).order('codigo')).data;
const nodo = nodosYuca[0];
const serie = async desde => (await web.from('mediciones').select('tomada_en,variable_codigo,valor').eq('nodo_id', nodo.id).eq('origen', 'simulado')
  .in('variable_codigo', ['temperatura_aire', 'humedad_aire', 'precipitacion_60min']).gte('tomada_en', desde).order('tomada_en')).data;
// Punto de partida limpio: clima normal y sin ajuste, por si una corrida anterior se interrumpio.
await rpc('establecer_clima', { p_cultivo_id: yuca.id, p_evento: 'normal', p_intensidad: 2, p_todos: false });
await rpc('ajustar_simulacion', { p_cultivo_id: yuca.id, p_ajustes: {}, p_todos: false });

// h) Realtime: suscripcion real, con la sesion de la cuenta, a los cambios de clima_cultivo.
// La suscripcion esta lista cuando Realtime avisa "Subscribed to PostgreSQL" (mensaje de sistema), no antes.
const eventos = [];
let escuchando = false;
const canal = web.channel('prueba-real').on('postgres_changes', { event: '*', schema: 'public', table: 'clima_cultivo' }, e => eventos.push(e))
  .on('system', {}, m => { if (m.status === 'ok') escuchando = true; });
await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('Realtime no confirmo la suscripcion')), 15_000); canal.subscribe(estado => { if (estado === 'SUBSCRIBED') { clearTimeout(t); resolve(); } }); });
for (let i = 0; i < 60 && !escuchando; i++) await espera(250);

// a) El servicio de simulacion publica por MQTT, n8n valida y guarda: las mediciones simuladas crecen.
const simuladas0 = await contar('mediciones', q => q.eq('origen', 'simulado')), t0 = Date.now(), inicio = new Date().toISOString();

// b) Clima y ajuste manual como la cuenta. La serie guardada de un nodo cambia poco a poco.
const antes = await serie(new Date(Date.now() - 90_000).toISOString());
await rpc('establecer_clima', { p_cultivo_id: yuca.id, p_evento: 'lluvia', p_intensidad: 3, p_todos: false });
const ajuste = await rpc('ajustar_simulacion', { p_cultivo_id: yuca.id, p_ajustes: { temperatura_aire: 6 }, p_todos: false });
console.log(`${hora()}  Lluvia extrema y ajuste de +6 C activados en "${yuca.nombre}" (${ajuste.codigo}). Nodo observado: ${nodo.codigo}`);
await espera(4000);
anotar('h', eventos.length >= 1, `Realtime entrego ${eventos.length} cambio(s) de clima_cultivo a la suscripcion (${eventos.map(e => e.eventType + ' ' + (e.new?.evento ?? '')).join(', ')})`);

// g) Gestion de cultivos, sectores y nodos virtuales contra la base real. El nodo se pausa al nacer para
// que el servicio de simulacion no le guarde lotes y el cultivo quede sin historial.
try {
  const a = await rpc('crear_cultivo', { p_nombre: 'Prueba real A ' + hora(), p_tipo: 'Mango', p_area: 2, p_unidad_area: 'ha', p_nodos: [], p_solicitud_id: randomUUID() });
  const v = await rpc('crear_nodo_virtual', { p_cultivo_id: a.id, p_zona_id: null });
  await rpc('pausar_nodo', { p_nodo_id: v.id, p_pausar: true });
  const s = await rpc('crear_sector', { p_cultivo_id: a.id, p_nombre: 'Sector de prueba', p_x: 0.1, p_y: 0.1, p_ancho: 0.3, p_alto: 0.3 });
  const u = await rpc('ubicar_nodo', { p_nodo_id: v.id, p_zona_id: s.id, p_x: 0.25, p_y: 0.75 });
  await rpc('definir_terreno', { p_cultivo_id: a.id, p_ancho_m: 120, p_largo_m: 80 });
  const b = await rpc('crear_cultivo', { p_nombre: 'Prueba real B ' + hora(), p_tipo: 'Mango', p_area: 1, p_unidad_area: 'ha', p_nodos: [], p_solicitud_id: randomUUID() });
  const m = await rpc('mover_nodo_virtual', { p_nodo_id: v.id, p_cultivo_id: b.id, p_zona_id: null });
  const zonasB = await contar('zonas', q => q.eq('cultivo_id', b.id));
  const en = await rpc('eliminar_nodo_virtual', { p_nodo_id: v.id });
  const ea = await rpc('eliminar_cultivo', { p_cultivo_id: a.id }), eb = await rpc('eliminar_cultivo', { p_cultivo_id: b.id });
  const quedan = await contar('cultivos', q => q.in('id', [a.id, b.id]));
  anotar('g', ea.codigo === 'CULTIVO_ELIMINADO' && eb.codigo === 'CULTIVO_ELIMINADO' && quedan === 0 && m.cultivo_id === b.id && u.zona_id === s.id,
    `crear_cultivo sin nodos, crear_nodo_virtual ${v.codigo}, crear_sector ${s.codigo}, ubicar_nodo (${u.posicion_x}, ${u.posicion_y}), mover_nodo_virtual al cultivo B (${zonasB} sectores creados), eliminar_nodo_virtual ${en.modo}, eliminar_cultivo A y B: ${ea.codigo}; quedan ${quedan}`);
} catch (e) { anotar('g', false, e.message); }

// f) Nodo fisico: registro como la cuenta, lote v2 real por HTTPS con su clave (flujo 03i) y clave mala.
let cultivoPlaca = null;
try {
  cultivoPlaca = await rpc('crear_cultivo', { p_nombre: 'Prueba real placa ' + hora(), p_tipo: 'Prueba', p_area: 1, p_unidad_area: 'ha', p_nodos: [], p_solicitud_id: randomUUID() });
  const reg = await rpc('registrar_nodo_fisico', { p_tipo_dispositivo: 'esp32', p_sensores: ['dht22', 'ldr'] });
  await rpc('vincular_nodo', { p_nodo_id: reg.nodo.id, p_cultivo_id: cultivoPlaca.id });
  const lote = { version: 2, nodo_codigo: reg.nodo.codigo, mensaje_id: randomUUID(), origen: 'real', tomada_en: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    mediciones: [{ variable_codigo: 'temperatura_aire', valor: 27.6, unidad: '°C' }, { variable_codigo: 'humedad_aire', valor: 68.5, unidad: '% HR' },
      { variable_codigo: 'iluminacion_relativa', valor: Math.round(2100 * 1000 / 4095) / 10, unidad: '% relativo' }], ldr: { metodo: 'adc12_10k_11db_v1', adc_promedio: 2100 } };
  const enviar = clave => fetch(N8N + '/webhook/agrovigia/nodo', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-AgroVigia-Nodo': reg.nodo.codigo, 'X-AgroVigia-Clave': clave }, body: JSON.stringify(lote) });
  const mala = await enviar('clave-equivocada-0123456789abcdef'), malaCuerpo = await mala.json();
  const buena = await enviar(reg.clave), cuerpo = await buena.json();
  const repetida = await enviar(reg.clave), cuerpoRepetida = await repetida.json();
  const guardadas = (await web.from('mediciones').select('variable_codigo,valor,origen').eq('mensaje_id', lote.mensaje_id).order('variable_codigo')).data;
  anotar('f', buena.status === 200 && cuerpo.estado === 'insertado' && mala.status === 401 && guardadas.length === 3 && guardadas.every(x => x.origen === 'real'),
    `registrar_nodo_fisico ${reg.nodo.codigo}; 03i con su clave: HTTP ${buena.status} ${JSON.stringify(cuerpo)}; reenvio: HTTP ${repetida.status} ${cuerpoRepetida.estado}; clave mala: HTTP ${mala.status} ${JSON.stringify(malaCuerpo)}; guardadas ${guardadas.length} mediciones de origen ${[...new Set(guardadas.map(x => x.origen))].join()} (${guardadas.map(x => x.valor).join(', ')})`);
  await rpc('eliminar_nodo_fisico', { p_nodo_id: reg.nodo.id });
  await rpc('archivar_cultivo', { p_cultivo_id: cultivoPlaca.id });
} catch (e) { anotar('f', false, e.message); }

// e) Webhook 03g: el transporte HTTP del simulador, con la clave compartida de ingesta.
try {
  const estado = (await servidor.rpc('estado_simulacion')).data, c = estado.cultivos.find(x => x.cultivo_id === yuca.id), n = c.nodos.find(x => x.codigo === nodosYuca.at(-1).codigo);
  const l = loteVirtual(n, c.parametros, faseClima(null, null, Date.now()), new Date(), { ejecucion: randomUUID() });
  const r = await fetch(N8N + '/webhook/agrovigia/telemetria', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-AgroVigia-Clave': claveIngesta }, body: JSON.stringify({ topico: l.topico, payload: l.payload }) });
  const cuerpo = await r.json(), sinClave = await fetch(N8N + '/webhook/agrovigia/telemetria', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const filas = await contar('mediciones', q => q.eq('mensaje_id', l.payload.mensaje_id));
  anotar('e', r.status === 200 && filas === 10, `03g respondio HTTP ${r.status} ${JSON.stringify(cuerpo)}; ${filas} mediciones guardadas de ese lote; sin clave: HTTP ${sinClave.status}`);
} catch (e) { anotar('e', false, e.message); }

// d) Sugerencia a peticion: solicitud de la cuenta, flujo 03h de n8n, Gemini real y sugerencia guardada.
try {
  await espera(Math.max(0, 45_000 - (Date.now() - t0)));
  const pedido = await rpc('solicitar_sugerencia_ia', { p_cultivo_id: yuca.id, p_origen: 'simulado' });
  let fila = null;
  for (let i = 0; i < 40 && pedido.solicitud_id; i++) {
    await espera(4000);
    fila = (await web.from('solicitudes_ia').select('estado,detalle,sugerencia_id,creada_en,cerrada_en').eq('id', pedido.solicitud_id).single()).data;
    if (fila?.cerrada_en) break;
  }
  const sug = fila?.sugerencia_id ? (await web.from('sugerencias_ia').select('estado,motivo,modelo,tokens_entrada,tokens_salida,error_codigo,respuesta,contexto').eq('id', fila.sugerencia_id).single()).data : null;
  anotar('d', fila?.estado === 'atendida' && sug?.estado === 'generada',
    `solicitar_sugerencia_ia ${pedido.codigo}; solicitud ${fila?.estado ?? 'sin cerrar'}${fila?.detalle ? ' (' + fila.detalle + ')' : ''} en ${fila?.cerrada_en ? Math.round((Date.parse(fila.cerrada_en) - Date.parse(fila.creada_en)) / 1000) : '?'} s; sugerencia ${sug?.estado ?? 'ninguna'} motivo ${sug?.motivo} modelo ${sug?.modelo} tokens ${sug?.tokens_entrada}/${sug?.tokens_salida}; estado_general ${sug?.respuesta?.estado_general}; clima en contexto ${sug?.contexto?.clima_simulado?.evento}; ajustes ${JSON.stringify(sug?.contexto?.ajustes_manuales)}`);
  if (sug?.respuesta?.resumen) console.log(`${hora()}      Gemini: ${sug.respuesta.resumen.slice(0, 220)}`);
} catch (e) { anotar('d', false, e.message); }

// b y c) Tras la transicion (dos minutos): serie gradual y alertas abiertas por las reglas simuladas.
await espera(Math.max(0, 150_000 - (Date.now() - t0)));
const subida = await serie(new Date(t0 - 5000).toISOString());
const porVariable = v => subida.filter(x => x.variable_codigo === v).map(x => Number(x.valor));
const T = porVariable('temperatura_aire'), H = porVariable('humedad_aire'), P = porVariable('precipitacion_60min');
const tAntes = antes.filter(x => x.variable_codigo === 'temperatura_aire').map(x => Number(x.valor)).at(-1);
const escalones = new Set(T).size;
anotar('b', T.length >= 6 && escalones >= 5 && Math.max(...P) === 55 && T.at(-1) > T[0],
  `serie guardada de ${nodo.codigo} durante la transicion (${T.length} lotes, ${escalones} valores distintos): temperatura antes ${tAntes} C y despues ${T.join(' ')}; humedad ${H.join(' ')}; lluvia ${P.join(' ')}`);
const abiertas = (await web.from('alertas').select('variable_codigo,limite,umbral,valor_ultimo,abierta_en').eq('cultivo_id', yuca.id).eq('origen', 'simulado').is('cerrada_en', null).gte('abierta_en', inicio)).data;
const porRegla = Object.entries(Object.groupBy(abiertas, x => x.variable_codigo + ' ' + x.limite + ' ' + Number(x.umbral))).map(([k, v]) => `${k}: ${v.length}`).join('; ');
console.log(`${hora()}  Alertas abiertas por las reglas simuladas de "${yuca.nombre}" desde el inicio: ${abiertas.length} (${porRegla})`);

// Vuelta a normal: los valores regresan poco a poco y las alertas se cierran por volver al rango.
await rpc('establecer_clima', { p_cultivo_id: yuca.id, p_evento: 'normal', p_intensidad: 2, p_todos: false });
await rpc('ajustar_simulacion', { p_cultivo_id: yuca.id, p_ajustes: {}, p_todos: false });
const t1 = Date.now();
console.log(`${hora()}  Clima normal y ajuste retirado. Esperando el regreso gradual...`);
await espera(170_000);
const bajada = (await serie(new Date(t1 - 2000).toISOString())).filter(x => x.variable_codigo === 'temperatura_aire').map(x => Number(x.valor));
console.log(`${hora()}  Regreso de la temperatura de ${nodo.codigo}: ${bajada.join(' ')}`);
const cerradas = (await web.from('alertas').select('variable_codigo,motivo_cierre').eq('cultivo_id', yuca.id).eq('origen', 'simulado').gte('abierta_en', inicio).not('cerrada_en', 'is', null)).data;
const siguenAbiertas = await contar('alertas', q => q.eq('cultivo_id', yuca.id).eq('origen', 'simulado').is('cerrada_en', null).gte('abierta_en', inicio));
const motivos = Object.entries(Object.groupBy(cerradas, x => x.motivo_cierre)).map(([k, v]) => `${k}: ${v.length}`).join('; ');
anotar('c', abiertas.length >= 1 && cerradas.length >= abiertas.length && siguenAbiertas === 0, `las reglas abrieron ${abiertas.length} alertas reales y despues se cerraron ${cerradas.length} (${motivos}); siguen abiertas ${siguenAbiertas}`);

const simuladas1 = await contar('mediciones', q => q.eq('origen', 'simulado')), minutos = (Date.now() - t0) / 60_000;
anotar('a', simuladas1 - simuladas0 > 500, `mediciones simuladas guardadas: ${simuladas0} al empezar y ${simuladas1} al terminar (+${simuladas1 - simuladas0} en ${minutos.toFixed(1)} min, unas ${Math.round((simuladas1 - simuladas0) / minutos)} por minuto)`);
await web.removeChannel(canal); await web.auth.signOut();
const fallos = resultados.filter(r => !r.ok).map(r => r.punto);
console.log(fallos.length ? `RESULTADO: fallaron los puntos ${fallos.join(', ')}` : 'RESULTADO: los ocho puntos pasaron contra servicios reales en este equipo.');
process.exit(fallos.length ? 1 : 0);
