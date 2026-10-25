# AgroVigía

Prototipo académico de monitoreo ambiental de cultivos, desarrollado por Juan Andrés Bustos Jiménez y Camilo Jose Carrion Ramirez. Carpeta preparada el 25 de octubre de 2026 para iniciar la implementación en un chat nuevo de Codex.

## Punto de partida

Existe un diseño documental y hay dos ESP32, un DHT22 y un LDR disponibles según lo informado por Juan. Esta carpeta contiene instrucciones, un plan y copias de referencias; todavía no contiene una aplicación, firmware ni flujos implementados. Una posible lectura de sensores reutilizable de otro proyecto no se ha importado ni probado aquí.

Antes de programar, leer `AGENTS.md`, `docs/estado.md` y `docs/arquitectura-y-alcance.md`. El primer trabajo pendiente se encuentra en `docs/plan-implementacion.md`.

## Arquitectura acordada

Sensores → ESP32 → red con Wi-Fi → MQTT / Mosquitto → n8n → Supabase.

React consulta la información autorizada de Supabase y utiliza Supabase Auth para la sesión. n8n valida la telemetría, almacena las mediciones, aplica reglas de alerta y coordina las sugerencias de Gemini. React no necesita consultar las mediciones a través del flujo receptor de n8n.

- Nodo 1: ESP32 con DHT22 para temperatura y humedad relativa del aire.
- Nodo 2: ESP32 con LDR para iluminación relativa, con conversión por documentar.
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

## Cómo empezar en Codex

Añadir esta carpeta como proyecto y crear un chat nuevo desde cero. El archivo `INICIAR_EN_CODEX.md` contiene un mensaje de inicio breve.

El repositorio Git es local. No se ha creado un repositorio en GitHub, no se ha publicado nada y no hay instalaciones ni despliegues realizados. Para compartirlo con Camilo, el siguiente paso de organización será acordar el repositorio remoto y las ramas de trabajo.
