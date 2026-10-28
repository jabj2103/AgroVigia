# Guardado transaccional DHT22: etapa 3b

La recepcion y prevalidacion MQTT del UUID
afc8bbe9-59ed-4c93-9c05-b4fb02645bba estan comprobadas por el resultado que
aporto Juan. Sigue siendo un ejemplo simulado. Su inicio de Code fue casi
seis minutos posterior a la captura: no reutilizar esa salida antigua para
demostrar ingesta de un lote nuevo. Forma valida no equivale a reloj valido.

## Aplicar y probar

1. En SQL Editor, con rol postgres, ejecutar UNA vez TODO
   [0002](migrations/202610260002_ingesta_dht22.sql).
2. La consulta final debe devolver ejecuta_servidor=true,
   ejecuta_web=false y ejecuta_anonimo=false.
3. En otra consulta ejecutar TODO [probar-ingesta-dht22.sql](probar-ingesta-dht22.sql).
   Debe terminar sin errores con siete filas OK. Genera UUID y fechas nuevos
   para valores simulados y termina con ROLLBACK: no deja esas filas guardadas.
4. Ante error conservar el mensaje y ejecutar ROLLBACK; en esa sesion. No
   ejecutar solo los resumenes finales ni ignorar errores anteriores.

Revision local contra 0001 y el contrato completada. No se encontro PostgreSQL,
psql o Docker en PATH. No se ejecutaron estos SQL desde esta sesion. Aplicacion,
pruebas SQL y concurrencia pendientes; no afirmar guardado MQTT por crear la RPC.

## Funcion y permisos

registrar_lote_dht22 recibe p_topico, p_mensaje (texto JSON ORIGINAL),
p_recibida_en (fecha explicita), p_acl_verificada, p_retenido y
p_retencion_broker_desactivada. Solo service_role recibe permiso EXECUTE.
No se conceden escrituras directas en tablas a n8n, la web o anon.

SECURITY DEFINER permite una operacion delimitada y atomica con las tablas del
propietario postgres; search_path queda vacio y las relaciones van calificadas.
No hay SQL dinamico ni seleccion de cuenta/cultivo por payload. La credencial de
servidor es solo para n8n. Los flags de evidencia de canal son informacion
confiable del servidor, nunca campos elegidos por el dispositivo/navegador.
La funcion NO puede verificar por si misma la ACL ni la bandera de un paquete.

Revalida el JSON raw antes de convertir datos a jsonb: tamano UTF-8, BOM,
claves duplicadas (incluidas escapadas), campos, tipos, UUID, fecha existente,
topico, unidades, precision numerica y rangos. Resuelve el nodo conocido y su
perfil DHT22 completo desde el catalogo; no crea altas automaticamente.
Esta primera RPC no admite LDR. Su perfil se incorporara en una migracion
posterior; el bloqueo de conversion LDR real sigue vigente.

Bloquea la fila del nodo FOR UPDATE para serializar ingestas y coordinar con
cambios de vinculo. Duplicado completo e identico conserva IDs, recepcion y
cultivo historico, aun al cambiar el cultivo actual. Un ID con otro contenido
o un lote previo parcial devuelve conflicto_id sin completar ni reescribir.
Revocar el nodo impide aceptar tambien sus duplicados.

Lotes nuevos exigen cultivo de la misma cuenta y ventana inclusiva
recibida_en-300 s <= tomada_en <= recibida_en+120 s. Un INSERT con ambas
variables guarda todo o revierte todo. Cero/cero genera advertencia; no se
oculta, no se etiqueta como saludable y no se le atribuye una causa.

Estados: insertado, duplicado, conflicto_id, rechazado. Errores esperados de
validacion devuelven codigo de motivo; errores inesperados de integridad/DB
se propagan para que el receptor no los marque como exito. La respuesta HTTP
solo debe considerarse confirmada despues del commit de la transaccion RPC.

## Limites y siguiente integracion

La prueba SQL comprueba permisos reales de llamada como anon/authenticated,
y llama como service_role para comprobar insercion, duplicado reordenado y
tardio, conflicto, JSON/forma/rango/precision/fechas/contexto invalidos,
extremos inclusivos y advertencia de ceros. No prueba login, API HTTP, dos
solicitudes simultaneas ni recuperacion tras caida.

Comprobaciones pendientes para cerrar la etapa (el 03b permite antes una prueba controlada de demostracion):
- Ejecutar las pruebas SQL y ampliar a dos sesiones concurrentes, duplicado
  tras cambio de cultivo, nodo deshabilitado/sin vinculo y lote previo parcial.
- Probar un fallo durante insercion que confirme rollback de ambas variables.
- Resolver la metadata de entrada: MQTT Trigger 2.44.7 solo entrega topic y
  message. No mapear manualmente procesamiento_iniciado_en como recepcion
  exacta ni inventar p_retenido=false. El 03b define explicitamente recepcion de aplicacion aproximada; ver ../n8n/INGESTA_SUPABASE.md.
- Conservar JSON original y fecha de recepcion al reintentar persistencia.
- Probar HTTP/RPC desde n8n y despues una captura real nueva del ESP32.
- Documentar rechazo/conflicto y recuperacion de fallos sin perdida silenciosa.

No hay tabla persistente de rechazos ni cola duradera en esta entrega. Los
estados devueltos deben conservarse/gestionarse en la integracion de n8n;
una devolucion rechazado/conflicto_id no es una medicion guardada. Los
mensajes mientras n8n esta apagado siguen sin recuperacion garantizada.

Fuente primaria: [Funciones y seguridad Supabase](https://supabase.com/docs/guides/database/functions),
consultada el 26 de octubre de 2026.
