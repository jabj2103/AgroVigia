# Telemetría simulada v3 por zonas

Preparación en la rama `juan/simulacion-zonas`, 3 de noviembre de 2026. Contrato y backend probados localmente; **sin despliegue ni publicación MQTT**. Se conserva v1/v2 para los ESP32 actuales.

## Identidad y transporte

- Tópico: `agrovigia/v3/simulado/nodos/{nodo_codigo}/telemetria`.
- Solo nodos `tipo_nodo = virtual`, previamente autorizados y vinculados a un cultivo y una zona. Origen obligatorio `simulado` en el lote y sus diez mediciones.
- QoS 1, sin retain; la procedencia se contrasta con ACL del broker. La RPC no observa por sí misma la red ni el paquete: esos controles se declaran desde el servidor autorizado.
- JSON UTF-8 sin BOM ni claves duplicadas, máximo **8192 bytes**. El ejemplo compacto mide más de 2048 bytes: la configuración actual del broker limita a 2048 y **deberá ajustarse coordinadamente** antes del transporte v3, conservando los límites específicos de los validadores reales v1/v2.
- UUID v4 por captura, conservado en reintentos. Fecha UTC canónica con milisegundos: `YYYY-MM-DDTHH:mm:ss.sssZ`. No cambiar UUID, fecha ni contenido para reintentar.
- La recepción se fija en el receptor y se conserva durante sus reintentos. Para lote nuevo debe ser reciente y la captura debe estar en `[recepción − 300 s, recepción + 120 s]`. No reproducir ejemplos antiguos como capturas nuevas.

## Forma

[Esquema JSON](mqtt/telemetria-simulada-v3.schema.json), [ejemplo ficticio](mqtt/ejemplos/simulada-v3.json) y [adaptador puro](../simulador/contrato-v3.mjs). El esquema comprueba forma; la RPC comprueba autorización, asignación, calendario, ventanas, metadatos y duplicados.

| Campo | Contenido |
|---|---|
| `version` | `3` |
| `nodo_codigo` | Código del nodo virtual en el catálogo; patrón `sim-…` |
| `mensaje_id` | UUID v4 de la captura |
| `origen` | `simulado` |
| `tomada_en` | Fecha UTC con milisegundos |
| `asignacion_version` | UUID de la asignación actual, obtenido del catálogo autorizado |
| `simulacion` | `ejecucion_id`, `semilla`, `escenario_id`, `modo`, `paso`, `pasos_transicion` |
| `mediciones` | Las diez variables del catálogo del panel, sin repetidas |

`semilla`: entero 1–999999999. `pasos_transicion`: 12. `paso`: entero 0–12; modo manual exige paso 0. Escenarios: referencia, calor-seco, lluvia, viento, ph y recuperacion. Cada medición contiene exactamente `variable_codigo`, `valor`, `unidad`, `origen` y `metadatos`; valores finitos con hasta cuatro decimales dentro de los rangos técnicos del catálogo. Esos rangos no son reglas agronómicas.

Metadatos obligatorios: fuente sintética; profundidad de referencia de 20 cm para humedad/temperatura del suelo; método sintético para luz relativa, sin ADC físico; referencia ECe para conductividad; ventana móvil de 3600 s con fechas exactas de inicio/fin y acumulados no sumables para lluvia. La radiación es independiente del LDR.

## Separación del archivo local

El panel sigue exportando `agrovigia.simulacion.local.v1`. `prepararCapturaV3(local, vinculo)` transforma una captura local en `{topico, payload, mensaje}` usando un mapeo explícito:

```js
{
  nodo_local: 'sim-zona-01',
  nodo_codigo: 'sim-CODIGO_DEL_CATALOGO-01',
  asignacion_version: 'UUID_ACTUAL_DEL_CATALOGO'
}
```

Los textos anteriores son marcadores, no parámetros válidos. El adaptador no envía mensajes. Los nombres de cultivo y zona del panel son contexto de ejemplo y **se eliminan del mensaje**: el servidor resuelve propietario, cultivo y zona desde el nodo autorizado. El receptor no debe crear nodos a partir de lo que reciba ni admitir UUID de cultivo elegidos por el emisor.

## Asignación y conservación histórica

`asignacion_version` cambia al mover el nodo de zona/cultivo, cambiar su punto o habilitar/deshabilitar. Un lote nuevo con versión vieja se rechaza `ASIGNACION_CAMBIO`, incluso si su fecha todavía está en ventana. Así un mensaje en vuelo no acaba atribuido a otro sector. El emisor futuro debe refrescar el vínculo de manera explícita y tomar una **captura nueva**, conservando la anterior como rechazada, sin cambiarle la identidad ni volver a etiquetarla.

Para un lote ya guardado, el duplicado idéntico devuelve sus IDs, fechas, cultivo y zona originales. Mismo ID con otros valores/contexto produce conflicto. Diez filas o ninguna: un fallo revierte el lote completo.

Cada nueva medición guarda `zona_id` y `zona_contexto` con nombre, rectángulo y posición del nodo observados en la inserción. Las filas anteriores a 0007 mantienen zona desconocida (`NULL`/`{}`); no se les inventa ubicación. v1/v2 no llevan versión de asignación: el procedimiento de pausa y drenaje de los nodos físicos sigue siendo necesario para moverlos.

## Estado y siguiente integración

No están preparados todavía el emisor MQTT del panel, su ACL v3 activa, el receptor n8n v3 ni la consulta de simulación/plano en la web. Las alertas actuales pueden evaluar las variables históricas que ya admiten sus reglas; extender reglas a las siete nuevas variables y cargar perfiles agronómicos es otra etapa. Gemini sigue pendiente.

El esquema se regenera con `node simulador/generar-esquema-v3.mjs`. El ejemplo es ficticio, con identificadores y fecha fijos. Las pruebas generan capturas nuevas en una base aislada; no llaman a los servicios del proyecto.
