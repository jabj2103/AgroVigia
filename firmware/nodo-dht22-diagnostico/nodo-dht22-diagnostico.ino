// AgroVigia: primera comprobacion local del DHT22 por USB.
// Referencia de lectura: ../Transmisor_Parcial2.ino (autoria conservada alli).
// No publica telemetria MQTT ni representa la etapa 2 completa.

#include <Arduino.h>
#include <DHT.h>
#include <math.h>

// GPIO recuperado del proyecto anterior; verificar el montaje antes de cargar.
constexpr uint8_t DHT_PIN = 4;
constexpr uint32_t INTERVALO_LECTURA_MS = 3000;

DHT dht(DHT_PIN, DHT22);
uint32_t ultimaLecturaMs = 0;

void setup() {
  Serial.begin(115200);
  dht.begin();
  ultimaLecturaMs = millis();
  Serial.print("AgroVigia | Diagnostico DHT22 | GPIO ");
  Serial.print(DHT_PIN);
  Serial.println(" | 115200 baudios");
  Serial.println("Solo lectura local por USB; no envia datos a la red.");
}

void loop() {
  const uint32_t ahoraMs = millis();
  // La resta sin signo mantiene el intervalo al desbordarse millis().
  if (ahoraMs - ultimaLecturaMs < INTERVALO_LECTURA_MS) {
    delay(1);
    return;
  }
  ultimaLecturaMs = ahoraMs;

  const float temperatura = dht.readTemperature();
  const float humedad = dht.readHumidity();

  if (!isfinite(temperatura) || !isfinite(humedad)) {
    Serial.println("[ERROR_LECTURA] No se obtuvo un par valido de temperatura y humedad.");
    return;
  }
  if (temperatura < -40.0f || temperatura > 80.0f || humedad < 0.0f || humedad > 100.0f) {
    Serial.println("[ERROR_RANGO] Se descarta el par: fuera de los limites del contrato v1.");
    return;
  }

  Serial.print("[LECTURA_LOCAL] temperatura_aire=");
  Serial.print(temperatura, 1);
  Serial.print(" C | humedad_aire=");
  Serial.print(humedad, 1);
  Serial.println(" % HR");
}
