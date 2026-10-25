# Plan inicial de implementación

Las etapas describen objetivos; su evidencia de cierre es un criterio, no acredita por sí sola trabajo realizado. Los pasos se podrán ajustar según los resultados y el trabajo ya existente de Camilo. El avance observado se registra en `estado.md`.

| Etapa | Resultado | Evidencia de cierre |
|---|---|---|
| 0. Preparación | Carpeta, instrucciones, plan y referencias | Archivos presentes; sin afirmar implementación |
| 1. Contrato MQTT | Tópicos, JSON y ejemplos acordados | Identifica nodos/variables; distingue fechas, origen y duplicados; casos inválidos definidos |
| 2. Primer nodo | ESP32 con DHT22 publica en Mosquitto | Mensajes reales de temperatura y humedad del aire comprobados |
| 3. Recepción y persistencia | n8n valida y guarda en Supabase | Lectura válida guardada, inválida rechazada y duplicada sin observaciones repetidas |
| 4. Primera pantalla | React inicia sesión y muestra mediciones | Dato real visible para su cuenta con nodo, unidad y fecha |
| 5. Segundo nodo | ESP32 con LDR integrado | Iluminación relativa diferenciada de las variables del DHT22 y escala documentada |
| 6. Gestión y consulta | Cultivos, vínculo de nodos autorizados, históricos y estadísticas | Casos de uso verificados con datos de la cuenta y tratamiento de ausencia/antigüedad |
| 7. Alertas | Reglas y episodios implementados | Regla comprobable; revisión y cierre independientes, sin duplicar episodios abiertos |
| 8. Sugerencias IA | Gemini genera sugerencias con contexto mediante n8n | Respuesta validada, almacenada con evidencias; fallos tratados sin inventar resultados |
| 9. Demostración | Recorrido completo reproducible | Ambos nodos, almacenamiento, web, históricos/estadísticas, alertas y sugerencia demostrables |

La autenticación y los permisos deben acompañar el acceso desde la web. Para la primera integración se pueden preparar manualmente una cuenta, un cultivo y sus nodos de prueba; eso no reemplaza la posterior implementación del CU02.

Camilo puede comenzar recepción y almacenamiento con ejemplos mientras Juan comprueba los sensores. Los ejemplos serán datos simulados y no deberán presentarse como lecturas físicas. Los contratos compartidos se revisan antes de integrar las dos partes.

Etapa 1: ya está escrita la [base del contrato v1](contrato-mqtt-v1.md), con esquema, 23 payloads y 31 casos. Se verificaron localmente sus expectativas de esquema. Falta la revisión conjunta de Juan y Camilo y confirmar los parámetros provisionales antes de integrar. Los casos de autorización, reloj, duplicados y persistencia son criterios para las etapas 2 y 3; no se han ejecutado contra servicios. La conversión física del LDR sigue pendiente y bloquea su telemetría real.

Antes de utilizar el SQL de referencia, revisar su compatibilidad con Supabase y verificarlo en el entorno de desarrollo. Convertirlo en migración solo después de revisar las operaciones necesarias y los permisos.

Predicción de temperatura: fase posterior, pendiente de selección y evaluación de un modelo temporal. No forma parte del primer recorrido completo.

Actualizar `docs/estado.md` al terminar un hito con el resultado observado, las comprobaciones y los pendientes. No avanzar sobre un fallo que invalide la siguiente etapa.
