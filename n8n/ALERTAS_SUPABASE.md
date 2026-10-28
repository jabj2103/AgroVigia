# Conectar ingesta con evaluacion de alertas en n8n

Backend0006 ya aplicado y pruebas SQL confirmadas por Juan. Esta etapa entrega el flujo03e como archivo nuevo, inactivo y sin credenciales. No requiere ejecutar mas SQL, configurar umbrales reales, cambiar firmware ni reinstalar n8n.

## 1. Preparar sin interrumpir el flujo actual

1. Abrir http://localhost:5678 y crear un workflow nuevo. Usar el menu Import from File y seleccionar n8n/03e-ingesta-alertas.json. Conservar el flujo antiguo como respaldo; no borrarlo.
2. En MQTT receptor elegir la credencial que ya funciona: receptor del broker local, puerto18883. Mantener Topics agrovigia/v2/real/nodos/+/telemetria:1 y las opciones importadas. No activar JSON Parse Body ni Only Message.
3. En Proyecto Supabase, asignacion supabase_url: sustituir https://TU_PROYECTO.supabase.co por la URL publica del proyecto que usa el flujo actual. Conservar include other fields.
4. En los TRES nodos HTTP Guardar lote en Supabase, Consultar nodo guardado y Evaluar alertas seleccionar la misma credencial Header Auth privada ya usada para Supabase (cabecera apikey con Secret key). No pegar claves en el JSON, Code, chat, firmware ni web. Mantener los demas campos importados, incluidos respuesta completa JSON, reintentos y opciones de error de los dos nodos nuevos.
5. Guardar el flujo nuevo. No pulsar Execute workflow mientras el receptor anterior esta publicado: no necesitamos dos suscripciones equivalentes.

## 2. Cambiar al nuevo receptor

6. Apagar temporalmente el ESP32 y dejar terminar la ejecucion en curso del flujo anterior. No cambia el cultivo ni requiere la espera de7min de transferencias de ubicacion.
7. Despublicar/desactivar el flujo receptor anterior. Publicar/activar el03e nuevo. Solo debe quedar UN flujo de persistencia ambiental activo. No activar antiguos03b/03c/03d simultaneamente. Conservar el anterior sin publicar como respaldo.
8. Encender de nuevo el ESP32. Esperar la proxima captura (aproximadamente60s). No fijar/pinear lecturas reales antiguas ni modificar fechas para probar.
9. En Executions del flujo03e abrir la ejecucion reciente y revisar Resultado de persistencia y Resultado de alertas. Publicado funciona sin pulsar Execute workflow. Confirmar la misma captura/UUID y persistido:true; revisar tambien los datos actualizados en web.

## Resultado esperado sin reglas

Resultado de persistencia conserva su salida anterior. Resultado de alertas conserva ese resumen y agrega:

    "persistido": true,
    "alertas": {
      "estado": "evaluada",
      "codigo": "LOTE_EVALUADO",
      "evaluadas": 0,
      "abiertas": 0,
      "actualizadas": 0,
      "cerradas": 0,
      "observacion": "Sin mediciones nuevas aplicables a reglas activas. No indica salud del cultivo ni ausencia de alertas previas."
    }

Los ceros son esperables porque aun no hay reglas reales configuradas. Tampoco significan cultivo saludable. Si hubiera reglas activas, los contadores dependen de la captura.

Si termina en Sin evaluar alertas o alertas.estado es pendiente, conservar la salida completa SIN claves y revisar: URL publica, misma credencial Header Auth en los tresHTTP, migracion0006 y captura reciente. El color verde de la ejecucion no basta para confirmar evaluacion. persistido:true sigue indicando mediciones guardadas. No repetir migraciones ni reenviar capturas reales manualmente para corregirlo; diagnosticar primero la ejecucion.

Para volver al receptor anterior si el nuevo no puede guardar: apagar ESP32, despublicar03e, publicar el anterior y encenderlo. Nunca dejar ambos activos. La pausa no genera mediciones falsas ni rellena los intervalos sin datos.

## Funcionamiento y limites

Persistencia confirmada (insertado o duplicado) -> resolver nodo desde una de las tres mediciones inmutables por ID/cultivo/UUID/origen -> evaluar_alertas_lote con UUID de nodo y mensaje -> resumen. No se toma el nodo UUID del payload. Rechazo/conflicto de ingesta no llega a evaluacion.

Los dos HTTP nuevos usan hasta3intentos con2s entre intentos y15s por solicitud, sin redirects; tras error mantienen salida separada pendiente. Opciones y itemMatching contrastados con el codigo local de n8n2.44.7 instalado: motor reintenta tambien salida json.error antes de continuar. No es una prueba real del motor ni HTTP autenticado desde esta sesion.

Supabase conserva cursor/episodio: repetir evaluacion de una captura ya procesada no duplica episodios ni renueva revision. No existe cola durable de pendientes ni barrido automatico de recuperacion. Fuera de la frescura180s el evaluador omite muestras; un intento posterior puede dar evaluadas0 sin acreditar recuperacion de todo un intervalo. La futura pantalla mostrara fecha de evidencia. La persistencia puede funcionar aunque alertas fallen: revisar ambas salidas.

75 pruebas Node locales aprobadas (69anteriores+6nuevas), incluidos Code incrustados y pairedItem de dos lotes, URL permitida, consulta de nodo vacia/erronea, respuestas malformadas, origenes y conservacion de persistencia ante error. No se modifico el n8n publicado ni Supabase desde Codex. Paso siguiente tras comprobar el flujo real: pantalla de reglas y alertas, limites configurables sin defaults agronomicos inventados. Segundo nodo fisico no acreditado.
