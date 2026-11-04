import { VARIABLES, ZONAS, CULTIVOS, ESCENARIOS, PASOS, MAX_CAPTURAS, crearZonas, prepararEscenario, avanzar, editarValor, crearCaptura, crearExportacion, validarSemilla, validarValor } from './motor.mjs';

const $ = id => document.getElementById(id);
const preferenciasKey = 'agrovigia.simulador.preferencias.v1';
function preferencias() {
  try {
    const item = JSON.parse(localStorage.getItem(preferenciasKey) ?? 'null');
    if (item && CULTIVOS.includes(item.cultivo)) return { semilla: validarSemilla(item.semilla), cultivo: item.cultivo };
  } catch { /* Un dato local inválido no impide abrir el panel. */ }
  return { semilla: 20261103, cultivo: 'Maíz' };
}
const prefs = preferencias();
let nodes = crearZonas(prefs.semilla), selected = 0, ejecucion = crypto.randomUUID();
let records = [], discarded = 0, timer = null, autoTargets = [];
const fields = new Map(), invalidFields = new Set();
$('seed').value = String(prefs.semilla); $('crop').value = prefs.cultivo;

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
function status(message, error = false) {
  $('app-status').textContent = message;
  $('app-status').classList.toggle('error', error);
}
function guardarPreferencias() {
  try { localStorage.setItem(preferenciasKey, JSON.stringify({ semilla: nodes[0].semilla, cultivo: $('crop').value })); }
  catch { status('El navegador no permite conservar preferencias. Puedes seguir trabajando y exportar las capturas.'); }
}
const format = value => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 4 }).format(value);
function detener(message) {
  if (timer !== null) clearInterval(timer);
  timer = null; autoTargets = [];
  renderAuto();
  if (message) status(message);
}
function antesDeEditar() {
  if (timer !== null) detener('Secuencia pausada para editar. Las capturas anteriores se conservan.');
}
function mostrarError(message = '') {
  $('field-error').textContent = message;
  $('field-error').hidden = !message;
}
function editar(codigo, input) {
  antesDeEditar();
  const f = fields.get(codigo);
  try {
    nodes[selected] = editarValor(nodes[selected], codigo, input.value);
    f.number.value = String(nodes[selected].valores[codigo]);
    f.range.value = f.number.value;
    f.number.setCustomValidity(''); f.number.removeAttribute('aria-invalid');
    invalidFields.delete(codigo);
    if (!invalidFields.size) mostrarError();
    renderScenario();
  } catch (error) {
    invalidFields.add(codigo); f.number.setCustomValidity(error.message);
    f.number.setAttribute('aria-invalid', 'true'); mostrarError(error.message);
  }
}
function validarFormulario() {
  for (const v of VARIABLES) {
    const f = fields.get(v.codigo);
    try { validarValor(v.codigo, f.number.value); }
    catch (error) {
      mostrarError(error.message); status('Hay un valor inválido. No se generó ninguna captura.', true);
      f.number.setAttribute('aria-invalid', 'true'); f.number.focus(); return false;
    }
  }
  return invalidFields.size === 0;
}
function construirVariables() {
  const root = $('variable-groups');
  for (const grupo of ['Ambiente', 'Suelo', 'Tiempo']) {
    const items = VARIABLES.filter(v => v.grupo === grupo);
    const section = element('section', 'variable-group');
    const heading = element('h3', 'group-heading', grupo);
    heading.append(element('span', '', `${items.length} variables simuladas`)); section.append(heading);
    const grid = element('div', 'metric-grid');
    for (const v of items) {
      const card = element('article', 'metric'); card.dataset.variable = v.codigo;
      const head = element('div', 'metric-head');
      const label = element('label', '', v.nombre); label.htmlFor = `value-${v.codigo}`;
      head.append(label, element('span', 'pill simulated', 'Simulada'));
      const value = element('div', 'metric-value');
      const number = element('input');
      Object.assign(number, { id: `value-${v.codigo}`, type: 'number', min: String(v.min), max: String(v.max), step: String(v.paso), inputMode: 'decimal', required: true });
      number.setAttribute('aria-describedby', `help-${v.codigo}`);
      value.append(number, element('span', 'metric-unit', v.unidad));
      const range = element('input');
      Object.assign(range, { type: 'range', min: String(v.min), max: String(v.max), step: String(v.paso) });
      range.setAttribute('aria-label', `Ajustar ${v.nombre.toLowerCase()} simulada`);
      const bounds = element('div', 'metric-bottom'); bounds.append(element('span', '', format(v.min)), element('span', '', format(v.max)));
      const help = element('details');
      const helpText = element('p', '', v.ayuda); helpText.id = `help-${v.codigo}`;
      help.append(element('summary', '', 'Sobre esta variable'), helpText);
      card.append(head, value, range, bounds, help); grid.append(card);
      fields.set(v.codigo, { number, range });
      // Los rangos se actualizan en vivo. El campo numérico se confirma al salir,
      // permitiendo escribir números negativos y decimales sin perder el cursor.
      range.addEventListener('input', () => editar(v.codigo, range));
      number.addEventListener('input', () => {
        antesDeEditar();
        try { validarValor(v.codigo, number.value); number.setCustomValidity(''); number.removeAttribute('aria-invalid'); invalidFields.delete(v.codigo); }
        catch (error) { invalidFields.add(v.codigo); number.setCustomValidity(error.message); number.setAttribute('aria-invalid', 'true'); mostrarError(error.message); }
      });
      number.addEventListener('change', () => editar(v.codigo, number));
    }
    section.append(grid); root.append(section);
  }
}
function construirZonas() {
  const root = $('zone-list');
  ZONAS.forEach((zona, i) => {
    const button = element('button', 'zone-button'); button.type = 'button'; button.dataset.zona = zona.codigo;
    button.setAttribute('aria-label', `Seleccionar ${zona.nombre.toLowerCase()}`);
    const info = element('span'); info.append(element('strong', '', zona.nombre), element('small', '', zona.nodo), element('small', 'zone-sim', 'Simulada · 0 capturas'));
    button.append(element('span', 'zone-number', String(i + 1).padStart(2, '0')), info);
    button.addEventListener('click', () => {
      selected = i; renderDraft();
      status(`${zona.nombre} seleccionado. Sus controles son independientes de los demás puntos.`);
    });
    root.append(button);
  });
}
function construirEscenarios() {
  for (const scenario of ESCENARIOS) {
    const button = element('button', 'scenario-button');
    button.type = 'button'; button.dataset.escenario = scenario.id;
    button.setAttribute('aria-label', `Preparar ${scenario.nombre.toLowerCase()}`);
    button.append(element('span', 'scenario-icon', scenario.icono), element('strong', '', scenario.nombre), element('span', '', '↗'));
    button.addEventListener('click', () => {
      if (!validarFormulario()) return;
      antesDeEditar();
      nodes[selected] = prepararEscenario(nodes[selected], scenario.id);
      renderScenario();
      status(`${scenario.nombre} preparado en ${nodes[selected].nombre}. Avanza un paso o inicia la secuencia; aún no se registró una captura.`);
    });
    $('scenario-list').append(button);
  }
}
function renderZones() {
  document.querySelectorAll('.zone-button').forEach((button, i) => {
    button.setAttribute('aria-pressed', String(i === selected));
    const count = records.filter(r => r.nodo_codigo === nodes[i].nodo).length;
    button.querySelector('.zone-sim').textContent = `Simulada · ${count} captura${count === 1 ? '' : 's'}`;
  });
}
function renderDraft() {
  invalidFields.clear(); mostrarError();
  $('zone-title').textContent = nodes[selected].nombre; $('node-code').textContent = nodes[selected].nodo;
  for (const v of VARIABLES) {
    const { number, range } = fields.get(v.codigo);
    number.value = String(nodes[selected].valores[v.codigo]); range.value = number.value;
    number.setCustomValidity(''); number.removeAttribute('aria-invalid');
  }
  renderZones(); renderScenario();
}
function renderScenario() {
  const node = nodes[selected], scenario = ESCENARIOS.find(s => s.id === node.escenario);
  const prepared = node.modo === 'escenario';
  document.querySelectorAll('.scenario-button').forEach(button => button.setAttribute('aria-pressed', String(prepared && button.dataset.escenario === node.escenario)));
  $('scenario-title').textContent = prepared ? scenario.nombre : 'Ajuste manual';
  $('scenario-step').textContent = `${node.paso} / ${PASOS}`; $('progress').value = node.paso;
  $('scenario-description').textContent = prepared ? scenario.descripcion + (node.paso === PASOS ? ' Transición completada.' : ' La transición requiere doce pasos de prueba.') : 'Los controles cambian el borrador. Captura cuando quieras registrar sus valores.';
  $('target-details').hidden = !prepared;
  $('target-values').replaceChildren();
  if (prepared) for (const v of VARIABLES) $('target-values').append(element('dt', '', v.corta), element('dd', '', `${format(node.destino[v.codigo])} ${v.unidad}`));
  $('step').disabled = !prepared || node.paso >= PASOS || timer !== null;
  $('capture').disabled = timer !== null;
}
function renderAuto() {
  const running = timer !== null;
  $('auto').textContent = running ? 'Pausar secuencia' : 'Iniciar secuencia';
  $('run-state').textContent = running ? 'En curso' : 'Pausada'; $('run-state').classList.toggle('running', running);
  for (const id of ['scope', 'interval', 'reset', 'seed']) $(id).disabled = running;
  $('auto-help').textContent = running ? `Capturando: ${autoTargets.map(i => nodes[i].nombre).join(', ')}. Se detendrá tras doce pasos. Cambiar de punto solo cambia la vista.` : 'Cada inicio prepara 12 pasos desde los valores actuales. Se detiene al llegar al destino. No es un modelo de evolución agronómica.';
  renderScenario();
}
function agregarCaptura(index, fecha = new Date()) {
  const capture = crearCaptura(nodes[index], { fecha, ejecucion, cultivo: $('crop').value });
  records.unshift(capture);
  if (records.length > MAX_CAPTURAS) { discarded += records.length - MAX_CAPTURAS; records.length = MAX_CAPTURAS; }
}
function nombreEscenario(capture) {
  return capture.simulacion.modo === 'manual' ? 'Manual' : ESCENARIOS.find(s => s.id === capture.simulacion.escenario_id)?.nombre ?? 'Escenario';
}
function renderHistory() {
  $('capture-count').textContent = String(records.length + discarded).padStart(2, '0');
  const empty = records.length === 0;
  $('copy').disabled = empty; $('export').disabled = empty;
  $('history-empty').hidden = !empty; $('history-content').hidden = empty;
  $('history-summary').textContent = empty ? 'Aún no hay capturas. Registra un punto para empezar.' : `${records.length} captura${records.length === 1 ? '' : 's'} conservada${records.length === 1 ? '' : 's'} · se muestran las últimas ${Math.min(12, records.length)} de todos los puntos.${discarded ? ` ${discarded} anteriores descartadas por el límite local.` : ''}`;
  $('history-body').replaceChildren();
  for (const capture of records.slice(0, 12)) {
    const row = element('tr'), value = code => capture.mediciones.find(m => m.variable_codigo === code).valor;
    const fecha = new Date(capture.tomada_en);
    const time = element('time', '', new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(fecha));
    time.dateTime = capture.tomada_en; time.title = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'medium' }).format(fecha);
    const timeCell = element('td'); timeCell.append(time); row.append(timeCell);
    for (const text of [capture.simulacion.zona_nombre, nombreEscenario(capture), capture.simulacion.modo === 'manual' ? '—' : `${capture.simulacion.paso}/${PASOS}`, `${format(value('temperatura_aire'))} °C`, `${format(value('humedad_suelo_vwc'))} % VWC`]) row.append(element('td', '', text));
    const origin = element('td'); origin.append(element('span', 'pill simulated', 'Simulada')); row.append(origin);
    $('history-body').append(row);
  }
  $('last-json').textContent = records[0] ? JSON.stringify(records[0], null, 2) : '';
  renderZones();
}
function iniciarAuto() {
  if (timer !== null) { detener('Secuencia pausada. Las capturas permanecen en la bitácora local.'); return; }
  if (!validarFormulario()) return;
  const node = nodes[selected];
  if (node.modo !== 'escenario') { status('Prepara primero uno de los escenarios. Los ajustes manuales se registran con «Capturar valores actuales».', true); return; }
  const intervalo = Number($('interval').value);
  if (![2, 5, 10, 30, 60].includes(intervalo)) { status('Intervalo no admitido.', true); return; }
  autoTargets = $('scope').value === 'all' ? nodes.map((_, i) => i) : [selected];
  const escenario = node.escenario;
  for (const i of autoTargets) nodes[i] = prepararEscenario(nodes[i], escenario);
  let pasos = 0;
  timer = setInterval(() => {
    try {
      const fecha = new Date();
      for (const i of autoTargets) { nodes[i] = avanzar(nodes[i]); agregarCaptura(i, fecha); }
      pasos++;
      renderDraft(); renderHistory();
      if (pasos === PASOS) detener('Secuencia completada: doce pasos registrados. Exporta la sesión para conservarla.');
      else status(`Paso ${pasos} de ${PASOS} registrado localmente. No se enviaron datos a la plataforma.`);
    } catch (error) { detener(); status(`Se detuvo la secuencia: ${error.message}`, true); }
  }, intervalo * 1000);
  renderDraft(); renderAuto();
  status(`Secuencia iniciada para ${autoTargets.length} punto${autoTargets.length === 1 ? '' : 's'}. Primera captura en ${intervalo} segundos.`);
}

construirZonas(); construirVariables(); construirEscenarios(); renderDraft();
$('capture').addEventListener('click', () => {
  if (!validarFormulario()) return;
  try { agregarCaptura(selected); renderHistory(); status(`Captura simulada de ${nodes[selected].nombre} registrada localmente. No se envió a AgroVigía.`); }
  catch (error) { status(error.message, true); }
});
$('step').addEventListener('click', () => {
  if (!validarFormulario()) return;
  try { nodes[selected] = avanzar(nodes[selected]); agregarCaptura(selected); renderDraft(); renderHistory(); status(`Paso ${nodes[selected].paso} de ${PASOS} capturado en ${nodes[selected].nombre}.`); }
  catch (error) { status(error.message, true); }
});
$('auto').addEventListener('click', iniciarAuto);
$('crop').addEventListener('change', () => { antesDeEditar(); guardarPreferencias(); status(`Contexto de ejemplo: ${$('crop').value}. Los valores y las reglas no cambian por elegir el cultivo.`); });
$('reset').addEventListener('click', () => {
  try {
    const semilla = validarSemilla($('seed').value);
    detener(); nodes = crearZonas(semilla); ejecucion = crypto.randomUUID();
    guardarPreferencias(); renderDraft(); renderHistory();
    status('Zonas reiniciadas con la semilla elegida. Las capturas anteriores se conservan con su ejecución original.');
  } catch (error) { status(error.message, true); $('seed').focus(); }
});
$('copy').addEventListener('click', async () => {
  if (!records[0]) return;
  try { await navigator.clipboard.writeText(JSON.stringify(records[0], null, 2)); status('Última captura simulada copiada.'); }
  catch { status('El navegador no permitió copiar. Puedes seleccionar el JSON o exportar la sesión.', true); }
});
$('export').addEventListener('click', () => {
  if (!records.length) return;
  try {
    const data = crearExportacion(records, discarded);
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }));
    const anchor = element('a'); anchor.href = url; anchor.download = `agrovigia-simulacion-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    status(`Archivo generado con ${records.length} capturas simuladas. No se envió a ningún servicio.`);
  } catch (error) { status(error.message, true); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && timer !== null) detener('Secuencia pausada al ocultar la pestaña. No se inventaron capturas durante la pausa.'); });
window.addEventListener('pagehide', () => detener());
