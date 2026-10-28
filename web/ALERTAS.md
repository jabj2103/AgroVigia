# Alertas en la web

Frontend sobre backend0006 y flujo03e ya comprobados por Juan. No requiere mas SQL ni cambios de firmware/n8n, nuevas claves o dependencias. No se crearon reglas reales desde Codex.

## Comprobar con tu cuenta

1. Mantener ESP32, broker y flujo03e publicado. Recargar http://127.0.0.1:5173 e iniciar sesion con tu cuenta habitual.
2. Abrir Alertas en la navegacion inferior (telefono) o lateral (escritorio). Seleccionar el cultivo. Episodios es la vista inicial; filtrar Activas/Cerradas/Todas y Sin revisar/Revisadas/Todas. Si no hay alertas se muestra ausencia de resultados sin afirmar salud.
3. Abrir Reglas. Al no haber configurado reglas reales, debe indicar que no hay reglas activas. Pulsar Configurar regla: seleccionar variable, introducir minimo y/o maximo, comprobar unidades y confirmar antes de Guardar limites. No hay valores agronomicos precargados. Igual al limite esta dentro del rango. Los admitidos corresponden al sensor: -40..80°C, humedad0..100%HR y luz0..100%relativo.
4. Esperar la proxima captura (aprox60s) y actualizacion web (30s), o pulsar Actualizar alertas. Se evaluan nuevas mediciones recibidas, no toda la historia. Si no aparece una alerta fuera de rango, revisar Resultado de alertas del flujo03e: estado evaluada y contadores. Un fallo de evaluacion o captura antigua no se transforma en ausencia de riesgo.
5. En Episodios abrir Ver evidencia para comprobar nodo, valores, limite, fechas y UUID. Marcar como revisada no cierra una alerta activa. Cierre normal requiere una nueva lectura dentro del rango. Editar/desactivar regla o desvincular nodo tiene cierre administrativo, diferenciado de recuperacion ambiental.
6. Revisar 390px y360px en herramientas del navegador y cuenta secundaria sin datos. El cambio de cultivo/cuenta limpia resultados y formularios de la vista anterior. No crear cultivos/nodos ficticios permanentes para llenar la pantalla.

## Prueba fisica opcional de un episodio

Elegir explicitamente una regla TEMPORAL de demostracion, no una recomendacion agronomica. Puede usarse iluminacion relativa: consultar valor ambiental y elegir un maximo entre esa lectura y la obtenida con la linterna que ya se probo. Guardar, iluminar y esperar una captura nueva por encima del limite; debe abrirse un episodio. Mantener la condicion una captura mas debe actualizar el mismo episodio. Marcar como revisada: sigue Activa. Retirar linterna y esperar una captura nueva dentro del rango: pasa a Cerradas manteniendo Revisada. No modificar cableado ni convertir unidades a lux.

Al terminar, desactivar la regla temporal si no se desea mantenerla; el historial del episodio se conserva. Si se cambia el limite en vez de esperar una lectura normal, el cierre sera por cambio de regla y no acredita recuperacion de la condicion. No presentar la regla de demostracion como umbral agronomico valido. La evidencia real del ciclo apertura/actualizacion/revision/cierre sigue pendiente hasta que Juan la compruebe.

## Funciones implementadas

Reglas reales por cultivo, con minimo/maximo opcionales, uno requerido, hasta4decimales, comprobacion de rangos y min<max. Crear/reemplazar via configurar_regla_alerta, confirmacion explicita, editar cargando limites actuales, desactivar con confirmacion. Valores0 y temperaturas negativas preservados. Limites historicos se conservan por backend. Cultivos archivados pueden consultarse en Alertas, sin configurar reglas nuevas.

Episodios con estado de condicion y revision separados, ultimo valor FUERA de rango, umbral que origino alerta, nodo, fecha de evidencia y UUID inicial/ultimo/cierre. Aviso de evidencia >180s y reloj futuro; no inventa estado actual ni indice de salud. Cierres dentro_de_rango/cambio_de_limite/regla_desactivada/nodo_desvinculado se distinguen. Solo RPC publica revisar_alerta; no evalua ni inserta episodios desde el navegador.

Paginacion por cursor abierta_en/UUID descendente, hasta20porpagina, conteo exacto para detectar paginas adicionales incluso con limite API mas pequeno; filtros cultivo/origenreal/condicion/revision en cada peticion. Es un listado vivo, no una instantanea entre paginas; cambios de estado pueden mover elementos entre filtros. Actualizacion30s en primera pagina, pausada durante formulario/confirmacion/operacion; pagina antigua bajo consulta manual. AbortController cancela cargas descartadas. Fallos de consulta conservan solo resultado completo del MISMO filtro/cursor con fecha y aviso; no se muestra resultado anterior como perteneciente a otro cultivo/filtro.

## Validacion

28 pruebas web (24previas+4alertas), build TypeScript/Vite y QA Chrome con SDK/fetch ficticio: revision conserva activa, paginacion, filtros, limites vacios sin defaults, invalidos antes de red, error/reintento, cancelacion/confirmacion de desactivacion, error conservando datos con aviso, cultivo archivado, cambio de cuenta y360/390/768/1280sin overflow. QA de dispositivos tambien aprobado con nueva navegacion. Capturas internas inspeccionadas; fixtures llevan DATOS INVENTADOS y no forman parte del bundle de produccion. No se usaron sesiones del usuario ni se escribio a Supabase desde Codex. No sustituyen JWT/API remoto ni un ciclo fisico real de alertas.

No hay emails, WhatsApp, evaluacion automatica de riesgo agronomico ni sugerencias IA en esta vista. Proxima etapa despues del ciclo real: sugerencias contextualizadas con evidencias y tratamiento de fallos en n8n.

## Campana y avisos dentro de la web

La cabecera y el acceso Alertas muestran el numero de episodios REALES ACTIVOS SIN REVISAR de todos los cultivos autorizados de tu cuenta, aunque estes en Inicio/Historial/Cultivos/Dispositivos. No es el numero de capturas ni solo el cultivo seleccionado. En navegacion se oculta el numero al llegar a0; la cabecera conserva0. Mas de99 se muestra99+, con cantidad completa para lector de pantalla.

Se consulta cada15s, al volver a enfocar/ver la pestaña y despues de confirmar una revision o cambio de regla. Un aviso interno muestra pendientes al entrar y al detectar un episodio pendiente mas reciente; Ocultar aviso no marca revisada ni lo vuelve a mostrar por cada actualizacion del mismo episodio. La campana/Ver alertas abre el cultivo de la alerta pendiente mas reciente y reinicia la vista de episodios. Al revisar baja el contador aunque la alerta siga activa; al cerrar deja de contarse aunque no estuviera revisada. No cambia los estados SQL.

Si falla la consulta aparece ? y aviso de contador sin actualizar, no un cero aparente. El estado se limpia al cambiar de cuenta. Funciona con la web abierta; pestañas en segundo plano pueden tener temporizadores limitados. No solicita permisos del sistema ni envia push/email/WhatsApp con la web cerrada. Es una consulta de pendientes actuales, no una cola de eventos: un episodio abierto y cerrado entre consultas puede no generar aviso.

Recargar web y permanecer en Inicio con una alerta activa sin revisar: debe verse el contador en campana y navegacion. Probar Marcar como revisada y comprobar que baja sin cerrar la condicion. No necesitas SQL ni cambios n8n. Pruebas actualizadas:30unitarias, build, QA de avisos y regresion de alertas con fixtures, error distinto de cero, cambio de cuenta y360/390/768/1280. No se activaron limites ni alertas reales desde Codex.
