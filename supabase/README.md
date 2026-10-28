# Persistencia: preparacion de la etapa 3b

Actualizacion: ampliacion ambiental0003 escrita y probada localmente en PostgreSQL/PGlite; aplicacion remota pendiente. Ver APLICAR_AMBIENTAL.md y ../docs/integrar-nodo-ambiental.md. No repetir migraciones iniciales ni provisionar-demo.sql.

Actualizacion 26 de octubre: Juan verifico la base y las pruebas SQL de RLS, y ejecuto la prevalidacion MQTT en n8n. Se preparo una primera RPC limitada al DHT22; ver [APLICAR_INGESTA.md](APLICAR_INGESTA.md). SQL escrito y revisado, aun sin ejecutar ni integrar desde esta sesion. El texto siguiente conserva requisitos e historial de revision anteriores.

Juan creó el proyecto y confirmó que public está vacío. Se preparó la primera migración de seis tablas en `migrations/202610260001_base_recepcion.sql`; ver [APLICAR_BASE.md](APLICAR_BASE.md) y `verificar-base.sql`. No se ha confirmado su ejecución en PostgreSQL ni se habilitó escritura desde n8n. La RPC y las pruebas de aislamiento siguen pendientes. La revisión siguiente describe los requisitos para completarlas.

## Revision del SQL propuesto

Se contrastaron las columnas de `mediciones`, la clave unica, el catalogo y el trigger de `docs/referencias/estructura-propuesta-supabase.sql` con el contrato MQTT. La revision identifico:

| Punto | Consecuencia para la operacion de recepcion |
|---|---|
| Una fila por variable y UNIQUE `(nodo_id,mensaje_id,variable_codigo)` | DHT22 necesita dos filas en una transaccion. La clave sola no comprueba lote completo ni contenido identico |
| Trigger comprueba el cultivo actual antes de insertar | Un duplicado ya confirmado debe resolverse antes de intentar nueva insercion, aun tras mover el nodo |
| `recibida_en DEFAULT now()` | No representa la llegada original si hubo cola/reintentos; pasar la fecha de entrada conservada, cuando se resuelva su captura en n8n |
| Temperatura sin limites en catalogo propuesto | Alinear explicitamente con -40/80 del contrato antes de migrar; son limites de admisibilidad, no reglas agronomicas |
| Inmutabilidad de mediciones por trigger | No usar upsert que reescriba el lote anterior al detectar conflicto |
| RLS de lectura y escrituras privilegiadas propuestas | Probar con dos cuentas, anonimo y roles de servidor; no asumir seguridad por declarar polticas |

Los archivos de referencias se mantienen intactos. No se verifico el SQL contra PostgreSQL y no se presenta esta revision como prueba de sintaxis, transacciones o RLS.

## Operacion prevista: registrar lote completo

La siguiente implementacion debe ser una funcion PostgreSQL/RPC unica de ingestión, invocable solo por el rol servidor autorizado de n8n; no por anonimo ni por el navegador autenticado. Recibira el payload prevalidado y contexto de entrada que controle el servidor (topico, origen autorizado por canal y recibida_en), nunca cultivo/cuenta elegidos por firmware.

1. Revalidar el lote y procedencia desde un canal protegido por ACL comprobada; resolver `nodos.codigo` y capacidades reales del catalogo.
2. Serializar la operacion por nodo/ID, con bloqueos transaccionales que tambien coordinen cambios de vinculacion. La implementacion debe probarse con dos solicitudes concurrentes, no solo llamadas sucesivas.
3. Comprobar revocacion del nodo y permisos. Buscar el lote previo antes de aplicar nueva vinculacion o ventana temporal. Si esta completo e identico, devolver duplicado con sus IDs originales, sin cambiar fechas, cultivo o ejecutar reglas de nuevo.
4. Si el ID contiene otra fecha, origen, conjunto de variables o valores, devolver conflicto. Un lote parcial previo no se completa silenciosamente. La comparacion de referencia en `n8n/validar-telemetria.cjs` es pura, no ofrece exclusion mutua ni consulta DB.
5. Para lote nuevo, exigir nodo habilitado, cultivo vinculado de la misma cuenta, perfil completo, escala LDR aprobada si es real y ventana de captura 300 s hacia atras/120 s hacia delante. No crear catalogos a partir del payload.
6. Guardar ambas variables DHT22, o una LDR, con UUID de nodo/cultivo resueltos, origen y fechas originales, en una sola transaccion. Confirmar todo o revertir todo. Resolver carreras sin actualizar mediciones inmutables.
7. Devolver un estado claro (`insertado`, `duplicado`, `rechazado` o `conflicto_id`) y los IDs guardados cuando corresponda. Solo tras commit se podran preparar reglas; las alertas pertenecen a otra etapa.

La funcion necesita revision de `search_path`, permisos EXECUTE y estrategia de rol. Si se usa SECURITY DEFINER, debe justificar y restringir sus privilegios; no es una solucion automatica para RLS. Las claves privilegiadas quedan en el servidor/n8n, no en firmware, web, ejemplos ni Git.

## Evidencia requerida antes de migrar e integrar

- Base de prueba identificada, esquema vigente revisado y resultado de aplicar el SQL en un entorno de desarrollo controlado.
- Cuenta/cultivo/nodos habilitados previamente; no utilizar UUID ficticios del test como registros reales.
- Lote DHT22 valido crea exactamente dos filas; invalido o perfil cruzado no crea ninguna.
- Duplicado identico, incluso tras cambio de cultivo, conserva filas, fechas y cultivo historico. Mismo ID con otro contenido no actualiza ni crea filas.
- Dos peticiones simultaneas del mismo lote dejan un solo lote completo. Fallo en una observacion revierte ambas.
- Sin cultivo, deshabilitado, capacidad no autorizada, origen no verificado y LDR real sin conversion se rechazan.
- Dos cuentas distintas no pueden consultar ni vincular datos ajenos; separar origen real/simulado en consultas.
- Caida temporal de almacenamiento: definir cola/reintentos en n8n con la recepcion original y sin marcar exito antes del commit. No confundir PUBACK MQTT con persistencia.

La incertidumbre fisica de los pares cero/cero se conserva como advertencia en la prevalidacion. No se cambia silenciosamente el rango del catalogo para ocultarlos ni se utiliza ausencia de alertas para declarar salud. La politica final de calidad y uso en reglas debe acordarse antes de implementar las alertas.

Fuente primaria sobre funciones/RPC y seguridad: [Supabase Database Functions](https://supabase.com/docs/guides/database/functions). Este archivo especifica la operacion pendiente; no es una migracion ni una funcion ya ejecutada.
