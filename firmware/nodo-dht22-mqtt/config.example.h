#pragma once

// PrepararFirmware genera config_local.h sin subir secretos a Git.
// Completar alli los datos de la red Wi-Fi; no editar este ejemplo con claves.
constexpr char WIFI_SSID[] = "CAMBIAR_SSID";
constexpr char WIFI_PASSWORD[] = "CAMBIAR_CLAVE_WIFI";
constexpr char MQTT_HOST[] = "IP_DEL_COMPUTADOR";
constexpr uint16_t MQTT_PORT = 18883;
constexpr char MQTT_USERNAME[] = "nodo_dht22";
constexpr char MQTT_PASSWORD[] = "CLAVE_LOCAL_DEL_NODO";
