# Primera prueba MQTT local

Actualizacion ambiental v2: ACL incluye primer nodo v2 y reserva separada para segunda placa; Escuchar se suscribe a v1 y v2. Reiniciar broker para cargar ACL. Guia ../docs/integrar-nodo-ambiental.md. Una ACL futura no crea un nodo ni acredita sensores.

Esta configuracion usa la instalacion existente en `C:\Users\juann\Documents\Mosquitto`. No instala programas, registra servicios, cambia el firewall ni modifica esa instalacion. Ejecuta un broker de AgroVigia en primer plano, solo en **127.0.0.1:18883**. El ESP32 todavia no puede entrar: el acceso desde la red local se preparara despues de esta comprobacion.

## Ejecutar en tres terminales

En VS Code, abre la carpeta AgroVigia y usa **Terminal > Nueva terminal**. Todas las terminales deben estar en la raiz del proyecto:

```powershell
cd 'C:\Users\juann\Documents\Codex\AgroVigia'
```

El script admite Windows PowerShell 5.1 y PowerShell 7. Los comandos usan `-ExecutionPolicy Bypass` solo para el proceso que ejecuta este script local; no cambian la politica global del equipo. El codigo se puede revisar en [agrovigia.ps1](agrovigia.ps1).

**Terminal 1: preparar una sola vez e iniciar el broker.** En esta carpeta la preparacion ya se ejecuto; repetirla conserva las claves existentes.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\mqtt\agrovigia.ps1 Preparar
powershell -NoProfile -ExecutionPolicy Bypass -File .\mqtt\agrovigia.ps1 Iniciar
```

Dejar abierta esta terminal. Debe indicar que abre el puerto IPv4 18883 y que Mosquitto queda ejecutandose. Si aparece un error de puerto ocupado, no detener procesos ajenos: comprobar que no haya otra terminal ejecutando este mismo broker. La comprobacion `Configuration file is OK` por si sola solo valida la sintaxis, no demuestra que este escuchando ni autoriza usuarios.

Mosquitto 2.1.2 puede mostrar una nota recomendando `max_packet_size` en lugar de `message_size_limit`. No es un error de sintaxis. Aqui se conserva el limite de **payload** de 2048 bytes del contrato; un limite de paquete incluiria tambien cabeceras.

**Terminal 2: escuchar.** Ejecutar antes de publicar; no se guardan mensajes fuera de linea.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\mqtt\agrovigia.ps1 Escuchar
```

Quedara esperando. Mantenerla abierta. Se usa un identificador fijo de monitor; abrir otro monitor con el mismo comando reemplazaria la conexion anterior.

La accion Escuchar fija la salida de consola en UTF-8 para mostrar `°C` correctamente en Windows PowerShell. Si se ejecuto una version anterior y se ve `┬░C`, detener ese receptor con Ctrl+C y volver a ejecutar Escuchar; despues publicar un ejemplo nuevo. El archivo original del primer ejemplo se verifico en UTF-8 con la unidad correcta. No sustituir `°C` por texto mal decodificado en el contrato.

**Terminal 3: publicar un ejemplo.**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\mqtt\agrovigia.ps1 Publicar
```

En la terminal 2 debe aparecer:

```text
agrovigia/v1/simulado/nodos/agv-dht22-01/telemetria { ... JSON ... }
```

El JSON contiene dos valores **inventados**, 28.5 grados C y 72 % HR, con `origen=simulado`. Cada ejecucion genera UUID v4 y fecha UTC actuales. El archivo exacto enviado se conserva en `.local/mqtt/simulado-<UUID>.json`. No utiliza las lecturas reales del monitor serie ni cambia su origen para simular una prueba fisica. Un segundo envio es una captura simulada nueva, no un reintento del mismo lote.

El cliente publica y se suscribe con MQTT 3.1.1 y QoS 1, sin retain ni sesion persistente. El publicador confirma el tramo MQTT; comprueba la recepcion en la terminal 2. Todavia no hay n8n ni persistencia, duplicados o reglas de negocio ejecutadas. PowerShell 7 comprueba el payload con `Test-Json`; Windows PowerShell 5.1 solo comprueba su parseo JSON, porque no incluye ese comando.

Para detener, usa **Ctrl+C** en las terminales 2 y 1. No hay inicio automatico con Windows. Si necesitas otra ubicacion de los ejecutables, agrega `-MosquittoDir 'RUTA'` a cada accion.

## Usuarios y permisos

| Usuario | Permiso |
|---|---|
| `nodo_dht22` | Publicar solo `agrovigia/v1/real/nodos/agv-dht22-01/telemetria` |
| `nodo_ldr` | Publicar solo `agrovigia/v1/real/nodos/agv-ldr-01/telemetria` |
| `simulador` | Publicar solo en los dos topicos simulados de esos nodos |
| `receptor` | Leer `agrovigia/v1/+/nodos/+/telemetria`; sin escritura |

El acceso anonimo se deshabilita, el broker esta configurado para rechazar retained y el QoS maximo es 1. Los archivos de configuracion usan los mecanismos `password_file` y `acl_file` disponibles en esta instalacion. Mosquitto 2.1 recomienda plugins como alternativa; no se instalaron plugins en esta prueba de un solo listener.

La preparacion genera claves aleatorias distintas y convierte una unica vez un archivo nuevo de claves a hashes con `mosquitto_passwd -U`. Nunca aplica `-U` a un archivo ya hashado. Las opciones de cada cliente, incluidas sus claves, estan en `.local/mqtt/<usuario>.conf`; el broker usa `.local/mqtt/passwd`. Ambos contienen material privado: `.local/` esta excluido de Git. No subirlos ni compartirlos con Camilo; el generara sus propias claves al preparar su copia. Las contrasenas no aparecen en los comandos ni se imprimen.

El broker no valida el JSON, su origen declarado, el perfil del nodo, el reloj o la existencia de un cultivo. Eso corresponde al futuro receptor. Las ACL limitan el publicador al canal autorizado y son necesarias para sostener la separacion real/simulado. El permiso de LDR no levanta el bloqueo de sus lecturas reales hasta aprobar la conversion del circuito.

## Comprobar denegaciones antes de integrar

Con el broker y el receptor abiertos, ejecutar estos comandos desde otra terminal en la raiz. Son intentos de publicar **payloads vacios**, no mediciones, y deben ser denegados. Se usa MQTT 5 para observar el motivo de rechazo; la prueba normal de datos anterior sigue usando MQTT 3.1.1. En 3.1.1 un PUBACK no demuestra que una ACL haya permitido entregar el mensaje.

```powershell
$mosquitto = 'C:\Users\juann\Documents\Mosquitto'

# El simulador no puede publicar datos reales.
& "$mosquitto\mosquitto_pub.exe" -o .local/mqtt/simulador.conf -V mqttv5 -t 'agrovigia/v1/real/nodos/agv-dht22-01/telemetria' -n -d

# Un nodo no puede escribir en el topico del otro.
& "$mosquitto\mosquitto_pub.exe" -o .local/mqtt/nodo_dht22.conf -V mqttv5 -t 'agrovigia/v1/real/nodos/agv-ldr-01/telemetria' -n -d
& "$mosquitto\mosquitto_pub.exe" -o .local/mqtt/nodo_ldr.conf -V mqttv5 -t 'agrovigia/v1/real/nodos/agv-dht22-01/telemetria' -n -d

# El receptor no puede publicar.
& "$mosquitto\mosquitto_pub.exe" -o .local/mqtt/receptor.conf -V mqttv5 -t 'agrovigia/v1/simulado/nodos/agv-dht22-01/telemetria' -n -d

```

Se espera `Not authorized`/codigo 135 para ACL. No deben aparecer esos mensajes en el receptor. Ante un permiso inesperado, detener la integracion y revisar el registro del broker y la ACL.

La prueba de retain se hace por separado con MQTT **3.1.1**, no MQTT 5. Juan probo el comando anterior con `mqttv5`: el cliente mostro `r0` y PUBACK RC:0 aun usando `-r`. Eso fue una publicacion normal, no una prueba de rechazo de retained. El codigo oficial de libmosquitto desactiva la bandera cuando el servidor anuncia que retain no esta disponible; el resultado observado es compatible con ese mecanismo.

```powershell
# Enviar realmente retain=1 usando MQTT 3.1.1.
& "$mosquitto\mosquitto_pub.exe" -o .local/mqtt/simulador.conf -V mqttv311 -t 'agrovigia/v1/simulado/nodos/agv-dht22-01/telemetria' -n -r -d
```

Verificar `sending PUBLISH (... r1, ...)` en el cliente. Se espera desconexion sin PUBACK de exito, y el registro del broker debe indicar el rechazo o motivo relacionado con retain. Si el cliente reintenta, detenerlo con Ctrl+C tras observar el primer intento. No cambiar `retain_available false` para facilitar la prueba. Si sigue apareciendo `r0`, no se probo un envio retained. No concluir el rechazo solo porque el mensaje no aparece en el monitor.

Resultado aportado por Juan al repetir con MQTT 3.1.1: CONNACK 0, PUBLISH `r1` y `Error: The connection was lost`, sin PUBACK de exito mostrado. Coincide con el comportamiento esperado; el motivo del broker todavia no fue aportado y sigue pendiente para confirmar la causa exacta.

Para comprobar acceso anonimo sin cargar configuraciones predeterminadas de otro proyecto:

```powershell
Set-Content -Path .local/mqtt/sin-credenciales.conf -Value '' -Encoding ascii
& "$mosquitto\mosquitto_sub.exe" -o .local/mqtt/sin-credenciales.conf -h 127.0.0.1 -p 18883 -V mqttv311 -t 'agrovigia/v1/+/nodos/+/telemetria' -E
```

Debe rechazar la conexion. Para comprobar que un nodo no puede leer, ejecutar en una terminal adicional:

```powershell
& "$mosquitto\mosquitto_sub.exe" -o .local/mqtt/nodo_dht22.conf -i agv-prueba-sin-lectura -t 'agrovigia/v1/simulado/nodos/agv-dht22-01/telemetria' -C 1 -W 10
```

Publicar el ejemplo durante esos 10 segundos desde la terminal 3. El receptor autorizado debe recibirlo; el nodo no debe mostrar el payload y debe terminar por rechazo o timeout. Un timeout sin publicar en paralelo no comprueba el permiso de lectura.

Juan realizo esta prueba con una ventana de 20 segundos: aporto timeout del nodo y envio del ejemplo `67aa330e-140e-463e-9e4a-a5cbb159507f`; ante la pregunta de corroboracion confirmo el envio durante esa ventana. Se acepta su confirmacion contextual como resultado reportado; no se recibio un nuevo registro del monitor para ese UUID ni se ejecuto la prueba desde esta sesion.

Juan ya ejecuto la prueba positiva y aporto el registro del broker: autenticacion de receptor y simulador, entrega de un payload simulado de 293 bytes al monitor con QoS 1 y retain 0, y PUBACK del monitor. Comprobo cuatro denegaciones con MQTT 5 y PUBACK RC:135 (`Not authorized`): simulador hacia topico real DHT22, receptor intentando publicar en topico simulado DHT22, DHT22 hacia topico real LDR y LDR hacia topico real DHT22. El acceso anonimo fue rechazado con `Connection Refused: not authorised`. El payload recibido fue aportado y el archivo original pasa el esquema; se ajusto la visualizacion UTF-8 de la unidad. La lectura no autorizada sigue pendiente; el envio retained con MQTT 3.1.1 mostro `r1` y desconexion, pendiente de confirmar el motivo en el broker. En la sesion automatizada se comprobo sintaxis de configuracion, preparacion de claves y exclusion de Git; la conexion TCP de control entre sockets propios devolvio Windows 10013 (acceso denegado), impidiendo completar la prueba automatizada de red. Ese limite no impidio las pruebas manuales posteriores de Juan.

## Siguiente paso

Ya estan escritos el [firmware DHT22 MQTT y su guia de conexion](../firmware/nodo-dht22-mqtt/README.md). `PrepararFirmware -DireccionIPv4 192.168.1.19` genera configuracion LAN privada y header del nodo; `IniciarRed` arranca esa configuracion en lugar del broker de loopback, que se debe detener antes con Ctrl+C. La configuracion base se conserva. Este paso no cambia automaticamente el firewall ni modifica la instalacion de Mosquitto.

La prueba LAN acordada sera temporal y sin TLS, solo sobre la red privada de confianza compartida por el PC y el ESP32, con claves por nodo y ACL; no publicar puertos a Internet. TLS y despliegue definitivo siguen pendientes. Revisar las reglas anteriores solo si no permiten la conexion a TCP 18883; no asumir que una regla para 1883 es suficiente. La recepcion fisica MQTT aun debe comprobarse.

Fuentes: [configuracion de Mosquitto](https://mosquitto.org/man/mosquitto-conf-5.html), [mosquitto_passwd](https://mosquitto.org/man/mosquitto_passwd-1.html), [cliente publicador](https://mosquitto.org/man/mosquitto_pub-1.html) y [cliente suscriptor](https://mosquitto.org/man/mosquitto_sub-1.html).

Comportamiento de retain en el cliente: [codigo oficial send_publish.c](https://github.com/eclipse-mosquitto/mosquitto/blob/master/lib/send_publish.c), consulta de la rama master; no se recompilo ni inspecciono el binario instalado.
