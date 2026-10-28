# Recepcion MQTT: etapa 3a

Actualizacion: disponible 03c-ingesta-ambiental.json para DHT22 + LDR v2, inactivo y sin credenciales. Conserva 03b para DHT22 v1. Guia completa en ../docs/integrar-nodo-ambiental.md; aplicar0003 antes de usar RPC ambiental. LDR es indice ADC, no lux.

Siguiente flujo preparado: [03b MQTT a Supabase](INGESTA_SUPABASE.md). Sus 61 pruebas locales pasan; pendiente importacion y primera llamada HTTP real. El 03b asigna recepcion de aplicacion aproximada al inicio de validacion automatica, con limites documentados. El 03a conserva su alcance de inspeccion sin persistencia.

Arranque local preparado el 26 de octubre de 2026: ver
[INSTALAR_LOCAL.md](INSTALAR_LOCAL.md) y `iniciar-local.ps1`.
Usa n8n 2.44.7 con Node 24.x, datos privados en `.local/n8n` y editor solo
en loopback. Juan confirmo el arranque local y ejecuto la ruta manual del validador; la prueba MQTT sigue pendiente.

Se preparo un primer flujo **de inspeccion**, inactivo y sin credenciales: [03a-inspeccion-mqtt.json](03a-inspeccion-mqtt.json). Juan importo el flujo y aporto la salida de la ruta manual ejecutada en su n8n: prevalidado, perfil DHT22 simulado y persistido false. No escribe Supabase, no aplica reglas y no sustituye un backend adicional. n8n y PostgreSQL/Docker no se localizaron como comandos en PATH; eso no demuestra que Camilo o Juan no los tengan en otra ubicacion o servicio.

## Archivos y comprobaciones

| Archivo | Uso |
|---|---|
| `validar-telemetria.cjs` | Funciones que se incrustan en el Code de n8n; no abre servicios |
| `validar-telemetria.test.cjs` | Casos del contrato y controles adicionales con contexto ficticio |
| `generar-flujo.cjs` | Genera el JSON importable a partir del mismo codigo probado |
| `03a-inspeccion-mqtt.json` | MQTT Trigger y ruta manual hacia prevalidacion, sin persistencia |

Desde la raiz del repositorio, con Node ya disponible:

```powershell
node n8n/generar-flujo.cjs
node --test n8n/validar-telemetria.test.cjs
```

No se instalan dependencias. Las pruebas incluyen los 31 casos de `docs/mqtt/casos.json`, claves repetidas/escapadas, BOM, tamano UTF-8, valores numericos y precision, permisos/modelo de cuenta, fecha existente y ventana temporal, duplicados con variables reordenadas, lote previo parcial y revocacion. Tambien comprueban el codigo incrustado en el flujo y las nueve evidencias aportadas por Juan, sin publicarlas de nuevo ni inventar recibida_en para ellas.

El contexto de esas pruebas es **ficticio y en memoria**. No demuestra RLS, transacciones, bloqueo de carreras ni filas guardadas. `evaluarContexto` devuelve una decision logica; no registra nada y nunca debe recibir datos de autorizacion desde el mensaje MQTT o el navegador.

## Que hace el flujo importable

1. `MQTT receptor` escucha `agrovigia/v1/+/nodos/+/telemetria:1`. El sufijo `:1` configura QoS de suscripcion en este nodo; no pertenece al topico publicado por el ESP32.
2. Con JSON Parse Body y Only Message desactivados, conserva `topic` y el texto `message`. No activar parseo previo: se perderian claves duplicadas antes de detectarlas.
3. `Prevalidar contrato` comprueba tamano, JSON estricto, campos, perfil completo, unidades/rangos, fecha de calendario, identificador y coincidencia topico/origen/nodo. Emite `prevalidado` o `rechazar` por item, con codigo de motivo.
4. Un par cero/cero admite la forma numerica, pero genera `PAR_CERO_REQUIERE_REVISION`. No se interpreta como ausencia, lectura saludable o fallo con causa demostrada. No se cambiaron rangos ni contrato para ocultarlo.
5. La ruta manual crea un ejemplo simulado para inspeccion, con ID fijo claramente marcado y fecha actual. No publica MQTT. Ese ID fijo no sirve para producir capturas nuevas en un flujo con persistencia.

**`prevalidado` no significa autorizado ni almacenado.** El resultado mantiene `persistido: false`, pendientes de autorizacion, duplicados, ventana temporal y persistencia. La ventana se evalua despues de buscar un lote previo para no rechazar un duplicado antiguo confirmado como si fuera una captura nueva. Ninguna salida del flujo debe conectarse todavia a alertas o estadisticas.

## Limitacion del Trigger consultado

Se reviso el archivo oficial `MqttTrigger.node.ts` (version de nodo 1, rama master). Su salida contiene solo `topic` y `message`, con conversion previa del buffer a texto. No conserva `packet.retain`, QoS observado, bytes originales ni instante del callback MQTT. **No fabricar `retained=false` o recibida_en exacta a partir de esa salida.**

El Code registra `procesamiento_iniciado_en`, con nombre distinto: no equivale silenciosamente a la hora de llegada al trigger y no se mapea a `mediciones.recibida_en`. Por eso el flujo importable devuelve recibida_en null y advierte de retain no disponible. El procesamiento paralelo evita una cola ordenada en el trigger, pero no garantiza timestamp exacto ni entrega duradera.

El 26 de octubre se inspecciono tambien MqttTrigger.node.js instalado en 2.44.7 y se confirmo esa misma salida limitada. Antes de persistir se debe resolver una de estas opciones de forma explicita:

- Preservar en el callback de entrada la fecha real de recepcion y metadata, por ejemplo mediante un nodo n8n adaptado y revisado dentro del proyecto; no se implemento ese nodo aqui.
- Si la version instalada ofrece esa informacion, mapearla y comprobarla con mensajes reales.
- Si se decide usar el inicio del Code como aproximacion de recepcion, documentar y acordar la precision/semantica en el contrato antes de cambiar ese campo. El 03b implementa esta aproximacion como decision de demostracion, documentada en INGESTA_SUPABASE.md; no se cambia la salida historica del 03a.

Para retain, la configuracion Mosquitto del proyecto tiene `retain_available false` y hay evidencia cliente de desconexion tras `r1`, pendiente del motivo en el broker. Esa politica verificada puede ser evidencia de canal en un receptor futuro, pero no convierte un campo que falta en metadata observada. La funcion de contexto exige retain conocido falso o una politica de broker verificada de forma explicita, ademas de ACL verificada.

## Importar cuando exista una instancia n8n

1. Revisar primero la version y los flujos ya existentes de Camilo. Importar el archivo como flujo nuevo; no reemplazar trabajo existente ni activarlo automaticamente.
2. Para la ruta manual, ejecutar `Probar ejemplo sin broker` y comprobar salida `prevalidado`, origen simulado, `persistido: false` y controles pendientes.
3. Para MQTT, asignar una credencial n8n del usuario `receptor`. La clave esta en el archivo privado `.local/mqtt/receptor.conf`; copiarla directamente a la interfaz de credenciales, no al flujo ni al chat. No usar `nodo_dht22` o `simulador` como receptor.
4. Si n8n se ejecuta directamente en este Windows, el broker puede ser `127.0.0.1:18883`. Si esta en Docker, una VM u otro equipo, localhost pertenece a ese entorno: acordar direccion/ruta y conectividad. Un n8n remoto no podra acceder al broker privado sin una solucion de red; no abrirlo a Internet como atajo.
5. Ejecutar la escucha de prueba y luego el comando `Publicar` de la terminal para recibir un ejemplo simulado **nuevo**. Inspeccionar la salida. No reproducir fixtures fechados como lecturas nuevas reales.
6. Recibir una captura nueva del ESP32 y comprobar topic, campos y advertencias. Comparar unidad y UUID con el monitor serie.
7. Solo tras esa comprobacion y el cierre de las limitaciones indicadas, conectar el almacenamiento transaccional de [la siguiente integracion](../supabase/README.md).

Las credenciales MQTT del proyecto usan actualmente protocolo MQTT 3.1.1, sesion limpia y autenticacion por usuario. El listener LAN de prueba es sin TLS, limitado a red privada de confianza. La futura instalacion debe comprobar opciones de sesion/version y conexion efectiva; este archivo no configura credenciales por cuenta propia.

## Siguiente resultado de cierre

Una lectura prevalidada no cierra la etapa 3. Faltan operacion transaccional Supabase, catalogo real por cuenta, seguridad/RLS, duplicados concurrentes y recuperacion de fallos. QoS 1 al broker no implica que n8n o Supabase ya hayan guardado el lote. Con sesion limpia y sin persistencia del broker no hay garantia de recuperar mensajes que llegaron cuando n8n estaba apagado; esa limitacion de demostracion y la estrategia de recuperacion deben quedar visibles.

Fuentes primarias consultadas: [MQTT Trigger](https://docs.n8n.io/integrations/builtin/trigger-nodes/n8n-nodes-base.mqtttrigger/), [codigo oficial del Trigger](https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/nodes/MQTT/MqttTrigger.node.ts). La version instalada debe compararse con estas referencias; no se afirma importacion o ejecucion verificada del JSON solo por generarlo.
