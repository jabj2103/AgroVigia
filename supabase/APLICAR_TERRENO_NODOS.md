# Aplicar 0012: terreno, sectores libres y nodos físicos autogestionados

Requiere 0001 a 0011 ([APLICAR_IA_HEXAGONOS.md](APLICAR_IA_HEXAGONOS.md)). No cambia mediciones ni vínculos existentes.

En Linux: `local/agrovigia.sh migrar` la aplica si falta y muestra `verificar-terreno-nodos.sql`: **todas las columnas true**. Desde el SQL Editor: pegar `migrations/202611030012_terreno_sectores_nodos_fisicos.sql` y después el verificador.

## Qué agrega

| Objeto | Para qué |
|---|---|
| `cultivos.ancho_m`, `cultivos.largo_m`, `definir_terreno(cultivo, ancho, largo)` | Medidas reales del terreno en metros (1 a 20000, dos decimales; ambas o ninguna). Con las dos en `NULL` se borran |
| `crear_sector`, `editar_sector`, `eliminar_sector`, `zonas.eliminada_en` | Sectores que dibuja el agricultor sobre la tabla `zonas`: nombre y rectángulo como fracción 0 a 1 del terreno. Código automático `sector-NN`, hasta 24 por cultivo, pueden solaparse. `editar_sector` sirve también para los cuatro por defecto |
| `ubicar_nodo(nodo, zona, x, y)` | Coloca un nodo propio, físico o virtual, en un sector de su cultivo y en una posición relativa. Es `asignar_zona_nodo` con sector obligatorio y posición redondeada |
| `registrar_nodo_fisico(tipo, sensores)`, `regenerar_clave_nodo`, `eliminar_nodo_fisico`, `claves_nodos()`, tabla `nodo_claves` | El agricultor registra, rota la clave y elimina sus propias placas. La clave se entrega una sola vez; en la base queda su hash sha256 y ningún cliente puede leer la tabla |
| `autenticar_nodo(codigo, clave)` | Solo `service_role`: la usa el flujo 03i de n8n ([INGESTA_HTTP.md](../n8n/INGESTA_HTTP.md)) |
| `vincular_nodo` | Se sustituye: hasta 16 nodos físicos por cultivo (antes 2), igual que virtuales |
| `tipos_dispositivo` | ESP32 y Raspberry Pi admiten además el protocolo `https_wifi` |

## Sectores y el contrato v3

El mensaje v3 del simulador no lleva el código del sector: `registrar_lote_simulado_v3` lo resuelve desde el nodo. Por eso un nodo virtual ubicado en un sector libre se simula, pasa la validación de n8n y se guarda sin cambiar el contrato ni el simulador, y en la medición queda el sector real (`zona_contexto.codigo = sector-NN`). La lista fija de cuatro zonas del simulador solo la usa el panel manual de Juan, que sigue trabajando con los nodos 01 a 04 de los cuatro sectores por defecto.

Un nodo físico también puede ubicarse en un sector: sus lotes reales v2 siguen entrando y la medición guarda el sector.

## Eliminar un sector

- Con nodos dentro: `SECTOR_CON_NODOS`. Primero hay que moverlos.
- Sin historial: se borra la fila (`modo: borrado`).
- Si alguna medición o entrada de auditoría lo nombra, borrarlo rompería esas referencias y las mediciones no se modifican. Queda marcado con `eliminada_en` (`modo: retirado`): no admite nodos, no se edita, no cuenta para el límite y su código no se reutiliza.

Al leer `zonas`, la web debe filtrar `eliminada_en is null`. Si a un cultivo no le queda ningún sector activo, el siguiente `crear_nodo_virtual` o `mover_nodo_virtual` vuelve a dejar los cuatro por defecto.

## Nodos físicos

- Código `agv-<esp|uno|rpi><4 hex>-<2 dígitos>`, por ejemplo `agv-esp4c1d-27`. El contrato v2 (validador de n8n y RPC de ingesta) solo admite `agv-<letras y dígitos>-<dos dígitos>`, por eso los cuatro caracteres aleatorios van en el segmento central.
- Sensores: `dht22` (temperatura y humedad del aire) y `ldr` (iluminación relativa). El lote v2 completo necesita los dos.
- Hasta 50 nodos físicos por cuenta.
- `eliminar_nodo_fisico` funciona como `eliminar_nodo_virtual`: sin mediciones se borra; con mediciones queda retirado (`eliminado_en`, deshabilitado) y se elimina su clave.
- El nodo `agv-dht22-01` no tiene clave y sigue entrando por MQTT. Puede recibir una con `regenerar_clave_nodo` si se quiere pasar a HTTPS.

Pruebas locales en PGlite: `cd supabase/tests && npm test`. Las suites de 0009 a 0011 se ejecutan con la 0012 aplicada.
