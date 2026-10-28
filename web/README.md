# Web local de AgroVigia

React19, TypeScript, Vite, Bootstrap CSS, Supabase JS y Chart.js para historial.
Versiones exactas en package.json/package-lock.json. No hay backend propio,
autorregistro ni escrituras de cultivos/mediciones desde esta version.

## Configurar e iniciar

Las dependencias ya se instalaron en este equipo. En otra copia: npm ci
--ignore-scripts. Se requiere Node24. El iniciador conserva configuracion local.

1. web/.env.local: VITE_SUPABASE_URL=https://REFERENCIA.supabase.co y
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_... de tu proyecto.
2. Nunca usar Secret key, service_role, Gemini ni password de DB en VITE_.
   El arranque/build bloquean claves privadas antes de generar el bundle.
3. Desde la raiz ejecutar:

       powershell -NoProfile -ExecutionPolicy Bypass -File .\web\iniciar-local.ps1

4. Abrir http://127.0.0.1:5173 y mantener la terminal abierta.
5. Ingresar con la cuenta asignada de Supabase Auth, distinta del editor n8n.

La URL no lleva /rest/v1. .env.local/dependencias/dist estan excluidos de Git.
No hay claves privadas del servidor copiadas al frontend. Para dar acceso se
provisionan cuentas por el equipo; revisar altas publicas deshabilitadas en
Supabase si aun no se hizo. La interfaz no ofrece signUp.

## Monitoreo

- Login y cierre de sesion local; perfil/cultivos/nodos filtrados por cuenta/RLS.
- Ultimo lote REAL del nodo/cultivo: DHT22 v1 (dos variables) o ambiental v2
  DHT22+LDR (tres, con ADC/metodo coherentes). No mezcla fechas, UUID ni origen.
- Captura, recepcion de aplicacion aproximada, nodo y UUID identificables.
- Refresco cada30s, Actualizar y antiguedad >180s. Ausencia/error/deshabilitado
  visibles sin declarar salud del cultivo ni causa de desconexion.
- Ante error conserva ultima consulta valida con aviso. No reemplaza por ceros.
- Par0/0 requiere revision; LDR0/4095 conserva dato y avisa extremo ADC.

LDR es indice ADC relativo, no lux ni equivalencia fisica entre sensores.
El nodo anterior sin iluminacion conserva sus valores; no se inventa el LDR.
Solo consulta metadatos cuando el nodo tiene las tres capacidades ambientales.
El cultivo/area1m2 iniciales siguen siendo configuracion de demostracion.

Juan confirma primer nodo, las tres variables actualizadas y consulta SQL
coincidente; tambien cambio de cuenta y antiguedad/recuperacion correctos.
No es evidencia de calibracion ni del segundo dispositivo.

## Historial y estadisticas

Seleccionar Historial y estadisticas en el menu, cultivo, nodo, variable y
periodo; pulsar Consultar historial. Incluye grafica interactiva, numero de
muestras, minimo/maximo/promedio y tabla de20filas por pagina. Solo reales,
fechas Colombia, ceros conservados y ausencia sin inventar valores. Rangos
1h,24h,7dias o personalizados de hasta siete dias. Consulta manual.

Ver [HISTORIAL.md](HISTORIAL.md) para semantica, paginacion, limites y pruebas.
No requiere SQL nuevo ni modificar ESP32/n8n. La segunda placa se incorporara
como otro nodo autorizado cuando tenga sensores y pruebas fisicas.

## Comprobaciones

- npm test:21 pruebas web aprobadas; SDK con HTTP simulado y logica de datos.
- npm run build: TypeScript/bundle aprobados.
- npm run test:browser: QA real de componente en Chrome headless con fixtures,
  escritorio/movil, errores, vacio, filtros, paginacion y cambio de cuenta.
- Estos tests no usan sesiones de Juan ni prueban la API remota autenticada.

Pendiente: historial con sesion real/segunda cuenta, QA responsive del panel
completo y error de red remoto. Hay pruebas previas de ingesta/RLS en SQL y
verificaciones reportadas por Juan; no se sustituyen por estos mocks.

Mantener ESP32, Mosquitto y n8n publicados para nuevas capturas. La web puede
consultar datos guardados aunque no se reciban capturas nuevas. Servidor web
local; no hay hosting de produccion.

Quedan gestion de cultivos/vinculos (CU02), segunda placa, alertas, IA,
comparacion fisica entre sensores y pruebas avanzadas de ingesta/recuperacion.
Guia ambiental: ../docs/integrar-nodo-ambiental.md.