# Preparación de zonas e ingesta simulada

**Estado: aplicación de 0007/0008 verificada por captura aportada por Juan; alta de cuatro zonas/nodos con diez capacidades reportada correcta por Juan.** El resultado de verificar-zonas-simuladas.sql muestra seis true y tres false, como se esperaba. No se ejecutó SQL remoto desde esta sesión. Siguiente prueba: [una captura del panel por MQTT/n8n v3](../n8n/SIMULACION_ZONAS.md). Incluye el requisito del plano esquemático seleccionable. Una rama de Git no crea una base de datos distinta.

## Qué incorpora

1. `202611030007_zonas_y_nodos_virtuales.sql`: tabla `zonas`, coordenadas de rectángulos normalizadas 0–1, tipo de nodo físico/virtual, posición relativa dentro de la zona y versión de asignación. RPC de configuración/asignación para el propietario. Hasta dos físicos y dieciséis virtuales por cultivo mediante `vincular_nodo`; `crear_cultivo` conserva el contrato inicial de uno/dos nodos.
2. `202611030008_ingesta_simulada_v3.sql`: siete variables nuevas y RPC `registrar_lote_simulado_v3`, ejecutable solo por `service_role`. Persiste las diez variables del panel en una transacción y resuelve cultivo/zona por catálogo, con duplicados, conflicto, ventanas y control de asignación.
3. `provisionar-simulacion.sql`: plantilla administrativa para crear cuatro zonas y nodos virtuales en **un cultivo activo elegido**. No registra mediciones. El UUID se configura explícitamente; por defecto aborta.

Las migraciones 0001–0006 no se reescriben. Las tablas anteriores conservan permisos/RLS; `zonas` añade lectura propia y solo permite escritura por funciones autorizadas. Medidas antiguas mantienen `zona_id = NULL` y `zona_contexto = {}`; no se reconstruye su ubicación desde el nodo actual.

## Verificación local ya disponible

```powershell
npm.cmd --prefix supabase/tests test
```

Usa PGlite/PostgreSQL aislado con roles y usuarios ficticios. Comprueba geometría, aislamiento por cuenta, permisos, diez filas atómicas, metadatos, versiones de ubicación, rechazo y duplicados, reversión de fallos, coexistencia de físicos/virtuales y regresión de funciones anteriores. No demuestra JWT/API remota ni concurrencia real entre conexiones. No necesita claves ni modifica los servicios.

## Aplicación posterior a la revisión

Estos pasos son para cuando se decida integrar en un proyecto de desarrollo coordinado; no se han ejecutado desde esta sesión.

1. Ejecutar [comprobar-antes-zonas.sql](comprobar-antes-zonas.sql), de solo lectura. Para la base previa se espera `ESQUEMA_PREVIO_DETECTADO`, 10 tablas base, 4 funciones base, tabla_zonas false y contadores nuevos a cero. Si informa ampliación presente/parcial o cambios, no repetir migraciones: revisar el resultado. La consulta comprueba estructura y nombres, no cambios internos de las funciones. Confirmar 0001–0006 ya aplicadas y reconciliar cualquier cambio del compañero. Preferir una base de desarrollo separada si su trabajo modifica el mismo Supabase.
2. Aplicar 0007 completa una vez en SQL Editor como `postgres`; luego 0008 completa una vez. No repetir las anteriores.
3. Ejecutar [verificar-zonas-simuladas.sql](verificar-zonas-simuladas.sql), de solo lectura. Resultado esperado: `true,true,true,true,true,true,false,false,false`.
4. Elegir un cultivo propio activo para la demostración. En [provisionar-simulacion.sql](provisionar-simulacion.sql), sustituir únicamente `p_cultivo_id uuid := NULL` por el UUID entre comillas. No introducir claves. Ejecutar el archivo completo.
5. Conservar las cuatro filas de mapeo devueltas: `nodo_local`, `nodo_codigo` y `asignacion_version` serán necesarias para el futuro emisor. No contienen contraseñas. Los códigos incluyen un prefijo del UUID del cultivo para evitar compartir identidades entre cuentas.

Si el editor muestra solamente «Success. No rows returned» por el COMMIT final, no repetir el alta para obtener las filas. Ejecutar [verificar-provision-simulacion.sql](verificar-provision-simulacion.sql), de solo lectura. Está preparada para el cultivo de demostración `52ea4628-c470-48f4-a09a-0f9a697d22b4`; sustituir ese UUID si se eligió otro cultivo. Debe mostrar cuatro nodos habilitados con diez capacidades simuladas cada uno.

Repetir el provisionamiento conserva identidades, posiciones personalizadas y versiones. Si el nodo existente pertenece a otra cuenta, está libre, deshabilitado, fue movido o tiene otras capacidades, el script aborta en vez de apropiárselo o restablecerlo silenciosamente. No mover los ESP32 para hacer esta prueba.

Después del alta el panel sigue local al arrancar sin modificadores. El transporte MQTT/n8n v3 está preparado y probado de forma aislada: seguir [la guía de conexión](../n8n/SIMULACION_ZONAS.md) para habilitarlo y comprobarlo remotamente. La consulta en web sigue pendiente. No pegar los archivos del panel en las RPC antiguas.

### Aviso del SQL Editor sobre RLS o instrucciones destructivas

Para ejecutar la migración 0007 completa tal como está escrita, elegir **Run without RLS** si el editor muestra ese diálogo: la propia migración ya ejecuta `ALTER TABLE public.zonas ENABLE ROW LEVEL SECURITY` y configura permisos/política. La opción permite ejecutar el SQL original sin añadir instrucciones automáticas; no hay que quitar las líneas de RLS del archivo. Confirmar después `rls_zonas = true` con la consulta de verificación.

La migración sustituye el trigger `auditar_asignacion` mediante `DROP TRIGGER` seguido de `CREATE TRIGGER`; no contiene `DROP TABLE` ni borrado de mediciones. Si la advertencia nombra una tabla «STRICT», es compatible con una detección incorrecta de `SELECT … INTO STRICT` dentro de PL/pgSQL: esa sintaxis asigna una fila a una variable, no crea una tabla. No añadir RLS automático para una tabla llamada STRICT. Referencia de sintaxis: [PostgreSQL, resultado de una fila](https://www.postgresql.org/docs/current/plpgsql-statements.html#PLPGSQL-STATEMENTS-SQL-ONEROW).

Si aparece `unterminated dollar-quoted string`, comprobar que se pegó y ejecutó el archivo completo, sin una selección parcial. La migración 0007 tiene 194 líneas y termina en `COMMIT;`. Antes de reintentar, ejecutar `ROLLBACK;` en una consulta separada y volver a comprobar el esquema previo; si ya existe parte de la ampliación, revisar el estado en vez de repetirla ciegamente. Para copiar el archivo completo desde PowerShell en la raíz: `Get-Content -Raw -Encoding UTF8 .\supabase\migrations\202611030007_zonas_y_nodos_virtuales.sql | Set-Clipboard`. Pegar en una consulta nueva, confirmar la última línea y ejecutar sin dejar seleccionado un fragmento. Una selección parcial puede omitir el cierre `$$` de una función.

Si 0008 da `syntax error at or near IF` y muestra ese IF como línea 1, el servidor está recibiendo un fragmento interior de la función. El archivo completo tiene 135 líneas, comienza con comentario/`BEGIN;` y acaba en `COMMIT;`. Copiarlo con `Get-Content -Raw -Encoding UTF8 .\supabase\migrations\202611030008_ingesta_simulada_v3.sql | Set-Clipboard`, pegar en una consulta nueva y seleccionar **todo el contenido del editor** con Ctrl+A antes de Run evita ejecutar solo un fragmento resaltado. Si no se conoce el estado del intento anterior, ejecutar ROLLBACK y comprobar primero las siete variables nuevas y la existencia de la RPC v3; si ya están creadas, usar la verificación en lugar de repetir 0008.

## Plano y datos para la futura web

- Cultivo → varias zonas → nodos. La web consultará `zonas` y los nodos autorizados por RLS.
- Zona: `plano_x`, `plano_y`, `plano_ancho`, `plano_alto` en un lienzo normalizado. Nodo: `posicion_x`, `posicion_y` relativas a su zona. La interfaz puede convertirlos a SVG/porcentajes y mantener la proporción en móvil.
- Seleccionar un rectángulo filtrará esa zona; seleccionar un marcador abrirá las variables del nodo, su procedencia y antigüedad. Los físicos sin zona aparecerán como «Sin ubicar», sin inventar puntos.
- Es un croquis general. No calcula superficie, coordenadas GPS ni cobertura real de sensores. Se almacenan posiciones y nombres; no hay un mapa geográfico implementado.
- `mediciones.zona_contexto` conserva el croquis y marcador históricos sin alterar `metadatos` de v1/v2, para mantener compatible su comparación de duplicados.

Guía del mensaje: [contrato v3 simulado](../docs/contrato-mqtt-v3-simulado.md). El formato local y el de transporte son distintos deliberadamente; el adaptador conserva el UUID/fecha del lote y elimina las etiquetas de ubicación no autorizadas.
