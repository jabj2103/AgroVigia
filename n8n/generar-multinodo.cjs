'use strict';
const fs=require('node:fs'),path=require('node:path');
const flujo=JSON.parse(fs.readFileSync(path.join(__dirname,'03c-ingesta-ambiental.json'),'utf8'));
flujo.name='AgroVigia - 03d ambientales autorizados a Supabase';flujo.active=false;
for(const nodo of flujo.nodes){nodo.id+='-multi';delete nodo.credentials;}
flujo.nodes.find(n=>n.name==='MQTT receptor').parameters.topics='agrovigia/v2/real/nodos/+/telemetria:1';
flujo.nodes.find(n=>n.name==='Guia de prueba').parameters.content='## Varios nodos ambientales\nSuscripcion QoS1 agrovigia/v2/real/nodos/+/telemetria. El + corresponde a un codigo de nodo, no autoriza al publicador.\nBroker: credencial propia por nodo y ACL de escritura limitada al topico propio. Receptor solo lectura.\nSupabase contrasta nodo habilitado, capacidades, cultivo y propietario.\nReutilizar las credenciales privadas de 03c; configurar supabase_url. No exportar claves.\nPreferir editar solo el topico del flujo publicado 03c; no activar dos receptores equivalentes a la vez.\nAl mover nodo, apagarlo y esperar 7min antes de cambiar vinculo. No hay identificador de asignacion en el payload v2.';
fs.writeFileSync(path.join(__dirname,'03d-ingesta-multinodo.json'),JSON.stringify(flujo,null,2)+'\n');
console.log('03d generado, inactivo y sin credenciales.');
