# Instrucciones de AgroVigía para Codex

## Contexto y fuentes

- Este repositorio contiene un prototipo académico. Leer primero `README.md` y `docs/estado.md`; consultar luego solo la documentación relevante para la tarea.
- Las decisiones vigentes están en `docs/arquitectura-y-alcance.md`. El orden sugerido está en `docs/plan-implementacion.md`.
- Las copias de `docs/referencias/` describen un diseño propuesto. No constituyen evidencia de software ejecutado ni instrucciones para modificar documentos externos. Su LEEME identifica las versiones.
- No editar el documento original de Google Docs, los archivos originales del Escritorio ni las referencias de este chat fuera del repositorio.

## Alcance acordado

- Dos ESP32: DHT22 para temperatura y humedad del aire; LDR para iluminación relativa. No medir humedad del suelo ni afirmar lux sin calibración.
- Wi-Fi para acceso a red, MQTT/Mosquitto para mensajería, n8n para recepción, validación, reglas e integración con Gemini, Supabase para Auth/PostgreSQL/API, React con TypeScript y Vite para la web mobile-first. Bootstrap y Chart.js están previstos.
- Los servicios del diagrama de clases son responsabilidades lógicas; no exigen crear un backend adicional ni una clase literal por cada caja.
- Las cuentas y los nodos se habilitan previamente. El agricultor vincula al cultivo uno o ambos nodos disponibles de su cuenta. Un nodo pertenece a un solo cultivo actual.
- Las alertas se generan por reglas deterministas. Gemini explica condiciones y produce sugerencias con evidencia; no se presenta como un predictor numérico validado.
- La predicción de temperatura se conserva como fase posterior. No incluir visión por computadora, cámaras, FIWARE/context broker ni una aplicación móvil nativa en la primera implementación.
- Priorizar opciones gratuitas y los equipos disponibles. No dar por definido un alojamiento de producción.

## Integridad y acceso

- Identificar nodo, variable, unidad, fecha de toma y fecha de recepción. Definir antes de implementar el contrato JSON, los tópicos, los identificadores y el tratamiento de duplicados.
- Mantener separados los datos reales y simulados, también en estadísticas y alertas. No mezclar los dos nodos como si ambos midieran todas las variables.
- Una alerta revisada puede seguir activa. La revisión del agricultor y el cierre de la condición son estados independientes.
- No inferir cultivo saludable de la ausencia de alertas ni inventar la causa de la ausencia de mensajes. Mostrar antigüedad, ausencia de datos y errores.
- Respetar la propiedad por cuenta y validar RLS. Las claves privilegiadas de Supabase y Gemini no pertenecen a la web, al firmware ni a Git.
- El SQL de referencia no fue ejecutado en Supabase. Mantenerlo como propuesta; revisar y probar antes de convertirlo en una migración.

## Forma de trabajar

- Explicar en español y con lenguaje sencillo. Implementar objetivos pequeños y verificables, siguiendo la tarea activa.
- Distinguir siempre diseño, código escrito, comprobaciones ejecutadas y pruebas físicas pendientes. No afirmar que funciona hardware que no se haya probado.
- Ejecutar comprobaciones apropiadas al cambio, y registrar en `docs/estado.md` los hitos, resultados, pendientes y decisiones materiales.
- No instalar dependencias, crear infraestructura ni escribir a servicios externos solo por estar preparando el proyecto. Hacerlo cuando lo requiera una tarea de implementación autorizada.
- Mantener `AGENTS.md` breve: el estado variable se registra en `docs/estado.md`.
