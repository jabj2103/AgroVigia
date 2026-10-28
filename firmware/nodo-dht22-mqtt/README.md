# DHT22 por Wi-Fi y MQTT: primera prueba real

## Version actual: ambiental v2 (preparada, pendiente de carga)

Tras el diagnostico de Juan se amplio el sketch a temperatura + humedad +
iluminacion relativa en un lote v2, con ADC/metodo conservados. La conversion
es indice ADC 0..100, NO lux ni calibracion entre placas. Conserva GPIO4,
GPIO34, credenciales y codigo de nodo. El topico cambia a agrovigia/v2/real/...

Aplicar primero SQL y configurar broker/n8n siguiendo
[la guia de integracion](../../docs/integrar-nodo-ambiental.md).
Cargar el firmware al final de esa secuencia. El compilador desde Codex
sigue bloqueado por Illegal System DLL Relocation; Verificar desde tu IDE.

Los apartados siguientes registran preparacion y diagnostico anteriores.

## Prueba anterior: DHT22 MQTT + LDR solo por serie (historica)

Juan confirma LDR de dos patas, resistencia externa de 10 kOhm y entrada GPIO 34.
Se amplio el mismo sketch nodo-dht22-mqtt.ino: DHT22 en GPIO 4 conserva su
publicacion; LDR en GPIO 34 (ADC1 del ESP32 clasico) se lee a 12 bits con
atenuacion ADC_11db. El codigo exige el target ESP32 clasico para no trasladar
ese numero de pin sin revisar otra familia de placa.

El LDR imprime aproximadamente cada segundo el promedio redondeado de 16
conversiones consecutivas, el minimo y el maximo de ese grupo. Las operaciones
de red pueden espaciar los mensajes; no se promete muestreo de tiempo real.
Estas conversiones son ADC crudo 0..4095, NO lux ni porcentaje de iluminacion.
No hay conversion automatica basada en minimos/maximos observados. Un extremo
0 o 4095 debe anotarse: por si solo no demuestra fallo, oscuridad o iluminacion
fisica maxima. El promedio tampoco identifica un cable desconectado.

Procedimiento de Juan:
1. Abrir nuevamente nodo-dht22-mqtt.ino en Arduino IDE para cargar los cambios
   de disco. Conservar config_local.h, placa y puerto que ya funcionaban.
2. Verificar y subir. Abrir monitor serie a 115200 baudios.
3. Buscar [LDR_INICIO] y mensajes [LDR_DIAG] con solo_serial=1.
4. Anotar unas diez lineas en luz ambiente, diez cubriendo el LDR y diez con
   mas luz, esperando unos segundos tras cada cambio. Identificar cada tanda.
   Repetir las condiciones y observar si retorna a valores parecidos.
5. Comprobar tambien una captura DHT22 nueva por MQTT/web. El JSON sigue con
   dos variables y el mismo codigo de nodo; el LDR todavia no llega a Supabase.

Con el divisor 3.3 V -> LDR -> punto ADC -> resistencia -> GND se espera que
el ADC crezca con mas luz; comprobar esa direccion con los resultados del
montaje real, sin invertir valores por suposicion.

Siguiente paso: registrar referencias, direccion y conversion relativa
reproducible/comparable para las dos placas; ampliar contrato, validador,
RPC transaccional, catalogo y pantalla antes de publicar tres variables.
La resistencia de 10 kOhm no define por si sola esa escala. No usar un reescalado
independiente de cada placa como si acreditara comparabilidad entre lugares.

Referencia de API: https://docs.espressif.com/projects/arduino-esp32/en/latest/api/adc.html

Firmware del nodo `agv-dht22-01`, cargado y ejecutado por Juan. Aporto mensajes coincidentes entre monitor serie y suscriptor MQTT, incluidos ciclos de 60 segundos y UUID nuevo tras reiniciar. Tambien reaparecieron dos pares cero/cero: el transporte tiene evidencia, pero la estabilidad del sensor sigue pendiente. No fue una carga ni una prueba fisica ejecutada desde esta sesion. Se conserva GPIO 4.

La [evidencia de nueve mensajes](../../docs/pruebas/2026-10-25-dht22-mqtt.json) conserva las dos tandas aportadas, sin reproducirlas por MQTT: dos pares cero/cero en la inicial y cuatro capturas posteriores plausibles. Todos pasan el esquema, incluidos los ceros; eso no acredita exactitud ni estabilidad prolongada. No se modifico el firmware para descartar o reemplazar automaticamente cualquier cero.

## Preparacion ya realizada en este computador

Se ejecuto desde la raiz del repositorio:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\mqtt\agrovigia.ps1 PrepararFirmware -DireccionIPv4 192.168.1.19
```

Esta accion crea una configuracion LAN privada en `.local/mqtt/agrovigia-lan.conf` y `config_local.h` en esta carpeta. El header contiene la credencial MQTT existente del usuario `nodo_dht22`, sin imprimirla ni cambiarla. Ambos archivos estan excluidos de Git. La configuracion LAN paso `mosquitto --test-config`; eso no prueba conectividad. Repetir la preparacion no sobrescribe un header existente para no perder datos Wi-Fi ya completados. Si cambia la IP, regenerar la configuracion LAN y actualizar `MQTT_HOST` en el header manualmente.

## 1. Abrir y configurar el sketch

Abrir **nodo-dht22-mqtt.ino** en Arduino IDE, dentro de esta carpeta. En la pestana `config_local.h`, cambiar solamente los valores:

```cpp
constexpr char WIFI_SSID[] = "CAMBIAR_SSID";
constexpr char WIFI_PASSWORD[] = "CAMBIAR_CLAVE_WIFI";
```

Escribir el nombre y contrasena de la misma red Wi-Fi del computador. Si hay comillas o barras invertidas en esos datos, escaparlas como literales C++ (`\"` y `\\`). No enviar ese archivo por chat, subirlo a Git ni pegarlo en capturas. No lleva claves de Supabase o Gemini. El codigo no imprime las contrasenas.

La IP observada del computador es `192.168.1.19`, puerto **18883**. No usar 127.0.0.1 en el ESP32 ni la IP de los adaptadores de las maquinas virtuales. Comprobar `ipconfig` si cambia la red o el DHCP.

## 2. Instalar la biblioteca que falta y compilar

En el gestor de bibliotecas de Arduino IDE, buscar **ArduinoMqttClient**, de **Arduino**, e instalar la version **0.1.8** usada como base de API. DHT sensor library de Adafruit ya esta localizada en el equipo. Este sketch no utiliza ArduinoJson ni PubSubClient.

PubSubClient 2.8 esta instalada, pero solo publica QoS 0. No se reduce silenciosamente el contrato a QoS 0: ArduinoMqttClient permite QoS 1 y espera el PUBACK en `endMessage`. La descarga automatizada del paquete desde el enlace del indice Arduino fallo en esta sesion con `Host desconocido`; no se instalo una copia por otros medios ni se modificaron bibliotecas existentes.

Seleccionar en el IDE la placa y puerto que funcionaron con el diagnostico, verificar y cargar. El modelo exacto no fue confirmado por Codex. Si aparece `ArduinoMqttClient.h: No such file or directory`, falta esa biblioteca. El intento automatizado de compilacion se registra en `docs/estado.md`; no se afirma compilacion exitosa desde esta sesion.

## 3. Cambiar el broker de loopback a la red de prueba

En la **terminal 1**, detener el broker anterior con Ctrl+C y ejecutar:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\mqtt\agrovigia.ps1 IniciarRed
```

Debera abrir **dos sockets IPv4** en el puerto 18883: 127.0.0.1 para los clientes locales y 192.168.1.19 para el ESP32. Conserva las mismas claves y ACL. No iniciar dos brokers simultaneamente sobre el mismo puerto/direccion.

Esta es una prueba temporal en la red privada de confianza acordada con Juan, con autenticacion/ACL pero **sin TLS**. Las credenciales MQTT no van cifradas por TLS; no exponer este listener a Internet ni configurar redireccion de puertos. El despliegue definitivo y TLS siguen pendientes. La configuracion base de loopback se conserva para poder volver a ella con la accion `Iniciar`.

En la **terminal 2**, mantener el receptor o reiniciarlo para aplicar la correccion UTF-8:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\mqtt\agrovigia.ps1 Escuchar
```

El receptor sigue conectando por 127.0.0.1 y puede leer topicos reales y simulados. No ejecutar `Publicar` para aparentar una lectura fisica; el nuevo firmware publica sus propias lecturas con `origen=real`.

## 4. Comprobar monitor serie y recepcion

Abrir el monitor serie a **115200 baudios**. Se espera:

- Conexion Wi-Fi y `[MQTT_CONECTADO]` con host/puerto y usuario del nodo.
- Sincronizacion NTP; si tarda, `[RELOJ_ESPERA]`. Se necesita salida a servidores NTP por la red; no se inventa una fecha para continuar.
- `[CAPTURA_REAL]` con el JSON de temperatura y humedad, y `[MQTT_ACK]` despues del PUBACK.
- En la terminal 2, topico **agrovigia/v1/real/nodos/agv-dht22-01/telemetria**, mismo UUID/fecha/valores y unidad `°C` y `% HR`.

La primera muestra se toma una vez disponibles Wi-Fi, MQTT y reloj valido y transcurridos al menos 3 segundos de arranque. Las siguientes capturas se programan cada 60 segundos; si falla el sensor se descarta ese ciclo entero. Guardar al menos dos mensajes reales con UUID distintos y comprobar el intervalo. El registro del broker debe mostrar usuario `nodo_dht22`, `q1` y `r0`. Un PUBACK no confirma guardado en Supabase ni aprobacion del futuro receptor n8n.

El firmware no sustituye por cero lecturas no finitas o fuera de rango. Un cero numericamente admisible no se rechaza automaticamente. Si vuelve el comportamiento cero/cero del montaje anterior, revisar la lectura fisica antes de continuar, conservando el registro.

## Errores y pruebas posteriores

| Salida o situacion | Que comprobar |
|---|---|
| `[CONFIG_ERROR]` | Completar nombre Wi-Fi y revisar usuario del header |
| `[WIFI_ESPERA]` | Datos Wi-Fi, cobertura y compatibilidad de la red con la placa; no se conoce la causa solo por esta etiqueta |
| `[RELOJ_ESPERA]` | Acceso a NTP; no usar fecha de arranque como captura |
| `[MQTT_ERROR]` | IP actual, puerto 18883, broker IniciarRed abierto, red y credenciales |
| Broker no abre IP LAN | Comprobar IP Wi-Fi y que el broker anterior este detenido |
| Funciona desde PC pero no desde ESP32 | Listener LAN, aislamiento entre clientes del router y regla firewall para **TCP 18883**; una regla anterior para 1883 no cubre ese puerto |
| `[REINTENTO]` | Comparar UUID, JSON y fecha: deben permanecer iguales |
| `[LOTE_DESCARTADO]` o `[LOTE_CADUCADO]` | Se abandono sin confirmacion; no presentarlo como dato entregado |

Juan cree tener reglas anteriores de firewall. La consulta automatizada no tuvo acceso al recurso CIM, por lo que **no se comprobaron ni cambiaron**. Si falla la conexion LAN, revisar la regla existente para este ejecutable, puerto TCP 18883 y perfil de red activo; no desactivar el firewall ni abrir puertos indiscriminadamente. Si hace falta una regla nueva se preparara limitada al ejecutable y a la red de prueba.

Tras la primera recepcion, probar reinicio del ESP32 (IDs nuevos), caida breve del broker y reintentos (mismo lote), y fallo del sensor (sin lote parcial). Comparar con el contrato. No afirmar que estas pruebas se ejecutaron solo porque el codigo las contempla.

## Decisiones de implementacion

- MQTT 3.1.1, sesion limpia, QoS 1 y retain falso; sin voluntad LWT que invente diagnosticos.
- Un lote en RAM, sin guardar colas en flash ni capturar nuevos lotes estando sin MQTT. Un intento inicial y hasta tres reintentos con esperas 2/4/8 segundos desde el fallo anterior. Al fallar se cierra la sesion y el reintento conserva el payload; el UUID JSON es la clave logica de duplicados, no el identificador de paquete MQTT.
- Limite absoluto de 300 segundos para el lote, tambien si la red no vuelve; llamadas de conexion acotadas por timeouts. No se cambia fecha para rescatar un lote antiguo.
- SNTP marca sincronizacion mediante callback. No se captura antes de sincronizar ni con sincronizacion mayor de 2 horas; se detectan retrocesos frente a la ultima captura y se solicita nueva sincronizacion. Este limite de 2 horas es un control inicial del firmware por verificar, no una precision de reloj demostrada.
- UUID v4 con `esp_fill_random` y bits de version/variante fijados, generado cuando Wi-Fi esta activo. Fecha UTC con segundos y dos valores del DHT22 en un mismo JSON, una cifra decimal, unidad literal del catalogo.
- El JSON MQTT conserva solo temperatura/humedad DHT22; LDR solo por serie en esta prueba. No incluye ESP-NOW, LED, cuenta, cultivo ni fecha de recepcion. La vinculacion y recepcion se resuelven en el servidor.

Fuentes de API: [ArduinoMqttClient](https://github.com/arduino-libraries/ArduinoMqttClient), [implementacion de endMessage](https://github.com/arduino-libraries/ArduinoMqttClient/blob/master/src/MqttClient.cpp) y [RNG de Espressif](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/random.html).
