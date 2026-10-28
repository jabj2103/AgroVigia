# Arranque local de n8n

Version fijada: **2.44.7**, etiqueta `latest` del registro npm consultada el
26 de octubre de 2026. Su paquete declara Node >=24.0.0; en este equipo se
comprobaron Node v24.16.0 y npm 12.1.0. El lanzador admite Node 24.x, dentro
del rango documentado para instalaciones npm. No usa una version flotante.
La documentacion anuncia deprecacion de npm desde n8n 3.0; este lanzador no
actualiza a esa version automaticamente.

Desde la raiz del proyecto, en una terminal adicional:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\n8n\iniciar-local.ps1
```

La primera ejecucion descarga n8n y sus dependencias mediante npx. No instala
n8n globalmente ni modifica Mosquitto. Requiere Internet y puede tardar varios
minutos. El equipo guarda datos, cuenta local y clave de cifrado en
`.local/n8n/.n8n`, excluido de Git. La cache de paquetes usa la configuracion
normal de npm. Conservar los datos y la clave juntos; reiniciar con el mismo
script para reutilizarlos. No borrar esa carpeta para solucionar errores.

El editor escucha solo en 127.0.0.1:5678. Cuando la terminal anuncie que esta
listo, abrir **http://localhost:5678**. Mantener la terminal abierta; Ctrl+C
detiene n8n. No requiere reglas nuevas de firewall ni un tunel publico.

Si aparece el formulario inicial, crear la cuenta propietaria **local de n8n**.
Es independiente de los usuarios Auth de AgroVigia. No introducir la clave
privilegiada ni la contrasena de base de datos de Supabase en ese formulario.
Las credenciales de servicios se configuran despues en las conexiones de n8n.

## Estado de comprobacion

Sintaxis PowerShell y exclusion de Git comprobadas localmente. No se ejecuto
la descarga ni el arranque del lanzador: la consulta de metadata con npm fallo
con `ENOTFOUND registry.npmjs.org` desde esta sesion. La version y sus engines
se consultaron mediante el registro npm desde la herramienta web. No atribuir
ese fallo de esta sesion a la red general del computador sin comprobarlo desde
la terminal de Juan.

El resultado pendiente es ver el editor y registrar la version que anuncia
el arranque. Si falla, conservar el error completo, sin borrar datos ni
reinstalar Node a ciegas. Si indica puerto ocupado, revisar el proceso antes
de cerrarlo o iniciar otra instancia con los mismos datos.

## Reparacion de SQLite con npm 12

En el primer intento de Juan se descargaron los paquetes, pero el proceso
termino con codigo 1. La prueba directa de carga de `sqlite3` en esa cache
fallo con `Could not locate the bindings file`; falta `node_sqlite3.node`.
El registro de npm no conserva la salida completa del proceso n8n y no permite
afirmar que este sea su unico fallo. npm 12 omite por defecto los scripts de
dependencias; el lanzador inicial no contemplaba esa politica.

Ejecutar desde la raiz del proyecto:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\n8n\reparar-sqlite.ps1
```

El reparador busca n8n 2.44.7 con sqlite3 5.1.7 en la cache npm del usuario,
verifica el comando de instalacion y ejecuta solo `npm run install` de esa
dependencia. Descarga el binario si esta disponible; si intenta compilar y
falla, conservar el error antes de instalar herramientas adicionales. No
borra la cache ni los datos de n8n, ni cambia configuracion global.

Tras `SQLITE_CARGA_OK`, repetir el comando de `iniciar-local.ps1`. El lanzador
ahora permite especificamente el script de sqlite3 en nuevas instalaciones
npx y guarda stdout/stderr en `.local/n8n/logs/arranque-*.log`. No asumir que
ese permiso reconstruye automaticamente una cache ya instalada; para ese
caso se usa el reparador. Los registros permanecen privados y pueden contener
informacion de ejecucion de flujos; compartir solo el error necesario.

Fuente: [politica de scripts en npm 12](https://docs.npmjs.com/cli/v12/using-npm/config/).

## Arranque y avisos comprobados

Juan aporto n8n ready en 127.0.0.1:5678 y JS Task Runner registrado en
2.44.7. La apertura del editor esta confirmada; no equivale a ejecutar un flujo.
El runner Python no arranco por falta de entorno virtual. La validacion prevista
usa JavaScript; Python queda no disponible y no hace falta instalarlo para esa ruta.

El lanzador convierte los registros de stderr a texto antes de Tee-Object para
que PowerShell 5.1 no presente npm notice como NativeCommandError. Conserva todos
los mensajes y el codigo de salida. Una prueba aislada verifico ambas salidas
y codigo 7 en Windows PowerShell; el cambio se aplica en el siguiente arranque.
No se reinicio el proceso que Juan mantiene abierto.

Los avisos sobre modo interno, uso sin contenedores y cambios de valores por
defecto quedan visibles. Revisar el despliegue antes de actualizar o usarlo en
produccion. Los avisos de telemetria y util._extend no impidieron el arranque
observado. No se desactivaron runners ni se instalaron dependencias para
silenciar mensajes. La proxima comprobacion es ejecutar el validador en n8n.
Fuente: https://docs.n8n.io/hosting/configuration/task-runners/ (26-10-2026).
## Importar el flujo

Importar como flujo nuevo `03a-inspeccion-mqtt.json` y seguir [README.md](README.md):
primero ruta manual, despues MQTT con el usuario receptor. El flujo no guarda
todavia en Supabase. La funcion transaccional (RPC), su prueba y la semantica
de `recibida_en` siguen pendientes; el arranque local no las sustituye.

Fuentes consultadas el 26 de octubre de 2026:

- [Paquete npm n8n: version y engines](https://registry.npmjs.org/n8n/2.44.7).
- [Instalacion npm/npx](https://docs.n8n.io/hosting/installation/npm/).
- [Variables de despliegue](https://docs.n8n.io/hosting/configuration/environment-variables/deployment/).
