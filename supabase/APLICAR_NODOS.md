# Aplicar gestion de nodos

## 1. Base de datos

Requiere 0001..0004 ya aplicadas. No repetir las migraciones anteriores.

1. Supabase > SQL Editor > nueva consulta, rol postgres.
2. Copiar TODO supabase/migrations/202610270005_gestion_nodos.sql y ejecutar una sola vez. Esperado Success. No rows returned. Agrega auditoria y dos funciones; no mueve el nodo real. El estado de asignacion existente se registra como estado_inicial en la fecha de migracion, sin inventar historia anterior.
3. Otra consulta: copiar y ejecutar TODO supabase/probar-gestion-nodos.sql, incluido BEGIN y ROLLBACK. Esperado una fila OK que termina Prueba revertida. Crea cultivos, nodos y una medicion SIMULADOS transitorios; no utiliza ni mueve el ESP32 real. Prueba permisos, limite dos nodos, reintentos sin duplicar auditoria, propietario/cultivo ajenos, nodo ocupado/deshabilitado, cultivo archivado, auditoria RLS e historia conservada. No ejecutar solo SELECT final. Si falla antes de ROLLBACK, ejecutar ROLLBACK en la misma sesion antes de continuar.
4. Otra consulta: ejecutar supabase/verificar-gestion-nodos.sql. Esperado true,true,true,false,false.

Si aparecen funciones/tablas existentes, no repetir a ciegas: conservar el error y comprobar si se aplico. Sin resultados remotos verificados desde esta sesion.

## 2. Pantalla

Recargar http://127.0.0.1:5173. Navegacion > Dispositivos. Ver nodo autorizado, sensores, cultivo y ultima recepcion real aproximada. Fecha no es prueba de Wi-Fi conectado. Actualizar cuenta refresca listado, recepcion y actividad (no hay refresco automatico en Dispositivos).

Abrir Desvincular y luego Cancelar es una comprobacion segura de la pantalla: mantener el cultivo real asignado. Para enlazar uno disponible, seleccionar cultivo propio activo con menos de dos nodos; activar confirmacion y confirmar. No hay alta libre por codigo ni cambio de propietario. Si no hay cultivos disponibles, registrar cultivo con nodo libre desde Cultivos. Un nodo deshabilitado puede liberarse pero no asignarse.

Los ultimos 20 cambios muestran nodo, origen/destino y fecha. El registro cubre futuras asignaciones, creacion de cultivo y archivado, incluidas escrituras administrativas. No altera las mediciones historicas.

## 3. Recepcion n8n de varios nodos

En el flujo ambiental 03c que YA usas, cambiar solo el campo Topics del nodo MQTT receptor a:

    agrovigia/v2/real/nodos/+/telemetria:1

Guardar y publicar la actualizacion. El + sustituye un unico codigo de nodo; :1 selecciona QoS de la suscripcion y no forma parte del topico publicado por ESP32. Conservar servidor, puerto18883 y credenciales existentes. No publicar a un topico que contiene + desde el firmware. La ACL local ya permite leer esos topicos al receptor y restringe cada publicador al suyo. Supabase sigue validando catalogo, habilitacion, capacidades y cultivo; suscribirse no da permiso para guardar nodos desconocidos.

No activar un segundo receptor equivalente. n8n/03d-ingesta-multinodo.json se entrega como export limpio/inactivo por si se necesita una importacion nueva, sin credenciales; no hace falta importarlo si editas 03c. El generador es n8n/generar-multinodo.cjs. Tras publicar, confirmar una nueva ejecucion exitosa del primer nodo y la actualizacion de sus tres valores en web. La segunda placa no esta provisionada ni verificada con hardware.

## Cambio fisico de ubicacion

El protocolo v2 identifica el nodo, pero no incluye una version de asignacion. Por eso cambiar el cultivo requiere un procedimiento manual:

1. Apagar el ESP32 y esperar al menos siete minutos desde su ultima publicacion; mantenerlo apagado durante la operacion. Es un margen operativo para la ventana de antiguedad300s y tolerancia de reloj120s del prototipo, no una confirmacion automatica de colas vacias.
2. Desvincular del cultivo anterior y vincular al nuevo, o registrar el nuevo cultivo con el nodo disponible.
3. Mover el equipo y encenderlo en la ubicacion nueva. Comprobar captura nueva con UUID/fecha nueva y cultivo de destino.

La casilla de pantalla confirma que el operador hizo el procedimiento; servidor no mide ni verifica esa espera. La misma precaucion aplica al archivar y reutilizar sus nodos. Los mensajes antiguos ya guardados siguen en su cultivo y no se duplican. Sin pausa no se garantiza atribucion de mensajes pendientes: automatizar una transferencia sin pausa requiere ampliar firmware/contrato con identidad de asignacion, fuera de esta etapa. N8n/broker/procesos deben seguir ejecutandose para el monitoreo.

## Pruebas locales y limites

9 pruebas SQL con PostgreSQL embebido,24 web y69 n8n; QA navegador con fixtures para gestion y regresion de cultivos, anchos360/390/768/1280, build TypeScript/Vite. No prueban JWT remoto, dos placas fisicas ni concurrencia de varias sesiones. Funciones de gestion serializan por perfil y bloquean cultivo/nodo; un error de red/deadlock no confirma exito y exige refrescar antes de reintentar. Desvincular incluye cultivo esperado para impedir que un reintento viejo quite una asignacion nueva. Actividad es pagina reciente de20eventos, no export completo.
