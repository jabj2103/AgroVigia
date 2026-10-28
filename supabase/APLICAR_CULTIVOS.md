# Aplicar gestion de cultivos

Esta etapa agrega funciones de backend. Todavia no agrega formularios a React.
Requiere las migraciones 0001, 0002 y 0003 ya aplicadas. No ejecutar de nuevo esas migraciones ni provisionar-demo.sql.

1. Mantener ESP32, Mosquitto y n8n como estan.
2. Abrir el proyecto AgroVigia en Supabase y entrar a SQL Editor.
3. Crear una consulta nueva con el rol postgres seleccionado.
4. En VS Code abrir supabase/migrations/202610270004_gestion_cultivos.sql, copiar TODO y pegarlo en la consulta. Ejecutar una vez. Esperado: Success. No rows returned. No reasigna nodos ni modifica cultivos actuales; agrega una columna, funciones y protecciones.
5. En otra consulta nueva pegar TODO supabase/probar-gestion-cultivos.sql y ejecutar. Incluye BEGIN y ROLLBACK: crea un nodo ficticio temporal, usa las identidades de las dos cuentas existentes y comprueba creacion, edicion, archivado, permisos y aislamiento. Esperado: una fila que empieza por OK y termina Prueba revertida. No es una prueba de login/JWT ni de concurrencia. No ejecutar solo el SELECT final: ese mensaje depende de que todo el script anterior termine sin errores. Si falla antes de ROLLBACK, ejecutar ROLLBACK en la misma consulta/sesion antes de continuar.
6. En otra consulta ejecutar TODO supabase/verificar-gestion-cultivos.sql. Esperado: true, true, true, false, false.
7. Confirmar que la web sigue recibiendo las mediciones del nodo real. No archivar el cultivo de demostracion durante esta prueba.

Si hay errores, conservar el texto completo. No repetir la migracion ante un error de columna o funcion ya existente: verificar primero si se aplico.

## Comportamiento

crear_cultivo recibe nombre, tipo, area (maximo cuatro decimales positivos), unidad m2/ha, uno o dos UUID de nodos propios habilitados y sin cultivo, y UUID de solicitud. Toma el propietario de auth.uid(), nunca de un campo del formulario. La solicitud evita crear dos cultivos por un reintento identico mientras su configuracion no cambie. Cambiar el contenido de una solicitud ya usada produce conflicto. Creacion y asignacion ocurren juntas.

editar_cultivo cambia solo nombre, tipo, area y unidad de un cultivo propio activo. Las mediciones confirmadas no se modifican.

archivar_cultivo conserva cultivo e historial y libera todos sus nodos en la misma transaccion. El ESP32 puede seguir enviando MQTT, pero sin cultivo asignado sus nuevas capturas no se guardan. La asignacion de nodos y las nuevas mediciones a cultivos archivados se bloquean. No hay restauracion en esta etapa. Las pantallas siguientes distinguiran activos/archivados y pediran confirmacion antes de archivar.

Estas funciones son para authenticated. No conceden escritura directa de tablas ni permisos nuevos a anon o service_role. No requieren cambiar claves, firmware ni n8n.

## Pendientes

Conectar React con estas funciones, filtrar activos en monitoreo y conservar acceso al historico de archivados; agregar vinculacion/desvinculacion de nodos a cultivos existentes y su registro de cambios. El unico nodo real sigue ocupado por el cultivo actual: no crear hardware ficticio permanente para probar el formulario. Las pruebas locales con PostgreSQL embebido no sustituyen la comprobacion remota con la cuenta ni prueban concurrencia de varias sesiones.
