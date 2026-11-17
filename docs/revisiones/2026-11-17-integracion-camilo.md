# Revisión de la rama de Camilo y plan de integración

Fecha: 17 de noviembre de 2026, Bogotá.

## Resultado

Conviene aprovechar esta implementación y preparar una integración por etapas. La rama `camilo/integracion-ia-zonas`, commit `280292a098d700bba27d8dcd44a4195fd5130444`, parte directamente de `juan/simulacion-zonas`, commit `d0e39c745e7658ab6846f51892530f897f752655`. Está un commit por delante y ninguno por detrás: conserva el trabajo de Juan como antecesor. En ese punto la integración de Git puede avanzar sin resolver historias divergentes.

Es una ampliación grande: **167 archivos, 20.225 líneas añadidas y 354 eliminadas**. La ausencia de divergencia Git no certifica compatibilidad con el entorno que está ejecutándose. Se necesita aplicar las ampliaciones del esquema y configurar los flujos nuevos antes de usar esta web contra el proyecto actual.

La revisión y las pruebas se hicieron en una copia aislada en `.local/revisiones/camilo-280292a`. No se cambió la rama de trabajo de Juan, no se fusionaron ramas, no se publicaron flujos, no se cargó firmware, no se consultó Gemini y no se escribió en el Supabase remoto.

## Qué incorpora

| Área | Implementación encontrada |
|---|---|
| Sugerencias IA | Contexto con mediciones/evidencias, Gemini, respuesta estructurada validada, estados de error, límites de uso y solicitudes del agricultor |
| Reglas y cultivos | Plantillas orientativas para seis cultivos y parámetros propios; alertas por origen y humedad del suelo simulada |
| Simulación | Servicio que publica periódicamente, clima de prueba y deltas manuales desde la web; conserva el panel externo |
| Reales y simulados | Proyecciones simuladas del nodo físico separadas de sus lecturas reales; consultas e historial con procedencia |
| Terreno y nodos | Medidas, sectores editables, ubicación de nodos, escenario 3D y gestión de nodos virtuales |
| Placas físicas | Registro con clave propia, configuración Web Serial, firmware ESP32 HTTP/HTTPS y flujo 03i |
| Transporte | MQTT existente y alternativa HTTP para simulador/placas; nuevos flujos 03g, 03h y 03i |
| Entorno | Guiones Linux, entorno Docker/Supabase local y propuesta de despliegue Render |

Las funciones de IA se comprobaron con respuestas ficticias y pruebas de flujo. Esto no demuestra una llamada real a Gemini desde el entorno de Juan, ni valida recomendaciones agronómicas o la nueva placa física.

## Hallazgos que atender

### 1. Requisito de integración: esquema remoto anterior e historial vacío

La conexión de Supabase ya funciona. Lecturas del proyecto AgroVigia `vzylofqutecvfcbmcjac` comprobaron:

- Proyecto `ACTIVE_HEALTHY`.
- Once tablas propias con RLS habilitado, diez variables, un cultivo, cuatro nodos virtuales y 394 mediciones en total.
- No existen `cultivo_plantillas`, `sugerencias_ia`, `solicitudes_ia` ni `nodo_claves`: las ampliaciones 0009–0012 aún no están aplicadas.
- `list_migrations` devuelve un historial vacío, aunque existen las tablas y funciones anteriores, coherente con su aplicación manual.

La nueva web consulta estas tablas y RPC. Cambiar solamente el código de la web causará errores contra esta base. Primero inventariar/respaldar y registrar la base existente; después aplicar 0009, 0010, 0011 y 0012 de manera controlada y ejecutar sus verificadores. No repetir 0001–0008 ni interpretar el historial vacío como una base sin datos. No se reparó ni alteró el historial durante esta revisión.

### 2. P2: la comunicación USB no se recupera de un timeout

Referencia: [nodo-fisico-data.ts, líneas 95–109](https://github.com/jabj2103/AgroVigia/blob/280292a098d700bba27d8dcd44a4195fd5130444/web/src/nodo-fisico-data.ts#L95).

`PlacaSerie.orden()` compite `this.lector.read()` con un temporizador. Cuando vence el temporizador, la lectura sigue pendiente. La respuesta de una orden posterior la consume esa lectura anterior, y el reintento también vence.

Se reprodujo con un puerto ficticio: la primera orden no responde y la segunda sí entrega inmediatamente `AGV {"ok":true}`. **Ambas terminan por timeout**. Antes de usar esta configuración con la placa, cerrar/cancelar la lectura y reconectar tras el timeout, o mantener un único bucle receptor con correlación de órdenes. Añadir una prueba de recuperación; las pruebas existentes no cubren este caso.

### 3. P2: el transporte HTTP del simulador confirma cualquier respuesta 200

Referencia: [servicio.mjs, línea 115](https://github.com/jabj2103/AgroVigia/blob/280292a098d700bba27d8dcd44a4195fd5130444/simulador/servicio.mjs#L115).

`transporteHttp().enviar()` devuelve `ok: true` solo por el código HTTP. Se reprodujo con dos respuestas ficticias 200: `{}` y `{"estado":"rechazado","codigo":"NO_GUARDADO"}`. Ambas se contabilizan como éxito. Una URL equivocada o una respuesta inesperada podría hacer que se descarte el lote sin confirmación de persistencia.

Validar el cuerpo de la respuesta y admitir éxito exclusivamente para `estado: insertado` o `duplicado`, según el contrato de 03g. Una respuesta 200 desconocida debe quedar sin confirmar. Añadir pruebas de JSON inválido y estado incorrecto con HTTP 200.

### 4. P2 antes del despliegue: ejecuciones fallidas pueden conservar claves HTTP

Referencias: [generar-nodo.cjs, línea 61](https://github.com/jabj2103/AgroVigia/blob/280292a098d700bba27d8dcd44a4195fd5130444/n8n/generar-nodo.cjs#L61) y [generar-http.cjs, línea 49](https://github.com/jabj2103/AgroVigia/blob/280292a098d700bba27d8dcd44a4195fd5130444/n8n/generar-http.cjs#L49).

03g/03i desactivan el guardado de ejecuciones correctas y manuales, pero conservan `saveDataErrorExecution: all`. El webhook recibe la clave en una cabecera y 03i también la incorpora a `solicitud_autenticar.p_clave`. Si una ejecución termina como error, su historial puede conservar esos datos.

Es un riesgo identificado por configuración e inspección de código; no se provocó un fallo con claves reales ni se inspeccionaron sus valores. Desactivar la conservación de datos de error para estos flujos o configurar una redacción comprobada, conservando diagnósticos sin secretos. Actualizar los comentarios que afirman que las cabeceras nunca se registran. [Documentación oficial de n8n sobre datos de ejecución](https://docs.n8n.io/hosting/scaling/execution-data/).

### 5. P2 de portabilidad: cinco pruebas de n8n fallan con CRLF

En una copia recién descargada en Windows, n8n obtiene **102/107**: fallan cinco comparaciones literales entre código fuente y Code incrustado. Comprobado que los finales CRLF del checkout y LF del JSON son distintos. Normalizando únicamente finales de línea en los archivos `.cjs`/`.mjs` de la copia aislada, sin cambiar lógica ni expectativas, pasan **107/107**.

Afecta las comparaciones de 03g, 03i, 03f, 03h y 03a. Añadir reglas de finales de línea del repositorio y/o normalizar esas comparaciones. La copia principal de Juan no se normalizó ni modificó para estas pruebas.

### 6. Pendientes funcionales y de presentación

- Las plantillas traen Yuca, Plátano, Hortalizas, Mango, Papaya y Maracuyá. Maíz y Papa, mencionados antes, siguen pendientes como plantillas propias. El campo `fuente` contiene una referencia genérica a literatura, sin publicaciones/versiones identificables. Mantener los valores como demostración orientativa y completar trazabilidad antes de recomendarlos como óptimos.
- `provisionar-hexagonos.sql` puede asignar la plantilla Plátano al cultivo actual del primer ESP32 si no tenía otra. Elegir deliberadamente el cultivo de la demostración y su plantilla antes de ejecutarlo; no deducir la especie a partir del código de una placa.
- En la captura móvil del escenario, varias etiquetas de los nodos/cultivos 3D se superponen. Mejorar el encuadre o mostrar etiquetas al seleccionar/según nivel de zoom. La lista alternativa sigue siendo útil. La prueba funcional de WebGL aprobada no sustituye este ajuste visual.
- Los guiones nuevos de arranque son Bash/Linux. Preparar el recorrido equivalente de Windows o acordar WSL/Docker; no reemplazar directamente las terminales/credenciales existentes de Juan. Usar un entorno a la vez para evitar competir por 5678/18883.
- Placa física con firmware HTTP/HTTPS y despliegue remoto siguen pendientes de prueba. El firmware nuevo incluye verificación TLS por defecto; no es necesario sustituir el firmware MQTT operativo para integrar primero las pantallas/IA/simulador.

## Comprobaciones ejecutadas

| Comprobación | Resultado |
|---|---|
| Web: `npm test` | 57/57 |
| Web: `npm run build` | Aprobado; aviso de bundles de más de 500 kB |
| SQL/PGlite: `npm test` | 70/70; incluye 0009–0012, RLS, regresión e idempotencia |
| Simulador: `npm test` | 40/40, con transporte HTTP contra servidor ficticio |
| n8n: checkout Windows original | 102/107, cinco comparaciones de finales de línea |
| n8n: copia normalizada a LF | 107/107 |
| Navegador IA/escenario/terreno | Aprobado con fixtures, WebGL por software y tamaños móviles/escritorio |
| Navegador de zonas | Aprobado con fixtures |
| Recuperación USB tras timeout | Reproducción confirma el problema descrito |
| HTTP 200 con cuerpo incorrecto | Reproducción confirma el falso positivo |
| Supabase conectado | Consultas de esquema/conteos/migraciones/advisors, solo lectura |

Las dependencias se instalaron únicamente en la copia aislada con el lockfile, `--ignore-scripts` y sin auditoría/redirección de las configuraciones privadas. No se instalaron servicios, no se inició Docker ni se ejecutaron los guiones `local-iniciar`, pruebas que escriben en la nube o llamadas a Gemini. No se compiló/cargó firmware físico. No se ejecutaron todas las suites de navegador del repositorio: las dos indicadas fueron las seleccionadas para esta revisión.

Los advisors del proyecto actual señalaron RPC `SECURITY DEFINER` accesibles a usuarios autenticados y un cursor con RLS sin política. Esos objetos forman parte del diseño anterior de funciones autorizadas y estado interno; esos avisos no demuestran por sí solos acceso indebido. No se cambiaron permisos automáticamente. Revisar las verificaciones de propiedad/grants al ampliar el esquema. También se reportó protección de contraseñas filtradas desactivada, sin cambiar configuración Auth.

## Siguientes pasos propuestos

### Preparación de la rama de integración

Juan creó y publicó `juan/integracion-camilo` desde el commit revisado `280292a`. El guion de preparación conservó las ramas originales, recuperó los archivos pendientes y dejó un respaldo local.

### Orden de trabajo

1. **Integración de código aislada.** Se corrigieron la recuperación USB, la confirmación HTTP, los finales de línea y el historial de ejecuciones de 03g y 03i. Las comprobaciones de estas correcciones están registradas en [estado.md](../estado.md).
2. **Preparar Supabase.** Inventariar y respaldar la base actual, reconciliar las versiones manuales 0001–0008 y preparar/aplicar 0009–0012 en orden, con verificadores, RLS y regresión. Revisar el aprovisionamiento de demostración por separado de las migraciones.
3. **Mantener una demostración en Windows.** Empezar con la nube actual y los servicios de Juan; configurar credenciales existentes y flujos actualizados, evitando receptores duplicados. Añadir el servicio automático de simulación y 03h a petición. Acordar modelo/clave/límites de Gemini antes de probar llamadas reales.
4. **Prueba completa en la cuenta.** Ajuste de clima o variable → lote simulado → alerta de regla → sugerencia con evidencias → consulta web. Comprobar los datos reales separados, una segunda cuenta, duplicados y fallos de IA.
5. **Después, hardware y alojamiento.** Probar el firmware nuevo por USB/HTTPS con una placa y conservar el MQTT operativo como referencia. Revisar usabilidad móvil, fuentes agronómicas y persistencia/disponibilidad antes de publicar en Render.

La conexión de Supabase permite ahora hacer inventarios, comprobar permisos, revisar migraciones, generar tipos y ejecutar verificaciones sin copiar claves al chat. En esta revisión se usó solo para leer; la aplicación de cambios queda como la siguiente tarea de integración.
