# Entorno local real (sin la nube)

Todo AgroVigía corriendo en este equipo con servicios reales: un Supabase local en Docker (base PostgreSQL, Auth, API REST, Realtime y pasarela), Mosquitto, n8n con los flujos publicados y el servicio de simulación. Sirve para comprobar el recorrido completo antes de llevarlo a la nube. No usa bases en memoria ni datos de prueba fijos.

Requisitos: Docker, Node (el guion usa el de nvm si el del sistema es anterior al 24) y `psql`. La CLI oficial de Supabase se ejecuta con `npx`, sin instalar nada en el sistema. La primera vez descarga las imágenes de Supabase.

## Comandos

```bash
local/agrovigia.sh local-iniciar     # levanta todo; se puede repetir sin dañar nada
local/agrovigia.sh local-estado      # qué está arriba y conteos reales de los últimos minutos
local/agrovigia.sh local-probar      # prueba real de punta a punta (unos seis minutos)
local/agrovigia.sh local-web         # la web contra el Supabase local, en http://127.0.0.1:5189 (no toca web/.env.local)
local/agrovigia.sh local-detener     # detiene todo y conserva los datos
```

`local-iniciar` hace, en orden: inicia el Supabase local y aplica las migraciones 0001 a 0012 de `supabase/migrations`; escribe `.local/entorno-local.env`; crea la cuenta de prueba, su perfil y los tres cultivos con sus hexágonos usando los guiones `provisionar-*.sql` del repositorio; levanta Mosquitto y n8n e importa y publica los flujos 03e, 03f, 03g, 03h y 03i; y deja el servicio de simulación desligado de la terminal. Los registros quedan en `.local/registros/` (`simulador.log`, `n8n-configuracion.log`, `supabase.log`).

## Direcciones

| Servicio | Dirección |
|---|---|
| Supabase local (API, Auth, Realtime) | `http://127.0.0.1:54321` |
| PostgreSQL local | `127.0.0.1:54322` |
| n8n | `http://localhost:5678` |
| Webhook del simulador (03g) | `http://localhost:5678/webhook/agrovigia/telemetria` |
| Webhook de placas con clave propia (03i) | `http://localhost:5678/webhook/agrovigia/nodo` |
| Mosquitto | `127.0.0.1:18883` |

n8n corre en Docker y llega al Supabase del equipo por `http://host.docker.internal:54321`.

## Claves

`.local/entorno-local.env` (permiso 600, fuera de Git) guarda lo del entorno local. `.local/secretos.env` sigue siendo solo de la nube y no se toca; de él se copia la clave de Gemini.

| Variable | Uso |
|---|---|
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Lo único que necesita la web |
| `SUPABASE_SECRET_KEY`, `SUPABASE_DB_URL` | Servidor: n8n, servicio de simulación y `psql` |
| `SUPABASE_URL_N8N` | La misma base vista desde el contenedor de n8n |
| `GEMINI_API_KEY`, `GEMINI_MODELO` | Sugerencias de IA |
| `AGROVIGIA_USUARIO_CORREO`, `AGROVIGIA_USUARIO_CLAVE` | Cuenta de prueba para iniciar sesión en la web |
| `AGROVIGIA_N8N_BIND` | `127.0.0.1` (solo este equipo) o `0.0.0.0` (red local) |

## Regla de destino

Todos los componentes (flujos de n8n, servicio de simulación y guiones) aceptan como Supabase solo:

- la nube: `https://<proyecto>.supabase.co`;
- un Supabase de desarrollo en este equipo: `http://127.0.0.1:<puerto>`, `http://localhost:<puerto>` o `http://host.docker.internal:<puerto>`.

Cualquier otro destino, y cualquier otro `http`, se rechaza. Las claves locales tienen el mismo formato que en la nube: `sb_publishable_...` (pública) y `sb_secret_...` (servidor).

## Placa física en la red local

Por defecto n8n solo escucha en este equipo. Para que una placa de la misma red envíe sus lotes:

```bash
local/agrovigia.sh local-iniciar --lan                 # n8n escucha en todas las interfaces
local/agrovigia.sh local-iniciar --solo-este-equipo    # vuelve a cerrarlo
```

La placa envía a `http://<IP de este equipo>:5678/webhook/agrovigia/nodo` con sus cabeceras `X-AgroVigia-Nodo` y `X-AgroVigia-Clave` (ver [n8n/INGESTA_HTTP.md](../n8n/INGESTA_HTTP.md)). Para comprobarlo desde otro equipo de la red: `curl -i -X POST http://<IP>:5678/webhook/agrovigia/nodo` debe responder `401` con `{"estado":"rechazado","codigo":"CLAVE_INVALIDA"}`. Dentro de la red local viaja por `http` sin cifrar: úsalo solo en una red de confianza.

Los puertos del Supabase local (54321 y 54322) los publica la CLI en todas las interfaces y con sus claves de desarrollo conocidas. Contienen solo datos de prueba; si la red no es de confianza, ciérralos con el cortafuegos del equipo.

## Empezar de cero

`npx supabase db reset` (desde la raíz) vacía la base local y vuelve a aplicar las migraciones; después, `local/agrovigia.sh local-iniciar` recrea la cuenta y los datos.

## Probar la web real en un navegador

Con el entorno en marcha y `local-web` abierto, este guion inicia sesión con la cuenta de prueba y pulsa los
botones de verdad (clima, análisis de IA, cultivo nuevo con nodo simulado, nodo físico, filtros). No usa fixtures.

```bash
cd web
AGROVIGIA_CHROME=/usr/bin/google-chrome node tests/real-local.mjs
```

Escribe en la base local: deja un cultivo archivado "Prueba web real" por corrida. Las capturas quedan en
`.local/qa-real/`. Si el análisis de IA falla, mira la pantalla de IA: muestra el motivo que guardó n8n
(por ejemplo, que Gemini no respondió) y se puede reintentar.

