# Preparación de zonas e ingesta simulada

**Estado: SQL preparado y probado localmente, no aplicado al Supabase compartido.** Incluye el requisito del plano esquemático seleccionable. Revisar primero si el compañero añadió tablas/funciones con estos nombres o cambió las migraciones previas. Una rama de Git no crea una base de datos distinta.

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

1. Confirmar 0001–0006 ya aplicadas y reconciliar cualquier cambio del compañero. Preferir una base de desarrollo separada si su trabajo modifica el mismo Supabase.
2. Aplicar 0007 completa una vez en SQL Editor como `postgres`; luego 0008 completa una vez. No repetir las anteriores.
3. Ejecutar [verificar-zonas-simuladas.sql](verificar-zonas-simuladas.sql), de solo lectura. Resultado esperado: `true,true,true,true,true,true,false,false,false`.
4. Elegir un cultivo propio activo para la demostración. En [provisionar-simulacion.sql](provisionar-simulacion.sql), sustituir únicamente `p_cultivo_id uuid := NULL` por el UUID entre comillas. No introducir claves. Ejecutar el archivo completo.
5. Conservar las cuatro filas de mapeo devueltas: `nodo_local`, `nodo_codigo` y `asignacion_version` serán necesarias para el futuro emisor. No contienen contraseñas. Los códigos incluyen un prefijo del UUID del cultivo para evitar compartir identidades entre cuentas.

Repetir el provisionamiento conserva identidades, posiciones personalizadas y versiones. Si el nodo existente pertenece a otra cuenta, está libre, deshabilitado, fue movido o tiene otras capacidades, el script aborta en vez de apropiárselo o restablecerlo silenciosamente. No mover los ESP32 para hacer esta prueba.

Después de estas operaciones **el panel todavía seguirá en modo local**: falta implementar y probar el transporte MQTT/n8n v3 y la consulta en web. No pegar los archivos del panel en las RPC antiguas.

## Plano y datos para la futura web

- Cultivo → varias zonas → nodos. La web consultará `zonas` y los nodos autorizados por RLS.
- Zona: `plano_x`, `plano_y`, `plano_ancho`, `plano_alto` en un lienzo normalizado. Nodo: `posicion_x`, `posicion_y` relativas a su zona. La interfaz puede convertirlos a SVG/porcentajes y mantener la proporción en móvil.
- Seleccionar un rectángulo filtrará esa zona; seleccionar un marcador abrirá las variables del nodo, su procedencia y antigüedad. Los físicos sin zona aparecerán como «Sin ubicar», sin inventar puntos.
- Es un croquis general. No calcula superficie, coordenadas GPS ni cobertura real de sensores. Se almacenan posiciones y nombres; no hay un mapa geográfico implementado.
- `mediciones.zona_contexto` conserva el croquis y marcador históricos sin alterar `metadatos` de v1/v2, para mantener compatible su comparación de duplicados.

Guía del mensaje: [contrato v3 simulado](../docs/contrato-mqtt-v3-simulado.md). El formato local y el de transporte son distintos deliberadamente; el adaptador conserva el UUID/fecha del lote y elimina las etiquetas de ubicación no autorizadas.
