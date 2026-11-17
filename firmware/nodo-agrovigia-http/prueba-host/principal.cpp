// Ejecuta setup() y loop() del sketch en el computador, con el hardware falso.
// Entrada estandar: una linea por paso. Una linea normal entra por el puerto serie falso.
// Una linea que empieza por '#' es una instruccion del guion:
//   #red 0|1          el Wi-Fi falso conecta o no
//   #reloj            llega la sincronizacion NTP
//   #avanzar MS       ejecuta loop() hasta que pasen MS milisegundos falsos
//   #dht T H          lecturas del DHT22 falso ("#dht nan" simula el fallo)
//   #adc N            promedio del ADC falso
//   #http CODIGO CUERPO   siguiente respuesta del servidor falso
// Tras cada paso imprime "#fin".
#include "arduino-falso.h"

#include "nodo-agrovigia-http.ino"

extern const uint8_t raices_falsas_inicio[] asm("_binary_x509_crt_bundle_start") = {1, 2, 3, 4};
extern const uint8_t raices_falsas_fin[] asm("_binary_x509_crt_bundle_end") = {0};

int main() {
  setvbuf(stdout, nullptr, _IOLBF, 0);
  setup();
  puts("#fin");
  std::string paso;
  char renglon[4096];
  while (fgets(renglon, sizeof(renglon), stdin)) {
    paso = renglon;
    if (!paso.empty() && paso.back() == '\n') paso.pop_back();
    if (paso.rfind("#red ", 0) == 0) {
      falso_red = paso[5] == '1';
    } else if (paso == "#reloj") {
      if (falso_sntp) falso_sntp(nullptr);
    } else if (paso.rfind("#avanzar ", 0) == 0) {
      const uint32_t meta = falso_ms + static_cast<uint32_t>(strtoul(paso.c_str() + 9, nullptr, 10));
      while (static_cast<int32_t>(meta - falso_ms) > 0) loop();
    } else if (paso == "#dht nan") {
      falso_temperatura = NAN;
      falso_humedad = NAN;
    } else if (paso.rfind("#dht ", 0) == 0) {
      sscanf(paso.c_str() + 5, "%f %f", &falso_temperatura, &falso_humedad);
    } else if (paso.rfind("#adc ", 0) == 0) {
      falso_adc = static_cast<uint16_t>(atoi(paso.c_str() + 5));
    } else if (paso.rfind("#http ", 0) == 0) {
      char* resto = nullptr;
      const int codigo = static_cast<int>(strtol(paso.c_str() + 6, &resto, 10));
      falso_respuestas.emplace_back(codigo, std::string(*resto == ' ' ? resto + 1 : resto));
    } else {
      for (const char c : paso) Serial.entrada.push_back(c);
      Serial.entrada.push_back('\n');
      loop();
    }
    puts("#fin");
  }
  return 0;
}
