# Firmware de AgroVigia

Siguiente prueba: [nodo DHT22 con Wi-Fi y MQTT](nodo-dht22-mqtt/README.md). Su codigo y configuracion ya estan escritos, pero la compilacion/carga y recepcion real todavia deben verificarse. El diagnostico USB siguiente se conserva como prueba independiente.

## Punto de partida

`Transmisor_Parcial2.ino` es el codigo aportado de otro proyecto, con autoria de Juan Bustos, Franyerson Molina y Andres Marrugo en su encabezado. Se conserva intacto como referencia, no como firmware vigente de AgroVigia ni prueba fisica de este proyecto.

La revision encontro lectura DHT22 en GPIO 4, LDR en GPIO 34, LED en GPIO 23 y monitor serie a 115200 baudios. Esos pines describen el codigo anterior, no un cableado actual confirmado. Tambien incluye ESP-NOW, estructuras binarias, MAC de receptor, canal fijo, ACK propios, colas y estadisticas de ensayos. Esa comunicacion y el control del LED no se trasladan a AgroVigia.

La lectura DHT22 se recupera en un sketch independiente. Arquitectura aclarada el 26 de octubre de 2026: ambas placas tendran DHT22 y LDR, con identidad propia y publicacion directa por Wi-Fi al broker MQTT. El recorrido actual solo implementa DHT22; la ampliacion conjunta y la conversion relativa comparable del LDR estan pendientes. Ninguna placa actuara como receptor ESP-NOW.

## Primera prueba: lectura local DHT22

Abrir directamente `nodo-dht22-diagnostico/nodo-dht22-diagnostico.ino` en Arduino IDE. No abrir el transmisor antiguo para esta prueba. La carpeta y el sketch tienen el mismo nombre para que Arduino los trate como un proyecto independiente.

Este programa lee cada 3 segundos y muestra el par completo de temperatura y humedad. Descarta el par si hay valores no finitos o fuera de los limites del contrato. No sustituye un error por cero ni por la ultima lectura. Las etiquetas `ERROR_LECTURA` y `ERROR_RANGO` describen el resultado observado, no diagnostican una causa electrica.

Un numero finito dentro de rango no garantiza una medicion correcta. Juan reporto errores y seis pares cero/cero al inicio, seguidos por nueve pares de 30.7-30.8 C y 76.6-77.5 % HR. Se registra como primera ejecucion fisica reportada, pendiente de repetir desde el arranque. No se bloquea automaticamente todo valor cero ni se transforma ese resultado en una lectura normal: conservar el registro y revisar su contexto. El sketch no contiene una sustitucion por cero.

Actualizacion posterior: Juan repitio la prueba y reporto arranques sin errores. El nuevo fragmento contiene cuatro pares de 30.7 C y 77.4-77.5 % HR. La conexion fisica queda como causa probable segun su observacion, sin diagnostico independiente. Este resultado permite preparar MQTT, manteniendo pendientes calibracion y comprobacion de estabilidad prolongada.

Los 3 segundos son solo para diagnostico local por USB. La publicacion MQTT del contrato tiene un intervalo provisional de 60 segundos. Este sketch no genera JSON, UUID ni fecha UTC, no autentica el nodo y no publica: sus lineas del monitor serie no deben copiarse como mensajes MQTT validos.

### Antes de conectar

Falta confirmar el modelo exacto de cada placa y si el DHT22 es un sensor de cuatro patas o un modulo de tres pines con resistencia incorporada. No deducir el orden de sus terminales solo por la forma del encapsulado. La foto aportada no se pudo inspeccionar visualmente de forma fiable desde esta sesion; la identificacion sigue pendiente.

Propuesta funcional para revisar contra las etiquetas y ficha del montaje:

| Funcion del sensor | Conexion propuesta |
|---|---|
| Alimentacion | 3V3 de la placa |
| Tierra | GND comun |
| Datos | GPIO 4, tomado del proyecto anterior |

Esta tabla no asigna posiciones fisicas a los pines. Confirmar las etiquetas antes de alimentar y realizar conexiones con la placa desconectada. Para un sensor sin pull-up incorporado, la guia de Adafruit indica una resistencia de 10 kohm entre datos y alimentacion. Mantener la linea de datos a 3.3 V en este montaje. Si se cambia el GPIO, cambiar `DHT_PIN`; el texto de arranque muestra ese mismo valor.

### Herramientas encontradas

Se localizaron Arduino IDE, su CLI integrada, el paquete Espressif ESP32 3.3.10 y DHT sensor library de Adafruit 1.4.7 en el equipo. No se instalaron paquetes. Esto no confirma que la placa seleccionada ni el puerto USB del IDE sean los adecuados.

### Procedimiento fisico pendiente

1. Confirmar placa, sensor y cableado; conectar por USB con un cable de datos.
2. En Arduino IDE seleccionar la placa que corresponda al modelo confirmado y su puerto. No dar por definitiva la seleccion generica usada para revisar compilacion.
3. Abrir el nuevo sketch, verificar y cargar. Cerrar otro monitor serie si ocupa el puerto.
4. Abrir el monitor serie a **115200 baudios**. Esperar aproximadamente 3 segundos para la primera lectura.
5. Observar al menos 10 ciclos. Registrar cuantas lecturas completas y cuantos errores se obtienen, sin inventar valores ni afirmar calibracion.
6. Desconectar la alimentacion antes de modificar el circuito. Si se prueba el sensor ausente, comprobar que los errores no aparecen como lecturas nuevas validas; pueden existir lecturas de cache de la biblioteca durante un ciclo, por lo que no es una prueba instantanea.
7. Guardar en `docs/estado.md` la placa, GPIO real, versiones utilizadas, resultados observados y problemas. Compilar o cargar no basta para afirmar que el sensor mide correctamente.

Ante el resultado inicial reportado, repetir con dos arranques independientes y guardar los primeros 20 ciclos de cada uno, incluidos errores y ceros (aproximadamente un minuto por arranque). Si el comportamiento anomalo se repite, comprobar con la placa sin alimentacion las conexiones y etiquetas, alimentacion/tierra, variante del sensor y presencia de pull-up; no atribuir la causa a un componente sin comprobarlo. No se cierra la estabilidad del nodo solo porque las ultimas lineas parezcan razonables.

Tras esa evidencia se preparara el nodo MQTT: Wi-Fi, reloj sincronizado, UUID por captura, JSON v1, autenticacion y QoS 1 con reintentos del mismo payload. La prueba posterior sera ver el par de variables en Mosquitto con fecha de captura y origen real. El estado concreto de compilacion local se registra en `docs/estado.md`.

## Fuentes consultadas

- [Ejemplo oficial DHTtester de Adafruit](https://github.com/adafruit/DHT-sensor-library/blob/master/examples/DHTtester/DHTtester.ino): lectura de temperatura/humedad, intervalo y tratamiento de errores.
- [Conexion de sensores DHT de Adafruit](https://learn.adafruit.com/dht/connecting-to-a-dhtxx-sensor): alimentacion y pull-up; comprobar la variante concreta del sensor.

No hay credenciales en el nuevo sketch. La prueba no requiere crear servicios remotos ni conectar Supabase o Gemini.
