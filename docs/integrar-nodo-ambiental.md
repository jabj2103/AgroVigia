# Integrar DHT22 + LDR en el primer ESP32

Preparado tras las pruebas de Juan. El cambio remoto se hace en este orden.
No repetir las migraciones 0001/0002 ni provisionar-demo.sql: son del recorrido
anterior. No se crea un segundo nodo ni se cambian claves en este paso.

## 1. Supabase: ampliacion aditiva

En SQL Editor, con rol postgres, abrir una consulta nueva, pegar y ejecutar
**completo una sola vez**:

[supabase/migrations/202610260003_ingesta_ambiental.sql](../supabase/migrations/202610260003_ingesta_ambiental.sql)

Agrega columna metadatos (vacia en filas previas), RPC ambiental solo para
servidor y compatibilidad del DHT22 v1 con las nuevas capacidades. No inserta
mediciones, no cambia el nodo ni borra historial.
Resultado final esperado: ejecuta_servidor=true, ejecuta_web=false,
ejecuta_anonimo=false. Si hay error, conservarlo; no continuar ni repetir
migraciones sobre una transaccion fallida. ROLLBACK antes de diagnosticarla.

Luego ejecutar TODO en otra consulta:

[supabase/probar-ingesta-ambiental.sql](../supabase/probar-ingesta-ambiental.sql)

Resultado esperado: seis comprobaciones OK, sin errores previos. Prueba
SIMULADOS y habilita LDR dentro de una transaccion que termina ROLLBACK;
no deja mediciones ni capacidades nuevas. Un SELECT resumen aislado no sirve
como evidencia de que el bloque completo se ejecuto.

## 2. Habilitar la capacidad del nodo

Ejecutar TODO [supabase/habilitar-ldr-nodo.sql](../supabase/habilitar-ldr-nodo.sql).
Verifica la cuenta/cultivo/nodo que ya usa Juan y agrega solo la capacidad
iluminacion_relativa/LDR. Repetir conserva datos; discrepancias abortan.
Esperado: tres filas (temperatura, humedad e iluminacion) del mismo nodo.
El flujo DHT22 anterior puede seguir funcionando; no crea iluminacion ficticia.

## 3. Broker: cargar las ACL v2

El archivo mqtt/agrovigia.acl ya incluye topicos v2 exactos por dispositivo,
simulacion separada y lectura v1/v2 del receptor. Conservar las credenciales.
En la terminal de Mosquitto, Ctrl+C y volver a iniciar desde la raiz:

    powershell -NoProfile -ExecutionPolicy Bypass -File .\mqtt\agrovigia.ps1 IniciarRed

Necesita que la IPv4 LAN preparada siga vigente. Reiniciar la terminal
Escuchar si se usa: ahora se suscribe a v1 y v2. n8n debera reconectar al
broker; no equivale a perder las mediciones que ya estan guardadas.
No ejecutar Preparar ni cambiar claves. No iniciar un segundo broker encima.

## 4. n8n: importar el flujo nuevo

Importar [n8n/03c-ingesta-ambiental.json](../n8n/03c-ingesta-ambiental.json)
como flujo nuevo. Plantilla inactiva y sin credenciales; conservar 03b.

- MQTT receptor: misma credencial receptor, host127.0.0.1/puerto18883.
  Topic ya fijado: agrovigia/v2/real/nodos/agv-dht22-01/telemetria:1.
- Proyecto Supabase: Name debe seguir supabase_url; Value es Project URL
  https://vzylofqutecvfcbmcjac.supabase.co (sin /rest/v1).
- Guardar lote en Supabase: seleccionar la misma credencial Header Auth de
  03b (apikey con Secret key privada). No pegarla en parametros ni exportarla.
- Guardar y Publish para recibir continuamente. Ver resultados en Executions.

El nuevo flujo ya apunta a registrar_lote_ambiental. No cambiar la RPC de 03b
ni pegar un JSON de tres variables en el validador v1. El sufijo :1 indica QoS,
no forma parte del topico publicado por el dispositivo.

## 5. Cargar el firmware ambiental

**Este es el momento de cargar el sketch actualizado**, despues de los pasos
anteriores. Abrir nuevamente firmware/nodo-dht22-mqtt/nodo-dht22-mqtt.ino en
Arduino IDE, conservar config_local.h y placa/puerto que funcionaban, Verificar
y Subir. DHT22 GPIO4, LDR GPIO34 con 10k; monitor115200. La primera placa
conserva codigo agv-dht22-01 y credencial nodo_dht22.

Esperado: CAPTURA_REAL con version2, ldr.metodo/adc_promedio y tres mediciones;
MQTT_ACK QoS1 retain0. LDR_DIAG usa solo_serial=0 porque ahora tambien se toma
una lectura nueva al capturar MQTT. La linea diagnostica mas cercana puede
no coincidir con el ADC del lote: son lecturas en momentos distintos.

El indice es round(ADC*100/4095,1): no lux ni porcentaje de luz fisica. Ver
[contrato-mqtt-v2.md](contrato-mqtt-v2.md). No ajustar automaticamente la escala
con la linterna ni con minimos/maximos independientes de cada nodo.

## 6. Confirmar guardado y pantalla

En Resultado de persistencia buscar LOTE_AMBIENTAL_GUARDADO, insertado,
persistido=true, nuevo_lote=true y **tres** medicion_ids. Un duplicado debe
conservar IDs y marcar nuevo_lote=false; color verde del nodo HTTP no basta.

Ejecutar [supabase/verificar-ultima-ambiental.sql](../supabase/verificar-ultima-ambiental.sql).
Comparar mismo UUID, tres valores, ADC/metodo, fechas/origen y cultivo con
CAPTURA_REAL. El ACK de MQTT por si solo no confirma este guardado.

La web ya admite el perfil combinado. Recargar o pulsar Actualizar para
volver a consultar capacidades; mostrara iluminacion relativa, ADC y aviso
de extremos. Antes de llegar v2 puede mostrar DHT22 previo y LDR sin lectura,
sin mezclar capturas. Refresco30s, antiguedad180s, cuenta/RLS conservados.

Comprobar dos capturas distintas, cambio al cubrir/iluminar sin interpretar
extremos como lux, cuenta secundaria vacia y datos antiguos/recuperacion.
Tras confirmar v2, despublicar el flujo03b si ya no se usara. La RPC v1 queda
disponible para transicion; no borrar mediciones ni capacidades historicas.

## Verificacion local y limites

Pruebas n8n: node --test n8n/validar-telemetria.test.cjs n8n/preparar-ingesta.test.cjs n8n/ambiental.test.cjs
Web: npm test --prefix web y npm run build --prefix web.
SQL local: npm ci --prefix supabase/tests --ignore-scripts y npm test --prefix supabase/tests.

Resultado local: 68 tests n8n, 12 web, 7 SQL (87 total) y build aprobados.
La prueba node mqtt/probar-acl-ambiental.cjs tambien paso: broker aislado
en puerto efimero, sin tocar el broker activo; valida receptor y PUBACK RC135
para rechazos. El codigo de salida del publicador puede ser0 aun con PUBACK
negativo, por lo que no se considera exito por LASTEXITCODE solamente.
Los procesos propios de prueba se detienen al terminar.

SQL se comprueba en PGlite/PostgreSQL en memoria con roles/Auth minimos de
prueba, incluyendo fallo de trigger y RLS por identidad SQL. No es Supabase
remoto, JWT firmado/API real, concurrencia ni transporte MQTT fisico.
El compilador nativo ESP32 no pudo iniciarse desde esta sesion por Illegal
System DLL Relocation; el nuevo firmware requiere Verificar/Subir desde el
IDE de Juan. No se subio firmware, aplico SQL remoto ni publico n8n desde aqui.

El segundo nodo se integrara con sensores propios, identidad/credencial y
alta administrativa separadas. Una ACL preparada no acredita nodo habilitado
ni sensores existentes. No se da por probada la igualdad entre dos LDR.