'use strict';
const fs=require('node:fs'),path=require('node:path');
const {agregarModelo,agregarAlertas,agregarIA}=require('./ramas-alertas-ia.cjs');
const f=JSON.parse(fs.readFileSync(path.join(__dirname,'03d-ingesta-multinodo.json'),'utf8'));
f.name='AgroVigia - 03e ingesta ambiental, alertas y sugerencias IA';f.active=false;
for(const n of f.nodes){n.id+='-alertas';delete n.credentials;}
// Recibe real y simulado v2: el origen lo fija el topico (y la ACL del broker), no el payload.
// Los nodos virtuales por zonas usan v3 y el flujo 03f.
f.nodes.find(n=>n.name==='MQTT receptor').parameters.topics='agrovigia/v2/+/nodos/+/telemetria:1';
agregarModelo(f);
agregarAlertas(f);
f.nodes.find(n=>n.name==='Guia de prueba').parameters.content='## Ingesta + alertas\nRequiere migracion0006. Configurar supabase_url, MQTT y misma credencial apikey privada en los TRES HTTP.\nSolo este flujo publicado; no activar simultaneamente 03c/03d.\nEl nodo guardado se resuelve desde una medicion confirmada, no desde el payload.\nErrores de alertas mantienen persistido:true y alertas.estado pendiente. Revisar salidas, no solo color verde de ejecucion.\nSin reglas: evaluadas0 es esperado y no certifica salud.\nTres intentos por HTTP; sin cola durable ni barrido de recuperacion. No fijar/pinear capturas reales.';
agregarIA(f);
f.nodes.find(n=>n.name==='Guia de prueba').parameters.content+='\n\n## Sugerencias IA (Gemini)\nRequiere migracion0009. En Consultar Gemini: credencial Header Auth x-goog-api-key. En Reservar y Guardar sugerencia: la misma apikey de Supabase.\nLa base decide si corresponde (30 min por cultivo + alerta nueva, topes diarios). Solo lotes nuevos con alertas evaluadas.\nModelo en Proyecto Supabase > gemini_modelo. Un fallo de IA no afecta persistencia ni alertas.';
fs.writeFileSync(path.join(__dirname,'03e-ingesta-alertas.json'),JSON.stringify(f,null,2)+'\n');
console.log('03e generado (ingesta, alertas y sugerencias IA), inactivo y sin credenciales.');
