# Nodo ambiental v2: DHT22 + indice relativo LDR

Decision de implementacion del 26 de octubre de 2026, tras pruebas reportadas
por Juan con LDR de dos patas, resistencia 10k, GPIO34, ADC12 y ADC_11db.
Con LDR cubierto obtuvo 0, con linterna cercana 4095 y al alejarla valores
intermedios decrecientes hasta volver aproximadamente al ambiente (625 al final).
Evidencia resumida: pruebas/2026-10-26-ldr-gpio34.json.

## Significado de la escala

Se define un **indice normalizado del ADC**, NO una calibracion fotometrica.
Metodo fijo: adc12_10k_11db_v1. Divisor 3.3V -> LDR -> GPIO34 -> 10k -> GND;
mas luz produce mayor ADC segun prueba de Juan. Promedio redondeado de 16
conversiones de 12 bits con atenuacion ADC_11db. Referencias fijas 0 y 4095.

Indice = redondear(adc_promedio * 100 / 4095, 1 decimal).
El firmware calcula decimas con enteros: (adc * 1000 + 2047) / 4095.
Ejemplo de calculo, no nueva captura: 625 -> 15.3 % relativo.

0 y 100 representan limites del ADC en este circuito; no oscuridad absoluta,
porcentaje de luz solar ni iluminacion fisica maxima. Se conservan ambos
extremos con advertencia. No hay autoescala por placa, lux, inferencia de salud
ni umbrales agronomicos. Las no linealidades y diferencias entre LDR/ADC impiden
prometer igualdad fisica de dos indices: comparar primero sensores juntos,
misma resistencia/configuracion y referencias antes de interpretar ubicaciones.
El segundo nodo aun no tiene prueba ni calibracion conjunta. Cambiar circuito,
atenuacion o conversion exige otro metodo versionado y revision de la ingesta.

## Transporte y forma

Topic: agrovigia/v2/{real|simulado}/nodos/{nodo_codigo}/telemetria.
Se conserva agv-dht22-01 como identidad de la primera placa, aunque incluya LDR;
no se renombra su historial. Codigo futuro reservado agv-ambiente-02 para la
segunda placa, aun sin aprovisionar. Un nodo fisico por ESP32.

Esquema: mqtt/telemetria-ambiental.schema.json. Ejemplo SIMULADO con fecha/UUID
fijos: mqtt/ejemplos/ambiental-v2-simulado.json; no reproducir como captura real.
Siete campos exactos: version=2, nodo_codigo, mensaje_id, origen, tomada_en,
mediciones y ldr. ldr tiene exactamente metodo y adc_promedio (entero 0..4095).
Tres variables exactas: temperatura_aire (grados Celsius), humedad_aire (% HR)
e iluminacion_relativa (% relativo). Cada medicion conserva el objeto v1
variable_codigo/valor/unidad. Mismo UUID y fecha para las tres.

Conserva reglas v1 de UTF8 raw <=2048 bytes, sin BOM/claves repetidas/campos
extra, UUIDv4, fecha UTC canonica, precision <=4 decimales y rangos. Validar
esquema no comprueba calendario, formula, autorizacion, ACL ni duplicados.
El validador y la RPC exigen que iluminacion coincida con ADC/metodo.

QoS1, retain falso, sesion limpia, una captura cada60s, un lote RAM y mismos
reintentos/caducidad v1. Captura lee DHT22 y ADC consecutivamente en el mismo
ciclo, no simultaneidad electronica exacta. Si DHT22 falla no se envia lote
parcial ni valores sustituidos. Una entrada ADC valida no diagnostica cables.

## Persistencia y transicion

RPC registrar_lote_ambiental, EXECUTE solo service_role. Exige las tres
capacidades del nodo, cuenta/cultivo autorizados, bloqueo por nodo y ventana
[-300,+120]s para lote nuevo. Inserta tres filas o ninguna. metadatos conserva
version_payload=2 y ldr (metodo/ADC) en cada fila, bajo RLS e inmutabilidad
existentes. Duplicado conserva IDs/fechas; ADC distinto con mismo UUID genera
conflicto aunque el indice redondeado coincida. No crea nodos desde mensajes.

recibida_en sigue siendo inicio de validacion de n8n aproximado, no timestamp
del broker. Retain no observado sigue null; se exige politica de broker
retain_available=false y ACL verificada. Metadatos no son prueba de identidad.

0003 agrega metadatos={} a filas anteriores sin reescribir sus valores, mantiene
la RPC DHT22 v1 y le permite un nodo con dos capacidades DHT22 o las tres
ambientales correctamente registradas. No convierte datos historicos a v2 ni
inventa iluminacion en capturas antiguas. Web admite v1 y v2 sin mezclar UUIDs.
La nueva columna solo se consulta para un nodo habilitado con perfil completo.

Guia de aplicacion: integrar-nodo-ambiental.md. Ningun cambio remoto esta
aplicado por escribir estos archivos. Segundo nodo, comparacion fisica,
concurrencia real, caidas y calibracion entre sensores siguen pendientes.

API ADC: https://docs.espressif.com/projects/arduino-esp32/en/latest/api/adc.html