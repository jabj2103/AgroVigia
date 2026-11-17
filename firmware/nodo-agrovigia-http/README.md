# Nodo AgroVigía por HTTP, configurable desde la app (`agv-http` 1.1.0)

Firmware para **ESP32 clásico** (ESP32 Dev Module) con DHT22 en GPIO 4 y LDR en GPIO 34, el mismo montaje del nodo MQTT. Dos cosas lo distinguen de `nodo-dht22-mqtt`:

- **No lleva nada fijo en el código.** Wi-Fi, dirección del servidor, código y clave del nodo, intervalo y sensores se guardan en la memoria de la placa (NVS) y se cambian por el puerto serie, sin recompilar.
- **Envía por HTTP** a un webhook, en lugar de publicar por MQTT: por `https://` a cualquier servidor, o por `http://` sin cifrar solo a un computador de la misma red local. Ver [Uso en red local por http y paso a https en la nube](#uso-en-red-local-por-http-y-paso-a-https-en-la-nube).

> **Estado: compila. Sin probar en placa.** No había ninguna placa conectada cuando se escribió. Lo comprobado y lo pendiente están en [Qué está comprobado](#qué-está-comprobado) y [Sin probar en placa](#sin-probar-en-placa).

## Archivos

| Archivo | Para qué |
|---|---|
| `nodo-agrovigia-http.ino` | El firmware |
| `compilar.sh` | Compila con el arduino-cli local y regenera `web/public/firmware/` |
| `emulador.mjs` | Emulador del protocolo serie en Node, para probar la web sin placa |
| `emulador.test.mjs` | Pruebas del emulador |
| `casos-url.mjs` | Direcciones admitidas y rechazadas, compartidas por las dos pruebas |
| `prueba-host/` | Ejecuta la lógica del sketch en el computador con hardware falso y la compara con el emulador |
| `../../web/public/firmware/agv-http-esp32-1.1.0.bin` | Binario único para ESP Web Tools |
| `../../web/public/firmware/manifest.json` | Manifiesto de ESP Web Tools |

## Cómo se usa desde la app

1. **Instalar.** ESP Web Tools lee `manifest.json` y graba el binario único en la dirección 0. Ese binario cubre también la zona de memoria donde vive la configuración, así que **cada instalación o actualización deja la placa sin configurar**. Después de grabar siempre hay que configurar.
2. **Abrir el puerto serie** con Web Serial: 115200 baudios, 8 bits de datos, sin paridad, 1 bit de parada.
3. **Configurar** con la orden `config`, comprobar con `info`, probar los sensores con `leer` y probar el envío con `enviar`.

Sin configuración completa (nombre del Wi-Fi, dirección, código y clave del nodo) el equipo no enciende el Wi-Fi: solo atiende el puerto serie.

## Protocolo serie

Reglas generales:

- La app envía **una orden JSON por línea**, terminada en `\n` (se admite `\r\n`). Máximo 1024 bytes por línea.
- La placa contesta **una línea por orden**, que siempre empieza por `AGV ` seguido de un objeto JSON. Nunca emite una línea `AGV` sin que haya llegado una orden.
- Las demás líneas son registros con la forma `[ETIQUETA] texto` (o el texto de arranque del chip). La app debe ignorar todo lo que no empiece por `AGV `.
- Las órdenes se atienden de una en una y en orden. Conviene esperar la respuesta antes de enviar la siguiente.
- Toda respuesta trae `"ok":true` o `"ok":false` con `"error":"CODIGO_ESTABLE"`.
- Ni las respuestas ni los registros contienen la clave del Wi-Fi ni la clave del nodo.
- Enviar JSON estricto, como el que produce `JSON.stringify`. Ver [Diferencias entre la placa y el emulador](#diferencias-entre-la-placa-y-el-emulador).

Al arrancar, la placa escribe un registro como este cuando ya puede recibir órdenes:

```
[LISTO] fw=agv-http version=1.1.0 placa=esp32 dht_gpio=4 ldr_gpio=34 tls=raices_del_core configurado=0
```

### `info`

```
{"cmd":"info"}
AGV {"ok":true,"fw":"agv-http","version":"1.1.0","placa":"esp32","configurado":true,"codigo":"agv-esp4c1d-27","wifi_ssid":"Finca","url":"https://n8n.example.com/webhook/agrovigia/nodo","tiene_clave":true,"tiene_wifi_clave":true,"intervalo":60,"sensores":["dht22","ldr"],"wifi":"conectado","ip":"192.168.1.50","reloj":true,"envio":"activo","ultimo_envio":{"estado":"ok","http":200,"servidor":"insertado","codigo":"LOTE_GUARDADO","hace_s":12}}
```

| Campo | Significado |
|---|---|
| `configurado` | `true` si están el nombre del Wi-Fi, la dirección, el código y la clave del nodo |
| `tiene_clave`, `tiene_wifi_clave` | Solo dicen si hay clave guardada. Las claves nunca se devuelven |
| `wifi` | `sin_configurar`, `desconectado` o `conectado` |
| `ip` | Dirección en la red local, o texto vacío si no hay conexión |
| `reloj` | `true` si hay hora NTP vigente. Sin ella no se captura |
| `envio` | `sin_configurar`, `activo`, `pausado` (lo pidió el servidor) o `clave_invalida` (el servidor respondió 401 o 403 y se dejó de enviar) |
| `ultimo_envio` | `null` si no hubo ninguno desde el arranque o desde la última configuración |
| `ultimo_envio.estado` | `ok`, `rechazado`, `clave_invalida`, `servidor_no_disponible` o `error_red` |
| `ultimo_envio.http` | Código HTTP recibido. `0` si no hubo respuesta |
| `ultimo_envio.servidor`, `.codigo` | Los campos `estado` y `codigo` que respondió el servidor, limitados a letras, cifras, punto, guion y guion bajo. Sin respuesta, `codigo` es `RED_` seguido del código de error del cliente HTTP (un fallo de TLS aparece como `RED_-1`) |
| `ultimo_envio.hace_s` | Segundos desde ese intento |

### `config`

```
{"cmd":"config","wifi_ssid":"Finca","wifi_clave":"secreto123","url":"https://n8n.example.com/webhook/agrovigia/nodo","codigo":"agv-esp4c1d-27","clave":"CLAVE_DEL_NODO","intervalo":60,"sensores":["dht22","ldr"]}
AGV {"ok":true,"guardado":true,"configurado":true}
```

Guarda en la memoria de la placa y reinicia la conexión con los datos nuevos, sin reiniciar la placa. **Los campos omitidos (o con valor `null`) conservan su valor**, así que se puede cambiar solo el Wi-Fi:

```
{"cmd":"config","wifi_ssid":"Otra red","wifi_clave":"otraclave123"}
AGV {"ok":true,"guardado":true,"configurado":true}
```

Si un campo no es válido no se guarda ninguno de la orden. `configurado` indica si con lo guardado ya puede conectarse.

| Campo | Regla | Error |
|---|---|---|
| `wifi_ssid` | Texto de 1 a 32 bytes | `WIFI_INVALIDO` |
| `wifi_clave` | Texto vacío (red abierta) o de 8 a 64 bytes | `WIFI_INVALIDO` |
| `url` | `https://` hacia cualquier servidor, o `http://` solo hacia una IPv4 privada escrita con números. Hasta 256 caracteres, solo ASCII visible, sin espacios ni comillas. La [regla exacta](#regla-exacta-de-la-dirección) está más abajo | `URL_INVALIDA` |
| `codigo` | De 1 a 64 caracteres entre `a-z`, `0-9` y guion | `CODIGO_INVALIDO` |
| `clave` | De 1 a 128 caracteres ASCII visibles, sin espacios | `CLAVE_INVALIDA` |
| `intervalo` | Entero de 10 a 3600 (segundos). Por defecto 60 | `INTERVALO_INVALIDO` |
| `sensores` | Lista no vacía y sin repetidos con `"dht22"` y/o `"ldr"`. Por defecto ambos | `SENSORES_INVALIDOS` |

Tras una configuración aceptada se descarta el lote pendiente, se levantan la pausa y el bloqueo por clave rechazada, y el primer envío sale en cuanto hay Wi-Fi y hora.

### `leer`

Lee los sensores activos ahora, sin enviar nada. Funciona aunque la placa no esté configurada, para comprobar el cableado.

```
{"cmd":"leer"}
AGV {"ok":true,"temperatura":29.4,"humedad":67.0,"adc":1234,"iluminacion":30.1}
```

Con un solo sensor activo salen solo sus campos (`temperatura` y `humedad`, o `adc` e `iluminacion`). `adc` es el promedio de 16 conversiones (0 a 4095) e `iluminacion` es el índice relativo de 0 a 100: **no son lux**. Si el DHT22 no entrega un par válido:

```
AGV {"ok":false,"error":"SENSOR_ERROR","sensor":"dht22"}
```

El DHT22 no se puede leer más de una vez cada 2 segundos: dos órdenes `leer` seguidas pueden devolver la misma lectura.

### `enviar`

Captura un lote y lo envía ahora mismo. Si había un lote esperando reintento, envía ese. Responde cuando termina el intento.

```
{"cmd":"enviar"}
AGV {"ok":true,"estado":"ok","http":200,"servidor":"insertado","codigo":"LOTE_GUARDADO","mensaje_id":"3f0c1a2b-4d5e-4f60-8a7b-9c0d1e2f3a4b","intervalo":60,"pausado":false}
```

Cuando el envío no se acepta, `ok` es `false`, `error` clasifica el fallo y los demás campos se mantienen:

```
AGV {"ok":false,"error":"ENVIO_RECHAZADO","estado":"rechazado","http":400,"servidor":"rechazado","codigo":"VENTANA_TEMPORAL","mensaje_id":"...","intervalo":60,"pausado":false}
```

| `error` | Cuándo |
|---|---|
| `SIN_CONFIGURAR` | Falta configuración |
| `SIN_WIFI` | No hay conexión Wi-Fi |
| `SENSOR_ERROR` | El DHT22 activo no dio un par válido. No se envía un lote parcial |
| `SIN_RELOJ` | No hay hora NTP vigente. No se inventa la fecha |
| `ENVIO_RECHAZADO` | El servidor respondió 400 u otro código que no admite reintento |
| `CLAVE_RECHAZADA` | El servidor respondió 401 o 403 |
| `SERVIDOR_NO_DISPONIBLE` | El servidor respondió 503, otro 5xx, 408 o 429. El lote queda para reintento |
| `ERROR_RED` | No hubo respuesta (red, DNS o TLS). El lote queda para reintento |

Un intento puede tardar: hasta 8 s de conexión, 10 s de negociación TLS y 10 s de espera de la respuesta. La app debería esperar unos 45 s antes de dar por perdida la respuesta de `enviar`. Cualquier otra orden puede tardar lo mismo si llega mientras la placa hace un envío automático.

### `borrar`

```
{"cmd":"borrar"}
AGV {"ok":true,"borrado":true}
```

Borra toda la configuración, apaga el Wi-Fi y vuelve a los valores por defecto (intervalo 60, ambos sensores).

### Errores generales

| `error` | Cuándo |
|---|---|
| `JSON_INVALIDO` | La línea no es un objeto JSON |
| `ORDEN_DESCONOCIDA` | Falta `cmd` o no es una orden conocida |
| `LINEA_DEMASIADO_LARGA` | La línea pasa de 1024 bytes |
| `NVS_ERROR` | La placa no pudo guardar o borrar en su memoria |

### Registros

Líneas `[ETIQUETA] texto`, sin claves: `LISTO`, `CONFIG_ESPERA`, `CONFIG_GUARDADA`, `CONFIG_BORRADA`, `WIFI_INICIO`, `WIFI_CONECTADO`, `WIFI_DESCONECTADO`, `WIFI_ESPERA`, `RELOJ_ESPERA`, `RELOJ_ERROR`, `SENSOR_ERROR`, `JSON_ERROR`, `CAPTURA_REAL` (con el JSON del lote), `AVISO` (envío sin cifrar en red local), `HTTP_OK`, `INTERVALO`, `LOTE_RECHAZADO`, `CLAVE_RECHAZADA`, `REINTENTO`, `LOTE_DESCARTADO`, `LOTE_CADUCADO`, `NVS_ERROR`. Son para personas: la app no debería depender de su texto.

## Envío por HTTP

```
POST <url>
Content-Type: application/json
X-AgroVigia-Nodo: <codigo>
X-AgroVigia-Clave: <clave>
```

El cuerpo es el lote, sin envoltura. Con los dos sensores activos es **el mismo JSON v2 real** que arma `nodo-dht22-mqtt.ino`:

```json
{"version":2,"nodo_codigo":"agv-dht22-01","mensaje_id":"3f0c1a2b-4d5e-4f60-8a7b-9c0d1e2f3a4b","origen":"real","tomada_en":"2026-11-16T21:30:00Z","ldr":{"metodo":"adc12_10k_11db_v1","adc_promedio":1234},"mediciones":[{"variable_codigo":"temperatura_aire","valor":29.4,"unidad":"°C"},{"variable_codigo":"humedad_aire","valor":67.0,"unidad":"% HR"},{"variable_codigo":"iluminacion_relativa","valor":30.1,"unidad":"% relativo"}]}
```

`mensaje_id` es un UUID v4 nuevo por captura y `tomada_en` es la hora UTC de NTP, sin milisegundos.

| `sensores` | Lote |
|---|---|
| `dht22` y `ldr` | Versión 2: bloque `ldr` y las tres mediciones. Pasa `n8n/validar-ambiental.cjs` |
| solo `dht22` | Versión 1: `temperatura_aire` y `humedad_aire`, sin bloque `ldr`. Pasa `n8n/validar-telemetria.cjs` (perfil DHT22) |
| solo `ldr` | Versión 1: `iluminacion_relativa`, sin bloque `ldr`. Pasa `n8n/validar-telemetria.cjs` (perfil LDR) |

El contrato v2 exige las tres mediciones juntas, por eso con un solo sensor se usa la forma v1 que el validador ya admite. **Quien reciba estos lotes debe decidir si acepta la versión 1**; con solo LDR no viaja el valor crudo del ADC.

Respuesta esperada: JSON `{"estado","codigo","intervalo_segundos","pausado"}`. Se leen como mucho 512 bytes.

| Respuesta | Qué hace la placa |
|---|---|
| 200 (o cualquier 2xx) | Lote entregado. Si `intervalo_segundos` es un entero de 10 a 3600 distinto al actual, lo adopta y lo guarda. Si `pausado` es `true`, deja el ritmo normal y hace un envío normal cada 5 minutos para consultar. Sin `pausado`, o con `false`, vuelve al ritmo normal |
| 400 (y otros 3xx o 4xx) | Descarta el lote y registra `codigo`. No reintenta. Si trae `pausado`, lo adopta; `codigo` igual a `NODO_PAUSADO` también pausa |
| 401 o 403 | Descarta el lote y **deja de enviar**. `info` muestra `"envio":"clave_invalida"`. Se reanuda con una nueva orden `config`, con una orden `enviar` aceptada o al reiniciar la placa |
| 503 (y otros 5xx, 408, 429) o sin respuesta | Reintenta **el mismo lote**, con el mismo JSON, identificador y fecha, tras 2, 4 y 8 segundos. Lo descarta al cuarto fallo o a los 300 segundos de capturado |

Decisiones de integridad que se conservan del nodo MQTT:

- No se captura sin reloj sincronizado por NTP, ni con una sincronización de más de 2 horas, ni si la hora retrocede. No se inventan fechas.
- No hay lotes parciales: si el DHT22 activo falla o da valores fuera de rango (de -40 a 80 °C, de 0 a 100 % HR), se descarta la captura completa. No se sustituye por cero.
- Un solo lote en memoria. Mientras espera reintento no se captura otro. Nada se guarda en flash para enviarlo después.
- La primera captura sale cuando hay Wi-Fi, hora válida y al menos 3 segundos desde el arranque.

### Receptor

El receptor es el flujo de n8n **03i** (`n8n/03i-ingesta-nodo-https.json`, descrito en `n8n/INGESTA_HTTP.md`): `POST /webhook/agrovigia/nodo` con las cabeceras `X-AgroVigia-Nodo` y `X-AgroVigia-Clave` y el lote v2 real sin envoltura. Responde 200 con `{estado, codigo, intervalo_segundos, pausado}`, 400 con su `codigo`, 401 con `{"estado":"rechazado","codigo":"CLAVE_INVALIDA"}` y 503 cuando el guardado queda pendiente. El código del nodo lo asigna la web, con forma `agv-esp4c1d-27`.

Ese receptor exige el lote v2 con las tres mediciones. **La web registra los nodos siempre con `dht22` y `ldr`**; un nodo configurado con un solo sensor enviaría la versión 1 y recibiría un 400. El flujo `03g` es otro camino (simulador, con cuerpo `{"topico","payload"}` y clave compartida) y no sirve para este firmware.

No se hizo ningún envío de este firmware ni del emulador al flujo 03i: la coincidencia está revisada contra su documentación, no ejecutada.

## Uso en red local por http y paso a https en la nube

El mismo binario sirve para las dos etapas. Solo cambia la dirección que se le configura.

### Etapa 1: n8n en el computador, por http

La placa y el computador con n8n están en el mismo Wi-Fi. La dirección es la IP del computador en esa red, no `localhost`:

```
{"cmd":"config","wifi_ssid":"MiRed","wifi_clave":"...","url":"http://192.168.1.19:5678/webhook/agrovigia/nodo","codigo":"agv-esp4c1d-27","clave":"CLAVE_DEL_NODO"}
AGV {"ok":true,"guardado":true,"configurado":true}
```

La IP del computador se ve con `hostname -I` o `ip -4 addr show`. `localhost` y `127.0.0.1` no sirven ni se admiten: para la placa esa dirección es ella misma.

Con una dirección `http://` la placa usa un cliente sin TLS y escribe este registro al arrancar, al configurar y antes de cada envío:

```
[AVISO] envio sin cifrar en red local
```

**Sin cifrado, la clave del nodo y las lecturas viajan legibles por la red local.** Por eso solo se admite hacia direcciones privadas, que no salen a Internet. Usarlo en una red de confianza y cambiar la clave del nodo si esa red deja de serlo.

Lo que no depende del firmware y hay que revisar si la placa no llega (ninguno comprobado con placa):

- n8n debe escuchar en la red local, no solo en `127.0.0.1`. En `local/docker-compose.yml` eso lo decide `AGROVIGIA_N8N_BIND`, que por defecto es `127.0.0.1`.
- El cortafuegos del computador debe permitir el puerto TCP 5678 desde la red local.
- El router no debe aislar a los equipos del Wi-Fi entre sí.
- Si el computador cambia de IP (DHCP), hay que volver a enviar `url` con la nueva.
- La placa sigue necesitando salida a Internet para la hora NTP (`pool.ntp.org`, `time.google.com`). Sin hora no captura.

### Etapa 2: n8n en la nube, por https

No hay que regrabar ni borrar nada. Basta cambiar la dirección; los demás campos se conservan:

```
{"cmd":"config","url":"https://mi-n8n.onrender.com/webhook/agrovigia/nodo"}
AGV {"ok":true,"guardado":true,"configurado":true}
```

Desde ahí la placa verifica el certificado del servidor (ver [TLS](#tls)) y deja de escribir el aviso. Si el nodo se registró en otra base, cambian también `codigo` y `clave`. Un servicio que tarde en despertar puede agotar los reintentos de un lote (2, 4 y 8 s); ese lote se descarta y el siguiente intervalo lo intenta con uno nuevo.

### Regla exacta de la dirección

Una dirección es válida si cumple las tres condiciones generales y una de las dos formas:

1. Como mucho 256 caracteres.
2. Solo ASCII visible, sin espacios: `^[\x21-\x7e]+$`.
3. Sin comillas dobles (`"`).

Forma https, hacia cualquier servidor:

```
^https:\/\/[^/:]
```

Forma http, solo hacia una IPv4 privada escrita con números (`10.x.x.x`, de `172.16.x.x` a `172.31.x.x`, o `192.168.x.x`), con puerto opcional de 1 a 65535 y ruta opcional que empieza por `/`:

```
^http:\/\/(?:10(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}|172\.(?:1[6-9]|2\d|3[01])(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){2}|192\.168(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){2})(?::(?:6553[0-5]|655[0-2]\d|65[0-4]\d\d|6[0-4]\d{3}|[1-5]\d{4}|[1-9]\d{0,3}))?(?:\/[\x21-\x7e]*)?$
```

Consecuencias de la forma http: no admite nombres de dominio, `localhost`, `127.0.0.1`, IPv6, usuario y clave en la dirección, números con ceros a la izquierda, ni `?` o `#` pegados a la IP sin una `/` antes. Las mayúsculas en `HTTP://` tampoco. Todo lo no admitido responde `URL_INVALIDA`.

Las dos expresiones están exportadas en `emulador.mjs` como `URL_HTTPS` y `URL_HTTP_LOCAL`. El sketch aplica la misma regla en C (`urlValida`), y la prueba en el computador comprueba que ambos coinciden.

## TLS

Quedó la opción segura: `setCACertBundle` con el **almacén de certificados raíz que el core de Espressif enlaza dentro del binario** (unos 69 KB, el conjunto completo de ESP-IDF). No hay certificados copiados en el sketch. Se verifica la cadena del servidor y el nombre del dominio.

- La constante `TLS_SIN_VERIFICAR` está en `false`. En `true` llamaría a `setInsecure()` y dejaría de verificar el servidor: cualquier equipo intermedio podría leer la clave del nodo. Está solo para una prueba de laboratorio.
- El core se compila sin comprobación de fechas de los certificados (`CONFIG_MBEDTLS_HAVE_TIME_DATE` desactivado): un certificado vencido no se rechaza por su fecha.
- El almacén es el de esta versión del core. Si el servidor cambia a una autoridad que no esté ahí, el envío falla con `ERROR_RED` hasta recompilar con un core más nuevo.
- Con una dirección `https://` siempre hay verificación. El único modo sin cifrar es `http://` hacia una IPv4 privada de la red local, con su aviso en el registro.
- Las claves quedan guardadas en la memoria de la placa sin cifrar: quien tenga la placa y un cable puede extraerlas.

## Compilar

Todo vive en `.local/herramientas/arduino/` dentro del repositorio (carpeta ignorada por Git, unos 7 GB con el core completo). No usa `sudo` ni instala nada en el sistema.

```bash
# Primera vez: descarga arduino-cli, el core y las bibliotecas fijadas, y compila
firmware/nodo-agrovigia-http/compilar.sh --instalar

# Siguientes veces: compila y regenera web/public/firmware/
firmware/nodo-agrovigia-http/compilar.sh
```

Lo que hace el guion, por si se quiere repetir a mano:

```bash
BASE="$PWD/.local/herramientas/arduino"
CLI="$BASE/bin/arduino-cli --config-file $BASE/arduino-cli.yaml"

$CLI core update-index && $CLI lib update-index
$CLI core install esp32:esp32@3.3.10
$CLI lib install --no-deps "DHT sensor library@1.4.7" "Adafruit Unified Sensor@1.1.15" "ArduinoJson@7.4.3"

$CLI compile \
  --fqbn "esp32:esp32:esp32:PartitionScheme=default,FlashMode=dio,FlashFreq=40,FlashSize=4M" \
  --warnings default --build-path "$BASE/compilacion/nodo-agrovigia-http" \
  firmware/nodo-agrovigia-http

B="$BASE/compilacion/nodo-agrovigia-http"
"$BASE"/datos/packages/esp32/tools/esptool_py/5.3.0/esptool --chip esp32 merge-bin \
  -o web/public/firmware/agv-http-esp32-1.1.0.bin \
  --flash-mode keep --flash-freq keep --flash-size keep \
  0x1000 "$B/nodo-agrovigia-http.ino.bootloader.bin" 0x8000 "$B/nodo-agrovigia-http.ino.partitions.bin" \
  0xe000 "$B/boot_app0.bin" 0x10000 "$B/nodo-agrovigia-http.ino.bin"
```

`arduino-cli.yaml` fija las carpetas de datos, descargas, usuario y caché dentro de `$BASE`. El guion toma la versión de `FW_VERSION` en el sketch para nombrar el binario y escribir el manifiesto, y borra de `web/public/firmware/` los binarios de otras versiones.

### Versiones fijadas

| Pieza | Versión |
|---|---|
| arduino-cli | 1.6.0 (se verifica su suma SHA-256 al descargar) |
| Core `esp32:esp32` de Espressif | 3.3.10 (la que `firmware/README.md` registra en el equipo del nodo MQTT) |
| esptool (viene con el core) | 5.3.0 |
| DHT sensor library (Adafruit) | 1.4.7 |
| Adafruit Unified Sensor | 1.1.15 |
| ArduinoJson | 7.4.3 |

Placa `esp32:esp32:esp32` (ESP32 Dev Module), partición por defecto de 4 MB, flash en modo DIO a 40 MHz. Se eligió DIO a 40 MHz por ser el ajuste más compatible entre placas; el valor por defecto del IDE es QIO a 80 MHz.

### Resultado de la compilación (versión 1.1.0, 16 de noviembre de 2026)

| Dato | Valor |
|---|---|
| Programa | 1 157 052 bytes, 88 % de la partición de 1 310 720 bytes. Quedan unos 153 KB |
| Variables globales | 52 032 bytes, 15 % de 327 680 |
| Advertencias | Ninguna con `--warnings default`. La versión 1.0.0 tampoco dio ninguna con `--warnings all`; en la 1.1.0 no se repitió esa pasada, y el código del sketch compila en el computador con `-Wall -Wextra -Werror` |
| Binario único | `agv-http-esp32-1.1.0.bin`, 1 222 736 bytes |
| Partes | Arranque 23 552 bytes en 0x1000, particiones 3 072 en 0x8000, selector 8 192 en 0xe000, aplicación 1 157 200 en 0x10000 |

El binario único se arma con `esptool merge-bin`, sin el relleno hasta 4 MB que añade el combinado del core. El guion comprueba que coincide byte a byte con el inicio de ese combinado. La compilación no es reproducible bit a bit: dos compilaciones seguidas del mismo código dieron el mismo tamaño y distinta suma SHA-256.

Como el binario único va de la dirección 0 hasta el final de la aplicación, pasa por encima de la zona NVS (0x9000 a 0xdfff) y la deja en blanco. Por eso instalar borra la configuración. Si algún día se quiere actualizar sin perderla, el manifiesto de ESP Web Tools admite cuatro partes separadas en lugar de una.

## Emulador

`emulador.mjs` habla el mismo protocolo por la entrada y la salida estándar. Sirve para desarrollar y probar el asistente de la web sin placa.

```bash
node firmware/nodo-agrovigia-http/emulador.mjs --ayuda
printf '%s\n' '{"cmd":"info"}' '{"cmd":"leer"}' | node firmware/nodo-agrovigia-http/emulador.mjs
```

| Opción | Efecto |
|---|---|
| `--auto` | Envía solo cada intervalo, como la placa. Sin ella solo envía con la orden `enviar` |
| `--permitir-http` | Acepta también `http://127.0.0.1`, para un servidor de prueba en el mismo computador. Sin ella aplica la regla de la placa: `https://`, o `http://` hacia una IPv4 privada |
| `--estado RUTA` | Archivo que hace de memoria NVS. Guarda las claves en texto: no ponerlo en Git |
| `--sin-red`, `--sin-reloj`, `--fallo-sensor` | Simulan Wi-Fi caído, falta de hora NTP y DHT22 sin respuesta |
| `--temperatura N`, `--humedad N`, `--adc N` | Lecturas inventadas (por defecto 29.4, 67.0 y 1234) |

Desde código se puede importar la clase y saltarse el proceso:

```js
import { NodoEmulado } from '../../firmware/nodo-agrovigia-http/emulador.mjs';
const nodo = new NodoEmulado();
const linea = await nodo.procesarLinea('{"cmd":"info"}');  // 'AGV {...}'
```

### Diferencias entre la placa y el emulador

- **El emulador marca sus lotes con `"origen":"simulado"`**, nunca `"real"`: sus lecturas son inventadas y no deben mezclarse con datos reales.
- Sus registros dicen `[CAPTURA_SIMULADA]` y `emulador=1`. La dirección IP es fija (`192.0.2.10`).
- No verifica TLS a la manera de la placa: usa el `fetch` de Node.
- Con `--permitir-http` admite `http://127.0.0.1`, que la placa rechaza.
- Sin respuesta del servidor, `codigo` es siempre `RED_-1`.
- JSON no estricto: la placa (ArduinoJson) acepta comillas simples, claves sin comillas y texto sobrante tras el objeto, y rechaza `60.0` o `1e2` como intervalo. El emulador (`JSON.parse`) hace lo contrario en esos casos. Con JSON de `JSON.stringify` ambos responden igual.

## Pruebas

```bash
node --test firmware/nodo-agrovigia-http/emulador.test.mjs
node --test firmware/nodo-agrovigia-http/prueba-host/firmware-host.test.mjs
```

La segunda necesita `g++` y la biblioteca ArduinoJson del arduino-cli local; si faltan, se omite sola. Compila `nodo-agrovigia-http.ino` para el computador con `prueba-host/arduino-falso.h`, que sustituye Arduino, Wi-Fi, HTTPS, NVS, DHT22 y ADC por objetos controlados por la prueba.

## Qué está comprobado

- **Compilación real** para ESP32 Dev Module con las versiones fijadas, sin advertencias, y generación del binario único y del manifiesto.
- **Emulador:** 14 pruebas. Forma exacta de cada respuesta, validaciones, regla de direcciones (8 admitidas y 39 rechazadas), aviso de envío sin cifrar, que las claves no salen nunca, cabeceras y cuerpo del `POST` contra un servidor HTTP local, lote contra los validadores de n8n, intervalo y pausa del servidor, 400, 401 y 403, reintentos 2, 4 y 8 s, caducidad y uso por línea de órdenes.
- **Lógica del sketch en el computador:** 7 pruebas con hardware falso. El código del `.ino` responde carácter por carácter igual que el emulador a más de 100 órdenes (incluidas las 47 direcciones de `casos-url.mjs`), elige el cliente sin TLS solo para `http://` y el de TLS con raíces para `https://`, arma el mismo texto de lote (que pasa los validadores de n8n como origen real), y cumple reintentos, caducidad, pausa, bloqueo por clave rechazada, rangos del DHT22, perfiles de un solo sensor y persistencia de la configuración entre arranques.

Aparte, una comparación de una sola vez con 20 000 direcciones generadas dio la misma respuesta en el sketch y en el emulador (no forma parte de las pruebas guardadas).

Esto último prueba la lógica, no el hardware: Wi-Fi, HTTP, HTTPS, memoria y sensores eran falsos.

## Sin probar en placa

Nada de esto se ha ejecutado en un ESP32. Queda por comprobar, con una placa real:

1. Que el binario único se graba con ESP Web Tools y arranca (modo DIO a 40 MHz en la placa concreta).
2. Que abrir el puerto con Web Serial funciona: en muchas placas abrir el puerto la reinicia. La app debería esperar `[LISTO]` o repetir `info` hasta recibir respuesta.
3. Que la configuración se guarda en NVS y sobrevive a un corte de energía.
4. Que conecta al Wi-Fi real y cambia de red con `config` sin reiniciar.
5. Que sincroniza la hora por NTP.
6. Que el envío por `http://` llega al n8n del computador en la red local (cliente sin TLS, cortafuegos, interfaz en la que escucha n8n).
7. **Que la negociación TLS con el almacén de raíces funciona contra el servidor real**, cuánto tarda y si la memoria alcanza (se dio 16 KB de pila a la tarea principal como margen, sin medir).
8. Que el receptor 03i acepta el lote, las cabeceras y devuelve la respuesta esperada. No se hizo ningún envío a un servidor real.
9. Lecturas reales del DHT22 y del LDR con este firmware, y que leer el ADC entre envíos no afecta al Wi-Fi.
10. Comportamiento durante horas: reconexión del Wi-Fi, reintentos reales, consumo de memoria.
11. Tiempos de respuesta reales de cada orden.

El emulador tampoco se probó con el Web Serial de un navegador: habla por la entrada y la salida estándar, no por un puerto serie.
