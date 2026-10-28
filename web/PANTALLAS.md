# Pantallas y gestion de cultivos

La interfaz adopta el fondo oscuro, verdes, tarjetas y navegacion para telefono de los diez mockups de Muckups.zip aportados por Juan. En escritorio conserva un menu lateral y aprovecha el ancho. Sin nuevas dependencias ni cambios de firmware, MQTT, SQL o claves en esta etapa.

## Comprobar con tu cuenta real

1. Mantener n8n, Mosquitto y ESP32 funcionando. Si la web ya estaba abierta, recargar http://127.0.0.1:5173. Si no arranca, usar el lanzador web/iniciar-local.ps1 habitual.
2. Iniciar sesion. Revisar tema oscuro y temperatura/humedad del aire/iluminacion relativa reales del cultivo actual. No se presenta humedad del suelo, lux, salud ni un indice de rendimiento.
3. Pulsar Cultivos. Debe aparecer tu cultivo en Activos. Abrir Editar, comprobar datos y cancelar primero. Puedes probar un cambio deliberado de nombre y guardarlo; comprobarlo tras Actualizar cuenta y recargar. No cambia la identidad ni las mediciones.
4. Pulsar Registrar cultivo. Solo muestra nodos propios habilitados sin cultivo. Con el unico nodo real ocupado, muestra que no hay disponibles e impide guardar. Cancelar. No hay que archivar el cultivo actual para probar este paso.
5. Abrir Historial desde la tarjeta y comprobar sus datos reales. Volver a Inicio. En F12/Ctrl+Shift+M comprobar a 390px navegacion inferior Inicio/Historial/Cultivos y menu desplegable para cuenta/cierre de sesion. En escritorio menu lateral.
6. Comprobar segunda cuenta: no debe mostrar datos ni nodos de la primera. No crearle perfiles/nodos ficticios para llenar la interfaz.

Archivar es una operacion real: exige marcar una casilla y confirmar; conserva historial, libera nodos y detiene la persistencia de nuevas capturas para ese cultivo. No hay restauracion en esta etapa. Probarlo solo cuando se quiera ese efecto, no para ensayar la pantalla. Si falla una solicitud de cambio, actualizar la cuenta antes de asumir que no se guardo. Reintentar la misma creacion conserva el UUID de solicitud; salir del formulario inicia otra solicitud.

## Incluido

Login adaptado, panel con tarjetas de variables, menu movil con teclado/Escape, navegacion inferior y escritorio, historial con tema oscuro, Mis cultivos activos/archivados, alta con uno/dos nodos disponibles, edicion, confirmacion de archivado y acceso al historial archivado. Monitoreo filtra cultivos archivados; historial los conserva. No se dan permisos nuevos al navegador: se usan las RPC authenticated de 0004 con propietario derivado de la sesion.

## Comprobaciones y limites

23 pruebas de web y compilacion TypeScript/Vite; QA Chrome local con fetch SDK ficticio: editar, crear, error/reintento con mismo cuerpo, nodo ocupado/no disponibles, cancelar/confirmar archivado, consulta archivada, monitoreo sin archivados, navegacion movil y anchos 360/390/768/1280. QA de historial existente tambien aprobado. Los fixtures llevan banner DATOS INVENTADOS, no forman parte del paquete de produccion y no prueban Auth/API/RLS remoto. No se utilizaron sesiones del navegador del usuario ni se escribio a Supabase. Capturas internas en .local/qa-cultivos.

Pendiente comprobacion real de botones/API con la cuenta. Siguientes funciones: vincular/desvincular nodos de cultivos existentes, dispositivos y auditoria de cambios; alertas, reglas y sugerencias IA despues. Autorregistro, recuperacion de clave, soporte, ajustes y prediccion no tienen botones aparentando estar implementados. Graficas pequenas en tarjetas y pantallas dedicadas por variable pueden incorporarse despues sobre consultas reales; ahora la grafica completa esta en Historial.

Asignacion posterior disponible en Mis dispositivos; instrucciones y migracion0005 en [APLICAR_NODOS.md](../supabase/APLICAR_NODOS.md). Una transferencia de nodo requiere detenerlo, dejar pasar siete minutos y mantenerlo apagado durante el cambio. La pantalla no verifica fisicamente esa espera.
