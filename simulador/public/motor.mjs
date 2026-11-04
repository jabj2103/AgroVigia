// Motor puro compartido por el navegador y las pruebas. Sin red ni reglas agronómicas.
export const VARIABLES = Object.freeze([
  { codigo: 'temperatura_aire', nombre: 'Temperatura del aire', corta: 'T. aire', unidad: '°C', grupo: 'Ambiente', min: -40, max: 80, paso: 0.1, base: 28, amplitud: 1.4, ayuda: 'Temperatura sintética del ambiente.' },
  { codigo: 'humedad_aire', nombre: 'Humedad del aire', corta: 'H. aire', unidad: '% HR', grupo: 'Ambiente', min: 0, max: 100, paso: 0.1, base: 68, amplitud: 5, ayuda: 'Humedad relativa del aire; distinta de la del suelo.' },
  { codigo: 'iluminacion_relativa', nombre: 'Iluminación relativa', corta: 'Luz relativa', unidad: '% relativo', grupo: 'Ambiente', min: 0, max: 100, paso: 0.1, base: 56, amplitud: 8, ayuda: 'Índice sintético independiente de la radiación. No representa lux ni una lectura ADC real.' },
  { codigo: 'radiacion_solar', nombre: 'Radiación solar', corta: 'Radiación', unidad: 'W/m²', grupo: 'Ambiente', min: 0, max: 1400, paso: 1, base: 620, amplitud: 70, ayuda: 'Radiación sintética; no se calcula a partir del LDR.' },
  { codigo: 'humedad_suelo_vwc', nombre: 'Humedad del suelo', corta: 'H. suelo', unidad: '% VWC', grupo: 'Suelo', min: 0, max: 80, paso: 0.1, base: 30, amplitud: 3, ayuda: 'Contenido volumétrico de agua simulado a 20 cm. Los límites del control no son umbrales agronómicos.' },
  { codigo: 'temperatura_suelo', nombre: 'Temperatura del suelo', corta: 'T. suelo', unidad: '°C', grupo: 'Suelo', min: -20, max: 70, paso: 0.1, base: 25, amplitud: 1, ayuda: 'Temperatura simulada a 20 cm de profundidad.' },
  { codigo: 'ph_suelo', nombre: 'pH del suelo', corta: 'pH', unidad: 'pH', grupo: 'Suelo', min: 0, max: 14, paso: 0.1, base: 6.3, amplitud: 0.2, ayuda: 'Valor sintético sin unidad. El escenario no representa un análisis de laboratorio.' },
  { codigo: 'conductividad_suelo_ece', nombre: 'Conductividad del suelo', corta: 'ECe', unidad: 'dS/m', grupo: 'Suelo', min: 0, max: 30, paso: 0.1, base: 1.1, amplitud: 0.2, ayuda: 'Referencia sintética ECe, extracto de pasta saturada a 25 °C. No equivale a cualquier sensor de conductividad.' },
  { codigo: 'precipitacion_60min', nombre: 'Lluvia en los últimos 60 min', corta: 'Lluvia 60 min', unidad: 'mm', grupo: 'Tiempo', min: 0, max: 200, paso: 0.1, base: 0, amplitud: 0, ayuda: 'Acumulado en ventana móvil de 60 minutos. Las ventanas se solapan: no sumar las capturas entre sí.' },
  { codigo: 'velocidad_viento', nombre: 'Velocidad del viento', corta: 'Viento', unidad: 'm/s', grupo: 'Tiempo', min: 0, max: 50, paso: 0.1, base: 2.2, amplitud: 0.6, ayuda: 'Velocidad sintética. El escenario de viento no predice daños ni diagnostica el cultivo.' },
].map(Object.freeze));
export const ZONAS = Object.freeze([
  { codigo: 'zona-norte', nombre: 'Sector norte', nodo: 'sim-zona-01', referencia: 'Punto virtual 01', factor: -0.8 },
  { codigo: 'zona-sur', nombre: 'Sector sur', nodo: 'sim-zona-02', referencia: 'Punto virtual 02', factor: 0.7 },
  { codigo: 'zona-central', nombre: 'Sector central', nodo: 'sim-zona-03', referencia: 'Punto virtual 03', factor: 0.2 },
  { codigo: 'zona-drenaje', nombre: 'Sector de drenaje', nodo: 'sim-zona-04', referencia: 'Punto virtual 04', factor: -0.2 },
].map(Object.freeze));
export const CULTIVOS = Object.freeze(['Maíz', 'Yuca', 'Papa']);
export const PASOS = 12;
export const MAX_CAPTURAS = 300;
export const ESCENARIOS = Object.freeze([
  { id: 'referencia', nombre: 'Referencia', icono: '01', descripcion: 'Volver a los valores de partida de este punto. No significa cultivo saludable.', cambios: {} },
  { id: 'calor-seco', nombre: 'Calor y suelo seco', icono: '02', descripcion: 'Suben la temperatura y la radiación; bajan las humedades.', cambios: { temperatura_aire: 39, humedad_aire: 36, humedad_suelo_vwc: 12, temperatura_suelo: 33, iluminacion_relativa: 90, radiacion_solar: 1050, precipitacion_60min: 0, velocidad_viento: 3.6 } },
  { id: 'lluvia', nombre: 'Lluvia intensa', icono: '03', descripcion: 'Más lluvia y agua en el suelo; menos radiación en esta prueba.', cambios: { temperatura_aire: 24, humedad_aire: 93, humedad_suelo_vwc: 56, temperatura_suelo: 23, iluminacion_relativa: 24, radiacion_solar: 160, precipitacion_60min: 38, velocidad_viento: 5 } },
  { id: 'viento', nombre: 'Viento fuerte', icono: '04', descripcion: 'Aumenta el viento; las otras variables vuelven a su referencia.', cambios: { velocidad_viento: 17 } },
  { id: 'ph', nombre: 'Cambio de pH', icono: '05', descripcion: 'Ejemplo de cambio gradual hacia un pH más ácido.', cambios: { ph_suelo: 4.4 } },
  { id: 'recuperacion', nombre: 'Regreso a referencia', icono: '06', descripcion: 'Transición desde el estado actual al punto de partida. Sin afirmar recuperación real.', cambios: {} },
].map(s => Object.freeze({ ...s, cambios: Object.freeze(s.cambios) })));

const catalogo = new Map(VARIABLES.map(v => [v.codigo, v]));
const round = (value, paso) => Number((Math.round(value / paso) * paso).toFixed(4));
function hash(seed, key) {
  let value = (seed ^ 2166136261) >>> 0;
  for (const char of key) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
  value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
  return (value >>> 0) / 4294967295;
}
export function validarSemilla(value) {
  const parsed = typeof value === 'string' && /^\d{1,9}$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 999999999) throw new Error('La semilla debe ser un entero entre 1 y 999999999.');
  return parsed;
}
export function validarValor(codigo, value) {
  const v = catalogo.get(codigo);
  if (!v) throw new Error('Variable no admitida.');
  if (typeof value === 'string' && !/^-?\d+(\.\d+)?$/.test(value)) throw new Error(`Escribe un número válido para ${v.nombre.toLowerCase()}.`);
  const number = typeof value === 'string' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number) || number < v.min || number > v.max || Math.abs(number - round(number, v.paso)) > 1e-8) {
    throw new Error(`${v.nombre}: usa valores entre ${v.min} y ${v.max}, en pasos de ${v.paso}.`);
  }
  return round(number, v.paso);
}
function valoresReferencia(zona, seed, escenario) {
  return Object.fromEntries(VARIABLES.map(v => {
    const centro = escenario.cambios[v.codigo] ?? v.base;
    const variacion = v.amplitud * ((hash(seed, zona.codigo + ':' + v.codigo) - 0.5) * 1.4 + zona.factor * 0.25);
    return [v.codigo, round(Math.min(v.max, Math.max(v.min, centro + variacion)), v.paso)];
  }));
}
export function crearZonas(semilla = 20261103) {
  const seed = validarSemilla(semilla);
  return ZONAS.map(zona => {
    const valores = valoresReferencia(zona, seed, ESCENARIOS[0]);
    return { ...zona, semilla: seed, valores, inicio: { ...valores }, destino: { ...valores }, escenario: 'referencia', modo: 'manual', paso: 0 };
  });
}
export function prepararEscenario(node, escenarioId) {
  const escenario = ESCENARIOS.find(s => s.id === escenarioId);
  if (!escenario) throw new Error('Escenario no admitido.');
  const zona = ZONAS.find(z => z.codigo === node.codigo && z.nodo === node.nodo);
  if (!zona) throw new Error('Solo se admiten los nodos virtuales de este panel.');
  return { ...node, valores: { ...node.valores }, inicio: { ...node.valores }, destino: valoresReferencia(zona, validarSemilla(node.semilla), escenario), escenario: escenarioId, modo: 'escenario', paso: 0 };
}
export function avanzar(node) {
  if (node.modo !== 'escenario' || node.paso >= PASOS) return { ...node, valores: { ...node.valores } };
  const paso = node.paso + 1, ratio = paso / PASOS;
  const valores = Object.fromEntries(VARIABLES.map(v => [v.codigo, round(node.inicio[v.codigo] + (node.destino[v.codigo] - node.inicio[v.codigo]) * ratio, v.paso)]));
  return { ...node, paso, valores };
}
export function editarValor(node, codigo, valor) {
  const value = validarValor(codigo, valor), valores = { ...node.valores, [codigo]: value };
  return { ...node, valores, inicio: { ...valores }, destino: { ...valores }, modo: 'manual', paso: 0 };
}
export function crearCaptura(node, { fecha = new Date(), id = globalThis.crypto.randomUUID(), ejecucion, cultivo = 'Maíz' } = {}) {
  if (!ZONAS.some(z => z.nodo === node.nodo && z.codigo === node.codigo)) throw new Error('Solo se admiten nodos virtuales.');
  if (!CULTIVOS.includes(cultivo)) throw new Error('Cultivo de ejemplo no admitido.');
  if (!(fecha instanceof Date) || !Number.isFinite(fecha.getTime())) throw new Error('Fecha inválida.');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  if (!uuid.test(id) || !uuid.test(ejecucion ?? '')) throw new Error('La captura y la ejecución necesitan UUID v4.');
  const tomada = fecha.toISOString();
  return {
    formato: 'agrovigia.simulacion.local.v1', mensaje_id: id, nodo_codigo: node.nodo,
    origen: 'simulado', tomada_en: tomada,
    simulacion: { ejecucion_id: ejecucion, semilla: validarSemilla(node.semilla), escenario_id: node.escenario, modo: node.modo, paso: node.paso, pasos_transicion: PASOS, zona_codigo: node.codigo, zona_nombre: node.nombre, cultivo_ejemplo: cultivo },
    mediciones: VARIABLES.map(v => {
      const metadatos = { fuente: 'generador_sintetico_v1' };
      if (['humedad_suelo_vwc', 'temperatura_suelo'].includes(v.codigo)) metadatos.profundidad_cm = 20;
      if (v.codigo === 'iluminacion_relativa') metadatos.metodo = 'indice_relativo_sintetico_v1';
      if (v.codigo === 'conductividad_suelo_ece') Object.assign(metadatos, { metodo: 'extracto_pasta_saturada_ECe', temperatura_referencia_c: 25 });
      if (v.codigo === 'precipitacion_60min') Object.assign(metadatos, { ventana: 'movil', periodo_segundos: 3600, inicio_periodo: new Date(fecha.getTime() - 3600000).toISOString(), fin_periodo: tomada, acumulados_no_sumables: true });
      return { variable_codigo: v.codigo, valor: validarValor(v.codigo, node.valores[v.codigo]), unidad: v.codigo === 'ph_suelo' ? 'sin unidad' : v.unidad, origen: 'simulado', metadatos };
    }),
  };
}
export function crearExportacion(capturas, descartadas = 0, fecha = new Date()) {
  if (!Array.isArray(capturas) || capturas.some(c => c.formato !== 'agrovigia.simulacion.local.v1' || c.origen !== 'simulado' || c.mediciones?.length !== VARIABLES.length || c.mediciones.some(m => m.origen !== 'simulado'))) throw new Error('Solo se exportan capturas locales simuladas completas.');
  return structuredClone({ formato: 'agrovigia.sesion-simulada.local.v1', origen: 'simulado', exportada_en: fecha.toISOString(), destino: 'archivo_local', enviado_mqtt: false, persistido_supabase: false, capturas_conservadas: capturas.length, capturas_descartadas: descartadas, capturas });
}
