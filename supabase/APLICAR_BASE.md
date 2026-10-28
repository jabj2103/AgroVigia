# Primera base de AgroVigia

## Continuacion: cuenta y nodo de demostracion

Tras verificar la base y crear la cuenta en Auth, ejecutar completo
[provisionar-demo.sql](provisionar-demo.sql) en una consulta nueva de SQL Editor.
El UID fue proporcionado por Juan; no es una clave de acceso. El cultivo se
identifica como demostracion, con area ficticia de 1 m2 y sin especie definida.
No se crean mediciones. La consulta final debe devolver dos filas para el mismo
nodo habilitado: `humedad_aire` (% HR) y `temperatura_aire` (grados Celsius).
El script conserva datos existentes al repetir y aborta ante vinculos o
capacidades incompatibles, sin transferir el nodo. Ante error, conservar el
mensaje; si la sesion queda en transaccion abortada, ejecutar `ROLLBACK;` antes
de continuar. Todavia pendiente de ejecucion en Supabase y prueba de RLS entre
cuentas. Esta consulta administrativa no sustituye esa prueba.

## Comprobar RLS con las dos cuentas

Juan proporciono los UID del propietario y de una segunda cuenta Auth de prueba.
Ejecutar **todo** [verificar-rls.sql](verificar-rls.sql) en una consulta nueva de
SQL Editor con rol administrativo. El script cambia temporalmente al rol
`authenticated` con cada identidad, y despues a `anon`; no consulta los datos
como administrador para concluir aislamiento.

Dentro de una transaccion crea dos mediciones **simuladas** (25 grados Celsius
y 60 % HR) para que la prueba de mediciones no sea vacia. Juan debe verlas y la
segunda cuenta no. Tambien comprueba perfil, cultivo, nodo, capacidades,
catalogo compartido, rechazo anonimo y permisos de escritura directa. Termina
con `ROLLBACK` y muestra seis filas `OK` si no hubo errores. No crea objetos
persistentes ni transfiere el nodo ni deja las mediciones guardadas.

Si ocurre un error, no considerar valido el resumen: conservar el mensaje y
ejecutar `ROLLBACK;` en esa sesion antes de continuar. No ejecutar solo el
SELECT final. Esta prueba comprueba politicas SQL mediante identidades de
sesion configuradas en SQL Editor; no comprueba login, firma/expiracion de JWT,
API web, concurrencia ni la futura RPC de escritura.

Fuente: [pruebas RLS de Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security),
consultada el 26 de octubre de 2026. No requiere extensiones ni instalaciones.

## Aplicacion inicial

Juan confirmó que la consulta del esquema public devuelve cero tablas.
Esta migración se preparó para ese proyecto de desarrollo vacío.

1. Abrir [202610260001_base_recepcion.sql](migrations/202610260001_base_recepcion.sql) en VS Code, copiar todo su contenido y pegarlo en una consulta nueva de SQL Editor del proyecto AgroVigia-dev.
2. Ejecutar una vez con Run. Usa BEGIN/COMMIT: tablas, catálogo, permisos y políticas se crean juntos. Si aparece un error, conservar el mensaje y no borrar tablas ni intentar fragmentos sueltos. Si la sesión quedó en transacción abortada, ejecutar ROLLBACK antes de volver a intentarlo.
3. Abrir otra consulta, pegar [verificar-base.sql](verificar-base.sql) y ejecutarla. Se esperan seis filas, con existe, rls_activado y lectura_autenticada true; escritura_cliente, acceso_anonimo y escritura_servidor_directa false; politicas_select = 1.
4. Consultar el catálogo:

```sql
SELECT codigo, unidad, valor_min, valor_max
FROM public.variables ORDER BY codigo;
```

Se esperan humedad_aire (% HR, 0–100), iluminacion_relativa (% relativo, 0–100) y temperatura_aire (°C, -40–80). La escala física del LDR continúa pendiente; el catálogo no acredita calibración ni habilita su ingesta real.

## Qué se crea

Seis tablas de la arquitectura acordada: perfiles, cultivos, nodos, variables, nodo_variables y mediciones. Las otras cinco tablas se incorporarán en etapas posteriores, sin cambiar el recorrido ESP32 → MQTT → n8n → Supabase → React.

Se mantienen claves y relaciones previstas, cultivo histórico de la medición y unicidad por nodo/mensaje/variable. Se alinean límites de temperatura y UUID v4 con el contrato. Se exige recibida_en explícita y se impide UPDATE/DELETE de mediciones por trigger. Los rangos se comprueban al insertar; la precisión numeric(12,4) puede redondear entradas SQL, por lo que la futura RPC debe validar precisión antes de convertir.

RLS permite lectura propia a authenticated (catálogo de variables compartido entre usuarios autenticados) y no concede acceso a anon. service_role queda con SELECT en estas tablas; la escritura se habilitará mediante una RPC revisada. SQL Editor con rol administrativo puede provisionar datos y no demuestra por sí solo aislamiento entre usuarios.

## Límites de esta entrega

No crea usuarios, cultivos, nodos ni mediciones de ejemplo, ni RPC, alertas o IA. Tampoco guarda MQTT. No asegura aún lote completo, ventana temporal ni idempotencia de contenido: corresponden a la RPC pendiente. Las referencias originales permanecen intactas.

Se revisó localmente el SQL y su correspondencia con la propuesta, pero no se encontró un ejecutor PostgreSQL local. La primera ejecución de desarrollo será la de Juan en SQL Editor; hasta recibir el resultado no se afirma migración aplicada. La consulta de verificación inspecciona configuración, no sustituye pruebas de aislamiento con dos cuentas ni pruebas transaccionales.

Siguiente paso después de verificar: crear usuarios de prueba en Supabase Auth, provisionar perfil/cultivo/nodo y probar permisos. Después implementar y probar la RPC e integrar n8n. Nunca compartir claves privadas ni contraseña de base de datos en el chat.

Fuente: [RLS y permisos Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security), consultada el 26 de octubre de 2026.
