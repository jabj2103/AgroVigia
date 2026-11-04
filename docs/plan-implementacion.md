# Plan inicial de implementación

Paso vigente tras la aceptación de la etapa de simulación por Juan: [Inicio → Zonas y nodos](../web/ZONAS.md) implementado y probado localmente. Comprobar el croquis en la cuenta, seleccionar distintas zonas/nodos y comparar diez variables Simuladas/UUID/fechas con una captura nueva enviada desde el panel, así como la vista real del ESP32 Sin ubicar. No requiere SQL adicional. Después ajustar la presentación y avanzar en reglas/perfiles documentados e IA. Las entradas inferiores conservan el orden histórico y no implican repetir migraciones ni pruebas ya reportadas.

Paso vigente en rama `juan/simulacion-zonas`: Juan aportó verificación de 0007/0008 y reportó correcto el alta de cuatro zonas/nodos virtuales. Emisor manual del panel, ACL/límite y receptor n8n 03f preparados y probados localmente; seguir la [guía de conexión](../n8n/SIMULACION_ZONAS.md) y comprobar una captura remota de diez variables y su duplicado. Después implementar consulta explícita de simulaciones en web y croquis seleccionable de zonas/nodos con procedencia/antigüedad; luego reglas/perfiles y sugerencias IA. La generación de escenarios sigue local hasta pulsar Enviar última captura.

Paso vigente 3/11/2026: Juan confirma correcta la prueba manual del panel externo descrita en [simulador/README.md](../simulador/README.md). Siguiente etapa: contrato y backend de zonas/capacidades/nodos virtuales e ingesta simulada antes de conectar el panel a la plataforma; primer criterio de aceptación: una captura simulada completa de diez variables con UUID, fechas y origen coincidentes entre panel y SQL. Después conectar transporte/n8n y consulta explícita en web; continuar con perfiles agronómicos documentados y sugerencias IA. Los pasos inferiores son historial de la implementación previa, no instrucciones para volver a aplicar migraciones ya ejecutadas.

Paso vigente: recargar web, comprobar Alertas/Episodios/Reglas con cuenta real y probar ciclo completo con limite temporal elegido por Juan; guia web/ALERTAS.md. Frontend y03e ya preparados; no repetir SQL. Despues sugerencias IA contextualizadas, sin afirmar salud ni umbrales agronomicos validados.

Paso vigente: seguir n8n/ALERTAS_SUPABASE.md para configurar03e y verificar evaluacion despues del guardado, sin receptores duplicados. Despues pantalla React de limites y episodios; no activar umbrales de demostracion para cultivo real unilateralmente.

Paso vigente alertas: aplicar0006, ejecutar probar-alertas.sql completo con ROLLBACK y verificar-alertas.sql (true,true,true,false,false); guia supabase/APLICAR_ALERTAS.md. Despues integrar evaluacion posterior a persistencia en n8n y construir reglas/pantalla. No configurar umbrales reales unilateralmente.

Paso vigente nodos: aplicar0005, probar SQL transitorio y permisos, revisar Mis dispositivos y publicar suscripcion comun en n8n sin duplicar receptores; guia supabase/APLICAR_NODOS.md. Mantener primer nodo vinculado en pruebas de pantalla. Segunda placa pendiente; despues alertas y reglas. Transferencia de ubicacion exige pausa/drenaje manual hasta ampliar protocolo.

Paso vigente 27/10/2026: recargar web y comprobar tema oscuro, navegacion movil, Mis cultivos, edicion deliberada y nodos disponibles; guia web/PANTALLAS.md. Gestion backend0004 confirmada por Juan y UI implementada/probada con fixtures. No archivar cultivo real solo para probar; quedan vinculacion posterior y auditoria, alertas e IA.

Paso inmediato: recargar web y comprobar Historial y estadisticas con datos reales del primer nodo. Vista implementada con21tests, build y QA de navegador con fixtures aprobados; guia web/HISTORIAL.md. El segundo nodo se difiere por decision de Juan mientras compra el DHT22. Continuar CU05 ahora; CU02/gestion de cultivos y alertas quedan como desarrollos siguientes.

Avance vigente: primer nodo ambiental y comparacion SQL confirmados por Juan. Historial/grafica/estadisticas escritos y probados localmente, pendientes de verificacion real en la cuenta. Etapa5 abierta por hardware del segundo nodo; se avanza en parte de etapa6 sin dar por cerrada gestion CU02. Persisten comparacion fisica conjunta, QA/API de historial, error de red remoto y concurrencia/recuperacion avanzada. LDR sigue como indice ADC, no lux ni calibracion entre sensores.

Las etapas describen objetivos; su evidencia de cierre es un criterio, no acredita por sí sola trabajo realizado. Los pasos se podrán ajustar según los resultados. El avance observado se registra en `estado.md`.

Actualización del 25 de octubre de 2026: Juan autorizó avanzar a la etapa 3 y confirmó que prepararemos n8n y Supabase desde cero. Ya existe un flujo de inspección sin persistencia y un validador con 50 pruebas locales aprobadas. El siguiente paso operativo está en [configuracion-etapa-3.md](configuracion-etapa-3.md). El cierre exige una lectura guardada y controles de duplicados/rechazos comprobados en los servicios. La configuración se asume con Juan sin depender del reparto original.

| Etapa | Resultado | Evidencia de cierre |
|---|---|---|
| 0. Preparación | Carpeta, instrucciones, plan y referencias | Archivos presentes; sin afirmar implementación |
| 1. Contrato MQTT | Tópicos, JSON y ejemplos acordados | Identifica nodos/variables; distingue fechas, origen y duplicados; casos inválidos definidos |
| 2. Primer nodo | ESP32 con DHT22 publica en Mosquitto | Mensajes reales de temperatura y humedad del aire comprobados |
| 3. Recepción y persistencia | n8n valida y guarda en Supabase | Lectura válida guardada, inválida rechazada y duplicada sin observaciones repetidas |
| 4. Primera pantalla | React inicia sesión y muestra mediciones | Dato real visible para su cuenta con nodo, unidad y fecha |
| 5. Nodos equivalentes | Dos ESP32, cada uno con DHT22 + LDR | Tres variables por ubicacion, identidad independiente, escala LDR documentada y comparacion inicial de sensores juntos |
| 6. Gestión y consulta | Cultivos, vínculo de nodos autorizados, históricos y estadísticas | Casos de uso verificados con datos de la cuenta y tratamiento de ausencia/antigüedad |
| 7. Alertas | Reglas y episodios implementados | Regla comprobable; revisión y cierre independientes, sin duplicar episodios abiertos |
| 8. Sugerencias IA | Gemini genera sugerencias con contexto mediante n8n | Respuesta validada, almacenada con evidencias; fallos tratados sin inventar resultados |
| 9. Demostración | Recorrido completo reproducible | Ambos nodos, almacenamiento, web, históricos/estadísticas, alertas y sugerencia demostrables |

La autenticación y los permisos deben acompañar el acceso desde la web. Para la primera integración se pueden preparar manualmente una cuenta, un cultivo y sus nodos de prueba; eso no reemplaza la posterior implementación del CU02.

Camilo puede comenzar recepción y almacenamiento con ejemplos mientras Juan comprueba los sensores. Los ejemplos serán datos simulados y no deberán presentarse como lecturas físicas. Los contratos compartidos se revisan antes de integrar las dos partes.

Etapa 1: ya está escrita la [base del contrato v1](contrato-mqtt-v1.md), con esquema, 23 payloads y 31 casos. Se verificaron localmente sus expectativas de esquema. Falta la revisión conjunta de Juan y Camilo y confirmar los parámetros provisionales antes de integrar. Los casos de autorización, reloj, duplicados y persistencia son criterios para las etapas 2 y 3; no se han ejecutado contra servicios. La conversión física del LDR sigue pendiente y bloquea su telemetría real.

Antes de utilizar el SQL de referencia, revisar su compatibilidad con Supabase y verificarlo en el entorno de desarrollo. Convertirlo en migración solo después de revisar las operaciones necesarias y los permisos.

Etapa 2 en curso: Juan cargó el [firmware MQTT DHT22](../firmware/nodo-dht22-mqtt/README.md) y aportó mensajes reales coincidentes entre monitor serie y suscriptor. Se observan capturas cada 60 s y un UUID diferente tras reiniciar. El transporte tiene evidencia; reaparecieron dos pares cero/cero, por lo que se mantiene pendiente estabilizar y diagnosticar la lectura antes de basar reglas o conclusiones ambientales en ella. Camilo puede preparar recepción/validación con los ejemplos separados, sin confundir ese trabajo con la calidad física ya demostrada.

Predicción de temperatura: fase posterior, pendiente de selección y evaluación de un modelo temporal. No forma parte del primer recorrido completo.

Actualizar `docs/estado.md` al terminar un hito con el resultado observado, las comprobaciones y los pendientes. No avanzar sobre un fallo que invalide la siguiente etapa.
