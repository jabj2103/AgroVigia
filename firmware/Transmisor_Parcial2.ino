//Elaborado por: Juan Bustos - Franyerson Molina - Andres Marrugo

/* Leemos los sensores, enviamos mediciones por ESP-NOW y controlamos el LED. */

// Incluimos las bibliotecas que usamos.
#include <WiFi.h>
#include <DHT.h>
#include <esp_wifi.h>
#include <esp_system.h>
#include <Arduino.h>
#include <cstring>
#include <math.h>
#include <esp_now.h>
#include <esp_arduino_version.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

#if ESP_ARDUINO_VERSION_MAJOR < 3
#error "Este programa requiere el paquete esp32 de Espressif 3.x."
#endif

// Configuramos nuestro montaje y la comunicación.

const uint8_t MAC_RECEPTOR[6] = {0x88, 0x57, 0x21, 0x96, 0x56, 0x18};
constexpr uint8_t CANAL_ESPNOW = 6; // Usamos el mismo canal que el receptor.
const char ID_DISPOSITIVO[] = "ESP32_G01";
static_assert(sizeof(ID_DISPOSITIVO) <= 16, "ID_DISPOSITIVO demasiado largo");
constexpr uint8_t DHT_PIN = 4;
constexpr uint8_t LDR_PIN = 34;
constexpr uint8_t LED_PIN = 23;
constexpr uint32_t INTERVALO_MS = 3000;
constexpr uint32_t ESPERA_ACK_MS = 1000;

// Definimos el mismo formato de mensajes en ambas placas.

constexpr uint32_t MARCA_IOT = 0x334F5449;
constexpr uint8_t VERSION_IOT = 1;
enum TipoMensaje : uint8_t { DATOS = 1, ACK_DATOS = 2, ORDEN_LED = 3, ACK_LED = 4 };

#pragma pack(push, 1)
struct Cabecera {
  uint32_t marca;
  uint8_t version;
  uint8_t tipo;
  uint16_t longitud;
};
struct DatosSensores {
  Cabecera cabecera;
  uint32_t ensayo;
  uint32_t secuencia;
  uint32_t totalPrevisto; // Usamos 0 para envío continuo o de 1 a 2000 para un ensayo.
  uint32_t tiempoMs;     // Registramos milisegundos desde el arranque del sensor.
  float temperatura;
  float humedad;
  uint16_t luminosidad;  // Guardamos la lectura ADC de 0 a 4095, sin convertirla a lux.
  uint8_t led;
  uint8_t dhtValido;
  char dispositivo[16];
};
struct AckDatos {
  Cabecera cabecera;
  uint32_t ensayo;
  uint32_t secuencia;
};
struct OrdenLed {
  Cabecera cabecera;
  uint32_t sesionPuente;
  uint32_t id;
  uint8_t led;
};
struct AckLed {
  Cabecera cabecera;
  uint32_t sesionPuente;
  uint32_t id;
  uint32_t tiempoMs;
  uint8_t led;
};
#pragma pack(pop)

static_assert(sizeof(DatosSensores) == 52, "Formato de datos inesperado");
static_assert(sizeof(AckDatos) == 16, "Formato ACK inesperado");
static_assert(sizeof(OrdenLed) == 17, "Formato de orden inesperado");
static_assert(sizeof(AckLed) == 21, "Formato de confirmacion inesperado");
static_assert(sizeof(DatosSensores) <= 250, "Mensaje demasiado grande");

// Guardamos los mensajes recibidos en una cola para procesarlos en loop().
struct EventoRx {
  uint8_t mac[6];
  int8_t rssi;
  uint32_t recibidoMs;
  uint16_t longitud;
  uint8_t datos[sizeof(DatosSensores)];
};

// Identificamos duplicados y mensajes fuera de orden.

struct ConteoRecepcion {
  uint32_t ensayo = 0;
  uint32_t previstos = 0;
  uint32_t mayorSecuencia = 0;
  uint32_t unicos = 0;
  uint32_t duplicados = 0;
  uint32_t vistos[2048] = {};
  bool iniciado = false;

  void iniciar(uint32_t nuevoEnsayo, uint32_t total) {
    ensayo = nuevoEnsayo;
    previstos = total;
    mayorSecuencia = unicos = duplicados = 0;
    memset(vistos, 0, sizeof(vistos));
    iniciado = true;
  }
  bool registrar(uint32_t secuencia) {
    if (!secuencia) return false;
    if (mayorSecuencia > secuencia && mayorSecuencia - secuencia >= 2048) return false;
    const uint32_t indice = secuencia % 2048;
    if (vistos[indice] == secuencia) {
      duplicados++;
      return false;
    }
    vistos[indice] = secuencia;
    unicos++;
    if (secuencia > mayorSecuencia) mayorSecuencia = secuencia;
    return true;
  }
  uint32_t huecosHastaAhora() const {
    return mayorSecuencia >= unicos ? mayorSecuencia - unicos : 0;
  }
};

// Declaramos las funciones que usamos más adelante.
inline Cabecera crearCabecera(TipoMensaje tipo, uint16_t longitud);
inline bool cabeceraValida(const uint8_t* datos, int longitud);
inline bool macVacia(const uint8_t* mac);
inline void imprimirMac(const uint8_t* mac);
inline bool registrarPar(const uint8_t* mac);
void detenerConError(const char* mensaje);
void alRecibir(const esp_now_recv_info_t* info, const uint8_t* datos, int longitud);
void imprimirEstadisticas();
void iniciarEnsayo(uint32_t cantidad);
void cambiarLed(bool encendido);
void procesarRecepcion();
void enviarLectura();
void ejecutarComandoSerial();
void atenderSerial();
void setup();
void loop();

// Conservamos el estado del programa y los contadores.

DHT dht(DHT_PIN, DHT22);
QueueHandle_t colaRx = nullptr;
portMUX_TYPE bloqueoRx = portMUX_INITIALIZER_UNLOCKED;
uint32_t descartadosCola = 0;
bool estadoLed = false;
bool transmitiendo = true;
bool cierrePendiente = false;
uint32_t ultimoEnvio = 0;
uint32_t cierreDesde = 0;
uint32_t ensayoActual = 0;
uint32_t secuencia = 0;
uint32_t totalPrevisto = 0;
uint32_t enviosAceptados = 0;
uint32_t erroresEnvio = 0;
uint32_t erroresDht = 0;
ConteoRecepcion confirmaciones;
uint32_t secuenciaEsperandoAck = 0;
uint32_t inicioAckMs = 0;
bool esperandoAck = false;
uint32_t muestrasRtt = 0;
uint32_t rttMin = UINT32_MAX;
uint32_t rttMax = 0;
uint64_t sumaRtt = 0;
char lineaSerial[48] = {};
uint8_t longitudSerial = 0;

// Validamos los mensajes y registramos la otra placa.
inline Cabecera crearCabecera(TipoMensaje tipo, uint16_t longitud) {
  return {MARCA_IOT, VERSION_IOT, static_cast<uint8_t>(tipo), longitud};
}
inline bool cabeceraValida(const uint8_t* datos, int longitud) {
  if (!datos || longitud < static_cast<int>(sizeof(Cabecera)) ||
      longitud > static_cast<int>(sizeof(DatosSensores))) return false;
  Cabecera c;
  memcpy(&c, datos, sizeof(c));
  return c.marca == MARCA_IOT && c.version == VERSION_IOT && c.longitud == longitud;
}
inline bool macVacia(const uint8_t* mac) {
  const uint8_t cero[6] = {};
  return memcmp(mac, cero, 6) == 0;
}
inline void imprimirMac(const uint8_t* mac) {
  Serial.printf("%02X:%02X:%02X:%02X:%02X:%02X", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
}
inline bool registrarPar(const uint8_t* mac) {
  if (esp_now_is_peer_exist(mac)) return true;
  esp_now_peer_info_t par = {};
  memcpy(par.peer_addr, mac, 6);
  par.channel = 0; // Usamos el canal actual de la interfaz.
  par.ifidx = WIFI_IF_STA;
  par.encrypt = false;
  return esp_now_add_peer(&par) == ESP_OK;
}

// Detenemos el programa si falla la preparación de un recurso.

void detenerConError(const char* mensaje) {
  Serial.println(mensaje);
  while (true) delay(1000);
}

// Recibimos el mensaje en el callback de ESP-NOW y lo copiamos a la cola.

void alRecibir(const esp_now_recv_info_t* info, const uint8_t* datos, int longitud) {
  if (!info || memcmp(info->src_addr, MAC_RECEPTOR, 6) != 0 || !cabeceraValida(datos, longitud)) return;
  EventoRx evento = {};
  memcpy(evento.mac, info->src_addr, 6);
  evento.rssi = info->rx_ctrl ? info->rx_ctrl->rssi : 0;
  evento.recibidoMs = millis();
  evento.longitud = longitud;
  memcpy(evento.datos, datos, longitud);
  if (xQueueSend(colaRx, &evento, 0) != pdTRUE) {
    portENTER_CRITICAL(&bloqueoRx);
    descartadosCola++;
    portEXIT_CRITICAL(&bloqueoRx);
  }
}

// Mostramos las estadísticas del ensayo.
// Comparamos TX y RX para calcular pérdidas de datos; contamos los ACK por separado.

void imprimirEstadisticas() {
  Serial.printf("[TX STATS] ensayo=%lu intentados=%lu aceptados_api=%lu errores_api=%lu ack_unicos=%lu dht_error=%lu\n",
    static_cast<unsigned long>(ensayoActual), static_cast<unsigned long>(secuencia),
    static_cast<unsigned long>(enviosAceptados), static_cast<unsigned long>(erroresEnvio),
    static_cast<unsigned long>(confirmaciones.unicos), static_cast<unsigned long>(erroresDht));
  if (muestrasRtt) {
    Serial.printf("[RTT ESP-NOW] muestras=%lu min=%lu max=%lu promedio=%.2f ms\n",
      static_cast<unsigned long>(muestrasRtt), static_cast<unsigned long>(rttMin),
      static_cast<unsigned long>(rttMax), static_cast<double>(sumaRtt) / muestrasRtt);
  }
  Serial.println("La falta de ACK no demuestra por si sola perdida del mensaje de datos; comparar con RX STATS.");
}

// Iniciamos un ensayo y reiniciamos sus contadores.
// Usamos START para envío continuo y START N para intentar N envíos.

void iniciarEnsayo(uint32_t cantidad) {
  ensayoActual = esp_random();
  secuencia = enviosAceptados = erroresEnvio = erroresDht = 0;
  totalPrevisto = cantidad;
  confirmaciones.iniciar(ensayoActual, cantidad);
  esperandoAck = cierrePendiente = false;
  muestrasRtt = rttMax = 0;
  rttMin = UINT32_MAX;
  sumaRtt = 0;
  ultimoEnvio = millis();
  transmitiendo = true;
  Serial.printf("[ENSAYO] id=%lu total=%lu intervalo_ms=%lu bytes_datos=%u\n",
    static_cast<unsigned long>(ensayoActual), static_cast<unsigned long>(cantidad),
    static_cast<unsigned long>(INTERVALO_MS), static_cast<unsigned>(sizeof(DatosSensores)));
}

// Aplicamos el estado del LED y lo guardamos.

void cambiarLed(bool encendido) {
  estadoLed = encendido;
  digitalWrite(LED_PIN, encendido ? HIGH : LOW);
  Serial.printf("[LED] salida=%s\n", encendido ? "ON" : "OFF");
}

// Procesamos en loop() los mensajes de la cola según su tipo.

void procesarRecepcion() {
  EventoRx evento;
  while (xQueueReceive(colaRx, &evento, 0) == pdTRUE) {
    Cabecera c;
    memcpy(&c, evento.datos, sizeof(c));
    if (c.tipo == ACK_DATOS && evento.longitud == sizeof(AckDatos)) {
      AckDatos ack;
      memcpy(&ack, evento.datos, sizeof(ack));
      if (ack.ensayo != ensayoActual || ack.secuencia > secuencia) continue;
      if (!confirmaciones.registrar(ack.secuencia)) continue;
      if (ack.secuencia == secuenciaEsperandoAck) {
        const uint32_t rtt = evento.recibidoMs - inicioAckMs;
        esperandoAck = false;
        muestrasRtt++;
        sumaRtt += rtt;
        if (rtt < rttMin) rttMin = rtt;
        if (rtt > rttMax) rttMax = rtt;
        Serial.printf("[ACK DATOS] seq=%lu rtt_ms=%lu rssi_retorno=%d dBm\n",
          static_cast<unsigned long>(ack.secuencia), static_cast<unsigned long>(rtt), evento.rssi);
      }
    } else if (c.tipo == ORDEN_LED && evento.longitud == sizeof(OrdenLed)) {
      OrdenLed orden;
      memcpy(&orden, evento.datos, sizeof(orden));
      if (orden.led > 1) continue;
      // Mantenemos el mismo estado si recibimos de nuevo la orden ON u OFF.
      cambiarLed(orden.led == 1);
      AckLed ack = {};
      ack.cabecera = crearCabecera(ACK_LED, sizeof(ack));
      ack.sesionPuente = orden.sesionPuente;
      ack.id = orden.id;
      ack.tiempoMs = millis();
      ack.led = estadoLed;
      const esp_err_t resultado = esp_now_send(MAC_RECEPTOR, reinterpret_cast<uint8_t*>(&ack), sizeof(ack));
      Serial.printf("[ORDEN] id=%lu ack_api=%d\n", static_cast<unsigned long>(orden.id), resultado);
    }
  }
}

// Leemos el DHT22, promediamos 32 lecturas de la LDR y armamos el mensaje de 52 bytes.

void enviarLectura() {
  DatosSensores mensaje = {};
  mensaje.cabecera = crearCabecera(DATOS, sizeof(mensaje));
  mensaje.ensayo = ensayoActual;
  mensaje.secuencia = ++secuencia;
  mensaje.totalPrevisto = totalPrevisto;
  mensaje.tiempoMs = millis();
  mensaje.temperatura = dht.readTemperature();
  mensaje.humedad = dht.readHumidity();
  mensaje.dhtValido = !isnan(mensaje.temperatura) && !isnan(mensaje.humedad);
  if (!mensaje.dhtValido) erroresDht++;
  uint32_t suma = 0;
  for (uint8_t i = 0; i < 32; i++) {
    suma += analogRead(LDR_PIN);
    delay(1);
  }
  mensaje.luminosidad = suma / 32;
  mensaje.led = estadoLed;
  snprintf(mensaje.dispositivo, sizeof(mensaje.dispositivo), "%s", ID_DISPOSITIVO);
  inicioAckMs = millis();
  secuenciaEsperandoAck = mensaje.secuencia;
  esperandoAck = true;
  const esp_err_t resultado = esp_now_send(MAC_RECEPTOR, reinterpret_cast<uint8_t*>(&mensaje), sizeof(mensaje));
  if (resultado == ESP_OK) enviosAceptados++;
  else { erroresEnvio++; esperandoAck = false; }
  Serial.printf("[TX] ensayo=%lu seq=%lu T=%.1f H=%.1f L=%u LED=%u dht_valido=%u envio_api=%d\n",
    static_cast<unsigned long>(mensaje.ensayo), static_cast<unsigned long>(mensaje.secuencia),
    mensaje.temperatura, mensaje.humedad, mensaje.luminosidad, mensaje.led, mensaje.dhtValido, resultado);
  // Enviamos cada medición una sola vez para medir las pérdidas.
  if (totalPrevisto && secuencia >= totalPrevisto) {
    transmitiendo = false;
    cierrePendiente = true;
    cierreDesde = millis();
  }
}

// Interpretamos los comandos del monitor serial al recibir una nueva línea.

void ejecutarComandoSerial() {
  lineaSerial[longitudSerial] = '\0';
  String comando(lineaSerial);
  comando.trim();
  comando.toUpperCase();
  if (comando == "ON" || comando == "1") cambiarLed(true);
  else if (comando == "OFF" || comando == "0") cambiarLed(false);
  else if (comando == "STATS") imprimirEstadisticas();
  else if (comando == "STOP") {
    transmitiendo = cierrePendiente = false;
    imprimirEstadisticas();
  } else if (comando == "START") iniciarEnsayo(0);
  else if (comando.startsWith("START ")) {
    const String numero = comando.substring(6);
    char* fin = nullptr;
    const unsigned long cantidad = strtoul(numero.c_str(), &fin, 10);
    if (fin != numero.c_str() && *fin == '\0' && cantidad >= 1 && cantidad <= 2000) iniciarEnsayo(cantidad);
    else Serial.println("Usa START 100 o START 500. Cantidad permitida: 1..2000.");
  } else if (comando.length()) {
    Serial.println("Comandos: START, START 100, START 500, STOP, STATS, ON, OFF.");
  }
  longitudSerial = 0;
}

// Acumulamos los caracteres hasta completar el comando.

void atenderSerial() {
  while (Serial.available()) {
    const char c = Serial.read();
    if (c == '\n' || c == '\r') { if (longitudSerial) ejecutarComandoSerial(); }
    else if (longitudSerial < sizeof(lineaSerial) - 1) lineaSerial[longitudSerial++] = c;
    else { longitudSerial = 0; Serial.println("Comando demasiado largo."); }
  }
}

// Preparamos las bibliotecas, la radio y la cola al iniciar.

void setup() {
  Serial.begin(115200);
  delay(500);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);
  pinMode(LDR_PIN, INPUT);
  analogReadResolution(12);
  dht.begin();
  WiFi.mode(WIFI_STA);
  WiFi.disconnect(false, false);
  WiFi.setSleep(false);
  uint8_t macPropia[6];
  if (esp_wifi_get_mac(WIFI_IF_STA, macPropia) != ESP_OK) detenerConError("No se pudo leer la MAC STA.");
  Serial.print("TRANSMISOR - MAC STA: ");
  imprimirMac(macPropia);
  Serial.println();
  if (macVacia(MAC_RECEPTOR)) detenerConError("Configura MAC_RECEPTOR con la MAC STA que imprime el receptor y vuelve a cargar.");
  if (esp_wifi_set_channel(CANAL_ESPNOW, WIFI_SECOND_CHAN_NONE) != ESP_OK) detenerConError("Canal invalido.");
  colaRx = xQueueCreate(16, sizeof(EventoRx));
  if (!colaRx) detenerConError("No se pudo crear la cola RX.");
  if (esp_now_init() != ESP_OK) detenerConError("No se pudo iniciar ESP-NOW.");
  if (esp_now_register_recv_cb(alRecibir) != ESP_OK || !registrarPar(MAC_RECEPTOR)) detenerConError("No se pudo registrar receptor/callback.");
  Serial.printf("Canal=%u | periodo=%lu ms | potencia_configurada_default | comandos con Nueva linea\n", CANAL_ESPNOW, static_cast<unsigned long>(INTERVALO_MS));
  int8_t potencia;
  if (esp_wifi_get_max_tx_power(&potencia) == ESP_OK) Serial.printf("Limite de potencia TX: %.2f dBm\n", potencia / 4.0);
  Serial.println("START=continuo | START 500=500 mensajes | STOP | STATS | ON | OFF");
  iniciarEnsayo(0);
}

// Atendemos continuamente los mensajes, los comandos y los tiempos.

void loop() {
  atenderSerial();
  procesarRecepcion();
  const uint32_t ahora = millis();
  if (esperandoAck && ahora - inicioAckMs >= ESPERA_ACK_MS) {
    esperandoAck = false;
    Serial.printf("[ACK TIMEOUT] seq=%lu; consultar conteo del receptor.\n", static_cast<unsigned long>(secuenciaEsperandoAck));
  }
  if (transmitiendo && ahora - ultimoEnvio >= INTERVALO_MS) {
    ultimoEnvio = ahora;
    enviarLectura();
  }
  if (cierrePendiente && millis() - cierreDesde >= ESPERA_ACK_MS + 200) {
    cierrePendiente = false;
    Serial.println("[ENSAYO TERMINADO]");
    imprimirEstadisticas();
  }
  delay(1);
}
