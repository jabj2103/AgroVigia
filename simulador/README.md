# Panel local de escenarios simulados

Herramienta externa a la web del agricultor: cuatro puntos virtuales, diez variables por punto, ajustes manuales y seis escenarios reproducibles. **Cada control y cada captura se identifica como Simulada; el JSON conserva `origen: "simulado"` en el lote y en cada medición.**

Disponible también envío manual MQTT v3 con `-ConMqtt`, mapeo de los cuatro nodos provisionados y receptor n8n independiente. Sigue esta [guía paso a paso](../n8n/SIMULACION_ZONAS.md) para comprobar una captura completa y su duplicado en Supabase. La conexión remota todavía requiere esa prueba del usuario; las comprobaciones locales no la sustituyen. El arranque sin el modificador continúa en modo local.

## Iniciar

Desde la raíz de AgroVigia, en una terminal independiente de VS Code:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\simulador\iniciar-local.ps1
```

Abrir **http://127.0.0.1:5190** y mantener la terminal abierta. Ctrl+C detiene el servidor. Necesita Node 24.x, ya utilizado por el proyecto. **No requiere instalar dependencias, claves, Mosquitto ni n8n.** También se puede iniciar con `npm.cmd --prefix simulador start`.

Si el puerto está ocupado, elegir otro explícitamente, por ejemplo:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\simulador\iniciar-local.ps1 -Puerto 5191
```

El servidor se limita a loopback; esta etapa no se abre desde un teléfono físico. La vista móvil puede comprobarse con la emulación del navegador.

## Probar paso a paso

1. Seleccionar **Sector norte**. Los controles muestran el borrador actual de `sim-zona-01`.
2. Cambiar temperatura, humedad u otra variable. Esto modifica solo ese punto; todavía no genera una captura.
3. Pulsar **Capturar valores actuales**. Aparece una fila en Bitácora local, con hora de Bogotá y etiqueta Simulada. Inspeccionar el JSON muestra las diez variables, fecha UTC y UUID nuevos.
4. Cambiar a **Sector sur** y comprobar que conserva sus propios valores. Los cuatro alias locales se pueden mapear a los nodos virtuales provisionados en Supabase mediante la sección de conexión.
5. Preparar **Calor y suelo seco**. Se calculan los valores de destino; el borrador actual permanece igual hasta avanzar.
6. Pulsar **Avanzar y capturar**. Cada pulsación avanza un paso de los doce y registra una captura. Al completar el destino el botón queda deshabilitado.
7. Preparar **Lluvia intensa**, elegir **Todos los puntos**, intervalo de 2 o 5 segundos e **Iniciar secuencia**. Cada inicio prepara una nueva transición desde los valores actuales de cada punto; termina automáticamente tras doce pasos. Cambiar de punto durante la secuencia solo cambia la vista.
8. Pulsar **Pausar secuencia**, editar un valor o pasar a otra pestaña: la generación automática se detiene. No se rellenan capturas durante una pausa.
9. Pulsar **Exportar sesión JSON** para guardar las capturas en un archivo. También se puede copiar la última captura o seleccionar su JSON.

La bitácora vive en memoria de **esta pestaña** y desaparece al recargar/cerrar. Conserva como máximo 300 capturas; si se supera, informa cuántas anteriores descartó y lo registra en el archivo exportado. Se muestran las últimas doce filas de todos los puntos. Exportar periódicamente evita perder el registro.

## Escenarios y repetición

| Escenario | Comportamiento de prueba |
|---|---|
| Referencia | Volver al conjunto inicial de valores sintéticos de la zona |
| Calor y suelo seco | Temperaturas y radiación mayores; humedades menores |
| Lluvia intensa | Más lluvia y humedad; menos radiación |
| Viento fuerte | Aumentar viento, llevando las otras variables a su referencia |
| Cambio de pH | Transición hacia un pH más ácido |
| Regreso a referencia | Llevar los valores actuales a la referencia del punto |

Referencia y Regreso a referencia comparten destino; no certifican normalidad ni recuperación del cultivo. La evolución es una interpolación de doce pasos para probar software, **no un modelo agronómico validado ni un pronóstico**. Los rangos de los controles delimitan la prueba; no son umbrales de alerta ni valores óptimos.

La misma semilla, estado inicial, escenario y sucesión de acciones generan los mismos valores. Las fechas y los UUID siempre son nuevos. **Aplicar y reiniciar zonas** reconstruye sus borradores y genera otra ejecución; mantiene las capturas previas con su identidad original. Solo semilla y cultivo de ejemplo se conservan como preferencias locales. Maíz, Yuca o Papa se usan como contexto del archivo: elegirlos no modifica valores ni aplica perfiles de reglas.

## Variables y semántica del archivo

| Código provisional | Unidad exportada | Significado |
|---|---|---|
| `temperatura_aire` | `°C` | Temperatura ambiental sintética |
| `humedad_aire` | `% HR` | Humedad relativa del aire |
| `iluminacion_relativa` | `% relativo` | Índice sintético, método `indice_relativo_sintetico_v1`; sin lectura ADC real |
| `radiacion_solar` | `W/m²` | Radiación independiente del índice del LDR |
| `humedad_suelo_vwc` | `% VWC` | Contenido volumétrico de agua, profundidad de referencia 20 cm |
| `temperatura_suelo` | `°C` | Temperatura a profundidad de referencia 20 cm |
| `ph_suelo` | `sin unidad` | pH sintético; no acredita análisis químico |
| `conductividad_suelo_ece` | `dS/m` | Referencia ECe de extracto de pasta saturada a 25 °C |
| `precipitacion_60min` | `mm` | Acumulado móvil de los 60 minutos previos a la captura |
| `velocidad_viento` | `m/s` | Velocidad sintética del viento |

Cada captura incluye `simulacion.ejecucion_id`, semilla, zona, nodo, cultivo de ejemplo, escenario, modo y paso. Los metadatos de lluvia conservan inicio/fin de ventana, periodo de 3600 segundos y `acumulados_no_sumables: true`: **no sumar los acumulados de capturas sucesivas**, porque sus ventanas se solapan.

El archivo de sesión tiene formato **`agrovigia.sesion-simulada.local.v1`**, contiene capturas **`agrovigia.simulacion.local.v1`**, y declara `destino: "archivo_local"`, `enviado_mqtt: false` y `persistido_supabase: false`.

## Integración pendiente

El modo local no envía mensajes. El arranque con **`-ConMqtt`** habilita envío manual de una captura reciente por pulsación; capturar, avanzar o iniciar escenarios sigue registrando solo en la bitácora hasta que se pulsa el botón de envío. No genera episodios ni consulta IA. Los archivos locales no son payloads compatibles con las RPC v1/v2; el adaptador construye v3 y el servidor usa el mapeo configurado.

Juan reporta correctas las verificaciones de las migraciones y del alta de cuatro zonas/nodos virtuales. Están preparados el [contrato v3](../docs/contrato-mqtt-v3-simulado.md), el adaptador puro `contrato-v3.mjs`, ACL/límite ampliados, API local protegida y [receptor 03f](../n8n/SIMULACION_ZONAS.md). Falta la comprobación manual remota del transporte; después se implementará la consulta explícita en web. Cultivo/zona autorizados se resuelven en servidor; el texto de contexto del panel no acredita propiedad. Los identificadores `sim-zona-01` a `04` son alias locales que se mapean a los códigos del catálogo.

Después de un intento manual, el archivo exportado añade el resultado de transporte de las capturas conservadas, `enviado_mqtt` según sus ACK y `persistido_supabase: null` (desconocido). No convierte un ACK en guardado. El mapeo vive en el servidor hasta reiniciarlo y se bloquea tras intentar un envío para conservar identidad/asignación en reintentos. No hay reenvío automático, sincronización de toda la bitácora ni cola durable.

Los ESP32 siguen con DHT22 y LDR; esta herramienta no añade sensores físicos. Las reglas preestablecidas por cultivo y las sugerencias IA se implementarán por separado, con fuente, contexto y versión.

## Verificación

```powershell
npm.cmd --prefix simulador test
npm.cmd --prefix simulador run test:browser
```

Las pruebas unitarias usan solo Node. La prueba de navegador reutiliza `playwright-core` ya instalado en `web/node_modules`, con Chrome/Edge local y un perfil propio; no usa la sesión personal del navegador ni llama servicios externos. Si no hay un ejecutable instalado en las rutas habituales, se puede definir `AGROVIGIA_CHROME`. Capturas de QA en `.local/qa-simulador/`, excluidas de Git. Los servidores de prueba se abren en puertos efímeros loopback y se cierran al finalizar.

`public/motor.mjs` concentra el catálogo y la generación pura. `public/app.mjs` controla interfaz/bitácora y `public/transporte.mjs` el envío manual. `server.mjs` sirve seis recursos públicos. Con `-ConMqtt` habilita únicamente los endpoints locales de estado/mapeo/publicación, protegidos por Host, mismo origen, token de instancia, tamaño y validación; no expone archivos privados ni escribe configuración a disco. `transporte-mqtt.mjs` usa el cliente Mosquitto ya instalado, sin shell ni claves en argv. La [guía de conexión](../n8n/SIMULACION_ZONAS.md) describe pruebas y límites.

## Valores prellenados por cultivo

El selector **Cultivo** del panel incluye Yuca, Plátano, Hortalizas de clima cálido, Mango, Papaya y Maracuyá. Al pulsar **Aplicar y reiniciar zonas**, cada punto arranca con valores de referencia de su plantilla (0009): el centro del rango óptimo de temperatura, humedad del aire y humedad del suelo, más la temperatura y el pH habituales del suelo, con la misma variación por punto que define la semilla. Después se puede ajustar a mano cualquier medición y preparar escenarios igual que antes; **Regreso a referencia** vuelve a los valores del cultivo elegido. Maíz y Papa no tienen plantilla y conservan los valores sintéticos genéricos. Son puntos de partida para probar, no recomendaciones agronómicas.

En Linux el envío MQTT del panel usa la librería `mqtt` en lugar de `mosquitto_pub.exe`, con el mismo contrato: QoS 1, MQTT v5, sin retain y PUBACK observado. Se inicia con `local/agrovigia.sh panel`.

## Servicio de simulación

`servicio.mjs` es el proceso que hace reaccionar a los nodos cuando en la web (vista Escenario) se activa un evento de clima o se ajusta la simulación a mano. Cada 5 s lee de Supabase, con la clave de servidor, la RPC `estado_simulacion()`: cultivos, rangos vigentes, clima activo, ajuste manual y nodos. Con eso publica:

- un lote v3 de diez variables por cada nodo virtual, con el intervalo configurado en ese nodo y al instante cuando cambia el clima o el ajuste de su cultivo;
- mientras hay un evento activo, o un ajuste manual de temperatura o humedad del aire, la proyección de cada nodo físico: su última lectura real más el efecto, como lote v2 de origen simulado (`agrovigia/v2/simulado/nodos/<codigo>/telemetria`). La lectura real no se toca y sin lectura real reciente no se proyecta nada.

Los valores de referencia de cada nodo virtual salen del centro del rango óptimo vigente de su cultivo (plantilla o ajuste propio), con el ciclo del día del Caribe y una variación fija por nodo. Un evento lleva los valores a su efecto en dos minutos y, al volver a normal, regresan en otros dos. Respeta la pausa de cada nodo. No escribe en Supabase: los datos entran por n8n (03f para v3 y 03e para la proyección v2 por MQTT; 03g para ambos por HTTP).

```bash
local/agrovigia.sh simular               # lee el estado de Supabase (SUPABASE_URL y SUPABASE_SECRET_KEY en .local/secretos.env)
node servicio.mjs --sondeo 10            # consultar cada 10 s
node servicio.mjs --estado archivo.json  # sin Supabase: estado desde un archivo (demostraciones y pruebas)
local/agrovigia.sh simular --http http://localhost:5678/webhook/agrovigia/telemetria   # por HTTP en lugar de MQTT
node servicio.mjs --puerto 10000         # además abre el servidor de salud
```

| Evento | Efecto de prueba (intensidad moderada, fuerte, extrema) |
|---|---|
| Lluvia fuerte | lluvia 8, 25 o 55 mm; sube la humedad del aire y del suelo; bajan temperatura, luz y radiación |
| Sol fuerte | temperatura +3, +6 o +9 °C; baja la humedad del aire y del suelo; radiación y luz altas |
| Tierra seca | humedad del suelo -6, -12 o -18 % VWC; baja algo la del aire; sube la temperatura del suelo |
| Viento fuerte | viento 8, 14 o 22 m/s; bajan un poco humedad y temperatura del aire |

Son efectos para ver reaccionar la plataforma, no un modelo agronómico ni meteorológico validado. En el contrato v3 cada lote se etiqueta con el escenario de Juan más cercano (`lluvia`, `calor-seco`, `viento`, `recuperacion`); el evento exacto queda en la tabla `clima_cultivo`.

### Ajuste manual

El agricultor puede sumar o restar a mano sobre lo que ya produce la simulación (RPC `ajustar_simulacion`, tabla `ajustes_simulacion`). Son deltas que se aplican **después** del evento de clima y sin transición:

| Clave | Rango del delta | Límite del valor resultante |
|---|---|---|
| `temperatura_aire` | -10 a 10 °C | -40 a 80 °C |
| `humedad_aire` | -30 a 30 % HR | 0 a 100 % HR |
| `humedad_suelo_vwc` | -30 a 30 % VWC | 0 a 80 % VWC |
| `ph_suelo` | -2 a 2 | 0 a 14 |
| `precipitacion_60min` | -50 a 50 mm | 0 a 200 mm |
| `velocidad_viento` | -10 a 15 m/s | 0 a 50 m/s |

En los nodos virtuales aplican las seis claves. En la proyección del nodo físico solo `temperatura_aire` y `humedad_aire`, que es lo que mide; un ajuste de pH, suelo, lluvia o viento no proyecta nada sobre el físico. Un lote con ajuste y sin evento se etiqueta como `referencia` en modo `manual`; el ajuste exacto queda en `ajustes_simulacion`.

### Publicar por HTTP (sin broker)

Con `--http <url>` o la variable `AGROVIGIA_INGESTA_URL` el servicio no se conecta a MQTT: envía cada lote con `POST` al webhook de n8n (flujo 03g, ver [n8n/INGESTA_HTTP.md](../n8n/INGESTA_HTTP.md)).

- Cabecera `X-AgroVigia-Clave` con el valor de `AGROVIGIA_INGESTA_CLAVE` (en local, si la variable no existe, lee `.local/ingesta-http/clave`).
- Cuerpo `{"topico":"<el mismo tópico MQTT>","payload":{...el mismo JSON del lote...}}`.
- 200 confirma. 400, 401, 403 y 404 son definitivos y no se reintentan. Sin respuesta, 408, 429 o 5xx se reintentan a los 2, 4 y 8 s con el mismo `mensaje_id`, y una captura de más de 300 s se descarta, igual que por MQTT.

### Servidor de salud

Con la variable `PORT` (la que define Render) o `--puerto N`, el servicio abre HTTP en ese puerto. `GET /` y `GET /salud` devuelven JSON con `estado` (`iniciando`, `activo` o `degradado`), `transporte`, `estado_desde`, `ciclos`, `ultimo_ciclo` (`en`, `publicados`, `error`), `lotes_publicados` y `lotes_fallidos`. No incluye claves ni direcciones.

### Variables de entorno

| Variable | Uso |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Leer `estado_simulacion()`. Obligatorias salvo con `--estado` |
| `AGROVIGIA_INGESTA_URL` | Dirección del webhook; activa el transporte HTTP |
| `AGROVIGIA_INGESTA_CLAVE` | Clave de la cabecera `X-AgroVigia-Clave` (mínimo 16 caracteres) |
| `PORT` | Puerto del servidor de salud |
| `AGROVIGIA_MQTT_URL`, `AGROVIGIA_MQTT_USUARIO`, `AGROVIGIA_MQTT_CLAVE` | Solo con transporte MQTT |

Para desplegarlo como servicio (por ejemplo en Render): directorio de trabajo en la raíz del repositorio, porque `clima-modelo.mjs` usa el validador de `n8n/`; instalación con `npm ci --prefix simulador` y arranque con `node simulador/servicio.mjs`. Ese despliegue no está probado.

Pruebas: `npm test` (motor y panel de Juan, modelo de clima, ajustes, ciclo del servicio, transporte HTTP contra un servidor local y servidor de salud), `npm run test:http` (solo lo de HTTP) y `npm run test:mqtt` (integración con el Mosquitto local: 17 lotes v3 y la proyección v2, y ACL).

## Reporte continuo desde el panel

Para que la plataforma reciba lo que simulas en el panel sin enviar captura por captura:

1. `local/agrovigia.sh mapa` deja en `.local/simulacion/nodos.json` los nodos virtuales y su `asignacion_version`, sin claves. Solo lo usa este panel; el servicio de simulación lee su estado directo de Supabase.
2. En el panel, elige el **Cultivo** (Yuca, Plátano u Hortalizas), pulsa **Aplicar y reiniciar zonas** y después **Cargar mapa del cultivo elegido**: toma los nodos 01 a 04 de ese cultivo, uno por sector, y los valida igual que si se pegara el JSON.
3. Marca **Enviar cada captura automáticamente**. Cada captura nueva, manual o de una secuencia, entra en una cola y se publica por MQTT en orden, sin pausar la secuencia. Desmarcarla detiene el envío.

Con n8n (03f) y Supabase configurados, cada captura se guarda, se evalúan las alertas de la plantilla y la base decide si corresponde una sugerencia de IA. En la web se ven llegar en Inicio > Zonas y nodos, Alertas (cada 30 s), IA (cada minuto), Red (cada 10 s), Dispositivos por sector (cada 30 s) e Historial con **Actualizar en vivo**. Como en el envío manual, cambiar el mapeo después de un envío requiere reiniciar el panel. Prueba: `npm run test:browser:auto`.
