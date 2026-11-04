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
