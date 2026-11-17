import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const requerir = createRequire(import.meta.url);
const { agregarModelo, agregarAlertas, agregarIA } = requerir('./ramas-alertas-ia.cjs');
const leer = nombre => readFile(new URL(nombre, import.meta.url), 'utf8');
// Motor, contrato v3 y preparacion: la misma base que usa el flujo HTTP 03g.
const base = requerir('./codigo-ingesta.cjs').baseSimulada();
const flujo = JSON.parse(await leer('03b-ingesta-dht22.json'));
flujo.name = 'AgroVigia - 03f ingesta SIMULADA por zonas v3, alertas y sugerencias IA'; flujo.active = false;
for (const n of flujo.nodes) { n.id += '-sim-v3'; delete n.credentials; }
flujo.nodes.find(n => n.name === 'MQTT receptor').parameters.topics = 'agrovigia/v3/simulado/nodos/+/telemetria:1';
function entradaCode() {
  const recibida = new Date().toISOString();
  // Solo con broker del repositorio reiniciado y ACL comprobadas.
  const canal = { acl_verificada: true, retencion_broker_desactivada: true };
  return $input.all().map((item, i) => ({ json: prepararIngestaSimulada(item.json, canal, recibida), pairedItem: { item: i } }));
}
function resultadoCode() {
  return $input.all().map((item, i) => ({ json: resumirPersistenciaSimulada(item.json, $('Preparar ingesta').itemMatching(i).json), pairedItem: { item: i } }));
}
flujo.nodes.find(n => n.name === 'Preparar ingesta').parameters.jsCode = base + '\nreturn (' + entradaCode.toString() + ')();\n';
flujo.nodes.find(n => n.name === 'Resultado de persistencia').parameters.jsCode = base + '\nreturn (' + resultadoCode.toString() + ')();\n';
const guardar = flujo.nodes.find(n => n.name === 'Guardar lote en Supabase');
guardar.onError = 'continueRegularOutput'; guardar.alwaysOutputData = true;
flujo.nodes.find(n => n.name === 'Guia de prueba').parameters.content = '## SIMULADA v3, diez variables por zona\nRequiere 0007/0008 y cuatro nodos provisionados.\nConfigurar supabase_url, credencial MQTT receptor y Header Auth apikey privada en Guardar lote.\nPuede convivir con 03e REAL v2: los tópicos son distintos. No duplicar 03f.\nBroker reiniciado con límite 8192, ACL v3 y retain_available false.\nNo fijar capturas: fecha de recepción aproximada al inicio del Code.\nRevisar Resultado de persistencia: diez IDs y persistido true. PUBACK no demuestra guardado.\nSin evaluación de alertas ni IA en este flujo. Reintentos HTTP conservan UUID, mensaje y recepción; no hay cola durable.';
// Despues del guardado confirmado: alertas del lote (reglas de origen simulado) y sugerencia IA.
// Un fallo en estas ramas no cambia la persistencia ya confirmada.
agregarModelo(flujo);
agregarAlertas(flujo);
agregarIA(flujo);
const guia = flujo.nodes.find(n => n.name === 'Guia de prueba').parameters;
guia.content = guia.content.replace('Sin evaluación de alertas ni IA en este flujo. ', '') +
  '\n\n## Alertas y sugerencias IA\nRequiere 0009. Misma apikey privada de Supabase en Consultar nodo guardado, Evaluar alertas, Reservar y Guardar sugerencia. En Consultar Gemini: credencial Header Auth x-goog-api-key.\nReglas de origen simulado; la base decide si corresponde una sugerencia (30 min por cultivo y origen + alerta nueva, topes diarios).';
await writeFile(new URL('03f-ingesta-simulada-v3.json', import.meta.url), JSON.stringify(flujo, null, 2) + '\n');
console.log('03f generado: inactivo, sin credenciales; solo simulación v3.');
