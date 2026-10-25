# Diccionario de datos - AgroVigía

Propuesta para el apartado 6.3. Once tablas propias en PostgreSQL/Supabase. `auth.users` es una tabla administrada por Supabase y solo se referencia su clave primaria. La estructura todavía no se ha desplegado.

Las figuras BD01-BD04 son vistas del mismo modelo. Una tabla repetida no es una tabla adicional. `P` = PK, `F` = FK, `?` = admite NULL. En las figuras se abrevia numeric como num, boolean como bool y smallint como int2; los tipos completos están aquí.

## perfiles

Datos del agricultor; las credenciales pertenecen a Supabase Auth.

| Campo | Tipo PostgreSQL | Clave | NULL | Descripción |
|---|---|---|---|---|
| id | uuid | PK, FK | No | Mismo identificador de auth.users.id; no contiene contraseña. |
| nombre | text |  | No | Nombre del agricultor. |
| creado_en | timestamptz |  | No | Creación del perfil. Valor inicial: `now()`. |

Clave primaria: `(id)`.

Relaciones:

- `(id)` → `auth.users(id)`.

Validaciones de la estructura:

- `length(btrim(nombre)) > 0`.

## cultivos

Cultivos registrados por cada agricultor.

| Campo | Tipo PostgreSQL | Clave | NULL | Descripción |
|---|---|---|---|---|
| id | uuid | PK | No | Identificador. Valor inicial: `gen_random_uuid()`. |
| agricultor_id | uuid | FK | No | Propietario del cultivo. |
| nombre | text |  | No | Nombre o identificación del lote. |
| tipo | text |  | No | Tipo de cultivo. |
| area | numeric(12,4) |  | No | Área positiva. |
| unidad_area | text |  | No | ha o m2. |
| solicitud_id | uuid |  | No | Identifica el registro para reintentos sin duplicar. |
| creado_en | timestamptz |  | No | Creación del registro. Valor inicial: `now()`. |

Clave primaria: `(id)`.

Relaciones:

- `(agricultor_id)` → `perfiles(id)`.

Restricciones de unicidad:

- `UNIQUE (id, agricultor_id)`.
- `UNIQUE (agricultor_id, solicitud_id)`.

Validaciones de la estructura:

- `length(btrim(nombre)) > 0`.
- `length(btrim(tipo)) > 0`.
- `area > 0 AND area <> 'NaN'::numeric`.
- `unidad_area IN ('ha', 'm2')`.

## nodos

ESP32 habilitados para una cuenta; vinculación actual opcional a un cultivo.

| Campo | Tipo PostgreSQL | Clave | NULL | Descripción |
|---|---|---|---|---|
| id | uuid | PK | No | Identificador. Valor inicial: `gen_random_uuid()`. |
| codigo | text |  | No | Código estable del dispositivo, distinto de una lectura. |
| agricultor_id | uuid | FK | No | Cuenta para la que el equipo habilitó el nodo. |
| cultivo_id | uuid | FK | Sí | Cultivo actual; NULL si está disponible. |
| habilitado | boolean |  | No | Autorización del dispositivo; no significa que esté conectado. Valor inicial: `true`. |
| creado_en | timestamptz |  | No | Alta del dispositivo. Valor inicial: `now()`. |

Clave primaria: `(id)`.

Relaciones:

- `(agricultor_id)` → `perfiles(id)`.
- `(cultivo_id, agricultor_id)` → `cultivos(id, agricultor_id)`.

Restricciones de unicidad:

- `UNIQUE (codigo)`.

Validaciones de la estructura:

- `length(btrim(codigo)) > 0`.

## variables

Catálogo de magnitudes, unidades y límites de validación.

| Campo | Tipo PostgreSQL | Clave | NULL | Descripción |
|---|---|---|---|---|
| codigo | text | PK | No | temperatura_aire, humedad_aire o iluminacion_relativa. |
| nombre | text |  | No | Nombre visible de la variable. |
| unidad | text |  | No | Unidad fija para esta variable. |
| valor_min | numeric(12,4) |  | Sí | Límite de admisibilidad opcional, no umbral de alerta. |
| valor_max | numeric(12,4) |  | Sí | Límite de admisibilidad opcional, no umbral de alerta. |

Clave primaria: `(codigo)`.


Validaciones de la estructura:

- `valor_min IS NULL OR valor_min <> 'NaN'::numeric`.
- `valor_max IS NULL OR valor_max <> 'NaN'::numeric`.
- `valor_min IS NULL OR valor_max IS NULL OR valor_min <= valor_max`.

## nodo_variables

Variables que puede medir cada nodo y sensor que las produce.

| Campo | Tipo PostgreSQL | Clave | NULL | Descripción |
|---|---|---|---|---|
| nodo_id | uuid | PK, FK | No | Nodo sensor. |
| variable_codigo | text | PK, FK | No | Variable admitida por ese nodo. |
| sensor_modelo | text |  | No | DHT22 o LDR en el prototipo. |

Clave primaria: `(nodo_id, variable_codigo)`.

Relaciones:

- `(nodo_id)` → `nodos(id)`.
- `(variable_codigo)` → `variables(codigo)`.

## mediciones

Una observación de una variable en un nodo y un momento.

| Campo | Tipo PostgreSQL | Clave | NULL | Descripción |
|---|---|---|---|---|
| id | uuid | PK | No | Identificador. Valor inicial: `gen_random_uuid()`. |
| cultivo_id | uuid | FK | No | Cultivo al que perteneció la medición al recibirse; se conserva. |
| nodo_id | uuid | FK | No | Nodo de origen. |
| variable_codigo | text | FK | No | Magnitud medida, admitida por el nodo. |
| mensaje_id | text |  | No | ID único por nodo y mensaje; puede compartirse entre variables de un mensaje. |
| valor | numeric(12,4) |  | No | Valor en la unidad del catálogo. |
| tomada_en | timestamptz |  | No | Momento de la lectura con reloj del dispositivo sincronizado. |
| recibida_en | timestamptz |  | No | Momento en el que el servidor la recibió. Valor inicial: `now()`. |
| origen | text |  | No | real o simulado, definido por el flujo autorizado. |

Clave primaria: `(id)`.

Relaciones:

- `(cultivo_id)` → `cultivos(id)`.
- `(nodo_id, variable_codigo)` → `nodo_variables(nodo_id, variable_codigo)`.

Restricciones de unicidad:

- `UNIQUE (nodo_id, mensaje_id, variable_codigo)`.
- `UNIQUE (id, cultivo_id, nodo_id, variable_codigo, origen)`.
- `UNIQUE (id, cultivo_id, origen)`.

Validaciones de la estructura:

- `valor <> 'NaN'::numeric`.
- `origen IN ('real','simulado')`.
- `length(btrim(mensaje_id)) > 0`.

## reglas_alerta

Condiciones configuradas por el equipo para evaluar lecturas.

| Campo | Tipo PostgreSQL | Clave | NULL | Descripción |
|---|---|---|---|---|
| id | uuid | PK | No | Identificador. Valor inicial: `gen_random_uuid()`. |
| cultivo_id | uuid | FK | No | Cultivo al que aplica la regla. |
| variable_codigo | text | FK | No | Variable evaluada. |
| operador | text |  | No | lt, lte, gt o gte. |
| umbral | numeric(12,4) |  | No | Límite ambiental revisado para esta regla. |
| prioridad | smallint |  | No | 1 alta, 2 media, 3 baja. |
| activa | boolean |  | No | Indica si la regla se aplica. Valor inicial: `true`. |
| hora_inicio | time |  | Sí | Inicio de ventana local; ambos horarios NULL significan todo el día. |
| hora_fin | time |  | Sí | Fin de ventana; admite intervalos que cruzan medianoche. |
| zona_horaria | text |  | No | Zona usada al evaluar el horario. Valor inicial: `'America/Bogota'`. |

Clave primaria: `(id)`.

Relaciones:

- `(cultivo_id)` → `cultivos(id)`.
- `(variable_codigo)` → `variables(codigo)`.

Restricciones de unicidad:

- `UNIQUE (id, cultivo_id, variable_codigo)`.

Validaciones de la estructura:

- `operador IN ('lt','lte','gt','gte')`.
- `umbral <> 'NaN'::numeric`.
- `prioridad BETWEEN 1 AND 3`.
- `(hora_inicio IS NULL) = (hora_fin IS NULL)`.
- `hora_inicio IS NULL OR hora_inicio <> hora_fin`.

## alertas

Episodios de condiciones ambientales; revisión y cierre independientes.

| Campo | Tipo PostgreSQL | Clave | NULL | Descripción |
|---|---|---|---|---|
| id | uuid | PK | No | Identificador. Valor inicial: `gen_random_uuid()`. |
| regla_id | uuid | FK | No | Regla que originó el episodio. |
| cultivo_id | uuid | FK | No | Cultivo del episodio. |
| nodo_id | uuid | FK | No | Nodo evaluado. |
| variable_codigo | text | FK | No | Variable que disparó la alerta. |
| origen | text | FK | No | real o simulado; no se mezclan episodios. |
| medicion_inicio_id | uuid | FK | No | Primera medición del episodio. |
| medicion_ultima_id | uuid | FK | No | Última medición que sustenta el estado. |
| prioridad | smallint |  | No | Prioridad al abrir el episodio. |
| descripcion | text |  | No | Descripción de la condición detectada. |
| criterio | jsonb |  | No | Copia del operador, umbral, horario y zona que se aplicaron. |
| abierta_en | timestamptz |  | No | Apertura del episodio. Valor inicial: `now()`. |
| revisada_en | timestamptz |  | Sí | NULL si no ha sido marcada como revisada. |
| cerrada_en | timestamptz |  | Sí | NULL mientras la condición siga activa. |

Clave primaria: `(id)`.

Relaciones:

- `(regla_id, cultivo_id, variable_codigo)` → `reglas_alerta(id, cultivo_id, variable_codigo)`.
- `(medicion_inicio_id, cultivo_id, nodo_id, variable_codigo, origen)` → `mediciones(id, cultivo_id, nodo_id, variable_codigo, origen)`.
- `(medicion_ultima_id, cultivo_id, nodo_id, variable_codigo, origen)` → `mediciones(id, cultivo_id, nodo_id, variable_codigo, origen)`.

Validaciones de la estructura:

- `prioridad BETWEEN 1 AND 3`.
- `origen IN ('real','simulado')`.
- `jsonb_typeof(criterio) = 'object'`.
- `revisada_en IS NULL OR revisada_en >= abierta_en`.
- `cerrada_en IS NULL OR cerrada_en >= abierta_en`.

## sugerencias_ia

Sugerencias aceptadas tras validar la respuesta del modelo.

| Campo | Tipo PostgreSQL | Clave | NULL | Descripción |
|---|---|---|---|---|
| id | uuid | PK | No | Identificador. Valor inicial: `gen_random_uuid()`. |
| cultivo_id | uuid | FK | No | Cultivo al que corresponde la sugerencia. |
| contenido | text |  | No | Explicación y sugerencia que verá el agricultor. |
| modelo | text |  | No | Identificador real del modelo empleado; no una clave de acceso. |
| generada_en | timestamptz |  | No | Momento de generación. Valor inicial: `now()`. |
| origen | text |  | No | Origen común de las mediciones de soporte. |
| contexto_desde | timestamptz |  | No | Inicio del periodo de soporte. |
| contexto_hasta | timestamptz |  | No | Última fecha de las lecturas utilizadas. |
| contexto | jsonb |  | No | Copia del contexto auxiliar: horario, reglas y guía empleada. Valor inicial: `'{}'::jsonb`. |

Clave primaria: `(id)`.

Relaciones:

- `(cultivo_id)` → `cultivos(id)`.

Restricciones de unicidad:

- `UNIQUE (id, cultivo_id, origen)`.

Validaciones de la estructura:

- `length(btrim(contenido)) > 0`.
- `length(btrim(modelo)) > 0`.
- `origen IN ('real','simulado')`.
- `contexto_desde <= contexto_hasta AND contexto_hasta <= generada_en`.
- `jsonb_typeof(contexto) = 'object'`.

## sugerencia_mediciones

Relación de las sugerencias con sus mediciones de soporte.

| Campo | Tipo PostgreSQL | Clave | NULL | Descripción |
|---|---|---|---|---|
| sugerencia_id | uuid | PK, FK | No | Sugerencia sustentada. |
| medicion_id | uuid | PK, FK | No | Medición utilizada. |
| cultivo_id | uuid | FK | No | Debe coincidir en ambos registros. |
| origen | text | FK | No | Debe coincidir en ambos registros. |

Clave primaria: `(sugerencia_id, medicion_id)`.

Relaciones:

- `(sugerencia_id, cultivo_id, origen)` → `sugerencias_ia(id, cultivo_id, origen)`.
- `(medicion_id, cultivo_id, origen)` → `mediciones(id, cultivo_id, origen)`.

## predicciones

Resultados temporales previstos para una etapa posterior.

| Campo | Tipo PostgreSQL | Clave | NULL | Descripción |
|---|---|---|---|---|
| id | uuid | PK | No | Identificador. Valor inicial: `gen_random_uuid()`. |
| cultivo_id | uuid | FK | No | Cultivo del pronóstico. |
| nodo_id | uuid | FK | No | Nodo que mide temperatura. |
| variable_codigo | text | FK | No | Constante temperatura_aire para este alcance. Valor inicial: `'temperatura_aire'`. |
| valor | numeric(12,4) |  | No | Temperatura pronosticada en °C. |
| modelo | text |  | No | Modelo temporal que se elija y evalúe posteriormente. |
| origen | text |  | No | real o simulado según el histórico de entrada. |
| generada_en | timestamptz |  | No | Generación del resultado. Valor inicial: `now()`. |
| objetivo_en | timestamptz |  | No | Momento futuro que se pronostica. |
| vigente_hasta | timestamptz |  | No | Fin de vigencia, no posterior al momento objetivo. |
| referencia_desde | timestamptz |  | No | Inicio del histórico de referencia. |
| referencia_hasta | timestamptz |  | No | Fin del histórico de referencia. |

Clave primaria: `(id)`.

Relaciones:

- `(cultivo_id)` → `cultivos(id)`.
- `(nodo_id, variable_codigo)` → `nodo_variables(nodo_id, variable_codigo)`.

Validaciones de la estructura:

- `variable_codigo = 'temperatura_aire'`.
- `valor <> 'NaN'::numeric`.
- `origen IN ('real','simulado')`.
- `objetivo_en > generada_en`.
- `vigente_hasta > generada_en AND vigente_hasta <= objetivo_en`.
- `referencia_desde < referencia_hasta AND referencia_hasta <= generada_en`.
- `length(btrim(modelo)) > 0`.

## Relaciones y decisiones que necesitan explicación

### Una medición corresponde a una variable

La lectura del DHT22 puede producir dos filas: temperatura del aire y humedad relativa del aire. Si ambas viajan en un mensaje MQTT, pueden compartir mensaje_id y nodo_id, porque su variable_codigo es diferente. El LDR produce la variable iluminacion_relativa. El mensaje_id debe distinguir también reinicios del ESP32; un contador que vuelve a cero por sí solo no es suficiente. La unidad no se repite en cada fila: se obtiene de variables. Una variable no cambia de unidad para datos históricos ya almacenados.

### Propiedad del cultivo y de los nodos

Cada cultivo y cada nodo pertenece a una cuenta. El equipo habilita los nodos antes de que el agricultor los seleccione. nodos.cultivo_id es NULL mientras el nodo está disponible y contiene una sola referencia cuando está vinculado. Su FK compuesta impide seleccionar un cultivo de otra cuenta. La operación registrar_cultivo deberá bloquear y comprobar todos los nodos seleccionados y confirmar el cultivo con al menos uno, en una sola transacción. La cardinalidad estructural admite un cultivo todavía sin nodos durante la preparación de la operación; el mínimo del registro lo controla esa operación.

### Históricos que no cambian de cultivo

mediciones.cultivo_id es el cultivo de la lectura al recibirse. El trigger propuesto comprueba la vinculación actual al insertar, y posteriormente esa referencia histórica no se actualiza al mover el nodo. Así, las consultas y los permisos del histórico no dependen exclusivamente del cultivo que el nodo tenga hoy. Las mediciones confirmadas no se modifican; otra observación se registra en otra fila. El protocolo para transferir la propiedad de nodos entre cuentas queda fuera del prototipo.

### Revisión y cierre de alertas

Una alerta está activa cuando cerrada_en es NULL. Está revisada cuando revisada_en no es NULL. Ambas situaciones pueden coexistir. La fecha de revisión se asigna en el servidor. El índice parcial único de (regla_id, nodo_id, origen) con cerrada_en IS NULL evita duplicar el episodio abierto. La primera y la última medición deben corresponder al mismo cultivo, nodo, variable y origen; las FK compuestas lo exigen. criterio conserva los parámetros efectivamente aplicados, aunque después se modifique la configuración de la regla.

### Evidencia de las sugerencias

Una sugerencia puede utilizar lecturas de los dos nodos. sugerencia_mediciones permite esa relación de muchos a muchos y sus FK compuestas obligan a usar el mismo cultivo y origen. La operación guardar_sugerencia deberá guardar la sugerencia con al menos una evidencia en una sola transacción, después de comprobar que las lecturas sean pertinentes y sus fechas coincidan con el periodo declarado. contexto guarda una copia del contexto auxiliar utilizado, por ejemplo hora, reglas y referencia de la guía, y no una credencial ni un texto de implementación.

### Predicciones previstas

predicciones solo admite temperatura_aire. Guarda valor en °C, nodo, modelo, generación, objetivo futuro, vigencia y periodo histórico de referencia. El servicio que la produzca deberá comprobar la pertenencia del nodo al cultivo y la suficiencia y procedencia del histórico. Para reconstruir los datos disponibles en el momento de generación, se debe considerar también recibida_en. La tabla puede permanecer vacía hasta elegir y evaluar el modelo temporal; no supone que Gemini ya haga la predicción numérica.

### Identificadores y fechas

Las entidades utilizan UUID; los catálogos utilizan códigos de texto y las relaciones intermedias usan claves compuestas. Las fechas con instante se guardan como timestamptz. El dispositivo debe sincronizar su reloj para tomada_en; recibida_en la establece el servidor y no sustituye silenciosamente a la fecha de captura. La vista puede convertir los instantes a la zona del usuario. Los horarios de reglas se evalúan en la zona indicada.

### Normalización y copias de contexto

Se separan cuentas, cultivos, nodos, variables y observaciones, evitando una columna por cada sensor o nodo y evitando tablas de estadísticas calculables. Las copias de cultivo en mediciones y de criterio/contexto se conservan deliberadamente como evidencia histórica. Algunas claves UNIQUE compuestas son redundantes respecto a id, pero permiten que las FK comprueben coincidencias de cultivo, nodo, variable y origen. Los campos repetidos en sugerencia_mediciones quedan sujetos a esas FK y no son valores independientes.

## Controles de acceso propuestos

- Supabase Auth conserva correo, contraseña y sesión. perfiles solo guarda id, nombre y fecha de creación. La cuenta se prepara previamente; no se añade registro público.
- Cada tabla propia tiene RLS. El agricultor solo consulta sus cultivos y los datos relacionados; variables es un catálogo compartido para usuarios autenticados.
- El SQL de referencia permite SELECT al navegador autenticado y no concede escritura directa. Las escrituras del agricultor se habilitarán mediante RPC controladas, con identidad tomada de auth.uid().
- Las credenciales privilegiadas de Supabase y la API de Gemini permanecen en el servidor o n8n. La validación de identidad MQTT debe contrastar tópico y permisos del broker.
- El SQL utiliza ON DELETE RESTRICT para evitar eliminar en cascada el historial por accidente. Un procedimiento de borrado o transferencia de cuentas se diseñaría por separado; no forma parte de los casos actuales.

## Estado del SQL de referencia

01_estructura_propuesta_supabase.sql contiene tablas, claves, restricciones, índices, el catálogo inicial, dos triggers y políticas de lectura. Se revisan estructuralmente los campos y relaciones y se comprueba el modelo en StarUML. El script no se ha ejecutado contra PostgreSQL/Supabase; no se afirma que exista una implementación funcional.

Faltan las RPC registrar_cultivo, registrar_medicion con tratamiento de duplicados, aplicar_estado_alerta, marcar_alerta_revisada, guardar_sugerencia y consultar_historicos, así como los flujos de n8n. La consulta de una medición ya existente debe resolverse antes de volver a intentar insertarla si el nodo ha cambiado de vinculación. Tampoco se han elegido umbrales agronómicos: el equipo deberá fundamentarlos por cultivo y horario.

La escala propuesta para el LDR es 0 a 100 % relativo. Debe documentarse la conversión del circuito, su polaridad y sus referencias antes de comparar umbrales. No es una medida en lux. Los límites 0 a 100 del catálogo de humedad e iluminación validan la escala; no son reglas agronómicas de alerta.

## Correspondencia entre clases y tablas

| Clase | Tabla |
|---|---|
| Agricultor | perfiles |
| Cultivo | cultivos |
| NodoSensor | nodos |
| VariableAmbiental | variables |
| CapacidadNodo | nodo_variables |
| Medicion | mediciones |
| ReglaAlerta | reglas_alerta |
| Alerta | alertas |
| SugerenciaIA | sugerencias_ia |
| EvidenciaSugerencia | sugerencia_mediciones |
| PrediccionTemperatura | predicciones |

VistaWeb y los servicios son responsabilidades de software; no se convierten en tablas. Los métodos de las clases representan operaciones lógicas que se materializarán mediante los componentes acordados.
