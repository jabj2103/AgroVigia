# Ampliacion ambiental v2

Seguir [la guia completa](../docs/integrar-nodo-ambiental.md) en este orden:
0003_ingesta_ambiental.sql -> probar-ingesta-ambiental.sql -> habilitar-ldr-nodo.sql
-> reiniciar broker -> importar/publicar03c -> cargar firmware -> verificar SQL/web.

0003 es aditiva y se ejecuta una vez con postgres. El test SQL termina ROLLBACK.
No repetir 0001/0002 ni provisionar-demo.sql. No se crean capturas o nodos a partir
del mensaje. Solo service_role ejecuta la nueva RPC; clientes siguen solo lectura.

La conversion LDR es un indice normalizado de ADC, no lux ni calibracion.
Metadatos conserva version, metodo y ADC en cada fila; registros anteriores {}.
El recorrido DHT22 v1 queda compatible incluso tras habilitar LDR.