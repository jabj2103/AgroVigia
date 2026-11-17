// Hardware falso para ejecutar la logica de nodo-agrovigia-http.ino en el computador.
// Sustituye Arduino, Wi-Fi, HTTPS, NVS, DHT22 y ADC por objetos que el guion de prueba
// controla. No demuestra nada sobre la placa, la radio, TLS ni los sensores reales.
#pragma once
#include <cctype>
#include <cmath>
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <deque>
#include <fstream>
#include <map>
#include <random>
#include <string>
#include <utility>

#define CONFIG_IDF_TARGET_ESP32 1
#define SET_LOOP_TASK_STACK_SIZE(sz) size_t getArduinoLoopTaskStackSize() { return sz; }
#define INPUT 1
#define ADC_11db 3
#define DHT22 22
#define WL_CONNECTED 3
#define WIFI_OFF 0
#define WIFI_STA 1

// ---------- Estado que maneja el guion ----------
inline uint32_t falso_ms = 0;
inline bool falso_red = false;
inline float falso_temperatura = 29.4f;
inline float falso_humedad = 67.0f;
inline uint16_t falso_adc = 1234;
inline void (*falso_sntp)(struct timeval*) = nullptr;
inline std::deque<std::pair<int, std::string>> falso_respuestas;

inline uint32_t millis() { return falso_ms; }
inline void delay(uint32_t ms) { falso_ms += ms; }
inline void pinMode(uint8_t, uint8_t) {}
inline void analogReadResolution(uint8_t) {}
inline void analogSetPinAttenuation(uint8_t, int) {}
inline uint16_t analogRead(uint8_t) { return falso_adc; }
inline void configTime(long, int, const char*, const char*) {}
inline void sntp_set_time_sync_notification_cb(void (*cb)(struct timeval*)) { falso_sntp = cb; }
inline void esp_fill_random(void* destino, size_t cantidad) {
  static std::random_device azar;
  for (size_t i = 0; i < cantidad; ++i) static_cast<uint8_t*>(destino)[i] = static_cast<uint8_t>(azar());
}

// ---------- Clases minimas de Arduino ----------
class String {
 public:
  String() = default;
  String(const char* s) : v_(s ? s : "") {}
  String(const std::string& s) : v_(s) {}
  const char* c_str() const { return v_.c_str(); }
  size_t length() const { return v_.size(); }
  bool concat(const char* s) { v_ += s; return true; }
  bool concat(const char* s, size_t n) { v_.append(s, n); return true; }
  bool reserve(size_t n) { v_.reserve(n); return true; }
  String& operator=(const char* s) { v_ = s ? s : ""; return *this; }
  String& operator+=(const char* s) { v_ += s; return *this; }
  String& operator+=(char c) { v_ += c; return *this; }
  String operator+(const char* s) const { return String(v_ + s); }
 private:
  std::string v_;
};

class Print {
 public:
  virtual ~Print() = default;
  virtual size_t write(uint8_t c) = 0;
  virtual size_t write(const uint8_t* datos, size_t n) { for (size_t i = 0; i < n; ++i) write(datos[i]); return n; }
  virtual void flush() {}
  size_t print(const char* s) { return write(reinterpret_cast<const uint8_t*>(s), strlen(s)); }
  size_t print(char c) { return write(static_cast<uint8_t>(c)); }
  size_t println(const char* s) { return print(s) + print('\n'); }
  size_t printf(const char* formato, ...) __attribute__((format(printf, 2, 3))) {
    char texto[1024];
    va_list args;
    va_start(args, formato);
    const int n = vsnprintf(texto, sizeof(texto), formato, args);
    va_end(args);
    return n > 0 ? print(texto) : 0;
  }
};

class Stream : public Print {
 public:
  virtual int available() = 0;
  virtual int read() = 0;
  virtual int peek() = 0;
};

class SerieFalsa : public Stream {
 public:
  using Print::write;
  size_t write(uint8_t c) override { fputc(c, stdout); return 1; }
  int available() override { return static_cast<int>(entrada.size()); }
  int read() override { if (entrada.empty()) return -1; const int c = static_cast<uint8_t>(entrada.front()); entrada.pop_front(); return c; }
  int peek() override { return entrada.empty() ? -1 : static_cast<uint8_t>(entrada.front()); }
  void begin(unsigned long) {}
  void setRxBufferSize(size_t) {}
  std::deque<char> entrada;
};
inline SerieFalsa Serial;

// ---------- Wi-Fi ----------
struct IPAddress { String toString() const { return String("192.0.2.10"); } };
struct WiFiFalso {
  int modo = WIFI_OFF;
  bool iniciada = false;
  int inicios = 0;
  void persistent(bool) {}
  int getMode() { return modo; }
  bool mode(int m) { modo = m; return true; }
  bool disconnect(bool apagar = false, bool = false) { iniciada = false; if (apagar) modo = WIFI_OFF; return true; }
  void setAutoReconnect(bool) {}
  void setSleep(bool) {}
  void begin(const char*, const char* = nullptr) { iniciada = true; ++inicios; }
  bool reconnect() { return true; }
  int status() { return (modo == WIFI_STA && iniciada && falso_red) ? WL_CONNECTED : 6; }
  IPAddress localIP() { return IPAddress(); }
};
inline WiFiFalso WiFi;

// ---------- HTTPS ----------
struct WiFiClient {};
struct WiFiClientSecure {
  const char* tls = "sin_definir";
  void setInsecure() { tls = "sin_verificar"; }
  void setCACertBundle(const uint8_t* inicio, size_t n) { tls = (inicio && n > 0) ? "raices" : "sin_definir"; }
  void setHandshakeTimeout(unsigned long) {}
};

// Cada POST imprime una linea "#POST ..." y devuelve la siguiente respuesta del guion
// (sin guion: -1, como una conexion fallida).
class HTTPClient {
 public:
  void setReuse(bool) {}
  void setConnectTimeout(int32_t) {}
  void setTimeout(uint16_t) {}
  void setUserAgent(const String&) {}
  bool begin(WiFiClientSecure& cliente, String url) { tls_ = cliente.tls; url_ = url.c_str(); return true; }
  bool begin(WiFiClient&, String url) { tls_ = "sin_cifrar"; url_ = url.c_str(); return true; }
  void addHeader(const String& nombre, const String& valor) { cabeceras_ += std::string(" ") + nombre.c_str() + "=" + valor.c_str(); }
  int POST(uint8_t* cuerpo, size_t n) {
    printf("#POST tls=%s url=%s%s cuerpo=%.*s\n", tls_.c_str(), url_.c_str(), cabeceras_.c_str(), static_cast<int>(n), reinterpret_cast<const char*>(cuerpo));
    if (falso_respuestas.empty()) { cuerpo_.clear(); return -1; }
    const int codigo = falso_respuestas.front().first;
    cuerpo_ = falso_respuestas.front().second;
    falso_respuestas.pop_front();
    return codigo;
  }
  int writeToStream(Stream* destino) { return static_cast<int>(destino->write(reinterpret_cast<const uint8_t*>(cuerpo_.data()), cuerpo_.size())); }
  void end() {}
 private:
  std::string tls_, url_, cabeceras_, cuerpo_;
};

// ---------- NVS ----------
// Con la variable de entorno AGV_NVS guarda en ese archivo, para probar un reinicio.
class Preferences {
 public:
  bool begin(const char*, bool) { cargar(); return true; }
  bool isKey(const char* k) { return datos_.count(k) > 0; }
  size_t getString(const char* k, char* destino, size_t capacidad) {
    const auto it = datos_.find(k);
    if (it == datos_.end() || it->second.size() + 1 > capacidad) return 0;
    memcpy(destino, it->second.c_str(), it->second.size() + 1);
    return it->second.size() + 1;
  }
  size_t putString(const char* k, const char* v) { datos_[k] = v; guardar(); return strlen(v); }
  uint16_t getUShort(const char* k, uint16_t defecto) { return isKey(k) ? static_cast<uint16_t>(atoi(datos_[k].c_str())) : defecto; }
  size_t putUShort(const char* k, uint16_t v) { datos_[k] = std::to_string(v); guardar(); return 2; }
  uint8_t getUChar(const char* k, uint8_t defecto) { return isKey(k) ? static_cast<uint8_t>(atoi(datos_[k].c_str())) : defecto; }
  size_t putUChar(const char* k, uint8_t v) { datos_[k] = std::to_string(v); guardar(); return 1; }
  bool remove(const char* k) { const bool habia = datos_.erase(k) > 0; guardar(); return habia; }
  bool clear() { datos_.clear(); guardar(); return true; }
 private:
  std::map<std::string, std::string> datos_;
  void cargar() {
    const char* ruta = getenv("AGV_NVS");
    if (!ruta) return;
    std::ifstream f(ruta);
    std::string k, hex;
    while (f >> k >> hex) {
      std::string v;
      for (size_t i = 1; i + 1 < hex.size(); i += 2) v += static_cast<char>(std::stoi(hex.substr(i, 2), nullptr, 16));
      datos_[k] = v;
    }
  }
  void guardar() {
    const char* ruta = getenv("AGV_NVS");
    if (!ruta) return;
    std::ofstream f(ruta, std::ios::trunc);
    for (const auto& par : datos_) {
      f << par.first << " x";
      char hex[3];
      for (const unsigned char c : par.second) { snprintf(hex, sizeof(hex), "%02x", c); f << hex; }
      f << "\n";
    }
  }
};

// ---------- DHT22 ----------
struct DHT {
  DHT(uint8_t, int) {}
  void begin() {}
  float readTemperature() { return falso_temperatura; }
  float readHumidity() { return falso_humedad; }
};
