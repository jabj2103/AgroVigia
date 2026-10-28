# AgroVigía

Paso actual frontend: Alertas implementado con reglas configurables y episodios/revision. 28 pruebas web, build y QA local aprobados; falta comprobacion con cuenta/capturas reales. Guia [web/ALERTAS.md](web/ALERTAS.md). No requiere nuevas migraciones ni cambiar n8n; no se activaron reglas reales desde Codex.

Paso actual n8n: importar y configurar03e-ingesta-alertas.json, sustituir receptor anterior y comprobar Resultado de alertas. Backend0006 confirmado por Juan; 75 pruebas locales del flujo aprobadas, ejecucion real pendiente. Guia [ALERTAS_SUPABASE.md](n8n/ALERTAS_SUPABASE.md). Sin reglas reales configuradas, evaluadas0 es esperado.

Paso actual alertas: backend0006 preparado y probado localmente. Aplicar migracion y prueba transitoria segun [APLICAR_ALERTAS.md](supabase/APLICAR_ALERTAS.md). No hay reglas permanentes ni alertas automaticas activadas aun; pantalla/n8n siguen como estaban.

Paso actual: Mis dispositivos implementado y probado localmente. Aplicar migracion0005 y verificacion SQL, revisar pantalla con cuenta y ampliar Topics del flujo ambiental publicado; [guia de nodos](supabase/APLICAR_NODOS.md). Sin cambios remotos desde Codex ni segundo nodo fisico verificado.

Actualizacion 27/10/2026: interfaz oscura adaptada a mockups y Mis cultivos (crear, editar, archivar) conectada a RPC0004. 23 tests web, build y QA navegador local aprobados; comprobacion API con cuenta real pendiente. Pasos en [web/PANTALLAS.md](web/PANTALLAS.md).

Prototipo académico de monitoreo ambiental de cultivos, desarrollado por Juan Andrés Bustos Jiménez y Camilo Jose Carrion Ramirez. Carpeta preparada el 25 de octubre de 2026 para iniciar la implementación en un chat nuevo de Codex.

## Punto de partida

Hito actual: Juan confirma primer ESP32 DHT22+LDR actualizado en web y verificacion SQL correcta. Mientras compra el segundo DHT22, se implemento Historial y estadisticas con filtros, grafica, tabla y minimo/maximo/promedio de datos reales. 21tests web, build y QA Chrome con fixtures aprobados; prueba del historial con sesion real pendiente. Guia [HISTORIAL.md](web/HISTORIAL.md). Segundo nodo y gestion CU02/alertas/IA siguen pendientes. LDR es indice ADC relativo, no lux ni calibracion entre sensores. Los apartados historicos siguientes conservan preparacion previa; estado vigente en docs/estado.md.

Actualización de etapa 3: Juan confirmó que prepararemos n8n y Supabase desde cero. Existe un [flujo de inspección y validador](n8n/README.md) con 50 pruebas locales aprobadas; todavía no se ejecutó en n8n ni guarda mediciones. La [guía de configuración](docs/configuracion-etapa-3.md) contiene el siguiente paso y actualiza las afirmaciones históricas de este apartado.

Existe un diseño documental y hay dos ESP32, un DHT22 y un LDR disponibles según lo informado por Juan. Juan cargó el [firmware DHT22 con Wi-Fi y MQTT](firmware/nodo-dht22-mqtt/README.md) y aportó capturas recibidas en el suscriptor. El transporte tiene evidencia; la estabilidad del sensor sigue pendiente porque reaparecieron pares cero/cero. No hay todavía aplicación web ni flujos implementados. El estado de comprobaciones y pruebas físicas pendientes se distingue en `docs/estado.md`.

Antes de programar, leer `AGENTS.md`, `docs/estado.md` y `docs/arquitectura-y-alcance.md`. El primer trabajo pendiente se encuentra en `docs/plan-implementacion.md`.

## Arquitectura acordada

Sensores → ESP32 → red con Wi-Fi → MQTT / Mosquitto → n8n → Supabase.

React consulta la información autorizada de Supabase y utiliza Supabase Auth para la sesión. n8n valida la telemetría, almacena las mediciones, aplica reglas de alerta y coordina las sugerencias de Gemini. React no necesita consultar las mediciones a través del flujo receptor de n8n.

- Nodo 1: ESP32 con DHT22 y LDR; temperatura, humedad relativa del aire e iluminacion relativa.
- Nodo 2: ESP32 con DHT22 y LDR; las mismas variables en otra ubicacion del cultivo. Escala LDR por documentar para comparar ambos nodos.
- Web: React, TypeScript y Vite; Bootstrap y Chart.js según el diseño acordado.
- Persistencia y autenticación: PostgreSQL y Supabase Auth, con permisos por cuenta.
- Mensajería: MQTT con Mosquitto. Wi-Fi proporciona acceso a la red; no es un sustituto de MQTT.
- IA: Gemini para sugerencias contextualizadas. La predicción numérica de temperatura es una fase posterior, con modelo todavía pendiente.

Supabase y Gemini remotos necesitan acceso a Internet. La ubicación definitiva del broker, n8n y la web sigue sin definirse. Las primeras pruebas de MQTT pueden realizarse en la red disponible con el computador; eso no demuestra cobertura de cultivos remotos ni funcionamiento autónomo sin Internet.

## Organización

| Carpeta | Contenido previsto | Responsable principal |
|---|---|---|
| `firmware/` | Programa de los dos ESP32 y configuración de sensores | Juan |
| `web/` | Aplicación web mobile-first | Juan, después de MQTT |
| `n8n/` | Flujos exportados sin credenciales y documentación | Camilo |
| `supabase/migrations/` | Migraciones revisadas y verificadas | Camilo |
| `docs/` | Alcance, decisiones, estado y plan | Ambos |
| `docs/referencias/` | Copias del diseño previo, no implementación | Consulta |

## Primer resultado que buscamos

Una lectura real de un nodo debe recorrer ESP32 → Mosquitto → n8n → Supabase → una pantalla React. Se comprobarán su nodo, variable, unidad y fecha. Después se incorpora el segundo nodo y se completan las funciones.

El equipo puede avanzar en paralelo usando un contrato MQTT compartido y ejemplos claramente identificados como simulados. No hace falta esperar a tener conectados ambos nodos para preparar la recepción.

La base de trabajo está en [docs/contrato-mqtt-v1.md](docs/contrato-mqtt-v1.md): tópicos, perfiles de cada nodo, JSON, fechas, origen, duplicados y criterios de recepción. Incluye un [esquema JSON](docs/mqtt/telemetria.schema.json), [payloads de ejemplo](docs/mqtt/ejemplos) y [31 casos con resultados esperados](docs/mqtt/casos.json). El contrato documenta parámetros provisionales y decisiones pendientes; todavía no demuestra comunicación MQTT ni almacenamiento. Su sección de comprobación permite revisar los ejemplos localmente sin instalar herramientas.

La [guía de prueba MQTT local](mqtt/README.md) prepara el broker existente, usuarios y ACL para `127.0.0.1:18883`. Juan comprobó entrega simulada y controles de acceso, y después recepción real desde el ESP32 por la misma Wi-Fi. La [evidencia aportada](docs/pruebas/2026-10-25-dht22-mqtt.json) conserva nueve mensajes: dos con cero/cero cuestionados en la tanda inicial y cuatro capturas posteriores plausibles. La recepción no garantiza exactitud del sensor. Las claves quedan excluidas de Git.

## Cómo empezar en Codex

Añadir esta carpeta como proyecto y crear un chat nuevo desde cero. El archivo `INICIAR_EN_CODEX.md` contiene un mensaje de inicio breve.

El repositorio local tiene un primer commit y el remoto `origin` configurado como [jabj2103/AgroVigia](https://github.com/jabj2103/AgroVigia). En la revisión local, `main` y la referencia `origin/main` coincidían en `8d9e78c`; no se comprobó en esta revisión el acceso de Camilo ni se hizo un nuevo push. Esto no supone que haya servicios desplegados. Los siguientes cambios pueden prepararse en ramas por tarea y revisarse antes de integrarlos.
