// Modelo puro del servicio de simulacion: valores de referencia por cultivo, eventos de clima y lotes.
// Sin red. Todo dato generado aqui es SIMULADO: los nodos virtuales viajan por agrovigia/v3/simulado/...
// y la proyeccion de un nodo fisico por agrovigia/v2/simulado/..., nunca por topicos reales.
// Los efectos de cada evento son un modelo de prueba para ver reaccionar la plataforma, no un modelo
// agronomico ni meteorologico validado.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { VARIABLES, PASOS, ZONAS, crearCaptura, validarValor } from './public/motor.mjs';
import { prepararCapturaV3 } from './contrato-v3.mjs';
const { prevalidarAmbiental, indiceLdr } = createRequire(import.meta.url)('../n8n/validar-ambiental.cjs');

export const SEGUNDOS_TRANSICION = 120;      // de la referencia al efecto completo, y de vuelta
export const CADUCIDAD_MS = 300_000;
export const REINTENTOS_MS = [2000, 4000, 8000];
export const METODO_LDR = 'adc12_10k_11db_v1';
const catalogo = new Map(VARIABLES.map(v => [v.codigo, v]));

// Efecto por variable e intensidad (1 moderado, 2 fuerte, 3 extremo):
//   delta: suma al valor; factor: multiplica; fijo: lleva a ese valor; minimo: sube hasta ese valor si estaba por debajo.
// 'escenario' es el identificador del contrato v3 de Juan con el que se etiqueta el lote.
export const EVENTOS = Object.freeze({
  lluvia: { nombre: 'Lluvia fuerte', escenario: 'lluvia', efectos: {
    precipitacion_60min: ['fijo', [8, 25, 55]], humedad_aire: ['delta', [12, 22, 30]], temperatura_aire: ['delta', [-1.5, -3, -4.5]],
    humedad_suelo_vwc: ['delta', [6, 14, 24]], radiacion_solar: ['factor', [0.5, 0.25, 0.12]], iluminacion_relativa: ['factor', [0.55, 0.3, 0.15]],
    velocidad_viento: ['delta', [1, 3, 5]], temperatura_suelo: ['delta', [-0.5, -1.5, -2.5]] } },
  sol_fuerte: { nombre: 'Sol fuerte', escenario: 'calor-seco', efectos: {
    temperatura_aire: ['delta', [3, 6, 9]], humedad_aire: ['delta', [-8, -16, -24]], radiacion_solar: ['minimo', [850, 1050, 1250]],
    iluminacion_relativa: ['minimo', [80, 92, 99]], humedad_suelo_vwc: ['delta', [-1.5, -3, -5]], temperatura_suelo: ['delta', [2, 4, 6]] } },
  tierra_seca: { nombre: 'Tierra seca', escenario: 'calor-seco', efectos: {
    humedad_suelo_vwc: ['delta', [-6, -12, -18]], humedad_aire: ['delta', [-4, -8, -12]], temperatura_suelo: ['delta', [1, 2, 3]],
    conductividad_suelo_ece: ['delta', [0.2, 0.5, 0.9]] } },
  viento: { nombre: 'Viento fuerte', escenario: 'viento', efectos: {
    velocidad_viento: ['fijo', [8, 14, 22]], humedad_aire: ['delta', [-3, -6, -9]], temperatura_aire: ['delta', [-0.5, -1, -1.5]] } },
});

const limitar = (v, a, b) => Math.min(b, Math.max(a, v));
const ajustar = (codigo, valor) => {
  const v = catalogo.get(codigo);
  return Number((Math.round(limitar(valor, v.min, v.max) / v.paso) * v.paso).toFixed(4));
};
// Hora decimal en Colombia (UTC-5, sin horario de verano).
export function horaBogota(fecha) { return ((fecha.getUTCHours() + 19) % 24) + fecha.getUTCMinutes() / 60; }
function hash(texto) {
  let h = 2166136261;
  for (const c of texto) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
  return (h >>> 0) / 4294967296;
}

// Centro, amplitud diaria y variacion por nodo de una variable con rangos: caben dentro de los limites
// de alerta del cultivo, para que en clima normal ningun nodo abra alertas por si solo.
function banda(p, prefijo, amplitud, ruido) {
  const min = Number(p[prefijo + '_min']), max = Number(p[prefijo + '_max']);
  const centro = (Number(p[prefijo + '_optima_min']) + Number(p[prefijo + '_optima_max'])) / 2;
  const margen = Math.max(0, Math.min(centro - min, max - centro));
  return { centro, amplitud: Math.min(amplitud, margen * 0.6), ruido: Math.min(ruido, margen * 0.2) };
}
const numeros = (p, prefijo) => ['_min', '_optima_min', '_optima_max', '_max'].every(s => Number.isFinite(Number(p?.[prefijo + s])));

// Valores de referencia (clima normal) de un nodo virtual a una hora: centro del rango optimo vigente
// del cultivo + ciclo del dia + variacion fija del nodo. Sin parametros usa las bases genericas del motor.
export function referencia(nodo, parametros, fecha) {
  const base = c => catalogo.get(c).base;
  const t = numeros(parametros, 'temperatura') ? banda(parametros, 'temperatura', 3.3, 0.6) : { centro: base('temperatura_aire'), amplitud: 3.3, ruido: 0.6 };
  const h = numeros(parametros, 'humedad') ? banda(parametros, 'humedad', 10, 1.5) : { centro: base('humedad_aire'), amplitud: 10, ruido: 1.5 };
  const s = numeros(parametros, 'suelo_vwc') ? banda(parametros, 'suelo_vwc', 1.5, 0.75) : { centro: base('humedad_suelo_vwc'), amplitud: 1.5, ruido: 0.75 };
  const hora = horaBogota(fecha), termica = Math.cos(((hora - 14) / 24) * 2 * Math.PI), sol = Math.max(0, Math.sin(((hora - 6) / 12) * Math.PI));
  const r = c => (hash(nodo.codigo + ':' + c) - 0.5) * 2; // -1 a 1, fijo por nodo y variable
  return {
    temperatura_aire: ajustar('temperatura_aire', t.centro + t.amplitud * termica + r('t') * t.ruido),
    humedad_aire: ajustar('humedad_aire', h.centro - h.amplitud * termica + r('h') * h.ruido),
    iluminacion_relativa: ajustar('iluminacion_relativa', 1 + 85 * sol * (0.92 + 0.05 * r('l'))),
    radiacion_solar: ajustar('radiacion_solar', 950 * sol * (0.92 + 0.05 * r('l'))),
    humedad_suelo_vwc: ajustar('humedad_suelo_vwc', s.centro - s.amplitud * Math.max(0, termica) + r('s') * s.ruido),
    temperatura_suelo: ajustar('temperatura_suelo', t.centro - 2 + 1.2 * termica + r('ts') * 0.3),
    ph_suelo: ajustar('ph_suelo', base('ph_suelo') + r('ph') * 0.15),
    conductividad_suelo_ece: ajustar('conductividad_suelo_ece', base('conductividad_suelo_ece') + r('ce') * 0.15),
    precipitacion_60min: 0,
    velocidad_viento: ajustar('velocidad_viento', base('velocidad_viento') + 1.2 * Math.max(0, termica) + r('v') * 0.3),
  };
}

// Fase del clima de un cultivo en un instante: evento activo (sube en SEGUNDOS_TRANSICION), regreso
// gradual tras terminar, o normal. 'progreso' va de 0 (referencia) a 1 (efecto completo).
export function faseClima(clima, climaAnterior, ahoraMs) {
  const valido = k => k && Object.hasOwn(EVENTOS, k.evento) && [1, 2, 3].includes(Number(k.intensidad));
  if (valido(clima)) {
    const p = limitar((ahoraMs - Date.parse(clima.iniciado_en)) / (SEGUNDOS_TRANSICION * 1000), 0, 1);
    return { fase: 'evento', evento: clima.evento, intensidad: Number(clima.intensidad), progreso: Math.max(p, 1 / PASOS),
      escenario: EVENTOS[clima.evento].escenario, modo: 'escenario', paso: limitar(Math.ceil(p * PASOS), 1, PASOS) };
  }
  if (valido(climaAnterior) && Number.isFinite(Date.parse(climaAnterior.finalizado_en))) {
    const q = limitar((ahoraMs - Date.parse(climaAnterior.finalizado_en)) / (SEGUNDOS_TRANSICION * 1000), 0, 1);
    if (q < 1) return { fase: 'regreso', evento: climaAnterior.evento, intensidad: Number(climaAnterior.intensidad), progreso: 1 - q,
      escenario: 'recuperacion', modo: 'escenario', paso: limitar(Math.ceil(q * PASOS), 1, PASOS) };
  }
  return { fase: 'normal', evento: null, intensidad: null, progreso: 0, escenario: 'referencia', modo: 'manual', paso: 0 };
}
// Firma para detectar cambios de clima entre dos sondeos.
export const firmaClima = f => f.fase === 'normal' ? 'normal' : `${f.fase}:${f.evento}:${f.intensidad}`;

function destino(valor, [tipo, porIntensidad], intensidad) {
  const x = porIntensidad[intensidad - 1];
  return tipo === 'delta' ? valor + x : tipo === 'factor' ? valor * x : tipo === 'minimo' ? Math.max(valor, x) : x;
}
// Aplica un evento sobre unos valores segun el progreso de la fase. Solo toca las variables presentes.
export function aplicarEvento(valores, fase) {
  if (fase.fase === 'normal') return { ...valores };
  const efectos = EVENTOS[fase.evento].efectos;
  return Object.fromEntries(Object.entries(valores).map(([c, v]) =>
    [c, efectos[c] ? ajustar(c, v + (destino(v, efectos[c], fase.intensidad) - v) * fase.progreso) : v]));
}

// Ajuste manual de la simulacion (tabla ajustes_simulacion, 0011): deltas de PRUEBA que el usuario suma
// en la web a lo que ya produce la simulacion. Clave: [minimo, maximo] del delta. Mismos limites que la RPC.
export const AJUSTES = Object.freeze({ temperatura_aire: [-10, 10], humedad_aire: [-30, 30], humedad_suelo_vwc: [-30, 30],
  ph_suelo: [-2, 2], precipitacion_60min: [-50, 50], velocidad_viento: [-10, 15] });
// Lo unico que mide el nodo fisico y admite ajuste: su proyeccion solo usa estas claves.
export const AJUSTES_FISICO = Object.freeze(['temperatura_aire', 'humedad_aire']);
// Normaliza los ajustes recibidos: solo claves conocidas, numeros finitos distintos de cero, dentro de su
// rango y con un decimal. Devuelve null si no queda ninguno. 'claves' limita el resultado (nodo fisico).
export function leerAjustes(ajustes, claves = Object.keys(AJUSTES)) {
  if (!ajustes || typeof ajustes !== 'object' || Array.isArray(ajustes)) return null;
  const salida = {};
  for (const c of claves) {
    if (!Object.hasOwn(AJUSTES, c) || typeof ajustes[c] !== 'number' || !Number.isFinite(ajustes[c])) continue;
    const v = Math.round(limitar(ajustes[c], ...AJUSTES[c]) * 10) / 10;
    if (v !== 0) salida[c] = v;
  }
  return Object.keys(salida).length ? salida : null;
}
// Transicion gradual del ajuste manual. Un sensor no ve un salto: cada cambio de ajuste lleva los valores
// desde lo que habia en ese instante hasta el nuevo objetivo en SEGUNDOS_TRANSICION, tambien al volver a
// automatico. 'previo' es el estado que devolvio la llamada anterior para ese cultivo (null la primera vez:
// entonces se parte de cero en el momento en que se activo el ajuste).
const avance = (e, ahoraMs) => e.segundos > 0 ? limitar((ahoraMs - e.inicio) / (e.segundos * 1000), 0, 1) : 1;
const enTransicion = (e, ahoraMs) => {
  const p = avance(e, ahoraMs);
  return Object.fromEntries([...new Set([...Object.keys(e.desde), ...Object.keys(e.meta)])].map(k => [k, (e.desde[k] ?? 0) + ((e.meta[k] ?? 0) - (e.desde[k] ?? 0)) * p]));
};
export function transicionAjustes(previo, objetivo, iniciadoEn, ahoraMs, segundos = SEGUNDOS_TRANSICION) {
  const meta = leerAjustes(objetivo) ?? {}, firma = firmaAjustes(meta), inicioDeclarado = Date.parse(iniciadoEn ?? '');
  let e = previo;
  if (!e) e = { firma, desde: {}, meta, segundos, inicio: Number.isFinite(inicioDeclarado) ? Math.min(inicioDeclarado, ahoraMs) : ahoraMs - segundos * 1000 };
  else if (e.firma !== firma) e = { firma, desde: enTransicion(e, ahoraMs), meta, segundos, inicio: ahoraMs };
  const progreso = avance(e, ahoraMs);
  const vigente = Object.fromEntries(Object.entries(enTransicion(e, ahoraMs)).map(([k, v]) => [k, Math.round(v * 10) / 10]).filter(([, v]) => v !== 0));
  return { estado: e, ajustes: Object.keys(vigente).length ? vigente : null, progreso, enTransicion: progreso < 1 };
}
export const firmaAjustes = ajustes => ajustes ? Object.keys(ajustes).sort().map(c => c + '=' + ajustes[c]).join(',') : '';
// Suma cada delta a su variable DESPUES del evento de clima y mantiene el resultado dentro de los limites
// fisicos del contrato (humedades 0 a 100 u 80, pH 0 a 14, lluvia y viento nunca negativos). Solo toca las
// variables presentes; no modifica el objeto recibido.
export function aplicarAjustes(valores, ajustes) {
  const a = leerAjustes(ajustes);
  if (!a) return { ...valores };
  return Object.fromEntries(Object.entries(valores).map(([c, v]) => [c, Object.hasOwn(a, c) ? ajustar(c, v + a[c]) : v]));
}

// Lote v3 de un nodo virtual con el contrato del panel de Juan (crearCaptura + prepararCapturaV3).
export function loteVirtual(nodo, parametros, fase, fecha, { ejecucion, semilla = 20261103, mensajeId, ajustes = null } = {}) {
  const valores = aplicarAjustes(aplicarEvento(referencia(nodo, parametros, fecha), fase), ajustes);
  for (const [c, v] of Object.entries(valores)) validarValor(c, v);
  const local = ZONAS[0]; // identidad local del panel; prepararCapturaV3 la sustituye por el nodo real
  const captura = crearCaptura({ ...local, semilla, valores, escenario: fase.escenario, modo: fase.modo, paso: fase.paso },
    { fecha, ejecucion, ...(mensajeId ? { id: mensajeId } : {}) });
  return prepararCapturaV3(captura, { nodo_local: local.nodo, nodo_codigo: nodo.codigo, asignacion_version: nodo.asignacion_version });
}

// Proyeccion de un nodo FISICO durante un evento o con ajuste manual: su ultima lectura real + el efecto
// del evento + los deltas de temperatura y humedad del aire, como lote v2 de origen simulado para el mismo
// codigo de nodo. La lectura real guardada no cambia. Devuelve null si no hay lectura real reciente (no se
// inventa una base) o si no hay nada que proyectar (clima normal y sin ajuste de temperatura o humedad).
export function loteProyeccion(nodo, fase, fecha, mensajeId = randomUUID(), ajustes = null) {
  const r = nodo.ultima_real, a = leerAjustes(ajustes, AJUSTES_FISICO);
  // Number(null) es 0: un dato ausente no puede pasar por una lectura valida.
  if ((fase.fase === 'normal' && !a) || !r || ![r.temperatura, r.humedad, r.adc].every(x => x !== null && x !== undefined && x !== '' && Number.isFinite(Number(x)))) return null;
  const adc = limitar(Math.round(Number(r.adc)), 0, 4095);
  const v = aplicarAjustes(aplicarEvento({ temperatura_aire: Number(r.temperatura), humedad_aire: Number(r.humedad), iluminacion_relativa: adc * 100 / 4095 }, fase), a);
  const adcProyectado = limitar(Math.round(v.iluminacion_relativa * 4095 / 100), 0, 4095);
  const topico = `agrovigia/v2/simulado/nodos/${nodo.codigo}/telemetria`;
  const payload = { version: 2, nodo_codigo: nodo.codigo, mensaje_id: mensajeId, origen: 'simulado',
    tomada_en: fecha.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    mediciones: [
      { variable_codigo: 'temperatura_aire', valor: Math.round(v.temperatura_aire * 10) / 10, unidad: '°C' },
      { variable_codigo: 'humedad_aire', valor: Math.round(v.humedad_aire * 10) / 10, unidad: '% HR' },
      { variable_codigo: 'iluminacion_relativa', valor: indiceLdr(adcProyectado), unidad: '% relativo' },
    ],
    ldr: { metodo: METODO_LDR, adc_promedio: adcProyectado } };
  const mensaje = JSON.stringify(payload);
  // Mismo validador que ejecuta n8n: nunca se publica algo que el flujo rechazaria por forma.
  const previo = prevalidarAmbiental({ topic: topico, message: mensaje });
  if (previo.estado !== 'prevalidado') throw new Error('Proyeccion rechazada por el validador: ' + previo.codigo);
  return { topico, payload, mensaje };
}

// Valida y normaliza la respuesta de estado_simulacion(). Lanza si la forma no es la esperada.
export function leerEstado(estado) {
  if (!estado || !Array.isArray(estado.cultivos)) throw new Error('Estado de simulacion no valido.');
  return estado.cultivos.map(c => {
    if (typeof c?.cultivo_id !== 'string' || !Array.isArray(c.nodos)) throw new Error('Cultivo no valido en el estado de simulacion.');
    return { cultivo_id: c.cultivo_id, nombre: String(c.nombre ?? ''), parametros: c.parametros ?? null, clima: c.clima ?? null, clima_anterior: c.clima_anterior ?? null,
      ajustes: leerAjustes(c.ajustes), ajustes_iniciado_en: typeof c.ajustes_iniciado_en === 'string' ? c.ajustes_iniciado_en : null,
      nodos: c.nodos.filter(n => typeof n?.codigo === 'string' && ['fisico', 'virtual'].includes(n.tipo_nodo)).map(n => ({
        codigo: n.codigo, tipo_nodo: n.tipo_nodo, asignacion_version: n.asignacion_version, zona: n.zona ?? null, pausado: n.pausado === true,
        intervalo_segundos: limitar(Number(n.intervalo_segundos) || 30, 10, 3600), ultima_real: n.ultima_real ?? null })) };
  });
}
export function caducado(tomadaMs, ahoraMs) { return ahoraMs - tomadaMs > CADUCIDAD_MS; }
