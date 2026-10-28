# Contrato MQTT v1 — AgroVigía

Estado vigente: ampliacion combinada escrita y probada localmente en [contrato-mqtt-v2.md](contrato-mqtt-v2.md). V1 se conserva para el recorrido anterior; la aplicacion remota de v2 sigue pendiente.

Aclaracion de arquitectura (26 de octubre de 2026): Juan define dos placas equivalentes, cada una con DHT22 y LDR, para comparar ubicaciones. El contrato de perfiles separados que sigue documenta el recorrido actual; NO habilita todavia un mensaje combinado de tres variables. Pendiente definir y probar la ampliacion coordinada de esquema/validador, identidad/ACL, catalogo, RPC, firmware y web. Se conserva el codigo del nodo que ya publica hasta preparar esa migracion; un sensor nuevo no debe declararse como otro nodo fisico de la misma placa. Escala LDR y referencias entre placas por documentar, sin presentar valores como lux.

Versión de trabajo definida el 25 de octubre de 2026 para implementar las etapas 2 y 3 en paralelo. Describe requisitos; no acredita mensajes publicados, sensores probados ni persistencia ejecutada. Juan y Camilo deben revisar juntos esta base antes de integrar. Las decisiones provisionales y los bloqueos se indican al final.

## 1. Tópicos e identidad

```text
agrovigia/v1/{origen}/nodos/{nodo_codigo}/telemetria
```

| Elemento | Regla v1 |
|---|---|
| `origen` | `real` o `simulado`, en minúsculas |
| `nodo_codigo` | Código estable de `nodos.codigo`, patrón `^agv-[a-z0-9]+-[0-9]{2}$` |
| Nodo DHT22 previsto | `agv-dht22-01`: solo `temperatura_aire` y `humedad_aire` |
| Nodo LDR previsto | `agv-ldr-01`: solo `iluminacion_relativa` |
| Suscripción de recepción | `agrovigia/v1/+/nodos/+/telemetria`; cada mensaje sigue sujeto a validación y autorización |

Ejemplo para Camilo: `agrovigia/v1/simulado/nodos/agv-dht22-01/telemetria`. El futuro ESP32 usará `agrovigia/v1/real/nodos/agv-dht22-01/telemetria`. No incluir cuenta, cultivo, datos personales ni credenciales en el tópico. La vinculación al cultivo se resuelve en el servidor.

Los códigos son nombres propuestos para el alta previa, no nodos ya registrados. `nodo_codigo` no es el UUID `nodos.id`: el receptor resuelve uno a otro. El broker deberá autenticar cada publicador y limitar mediante ACL su escritura al tópico exacto autorizado. El simulador tendrá credenciales distintas, sin permiso para publicar en `real`; cada ESP32 solo podrá publicar en su tópico `real`. n8n tendrá permisos de lectura necesarios. El texto `origen` del JSON por sí solo no demuestra procedencia.

Antes de aceptar tráfico hay que probar estas ACL: el receptor MQTT puede no exponer el usuario publicador. En ese caso se confía en la ACL verificada del broker, nunca en una identidad declarada por el mensaje. Si esa separación no puede garantizarse, la integración queda bloqueada. No se admiten acceso anónimo ni comodines en tópicos de publicación.

## 2. JSON y variables

Payload: un objeto JSON UTF-8 de hasta 2048 bytes, sin BOM, claves repetidas, comentarios, campos adicionales ni valores no finitos. El esquema [telemetria.schema.json](mqtt/telemetria.schema.json) valida la forma del payload; no sustituye las comprobaciones de tópico, permisos, reloj, duplicados y catálogo descritas aquí.

```json
{
  "version": 1,
  "nodo_codigo": "agv-dht22-01",
  "mensaje_id": "11111111-1111-4111-8111-111111111111",
  "origen": "simulado",
  "tomada_en": "2026-10-25T14:00:00Z",
  "mediciones": [
    {"variable_codigo": "temperatura_aire", "valor": 28.5, "unidad": "°C"},
    {"variable_codigo": "humedad_aire", "valor": 72, "unidad": "% HR"}
  ]
}
```

Todos los campos mostrados son obligatorios. `version` es el entero `1`; versiones distintas se rechazan. `mensaje_id` es un UUID v4 canónico en minúsculas, nuevo para cada captura, generado con aleatoriedad adecuada también tras reiniciar. No usar únicamente contador, hora o identificador de paquete MQTT. No debe repetirse entre orígenes de un mismo nodo.

`tomada_en` es la fecha común de captura del lote, con reloj sincronizado, formato exacto `YYYY-MM-DDTHH:mm:ssZ`, UTC y fecha de calendario existente. No se aceptan fecha local, offset, milisegundos, `null` ni una fecha inventada al arrancar. La presentación puede convertirla a `America/Bogota`.

| Perfil | Contenido completo obligatorio | Unidad literal | Rango inclusivo v1 |
|---|---|---|---|
| DHT22 | `temperatura_aire` | `°C` | -40 a 80 |
| DHT22 | `humedad_aire` | `% HR` | 0 a 100 |
| LDR | `iluminacion_relativa` | `% relativo` | 0 a 100 |

`valor` es un número JSON, nunca texto ni booleano, con hasta cuatro decimales para `numeric(12,4)`. Los límites son controles de admisibilidad, no umbrales agronómicos ni prueba de exactitud del sensor. El límite de temperatura es una decisión provisional del contrato; el catálogo SQL de referencia aún tiene límites NULL para ella. Habrá que alinear el catálogo durante su revisión, sin modificar ahora la referencia.

El DHT22 envía exactamente dos variables, sin importar su orden. El LDR envía exactamente una. No se repiten variables. Cada variable debe estar habilitada en `nodo_variables` para ese nodo. Si falla una lectura del DHT22 se descarta ese ciclo completo: no publicar cero, `NaN`, `null`, la última lectura ni un lote parcial como nuevo. Registrar el fallo localmente; un canal de diagnóstico queda fuera de v1. No se deduce la causa de ausencia de mensajes en la web.

Para iluminación, 0 significará menor iluminación y 100 mayor iluminación dentro de las referencias del circuito. **La publicación real del LDR está bloqueada hasta documentar y comprobar circuito, polaridad, referencias y conversión.** No basta dividir el ADC por su máximo sin verificar la dirección y la escala. Los ejemplos LDR solo prueban la forma y usan valores inventados; no validan conversión ni expresan lux.

No se envían `cultivo_id`, `agricultor_id`, UUID de base de datos, `recibida_en` ni claves. El receptor asigna estos datos según el registro autorizado. No se agregan sensores o perfiles cambiando silenciosamente v1.

## 3. Transporte, reloj y reintentos

### Precision de recepcion en la demostracion 03b (decision de implementacion)

El flujo 03b usa como recibida_en el inicio de su primer Code de validacion en
la ejecucion MQTT automatica. Es una aproximacion de recepcion de aplicacion,
no la hora exacta del broker/callback. El Trigger oficial instalado no entrega
ese timestamp. Se conserva este valor en todos los intentos HTTP; no cambia
la captura. Las ventanas temporales se evaluan frente a esta aproximacion,
y una cola larga puede causar rechazo. No usar ejecuciones manuales aisladas
con datos antiguos como evidencia de recepcion reciente. El flujo 03a de
inspeccion sigue sin asignar recibida_en.

Esta decision explicita actualiza para 03b la asignacion al entrar mencionada
abajo. Fuente y limites se documentan en n8n/INGESTA_SUPABASE.md. No se afirma
precision de red ni latencia MQTT. Si se incorporan receptores con otra fuente
temporal, registrar procedencia por fila antes de mezclar precisiones.


Base provisional para la demostración: MQTT 3.1.1, publicación y suscripción QoS 1, `retain=false`, sesión limpia y sin cola histórica fuera de línea. Un mensaje entregado con indicador retained se rechaza; la configuración deberá impedir también que publicadores dejen telemetría retenida. QoS 1 permite duplicados y no garantiza escritura en Supabase. PUBACK solo confirma el tramo MQTT; v1 no incluye confirmación de aplicación.

Tomar una muestra cada 60 segundos por nodo. Ante fallo de publicación, conservar el mismo payload e ID y realizar hasta tres reintentos de aplicación con esperas de 2, 4 y 8 segundos. Las retransmisiones de MQTT también conservan el mensaje lógico. Pasada una ventana de 300 segundos desde la captura, abandonar el lote y registrar el fallo; no acumularlo para la siguiente reconexión. Una captura nueva siempre tiene un ID nuevo. Ajustar límites de retransmisión de la biblioteca en la etapa 2 y probar que no introduce una cola persistente inesperada.

Sin sincronización de reloj no hay telemetría válida: esperar a sincronizar antes de capturar. Comprobar que no haya retrocesos o pérdida de validez; no sustituir `tomada_en` por recepción. El servidor también debe tener reloj fiable. Para un mensaje nuevo se acepta:

```text
recibida_en - 300 segundos <= tomada_en <= recibida_en + 120 segundos
```

Los extremos se incluyen. Una captura demasiado antigua o futura se rechaza con motivo de reloj/antigüedad, sin atribuir una causa física. `recibida_en` la fija n8n al entrar el mensaje y la conserva al reintentar persistencia; no se toma del payload ni se recalcula en cada intento de base de datos. Por ello la futura operación de almacenamiento deberá recibirla explícitamente; el `DEFAULT now()` del SQL propuesto no basta para representar la entrada en n8n si hay demora.

Con intervalo de 60 s, usar provisionalmente 180 s sin recepción nueva válida como indicador de datos desactualizados. Mostrar también la edad de la captura. Un duplicado no renueva ninguna de esas fechas. Esto no indica desconexión demostrada ni estado saludable. Los mensajes fuera de orden que cumplen la ventana pueden guardarse, pero una captura anterior no reemplaza la más reciente ni retrocede el estado de las alertas; su tratamiento transaccional se implementará en etapas 3 y 7.

## 4. Validación y persistencia que implementará Camilo

1. Fijar `recibida_en`; comprobar tamaño, UTF-8, JSON estricto y esquema. Rechazar lote completo si falla cualquier observación.
2. Comprobar tópico exacto, versión, origen y código coincidentes con payload; canal autorizado por ACL verificada. Resolver nodo conocido y capacidades. Mantener un registro de rechazo con motivo y datos mínimos, separado de `mediciones`, sin credenciales.
3. Buscar por `(nodo_id, mensaje_id)` antes de volver a insertar o aplicar la vinculación actual. Si existe un lote confirmado idéntico, devolver resultado lógico `duplicado`, sin escrituras ni reglas. Comparar origen, fecha, conjunto completo de variables y valores; el orden del array y el espaciado JSON no importan. Unidad ya debe coincidir con el catálogo. La revocación de permisos sigue impidiendo aceptar mensajes, incluso duplicados.
4. Si el ID existente trae otro contenido, origen, fecha o conjunto de variables, rechazar como `conflicto_id`, sin actualizar ni completar filas. Un lote parcial previamente almacenado también es inconsistente, no un duplicado válido. La clave única de referencia no incluye origen: los IDs reales y simulados deben ser distintos.
5. Para mensajes nuevos, exigir nodo habilitado, vinculado a un cultivo de su misma cuenta, perfil correcto, reloj dentro de ventana y escala LDR real aprobada. Rechazar nodos sin vínculo; no crear cultivos, cuentas ni capacidades a partir del payload.
6. En una operación transaccional, bloquear/comprobar la vinculación vigente, resolver cultivo y guardar todas las variables o ninguna. Guardar `nodo_id`, `variable_codigo`, `mensaje_id`, `valor`, `tomada_en`, `recibida_en`, `origen` y cultivo histórico. Dos filas para DHT22; una para LDR. Obtener unidad de `variables` tras compararla con la recibida. Conservar las fechas y cultivo originales de lotes ya guardados.
7. La restricción `UNIQUE (nodo_id, mensaje_id, variable_codigo)` evita repetir filas, pero no basta para atomicidad o conflictos de lote. Ante carreras, el receptor debe volver a consultar y comparar el lote ganador; nunca usar un upsert que reescriba mediciones. Un fallo de Supabase exige reintento interno con el mismo lote y fecha de recepción, sin marcarlo como almacenado antes del commit. Su cola y recuperación siguen por implementar.
8. Solo tras commit se podrán evaluar reglas, de forma idempotente y separada por origen. Nunca activar reglas por rechazo, conflicto, duplicado o falta de mensajes. Revisión y cierre de alertas continúan siendo estados independientes.

El cultivo histórico se asigna al recibirse/aceptarse la lectura según la vinculación comprobada en la transacción, no según un cultivo declarado por firmware. Antes de cambiar la vinculación de un nodo, pausar publicación y drenar reintentos/recepción; v1 no transporta el cultivo de captura ni permite reconstruir un vínculo pasado. Si se necesitan transferencias con mensajes pendientes habrá que ampliar este protocolo. Una repetición ya confirmada se reconoce antes de consultar el nuevo cultivo, sin trasladar su historial.

Simulados y reales podrán coexistir únicamente con procedencia controlada y filtros explícitos en consultas, estadísticas, alertas y evidencias de IA. El modo normal de la web mostrará reales; cualquier modo de simulación deberá identificarse. Un ejemplo con `origen=simulado` jamás se transforma en real para demostrar hardware.

## 5. Ejemplos y comprobación sin servicios

Los archivos de [mqtt/ejemplos](mqtt/ejemplos) son payloads copiables. **Todos los números son inventados.** Incluso `dht22-real-formato.json` solo ilustra el formato de una futura lectura real y no debe reproducirse como evidencia real. Para probar la recepción se usan los payloads simulados. Las fechas son fijas para comprobaciones reproducibles: no sirven como mensajes nuevos en una prueba posterior sin actualizar la captura e ID desde el simulador.

[casos.json](mqtt/casos.json) relaciona archivo, tópico, contexto de prueba y resultado esperado. `esquema_valido` solo cubre la forma; `resultado` incluye las reglas de recepción. El contexto describe un registro/estado ficticio, no aprovisionamiento ejecutado. `validar_json` indica si el archivo siquiera se puede parsear.

Desde la raíz, PowerShell 7 ya disponible permite verificar el esquema sin instalar paquetes:

```powershell
$schema = Join-Path $PWD 'docs/mqtt/telemetria.schema.json'
$casos = Get-Content -Raw -Encoding utf8 docs/mqtt/casos.json | ConvertFrom-Json
$fallos = @()
foreach ($caso in $casos) {
    $ruta = Join-Path $PWD ('docs/mqtt/ejemplos/' + $caso.archivo)
    $valido = Test-Json -Json (Get-Content -Raw -Encoding utf8 $ruta) -SchemaFile $schema -ErrorAction SilentlyContinue
    if ($valido -ne $caso.esquema_valido) { $fallos += $caso.id }
}
if ($fallos.Count) { throw ('Resultados distintos: ' + ($fallos -join ', ')) }
'Todos los casos coinciden con su expectativa de esquema.'
```

Esto no ejecuta los controles semánticos ni la recepción. Juan debe revisar campos, ID estable en reintento, perfiles y reloj; Camilo puede usar los mismos archivos y contextos como criterios de aceptación del futuro flujo. En las etapas 2 y 3 se deberá comprobar también:

| Prueba futura | Resultado exigido |
|---|---|
| DHT22 simulado válido | Dos filas con mismo ID y fechas, origen simulado |
| LDR simulado válido | Una fila; no temperatura ni humedad |
| Repetición exacta y dos entregas concurrentes | Solo un lote, sin repetir reglas |
| ID repetido con otro valor o perfil | Conflicto; lote previo intacto |
| Error en una de dos variables | Cero filas nuevas |
| Reintento tras commit y cambio de cultivo | Duplicado histórico, sin reasignación |
| Broker sin permiso, publicación cruzada o simulador hacia real | Denegado por ACL, aunque JSON sea válido |
| Nodo desconocido, deshabilitado o sin cultivo | Rechazo, sin alta automática |
| Fecha futura, antigua o inexistente | Rechazo, sin sustituir captura |
| LDR real sin conversión aprobada | Rechazo aunque pase esquema |
| Caída de almacenamiento y reintento | Sin lote parcial ni pérdida silenciosa; recepción original conservada |
| Retained, reconexión y ausencia de muestras | Sin insertar capturas retenidas; antigüedad visible sin inventar causa |
| Captura anterior recibida después | Histórico permitido dentro de ventana, estado actual no retrocede |
| Consultas de cuentas y orígenes diferentes | RLS por cuenta y separación real/simulado verificadas |

## 6. Trabajo en paralelo y decisiones abiertas

| Responsable | Puede preparar con esta versión | Condición antes de integrar |
|---|---|---|
| Juan | Serialización DHT22, UUID por captura, sincronización y publicación del perfil | Elegir herramientas, placas y pines; probar físicamente sensor, reloj, ACL y MQTT |
| Camilo | Diseño del receptor con fixtures, mapeo al modelo y operación transaccional idempotente | Revisar SQL, origen autorizado, `recibida_en`, concurrencia, recuperación y RLS; no asumir referencia ejecutada |
| Ambos | Revisar contrato y criterios de aceptación | Confirmar base v1, parámetros provisionales y cambios coordinados |

Quedan pendientes el método de sincronización y generación UUID en firmware; credenciales de dispositivo, ACL, TLS y ubicación del broker/n8n; configuración de sesiones/reintentos; revisión de los parámetros provisionales (60/180/300/120 s, QoS 1, 2048 bytes y límites de temperatura); circuito y conversión LDR; almacenamiento de rechazos y recuperación n8n; coordinación para mover nodos; proyectos de demostración y umbrales agronómicos. No exponer MQTT ni credenciales sobre Internet sin definir y comprobar protección de transporte. No se fija alojamiento de producción.

Cambiar nombres, unidades, perfiles o semántica exige actualizar a la vez contrato, esquema, ejemplos y consumidores. Un cambio incompatible usa otra versión de tópico y payload. Este documento complementa [arquitectura-y-alcance.md](arquitectura-y-alcance.md); no incorpora backend adicional, predicción numérica ni cambios a las referencias originales.
