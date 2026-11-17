# Ejecución local en Linux

Guía para correr todo en un equipo Linux con Docker. Los lanzadores PowerShell siguen siendo la vía en el Windows de Juan; esta guía no los reemplaza allí.

| Pieza | Dónde corre | Dirección |
|---|---|---|
| Mosquitto 2.0.20 | Docker | 127.0.0.1:18883 (LAN opcional), ACL v3, mensajes hasta 8192 bytes |
| n8n 2.44.7 | Docker | http://localhost:5678 |
| Web (Vite) | Node 24+ local | http://127.0.0.1:5173 |
| Servicio de simulación | Node local | aplica el clima activado en la web y publica por MQTT |
| Panel de Juan (ajuste manual) | Node local | http://127.0.0.1:5190 |
| Supabase y Gemini | Internet | proyecto remoto del equipo |

## 1. Claves (una vez)

Llenar `.local/secretos.env` (excluido de Git; no compartir):

- `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` (empieza por `sb_publishable_`): solo estas dos llegan a la web.
- `SUPABASE_SECRET_KEY` (`sb_secret_`): solo para n8n.
- `SUPABASE_DB_URL`: cadena de conexión de la base, para aplicar la migración con psql y exportar el mapa de nodos.
- `GEMINI_API_KEY`: solo para n8n. Opcional `GEMINI_MODELO` (por defecto `gemini-3.5-flash-lite`).

## 2. Orden de arranque

```bash
local/agrovigia.sh preparar        # claves MQTT locales (una vez)
local/agrovigia.sh iniciar         # Mosquitto y n8n
local/agrovigia.sh migrar          # 0009 y 0010 sobre las zonas de Juan + 3 hexágonos + verificación (todo true)
local/agrovigia.sh configurar-n8n  # credenciales cifradas y flujos 03e (real) y 03f (simulado v3) publicados
local/agrovigia.sh web             # web en http://127.0.0.1:5173 (terminal propia)
local/agrovigia.sh simular         # servicio de simulación (terminal propia); ver simulador/README.md
local/agrovigia.sh panel           # opcional: panel de Juan para ajustar a mano cuatro puntos
```

`migrar` exige la 0007 y la 0008 de Juan ya aplicadas y no repite la 0009 ni la 0010; el aprovisionamiento es idempotente. Si todavía no están aplicadas, la web abre igual (cultivos sin plantilla), pero IA, Escenario y plantillas muestran un error hasta aplicarlas.

El clima se activa en la web (vista Escenario) y lo aplica el servicio de simulación: sin `simular` en marcha, los nodos virtuales no publican y aparecen sin recibir. El servicio necesita `SUPABASE_URL` y `SUPABASE_SECRET_KEY`.

El servicio de simulación y el panel publican con el mismo usuario MQTT. No los uses a la vez sobre el mismo nodo virtual: pausa en la web (Escenario, detalle del nodo) los cuatro nodos que vayas a manejar desde el panel, o usa el panel con el servicio detenido.

La primera vez que se abre n8n pide crear la cuenta local del editor. Es independiente de las cuentas de AgroVigía.

## 3. Nodo físico contra este broker

Por defecto el broker solo escucha en este equipo. Para que el ESP32 publique aquí: `local/agrovigia.sh iniciar-lan`, y en `firmware/nodo-dht22-mqtt/config_local.h` poner la IP de este equipo y la clave de `.local/mqtt/nodo_dht22.conf`. Son claves nuevas, distintas de las del broker de Juan. Red privada de confianza, sin TLS; no exponer a Internet.

Las sugerencias de IA del cultivo **real** solo se generan si sus lecturas pasan por el 03e nuevo, y las de los nodos virtuales por el 03f nuevo (ambos con alertas y rama IA). Si el ESP32 y el panel siguen publicando en el broker de Juan, Juan debe importar allí los dos flujos regenerados (con la credencial de Gemini) en lugar de los anteriores. Dentro de un mismo broker solo debe quedar publicado un receptor 03e y uno 03f.

## 4. Detener

`local/agrovigia.sh detener` conserva datos y claves. Los datos de n8n quedan en `.local/n8n-docker`.
