#!/usr/bin/env bash
# Compila nodo-agrovigia-http para ESP32 Dev Module con el arduino-cli local del proyecto
# y regenera web/public/firmware (binario unico combinado y manifiesto de ESP Web Tools).
#
#   ./compilar.sh              compila y regenera binario y manifiesto
#   ./compilar.sh --instalar   antes instala arduino-cli, el core y las bibliotecas fijadas
#
# Todo queda dentro de .local/herramientas/arduino (carpeta ignorada por Git). No usa sudo
# ni instala nada en el sistema. Compilar no prueba la placa.
set -euo pipefail

CLI_VERSION="1.6.0"
CLI_SHA256="321ee249f44c78053234fec0f36101092bc6021bf24939e15e0cc2449c5ed250"
CORE="esp32:esp32@3.3.10"
BIBLIOTECAS=("DHT sensor library@1.4.7" "Adafruit Unified Sensor@1.1.15" "ArduinoJson@7.4.3")
# Flash en modo DIO a 40 MHz: el ajuste mas compatible entre placas ESP32 de 4 MB.
FQBN="esp32:esp32:esp32:PartitionScheme=default,FlashMode=dio,FlashFreq=40,FlashSize=4M"

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
BASE="${AGV_ARDUINO_DIR:-$RAIZ/.local/herramientas/arduino}"
CLI="$BASE/bin/arduino-cli"
CONFIG="$BASE/arduino-cli.yaml"
SALIDA="$RAIZ/web/public/firmware"
CONSTRUCCION="$BASE/compilacion/nodo-agrovigia-http"

arduino() { "$CLI" --config-file "$CONFIG" "$@"; }

instalar() {
  if [ "$(uname -s)-$(uname -m)" != "Linux-x86_64" ]; then
    echo "La instalacion automatica solo esta preparada para Linux de 64 bits (x86_64)." >&2
    exit 1
  fi
  mkdir -p "$BASE/bin" "$BASE/datos" "$BASE/descargas" "$BASE/usuario" "$BASE/cache"
  if [ ! -x "$CLI" ]; then
    local paquete="$BASE/descargas/arduino-cli_${CLI_VERSION}_Linux_64bit.tar.gz"
    curl -fsSL -o "$paquete" "https://downloads.arduino.cc/arduino-cli/arduino-cli_${CLI_VERSION}_Linux_64bit.tar.gz"
    echo "$CLI_SHA256  $paquete" | sha256sum --check --quiet
    tar -xzf "$paquete" -C "$BASE/bin" arduino-cli
  fi
  cat > "$CONFIG" <<EOF
board_manager:
  additional_urls:
    - https://espressif.github.io/arduino-esp32/package_esp32_index.json
directories:
  data: $BASE/datos
  downloads: $BASE/descargas
  user: $BASE/usuario
build_cache:
  path: $BASE/cache
updater:
  enable_notification: false
EOF
  arduino core update-index
  arduino lib update-index
  arduino core install "$CORE"
  arduino lib install --no-deps "${BIBLIOTECAS[@]}"
}

if [ "${1:-}" = "--instalar" ]; then
  instalar
elif [ -n "${1:-}" ]; then
  echo "Opcion desconocida: $1. Usar sin opciones o con --instalar." >&2
  exit 2
fi

if [ ! -x "$CLI" ] || [ ! -f "$CONFIG" ]; then
  echo "Falta el arduino-cli local en $BASE. Ejecutar primero: $0 --instalar" >&2
  exit 1
fi

VERSION="$(sed -n 's/^constexpr char FW_VERSION\[\] = "\([0-9][0-9.]*\)";$/\1/p' "$AQUI/nodo-agrovigia-http.ino")"
if [ -z "$VERSION" ]; then
  echo "No se encontro FW_VERSION en el sketch." >&2
  exit 1
fi
BINARIO="agv-http-esp32-$VERSION.bin"

mkdir -p "$CONSTRUCCION" "$SALIDA"
arduino compile --fqbn "$FQBN" --warnings default --build-path "$CONSTRUCCION" "$AQUI"

# Binario unico para ESP Web Tools (offset 0): gestor de arranque, tabla de particiones,
# selector de arranque y aplicacion. Se arma con el esptool del core, sin el relleno hasta
# 4 MB que agrega el combinado del core, para que el archivo pese lo justo.
ESPTOOL="$(find "$BASE/datos/packages/esp32/tools/esptool_py" -maxdepth 2 -type f -name esptool | sort | tail -n 1)"
if [ -z "$ESPTOOL" ]; then
  echo "No se encontro esptool dentro del core instalado." >&2
  exit 1
fi
PREFIJO="$CONSTRUCCION/nodo-agrovigia-http.ino"
"$ESPTOOL" --chip esp32 merge-bin -o "$SALIDA/$BINARIO" \
  --flash-mode keep --flash-freq keep --flash-size keep \
  0x1000 "$PREFIJO.bootloader.bin" 0x8000 "$PREFIJO.partitions.bin" \
  0xe000 "$CONSTRUCCION/boot_app0.bin" 0x10000 "$PREFIJO.bin"
# Control: debe coincidir byte a byte con el inicio del combinado que genera el core.
cmp -n "$(stat -c %s "$SALIDA/$BINARIO")" "$SALIDA/$BINARIO" "$PREFIJO.merged.bin"
cat > "$SALIDA/manifest.json" <<EOF
{"name":"AgroVigia nodo HTTP","version":"$VERSION","new_install_prompt_erase":true,"builds":[{"chipFamily":"ESP32","parts":[{"path":"$BINARIO","offset":0}]}]}
EOF
# En la web solo queda el binario de la version actual.
find "$SALIDA" -maxdepth 1 -type f -name 'agv-http-esp32-*.bin' ! -name "$BINARIO" -delete

echo
echo "Binario combinado: $SALIDA/$BINARIO"
echo "  bytes:  $(stat -c %s "$SALIDA/$BINARIO")"
echo "  sha256: $(sha256sum "$SALIDA/$BINARIO" | cut -d' ' -f1)"
echo "Manifiesto: $SALIDA/manifest.json"
echo "Compila. Sin probar en placa."
