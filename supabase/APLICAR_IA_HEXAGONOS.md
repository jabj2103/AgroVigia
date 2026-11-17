# Aplicar 0009, 0010 y 0011: cultivos, clima, dispositivos, IA, estado en vivo, ajuste manual y solicitudes

Requiere 0001 a 0008 aplicadas, incluidas las zonas y la ingesta simulada v3 de Juan ([APLICAR_ZONAS_SIMULADAS.md](APLICAR_ZONAS_SIMULADAS.md)). No cambia mediciones, reglas reales ni vínculos existentes.

En Linux: `local/agrovigia.sh migrar` (usa `SUPABASE_DB_URL` de `.local/secretos.env`). Hace, en orden:

1. Comprueba que existan las zonas y `registrar_lote_simulado_v3`; si faltan, se detiene.
2. Aplica `202611030009_cultivos_clima_dispositivos.sql`, `202611030010_ia_red_simulacion.sql` y `202611030011_simulacion_manual_y_solicitudes.sql` si todavía no están.
3. Ejecuta `provisionar-hexagonos.sql` (idempotente).
4. Muestra `verificar-ia-hexagonos.sql`: **todas las columnas true**.

Desde el SQL Editor se puede hacer lo mismo pegando los cinco archivos SQL en ese orden.

## Los tres hexágonos

| Hexágono | Cultivo | Nodos |
|---|---|---|
| Plátano | el cultivo **real** de `agv-dht22-01` (recibe la plantilla plátano solo si no tenía) | `agv-dht22-01` + los 4 virtuales de `provisionar-simulacion.sql` + `sim-<cultivo>-05` |
| Yuca | `Simulado · Yuca` | `sim-<cultivo>-01` a `06` |
| Hortalizas | `Simulado · Hortalizas de clima cálido` | `sim-<cultivo>-01` a `06` |

Cada cultivo tiene los cuatro sectores del croquis de Juan. Los nodos 01 a 04 van al centro de cada sector y el 05 y el 06 a un segundo punto en los sectores norte y sur. Todos los virtuales tienen las diez capacidades `SIMULADOR_V3`. Las reglas que crea el aprovisionamiento son de origen simulado. Las reglas reales del plátano las decide el agricultor.

## 0009: configuración del cultivo y de los dispositivos

| Objeto | Para qué |
|---|---|
| `cultivo_plantillas`, `cultivos.plantilla_codigo`, `aplicar_plantilla_cultivo` | Catálogo de seis cultivos con rangos orientativos de aire y de humedad del suelo |
| `cultivo_parametros`, `ajustar_parametros_cultivo`, `restablecer_parametros_cultivo` | Ajuste propio de los doce rangos de un cultivo. Si existe, sustituye a la plantilla en reglas, IA, historial y simulación |
| `parametros_efectivos(cultivo)` | Rangos vigentes: el ajuste propio o la plantilla |
| `clima_cultivo`, `establecer_clima` | Evento de clima de prueba (lluvia, sol fuerte, tierra seca, viento; intensidad 1 a 3) por cultivo o para todos los de la cuenta, con historial |
| `tipos_dispositivo`, columnas nuevas de `nodos`, `configurar_dispositivo` | Tipo de equipo (ESP32, Arduino Uno, Raspberry Pi, virtual), protocolo e intervalo esperado, en modo automático o manual |
| `nodos.recepcion_pausada`, `pausar_nodo`, trigger `a_recepcion_pausada` | El agricultor desconecta un nodo del servicio: las tres RPC de ingesta rechazan sus lotes con `NODO_PAUSADO` |
| `preferencias_usuario`, `guardar_preferencias` | Ajustes de la web por cuenta |

Solo el firmware ESP32 del repositorio está probado. Arduino Uno y Raspberry Pi son perfiles de configuración (`probado = false`): describen cómo llegaría ese equipo al broker y qué intervalo se espera, no acreditan hardware probado.

## 0010: IA, estado en vivo y simulación

| Objeto | Para qué |
|---|---|
| `sugerencias_ia`, `sugerencia_mediciones`, `reservar_sugerencia_ia`, `completar_sugerencia_ia` | Sugerencias de Gemini con control de gasto en la base. El contexto usa los rangos vigentes e incluye el clima simulado activo |
| `estado_red_nodos()` | Vista Escenario: último lote, dispositivo, pausa, clima y, en un físico con evento activo, su proyección simulada. `SECURITY INVOKER`, respeta RLS |
| `estado_simulacion()` | Solo `service_role`: lo lee el servicio de simulación |
| Publicación `supabase_realtime` | Agrega `mediciones`, `nodos`, `clima_cultivo` y `alertas` para el tiempo real de la web (solo si la publicación existe) |

## 0011: ajuste manual, sugerencias a petición y nodos virtuales

| Objeto | Para qué |
|---|---|
| `ajustes_simulacion`, `ajustar_simulacion(cultivo, ajustes, todos)` | Deltas de prueba que el agricultor suma a la simulación de un cultivo o de todos, con historial. Seis claves: `temperatura_aire` (-10 a 10), `humedad_aire` (-30 a 30), `humedad_suelo_vwc` (-30 a 30), `ph_suelo` (-2 a 2), `precipitacion_60min` (-50 a 50) y `velocidad_viento` (-10 a 15). Un objeto vacío vuelve a automático |
| `solicitudes_ia`, `solicitar_sugerencia_ia(cultivo, origen)` | El agricultor pide una sugerencia de IA. Una sola abierta por cultivo y origen y 60 s entre peticiones |
| `tomar_solicitudes_ia`, `preparar_solicitud_ia`, `completar_solicitud_ia`, `cerrar_solicitud_ia` | Solo `service_role`: las usa el flujo 03h de n8n. Respetan el tope diario de gasto, sin exigir alerta nueva ni el intervalo de las automáticas |
| `crear_nodo_virtual(cultivo, zona)`, `retirar_nodo_virtual(nodo)` | El agricultor agrega un nodo virtual a su cultivo (crea los cuatro sectores si no existían; sin zona elige el sector con menos nodos) o lo retira conservando su historial |
| `mover_nodo_virtual(nodo, cultivo, zona)` | Pasa un nodo virtual propio (vinculado o suelto) a otro cultivo propio y activo, o lo cambia de sector en el mismo cultivo. Crea los sectores del destino si faltan, elige el sector con menos nodos si no se indica y respeta el límite de 16. Conserva código, capacidades e historial: las mediciones anteriores siguen en su cultivo |
| `eliminar_nodo_virtual(nodo)`, `nodos.eliminado_en` | Sin mediciones ni alertas el nodo se borra de verdad (`modo: borrado`), con sus capacidades y su historial de asignaciones. Con mediciones queda `retirado`: suelto, `habilitado = false` y `eliminado_en` con la fecha; no se vincula ni se mueve (`NODO_ELIMINADO`), no recibe lotes, no aparece en `estado_red_nodos()` ni en `estado_simulacion()` y su código no se reutiliza |
| `eliminar_cultivo(cultivo)` | Borrado definitivo solo sin historial (ninguna medición, alerta ni sugerencia; si no, `CULTIVO_CON_HISTORIAL` y el camino es `archivar_cultivo`). Libera sus nodos sin borrarlos y borra sectores, parámetros, reglas, clima, ajustes, solicitudes y las entradas de auditoría de asignaciones que nombran al cultivo |
| `vincular_nodo` | Se sustituye: igual que en la 0007, más el rechazo `NODO_ELIMINADO` |
| trigger `asignacion_inmutable` | La auditoría de asignaciones sigue sin poder modificarse; solo se borra junto con el nodo o el cultivo, dentro de las dos funciones de eliminación |
| `crear_cultivo` | Se sustituye: admite de cero a dos nodos (arreglo vacío o `NULL`), para crear un cultivo y agregarle después nodos simulados. Con nodos valida lo mismo que antes; misma firma, permisos e idempotencia por solicitud |
| `reservar_sugerencia_ia`, `estado_simulacion()`, `estado_red_nodos()` | Se sustituyen: el contexto de la IA agrega `ajustes_manuales`, el estado del servicio agrega `ajustes` y `ajustes_iniciado_en`, y la proyección del físico aparece también con un ajuste manual de temperatura o humedad del aire |
| `sugerencias_ia.motivo` | Admite además `solicitud` |
| Publicación `supabase_realtime` | Agrega `ajustes_simulacion`, `solicitudes_ia` y `sugerencias_ia` (solo si la publicación existe) |

Estados de una solicitud: `pendiente`, `en_proceso`, `atendida` (con `sugerencia_id`), `rechazada` (`detalle` `LIMITE_DIARIO_CULTIVO` o `LIMITE_DIARIO_GLOBAL`), `sin_datos` (`SIN_LOTE_RECIENTE`: ningún lote de ese origen en los últimos 180 s) y `error` (el código de Gemini, `RESPUESTA_INVALIDA`, `CULTIVO_NO_ACTIVO`, `PROCESO_INTERRUMPIDO` o `SOLICITUD_CADUCADA`). Una solicitud en proceso más de 5 minutos vuelve a pendiente una vez y a la segunda caída se cierra como error; pendiente más de 15 minutos sin que n8n la tome, caduca.

Un nodo virtual retirado queda suelto. Para vincularlo de nuevo: `vincular_nodo(nodo, cultivo)` y después `asignar_zona_nodo(nodo, zona, x, y)`. Hasta que no tiene sector no recibe lotes ni lo publica el servicio de simulación.

Al leer la tabla `nodos`, la web debe filtrar `eliminado_en is null`: los nodos retirados con historial siguen en la tabla para conservar sus mediciones.

`crear_nodo_virtual` no crea reglas de alerta. Un cultivo nuevo queda sin reglas simuladas hasta llamar `aplicar_plantilla_cultivo(cultivo, plantilla, true, 'simulado')` o `ajustar_parametros_cultivo(cultivo, parametros, true, 'simulado')`.

## Datos reales y simulados

Un nodo virtual solo recibe datos simulados v3, y uno físico datos reales: lo garantiza la 0007 de Juan. Durante un evento de clima, la lectura real del nodo físico **no se modifica**: el servicio de simulación publica una proyección como dato de origen simulado para ese mismo nodo, y la web la muestra aparte. La reserva de sugerencias, el tope diario y el contexto de Gemini van por origen.

Los rangos del catálogo y los efectos de cada evento no están validados en campo: son valores de prueba.

El ajuste manual sigue la misma regla que el clima: solo cambia datos simulados. En el nodo físico se publica como proyección de origen simulado y la lectura real no se modifica.

Pruebas locales en PGlite: `cd supabase/tests && npm test` (70 pruebas con las de la 0012, que se aplica aparte según [APLICAR_TERRENO_NODOS.md](APLICAR_TERRENO_NODOS.md): las de zonas de Juan, 0009, 0010, 0011, la aceptación de los lotes del servicio de simulación por las RPC v2 y v3, y la regresión de 0001 a 0006). Las pruebas de 0009 y 0010 se ejecutan con la 0011 aplicada.
