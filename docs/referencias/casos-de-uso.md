# AgroVigía: casos de uso del agricultor

Propuesta revisada el 18 de octubre de 2026. Texto para actualizar manualmente las tablas de la sección 5.2.2. El documento de Google Docs no se ha modificado. Los casos describen requisitos previstos, no funciones ya implementadas.

## Criterios comunes

- Actor principal de los ocho casos: **Agricultor**. En los escenarios, utilizar **Sistema** para las respuestas de AgroVigía.
- CU01 utiliza correo electrónico y contraseña de una cuenta habilitada por el equipo. No se incorpora autorregistro.
- El equipo registra y autoriza los nodos para cada cuenta; el agricultor vincula al cultivo uno o ambos nodos disponibles al registrarlo. Esta decisión fue confirmada por el usuario para cerrar CU02.
- Un cultivo puede tener varios nodos. Cada nodo se vincula a un solo cultivo a la vez. El nodo con DHT22 registra temperatura ambiental y humedad relativa del aire; el nodo con LDR registra iluminación relativa. No se supone que todos los nodos midan las tres variables.
- La humedad se expresa como humedad relativa del aire, no humedad del suelo. La iluminación usa una escala relativa documentada; no se denomina lux sin calibración.
- Una lectura antigua se identifica por su fecha y por el intervalo de actualización configurado. La ausencia de mensajes no prueba por sí sola una batería descargada, una falla física ni una pérdida específica de conexión.
- Para CU02 a CU06 y CU08, si la sesión expira durante la operación, el sistema solicita autenticarse nuevamente antes de continuar. Si el cultivo o nodo solicitado no está autorizado para la cuenta, el sistema rechaza el acceso a sus datos. Estas condiciones comunes pueden declararse antes de las tablas o repetirse como excepciones en ellas.
- Los flujos alternativos se anclan al paso principal que los origina: por ejemplo, «4a» deriva del paso 4. Las filas «4a/4b» describen la continuación de esas alternativas, no un paso adicional del escenario principal.
- Las reglas generan las alertas. La IA genera explicaciones contextualizadas. Una sugerencia no es una medición ni un pronóstico numérico validado. CU06 se conserva como función prevista para una etapa posterior.
- Los datos reales y simulados deben distinguirse. No se mezclan como una misma serie o población estadística.
- Los escenarios describen interacciones observables del agricultor con el sistema. Las llamadas a n8n, Supabase, Gemini y los detalles de mensajería se especificarán después en los diagramas internos.

## Índice para mantener nombres consistentes

| Código | Nombre |
|---|---|
| CU01 | Iniciar sesión |
| CU02 | Registrar cultivo |
| CU03 | Consultar condiciones ambientales |
| CU04 | Consultar alertas activas |
| CU05 | Consultar históricos y estadísticas ambientales |
| CU06 | Consultar predicción de temperatura ambiental |
| CU07 | Cerrar sesión |
| CU08 | Consultar sugerencias de IA |

## CU01. Iniciar sesión

**Qué cambiar respecto de la tabla actual:** Sustituir «Ingresar» por «Iniciar sesión», precisar correo y contraseña, admitir navegador en celular o computador y describir la apertura de la sesión y del panel.

### Texto para las celdas de la tabla

**Caso de uso:** CU01. Iniciar sesión.

**Descripción:** El agricultor accede a AgroVigía mediante el correo electrónico y la contraseña de una cuenta previamente habilitada.

**Actor principal:** Agricultor.

**Descripción del actor:** Agricultor con una cuenta habilitada que ingresa sus credenciales para acceder a la información autorizada de sus cultivos.

**Personal involucrado e intereses:** El agricultor desea acceder a su información y a las funciones de monitoreo que tiene autorizadas.

**Precondiciones:** El agricultor dispone de una cuenta previamente habilitada y accede a la interfaz web de AgroVigía.

**Garantías de éxito (postcondiciones):** La aplicación establece una sesión autenticada y presenta el panel principal con acceso a las funciones autorizadas para el agricultor.

### Escenario principal de éxito

| Paso | Actor | Descripción |
| --- | --- | --- |
| 1 | Agricultor | Abre AgroVigía y selecciona la opción de iniciar sesión. |
| 2 | Sistema | Presenta el formulario de correo electrónico y contraseña. |
| 3 | Agricultor | Ingresa sus credenciales y solicita iniciar sesión. |
| 4 | Sistema | Verifica los campos obligatorios y comprueba las credenciales. |
| 5 | Sistema | Establece la sesión y muestra el panel principal. |

### Extensiones o flujos alternativos

| Paso | Actor | Descripción |
| --- | --- | --- |
| 4a | Sistema | Si falta un campo obligatorio o el correo tiene un formato inválido, identifica el campo que debe corregirse y mantiene el formulario disponible. |
| 4b | Sistema | Si las credenciales son inválidas o el acceso no está habilitado, rechaza la autenticación y muestra un mensaje de error sin revelar si existe una cuenta con ese correo. |
| 4a/4b | Agricultor | Corrige la información y vuelve a solicitar el inicio de sesión. |

### Excepciones

| Código | Descripción |
| --- | --- |
| Ex.1 | Si el servicio de autenticación no está disponible o falla la comunicación, informa que no pudo completar el inicio de sesión y permite reintentar; no presenta una autenticación exitosa. |

## CU02. Registrar cultivo

**Qué cambiar respecto de la tabla actual:** Conservar el registro de cultivo e incorporar la decisión confirmada: el agricultor selecciona uno o ambos nodos ya habilitados para su cuenta. Sustituir la digitación de un ID arbitrario y la exigencia de tener físicamente el dispositivo.

### Texto para las celdas de la tabla

**Caso de uso:** CU02. Registrar cultivo.

**Descripción:** El agricultor registra un cultivo y le vincula uno o más nodos previamente habilitados para su cuenta y disponibles para asociación.

**Actor principal:** Agricultor.

**Descripción del actor:** Agricultor autenticado que proporciona los datos del cultivo y selecciona los nodos autorizados que desea vincular.

**Personal involucrado e intereses:** El agricultor desea organizar sus cultivos y asociarles los nodos que utilizará para el monitoreo ambiental.

**Precondiciones:** El agricultor tiene una sesión válida. El equipo ha preparado el registro de los nodos y sus autorizaciones de acceso.

**Garantías de éxito (postcondiciones):** El cultivo queda asociado a la cuenta del agricultor y a los nodos seleccionados. El sistema confirma el registro y permite consultar el cultivo; la disponibilidad de mediciones se comprobará por separado.

### Escenario principal de éxito

| Paso | Actor | Descripción |
| --- | --- | --- |
| 1 | Agricultor | Selecciona la opción de registrar un cultivo. |
| 2 | Sistema | Solicita el nombre, el tipo de cultivo, el tamaño y su unidad de área, y presenta los nodos habilitados para la cuenta que están disponibles para vinculación. |
| 3 | Agricultor | Completa los datos, selecciona uno o más nodos disponibles y solicita guardar el cultivo. |
| 4 | Sistema | Valida los datos y comprueba que los nodos seleccionados están autorizados para esa cuenta y disponibles para asociación. |
| 5 | Sistema | Guarda el cultivo y sus vínculos con los nodos, y confirma el resultado. |

### Extensiones o flujos alternativos

| Paso | Actor | Descripción |
| --- | --- | --- |
| 2a | Sistema | Si no hay nodos disponibles para la cuenta, informa que se requiere habilitar un nodo antes de completar el registro y permite cancelar la operación. |
| 4a | Sistema | Si faltan datos, el tamaño no es válido o no se ha seleccionado un nodo, indica la corrección necesaria y conserva los datos válidos del formulario. |
| 4b | Sistema | Si un nodo dejó de estar disponible o no está autorizado para la cuenta, rechaza esa vinculación y actualiza la lista de nodos seleccionables. |
| 4a/4b | Agricultor | Corrige la información o la selección y vuelve a solicitar el registro. |

### Excepciones

| Código | Descripción |
| --- | --- |
| Ex.1 | Si ocurre un error al guardar o no puede confirmarse el resultado por una interrupción de comunicación, informa que la operación no pudo confirmarse. Antes de repetirla, se comprobará si el cultivo ya quedó registrado para evitar duplicados. |

## CU03. Consultar condiciones ambientales

**Qué cambiar respecto de la tabla actual:** Reemplazar el contenido todavía referido al estado del terreno. Presentar las variables disponibles por nodo y momento, contemplar ausencia y antigüedad de datos y evitar diagnosticar la causa de una falta de transmisión.

### Texto para las celdas de la tabla

**Caso de uso:** CU03. Consultar condiciones ambientales.

**Descripción:** El agricultor consulta las últimas mediciones disponibles de los nodos vinculados a un cultivo para apoyar la supervisión de sus condiciones ambientales.

**Actor principal:** Agricultor.

**Descripción del actor:** Agricultor autenticado que selecciona un cultivo propio para consultar las variables registradas por sus nodos.

**Personal involucrado e intereses:** El agricultor desea conocer las mediciones disponibles, su procedencia y su antigüedad como complemento de la inspección del cultivo.

**Precondiciones:** El agricultor tiene una sesión válida y acceso al cultivo que desea consultar.

**Garantías de éxito (postcondiciones):** El sistema presenta las mediciones disponibles por nodo y variable, con valor, unidad o escala, fecha y hora y origen real o simulado. Identifica los datos antiguos y las variables sin información disponible.

### Escenario principal de éxito

| Paso | Actor | Descripción |
| --- | --- | --- |
| 1 | Agricultor | Selecciona un cultivo y accede a sus condiciones ambientales. |
| 2 | Sistema | Recupera los nodos vinculados al cultivo y las últimas mediciones disponibles de las variables que registra cada uno. |
| 3 | Sistema | Comprueba la validez y la antigüedad de las mediciones según el intervalo de actualización definido. |
| 4 | Sistema | Presenta la temperatura ambiental en °C y la humedad relativa del aire en % HR del nodo con DHT22, y la iluminación relativa del nodo con LDR, identificando cada nodo y el momento de su lectura. |
| 5 | Agricultor | Consulta los valores y su fecha de actualización. |

### Extensiones o flujos alternativos

| Paso | Actor | Descripción |
| --- | --- | --- |
| 2a | Sistema | Si el cultivo todavía no tiene nodos vinculados o no hay mediciones disponibles, informa esa situación sin mostrar ceros como sustitutos de los datos faltantes. |
| 3a | Sistema | Si solo algunos nodos o variables tienen datos, muestra las mediciones disponibles e identifica las que faltan. |
| 3b | Sistema | Si una lectura supera el intervalo de actualización definido, presenta la última medición conocida como información anterior e indica que no se han recibido datos recientes de ese nodo. |

### Excepciones

| Código | Descripción |
| --- | --- |
| Ex.1 | Si falla la recuperación de información, informa que no pudo completar la consulta y permite reintentar. No atribuye el error de consulta a una falla física de los sensores. |

## CU04. Consultar alertas activas

**Qué cambiar respecto de la tabla actual:** Reemplazar falta de agua, riego y afirmaciones de condiciones óptimas. Mantener las alertas por reglas y completar el marcado como revisada mediante un flujo opcional con confirmación del sistema.

### Texto para las celdas de la tabla

**Caso de uso:** CU04. Consultar alertas activas.

**Descripción:** El agricultor consulta las alertas activas registradas cuando las mediciones ambientales cumplen las condiciones configuradas para el cultivo y sus nodos.

**Actor principal:** Agricultor.

**Descripción del actor:** Agricultor autenticado que revisa las alertas de un cultivo y, si lo desea, registra que ha leído una alerta.

**Personal involucrado e intereses:** El agricultor desea identificar las condiciones ambientales señaladas por las reglas del sistema y consultar qué mediciones originaron cada alerta.

**Precondiciones:** El agricultor tiene una sesión válida y acceso al cultivo que desea consultar.

**Garantías de éxito (postcondiciones):** El sistema presenta las alertas activas registradas o informa que no hay alertas disponibles para la consulta. Si el agricultor marca una alerta como revisada, registra y confirma esa revisión sin declarar resuelta la condición ambiental.

### Escenario principal de éxito

| Paso | Actor | Descripción |
| --- | --- | --- |
| 1 | Agricultor | Selecciona un cultivo y accede a la sección de alertas activas. |
| 2 | Sistema | Consulta las alertas activas asociadas a los nodos del cultivo. |
| 3 | Sistema | Presenta la lista ordenada según la prioridad configurada y la fecha del evento, identificando el nodo y la variable. |
| 4 | Agricultor | Selecciona una alerta para consultar su detalle. |
| 5 | Sistema | Muestra la medición y su unidad o escala, la condición configurada que originó la alerta, las fechas correspondientes y su estado de revisión. |
| 6 | Agricultor | Lee la información de la alerta. |

### Extensiones o flujos alternativos

| Paso | Actor | Descripción |
| --- | --- | --- |
| 2a | Sistema | Si no existen alertas activas registradas, informa que no se encontraron alertas; no concluye que todo el cultivo se encuentra en buen estado. |
| 2b | Sistema | Si no hay mediciones recientes que permitan evaluar las reglas, informa la falta de datos recientes y distingue ese estado de la ausencia de alertas. |
| 5a.1 | Agricultor | Si desea registrar la lectura, selecciona la opción de marcar la alerta como revisada. |
| 5a.2 | Sistema | Guarda el estado y la fecha de revisión, y confirma la actualización. Marcar como revisada no cambia por sí mismo la alerta a resuelta. |
| 5a.3 | Sistema | Si la alerta ya estaba revisada, muestra ese estado sin duplicar la operación. |

### Excepciones

| Código | Descripción |
| --- | --- |
| Ex.1 | Si falla la consulta de alertas, informa que no pudo recuperar la información y permite reintentar. |
| Ex.2 | Si no puede confirmarse el cambio de revisión, informa que la actualización no fue confirmada y permite comprobar el estado antes de repetir la acción. |

## CU05. Consultar históricos y estadísticas ambientales

**Qué cambiar respecto de la tabla actual:** Conservar el caso ya corregido. Precisar que se muestran solo las variables del nodo elegido y que las estadísticas se calculan por nodo, variable y origen de datos, sin mezclar mediciones reales y simuladas.

### Texto para las celdas de la tabla

**Caso de uso:** CU05. Consultar históricos y estadísticas ambientales.

**Descripción:** El agricultor consulta las mediciones históricas y las estadísticas de las variables disponibles en un nodo asociado a un cultivo, para el periodo seleccionado.

**Actor principal:** Agricultor.

**Descripción del actor:** Agricultor autenticado que selecciona un cultivo, un nodo y un periodo para consultar sus mediciones.

**Personal involucrado e intereses:** El agricultor desea conocer la evolución de las condiciones ambientales mediante registros y resúmenes que apoyen la supervisión del cultivo.

**Precondiciones:** El agricultor tiene una sesión válida y acceso a un cultivo con un nodo asociado.

**Garantías de éxito (postcondiciones):** El sistema presenta las mediciones disponibles y el promedio, mínimo, máximo y cantidad de registros válidos de cada variable registrada por el nodo para el periodo solicitado. Identifica el nodo, las unidades o escalas y el origen de los datos; los datos reales y simulados se presentan y resumen por separado.

### Escenario principal de éxito

| Paso | Actor | Descripción |
| --- | --- | --- |
| 1 | Agricultor | Accede a históricos y estadísticas y selecciona el cultivo y el nodo. |
| 2 | Sistema | Solicita las fechas de inicio y fin del periodo de consulta. |
| 3 | Agricultor | Establece el periodo y solicita consultar los datos. |
| 4 | Sistema | Valida el periodo y recupera las mediciones correspondientes al nodo y a sus variables disponibles. |
| 5 | Sistema | Calcula el promedio, mínimo, máximo y cantidad de registros válidos por variable y origen de datos. |
| 6 | Sistema | Presenta las gráficas y las estadísticas con el nodo, el periodo, las unidades o escalas y el origen de las mediciones. |

### Extensiones o flujos alternativos

| Paso | Actor | Descripción |
| --- | --- | --- |
| 4a | Sistema | Si la fecha inicial es posterior a la fecha final o alguna fecha es inválida, solicita corregir el periodo antes de continuar. |
| 4b | Sistema | Si no hay mediciones para el periodo, informa que no existen datos disponibles y permite seleccionar otro periodo. |
| 5a | Sistema | Si existen intervalos sin lecturas, los identifica y calcula las estadísticas con los registros válidos disponibles, sin sustituir los datos faltantes por cero. |

### Excepciones

| Código | Descripción |
| --- | --- |
| Ex.1 | Si ocurre un error al recuperar o procesar los datos, informa que no pudo completar la consulta y permite reintentar. |

## CU06. Consultar predicción de temperatura ambiental

**Qué cambiar respecto de la tabla actual:** Conservar como función prevista para una etapa posterior. Permitir seleccionar únicamente nodos que miden temperatura; el nodo LDR no proporciona esta variable. La consulta recupera predicciones disponibles y no entrena modelos.

### Texto para las celdas de la tabla

**Caso de uso:** CU06. Consultar predicción de temperatura ambiental.

**Descripción:** El agricultor consulta una estimación de temperatura ambiental a corto plazo, generada por un modelo de predicción a partir de mediciones anteriores de un nodo que registra temperatura.

**Actor principal:** Agricultor.

**Descripción del actor:** Agricultor autenticado que selecciona un cultivo y un nodo con mediciones de temperatura para consultar una estimación futura.

**Personal involucrado e intereses:** El agricultor desea disponer de una estimación de temperatura como información complementaria a las mediciones observadas.

**Precondiciones:** El agricultor tiene una sesión válida y acceso al cultivo que desea consultar.

**Garantías de éxito (postcondiciones):** Cuando existe una predicción vigente, el sistema presenta la temperatura estimada en °C, el nodo, el momento de generación, el momento pronosticado y el origen de los datos utilizados. La estimación se distingue de las mediciones observadas.

### Escenario principal de éxito

| Paso | Actor | Descripción |
| --- | --- | --- |
| 1 | Agricultor | Selecciona un cultivo y accede a la sección de predicciones. |
| 2 | Sistema | Presenta los nodos vinculados que registran temperatura ambiental. |
| 3 | Agricultor | Selecciona un nodo y solicita consultar su predicción. |
| 4 | Sistema | Recupera la predicción disponible para el nodo seleccionado. |
| 5 | Sistema | Comprueba su vigencia y que el momento pronosticado todavía sea futuro. |
| 6 | Sistema | Presenta la estimación y sus fechas, el origen de los datos utilizados y las mediciones recientes como referencia, diferenciando valores observados y predichos. |
| 7 | Agricultor | Consulta la estimación y su relación con las mediciones recientes. |

### Extensiones o flujos alternativos

| Paso | Actor | Descripción |
| --- | --- | --- |
| 2a | Sistema | Si no hay nodos que registren temperatura asociados al cultivo, informa que la función requiere un nodo con esa variable. |
| 4a | Sistema | Si no hay una predicción generada, informa que no está disponible e indica el motivo cuando esté registrado, como historial insuficiente o modelo todavía no habilitado. |
| 5a | Sistema | Si la predicción no está vigente, informa que no existe una estimación actual disponible e identifica la fecha de la última generación. |

### Excepciones

| Código | Descripción |
| --- | --- |
| Ex.1 | Si ocurre un error al recuperar la predicción, informa que no pudo completar la consulta y permite reintentar. |

## CU07. Cerrar sesión

**Qué cambiar respecto de la tabla actual:** Conservar el caso y ajustar la garantía y el paso 2 al cierre de la sesión de esta aplicación. Evitar afirmar que cualquier credencial emitida queda invalidada de inmediato o que se cerrarán todas las sesiones del usuario.

### Texto para las celdas de la tabla

**Caso de uso:** CU07. Cerrar sesión.

**Descripción:** El agricultor finaliza la sesión actual en AgroVigía desde el navegador que está utilizando y regresa a la pantalla de inicio de sesión.

**Actor principal:** Agricultor.

**Descripción del actor:** Agricultor autenticado que solicita finalizar su sesión actual en la aplicación.

**Personal involucrado e intereses:** El agricultor desea dejar de acceder a su información desde la sesión que utiliza.

**Precondiciones:** El agricultor tiene una sesión iniciada en la aplicación.

**Garantías de éxito (postcondiciones):** La aplicación finaliza la sesión actual, retira la información del agricultor y presenta la pantalla de inicio de sesión. El acceso posterior desde esa interfaz a las funciones protegidas requiere autenticarse nuevamente. Los registros de los cultivos se conservan.

### Escenario principal de éxito

| Paso | Actor | Descripción |
| --- | --- | --- |
| 1 | Agricultor | Selecciona la opción de cerrar sesión. |
| 2 | Sistema | Procesa el cierre de la sesión actual mediante el mecanismo de autenticación. |
| 3 | Sistema | Retira la sesión almacenada y la información del agricultor de la aplicación. |
| 4 | Sistema | Presenta la pantalla de inicio de sesión y confirma el cierre. |

### Extensiones o flujos alternativos

| Paso | Actor | Descripción |
| --- | --- | --- |
| 2a | Sistema | Si la sesión ya había finalizado, presenta la pantalla de inicio de sesión e informa esa situación. |

### Excepciones

| Código | Descripción |
| --- | --- |
| Ex.1 | Si el cierre no puede completarse o confirmarse, informa el problema y permite reintentar sin presentar una confirmación de éxito. |

## CU08. Consultar sugerencias de IA

**Qué cambiar respecto de la tabla actual:** Agregar una tabla nueva. Se consultan sugerencias almacenadas, generadas previamente por el procesamiento del sistema; abrir esta sección no obliga a solicitar una respuesta nueva a Gemini.

### Texto para las celdas de la tabla

**Caso de uso:** CU08. Consultar sugerencias de IA.

**Descripción:** El agricultor consulta sugerencias generadas con inteligencia artificial a partir de las mediciones ambientales y del contexto disponible del cultivo.

**Actor principal:** Agricultor.

**Descripción del actor:** Agricultor autenticado que revisa las sugerencias asociadas a un cultivo propio.

**Personal involucrado e intereses:** El agricultor desea comprender las condiciones registradas y consultar orientaciones de revisión como apoyo a su supervisión.

**Precondiciones:** El agricultor tiene una sesión válida y acceso al cultivo que desea consultar.

**Garantías de éxito (postcondiciones):** El sistema presenta las sugerencias disponibles con su fecha de generación, los nodos y las mediciones utilizadas y el contexto registrado. Las sugerencias se distinguen de las mediciones, las alertas por reglas y las predicciones de temperatura.

### Escenario principal de éxito

| Paso | Actor | Descripción |
| --- | --- | --- |
| 1 | Agricultor | Selecciona un cultivo y accede a la sección de sugerencias de IA. |
| 2 | Sistema | Consulta las sugerencias almacenadas para el cultivo y sus referencias a las mediciones utilizadas. |
| 3 | Sistema | Presenta las sugerencias disponibles con su fecha de generación. |
| 4 | Agricultor | Selecciona una sugerencia para consultar su detalle. |
| 5 | Sistema | Muestra la explicación, los nodos, las variables, los valores, las fechas y el contexto que sustentan la sugerencia, identificando el origen real o simulado de las mediciones. |
| 6 | Agricultor | Lee la explicación y las orientaciones de revisión. |

### Extensiones o flujos alternativos

| Paso | Actor | Descripción |
| --- | --- | --- |
| 2a | Sistema | Si no existen sugerencias almacenadas, informa que no hay sugerencias disponibles. Cuando exista un motivo registrado de falta de generación, lo comunica sin concluir que las condiciones del cultivo son adecuadas. |
| 5a | Sistema | Si las mediciones utilizadas son anteriores a las condiciones recientes, identifica la sugerencia como información anterior y muestra las fechas correspondientes. |

### Excepciones

| Código | Descripción |
| --- | --- |
| Ex.1 | Si falla la consulta de sugerencias, informa que no pudo recuperar la información y permite reintentar. La indisponibilidad de Gemini no impide por sí sola consultar sugerencias ya almacenadas. |

## Diagrama de casos de uso: sección 5.2.1

Mantener el actor Agricultor fuera del límite de AgroVigía y los ocho casos dentro, con una asociación entre el agricultor y cada caso. Este diagrama representa específicamente los casos de uso del agricultor; las comunicaciones automáticas de los nodos se documentarán en el diseño y los flujos internos del sistema.

No utilizar flechas entre los óvalos para señalar el orden de uso. La sesión iniciada es una precondición de las funciones protegidas: no se incorpora «Iniciar sesión» como include de todas las consultas. Las alertas pueden consultarse sin que exista una sugerencia de IA y las sugerencias no dependen de que el agricultor consulte primero las alertas; no se añade una dependencia obligatoria entre CU04 y CU08.

No hace falta agregar nuevos casos solo para nombrar Mosquitto, n8n, Supabase o Gemini. La generación de alertas, sugerencias y predicciones se describe como procesamiento del sistema, separado del objetivo de consultarlas.

## Notas para mantener la coherencia en las siguientes etapas

1. Conservar estos códigos y pasos cuando se elaboren las secuencias del sistema. Las respuestas del sistema pueden agrupar actividades internas; no es necesario convertir cada validación en una interacción visible separada.
2. La metodología actual indica que el equipo prepara la «vinculación inicial» de nodos. Cuando se revise esa coherencia, precisar que el equipo registra y habilita los nodos para la cuenta, mientras que el agricultor los asocia al cultivo en CU02. Esta nota no cambia otras secciones en esta entrega.
3. La opción de marcar una alerta como revisada queda como flujo opcional de CU04. Su estado de revisión se conserva por separado de la condición activa o resuelta de la alerta. Esta diferencia deberá reflejarse en la base de datos y en la interfaz.
4. El periodo de vigencia de una predicción y el intervalo que define una lectura antigua son parámetros que se documentarán; no se inventan valores de minutos sin relacionarlos con el muestreo y el horizonte del modelo.
5. CU07 se refiere a cerrar la sesión actual. Al implementar Supabase Auth se configurará el alcance local de cierre. El servicio distingue el cierre de sesión de la caducidad de los tokens de acceso ya emitidos; por eso la postcondición describe lo que retira la aplicación y lo que exige la interfaz, y evita prometer revocación instantánea de todas las credenciales.
6. La falta de disponibilidad de Gemini afecta a la generación de nuevas sugerencias; las mediciones válidas se siguen almacenando y las sugerencias existentes pueden consultarse si el almacenamiento está accesible.

## Fuentes de contraste

- Documento revisado: https://docs.google.com/document/d/1TUiRxQMUcuQ2h0FtAWkGTEOVjl9I2Mzi3uqfOjV4Hww
- Notación de casos de uso de Visual Paradigm: https://www.visual-paradigm.com/support/documents/vpuserguide/94/2575/84257_usecasediagr.html
- Alcances y comportamiento del cierre de sesión de Supabase: https://supabase.com/docs/guides/auth/signout

