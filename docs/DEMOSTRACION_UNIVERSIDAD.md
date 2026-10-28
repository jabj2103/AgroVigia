# Demostracion de AgroVigia en la universidad

Guia del28deoctubre2026. Para el mismo portatil Windows que ya tiene Mosquitto, Node24, n8n, ArduinoIDE y dependencias. No es despliegue publico. La base Supabase ya esta en nube: no repetir migraciones ni instalar PostgreSQL local.

## Antes de salir

Llevar portatil/cargador, ESP32 con montaje DHT22GPIO4 y LDRGPIO34/resistencia10k, cable USB de datos y telefono/datos si se usa punto de acceso. Preparar y probar una red Wi-Fi compatible con ESP32 clasico (2.4GHz), con comunicacion entre portatil/nodo y salida a Internet. La red universitaria puede requerir portal/autenticacion o aislar clientes; no asumir compatibilidad. No hay modo autonomo sin Internet: Auth, consultas y persistencia dependen de Supabase, y nodo requiere sincronizacion horaria NTP.

Conservar la carpeta completa de trabajo, incluida configuracion local privada (web/.env.local, firmware/nodo-dht22-mqtt/config_local.h y .local). GitHub no contiene esos archivos: un git clone en otro PC no restaura credenciales, SQLite/config de n8n o broker. La instalacion de Mosquitto esta fuera del repositorio: C:\Users\juann\Documents\Mosquitto. No proyectar archivos privados ni incluirlos en una entrega publica. En este mismo portatil normalmente no hace falta volver a iniciar sesion/configurar credenciales/importar workflow.

Probar el arranque y la regla temporal antes de clase; llevar captura/video de respaldo identificado con fecha si no hay red. Una consulta de historial existente no acredita captura nueva. No presentar Publicar (simulado) como sensor fisico.

## 1. Ajustar red solo si cambia

En PowerShell:

    cd "C:\Users\juann\Documents\Codex\AgroVigia"
    ipconfig

Elegir IPv4 del adaptador que comunica con el ESP32, no localhost ni interfaces de maquinas virtuales. Detener un broker viejo con Ctrl+C en su terminal antes de regenerar/reiniciar.

    powershell -NoProfile -ExecutionPolicy Bypass -File .\mqtt\agrovigia.ps1 PrepararFirmware -DireccionIPv4 "IP_REAL_DEL_PORTATIL"

Reemplazar IP_REAL_DEL_PORTATIL. Regenera listenerLAN, conserva claves. El config_local.h existente NO se sobreescribe: abrirlo en ArduinoIDE y actualizar WIFI_SSID, WIFI_PASSWORD y MQTT_HOST con esta red/IP; conservar MQTT_PORT18883, identidad de nodo y credenciales. Verificar/subir sketch si cambia configuracion. No recargar firmware si la red/IP no cambiaron. El broker n8n sigue apuntando a127.0.0.1:18883; la IP LAN del portatil la usa el ESP32.

Comprobar permiso del firewall para comunicacion entrante TCP18883 en la red de prueba. No desactivar firewall ni abrir servicios en Internet para la demostracion.

## 2. Arranque habitual: tres terminales

En cada terminal situarse en la raiz con cd anterior y dejarlas abiertas.

Terminal1, Mosquitto:

    powershell -NoProfile -ExecutionPolicy Bypass -File .\mqtt\agrovigia.ps1 IniciarRed

Terminal2, n8n:

    powershell -NoProfile -ExecutionPolicy Bypass -File .\n8n\iniciar-local.ps1

Abrir http://localhost:5678, comprobar flujo03e-ingesta-alertas publicado/activo y solo un receptor ambiental de persistencia activo. Mantener MQTT/HeaderAuth/URL existentes. No hay que pulsar Execute workflow en un flujo publicado para cada captura.

Terminal3, web:

    powershell -NoProfile -ExecutionPolicy Bypass -File .\web\iniciar-local.ps1

Abrir http://127.0.0.1:5173. Supabase funciona remotamente, no tiene terminal local para arrancar. Encender ESP32 con montaje conectado; monitorserie115200opcional.

Terminal4 opcional, ver MQTT crudo:

    powershell -NoProfile -ExecutionPolicy Bypass -File .\mqtt\agrovigia.ps1 Escuchar

Esperar captura nueva (aprox60s). Web monitor consulta30s; contador alertas15s; no son tiempos garantizados de red. Si un puerto esta ocupado comprobar la terminal anterior; no iniciar copias duplicadas.

## 3. Mostrar en telefono

Misma red que portatil. Detener solo Vite con Ctrl+C en terminal3; desde raiz:

    npm.cmd --prefix web run dev -- --host 0.0.0.0

En telefono abrir http://IP_REAL_DEL_PORTATIL:5173 (no localhost). Permitir acceso a Node/Vite en la red de prueba si firewall lo requiere. Esto abre solo la web en LAN, no es hosting publico; mantener n8n en localhost. Si se usa solo proyector, F12 y Ctrl+Shift+M permite emular390px sin exponer Vite en LAN.

## Recorrido de demostracion,5a8min

1. Iniciar sesion y seleccionar cultivo. Mostrar temperatura y humedad DEL AIRE e iluminacion relativa, nodo y fecha recientes.
2. Cubrir/iluminar LDR y esperar una captura nueva; no es lux ni se captura al instante.
3. Ver Mis cultivos/Editar/Cancelar y Dispositivos con cultivo/sensores/ultima recepcion. No archivar/desvincular cultivo real solo para mostrar formulario. Sin nodo libre el registro de otro cultivo se bloquea correctamente.
4. Historial: nodo/variable/periodo, grafica, minimo/maximo/promedio y UUID. Hasta7dias porconsulta.
5. Alertas: usar limite temporal elegido para demostracion y declarado como tal. Linterna sobre LDR puede permitir superar un maximo relativo previamente elegido. Mostrar episodio, numero en campana, revision SIN cierre, luego captura dentro del rango que cierra. Cambiar/desactivar regla cierra administrativamente, no demuestra recuperacion por lectura. Al terminar retirar regla temporal si no se quiere conservar.
6. En n8n mostrar ejecucion confirmada y resultado final persistido:true / alertas.estado evaluada. Explicar ceroevaluadas sin reglas; no afirmar salud.
7. Cerrar sesion. Si falla red, mostrar error/fecha antigua y evidencia grabada como anterior, sin inventar nuevas capturas.

## Casos de uso: estado para revision

CU01 Iniciar sesion: implementado, cuenta habilitada por equipo, SupabaseAuth y acceso propio. Autorregistro no pertenece al alcance actual.
CU02 Registrar cultivo: implementado con uno/dos nodos propios disponibles y transaccion; ademas editar/archivar/vincular/desvincular/auditar. Primera cuenta usa su nodo real; no esta acreditado segundo nodo fisico ni registro real de segundo cultivo con nodo adicional.
CU03 Consultar condiciones: implementado con primer nodo ambiental completo, fecha/origen/ausencia/antiguedad. Pendiente segunda placa y comparacion fisica de sensores equivalentes.
CU04 Consultar alertas activas: nucleo implementado: reglas, episodios, revision separada, filtros, evidencia y avisos internos. Juan confirmo alerta en Episodios. Falta prioridad configurable/orden por severidad solicitado en propuesta; ahora orden por fecha. Cierre/revision/campana requieren completar evidencia real del ciclo entero; no suponerlo de pruebas locales. No existe un estado global por cultivo de ultima evaluacion exitosa cuando no hay episodios: se advierte ausencia/antiguedad, pero ese estado global sigue por mejorar (CU04alternativa2b).
CU05 Historicos/estadisticas: implementado con filtros, grafica, tabla, cantidad/min/max/promedio de muestras por nodo/variable, sin mezclar simulados; max7dias porconsulta. Mantener prueba con cuenta e historia reales y ampliar periodos solo si se acuerda.
CU06 Prediccion de temperatura: pendiente, diferida a fase posterior. Falta modelo temporal, datos suficientes, evaluacion y presentacion de pronostico distinto de observado. Solicitar al profesor confirmar el aplazamiento.
CU07 Cerrar sesion: implementado para sesion actual, limpia informacion y vuelve a login; no elimina cultivos ni mediciones.
CU08 Sugerencias IA: pendiente. Falta integracionGemini en n8n, contexto/evidencias, validacion/almacenamiento y pantalla. No afirmar que la IA ya produce las alertas: son reglas deterministas.

Documentos propuestos aun contienen redaccion antigua de sensores separados por placa: actualizar coherencia de propuesta/diagramas con decision vigente de dos nodos equivalentes, cadaunoDHT22+LDR. No se modificaron referencias originales ni GoogleDocs.

Pendientes adicionales: segundoDHT22 y comparacion conjunta de ambos nodos/LDR; pruebas completas del ciclo real de alertas/campana; despliegue continuo fuera del portatil, TLSbroker y recuperacion de evaluaciones tras fallos largos. Sin push con navegadorcerrado, correo/WhatsApp ni comparacion normalizada agronomica/lux. Algunas son ampliaciones, no casos de uso nuevos acordados.

## Tecnologias y responsabilidades

ESP32 ejecuta firmwareC++ con entornoArduino; leeDHT22 y ADCdelLDR, sincronizaUTC y publicaJSON con UUID. DHT22 mide temperatura/humedaddelaire; LDR+10k proporciona indice ADCrelativo.
Wi-Fi da acceso a red; MQTT3.1.1 es protocolo de publicacion/suscripcion por topicos. Mosquitto es el programa broker que recibe/entrega esos mensajes con autenticacion/ACL. QoS1 confirma entrega albroker, no guardado enSupabase.
n8n2.44.7 coordina recepcion, validacionJS estricta, guardadoRPC y solicitud de evaluacion; reintentos. Workflows/credenciales locales guardados en SQLite/config, no en tablas de telemetria.
Supabase presta Auth y APIHTTPS sobre PostgreSQL. PostgreSQL guarda cultivos/nodos/mediciones/reglas/episodios; funcionesRPC implementan transacciones, duplicados y evaluacion determinista. RLS limita lectura por cuenta. React consulta directamente Supabase, sin pasar por MQTT/n8n; config/revision propias usanRPCauthenticated.
React+TypeScript implementan interfaz/estado/formularios, Bootstrap+CSSapariencia mobilefirst y Chart.js graficas. Vite compila/sirve web en desarrollo. Node.js es entorno de ejecucion para herramientas/Vite/n8n, no un segundo backend web propio. PowerShell automatiza arranque; Git/GitHub versionan codigo excluyendo secretos. Gemini es integracion prevista, aun no utilizada.
