# Historial y estadisticas del primer nodo

Se avanza en CU05 mientras falta el DHT22 del segundo ESP32. El primer nodo
ambiental y su verificacion SQL fueron confirmados por Juan. Esta ampliacion
solo lee las tablas existentes; no cambia firmware, n8n, RLS ni migraciones.

## Uso

1. Con la web local abierta, recargar y entrar en Historial y estadisticas.
2. Seleccionar cultivo, nodo, variable y periodo. Al abrir consulta la ultima
   hora de temperatura. Opciones:1h,24h,7dias o fechas propias hasta siete dias.
3. Pulsar Consultar historial. Las fechas personalizadas se interpretan en
   hora de Colombia, con precision de minutos; los extremos son inclusivos.
4. Revisar grafica, cantidad de muestras, minimo, maximo, promedio y tabla.
   La tabla muestra veinte filas por pagina, mas recientes primero.

Cambiar filtros no cambia un resultado ya consultado hasta volver a consultar.
El periodo y nodo del resultado quedan identificados. El historial se actualiza
por consulta manual; Monitoreo conserva su refresco automatico de30s.
El boton Actualizar cuenta recarga catalogo/capacidades, no recalcula el periodo
historico. Nuevos datos se incorporan al volver a Consultar historial.

Los nodos autorizados de la cuenta pueden seleccionarse incluso deshabilitados
para consultar su historia. El filtro cultivo usa el cultivo guardado en cada
medicion. No se fabrican nodos, registros ni lecturas para la segunda placa.

## Interpretacion

Solo origen real. Una variable/nodo por consulta, con su unidad y fechas de
captura/recepcion aproximada. El promedio es aritmetico de las muestras, sin
ponderacion temporal ni diagnostico del cultivo. Los ceros numericos cuentan.
Sin datos no se muestran estadisticas cero. No se rellenan huecos con valores
inventados; intervalos mayores de180s interrumpen la linea de la grafica.

Iluminacion conserva metodo adc12_10k_11db_v1 y formula documentados. Se comprueba
ADC/metodo/indice por fila; no se mezclan metodos desconocidos ni se llama lux.
0/100 son extremos del ADC. Dos sensores requieren comparacion fisica conjunta
antes de interpretar diferencias de ubicacion; el segundo aun no esta probado.

## Consulta y limites

El cliente Supabase autentica como la cuenta actual; RLS sigue siendo la
barrera de acceso. Cada pagina filtra cultivo,nodo,variable,origen y captura
inicio/fin; limita recibida_en al instante de inicio de consulta. Orden por
captura/id ascendente y cursor, sin OFFSET. Continua tras paginas cortas hasta
recibir una vacia; no depende del limite por defecto de mil filas de la API.
Maximo12000muestras/50peticiones por consulta. Si se supera o una pagina falla,
no publica resultados parciales ni estadisticas incompletas; pide acotar rango.
Se conserva el ultimo resultado completo con su periodo y aviso de error.

Esto no es un snapshot transaccional compartido entre peticiones: un lote con
recepcion anterior al corte pero aun sin confirmar durante alguna pagina puede
aparecer en una nueva consulta. Los registros confirmados son inmutables y el
cursor evita desplazamientos/duplicados por nuevas filas. No se promete una
instantanea de la base al milisegundo ni disponibilidad offline.

Los cambios de cuenta/cultivo desmontan la vista y cancelan la consulta previa,
sin reutilizar sus resultados. El boton Cancelar consulta aborta la peticion.
La clave de servidor sigue reservada a n8n; web usa Publishable key/sesion.

## Verificaciones

- npm test:21 casos web (12 anteriores+9 historial), incluidos filtros en todas
  las paginas, mas de1000filas, paginas cortas, errores sin parcial, duplicados,
  ceros, fechas Bogota/calendario, huecos, cancelacion y metodo LDR.
- npm run build: TypeScript/Vite. Chart.js4.6.1 carga en un chunk solo al entrar
  al historial; Monitoreo no importa su grafica al inicio.
- npm run test:browser: Chrome/Edge headless, perfil temporal propio y fixture
  de pruebas sin API remota. Comprueba canvas, tabla/paginacion, dos nodos
  ficticios, error conservando resultado, vacio, cambio a cuenta sin nodos y
  ancho390px sin desbordamiento. Cierra su servidor5183 y navegador propios.
  No usa el perfil/sesion del navegador de Juan. Requiere Chrome/Edge instalado;
  AGROVIGIA_CHROME permite indicar otro ejecutable, sin descarga de navegador.

Pendiente prueba con sesion/datos reales de Juan y su segunda cuenta desde
esta pantalla. Las pruebas de UI con fixtures no acreditan Auth/RLS por API.
Tampoco prueban el segundo dispositivo fisico, gestion CU02, alertas o IA.

Fuentes de API:
- https://www.chartjs.org/docs/latest/charts/line.html
- https://www.chartjs.org/docs/latest/axes/cartesian/linear.html
- https://supabase.com/docs/reference/javascript/or