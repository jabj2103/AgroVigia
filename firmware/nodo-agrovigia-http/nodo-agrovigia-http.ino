// AgroVigia: nodo ambiental por HTTP para ESP32 clasico (DHT22 + LDR).
// Envia por HTTPS, o por http sin cifrar solo a una direccion IPv4 privada de la red local.
// Se configura por el puerto serie (Web Serial desde la app), sin recompilar.
// Estado: compila. SIN PROBAR EN PLACA. Ver README.md de esta carpeta.
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <esp_random.h>
#include <esp_sntp.h>
#include <math.h>
#include <time.h>

// GPIO 34 es ADC1 en el ESP32 clasico y se puede leer con Wi-Fi activo.
#if !defined(CONFIG_IDF_TARGET_ESP32)
#error "Este montaje usa GPIO 34 del ESP32 clasico. Revisar placa y entrada ADC antes de compilar."
#endif

constexpr char FW_NOMBRE[] = "agv-http";
constexpr char FW_VERSION[] = "1.1.0";
constexpr char FW_PLACA[] = "esp32";

// TLS. Con false (valor entregado) el servidor se verifica contra el almacen de
// certificados raiz que trae el core de Espressif dentro del binario.
// RIESGO: con true se llama a setInsecure(), no se verifica el certificado y cualquier
// equipo intermedio puede leer la clave del nodo y suplantar al servidor. Solo para
// una prueba de laboratorio, nunca para un equipo instalado.
constexpr bool TLS_SIN_VERIFICAR = false;

constexpr uint8_t DHT_PIN = 4;
constexpr uint8_t LDR_PIN = 34;
constexpr uint8_t LDR_MUESTRAS = 16;
constexpr uint8_t SENSOR_DHT22 = 1;
constexpr uint8_t SENSOR_LDR = 2;
constexpr uint16_t INTERVALO_MIN_S = 10;
constexpr uint16_t INTERVALO_MAX_S = 3600;
constexpr uint16_t INTERVALO_DEFECTO_S = 60;
constexpr uint32_t CONSULTA_EN_PAUSA_MS = 300000;  // En pausa: un envio normal cada 5 minutos.
constexpr uint32_t CADUCIDAD_MS = 300000;
constexpr uint32_t VIGENCIA_RELOJ_MS = 2UL * 60UL * 60UL * 1000UL;
constexpr uint32_t ESPERAS_MS[] = {2000, 4000, 8000};
constexpr uint32_t ESPERA_CONEXION_MS = 8000;
constexpr uint32_t ESPERA_RESPUESTA_MS = 10000;
constexpr uint32_t ESPERA_TLS_S = 10;
constexpr size_t LINEA_MAX = 1024;
constexpr size_t RESPUESTA_MAX = 512;

// Almacen de certificados raiz que el core de Espressif enlaza dentro del binario.
extern const uint8_t raices_inicio[] asm("_binary_x509_crt_bundle_start");
extern const uint8_t raices_fin[] asm("_binary_x509_crt_bundle_end");

struct Configuracion {
  char wifiSsid[33] = {};
  char wifiClave[65] = {};
  char url[257] = {};
  char codigo[65] = {};
  char clave[129] = {};
  uint16_t intervalo = INTERVALO_DEFECTO_S;
  uint8_t sensores = SENSOR_DHT22 | SENSOR_LDR;
};

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

struct UltimoEnvio {
  bool hay = false;
  int http = 0;
  const char* estado = "";
  char servidor[25] = {};
  char codigo[49] = {};
  uint32_t ms = 0;
};

struct Lectura {
  float temperatura = NAN;
  float humedad = NAN;
  uint16_t adc = 0;
  uint16_t decimas = 0;
};

enum Clase { ENVIO_OK, ENVIO_RECHAZADO, ENVIO_CLAVE, ENVIO_SERVIDOR, ENVIO_RED };
enum Captura { CAPTURA_OK, CAPTURA_SENSOR, CAPTURA_RELOJ, CAPTURA_JSON };

// Recibe el cuerpo de la respuesta HTTP sin reservar mas memoria que su limite.
class TextoAcotado : public Stream {
 public:
  TextoAcotado(char* destino, size_t capacidad) : destino_(destino), capacidad_(capacidad) { destino_[0] = 0; }
  size_t write(uint8_t c) override {
    if (largo_ + 1 < capacidad_) { destino_[largo_++] = static_cast<char>(c); destino_[largo_] = 0; }
    return 1;
  }
  size_t write(const uint8_t* datos, size_t cantidad) override {
    for (size_t i = 0; i < cantidad; ++i) write(datos[i]);
    return cantidad;
  }
  int available() override { return 0; }
  int read() override { return -1; }
  int peek() override { return -1; }
 private:
  char* destino_;
  size_t capacidad_;
  size_t largo_ = 0;
};

DHT dht(DHT_PIN, DHT22);
Preferences prefs;
Configuracion cfg;
LotePendiente lote;
UltimoEnvio ultimo;
volatile bool relojSincronizado = false;
volatile uint32_t ultimaSincronizacionMs = 0;
uint32_t ultimoCicloMs = 0;
uint32_t ultimoIntentoWifiMs = 0;
uint32_t ultimoAvisoRelojMs = 0;
time_t ultimaCapturaEpoch = 0;
bool primeraCaptura = true;
bool pausado = false;
bool claveRechazada = false;
bool wifiEstabaConectado = false;
bool almacenListo = false;
char linea[LINEA_MAX + 1];
char respuestaHttp[RESPUESTA_MAX + 1];
size_t lineaLargo = 0;
bool lineaDesbordada = false;

// La negociacion TLS corre en la tarea de loop(): se le da mas pila que los 8 KB por defecto.
// Debe ir despues de los tipos: Arduino inserta aqui los prototipos de las funciones.
SET_LOOP_TASK_STACK_SIZE(16 * 1024);

// ---------- Respuestas del protocolo serie ----------

void responder(JsonDocument& doc) {
  Serial.print("AGV ");
  serializeJson(doc, Serial);
  Serial.print('\n');
}

void responderError(const char* codigo) {
  JsonDocument doc;
  doc["ok"] = false;
  doc["error"] = codigo;
  responder(doc);
}

// ---------- Configuracion en NVS ----------

bool configCompleta() {
  return cfg.wifiSsid[0] && cfg.url[0] && cfg.codigo[0] && cfg.clave[0];
}

void leerTexto(const char* nombre, char* destino, size_t capacidad) {
  destino[0] = 0;
  if (prefs.isKey(nombre) && prefs.getString(nombre, destino, capacidad) == 0) destino[0] = 0;
}

bool guardarTexto(const char* nombre, const char* valor) {
  if (!valor[0]) return prefs.isKey(nombre) ? prefs.remove(nombre) : true;
  return prefs.putString(nombre, valor) == strlen(valor);
}

bool imprimible(const char* texto) {
  for (const char* p = texto; *p; ++p) if (*p < 0x21 || *p > 0x7e) return false;
  return true;
}

bool ssidValido(const char* s) { const size_t n = strlen(s); return n >= 1 && n <= 32; }
// Vacia para red abierta; de 8 a 63 caracteres, o 64 hexadecimales, para WPA.
bool claveWifiValida(const char* s) { const size_t n = strlen(s); return n == 0 || (n >= 8 && n <= 64); }
// Lee un entero decimal sin ceros a la izquierda, de 0 a maximo, y avanza el cursor.
bool leerDecimal(const char*& p, long maximo, long& valor) {
  if (!isdigit(static_cast<unsigned char>(*p))) return false;
  if (*p == '0' && isdigit(static_cast<unsigned char>(p[1]))) return false;
  long v = 0;
  for (uint8_t cifras = 0; isdigit(static_cast<unsigned char>(*p)); ++p) {
    if (++cifras > 5) return false;
    v = v * 10 + (*p - '0');
  }
  if (v > maximo) return false;
  valor = v;
  return true;
}
// http:// solo se admite hacia una IPv4 privada escrita con numeros (10.x.x.x,
// 172.16.x.x a 172.31.x.x o 192.168.x.x), con puerto opcional y ruta opcional.
// Ni nombres de dominio ni localhost: ahi no hay cifrado que proteja la clave del nodo.
bool httpLocalValida(const char* s) {
  const char* p = s + 7;
  long o[4];
  for (uint8_t i = 0; i < 4; ++i) {
    if (i > 0 && *p++ != '.') return false;
    if (!leerDecimal(p, 255, o[i])) return false;
  }
  if (!(o[0] == 10 || (o[0] == 172 && o[1] >= 16 && o[1] <= 31) || (o[0] == 192 && o[1] == 168))) return false;
  if (*p == ':') {
    ++p;
    long puerto;
    if (!leerDecimal(p, 65535, puerto) || puerto < 1) return false;
  }
  return *p == 0 || *p == '/';
}
bool urlValida(const char* s) {
  if (strlen(s) > 256 || !imprimible(s) || strchr(s, '"')) return false;
  if (strncmp(s, "https://", 8) == 0) return s[8] && s[8] != '/' && s[8] != ':';
  if (strncmp(s, "http://", 7) == 0) return httpLocalValida(s);
  return false;
}
bool urlSinCifrar(const char* s) { return strncmp(s, "http://", 7) == 0; }
bool codigoValido(const char* s) {
  const size_t n = strlen(s);
  if (n < 1 || n > 64) return false;
  for (const char* p = s; *p; ++p) if (!((*p >= 'a' && *p <= 'z') || (*p >= '0' && *p <= '9') || *p == '-')) return false;
  return true;
}
bool claveNodoValida(const char* s) { const size_t n = strlen(s); return n >= 1 && n <= 128 && imprimible(s); }
bool intervaloValido(long v) { return v >= INTERVALO_MIN_S && v <= INTERVALO_MAX_S; }

void cargarConfig() {
  cfg = Configuracion();
  if (!almacenListo) return;
  leerTexto("wifi_ssid", cfg.wifiSsid, sizeof(cfg.wifiSsid));
  leerTexto("wifi_clave", cfg.wifiClave, sizeof(cfg.wifiClave));
  leerTexto("url", cfg.url, sizeof(cfg.url));
  leerTexto("codigo", cfg.codigo, sizeof(cfg.codigo));
  leerTexto("clave", cfg.clave, sizeof(cfg.clave));
  const uint16_t intervalo = prefs.getUShort("intervalo", INTERVALO_DEFECTO_S);
  cfg.intervalo = intervaloValido(intervalo) ? intervalo : INTERVALO_DEFECTO_S;
  const uint8_t sensores = prefs.getUChar("sensores", SENSOR_DHT22 | SENSOR_LDR);
  cfg.sensores = (sensores >= 1 && sensores <= 3) ? sensores : (SENSOR_DHT22 | SENSOR_LDR);
  // Un valor guardado que ya no pasa la validacion se trata como ausente.
  if (!ssidValido(cfg.wifiSsid) || !claveWifiValida(cfg.wifiClave)) { cfg.wifiSsid[0] = 0; cfg.wifiClave[0] = 0; }
  if (!urlValida(cfg.url)) cfg.url[0] = 0;
  if (!codigoValido(cfg.codigo)) cfg.codigo[0] = 0;
  if (!claveNodoValida(cfg.clave)) cfg.clave[0] = 0;
}

bool guardarConfig(const Configuracion& nueva) {
  if (!almacenListo) return false;
  bool bien = true;
  if (strcmp(nueva.wifiSsid, cfg.wifiSsid)) bien &= guardarTexto("wifi_ssid", nueva.wifiSsid);
  if (strcmp(nueva.wifiClave, cfg.wifiClave)) bien &= guardarTexto("wifi_clave", nueva.wifiClave);
  if (strcmp(nueva.url, cfg.url)) bien &= guardarTexto("url", nueva.url);
  if (strcmp(nueva.codigo, cfg.codigo)) bien &= guardarTexto("codigo", nueva.codigo);
  if (strcmp(nueva.clave, cfg.clave)) bien &= guardarTexto("clave", nueva.clave);
  if (nueva.intervalo != cfg.intervalo || !prefs.isKey("intervalo")) bien &= prefs.putUShort("intervalo", nueva.intervalo) == sizeof(uint16_t);
  if (nueva.sensores != cfg.sensores || !prefs.isKey("sensores")) bien &= prefs.putUChar("sensores", nueva.sensores) == sizeof(uint8_t);
  return bien;
}

// ---------- Reloj ----------

void alSincronizar(struct timeval*) {
  ultimaSincronizacionMs = millis();
  relojSincronizado = true;
}

// Consulta sin efectos: la usa la orden info.
bool relojVigente(time_t instante) {
  return relojSincronizado && millis() - ultimaSincronizacionMs <= VIGENCIA_RELOJ_MS &&
         instante >= 1704067200LL && instante < 4102444800LL &&
         !(ultimaCapturaEpoch && instante < ultimaCapturaEpoch);
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

// ---------- Sensores ----------

// Promedio redondeado de 16 conversiones, igual que el nodo MQTT.
uint16_t leerLdrPromedio() {
  uint32_t suma = 0;
  for (uint8_t i = 0; i < LDR_MUESTRAS; ++i) suma += analogRead(LDR_PIN);
  return (suma + LDR_MUESTRAS / 2) / LDR_MUESTRAS;
}

// Indice relativo del ADC en decimas: no lux, no porcentaje de luz fisica ni calibracion.
uint16_t indiceLdrDecimas(uint16_t adc) {
  return (static_cast<uint32_t>(adc) * 1000UL + 2047UL) / 4095UL;
}

// Devuelve false si el DHT22 activo no entrega un par finito y dentro de rango.
bool leerSensores(Lectura& l) {
  if (cfg.sensores & SENSOR_DHT22) {
    l.temperatura = dht.readTemperature();
    l.humedad = dht.readHumidity();
    if (!isfinite(l.temperatura) || !isfinite(l.humedad) ||
        l.temperatura < -40 || l.temperatura > 80 || l.humedad < 0 || l.humedad > 100) return false;
  }
  if (cfg.sensores & SENSOR_LDR) {
    l.adc = leerLdrPromedio();
    l.decimas = indiceLdrDecimas(l.adc);
  }
  return true;
}

// ---------- Lote ----------

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

// Con los dos sensores sale el mismo JSON v2 del nodo MQTT. Con uno solo sale el
// perfil v1 que ya admite el validador (par DHT22, o iluminacion sola), porque el
// contrato v2 exige las tres mediciones juntas.
Captura capturarLote() {
  Lectura l;
  const bool lecturaBien = leerSensores(l);
  const time_t instante = time(nullptr);
  if (!lecturaBien) {
    Serial.println("[SENSOR_ERROR] Se descarta la captura completa; no se envian ceros de reemplazo.");
    return CAPTURA_SENSOR;
  }
  if (!relojValido(instante)) {
    Serial.println("[RELOJ_ERROR] Captura descartada: reloj no valido.");
    return CAPTURA_RELOJ;
  }
  struct tm utc;
  char fecha[21];
  if (!gmtime_r(&instante, &utc) || strftime(fecha, sizeof(fecha), "%Y-%m-%dT%H:%M:%SZ", &utc) != 20) return CAPTURA_RELOJ;
  generarUuid(lote.id);
  int longitud;
  if (cfg.sensores == (SENSOR_DHT22 | SENSOR_LDR)) {
    longitud = snprintf(lote.payload, sizeof(lote.payload),
      "{\"version\":2,\"nodo_codigo\":\"%s\",\"mensaje_id\":\"%s\",\"origen\":\"real\","
      "\"tomada_en\":\"%s\",\"ldr\":{\"metodo\":\"adc12_10k_11db_v1\",\"adc_promedio\":%u},\"mediciones\":["
      "{\"variable_codigo\":\"temperatura_aire\",\"valor\":%.1f,\"unidad\":\"\xC2\xB0" "C\"},"
      "{\"variable_codigo\":\"humedad_aire\",\"valor\":%.1f,\"unidad\":\"%% HR\"},"
      "{\"variable_codigo\":\"iluminacion_relativa\",\"valor\":%u.%u,\"unidad\":\"%% relativo\"}]}",
      cfg.codigo, lote.id, fecha, static_cast<unsigned>(l.adc), l.temperatura, l.humedad,
      static_cast<unsigned>(l.decimas / 10), static_cast<unsigned>(l.decimas % 10));
  } else if (cfg.sensores == SENSOR_DHT22) {
    longitud = snprintf(lote.payload, sizeof(lote.payload),
      "{\"version\":1,\"nodo_codigo\":\"%s\",\"mensaje_id\":\"%s\",\"origen\":\"real\","
      "\"tomada_en\":\"%s\",\"mediciones\":["
      "{\"variable_codigo\":\"temperatura_aire\",\"valor\":%.1f,\"unidad\":\"\xC2\xB0" "C\"},"
      "{\"variable_codigo\":\"humedad_aire\",\"valor\":%.1f,\"unidad\":\"%% HR\"}]}",
      cfg.codigo, lote.id, fecha, l.temperatura, l.humedad);
  } else {
    longitud = snprintf(lote.payload, sizeof(lote.payload),
      "{\"version\":1,\"nodo_codigo\":\"%s\",\"mensaje_id\":\"%s\",\"origen\":\"real\","
      "\"tomada_en\":\"%s\",\"mediciones\":["
      "{\"variable_codigo\":\"iluminacion_relativa\",\"valor\":%u.%u,\"unidad\":\"%% relativo\"}]}",
      cfg.codigo, lote.id, fecha,
      static_cast<unsigned>(l.decimas / 10), static_cast<unsigned>(l.decimas % 10));
  }
  if (longitud <= 0 || static_cast<size_t>(longitud) >= sizeof(lote.payload)) {
    Serial.println("[JSON_ERROR] Lote incompleto; no se envia.");
    return CAPTURA_JSON;
  }
  lote.longitud = static_cast<size_t>(longitud);
  lote.capturadoMs = millis();
  lote.intentoDesdeMs = lote.capturadoMs;
  lote.esperaMs = 0;
  lote.intentos = 0;
  lote.activo = true;
  ultimaCapturaEpoch = instante;
  Serial.printf("[CAPTURA_REAL] %s\n", lote.payload);
  return CAPTURA_OK;
}

// ---------- Envio por HTTP ----------

Clase clasificar(int http) {
  if (http <= 0) return ENVIO_RED;
  if (http >= 200 && http < 300) return ENVIO_OK;
  if (http == 401 || http == 403) return ENVIO_CLAVE;
  if (http >= 500 || http == 408 || http == 429) return ENVIO_SERVIDOR;
  return ENVIO_RECHAZADO;
}

const char* nombreClase(Clase c) {
  switch (c) {
    case ENVIO_OK: return "ok";
    case ENVIO_RECHAZADO: return "rechazado";
    case ENVIO_CLAVE: return "clave_invalida";
    case ENVIO_SERVIDOR: return "servidor_no_disponible";
    default: return "error_red";
  }
}

// Copia solo letras, cifras, guion, guion bajo y punto: lo que llega del servidor
// no se repite tal cual en el registro ni en las respuestas.
void copiarSeguro(char* destino, size_t capacidad, const char* origen) {
  size_t n = 0;
  for (const char* p = origen ? origen : ""; *p && n + 1 < capacidad; ++p) {
    if (isalnum(static_cast<unsigned char>(*p)) || *p == '_' || *p == '-' || *p == '.') destino[n++] = *p;
  }
  destino[n] = 0;
}

int publicarLote(char* respuesta, size_t capacidad) {
  respuesta[0] = 0;
  WiFiClientSecure tls;
  WiFiClient plano;
  HTTPClient http;
  http.setReuse(false);
  http.setConnectTimeout(ESPERA_CONEXION_MS);
  http.setTimeout(ESPERA_RESPUESTA_MS);
  http.setUserAgent(String(FW_NOMBRE) + "/" + FW_VERSION);
  bool iniciado;
  if (urlSinCifrar(cfg.url)) {
    // Solo llega aqui una IPv4 privada: la clave del nodo viaja sin cifrar por la red local.
    Serial.println("[AVISO] envio sin cifrar en red local");
    iniciado = http.begin(plano, cfg.url);
  } else {
    if (TLS_SIN_VERIFICAR) tls.setInsecure();
    else tls.setCACertBundle(raices_inicio, static_cast<size_t>(raices_fin - raices_inicio));
    tls.setHandshakeTimeout(ESPERA_TLS_S);
    iniciado = http.begin(tls, cfg.url);
  }
  if (!iniciado) return 0;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-AgroVigia-Nodo", cfg.codigo);
  http.addHeader("X-AgroVigia-Clave", cfg.clave);
  const int codigo = http.POST(reinterpret_cast<uint8_t*>(lote.payload), lote.longitud);
  if (codigo > 0) {
    TextoAcotado cuerpo(respuesta, capacidad);
    http.writeToStream(&cuerpo);
  }
  http.end();
  return codigo;
}

// Un intento de entrega del lote activo. Conserva JSON, identificador y fecha.
Clase intentarEnviar() {
  ++lote.intentos;
  char* const respuesta = respuestaHttp;
  respuesta[0] = 0;
  int http = 0;
  if (WiFi.status() == WL_CONNECTED && millis() - lote.capturadoMs < CADUCIDAD_MS) {
    http = publicarLote(respuesta, sizeof(respuestaHttp));
  }
  const Clase clase = clasificar(http);
  ultimo.hay = true;
  ultimo.http = http > 0 ? http : 0;
  ultimo.estado = nombreClase(clase);
  ultimo.servidor[0] = 0;
  ultimo.codigo[0] = 0;
  ultimo.ms = millis();

  bool traePausado = false, valorPausado = false;
  long intervaloServidor = 0;
  if (http > 0 && respuesta[0]) {
    JsonDocument doc;
    if (!deserializeJson(doc, respuesta) && doc.is<JsonObject>()) {
      copiarSeguro(ultimo.servidor, sizeof(ultimo.servidor), doc["estado"] | "");
      copiarSeguro(ultimo.codigo, sizeof(ultimo.codigo), doc["codigo"] | "");
      if (doc["pausado"].is<bool>()) { traePausado = true; valorPausado = doc["pausado"].as<bool>(); }
      if (doc["intervalo_segundos"].is<long>()) intervaloServidor = doc["intervalo_segundos"].as<long>();
    }
  }
  if (http <= 0) snprintf(ultimo.codigo, sizeof(ultimo.codigo), "RED_%d", http);

  if (clase == ENVIO_OK) {
    claveRechazada = false;
    pausado = traePausado && valorPausado;
    if (intervaloValido(intervaloServidor) && intervaloServidor != cfg.intervalo) {
      cfg.intervalo = static_cast<uint16_t>(intervaloServidor);
      const bool guardado = almacenListo && prefs.putUShort("intervalo", cfg.intervalo) == sizeof(uint16_t);
      Serial.printf("[INTERVALO] El servidor indica %u s; guardado=%d.\n", static_cast<unsigned>(cfg.intervalo), guardado ? 1 : 0);
    }
    Serial.printf("[HTTP_OK] id=%s intento=%u http=%d estado=%s codigo=%s pausado=%d\n",
      lote.id, lote.intentos, http, ultimo.servidor, ultimo.codigo, pausado ? 1 : 0);
    lote.activo = false;
    return clase;
  }
  if (clase == ENVIO_CLAVE) {
    claveRechazada = true;
    Serial.printf("[CLAVE_RECHAZADA] http=%d; se detienen los envios hasta nueva configuracion u orden enviar.\n", http);
    lote.activo = false;
    return clase;
  }
  if (clase == ENVIO_RECHAZADO) {
    if (traePausado) pausado = valorPausado;
    else if (strcmp(ultimo.codigo, "NODO_PAUSADO") == 0) pausado = true;
    Serial.printf("[LOTE_RECHAZADO] id=%s http=%d codigo=%s; no se reintenta.\n", lote.id, http, ultimo.codigo);
    lote.activo = false;
    return clase;
  }
  if (lote.intentos >= 4 || millis() - lote.capturadoMs >= CADUCIDAD_MS) {
    Serial.printf("[LOTE_DESCARTADO] id=%s intentos=%u http=%d; sin confirmacion.\n", lote.id, lote.intentos, http);
    lote.activo = false;
    return clase;
  }
  lote.intentoDesdeMs = millis();
  lote.esperaMs = ESPERAS_MS[lote.intentos - 1];
  Serial.printf("[REINTENTO] id=%s http=%d en=%lu ms; se conservan JSON y fecha.\n",
    lote.id, http, static_cast<unsigned long>(lote.esperaMs));
  return clase;
}

// ---------- Conexion ----------

void reiniciarConexion() {
  lote.activo = false;
  ultimo = UltimoEnvio();
  pausado = false;
  claveRechazada = false;
  primeraCaptura = true;
  wifiEstabaConectado = false;
  if (WiFi.getMode() != WIFI_OFF) WiFi.disconnect(true, true);
  if (!configCompleta()) {
    Serial.println("[CONFIG_ESPERA] Falta configuracion; no se inicia la red. Esperando ordenes por el puerto serie.");
    return;
  }
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);
  if (cfg.wifiClave[0]) WiFi.begin(cfg.wifiSsid, cfg.wifiClave);
  else WiFi.begin(cfg.wifiSsid);
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  ultimoIntentoWifiMs = millis();
  Serial.printf("[WIFI_INICIO] nodo=%s intervalo=%u s; esperando Wi-Fi y reloj UTC.\n",
    cfg.codigo, static_cast<unsigned>(cfg.intervalo));
  if (urlSinCifrar(cfg.url)) Serial.println("[AVISO] envio sin cifrar en red local");
}

// ---------- Ordenes ----------

const char* estadoEnvio() {
  if (!configCompleta()) return "sin_configurar";
  if (claveRechazada) return "clave_invalida";
  return pausado ? "pausado" : "activo";
}

void ordenInfo() {
  const bool conectado = configCompleta() && WiFi.status() == WL_CONNECTED;
  JsonDocument doc;
  doc["ok"] = true;
  doc["fw"] = FW_NOMBRE;
  doc["version"] = FW_VERSION;
  doc["placa"] = FW_PLACA;
  doc["configurado"] = configCompleta();
  doc["codigo"] = cfg.codigo;
  doc["wifi_ssid"] = cfg.wifiSsid;
  doc["url"] = cfg.url;
  doc["tiene_clave"] = cfg.clave[0] != 0;
  doc["tiene_wifi_clave"] = cfg.wifiClave[0] != 0;
  doc["intervalo"] = cfg.intervalo;
  JsonArray sensores = doc["sensores"].to<JsonArray>();
  if (cfg.sensores & SENSOR_DHT22) sensores.add("dht22");
  if (cfg.sensores & SENSOR_LDR) sensores.add("ldr");
  doc["wifi"] = !cfg.wifiSsid[0] ? "sin_configurar" : (conectado ? "conectado" : "desconectado");
  doc["ip"] = conectado ? WiFi.localIP().toString() : String("");
  doc["reloj"] = relojVigente(time(nullptr));
  doc["envio"] = estadoEnvio();
  if (ultimo.hay) {
    JsonObject u = doc["ultimo_envio"].to<JsonObject>();
    u["estado"] = ultimo.estado;
    u["http"] = ultimo.http;
    u["servidor"] = ultimo.servidor;
    u["codigo"] = ultimo.codigo;
    u["hace_s"] = (millis() - ultimo.ms) / 1000UL;
  } else {
    doc["ultimo_envio"] = nullptr;
  }
  responder(doc);
}

void ordenConfig(JsonDocument& orden) {
  Configuracion nueva = cfg;
  JsonVariant v = orden["wifi_ssid"];
  if (!v.isNull()) {
    if (!v.is<const char*>() || !ssidValido(v.as<const char*>())) return responderError("WIFI_INVALIDO");
    strlcpy(nueva.wifiSsid, v.as<const char*>(), sizeof(nueva.wifiSsid));
  }
  v = orden["wifi_clave"];
  if (!v.isNull()) {
    if (!v.is<const char*>() || !claveWifiValida(v.as<const char*>())) return responderError("WIFI_INVALIDO");
    strlcpy(nueva.wifiClave, v.as<const char*>(), sizeof(nueva.wifiClave));
  }
  v = orden["url"];
  if (!v.isNull()) {
    if (!v.is<const char*>() || !urlValida(v.as<const char*>())) return responderError("URL_INVALIDA");
    strlcpy(nueva.url, v.as<const char*>(), sizeof(nueva.url));
  }
  v = orden["codigo"];
  if (!v.isNull()) {
    if (!v.is<const char*>() || !codigoValido(v.as<const char*>())) return responderError("CODIGO_INVALIDO");
    strlcpy(nueva.codigo, v.as<const char*>(), sizeof(nueva.codigo));
  }
  v = orden["clave"];
  if (!v.isNull()) {
    if (!v.is<const char*>() || !claveNodoValida(v.as<const char*>())) return responderError("CLAVE_INVALIDA");
    strlcpy(nueva.clave, v.as<const char*>(), sizeof(nueva.clave));
  }
  v = orden["intervalo"];
  if (!v.isNull()) {
    if (!v.is<long>() || !intervaloValido(v.as<long>())) return responderError("INTERVALO_INVALIDO");
    nueva.intervalo = static_cast<uint16_t>(v.as<long>());
  }
  v = orden["sensores"];
  if (!v.isNull()) {
    if (!v.is<JsonArray>()) return responderError("SENSORES_INVALIDOS");
    uint8_t mascara = 0;
    for (JsonVariant s : v.as<JsonArray>()) {
      const char* nombre = s | "";
      const uint8_t bit = strcmp(nombre, "dht22") == 0 ? SENSOR_DHT22 : (strcmp(nombre, "ldr") == 0 ? SENSOR_LDR : 0);
      if (!bit || (mascara & bit)) return responderError("SENSORES_INVALIDOS");
      mascara |= bit;
    }
    if (!mascara) return responderError("SENSORES_INVALIDOS");
    nueva.sensores = mascara;
  }
  if (!guardarConfig(nueva)) {
    cargarConfig();  // Vuelve a lo que realmente quedo guardado.
    responderError("NVS_ERROR");
    return reiniciarConexion();
  }
  cfg = nueva;
  JsonDocument doc;
  doc["ok"] = true;
  doc["guardado"] = true;
  doc["configurado"] = configCompleta();
  responder(doc);
  Serial.println("[CONFIG_GUARDADA] Se reinicia la conexion con la nueva configuracion.");
  reiniciarConexion();
}

void ordenLeer() {
  Lectura l;
  if (!leerSensores(l)) {
    JsonDocument doc;
    doc["ok"] = false;
    doc["error"] = "SENSOR_ERROR";
    doc["sensor"] = "dht22";
    return responder(doc);
  }
  char texto[160];
  int n = snprintf(texto, sizeof(texto), "AGV {\"ok\":true");
  if (cfg.sensores & SENSOR_DHT22) {
    n += snprintf(texto + n, sizeof(texto) - n, ",\"temperatura\":%.1f,\"humedad\":%.1f", l.temperatura, l.humedad);
  }
  if (cfg.sensores & SENSOR_LDR) {
    n += snprintf(texto + n, sizeof(texto) - n, ",\"adc\":%u,\"iluminacion\":%u.%u",
      static_cast<unsigned>(l.adc), static_cast<unsigned>(l.decimas / 10), static_cast<unsigned>(l.decimas % 10));
  }
  snprintf(texto + n, sizeof(texto) - n, "}");
  Serial.println(texto);
}

void ordenEnviar() {
  if (!configCompleta()) return responderError("SIN_CONFIGURAR");
  if (WiFi.status() != WL_CONNECTED) return responderError("SIN_WIFI");
  if (lote.activo && millis() - lote.capturadoMs >= CADUCIDAD_MS) lote.activo = false;
  if (!lote.activo) {
    const Captura captura = capturarLote();
    if (captura == CAPTURA_SENSOR) return responderError("SENSOR_ERROR");
    if (captura == CAPTURA_RELOJ) return responderError("SIN_RELOJ");
    if (captura != CAPTURA_OK) return responderError("JSON_ERROR");
    ultimoCicloMs = millis();
    primeraCaptura = false;
  }
  char id[37];
  strlcpy(id, lote.id, sizeof(id));
  const Clase clase = intentarEnviar();
  JsonDocument doc;
  doc["ok"] = clase == ENVIO_OK;
  if (clase == ENVIO_RECHAZADO) doc["error"] = "ENVIO_RECHAZADO";
  else if (clase == ENVIO_CLAVE) doc["error"] = "CLAVE_RECHAZADA";
  else if (clase == ENVIO_SERVIDOR) doc["error"] = "SERVIDOR_NO_DISPONIBLE";
  else if (clase == ENVIO_RED) doc["error"] = "ERROR_RED";
  doc["estado"] = ultimo.estado;
  doc["http"] = ultimo.http;
  doc["servidor"] = ultimo.servidor;
  doc["codigo"] = ultimo.codigo;
  doc["mensaje_id"] = id;
  doc["intervalo"] = cfg.intervalo;
  doc["pausado"] = pausado;
  responder(doc);
}

void ordenBorrar() {
  const bool bien = almacenListo && prefs.clear();
  cargarConfig();
  if (!bien) return responderError("NVS_ERROR");
  JsonDocument doc;
  doc["ok"] = true;
  doc["borrado"] = true;
  responder(doc);
  Serial.println("[CONFIG_BORRADA] Se borro toda la configuracion.");
  reiniciarConexion();
}

void procesarLinea(char* texto) {
  JsonDocument orden;
  if (deserializeJson(orden, texto) || !orden.is<JsonObject>()) return responderError("JSON_INVALIDO");
  const char* cmd = orden["cmd"] | "";
  if (strcmp(cmd, "info") == 0) return ordenInfo();
  if (strcmp(cmd, "config") == 0) return ordenConfig(orden);
  if (strcmp(cmd, "leer") == 0) return ordenLeer();
  if (strcmp(cmd, "enviar") == 0) return ordenEnviar();
  if (strcmp(cmd, "borrar") == 0) return ordenBorrar();
  responderError("ORDEN_DESCONOCIDA");
}

void atenderSerie() {
  while (Serial.available() > 0) {
    const int c = Serial.read();
    if (c == '\n') {
      if (lineaDesbordada) {
        responderError("LINEA_DEMASIADO_LARGA");
      } else {
        linea[lineaLargo] = 0;
        bool vacia = true;
        for (size_t i = 0; i < lineaLargo; ++i) if (!isspace(static_cast<unsigned char>(linea[i]))) { vacia = false; break; }
        if (!vacia) procesarLinea(linea);
      }
      lineaLargo = 0;
      lineaDesbordada = false;
    } else if (c == '\r') {
      // Se admite CRLF.
    } else if (lineaLargo < LINEA_MAX) {
      linea[lineaLargo++] = static_cast<char>(c);
    } else {
      lineaDesbordada = true;
    }
  }
}

// ---------- Arranque y ciclo ----------

void setup() {
  Serial.setRxBufferSize(2048);
  Serial.begin(115200);
  dht.begin();
  pinMode(LDR_PIN, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(LDR_PIN, ADC_11db);
  WiFi.persistent(false);
  sntp_set_time_sync_notification_cb(alSincronizar);
  almacenListo = prefs.begin("agv", false);
  if (!almacenListo) Serial.println("[NVS_ERROR] No se pudo abrir el almacen de configuracion.");
  cargarConfig();
  Serial.printf("[LISTO] fw=%s version=%s placa=%s dht_gpio=%u ldr_gpio=%u tls=%s configurado=%d\n",
    FW_NOMBRE, FW_VERSION, FW_PLACA, static_cast<unsigned>(DHT_PIN), static_cast<unsigned>(LDR_PIN),
    TLS_SIN_VERIFICAR ? "sin_verificar" : "raices_del_core", configCompleta() ? 1 : 0);
  reiniciarConexion();
}

void loop() {
  atenderSerie();
  if (!configCompleta()) { delay(5); return; }
  const uint32_t ahora = millis();
  const bool conectado = WiFi.status() == WL_CONNECTED;
  if (conectado != wifiEstabaConectado) {
    wifiEstabaConectado = conectado;
    if (conectado) Serial.printf("[WIFI_CONECTADO] ip=%s\n", WiFi.localIP().toString().c_str());
    else Serial.println("[WIFI_DESCONECTADO] Se perdio la conexion Wi-Fi.");
  }
  if (!conectado && ahora - ultimoIntentoWifiMs >= 10000) {
    ultimoIntentoWifiMs = ahora;
    WiFi.reconnect();
    Serial.println("[WIFI_ESPERA] Sin conexion Wi-Fi; no se capturan lotes nuevos.");
  }
  if (lote.activo) {
    if (millis() - lote.capturadoMs >= CADUCIDAD_MS) {
      Serial.printf("[LOTE_CADUCADO] id=%s; no se cambia su fecha.\n", lote.id);
      lote.activo = false;
    } else if (millis() - lote.intentoDesdeMs >= lote.esperaMs) {
      intentarEnviar();
    }
  } else if (conectado && !claveRechazada) {
    if (!relojValido(time(nullptr))) {
      if (millis() - ultimoAvisoRelojMs >= 10000) {
        ultimoAvisoRelojMs = millis();
        Serial.println("[RELOJ_ESPERA] Falta sincronizacion NTP valida; no se inventa fecha.");
      }
    } else {
      const uint32_t periodoMs = pausado ? CONSULTA_EN_PAUSA_MS : static_cast<uint32_t>(cfg.intervalo) * 1000UL;
      if (millis() >= 3000 && (primeraCaptura || millis() - ultimoCicloMs >= periodoMs)) {
        ultimoCicloMs = millis();
        primeraCaptura = false;
        if (capturarLote() == CAPTURA_OK) intentarEnviar();
      }
    }
  }
  delay(1);
}
