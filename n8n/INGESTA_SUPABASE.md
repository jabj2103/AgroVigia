# Primera ingesta MQTT a Supabase

Estado: RPC aplicada y siete comprobaciones SQL aprobadas segun resultado de
Juan. Se preparo 03b-ingesta-dht22.json; 61 pruebas Node aprobadas. Esto no
acredita aun importacion/ejecucion de 03b ni HTTP o filas MQTT guardadas.

## 1. Importar como flujo nuevo

Crear otro workflow en n8n y usar Import from File con
[03b-ingesta-dht22.json](03b-ingesta-dht22.json). Se entrega inactivo y sin
credenciales; no sobrescribir el flujo 03a. El nuevo flujo solo escucha el
topico simulado del DHT22 durante esta primera prueba.

En MQTT receptor seleccionar la credencial existente que ya funciono:
Mqtt, 127.0.0.1, puerto 18883, usuario receptor. Conservar Topics y las opciones
del archivo. No activar JSON Parse Body ni Only Message.

## 2. Proyecto y clave

En Supabase abrir el proyecto:
- Integrations > Data API: copiar Project URL. Debe ser
  https://REFERENCIA.supabase.co, sin /rest/v1.
- Project Settings > API Keys: crear/revelar una Secret key (sb_secret_...).
  Puede llamarse agrovigia-n8n-dev. No usar la publishable key para esta RPC.

En el nodo Proyecto Supabase, reemplazar el campo supabase_url por la URL.
El Code exige HTTPS y un host *.supabase.co sin ruta/query/credenciales.
El endpoint RPC se construye a partir de esa URL. No editarlo en HTTP.

En Guardar lote en Supabase:
1. Authentication: Generic Credential Type.
2. Generic Auth Type: Header Auth (ya queda seleccionado en el JSON).
3. Crear una credencial, nombre visible sugerido AgroVigia Supabase ingesta.
4. Dentro de esa credencial: Name = apikey, Value = la Secret key.
5. Guardar la credencial.

La clave queda en la credencial cifrada de n8n, no en headers escritos en el
nodo ni en el archivo del workflow. No enviarla al chat, firmware o web.
Se usa solo apikey: las claves sb_secret no son JWT para Authorization Bearer.
No se requieren la contrasena de base de datos ni cuentas de agricultores
para autenticar esta llamada del servidor.

## 3. Ejecutar una publicacion nueva

Mantener Mosquitto y n8n abiertos. Ejecutar TODO el workflow 03b y esperar su
evento MQTT. No ejecutar la preparacion por separado con datos viejos/fijados.

En otra terminal de la raiz publicar:

    powershell -NoProfile -ExecutionPolicy Bypass -File .\mqtt\agrovigia.ps1 Publicar

Guardar el UUID que muestra Publicar y compararlo con Resultado de persistencia.
Para una captura nueva se espera estado=insertado, persistido=true,
nuevo_lote=true y dos medicion_ids. Una repeticion identica confirmada devuelve
duplicado, persistido=true y nuevo_lote=false. No volver a ejecutar reglas por
duplicados. Rechazado o conflicto_id siempre tienen persistido=false; el color
verde de la ejecucion no sustituye estos campos.

HTTP hace hasta tres intentos totales, con 2 s de espera, usando el mismo
cuerpo y recibida_en. Los errores HTTP no se convierten en exito. Al agotarse
los intentos la ejecucion falla y queda para diagnostico/reintento; no hay cola
duradera automatica. No recalcular la recepcion para rescatar un lote viejo.
Reintentar el HTTP con sus mismos datos, conservando el mensaje original.

Comprobar las filas con
[verificar-ultima-ingesta.sql](../supabase/verificar-ultima-ingesta.sql) en SQL
Editor. Deben aparecer dos filas simuladas del mismo UUID, valores, unidades,
cultivo y fechas. Comparar con el UUID nuevo, no asumir que el ultimo lote es
el esperado si se hicieron otras publicaciones.

## 4. Semantica de recepcion y canal

Decision de implementacion para la demostracion 03b: recibida_en es el instante
en que empieza Preparar ingesta en la ejecucion automatica MQTT, despues de
Proyecto Supabase. Es recepcion de aplicacion APROXIMADA, no timestamp del
socket, del broker o del callback MQTT. El resultado local incluye
fuente_recibida_en=inicio_validacion_mqtt_aproximado. No hay garantia sobre la
demora del Trigger a ese Code. La ventana temporal de la RPC usa ese instante;
una cola larga puede provocar rechazo de mensajes. La captura nunca cambia.

Esta decision actualiza la alternativa pendiente del flujo 03a y la semantica
de entrada del contrato para esta demostracion. El 03a conserva recibida_en
null y sigue siendo solo inspeccion. Las filas creadas mediante 03b deben
interpretarse con esta precision. Antes de introducir otra fuente temporal o
mezclar receptores, agregar procedencia de recepcion al esquema si se requiere
distinguirla por fila. No presentar esta fase como medicion de latencia MQTT.

El Trigger instalado no expone retain. No se inventa false: p_retenido=null.
Se declara p_retencion_broker_desactivada=true con fundamento en
retain_available false del broker del proyecto y los controles previos.
p_acl_verificada=true declara las ACL del canal probado, no identidad que
aporte el payload. La DB no certifica esas banderas. Los dos flags son
configuracion del servidor incrustada en el Code; si cambia el broker, detener
la ingesta y comprobar su politica antes de volver a usarlos.

No hay permisos de escritura por cuenta en el flujo: la funcion resuelve y
bloquea el nodo y el cultivo del servidor. La web no recibe la Secret key.
La configuracion local con runner interno es de demostracion y codigo propio;
revisar el despliegue y aislamiento antes de exponerlo o usarlo en produccion.

## 5. Despues de la prueba simulada

Solo tras verificar HTTP y las dos filas simuladas, ampliar Topics a:

    agrovigia/v1/simulado/nodos/agv-dht22-01/telemetria:1,agrovigia/v1/real/nodos/agv-dht22-01/telemetria:1

Ejecutar todo y esperar una captura nueva del ESP32. Confirmar UUID desde el
monitor serie hasta las filas con origen real, sin convertir ejemplos.
Consulta/estadisticas/alertas deben seguir separando real y simulado.

Siguen pendientes dos sesiones concurrentes, fallo durante insercion,
duplicado tras cambio de cultivo, nodo revocado/sin vinculo y lote previo
parcial en pruebas de servidor. Las pruebas actuales no cierran la etapa
entera ni acreditan recuperacion ante caidas. Las claves privilegiadas y los
datos internos de n8n permanecen excluidos de Git.

Fuentes consultadas:
- https://supabase.com/docs/guides/api/api-keys
- https://docs.n8n.io/integrations/builtin/credentials/supabase/
- MqttTrigger, HttpRequest y Set instalados en n8n 2.44.7 (revision local).

Comprobaciones locales:

    node n8n/generar-ingesta.cjs
    node --test n8n/preparar-ingesta.test.cjs n8n/validar-telemetria.test.cjs

No abren red ni escriben en Supabase.

## Resultado de la primera prueba real y recepcion continua

Juan confirmo por serie y RPC la captura real
796c87eb-4154-407e-9426-5701ef058cf7: 28.2 grados Celsius y 51 % HR,
ejecucion 16 manual success. Comprobar filas con
[verificar-captura-real.sql](../supabase/verificar-captura-real.sql).

El flujo guardado sigue sin publicar. Execute workflow sirve para pruebas y
su MQTT manual recibe un evento. Para guardar automaticamente las capturas
nuevas, terminar cualquier escucha manual y pulsar Publish en 03b. La
publicacion activa el disparador local; no publica una pagina web en Internet.
Conservar Topics real DHT22 y las terminales de Mosquitto/n8n abiertas.
Verificar varias ejecuciones nuevas en Executions sin pulsar Execute otra vez.
El editor de prueba no muestra necesariamente las ejecuciones automaticas.
No afirmar recepcion continua hasta observarlas; las capturas anteriores sin
suscriptor no se recuperan automaticamente con la configuracion actual.

Fuente: https://docs.n8n.io/workflows/create/