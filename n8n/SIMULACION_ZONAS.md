# Conectar una captura simulada del panel con Supabase

Estado: código preparado y probado localmente. Juan informa correctas las cuatro filas del provisionamiento. No se han importado/publicado flujos ni enviado capturas al Supabase remoto desde esta sesión. Primer objetivo: una captura de diez variables y un reintento idempotente. Sin alertas ni IA para esta ruta todavía.

## 1. Reiniciar el broker con la configuración ampliada

Desde la raíz de AgroVigia, detener **el broker de este proyecto** con Ctrl+C en su terminal y ejecutar:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\mqtt\agrovigia.ps1 IniciarRed
```

`IniciarRed` actualiza únicamente `message_size_limit 2048` a `8192` en la copia LAN privada existente, conservando IP y credenciales. La plantilla y la ACL del repositorio ya incluyen v3. No ejecutar Preparar para cambiar claves ni iniciar otro broker en el mismo puerto. Si solo se usa loopback, utilizar la acción `Iniciar`.

El usuario MQTT `simulador` escribe v3 exclusivamente en `agrovigia/v3/simulado/nodos/+/telemetria`; `receptor` lee ese canal. Los usuarios físicos no pueden escribir v3 y el simulador no puede publicar como real. El catálogo de Supabase valida qué identidades virtuales existen, sus capacidades y su ubicación. El límite de los validadores v1/v2 sigue siendo 2048 bytes.

Prueba opcional reproducible: `node mqtt/probar-simulacion-v3.mjs`. Crea un broker efímero loopback, contraseñas de prueba en `.local/qa-mqtt-v3`, comprueba entrega UTF-8, ACL, ACK negativo, retain forzado y límite 8192; cierra solo sus procesos. No conecta n8n ni Supabase. No necesita reiniciar el broker habitual para ejecutarla.

## 2. Importar el receptor v3 independiente

1. Abrir n8n en `http://localhost:5678`. Si está cerrado: `powershell -NoProfile -ExecutionPolicy Bypass -File .\n8n\iniciar-local.ps1`.
2. Crear un flujo nuevo e importar `n8n/03f-ingesta-simulada-v3.json` mediante **Import from File**. El archivo está inactivo y sin credenciales.
3. En **MQTT receptor**, seleccionar la credencial existente del usuario **receptor**, broker `127.0.0.1`, puerto `18883`. Conservar el tópico `agrovigia/v3/simulado/nodos/+/telemetria:1`, mensaje como texto y tópico incluido.
4. En **Proyecto Supabase**, conservar el nombre de campo `supabase_url` y reemplazar su valor por la Project URL de tu proyecto. Mantener **Include Other Fields** activado. La URL pública no es una clave.
5. En **Guardar lote en Supabase**, seleccionar la misma credencial **Header Auth** ya utilizada para la ingesta real: encabezado `apikey` con la clave privada del servidor. No pegar la clave en el código, panel, archivo JSON ni chat. Es el único HTTP de este flujo.
6. Guardar y publicar **una sola copia** de 03f. Puede seguir publicado 03e para los ESP32: escucha v2 real, mientras 03f escucha exclusivamente v3 simulado. No ampliar 03e al tópico v3 ni ejecutar 03f manualmente a la vez que su copia publicada.

Ruta: MQTT receptor → Proyecto Supabase → Preparar ingesta → Forma valida → Guardar lote en Supabase → Resultado de persistencia. La rama falsa va a Rechazado antes de RPC. El flujo conserva mensaje/recepción en los tres intentos HTTP; una ejecución verde por sí sola no acredita guardado. Ante error HTTP, el resumen informa persistido null/pendiente. Una negativa explícita de la RPC informa persistido false.

La recepción es aproximada al inicio del nodo Code automático, no la hora exacta del broker. Retain desconocido permanece null; las banderas de canal se fijan en el código del servidor y presuponen el broker de este repositorio reiniciado y sus ACL comprobadas. La RPC sigue verificando cuenta/cultivo/zona, asignación, capacidades, fechas, metadatos y duplicados antes de insertar diez filas atómicamente.

## 3. Abrir el panel con envío manual habilitado

Detener el servidor anterior del panel con Ctrl+C, exportando antes las capturas que se quieran conservar. En su terminal:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\simulador\iniciar-local.ps1 -ConMqtt
```

Abrir/recargar `http://127.0.0.1:5190`. El arranque sin `-ConMqtt` sigue siendo local, sin endpoints de envío.

1. Ejecutar otra vez la consulta **de solo lectura** `supabase/verificar-provision-simulacion.sql`, preparada para el cultivo de demostración. No repetir el provisionamiento ni las migraciones. Si se eligió otro cultivo, ajustar su WHERE.
2. En los resultados de Supabase, copiar/exportar las **cuatro filas como JSON**, no Markdown ni CSV. Debe ser un array `[{...}, {...}, {...}, {...}]` con los campos de la consulta, incluidos `habilitado` booleano y `variables_simuladas` numérico.
3. En la sección **Enviar una captura simulada** del panel, desplegar **Configurar los nodos virtuales**, pegar ese JSON y pulsar **Configurar nodos**. No se necesitan claves de Supabase en el panel.
4. Elegir una zona, ajustar valores y pulsar **Capturar valores actuales**. También se puede avanzar un paso de un escenario. Esa acción por sí sola no envía nada.
5. Pulsar **Enviar última captura a MQTT**. Comprobar el sector/UUID escrito encima del botón. Se pausa cualquier secuencia en curso. Esta primera integración envía una captura por pulsación; no reproduce automáticamente toda la bitácora ni envía los pasos automáticamente.

El servidor usa el `mosquitto_pub.exe` existente en `%USERPROFILE%\Documents\Mosquitto` y su archivo privado `.local/mqtt/simulador.conf`. Las credenciales se leen por el cliente, no aparecen en argumentos, navegador o resultados. MQTT v5 permite distinguir PUBACK negativo incluso cuando el ejecutable sale con código cero. Sin shell ni nuevas dependencias. El acceso HTTP queda limitado a loopback, mismo origen y token de la instancia; solo sirve recursos públicos permitidos. Sin persistencia de configuración por HTTP.

El mapeo queda en memoria del servidor. Después del primer intento de envío se bloquea para evitar que un reintento cambie de identidad/asignación. Para cambiarlo, exportar la sesión y reiniciar servidor/pestaña. Cambiar el cultivo de ejemplo Maíz/Yuca/Papa no cambia el cultivo de destino: lo determina el catálogo. Mover/deshabilitar un nodo puede invalidar su asignacion_version; consultar de nuevo el mapeo y comenzar otra sesión con capturas nuevas. Las capturas de más de cinco minutos no se publican desde este panel.

## 4. Comprobar guardado y duplicado

1. En **Executions** de 03f abrir la ejecución automática reciente y revisar **Resultado de persistencia**. Esperado: `estado: insertado`, `codigo: LOTE_SIMULADO_GUARDADO`, `origen: simulado`, `persistido: true` y **diez** `medicion_ids`. El UUID debe ser el del panel.
2. Ejecutar completa `supabase/verificar-captura-simulada-v3.sql`, sustituyendo su UUID de ejemplo por el de la captura. Debe mostrar una fila, origen simulado, diez variables, versión v3 y los valores del panel. No cambiar fechas de un ejemplo antiguo para simular una nueva observación.
3. Sin crear otra captura, pulsar **Reenviar la misma captura** en menos de cinco minutos. La RPC debe responder `estado: duplicado`, `persistido: true`, `nuevo_lote: false`, mismos diez IDs. La consulta sigue contando diez filas.
4. Repetir con otra zona y una captura nueva: distinto nodo/zona/UUID, mismo origen simulado y diez variables. Las mediciones reales de los ESP32 conservan su origen real.

**MQTT confirmó** solo significa PUBACK del broker. Puede haber mensajes sin guardar si n8n estaba apagado/no suscrito. El panel no consulta Supabase ni interpreta silencio como éxito. Exportar incluye los ACK/intentados de las capturas conservadas, `enviado_mqtt` según ACK y `persistido_supabase: null` si se intentó enviar; comprobar n8n/SQL por separado. La bitácora continúa en memoria y limitada a 300 capturas. No hay cola durable ni reenvío automático después de cerrar el panel.

Si falla: revisar primero mensaje del panel; después la ejecución 03f, Preparar ingesta y Resultado de persistencia. `ASIGNACION_CAMBIO` requiere un mapeo actualizado; `VENTANA_TEMPORAL` requiere captura nueva/relojes correctos; error HTTP queda pendiente. No ampliar permisos ni cambiar el origen para superar rechazos.

## Verificación del código

```powershell
npm.cmd --prefix simulador test
npm.cmd --prefix simulador run test:browser
node --test n8n/*.test.cjs n8n/*.test.mjs
node mqtt/probar-simulacion-v3.mjs
```

Regenerar el export tras modificar sus fuentes: `node n8n/generar-simulada.mjs`. Las pruebas de navegador usan un publicador ficticio; la prueba MQTT usa un broker aislado. Ninguna acredita llamadas al Supabase remoto. El próximo desarrollo tras confirmar este recorrido será consultar simulaciones explícitamente en la web y representar zonas/nodos en el croquis, antes de ampliar reglas/perfiles y sugerencias IA.
