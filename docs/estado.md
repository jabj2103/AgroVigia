# Estado de AgroVigía

Actualización: 25 de octubre de 2026. Fuentes: decisiones del chat de diseño, archivos locales copiados y revisión documental del contrato en este repositorio.

## Preparado en esta carpeta

- Estructura inicial para firmware, web, n8n, Supabase y documentación.
- README, instrucciones para Codex, resumen de arquitectura y plan de implementación.
- Copias del diseño: casos de uso, arquitectura, clases/base de datos, diccionario, SQL propuesto y proyecto de StarUML.
- Repositorio Git local, sin commits ni remoto.
- Base de contrato MQTT v1 en `docs/contrato-mqtt-v1.md`, esquema de payload en `docs/mqtt/telemetria.schema.json`, 23 archivos de ejemplo y 31 casos con contexto/resultado esperado en `docs/mqtt/casos.json`.

## Implementación confirmada aquí

Hay documentación del contrato y un esquema JSON escrito y comprobado localmente. No hay implementación funcional del sistema: firmware, aplicación React, flujos n8n, paquetes instalados ni un Supabase conectado. El usuario comentó que podía reutilizar la lectura de sensores de otro proyecto; ese código no ha sido recibido, importado ni probado en esta carpeta. No se verificó el estado de trabajo que Camilo pueda tener fuera de ella.

## Siguiente tarea

Revisar entre Juan y Camilo la base v1 ya escrita y confirmar sus parámetros provisionales antes de integrar. Juan puede preparar el perfil DHT22 y Camilo el receptor con los ejemplos simulados, respetando la misma versión. No se ha registrado todavía su aprobación conjunta ni se ha implementado un validador de recepción.

Después, probar el ESP32 con DHT22 publicando en Mosquitto. La primera integración completa se realizará con un nodo y luego se añadirá el ESP32 con LDR.

## Decisiones pendientes que afectan a la programación

- Estado real del trabajo de Camilo y posible código reutilizable de Juan.
- Herramientas de firmware, modelo exacto de las placas, pines, alimentación y circuito del LDR.
- Conversión y polaridad de iluminación relativa; no se han fijado referencias de calibración ni lux.
- Revisión conjunta del contrato v1; autenticación de dispositivos, ACL verificadas, TLS y configuración/ubicación del broker.
- Confirmar parámetros provisionales v1: MQTT 3.1.1, QoS 1, sin retain ni cola histórica, muestra cada 60 s, aviso de antigüedad a 180 s, ventana de captura de 300 s hacia atrás/120 s hacia delante, 2048 bytes y reintentos 2/4/8 s.
- Método de sincronización del reloj y generación de UUID v4 en firmware; se definió rechazar capturas sin fecha válida, sin reemplazarla por recepción.
- Proyecto Supabase disponible y configuración de servicios para la demostración.
- RPC, operaciones transaccionales e integración con el SQL propuesto: guardar el lote completo, comparar duplicados/conflictos y conservar recepción original. Alinear límites de temperatura del catálogo con el contrato antes de migrar.
- Registro de rechazos, recuperación de fallos de persistencia y coordinación de cambios de vínculo del nodo con mensajes pendientes.
- Umbrales de alerta y horarios fundamentados para el cultivo de demostración.
- Modelo de Gemini disponible, forma de uso gratuita y límites de las consultas.
- Fecha exacta de entrega, contenido del kit de Camilo y despliegue definitivo.

Estas cuestiones se resolverán cuando sean necesarias para la tarea correspondiente, sin bloquear la preparación del contrato y los ejemplos.

## Registro de verificaciones

- Preparación de carpeta: estructura y referencias presentes; copias comprobadas por hash.
- Git: inicializado localmente en main, sin remoto ni commits.
- Contrato v1: revisión de correspondencia con códigos/unidades de `variables`, capacidades por nodo, fechas y clave única propuesta `(nodo_id, mensaje_id, variable_codigo)`. SQL y referencias originales sin modificar ni ejecutar.
- PowerShell 7 `Test-Json`, sin instalaciones: los 31 casos coincidieron con su expectativa de esquema (incluido JSON mal formado). Esto comprueba forma y perfiles de payload; no ejecuta tópico/ACL, calendario/ventana temporal, catálogo, idempotencia, transacciones ni RLS.
- Revisión local con Node ya disponible: 31 identificadores de caso únicos, existencia de payloads y lotes previos, expectativas de parseo JSON, unidades UTF-8 y 10 enlaces relativos de la documentación comprobados.
- Todos los datos de los ejemplos son inventados. El archivo con origen real solo ilustra formato; no es evidencia física. Las fechas fijas de prueba no deben reproducirse como capturas nuevas.
- Pruebas físicas, compilación, MQTT, Supabase, n8n, web e IA: pendientes.

## Decisiones documentadas en la etapa 1

- Tópicos separados `agrovigia/v1/{real|simulado}/nodos/{nodo_codigo}/telemetria`; procedencia contrastada con permisos del broker, no confiada al JSON.
- Código estable del nodo separado de UUID de base de datos; UUID v4 por captura, conservado en reintentos y distinto entre orígenes.
- DHT22 publica un lote completo de dos variables; LDR una variable. No publicar valores ficticios ante error. LDR real bloqueado hasta verificar conversión.
- Recepción fijada por n8n, captura UTC sincronizada por nodo. Duplicados no renuevan fechas, historial ni reglas; mismo ID con contenido distinto se rechaza.
- Cultivo resuelto en servidor y conservado históricamente. Cambio de vínculo exige pausar y drenar mensajes en v1; transferencia con cola pendiente requeriría ampliar el protocolo.
- Rangos y parámetros temporales son decisiones provisionales de demostración, no umbrales agronómicos ni garantías de hardware. La etapa 1 queda documentada y comprobada en forma, pendiente de revisión conjunta e integración posterior.

Al cerrar un hito, registrar aquí qué cambió, cómo se comprobó y cuál es el siguiente paso. No copiar todo el historial del chat.
