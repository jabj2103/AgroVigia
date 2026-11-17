// Recorrido REAL de la web contra el entorno local (Supabase local, n8n, Mosquitto y la simulacion en marcha).
// No usa fixtures: inicia sesion con la cuenta de prueba local y pulsa los botones de verdad.
// Antes: local/agrovigia.sh local-iniciar  y  local/agrovigia.sh local-web
// Uso:   AGROVIGIA_CHROME=/usr/bin/google-chrome node tests/real-local.mjs
// Escribe en la base local: cambia el clima y lo devuelve a normal, pide un analisis a Gemini, crea un cultivo de
// prueba con un nodo simulado (queda archivado si ya tiene historial) y registra y elimina un nodo fisico.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { elegir, opcionesDe } from './selector-qa.mjs';

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.AGROVIGIA_WEB_LOCAL ?? 'http://127.0.0.1:5189';
const imagenes = path.resolve(web, '../.local/qa-real'); mkdirSync(imagenes, { recursive: true });
const entorno = Object.fromEntries(readFileSync(path.resolve(web, '../.local/entorno-local.env'), 'utf8').split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
assert.ok(entorno.AGROVIGIA_USUARIO_CORREO && entorno.AGROVIGIA_USUARIO_CLAVE, 'Falta la cuenta de prueba en .local/entorno-local.env');

const resultados = [], consola = [], fallosHttp = [];
const paso = async (nombre, f) => {
  const t = Date.now();
  try { const detalle = await f(); resultados.push(['OK', nombre, detalle ?? '', Date.now() - t]); }
  catch (e) { resultados.push(['FALLA', nombre, String(e?.message ?? e).split('\n')[0].slice(0, 260), Date.now() - t]); await page.screenshot({ path: path.join(imagenes, 'falla-' + nombre.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.png') }).catch(() => undefined); }
};
const browser = await chromium.launch({ executablePath: process.env.AGROVIGIA_CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('console', m => { if (m.type() === 'error') consola.push(m.text().slice(0, 200) + ' @ ' + (m.location()?.url ?? '').replace(/\?.*/, '').slice(0, 110)); });
page.on('pageerror', e => consola.push('pageerror: ' + String(e).slice(0, 200)));
page.on('response', r => { if (r.status() >= 400) fallosHttp.push(r.status() + ' ' + r.request().method() + ' ' + r.url().replace(/\?.*/, '').slice(0, 110)); });
const lateral = page.getByRole('navigation', { name: 'Secciones' }), ir = v => lateral.getByRole('button', { name: v, exact: true }).click();
const foto = n => page.screenshot({ path: path.join(imagenes, n + '.png'), fullPage: true });
const nombreCultivo = 'Prueba web real ' + new Date().toISOString().slice(11, 19).replace(/:/g, '');
let cultivoSimulado = '', viejos = 0;
// Archiva cultivos de prueba que dejaron activos corridas anteriores de este mismo guion.
async function limpiarViejos() {
  let n = 0;
  for (;;) {
    const t = page.locator('.tarjeta-cultivo', { hasText: 'Prueba web real' }).first(), antes = await page.locator('.tarjeta-cultivo').count(); if (!(await t.count())) return n;
    await t.getByRole('button', { name: 'Archivar', exact: true }).click(); await page.getByRole('checkbox', { name: /Entiendo y quiero archivar/ }).check();
    await page.getByRole('button', { name: 'Confirmar archivado' }).click(); await page.getByRole('heading', { name: /^Archivar / }).waitFor({ state: 'detached', timeout: 15000 });
    await page.waitForFunction(c => document.querySelectorAll('.tarjeta-cultivo').length < c, antes, { timeout: 15000 }); n++;
  }
}

try {
  await paso('1 acceso con la cuenta real', async () => {
    await page.goto(base); await page.locator('#correo').fill(entorno.AGROVIGIA_USUARIO_CORREO); await page.locator('#clave').fill(entorno.AGROVIGIA_USUARIO_CLAVE);
    await page.getByRole('button', { name: /Entrar a mi cultivo/ }).click(); await page.locator('#cultivo').waitFor({ timeout: 20000 });
    const { opciones } = await opcionesDe(page, '#cultivo'); cultivoSimulado = opciones.find(o => /simulado/i.test(o) && /yuca/i.test(o)) ?? opciones.find(o => /simulado/i.test(o)) ?? opciones[0];
    return opciones.length + ' cultivos en el desplegable: ' + opciones.join(' | ');
  });
  await paso('2 inicio: nodos simulados con datos guardados', async () => {
    await elegir(page, '#cultivo', { label: cultivoSimulado }); await page.locator('.sim-nodo').first().waitFor({ timeout: 20000 });
    await page.locator('.sim-nodos .pastilla-tono[data-tono=recibe]').first().waitFor({ timeout: 40000 });
    const n = await page.locator('.sim-nodo').count(), recibe = await page.locator('.sim-nodos .pastilla-tono[data-tono=recibe]').count();
    const valores = (await page.locator('.sim-nodo').first().locator('.sim-valores dd').allInnerTexts()).map(x => x.replace(/\s+/g, ' ').trim()).join(', ');
    await foto('1-inicio'); assert.ok(!/Sin dato/.test(valores.split(',')[0]), 'el primer nodo no tiene temperatura: ' + valores);
    return `${cultivoSimulado}: ${recibe} de ${n} recibiendo. Primer nodo: ${valores}`;
  });
  await paso('3 escenario: fichas, tiempo real y filtros', async () => {
    await ir('Escenario'); await page.locator('.ficha-nodo').first().waitFor({ timeout: 20000 });
    const total = await page.locator('.ficha-nodo').count();
    const enVivo = await page.locator('.esc-barra .pastilla-tono', { hasText: 'En vivo' }).waitFor({ timeout: 20000 }).then(() => true, () => false);
    const filtros = page.getByRole('search', { name: 'Filtrar nodos' }); await filtros.getByLabel('Buscar nodo').fill('yuca 03'); await page.waitForFunction(() => document.querySelectorAll('.ficha-nodo').length === 1, null, { timeout: 8000 });
    await filtros.getByRole('button', { name: 'Borrar la búsqueda' }).click(); await foto('2-escenario');
    return `${total} fichas, Realtime ${enVivo ? 'activo (En vivo)' : 'NO activo, usa sondeo'}, la búsqueda "yuca 03" deja 1`;
  });
  await paso('4 escenario: lluvia real y cambio gradual', async () => {
    const ficha = page.locator('.esc-grupo', { hasText: /yuca/i }).locator('.ficha-nodo').first(), leer = async () => (await ficha.locator('.ficha-valores').innerText()).replace(/\s+/g, ' ');
    const antes = await leer();
    // Con mas de cuatro cultivos el Escenario cambia los botones por el desplegable con busqueda.
    if (await page.locator('#esc-cultivo').count()) { await page.locator('#esc-cultivo').click(); await page.getByRole('combobox', { name: 'Buscar en cultivo' }).fill('yuca'); await page.keyboard.press('Enter'); }
    else await page.locator('.esc-cultivos').getByRole('radio', { name: /yuca/i }).check();
    await page.locator('.esc-clima .opcion-evento', { hasText: /lluvia/i }).first().click(); await page.locator('.esc-clima').getByRole('button', { name: 'Aplicar clima' }).click();
    await page.locator('.esc-clima-activo:not([data-clima=normal])').waitFor({ timeout: 15000 });
    const serie = [antes]; for (let i = 0; i < 5; i++) { await page.waitForTimeout(12000); serie.push(await leer()); }
    await foto('3-escenario-lluvia');
    await page.locator('.esc-clima .opcion-evento').first().click(); await page.locator('.esc-clima').getByRole('button', { name: 'Volver a clima normal' }).click();
    await page.locator('.esc-clima-activo[data-clima=normal]').waitFor({ timeout: 15000 });
    assert.ok(new Set(serie).size > 1, 'los valores no cambiaron en un minuto: ' + serie.join(' -> '));
    return 'humedad y temperatura cada 12 s: ' + serie.join(' -> ') + '. Clima devuelto a normal.';
  });
  await paso('5 alertas guardadas por las reglas', async () => {
    await ir('Alertas'); await page.locator('#alerta-estado').waitFor({ timeout: 15000 }); await elegir(page, '#alerta-estado', 'todas');
    await page.locator('.tarjeta-alerta').first().waitFor({ timeout: 20000 }); await foto('4-alertas');
    return (await page.locator('.tarjeta-alerta').count()) + ' alertas en la primera página (condición: todas)';
  });
  await paso('6 historial con mediciones reales de la base', async () => {
    await ir('Historial'); await page.locator('#hist-nodo').waitFor({ timeout: 15000 }); await page.locator('.historial canvas').first().waitFor({ timeout: 25000 });
    const nodos = (await opcionesDe(page, '#hist-nodo')).opciones.length; await foto('5-historial');
    const error = await page.locator('.historial .aviso.error').count(); assert.equal(error, 0, 'el historial muestra un error');
    return nodos + ' opciones en el desplegable de nodo, gráfica dibujada';
  });
  await paso('7 IA: Analizar ahora con Gemini real', async () => {
    await ir('IA'); await page.getByRole('button', { name: 'Analizar ahora' }).click();
    await page.getByText('Análisis listo', { exact: false }).waitFor({ timeout: 120000 }); await foto('6-ia');
    const texto = (await page.locator('main').innerText()).replace(/\s+/g, ' '), i = texto.indexOf('ÚLTIMA SUGERENCIA');
    return 'respuesta de Gemini en pantalla: ' + texto.slice(i, i + 330);
  });
  await paso('8 cultivo nuevo con nodo simulado', async () => {
    await ir('Cultivos'); await page.getByRole('button', { name: '+ Registrar cultivo', exact: true }).click();
    await page.locator('#cult-nombre').fill(nombreCultivo); await page.locator('#cult-tipo').fill('Tomate'); await page.locator('#cult-area').fill('0,2');
    await page.getByRole('button', { name: 'Guardar cultivo', exact: true }).click();
    const tarjeta = page.locator('.tarjeta-cultivo', { hasText: nombreCultivo }); await tarjeta.waitFor({ timeout: 20000 });
    await tarjeta.getByRole('button', { name: 'Agregar nodo simulado' }).click(); await page.locator('dialog[open]').getByRole('button', { name: 'Crear nodo simulado' }).click();
    await page.getByText(/Nodo simulado sim-[a-z0-9-]+ creado/).waitFor({ timeout: 20000 });
    const codigo = await tarjeta.locator('.nodos-cultivo li strong').first().innerText(); await foto('7-cultivo-nuevo');
    return `${nombreCultivo} creado con ${codigo}`;
  });
  await paso('9 el cultivo nuevo aparece en el Escenario y su nodo empieza a recibir', async () => {
    const t = Date.now(); await ir('Escenario');
    const grupo = page.locator('.esc-grupo', { hasText: nombreCultivo.slice(0, 20) }); await grupo.waitFor({ timeout: 60000 });
    const aparecio = Math.round((Date.now() - t) / 1000);
    await grupo.locator('.ficha-nodo[data-tono=recibe]').first().waitFor({ timeout: 240000 });
    await foto('8-escenario-cultivo-nuevo');
    return `aparece a los ${aparecio} s y recibe a los ${Math.round((Date.now() - t) / 1000)} s: ${(await grupo.locator('.ficha-valores').first().innerText()).replace(/\s+/g, ' ')}`;
  });
  await paso('10 nodo fisico: registro real con clave y eliminacion', async () => {
    await ir('Dispositivos'); await page.getByRole('button', { name: '+ Registrar nodo físico' }).click();
    const asistente = page.locator('dialog[open]'); await asistente.getByRole('button', { name: 'Registrar nodo', exact: true }).click();
    const codigo = (await asistente.getByText(/agv-esp[0-9a-f]{4}-\d{2}/).first().innerText({ timeout: 20000 })).match(/agv-esp[0-9a-f]{4}-\d{2}/)[0];
    await foto('9-nodo-fisico-registrado'); await asistente.getByRole('button', { name: 'Cerrar', exact: true }).last().click();
    const filtros = page.getByRole('search', { name: 'Filtrar dispositivos' }); await filtros.getByLabel('Buscar dispositivo').fill(codigo);
    await page.waitForFunction(() => document.querySelectorAll('.tarjeta-cultivo').length === 1, null, { timeout: 15000 });
    await page.locator('.tarjeta-cultivo').getByRole('button', { name: /^Eliminar/ }).click(); await page.locator('dialog[open]').getByRole('button', { name: 'Eliminar nodo físico' }).click();
    await page.getByRole('heading', { name: 'Ningún dispositivo coincide' }).waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: 'Quitar filtros' }).click();
    return `${codigo} registrado con clave propia, encontrado con el buscador y eliminado`;
  });
  await paso('11 limpieza: quitar el nodo y el cultivo de prueba', async () => {
    await ir('Cultivos'); const tarjeta = page.locator('.tarjeta-cultivo', { hasText: nombreCultivo }); await tarjeta.waitFor({ timeout: 15000 });
    await tarjeta.getByRole('button', { name: 'Eliminar', exact: true }).click(); await page.locator('dialog[open]').getByRole('button', { name: 'Eliminar cultivo' }).click();
    const borrado = await tarjeta.waitFor({ state: 'detached', timeout: 6000 }).then(() => true, () => false);
    if (borrado && !(await page.getByRole('heading', { name: /^Archivar / }).count())) return 'cultivo eliminado';
    // Con historial el servidor no lo borra (CULTIVO_CON_HISTORIAL): la pantalla ofrece archivarlo.
    await page.locator('dialog[open] .aviso.error').waitFor({ timeout: 10000 });
    const aviso = (await page.locator('dialog[open] .aviso').allInnerTexts()).join(' ').replace(/\s+/g, ' ').slice(0, 160);
    await page.locator('dialog[open]').getByRole('button', { name: 'Archivar en su lugar' }).click();
    await page.getByRole('checkbox', { name: /Entiendo y quiero archivar/ }).check(); await page.getByRole('button', { name: 'Confirmar archivado' }).click();
    await page.getByRole('heading', { name: /^Archivar / }).waitFor({ state: 'detached', timeout: 15000 }); await page.getByText('Cultivo archivado', { exact: false }).waitFor({ timeout: 15000 }); await tarjeta.waitFor({ state: 'detached', timeout: 15000 });
    viejos = await limpiarViejos();
    return 'el cultivo ya tenía mediciones: el servidor no lo borra y quedó archivado. Aviso en pantalla: ' + aviso + (viejos ? `. Además archivé ${viejos} de corridas anteriores.` : '');
  });
} finally { await browser.close(); }

for (const [estado, nombre, detalle, ms] of resultados) console.log(`${estado.padEnd(5)} ${nombre} (${(ms / 1000).toFixed(1)} s)\n      ${detalle}`);
console.log('Errores de consola: ' + (consola.length ? '\n  ' + [...new Set(consola)].join('\n  ') : 'ninguno'));
console.log('Respuestas HTTP 4xx o 5xx: ' + (fallosHttp.length ? '\n  ' + [...new Set(fallosHttp)].join('\n  ') : 'ninguna'));
console.log('Capturas en ' + imagenes);
process.exitCode = resultados.some(r => r[0] === 'FALLA') ? 1 : 0;
