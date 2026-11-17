# Ingesta por HTTP y sugerencias a petición (03g, 03h y 03i)

Dos flujos para desplegar AgroVigía donde no hay puerto MQTT público y solo se dispone de HTTP (por ejemplo Render). Conviven con 03e y 03f: el guardado es idempotente por `mensaje_id`, así que el mismo lote por MQTT y por HTTP no se duplica.

| Flujo | Archivo | Qué hace |
|---|---|---|
| 03g | `03g-ingesta-http.json` (`node generar-http.cjs`) | Webhook `POST /webhook/agrovigia/telemetria`. Valida, guarda, evalúa alertas y decide la sugerencia de IA igual que 03e (tópicos `agrovigia/v2/...`) y 03f (`agrovigia/v3/simulado/...`) |
| 03h | `03h-sugerencias-a-peticion.json` (`node generar-solicitudes.cjs`) | Cada 30 s atiende las solicitudes de `solicitudes_ia` que el agricultor registra desde la web (migración 0011) |
| 03i | `03i-ingesta-nodo-https.json` (`node generar-nodo.cjs`) | Webhook `POST /webhook/agrovigia/nodo` para lotes **reales** v2 de placas registradas por el agricultor, cada una con su propia clave (migración 0012). Misma ruta que 03e |

El código de los nodos Code sale de los mismos módulos que 03e y 03f (`codigo-ingesta.cjs`, `preparar-http.cjs`, `preparar-sugerencias.cjs`, `preparar-solicitudes.cjs`). Si cambias un módulo, vuelve a generar los flujos.

## Usar el webhook

Cabecera obligatoria: `X-AgroVigia-Clave`. Cuerpo JSON con dos campos: `topico` (el mismo tópico MQTT) y `payload` (el mismo JSON del lote; también se admite su texto exacto).

```bash
curl -sS -X POST "https://TU-N8N.example.com/webhook/agrovigia/telemetria" \
  -H "Content-Type: application/json" \
  -H "X-AgroVigia-Clave: $AGROVIGIA_INGESTA_CLAVE" \
  -d '{"topico":"agrovigia/v3/simulado/nodos/sim-52ea4628c470-01/telemetria","payload":{"version":3,"nodo_codigo":"sim-52ea4628c470-01","...":"resto del lote v3"}}'
```

En local la dirección es `http://localhost:5678/webhook/agrovigia/telemetria` y la clave está en `.local/ingesta-http/clave` (la genera `local/agrovigia.sh configurar-n8n`; no la copies a ningún archivo del repositorio).

| Respuesta | Cuerpo | Significado |
|---|---|---|
| 200 | `{"estado":"insertado","codigo":"..."}` o `{"estado":"duplicado","codigo":"..."}` | Guardado confirmado por Supabase, o lote idéntico ya guardado |
| 400 | `{"estado":"rechazado","codigo":"..."}` o `{"estado":"conflicto_id","codigo":"..."}` | Lote inválido o rechazado por la base. No reintentar |
| 403 | texto `Authorization data is wrong!` | Falta la cabecera o la clave no coincide. Lo responde el nodo Webhook de n8n antes de ejecutar el flujo |
| 503 | `{"estado":"pendiente","codigo":"RPC_SIN_CONFIRMACION"}` | Supabase no confirmó el guardado. Reintentar el mismo lote |

Códigos propios del webhook: `CUERPO_HTTP_INVALIDO`, `TOPICO_NO_ADMITIDO`, `PAYLOAD_DEBE_SER_OBJETO` y `ORIGEN_REAL_NO_ADMITIDO_POR_HTTP`. El resto son los de los validadores v2 y v3 y los de las RPC (`NODO_PAUSADO`, `ASIGNACION_CAMBIO`, `VENTANA_TEMPORAL`...).

La respuesta sale apenas se conoce el guardado. Las alertas y la sugerencia de IA se procesan después, dentro de la misma ejecución, y un fallo en ellas no cambia la respuesta.

### Origen real y simulado

Por MQTT el broker separa los orígenes con usuarios y permisos por tópico. Por HTTP hay una sola clave compartida, así que el flujo **solo admite tópicos simulados** (`agrovigia/v2/simulado/...` y `agrovigia/v3/simulado/...`). Un tópico `agrovigia/v2/real/...` se rechaza con `ORIGEN_REAL_NO_ADMITIDO_POR_HTTP`. Para abrirlo de forma expresa (por ejemplo, un puente propio que reenvía el nodo físico), define `AGROVIGIA_INGESTA_ADMITE_REAL=si` al preparar los flujos, o cambia `http_admite_real` a `si` en el nodo **Proyecto Supabase**. Quien tenga la clave podrá entonces escribir datos marcados como reales: úsalo solo con una clave que no comparta el simulador.

### Historial de ejecuciones

03g y 03h no guardan las ejecuciones correctas: son muchas (una por lote, y una cada 30 s) y la de 03g incluiría la cabecera con la clave. Las ejecuciones con error sí se guardan. El resultado de cada lote está en la respuesta HTTP y en Supabase; el de cada solicitud, en `solicitudes_ia` y `sugerencias_ia`.

## Nodos físicos por HTTPS con clave propia (03i)

Para una placa que el agricultor registró desde la web (`registrar_nodo_fisico`). No usa la clave compartida de 03g: cada nodo tiene la suya, que se muestra una sola vez al registrarlo o al regenerarla. En la base solo se guarda su hash.

Cabeceras: `X-AgroVigia-Nodo` (código del nodo) y `X-AgroVigia-Clave` (clave de ese nodo). El cuerpo es el mismo JSON v2 que el firmware publica por MQTT, sin envoltura.

```bash
curl -sS -X POST "https://TU-N8N.example.com/webhook/agrovigia/nodo" \
  -H "Content-Type: application/json" \
  -H "X-AgroVigia-Nodo: agv-esp4c1d-27" \
  -H "X-AgroVigia-Clave: $CLAVE_DEL_NODO" \
  -d '{"version":2,"nodo_codigo":"agv-esp4c1d-27","mensaje_id":"<uuid v4 nuevo>","origen":"real","tomada_en":"2026-11-16T15:00:00Z","mediciones":[{"variable_codigo":"temperatura_aire","valor":29.3,"unidad":"°C"},{"variable_codigo":"humedad_aire","valor":61.5,"unidad":"% HR"},{"variable_codigo":"iluminacion_relativa","valor":73.3,"unidad":"% relativo"}],"ldr":{"metodo":"adc12_10k_11db_v1","adc_promedio":3000}}'
```

| Respuesta | Cuerpo | Significado |
|---|---|---|
| 200 | `{"estado":"insertado" o "duplicado","codigo":"...","intervalo_segundos":60,"pausado":false}` | Guardado confirmado. `intervalo_segundos` y `pausado` son los del nodo, para que el firmware se adapte |
| 400 | `{"estado":"rechazado","codigo":"...","intervalo_segundos":...,"pausado":...}` | Lote inválido o rechazado por la base (por ejemplo `NODO_PAUSADO`, `NODO_NO_COINCIDE`, `SOLO_ORIGEN_REAL`, `CAPACIDAD_NODO`). No reintentar ese lote |
| 401 | `{"estado":"rechazado","codigo":"CLAVE_INVALIDA"}` | Faltan cabeceras o la clave no corresponde. La respuesta es la misma si el nodo no existe |
| 503 | `{"estado":"pendiente","codigo":"AUTENTICACION_NO_CONFIRMADA" o "RPC_SIN_CONFIRMACION", ...}` | La base no confirmó. Reintentar el mismo lote |

Cómo funciona: el flujo llama `autenticar_nodo(codigo, clave)` (solo la clave de servidor puede ejecutarla), arma el tópico `agrovigia/v2/real/nodos/<codigo>/telemetria` y sigue con la validación, el guardado, las alertas y la IA de 03e. La clave de un nodo solo sirve para escribir datos reales de ese mismo nodo: un cuerpo con otro `nodo_codigo` o con `origen` distinto de `real` se rechaza.

El código del nodo cumple el patrón del contrato v2 (`agv-<letras y dígitos>-<dos dígitos>`). El lote v2 exige las tres mediciones, así que un nodo registrado solo con DHT22 o solo con LDR recibe `CAPACIDAD_NODO`. No hay bloqueo por intentos fallidos: la clave tiene 256 bits y un bloqueo por código dejaría que cualquiera que conozca un código dejara sin servicio a esa placa; la base cuenta los fallos y guarda el último uso.

El nodo `agv-dht22-01` no tiene clave y sigue entrando por MQTT. Usar este webhook con HTTP sin cifrar fuera de una red privada expone la clave del nodo.

## Sugerencias a petición (03h)

1. La web llama `solicitar_sugerencia_ia(cultivo, origen)` y queda una fila `pendiente`.
2. El flujo llama `tomar_solicitudes_ia` (hasta 3 por vuelta) y, por cada una, `preparar_solicitud_ia`: la base arma el mismo contexto de la reserva automática con el último lote de ese origen, incluidos `clima_simulado` y `ajustes_manuales`.
3. Con reserva, consulta a Gemini con la misma instrucción y el mismo esquema que la rama automática y guarda con `completar_solicitud_ia`, que deja la solicitud `atendida` o `error` en una sola transacción.
4. Sin lote reciente la base la cierra como `sin_datos`; con el tope diario agotado, como `rechazada`. En esos casos no se consulta a Gemini.

Si n8n se cae a mitad, la base devuelve la solicitud a `pendiente` a los 5 minutos y, si vuelve a caerse, la cierra como `error`.

## Importar

En local: `local/agrovigia.sh configurar-n8n` importa y publica 03e, 03f, 03g, 03h y 03i con sus credenciales (MQTT, Supabase, Gemini y la cabecera de ingesta). 03i no lleva credencial en su webhook.

A mano: importa el archivo, asigna en **Webhook ingesta** una credencial Header Auth con nombre `X-AgroVigia-Clave`, la `apikey` privada de Supabase en los nodos HTTP de Supabase y `x-goog-api-key` en **Consultar Gemini**, y escribe `supabase_url` y `gemini_modelo` en **Proyecto Supabase**.

## Contenedor sin disco persistente (Render)

`local/render/n8n.Dockerfile` construye una imagen de n8n 2.44.7 con los cuatro flujos y `local/render/arranque-n8n.sh`, que en cada inicio importa credenciales y flujos por línea de comandos (`n8n import:credentials`, `n8n import:workflow`, `n8n publish:workflow`) y después ejecuta `n8n start`. Sin `AGROVIGIA_MQTT_HOST` importa solo 03g, 03h y 03i.

Variables del contenedor de n8n:

| Variable | Uso |
|---|---|
| `SUPABASE_URL` | `https://<proyecto>.supabase.co` |
| `SUPABASE_SECRET_KEY` | Secret key `sb_secret_...` (credencial `apikey` de los nodos de Supabase) |
| `GEMINI_API_KEY` | Credencial `x-goog-api-key` |
| `AGROVIGIA_INGESTA_CLAVE` | Clave de la cabecera `X-AgroVigia-Clave`, mínimo 16 caracteres. La misma que usa el servicio de simulación |
| `GEMINI_MODELO` | Opcional. Por defecto `gemini-3.5-flash-lite` |
| `AGROVIGIA_INGESTA_ADMITE_REAL` | Opcional. `si` abre el origen real por HTTP |
| `AGROVIGIA_MQTT_HOST`, `AGROVIGIA_MQTT_PUERTO`, `AGROVIGIA_MQTT_USUARIO`, `AGROVIGIA_MQTT_CLAVE` | Opcionales. Solo si hay un broker alcanzable: importan también 03e y 03f |
| `N8N_PORT`, `N8N_PROTOCOL`, `N8N_HOST`, `WEBHOOK_URL` | Propias de n8n: puerto que escucha, `https`, nombre público y dirección pública de los webhooks |
| `N8N_ENCRYPTION_KEY` | Propia de n8n. Fíjala si el contenedor llega a tener disco persistente |

La imagen ya define `N8N_BLOCK_ENV_ACCESS_IN_NODE=true`: los nodos no pueden leer estas variables; las claves viven solo en las credenciales cifradas de n8n.

## Qué está comprobado

- `node --test` en esta carpeta: lógica de 03g y 03h y su código incrustado ejecutado en un contexto aislado.
- En un contenedor local de n8n 2.44.7 sin red, con claves ficticias: el arranque importó 3 credenciales y publicó 03g y 03h; el webhook respondió 403 sin clave o con clave incorrecta, 400 con su código ante lotes inválidos y ante el origen real, y 503 con un lote válido cuando Supabase no era alcanzable. El servicio de simulación publicó contra ese webhook por HTTP.
- 03i en ese mismo tipo de contenedor: importado y publicado por línea de comandos; sin cabeceras, con clave corta o con código de nodo virtual respondió 401 con su JSON, y con cabeceras válidas y la base inalcanzable, 503. La autenticación, el registro y el guardado del lote real están probados contra PostgreSQL en memoria (`supabase/tests/terreno-nodos.test.mjs`), no contra Supabase.
- No está probado: el guardado real (respuesta 200), las alertas y la IA por esta ruta contra Supabase y Gemini, la ejecución de 03h contra la base real, ni el despliegue en Render.
