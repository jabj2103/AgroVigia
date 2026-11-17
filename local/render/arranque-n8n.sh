#!/bin/sh
# Arranque de n8n en un contenedor sin disco persistente (por ejemplo Render).
# En cada inicio prepara las credenciales y los flujos de AgroVigia desde variables de entorno, los importa
# y publica por linea de comandos y despues inicia n8n. No imprime claves.
#
# Variables obligatorias: SUPABASE_URL, SUPABASE_SECRET_KEY, GEMINI_API_KEY, AGROVIGIA_INGESTA_CLAVE.
# Opcionales: GEMINI_MODELO, AGROVIGIA_INGESTA_ADMITE_REAL (si), y para los flujos MQTT 03e y 03f:
# AGROVIGIA_MQTT_HOST, AGROVIGIA_MQTT_PUERTO, AGROVIGIA_MQTT_USUARIO, AGROVIGIA_MQTT_CLAVE.
# Sin AGROVIGIA_MQTT_HOST se importan solo 03g (ingesta por HTTP), 03h (sugerencias a peticion) y 03i
# (ingesta real por HTTPS con la clave propia de cada nodo).
# AGROVIGIA_SIMULADOR=si inicia ademas el servicio de simulacion dentro del mismo contenedor, publicando
# por HTTP al webhook local: asi basta un solo servicio web gratuito.
# En Render no hace falta fijar puerto ni direccion: se toman de PORT, RENDER_EXTERNAL_URL y RENDER_EXTERNAL_HOSTNAME.
set -eu
export N8N_PORT="${N8N_PORT:-${PORT:-5678}}"
if [ -n "${RENDER_EXTERNAL_URL:-}" ]; then
  export WEBHOOK_URL="${WEBHOOK_URL:-$RENDER_EXTERNAL_URL/}" N8N_HOST="${N8N_HOST:-${RENDER_EXTERNAL_HOSTNAME:-}}" N8N_PROTOCOL="${N8N_PROTOCOL:-https}"
fi
APP="${AGROVIGIA_APP:-/opt/agrovigia}"
DIR="${AGROVIGIA_IMPORTAR:-/tmp/agrovigia-importar}"
umask 077
mkdir -p "$DIR"
trap 'rm -f "$DIR/credenciales.json"' EXIT
node "$APP/local/preparar-n8n.cjs" --entorno "$DIR"
n8n import:credentials --input="$DIR/credenciales.json"
rm -f "$DIR/credenciales.json"
trap - EXIT
while IFS=: read -r archivo id; do
  [ -n "$archivo" ] && [ -n "$id" ] || continue
  n8n import:workflow --input="$DIR/$archivo" < /dev/null
  n8n publish:workflow --id="$id" < /dev/null 2>/dev/null || n8n update:workflow --id="$id" --active=true < /dev/null
done < "$DIR/flujos.txt"
rm -rf "$DIR"
echo "AgroVigia: credenciales y flujos importados y publicados. Iniciando n8n."
if [ "${AGROVIGIA_SIMULADOR:-no}" = "si" ]; then
  (
    # Espera a que n8n responda y entonces publica al webhook local. Sin PORT para no abrir un segundo servidor.
    n=0
    until wget -q -O /dev/null "http://127.0.0.1:$N8N_PORT/healthz" 2>/dev/null; do n=$((n + 1)); [ "$n" -gt 90 ] && exit 0; sleep 2; done
    echo "AgroVigia: iniciando el servicio de simulacion contra el webhook local."
    exec env -u PORT node "$APP/simulador/servicio.mjs" --http "http://127.0.0.1:$N8N_PORT/webhook/agrovigia/telemetria"
  ) &
fi
exec n8n start
