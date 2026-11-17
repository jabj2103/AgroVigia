#!/usr/bin/env bash
# Entorno local de AgroVigia en Linux. Sustituye a los lanzadores PowerShell en este equipo.
# Claves privadas: .local/secretos.env (excluido de Git). Nunca se imprimen.
set -euo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PRIV="$RAIZ/.local"
COMPOSE=(docker compose -f "$RAIZ/local/docker-compose.yml")
export AGROVIGIA_UID="$(id -u)" AGROVIGIA_GID="$(id -g)"

ayuda() { cat <<'EOF'
Uso: local/agrovigia.sh <comando>
  preparar         Genera claves MQTT locales (una vez) y carpetas privadas.
  iniciar          Levanta Mosquitto (127.0.0.1:18883) y n8n (http://localhost:5678).
  iniciar-lan      Igual, pero el broker escucha tambien en la red local (ESP32 fisico).
  configurar-n8n   Importa credenciales desde .local/secretos.env y publica 03e y 03f (MQTT), 03g (HTTP), 03h (IA a peticion) y 03i (nodos por HTTPS).
  migrar           Aplica 0009 a 0012 sobre las zonas de Juan (0007/0008) y arma los 3 hexagonos (psql).
  mapa             Exporta .local/simulacion/nodos.json para el panel manual de Juan (el servicio de simulacion no lo usa).
  web              Escribe web/.env.local (solo URL y publishable key) e inicia la web.
  simular [args]   Servicio de simulacion: aplica el clima y los ajustes de la web a todos los nodos (ver simulador/README.md).
                   Con --http http://localhost:5678/webhook/agrovigia/telemetria publica por HTTP en lugar de MQTT.
  panel            Panel de Juan para ajustar a mano cuatro puntos, con envio MQTT (http://127.0.0.1:5190).
  local-iniciar    TODO en este equipo, sin la nube: Supabase local en Docker con las migraciones y los datos de
                   arranque, Mosquitto, n8n con los flujos publicados y el servicio de simulacion. Se puede repetir.
                   Con --lan n8n escucha tambien en la red local (placa fisica); con --solo-este-equipo vuelve a cerrarlo.
  local-estado     Que esta arriba y cuantas mediciones, alertas y sugerencias reales hay en los ultimos minutos.
  local-detener    Detiene simulacion, n8n, Mosquitto y Supabase local (conservan sus datos).
  local-web        Inicia la web contra el Supabase local en http://127.0.0.1:5189. No toca web/.env.local
                   (que sigue apuntando a la nube): pasa la URL y la clave publica locales solo a ese proceso.
  local-probar     Prueba real de punta a punta contra lo que esta en marcha (unos seis minutos): simulacion, clima,
                   ajustes, alertas, IA con Gemini, webhooks, nodo fisico, sectores y Realtime.
  estado           Muestra contenedores y puertos.
  detener          Detiene Mosquitto y n8n (conserva sus datos).
EOF
}
# Archivo de claves en uso: .local/secretos.env (Supabase en la nube) o, en los comandos local-*,
# .local/entorno-local.env (Supabase local en Docker). Mismos nombres de variable en los dos.
ARCHIVO_SECRETOS="${ARCHIVO_SECRETOS:-$PRIV/secretos.env}"
# Regla unica de destino: la nube, o un Supabase de desarrollo en este equipo. Ningun otro http.
URL_SUPABASE_VALIDA='^(https://[a-z0-9-]+\.supabase\.co|http://(127\.0\.0\.1|localhost|host\.docker\.internal):[0-9]{2,5})$'
leer_secreto() { # leer_secreto NOMBRE -> valor sin imprimirlo en logs
  local v; v="$(grep -E "^$1=" "$ARCHIVO_SECRETOS" 2>/dev/null | head -1 | cut -d= -f2- || true)"; printf '%s' "$v"
}
exigir_secreto() {
  local v; v="$(leer_secreto "$1")"
  if [[ -z "$v" || "$v" == *TU_PROYECTO* ]]; then echo "Falta $1 en .local/$(basename "$ARCHIVO_SECRETOS")" >&2; exit 1; fi
}
node25() { # El proyecto pide Node 24+; se usa el de nvm si el del sistema es anterior.
  if [[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 24 ]]; then return; fi
  # shellcheck disable=SC1091
  [[ -s "$HOME/.nvm/nvm.sh" ]] && source "$HOME/.nvm/nvm.sh" >/dev/null && nvm use 25 >/dev/null 2>&1 || true
}

preparar() {
  git -C "$RAIZ" check-ignore -q .local/mqtt/passwd || { echo ".local no esta excluido de Git; se detiene." >&2; exit 1; }
  mkdir -p "$PRIV/mqtt" "$PRIV/n8n-docker"; chmod 700 "$PRIV" "$PRIV/mqtt" "$PRIV/n8n-docker"
  if [[ -f "$PRIV/mqtt/passwd" ]]; then echo "Claves MQTT ya existen; se conservan."; return; fi
  local tmp="$PRIV/mqtt/passwd.nuevo"; umask 077; : > "$tmp"
  for u in nodo_dht22 nodo_ldr simulador receptor; do
    local clave; clave="$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | cut -c1-24)"
    printf '%s:%s\n' "$u" "$clave" >> "$tmp"
    printf -- '-h 127.0.0.1\n-p 18883\n-V mqttv311\n-q 1\n-u %s\n-P %s\n' "$u" "$clave" > "$PRIV/mqtt/$u.conf"
  done
  # Convierte las claves a hash dentro del contenedor oficial, sin pasarlas por argumentos.
  docker run --rm --user "$AGROVIGIA_UID:$AGROVIGIA_GID" -v "$PRIV/mqtt:/m" eclipse-mosquitto:2.0.20 mosquitto_passwd -U /m/passwd.nuevo
  mv "$tmp" "$PRIV/mqtt/passwd"; chmod 600 "$PRIV/mqtt/"*
  echo "Claves MQTT generadas en .local/mqtt (no compartir)."
}

esperar_puerto() { for _ in $(seq 1 60); do (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && return 0; sleep 1; done; echo "Puerto $1 no respondio." >&2; return 1; }
iniciar() {
  [[ -f "$PRIV/mqtt/passwd" ]] || preparar
  AGROVIGIA_MQTT_BIND="${1:-127.0.0.1}" "${COMPOSE[@]}" up -d
  esperar_puerto 18883 && echo "Mosquitto listo en ${1:-127.0.0.1}:18883"
  esperar_puerto 5678 && echo "n8n listo en http://localhost:5678"
}

# Clave del webhook de ingesta HTTP (cabecera X-AgroVigia-Clave). Se genera una vez y nunca se imprime.
clave_ingesta() {
  local archivo="$PRIV/ingesta-http/clave"
  if [[ -s "$archivo" ]]; then return; fi
  mkdir -p "$PRIV/ingesta-http"; chmod 700 "$PRIV/ingesta-http"
  (umask 077; head -c 48 /dev/urandom | base64 | tr -d '/+=\n' | cut -c1-40 > "$archivo")
  echo "Clave de ingesta HTTP generada en .local/ingesta-http/clave (no compartir)."
}

configurar_n8n() {
  for s in SUPABASE_URL SUPABASE_SECRET_KEY GEMINI_API_KEY; do exigir_secreto "$s"; done
  # n8n corre en Docker: para un Supabase local usa SUPABASE_URL_N8N (http://host.docker.internal:<puerto>).
  local url; url="$(leer_secreto SUPABASE_URL_N8N)"; url="${url:-$(leer_secreto SUPABASE_URL)}"; url="${url%/}"
  [[ "$url" =~ $URL_SUPABASE_VALIDA ]] || { echo "SUPABASE_URL debe ser https://<proyecto>.supabase.co o un Supabase local (http://127.0.0.1:<puerto>, localhost u host.docker.internal)" >&2; exit 1; }
  local modelo; modelo="$(leer_secreto GEMINI_MODELO)"; modelo="${modelo:-gemini-3.5-flash-lite}"
  clave_ingesta
  local dir="$PRIV/n8n-docker/importar"; mkdir -p "$dir"; chmod 700 "$dir"; umask 077
  # Credenciales: se cifran al importarlas en n8n y el archivo plano se borra enseguida.
  RAIZ="$RAIZ" PRIV="$PRIV" ARCHIVO_SECRETOS="$ARCHIVO_SECRETOS" URL="$url" MODELO="$modelo" node "$RAIZ/local/preparar-n8n.cjs" "$dir"
  trap 'rm -f "$dir/credenciales.json"' EXIT
  "${COMPOSE[@]}" exec -T n8n n8n import:credentials --input=/home/node/.n8n/importar/credenciales.json
  rm -f "$dir/credenciales.json"; trap - EXIT
  # flujos.txt: una linea "archivo:id" por flujo preparado (03e y 03f por MQTT, 03g por HTTP, 03h sugerencias a peticion, 03i nodos por HTTPS).
  local f id
  while IFS=: read -r f id; do
    [[ -n "$f" && -n "$id" ]] || continue
    "${COMPOSE[@]}" exec -T n8n n8n import:workflow --input="/home/node/.n8n/importar/$f" < /dev/null
    "${COMPOSE[@]}" exec -T n8n n8n publish:workflow --id="$id" < /dev/null 2>/dev/null \
      || "${COMPOSE[@]}" exec -T n8n n8n update:workflow --id="$id" --active=true < /dev/null
  done < "$dir/flujos.txt"
  "${COMPOSE[@]}" restart n8n >/dev/null; esperar_puerto 5678
  echo "Flujos 03e, 03f, 03g, 03h y 03i importados y publicados. Abre http://localhost:5678 (crea la cuenta local de n8n la primera vez)."
  echo "Ingesta por HTTP: POST http://localhost:5678/webhook/agrovigia/telemetria (simulador) y /webhook/agrovigia/nodo (placas con clave propia). Ver n8n/INGESTA_HTTP.md."
}

migrar() {
  exigir_secreto SUPABASE_DB_URL
  local db; db="$(leer_secreto SUPABASE_DB_URL)"
  # 0009 se apoya en las zonas y la ingesta v3 de Juan (0007/0008), ya aplicadas en Supabase.
  if [[ "$(PGCONNECT_TIMEOUT=15 psql "$db" -X -tA -c "SELECT to_regclass('public.zonas') IS NOT NULL AND to_regprocedure('public.registrar_lote_simulado_v3(text,text,timestamptz,boolean,boolean,boolean)') IS NOT NULL")" != "t" ]]; then
    echo "Faltan 0007/0008 de zonas en Supabase. Aplicalas primero (supabase/APLICAR_ZONAS_SIMULADAS.md)." >&2; exit 1
  fi
  local m
  for m in 202611030009_cultivos_clima_dispositivos:cultivo_plantillas 202611030010_ia_red_simulacion:sugerencias_ia \
           202611030011_simulacion_manual_y_solicitudes:solicitudes_ia 202611030012_terreno_sectores_nodos_fisicos:nodo_claves; do
    if [[ "$(PGCONNECT_TIMEOUT=15 psql "$db" -X -tA -c "SELECT to_regclass('public.${m#*:}') IS NOT NULL")" == "t" ]]; then
      echo "${m%%_*} ya aplicada; no se repite."
    else
      psql "$db" -v ON_ERROR_STOP=1 -X -q -f "$RAIZ/supabase/migrations/${m%%:*}.sql" && echo "${m%%:*} aplicada."
    fi
  done
  psql "$db" -v ON_ERROR_STOP=1 -X -f "$RAIZ/supabase/provisionar-hexagonos.sql"
  psql "$db" -v ON_ERROR_STOP=1 -X -f "$RAIZ/supabase/verificar-ia-hexagonos.sql"
  psql "$db" -v ON_ERROR_STOP=1 -X -f "$RAIZ/supabase/verificar-terreno-nodos.sql"
}

# Mapa publico de nodos virtuales para el simulador (sin claves). asignacion_version cambia si el nodo se mueve.
mapa() {
  exigir_secreto SUPABASE_DB_URL
  mkdir -p "$PRIV/simulacion"; umask 077
  PGCONNECT_TIMEOUT=15 psql "$(leer_secreto SUPABASE_DB_URL)" -X -tA -v ON_ERROR_STOP=1 -c "SELECT coalesce(json_agg(json_build_object(
      'nodo_codigo', n.codigo, 'asignacion_version', n.asignacion_version, 'plantilla', c.plantilla_codigo,
      'cultivo', c.nombre, 'zona', z.nombre, 'cultivo_id', n.cultivo_id, 'zona_id', n.zona_id, 'zona_codigo', z.codigo,
      'habilitado', n.habilitado, 'variables_simuladas', (SELECT count(*) FROM public.nodo_variables v WHERE v.nodo_id = n.id AND v.sensor_modelo = 'SIMULADOR_V3'))
      ORDER BY n.codigo), '[]')
    FROM public.nodos n JOIN public.cultivos c ON c.id = n.cultivo_id JOIN public.zonas z ON z.id = n.zona_id
    WHERE n.tipo_nodo = 'virtual' AND n.habilitado AND c.archivado_en IS NULL" > "$PRIV/simulacion/nodos.json"
  echo "Mapa exportado en .local/simulacion/nodos.json"
}


web() {
  exigir_secreto SUPABASE_URL; exigir_secreto SUPABASE_PUBLISHABLE_KEY
  local clave; clave="$(leer_secreto SUPABASE_PUBLISHABLE_KEY)"
  [[ "$clave" == sb_publishable_* ]] || { echo "La web solo admite la Publishable key (sb_publishable_)." >&2; exit 1; }
  umask 077; printf 'VITE_SUPABASE_URL=%s\nVITE_SUPABASE_PUBLISHABLE_KEY=%s\n' "$(leer_secreto SUPABASE_URL)" "$clave" > "$RAIZ/web/.env.local"
  node25; cd "$RAIZ/web"; [[ -d node_modules/three ]] || npm ci --ignore-scripts --no-audit --no-fund
  exec npx vite --host 127.0.0.1
}

# Web contra el Supabase local. Las variables VITE_ del proceso mandan sobre web/.env.local, asi que el
# archivo de la nube queda intacto y las dos webs pueden estar abiertas a la vez (5173 nube, 5189 local).
web_local() {
  exigir_secreto SUPABASE_URL; exigir_secreto SUPABASE_PUBLISHABLE_KEY
  local clave; clave="$(leer_secreto SUPABASE_PUBLISHABLE_KEY)"
  [[ "$clave" == sb_publishable_* ]] || { echo "La web solo admite la Publishable key (sb_publishable_)." >&2; exit 1; }
  node25; cd "$RAIZ/web"; [[ -d node_modules/three ]] || npm ci --ignore-scripts --no-audit --no-fund
  export VITE_SUPABASE_URL; VITE_SUPABASE_URL="$(leer_secreto SUPABASE_URL)"
  export VITE_SUPABASE_PUBLISHABLE_KEY="$clave"
  # Direccion que el asistente propone para la placa: la IP de este equipo en la red, no localhost.
  local ip_lan; ip_lan="$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -1)"
  export VITE_AGROVIGIA_NODO_URL="${VITE_AGROVIGIA_NODO_URL:-${ip_lan:+http://$ip_lan:5678/webhook/agrovigia/nodo}}"
  exec npx vite --host 127.0.0.1 --port "${AGROVIGIA_WEB_LOCAL_PUERTO:-5189}" --strictPort
}

simular() {
  node25; cd "$RAIZ/simulador"; [[ -d node_modules/mqtt ]] || npm ci --ignore-scripts --no-audit --no-fund
  exec node servicio.mjs "$@"
}
panel() { node25; cd "$RAIZ/simulador"; [[ -d node_modules/mqtt ]] || npm ci --ignore-scripts --no-audit --no-fund; exec node server.mjs 5190 --mqtt; }

# ---------------------------------------------------------------------------------------------------
# Entorno local completo: Supabase LOCAL en Docker (CLI oficial por npx, sin instalar nada en el sistema),
# Mosquitto, n8n con los flujos publicados y el servicio de simulacion. Sus claves viven en
# .local/entorno-local.env (no se toca .local/secretos.env, que es de la nube). Todo es repetible.
LOCAL_ENV="$PRIV/entorno-local.env"
REGISTROS="$PRIV/registros"
# Identificadores fijos que esperan provisionar-demo.sql, habilitar-ldr-nodo.sql y probar-*.sql.
CUENTA_LOCAL="3611e8b0-13ba-45ec-a66f-b066315a7341"
CULTIVO_LOCAL="52ea4628-c470-48f4-a09a-0f9a697d22b4"
sb() { node25; (cd "$RAIZ" && npx --yes supabase "$@"); }
sql_local() { PGCONNECT_TIMEOUT=15 psql "$(ARCHIVO_SECRETOS="$LOCAL_ENV" leer_secreto SUPABASE_DB_URL)" -X -v ON_ERROR_STOP=1 "$@"; }

# Escribe .local/entorno-local.env con lo que entrega la CLI local. Conserva la cuenta de prueba ya creada.
local_entorno() {
  local estado; estado="$(sb status -o env 2>/dev/null)" || { echo "El Supabase local no responde." >&2; exit 1; }
  dato_local() { printf '%s\n' "$estado" | grep -E "^$1=" | head -1 | cut -d= -f2- | tr -d '"'; }
  local url publica secreta db puerto correo clave gemini modelo bind
  url="$(dato_local API_URL)"; publica="$(dato_local PUBLISHABLE_KEY)"; secreta="$(dato_local SECRET_KEY)"; db="$(dato_local DB_URL)"
  [[ "$url" =~ ^http://127\.0\.0\.1:[0-9]+$ && "$publica" == sb_publishable_* && "$secreta" == sb_secret_* && -n "$db" ]] \
    || { echo "La CLI de Supabase no entrego la URL y las claves locales esperadas." >&2; exit 1; }
  puerto="${url##*:}"
  correo="$(ARCHIVO_SECRETOS="$LOCAL_ENV" leer_secreto AGROVIGIA_USUARIO_CORREO)"; correo="${correo:-agricultor@agrovigia.test}"
  clave="$(ARCHIVO_SECRETOS="$LOCAL_ENV" leer_secreto AGROVIGIA_USUARIO_CLAVE)"
  [[ -n "$clave" ]] || clave="$(head -c 24 /dev/urandom | base64 | tr -d '/+=\n' | cut -c1-20)"
  bind="${AGROVIGIA_N8N_BIND:-$(ARCHIVO_SECRETOS="$LOCAL_ENV" leer_secreto AGROVIGIA_N8N_BIND)}"; bind="${bind:-127.0.0.1}"
  gemini="$(ARCHIVO_SECRETOS="$PRIV/secretos.env" leer_secreto GEMINI_API_KEY)"
  modelo="$(ARCHIVO_SECRETOS="$PRIV/secretos.env" leer_secreto GEMINI_MODELO)"
  [[ -n "$gemini" ]] || echo "Aviso: no hay GEMINI_API_KEY en .local/secretos.env; las sugerencias de IA quedaran en error." >&2
  ( umask 077
    { echo "# Entorno LOCAL de AgroVigia (Supabase en Docker). Generado por local/agrovigia.sh local-iniciar. No compartir."
      echo "SUPABASE_URL=$url"
      echo "SUPABASE_URL_N8N=http://host.docker.internal:$puerto"
      echo "SUPABASE_PUBLISHABLE_KEY=$publica"
      echo "SUPABASE_SECRET_KEY=$secreta"
      echo "SUPABASE_DB_URL=$db"
      echo "GEMINI_API_KEY=$gemini"
      [[ -z "$modelo" ]] || echo "GEMINI_MODELO=$modelo"
      echo "AGROVIGIA_USUARIO_CORREO=$correo"
      echo "AGROVIGIA_USUARIO_CLAVE=$clave"
      echo "AGROVIGIA_N8N_BIND=$bind"
    } > "$LOCAL_ENV.nuevo" )
  mv "$LOCAL_ENV.nuevo" "$LOCAL_ENV"; chmod 600 "$LOCAL_ENV"
}

# Cuenta de Auth, perfil y los tres cultivos con sus hexagonos, con los guiones de aprovisionamiento del repo.
local_datos() {
  node25; node "$RAIZ/local/cuenta-local.mjs" "$LOCAL_ENV"
  sql_local -q -c "INSERT INTO public.perfiles (id, nombre) VALUES ('$CUENTA_LOCAL', 'Agricultor de prueba (local)'), ('f11baaf9-0461-4b73-94d6-d8eff18c6fa8', 'Otra cuenta (aislamiento)') ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.cultivos (id, agricultor_id, nombre, tipo, area, unidad_area, solicitud_id)
    VALUES ('$CULTIVO_LOCAL', '$CUENTA_LOCAL', 'Lote Plátano', 'Plátano', 1, 'ha', 'b8aff795-b68e-4559-99c8-e596d567e677') ON CONFLICT DO NOTHING;"
  if [[ "$(sql_local -tA -c "SELECT count(*) FROM public.nodos WHERE codigo = 'agv-dht22-01'")" == "0" ]]; then
    sql_local -q -f "$RAIZ/supabase/provisionar-demo.sql" > /dev/null
  fi
  sql_local -q -f "$RAIZ/supabase/habilitar-ldr-nodo.sql" > /dev/null
  sed "s/p_cultivo_id uuid := NULL;/p_cultivo_id uuid := '$CULTIVO_LOCAL';/" "$RAIZ/supabase/provisionar-simulacion.sql" | sql_local -q -f - > /dev/null
  sql_local -q -f "$RAIZ/supabase/provisionar-hexagonos.sql" > /dev/null
  # Reglas reales del cultivo del nodo fisico, como la propia cuenta, solo si todavia no tiene.
  sql_local -q -c "BEGIN; SELECT set_config('request.jwt.claims', '{\"sub\":\"$CUENTA_LOCAL\",\"role\":\"authenticated\"}', true);
    SELECT set_config('request.jwt.claim.sub', '$CUENTA_LOCAL', true);
    SELECT public.aplicar_plantilla_cultivo('$CULTIVO_LOCAL', 'platano', true, 'real')
     WHERE NOT EXISTS (SELECT 1 FROM public.reglas_alerta WHERE cultivo_id = '$CULTIVO_LOCAL' AND origen = 'real' AND habilitada); COMMIT;" > /dev/null
  echo "Datos de arranque listos: $(sql_local -tA -c "SELECT count(*) || ' cultivos, ' || (SELECT count(*) FROM public.nodos) || ' nodos, ' || (SELECT count(*) FROM public.reglas_alerta WHERE habilitada) || ' reglas activas' FROM public.cultivos")"
}

# n8n: credenciales y flujos publicados contra el Supabase local. MQTT contra el Mosquitto del proyecto.
local_n8n() {
  [[ -f "$PRIV/mqtt/passwd" ]] || preparar
  local bind; bind="$(ARCHIVO_SECRETOS="$LOCAL_ENV" leer_secreto AGROVIGIA_N8N_BIND)"
  AGROVIGIA_N8N_BIND="${bind:-127.0.0.1}" AGROVIGIA_MQTT_BIND="${AGROVIGIA_MQTT_BIND:-127.0.0.1}" "${COMPOSE[@]}" up -d > /dev/null 2>&1
  esperar_puerto 18883 > /dev/null && esperar_puerto 5678 > /dev/null
  ARCHIVO_SECRETOS="$LOCAL_ENV" configurar_n8n > "$REGISTROS/n8n-configuracion.log" 2>&1 \
    || { echo "No se pudieron importar los flujos en n8n. Ver .local/registros/n8n-configuracion.log" >&2; exit 1; }
  # n8n abre el puerto antes de registrar sus webhooks: se espera a que el de nodos responda (401 sin clave).
  local i; for i in $(seq 1 60); do
    [[ "$(curl -s -m 3 -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:5678/webhook/agrovigia/nodo -d '{}' 2>/dev/null)" == "401" ]] && break; sleep 2
  done
  echo "n8n listo: flujos 03e, 03f, 03g, 03h y 03i publicados contra el Supabase local."
}

local_simulador() {
  local pid="$REGISTROS/simulador.pid"
  if [[ -f "$pid" ]] && kill -0 "$(cat "$pid")" 2>/dev/null; then echo "Servicio de simulacion ya estaba en marcha."; return; fi
  node25; ( cd "$RAIZ/simulador" && { [[ -d node_modules/mqtt ]] || npm ci --ignore-scripts --no-audit --no-fund > /dev/null 2>&1; } )
  # Desligado de la terminal: sigue en marcha al cerrar la ventana. El identificador guardado es el del propio proceso.
  ( cd "$RAIZ/simulador" || exit 1
    AGROVIGIA_ENTORNO="$LOCAL_ENV" nohup setsid node servicio.mjs --sondeo 5 >> "$REGISTROS/simulador.log" 2>&1 < /dev/null &
    echo $! > "$pid" )
  sleep 2; kill -0 "$(cat "$pid")" 2>/dev/null || { echo "El servicio de simulacion no arranco. Ver .local/registros/simulador.log" >&2; exit 1; }
  echo "Servicio de simulacion en marcha (registro en .local/registros/simulador.log)."
}

local_iniciar() {
  mkdir -p "$REGISTROS"; chmod 700 "$REGISTROS"
  if [[ "${1:-}" == "--lan" ]]; then export AGROVIGIA_N8N_BIND=0.0.0.0; fi
  if [[ "${1:-}" == "--solo-este-equipo" ]]; then export AGROVIGIA_N8N_BIND=127.0.0.1; fi
  echo "Iniciando Supabase local (la primera vez descarga sus imagenes)..."
  # La salida normal de la CLI incluye claves: no se guarda en ningun registro.
  sb start > /dev/null 2>"$REGISTROS/supabase.log" || { echo "Supabase local no arranco. Ver .local/registros/supabase.log" >&2; exit 1; }
  sb migration up > /dev/null 2>>"$REGISTROS/supabase.log" || { echo "No se pudieron aplicar las migraciones. Ver .local/registros/supabase.log" >&2; exit 1; }
  local_entorno
  local_datos
  local_n8n
  local_simulador
  local_estado
}

local_estado() {
  [[ -f "$LOCAL_ENV" ]] || { echo "Todavia no existe .local/entorno-local.env. Ejecuta local/agrovigia.sh local-iniciar."; return; }
  echo "Contenedores:"; docker ps --format '  {{.Names}}  {{.Status}}' | grep -E 'supabase_.*_agrovigia|agrovigia-(mosquitto|n8n)' || echo "  ninguno en marcha"
  local pid="$REGISTROS/simulador.pid"
  if [[ -f "$pid" ]] && kill -0 "$(cat "$pid")" 2>/dev/null; then echo "Servicio de simulacion: en marcha"; else echo "Servicio de simulacion: detenido"; fi
  echo "Supabase local: $(ARCHIVO_SECRETOS="$LOCAL_ENV" leer_secreto SUPABASE_URL)   n8n: http://localhost:5678 (escucha en $(ARCHIVO_SECRETOS="$LOCAL_ENV" leer_secreto AGROVIGIA_N8N_BIND))"
  sql_local -P pager=off -c "SELECT
      (SELECT count(*) FROM public.mediciones WHERE recibida_en > now() - interval '5 minutes' AND origen = 'simulado') AS simuladas_5min,
      (SELECT count(*) FROM public.mediciones WHERE recibida_en > now() - interval '5 minutes' AND origen = 'real') AS reales_5min,
      (SELECT max(recibida_en)::timestamptz(0) FROM public.mediciones) AS ultima_medicion,
      (SELECT count(*) FROM public.alertas WHERE cerrada_en IS NULL) AS alertas_abiertas,
      (SELECT count(*) FROM public.alertas WHERE abierta_en > now() - interval '15 minutes') AS alertas_15min,
      (SELECT count(*) FROM public.sugerencias_ia WHERE estado = 'generada' AND solicitada_en > now() - interval '60 minutes') AS sugerencias_60min,
      (SELECT count(*) FROM public.solicitudes_ia WHERE cerrada_en IS NULL) AS solicitudes_abiertas" 2>/dev/null \
    || echo "La base local no responde."
}

local_detener() {
  local pid="$REGISTROS/simulador.pid"
  if [[ -f "$pid" ]] && kill "$(cat "$pid")" 2>/dev/null; then echo "Servicio de simulacion detenido."; fi
  rm -f "$pid"
  "${COMPOSE[@]}" stop > /dev/null 2>&1 && echo "n8n y Mosquitto detenidos (conservan sus datos)."
  sb stop > /dev/null 2>&1 && echo "Supabase local detenido (conserva sus datos)."
}

case "${1:-}" in
  preparar) preparar ;;
  iniciar) iniciar ;;
  iniciar-lan) iniciar 0.0.0.0 ;;
  configurar-n8n) configurar_n8n ;;
  migrar) migrar ;;
  web) web ;;
  mapa) mapa ;;
  simular) shift; simular "$@" ;;
  panel) panel ;;
  local-iniciar) shift; local_iniciar "${1:-}" ;;
  local-estado) local_estado ;;
  local-detener) local_detener ;;
  local-probar) node25; exec node "$RAIZ/local/prueba-real.mjs" ;;
  local-web) ARCHIVO_SECRETOS="$LOCAL_ENV"; web_local ;;
  estado) "${COMPOSE[@]}" ps ;;
  detener) "${COMPOSE[@]}" stop ;;
  *) ayuda ;;
esac
