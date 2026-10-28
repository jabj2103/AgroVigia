// AgroVigia: nodo ambiental v2, DHT22 + indice relativo ADC LDR, MQTT QoS 1.
// Prueba temporal en red local de confianza, sin TLS. No exponer a Internet.
#include <Arduino.h>
#include <WiFi.h>
#include <ArduinoMqttClient.h>
#include <DHT.h>
#include <esp_random.h>
#include <esp_sntp.h>
#include <math.h>
#include <time.h>
#include "config_local.h"

// GPIO 34 es ADC1 en el ESP32 clasico y se puede leer con Wi-Fi activo.
#if !defined(CONFIG_IDF_TARGET_ESP32)
#error "Este montaje usa GPIO 34 del ESP32 clasico. Revisar placa y entrada ADC antes de compilar."
#endif
constexpr uint8_t DHT_PIN = 4;
constexpr uint8_t LDR_PIN = 34;
constexpr uint8_t LDR_MUESTRAS = 16;
constexpr uint32_t INTERVALO_LDR_DIAG_MS = 1000;
constexpr char NODO_CODIGO[] = "agv-dht22-01";
constexpr char TOPICO[] = "agrovigia/v2/real/nodos/agv-dht22-01/telemetria";
constexpr uint32_t INTERVALO_MS = 60000;
constexpr uint32_t CADUCIDAD_MS = 300000;
constexpr uint32_t VIGENCIA_RELOJ_MS = 2UL * 60UL * 60UL * 1000UL;
constexpr uint32_t ESPERAS_MS[] = {2000, 4000, 8000};

DHT dht(DHT_PIN, DHT22);
WiFiClient transporte;
MqttClient mqtt(transporte);
volatile bool relojSincronizado = false;
volatile uint32_t ultimaSincronizacionMs = 0;
uint32_t ultimoCicloMs = 0;
uint32_t ultimoDiagnosticoLdrMs = 0;
uint32_t ultimoIntentoWifiMs = 0;
uint32_t ultimoIntentoMqttMs = 0;
uint32_t ultimoAvisoRelojMs = 0;
time_t ultimaCapturaEpoch = 0;
bool primeraCaptura = true;

struct LotePendiente {
  bool activo = false;
  char id[37] = {};
  char payload[768] = {};
  size_t longitud = 0;
  uint32_t capturadoMs = 0;
  uint32_t intentoDesdeMs = 0;
  uint32_t esperaMs = 0;
  uint8_t intentos = 0;
};
LotePendiente lote;

// Mismo promedio de 16 conversiones para diagnostico y nueva captura MQTT.
uint16_t leerLdrPromedio(uint16_t& minimo, uint16_t& maximo) {
  uint32_t suma = 0;
  minimo = 4095; maximo = 0;
  for (uint8_t i = 0; i < LDR_MUESTRAS; ++i) {
    const uint16_t lectura = analogRead(LDR_PIN);
    suma += lectura;
    if (lectura < minimo) minimo = lectura;
    if (lectura > maximo) maximo = lectura;
  }
  return (suma + LDR_MUESTRAS / 2) / LDR_MUESTRAS;
}

// Indice relativo del ADC: no lux, no porcentaje de luz fisica ni calibracion.
// Decimas redondeadas con enteros; no autoajustar referencias por cada placa.
uint16_t indiceLdrDecimas(uint16_t adc) {
  return (static_cast<uint32_t>(adc) * 1000UL + 2047UL) / 4095UL;
}

void mostrarDiagnosticoLdr(uint32_t ahora) {
  if (ahora - ultimoDiagnosticoLdrMs < INTERVALO_LDR_DIAG_MS) return;
  ultimoDiagnosticoLdrMs = ahora;
  uint16_t minimo, maximo;
  const uint16_t promedio = leerLdrPromedio(minimo, maximo);
  Serial.printf("[LDR_DIAG] gpio=%u adc_promedio=%u adc_min=%u adc_max=%u muestras=%u ms=%lu solo_serial=0\n",
    static_cast<unsigned>(LDR_PIN), static_cast<unsigned>(promedio),
    static_cast<unsigned>(minimo), static_cast<unsigned>(maximo),
    static_cast<unsigned>(LDR_MUESTRAS), static_cast<unsigned long>(ahora));
}
void alSincronizar(struct timeval*) {
  ultimaSincronizacionMs = millis();
  relojSincronizado = true;
}

bool relojValido(time_t instante) {
  // El callback SNTP acredita sincronizacion; una fecha plausible sola no basta.
  if (!relojSincronizado || millis() - ultimaSincronizacionMs > VIGENCIA_RELOJ_MS ||
      instante < 1704067200LL || instante >= 4102444800LL) return false;
  if (ultimaCapturaEpoch && instante < ultimaCapturaEpoch) {
    relojSincronizado = false;
    configTime(0, 0, "pool.ntp.org", "time.google.com");
    return false;
  }
  return true;
}

void generarUuid(char* destino) {
  uint8_t b[16];
  // Solo se llama con Wi-Fi activo, fuente de entropia para esp_fill_random.
  esp_fill_random(b, sizeof(b));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  snprintf(destino, 37,
    "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
    b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7],
    b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]);
}

bool conectarMqtt() {
  if (mqtt.connected()) return true;
  if (WiFi.status() != WL_CONNECTED) return false;
  ultimoIntentoMqttMs = millis();
  if (mqtt.connect(MQTT_HOST, MQTT_PORT)) {
    Serial.printf("[MQTT_CONECTADO] %s:%u usuario=%s\n", MQTT_HOST, MQTT_PORT, MQTT_USERNAME);
    return true;
  }
  Serial.printf("[MQTT_ERROR] codigo=%d; revisar IP, puerto, listener, acceso de red y credenciales.\n", mqtt.connectError());
  mqtt.stop();
  return false;
}

bool capturarLote() {
  const float temperatura = dht.readTemperature();
  const float humedad = dht.readHumidity();
  uint16_t ldrMinimo, ldrMaximo;
  const uint16_t adc = leerLdrPromedio(ldrMinimo, ldrMaximo);
  const float iluminacion = indiceLdrDecimas(adc) / 10.0f;
  const time_t instante = time(nullptr);
  if (!isfinite(temperatura) || !isfinite(humedad) ||
      temperatura < -40 || temperatura > 80 || humedad < 0 || humedad > 100) {
    Serial.println("[SENSOR_ERROR] Se descarta el par completo; no se publican ceros de reemplazo.");
    return false;
  }
  if (!relojValido(instante)) {
    Serial.println("[RELOJ_ERROR] Captura descartada: reloj no valido.");
    return false;
  }
  struct tm utc;
  char fecha[21];
  if (!gmtime_r(&instante, &utc) || strftime(fecha, sizeof(fecha), "%Y-%m-%dT%H:%M:%SZ", &utc) != 20) return false;
  generarUuid(lote.id);
  const int longitud = snprintf(lote.payload, sizeof(lote.payload),
    "{\"version\":2,\"nodo_codigo\":\"%s\",\"mensaje_id\":\"%s\",\"origen\":\"real\","
    "\"tomada_en\":\"%s\",\"ldr\":{\"metodo\":\"adc12_10k_11db_v1\",\"adc_promedio\":%u},\"mediciones\":["
    "{\"variable_codigo\":\"temperatura_aire\",\"valor\":%.1f,\"unidad\":\"\xC2\xB0" "C\"},"
    "{\"variable_codigo\":\"humedad_aire\",\"valor\":%.1f,\"unidad\":\"%% HR\"},"
    "{\"variable_codigo\":\"iluminacion_relativa\",\"valor\":%.1f,\"unidad\":\"%% relativo\"}]}",
    NODO_CODIGO, lote.id, fecha, static_cast<unsigned>(adc), temperatura, humedad, iluminacion);
  if (longitud <= 0 || static_cast<size_t>(longitud) >= sizeof(lote.payload)) {
    Serial.println("[JSON_ERROR] Payload incompleto; no se publica.");
    return false;
  }
  lote.longitud = static_cast<size_t>(longitud);
  lote.capturadoMs = millis();
  lote.intentoDesdeMs = lote.capturadoMs;
  lote.esperaMs = 0;
  lote.intentos = 0;
  lote.activo = true;
  ultimaCapturaEpoch = instante;
  Serial.printf("[CAPTURA_REAL] %s\n", lote.payload);
  return true;
}

void intentarPublicar() {
  ++lote.intentos;
  bool confirmado = false;
  if (conectarMqtt() && millis() - lote.capturadoMs < CADUCIDAD_MS) {
    if (mqtt.beginMessage(TOPICO, static_cast<unsigned long>(lote.longitud), false, static_cast<uint8_t>(1), false)) {
      if (mqtt.write(reinterpret_cast<const uint8_t*>(lote.payload), lote.longitud) == lote.longitud) {
        confirmado = mqtt.endMessage() == 1; // Espera PUBACK, no escritura en Supabase.
      }
    }
  }
  if (confirmado) {
    Serial.printf("[MQTT_ACK] id=%s intento=%u qos=1 retain=0; falta verificar receptor.\n", lote.id, lote.intentos);
    lote.activo = false;
    return;
  }
  mqtt.stop(); // Limpia el estado antes de reintentar el mismo lote por otra sesion limpia.
  if (lote.intentos >= 4 || millis() - lote.capturadoMs >= CADUCIDAD_MS) {
    Serial.printf("[LOTE_DESCARTADO] id=%s intentos=%u; sin confirmacion.\n", lote.id, lote.intentos);
    lote.activo = false;
    return;
  }
  lote.intentoDesdeMs = millis();
  lote.esperaMs = ESPERAS_MS[lote.intentos - 1];
  Serial.printf("[REINTENTO] id=%s en=%lu ms; se conservan JSON y fecha.\n", lote.id, static_cast<unsigned long>(lote.esperaMs));
}

void setup() {
  Serial.begin(115200);
  dht.begin();
  pinMode(LDR_PIN, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(LDR_PIN, ADC_11db);
  Serial.printf("[LDR_INICIO] GPIO %u, ADC 12 bits (0..4095), atenuacion 11 dB, resistencia externa 10k; envio ambiental v2 y diagnostico serie.\n", static_cast<unsigned>(LDR_PIN));
  Serial.printf("AgroVigia DHT22 + LDR MQTT v2 | DHT GPIO %u | 115200 baudios\n", DHT_PIN);
  if (!strlen(WIFI_SSID) || strcmp(WIFI_SSID, "CAMBIAR_SSID") == 0 ||
      strcmp(WIFI_PASSWORD, "CAMBIAR_CLAVE_WIFI") == 0 ||
      strcmp(MQTT_HOST, "IP_DEL_COMPUTADOR") == 0 ||
      !strlen(MQTT_PASSWORD) || strcmp(MQTT_USERNAME, "nodo_dht22") != 0) {
    Serial.println("[CONFIG_ERROR] Completar config_local.h; no se inicia la red.");
    while (true) delay(1000);
  }
  transporte.setConnectionTimeout(3000);
  mqtt.setConnectionTimeout(4000);
  mqtt.setKeepAliveInterval(30000);
  mqtt.setCleanSession(true);
  mqtt.setId(NODO_CODIGO);
  mqtt.setUsernamePassword(MQTT_USERNAME, MQTT_PASSWORD);
  sntp_set_time_sync_notification_cb(alSincronizar);
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("[WIFI_INICIO] MQTT previsto en %s:%u; esperando Wi-Fi y reloj UTC.\n", MQTT_HOST, MQTT_PORT);
}

void loop() {
  const uint32_t ahora = millis();
  mostrarDiagnosticoLdr(ahora);
  if (WiFi.status() != WL_CONNECTED && ahora - ultimoIntentoWifiMs >= 10000) {
    ultimoIntentoWifiMs = ahora;
    mqtt.stop();
    WiFi.reconnect();
    Serial.println("[WIFI_ESPERA] Sin conexion Wi-Fi; no se capturan lotes nuevos.");
  }
  if (mqtt.connected()) mqtt.poll();
  if (lote.activo) {
    if (millis() - lote.capturadoMs >= CADUCIDAD_MS) {
      Serial.printf("[LOTE_CADUCADO] id=%s; no se cambia su fecha.\n", lote.id);
      lote.activo = false;
    } else if (millis() - lote.intentoDesdeMs >= lote.esperaMs) {
      intentarPublicar();
    }
  } else if (WiFi.status() == WL_CONNECTED) {
    if (!mqtt.connected() && millis() - ultimoIntentoMqttMs >= 5000) conectarMqtt();
    if (!relojValido(time(nullptr))) {
      if (millis() - ultimoAvisoRelojMs >= 10000) {
        ultimoAvisoRelojMs = millis();
        Serial.println("[RELOJ_ESPERA] Falta sincronizacion NTP valida; no se inventa fecha.");
      }
    } else if (mqtt.connected() && millis() >= 3000 &&
               (primeraCaptura || millis() - ultimoCicloMs >= INTERVALO_MS)) {
      ultimoCicloMs = millis();
      primeraCaptura = false;
      if (capturarLote()) intentarPublicar();
    }
  }
  delay(1);
}
