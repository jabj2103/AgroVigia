'use strict';
// Logica pura de la rama de sugerencias IA de los flujos 03e (real v2), 03f (simulado v3 por zonas), 03g (ambos por HTTP)
// y del flujo 03h de sugerencias a peticion. Nunca incluye claves ni devuelve
// cuerpos de error HTTP. La API key de Gemini vive solo en la credencial Header Auth de n8n.
const esUuidIA = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const MODELO_IA = /^gemini-[a-z0-9.\-]{1,50}$/;
const VARIABLES_IA = ['temperatura_aire', 'humedad_aire', 'iluminacion_relativa', 'radiacion_solar', 'humedad_suelo_vwc', 'temperatura_suelo',
  'ph_suelo', 'conductividad_suelo_ece', 'precipitacion_60min', 'velocidad_viento', 'general'];
const ESTADOS_IA = ['favorable', 'atencion', 'critico', 'datos_insuficientes'];
const PRIORIDADES_IA = ['alta', 'media', 'baja'];
// periodica y alerta nacen de un lote nuevo (03e, 03f, 03g); solicitud, de una peticion del agricultor (03h).
const MOTIVOS_IA = ['periodica', 'alerta', 'solicitud'];
const LIMITES_IA = { resumen: 600, riego: 500, luz: 500, limitaciones: 500, titulo: 100, accion: 400, evidencia: 300 };

const INSTRUCCION_IA = [
  'Eres un asistente agronómico para pequeños productores del Caribe colombiano.',
  'Recibes un JSON con lecturas de sensores ambientales de UN cultivo. Responde solo con el JSON pedido, en español sencillo y con ortografía correcta: usa siempre tildes y la letra ñ (por ejemplo: puño, iluminación, límite, sombrío). Sin markdown ni HTML.',
  'Reglas obligatorias:',
  '1. Basa cada recomendación en datos del contexto y cítalos en "evidencia" (valor con unidad, hora o estadística). No inventes valores.',
  '2. Usa solo las variables de "sensores.variables". iluminacion_relativa es un índice de 0 a 100, NO lux ni radiación calibrada; humedad_aire es humedad relativa del aire, no del suelo.',
  '3. Agua y riego: si el contexto trae humedad_suelo_vwc (% VWC a 20 cm), compárala con suelo_vwc_optima_min/max y suelo_vwc_min/max de la plantilla y úsala como base del riego; considera también precipitacion_60min (lluvia acumulada de la última hora). Si no hay humedad del suelo (está en "sensores.sin_sensor_de"), nunca afirmes su estado: usa temperatura y humedad del aire solo como indicio de demanda (evapotranspiración) y pide verificar el suelo (prueba del puño o tensiómetro) antes de regar.',
  '3b. pH, conductividad (ECe), temperatura del suelo, viento y radiación solo aparecen en nodos virtuales: menciónalos con prudencia (por ejemplo, pH fuera de lo habitual o viento fuerte) y sugiere un análisis o una revisión en campo, sin diagnosticar.',
  '4. Si periodo_del_dia es "noche", la iluminación baja es normal y no es un problema. Si de noche el índice supera 20, no lo des por normal: menciona que puede haber luz artificial cerca del nodo o una falla del sensor.',
  '5. Usa la plantilla del cultivo (rangos óptimos y límites de alerta) si existe. Si no hay plantilla, dilo en "limitaciones" y usa un criterio general prudente.',
  '6. No diagnostiques plagas ni enfermedades como hechos: menciona el riesgo y sugiere inspección. No recomiendes productos ni dosis de agroquímicos.',
  '7. Si origen_datos es "simulado", indica en "limitaciones" que los datos son simulados (generados por el simulador, no lecturas de campo).',
  '7b. Si el contexto trae "clima_simulado" (evento lluvia, sol_fuerte, tierra_seca o viento, con intensidad de 1 a 3), es un evento de PRUEBA que el usuario activó en el simulador: explica el cambio de los valores por ese evento, recomienda qué haría el agricultor ante una condición así y aclara en "limitaciones" que no es el clima real. Si "plantilla.ajustada" es true, los rangos son los que el agricultor ajustó para su cultivo.',
  '7c. Si el contexto trae "ajustes_manuales" (por ejemplo {"temperatura_aire": 4, "humedad_suelo_vwc": -10}), son cambios que el usuario sumó a mano a los valores simulados de esas variables, en sus mismas unidades. Interprétalos: di qué variables movió y en qué sentido, explica que los valores observados ya incluyen ese cambio, recomienda qué haría el agricultor ante una condición así y aclara en "limitaciones" que son condiciones simuladas ajustadas a mano, no el clima ni el suelo reales.',
  '7d. Si motivo es "solicitud", el agricultor pidió esta revisión ahora: responde sobre el estado actual del cultivo aunque no haya alertas abiertas.',
  '8. Si no hay lecturas o todas tienen antiguedad_segundos mayor a 180, usa estado_general "datos_insuficientes".',
  '9. estado_general: "favorable" si todo está en el rango óptimo; "atencion" si algo sale del óptimo o hay una alerta abierta; "critico" si se superan los límites de alerta de forma marcada o hay varias alertas. Estos valores van sin tilde porque son códigos.',
  '10. Entre 1 y 4 recomendaciones ordenadas por prioridad. Longitudes máximas: resumen 600, riego 500, luz 500, limitaciones 500, titulo 100, accion 400, evidencia 300 caracteres.',
].join('\n');

const ESQUEMA_IA = {
  type: 'OBJECT',
  properties: {
    resumen: { type: 'STRING' },
    estado_general: { type: 'STRING', enum: ESTADOS_IA },
    recomendaciones: { type: 'ARRAY', minItems: 1, maxItems: 4, items: {
      type: 'OBJECT',
      properties: {
        titulo: { type: 'STRING' }, accion: { type: 'STRING' },
        prioridad: { type: 'STRING', enum: PRIORIDADES_IA },
        variable: { type: 'STRING', enum: VARIABLES_IA }, evidencia: { type: 'STRING' },
      },
      required: ['titulo', 'accion', 'prioridad', 'variable', 'evidencia'],
      propertyOrdering: ['titulo', 'accion', 'prioridad', 'variable', 'evidencia'],
    } },
    riego: { type: 'STRING' }, luz: { type: 'STRING' }, limitaciones: { type: 'STRING' },
  },
  required: ['resumen', 'estado_general', 'recomendaciones', 'riego', 'luz', 'limitaciones'],
  propertyOrdering: ['resumen', 'estado_general', 'recomendaciones', 'riego', 'luz', 'limitaciones'],
};

function baseSupabase(destino) {
  const m = typeof destino === 'string' && destino.match(/^((?:https:\/\/[a-z0-9-]+\.supabase\.co|http:\/\/(?:127\.0\.0\.1|localhost|host\.docker\.internal):[0-9]{2,5}))\/rest\/v1\/rpc\/evaluar_alertas_lote$/);
  return m ? m[1] : null;
}

// 1. Solo lotes NUEVOS con alertas evaluadas piden reserva; duplicados y fallos no gastan IA.
function prepararReservaIA(final, rpcAlertas, modelo) {
  const base = { ...final, lista: false };
  if (!final || final.persistido !== true || final.estado !== 'insertado') return { ...base, ia: { estado: 'omitida', codigo: 'LOTE_NO_NUEVO' } };
  if (final.alertas?.estado !== 'evaluada') return { ...base, ia: { estado: 'omitida', codigo: 'ALERTAS_NO_EVALUADAS' } };
  const supabase = baseSupabase(rpcAlertas?.destino_alertas);
  const nodo = rpcAlertas?.solicitud_alertas?.p_nodo_id;
  if (!supabase || !esUuidIA(nodo) || rpcAlertas?.solicitud_alertas?.p_mensaje_id !== final.mensaje_id || !esUuidIA(final.mensaje_id))
    return { ...base, ia: { estado: 'omitida', codigo: 'CONTEXTO_IA_INCONSISTENTE' } };
  if (typeof modelo !== 'string' || !MODELO_IA.test(modelo)) return { ...base, ia: { estado: 'omitida', codigo: 'CONFIGURAR_MODELO_GEMINI' } };
  return { ...base, lista: true, ia: { estado: 'pendiente', codigo: 'POR_RESERVAR' }, modelo_ia: modelo,
    destino_reserva: supabase + '/rest/v1/rpc/reservar_sugerencia_ia',
    destino_completar: supabase + '/rest/v1/rpc/completar_sugerencia_ia',
    solicitud_reserva: { p_nodo_id: nodo, p_mensaje_id: final.mensaje_id } };
}

function configuracionGeneracion(modelo) {
  const c = { temperature: 0.3, maxOutputTokens: 1500, responseMimeType: 'application/json', responseSchema: ESQUEMA_IA };
  // El razonamiento se cobra como salida: se deja al minimo para cuidar el saldo.
  // La familia 2.5 lo apaga con thinkingBudget 0; la 3.x rechaza ese campo y usa thinkingLevel.
  if (/^gemini-2\.5-flash/.test(modelo)) c.thinkingConfig = { thinkingBudget: 0 };
  else if (/^gemini-3(\.\d+)?-flash/.test(modelo)) c.thinkingConfig = { thinkingLevel: 'minimal' };
  return c;
}

// 2. Si la base reservo la sugerencia, arma la solicitud a Gemini con el contexto guardado.
function prepararGemini(previo, respuesta) {
  const base = { ...previo, lista: false };
  const r = respuesta?.statusCode === 200 ? respuesta.body : null;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return { ...base, ia: { estado: 'pendiente', codigo: 'RESERVA_NO_CONFIRMADA' } };
  if (r.codigo !== 'RESERVADA') return { ...base, ia: { estado: 'omitida', codigo: typeof r.codigo === 'string' ? r.codigo.slice(0, 60) : 'RESERVA_SIN_CODIGO' } };
  if (!esUuidIA(r.sugerencia_id) || !r.contexto || typeof r.contexto !== 'object' || !MOTIVOS_IA.includes(r.motivo))
    return { ...base, ia: { estado: 'pendiente', codigo: 'RESERVA_INCOMPLETA' } };
  return { ...base, lista: true, ia: { estado: 'pendiente', codigo: 'POR_CONSULTAR_GEMINI', sugerencia_id: r.sugerencia_id, motivo: r.motivo },
    destino_gemini: 'https://generativelanguage.googleapis.com/v1beta/models/' + previo.modelo_ia + ':generateContent',
    solicitud_gemini: {
      systemInstruction: { parts: [{ text: INSTRUCCION_IA }] },
      contents: [{ role: 'user', parts: [{ text: 'Contexto del cultivo (JSON):\n' + JSON.stringify(r.contexto) }] }],
      generationConfig: configuracionGeneracion(previo.modelo_ia),
    } };
}

function recortar(texto, maximo) {
  const t = texto.trim().replace(/\s+/g, ' ');
  if (t.length <= maximo) return t;
  const corte = t.slice(0, maximo - 1); const espacio = corte.lastIndexOf(' ');
  return (espacio > maximo * 0.6 ? corte.slice(0, espacio) : corte) + '…';
}
const texto = v => typeof v === 'string' && v.trim().length > 0;

// Misma forma que exige public.respuesta_ia_valida. Recorta textos largos; rechaza enums o forma.
function normalizarRespuestaIA(r) {
  const claves = ['estado_general', 'limitaciones', 'luz', 'recomendaciones', 'resumen', 'riego'];
  if (!r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r).sort().join() !== claves.join()) return null;
  if (!ESTADOS_IA.includes(r.estado_general) || !['resumen', 'riego', 'luz', 'limitaciones'].every(k => texto(r[k]))) return null;
  if (!Array.isArray(r.recomendaciones) || r.recomendaciones.length < 1 || r.recomendaciones.length > 5) return null;
  const recs = [];
  for (const e of r.recomendaciones) {
    if (!e || typeof e !== 'object' || Array.isArray(e) || Object.keys(e).sort().join() !== 'accion,evidencia,prioridad,titulo,variable') return null;
    if (!PRIORIDADES_IA.includes(e.prioridad) || !VARIABLES_IA.includes(e.variable) || !['titulo', 'accion', 'evidencia'].every(k => texto(e[k]))) return null;
    recs.push({ titulo: recortar(e.titulo, LIMITES_IA.titulo), accion: recortar(e.accion, LIMITES_IA.accion), prioridad: e.prioridad,
      variable: e.variable, evidencia: recortar(e.evidencia, LIMITES_IA.evidencia) });
  }
  const salida = { resumen: recortar(r.resumen, LIMITES_IA.resumen), estado_general: r.estado_general, recomendaciones: recs,
    riego: recortar(r.riego, LIMITES_IA.riego), luz: recortar(r.luz, LIMITES_IA.luz), limitaciones: recortar(r.limitaciones, LIMITES_IA.limitaciones) };
  if (/<[a-zA-Z/!]/.test(JSON.stringify(salida))) return null;
  return salida;
}

// 3. Interpreta la respuesta de Gemini sin exponer su cuerpo ante errores.
function interpretarGemini(previo, respuesta) {
  const completar = (extra) => ({ ...previo, lista: true, solicitud_completar: {
    p_sugerencia_id: previo.ia.sugerencia_id, p_respuesta: null, p_modelo: previo.modelo_ia,
    p_tokens_entrada: null, p_tokens_salida: null, p_error_codigo: null, ...extra } });
  const estado = respuesta?.statusCode;
  if (estado !== 200) return completar({ p_error_codigo: Number.isInteger(estado) ? 'GEMINI_HTTP_' + estado : 'GEMINI_SIN_RESPUESTA' });
  const b = respuesta.body;
  const uso = b?.usageMetadata ?? {};
  const tokens = { p_tokens_entrada: Number.isInteger(uso.promptTokenCount) ? uso.promptTokenCount : null,
    p_tokens_salida: Number.isInteger(uso.candidatesTokenCount) ? uso.candidatesTokenCount + (Number.isInteger(uso.thoughtsTokenCount) ? uso.thoughtsTokenCount : 0) : null };
  if (b?.promptFeedback?.blockReason) return completar({ ...tokens, p_error_codigo: 'GEMINI_BLOQUEADA' });
  const c = Array.isArray(b?.candidates) ? b.candidates[0] : null;
  if (!c) return completar({ ...tokens, p_error_codigo: 'GEMINI_SIN_CANDIDATOS' });
  if (c.finishReason === 'MAX_TOKENS') return completar({ ...tokens, p_error_codigo: 'GEMINI_RESPUESTA_TRUNCADA' });
  if (c.finishReason && c.finishReason !== 'STOP') return completar({ ...tokens, p_error_codigo: 'GEMINI_FIN_' + String(c.finishReason).replace(/[^A-Z_]/g, '').slice(0, 40) });
  const partes = Array.isArray(c.content?.parts) ? c.content.parts.filter(p => !p.thought && typeof p.text === 'string') : [];
  let datos;
  try { datos = JSON.parse(partes.map(p => p.text).join('')); } catch { return completar({ ...tokens, p_error_codigo: 'GEMINI_JSON_INVALIDO' }); }
  const normal = normalizarRespuestaIA(datos);
  if (!normal) return completar({ ...tokens, p_error_codigo: 'GEMINI_FORMA_INVALIDA' });
  const modelo = typeof b.modelVersion === 'string' && MODELO_IA.test(b.modelVersion) ? b.modelVersion : previo.modelo_ia;
  return completar({ ...tokens, p_respuesta: normal, p_modelo: modelo });
}

// 4. Resumen final de la ejecucion. Persistencia y alertas se conservan siempre.
function resultadoIA(previo, respuesta) {
  const { lista, destino_reserva, destino_completar, destino_gemini, solicitud_reserva, solicitud_gemini, solicitud_completar, modelo_ia, ...resto } = previo;
  const r = respuesta?.statusCode === 200 ? respuesta.body : null;
  const ia = { ...previo.ia, modelo: solicitud_completar?.p_modelo ?? modelo_ia,
    tokens: { entrada: solicitud_completar?.p_tokens_entrada ?? null, salida: solicitud_completar?.p_tokens_salida ?? null } };
  if (!r || !['SUGERENCIA_GUARDADA', 'SUGERENCIA_FALLIDA', 'SUGERENCIA_YA_COMPLETADA'].includes(r.codigo))
    return { ...resto, ia: { ...ia, estado: 'pendiente', codigo: 'GUARDADO_IA_NO_CONFIRMADO', error_gemini: solicitud_completar?.p_error_codigo ?? null } };
  return { ...resto, ia: { ...ia, estado: r.estado === 'generada' ? 'generada' : 'fallida', codigo: r.codigo, error_codigo: r.error_codigo ?? null } };
}
function salidaSinIA(previo) {
  const { lista, destino_reserva, destino_completar, destino_gemini, solicitud_reserva, solicitud_gemini, solicitud_completar, modelo_ia, ...resto } = previo ?? {};
  return resto;
}

// EXPORTACIONES_LOCALES:
module.exports = { prepararReservaIA, prepararGemini, interpretarGemini, resultadoIA, salidaSinIA, normalizarRespuestaIA, INSTRUCCION_IA, ESQUEMA_IA, esUuidIA, MODELO_IA };
