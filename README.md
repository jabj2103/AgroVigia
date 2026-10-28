# AgroVigía

Prototipo académico de monitoreo ambiental de cultivos, desarrollado por Juan Andrés Bustos Jiménez y Camilo Jose Carrion Ramirez.

## Estado actual

El primer ESP32 con DHT22 y LDR publica mediciones reales de temperatura, humedad relativa del aire e iluminación relativa. Mosquitto entrega los mensajes a n8n, que valida y solicita su almacenamiento y evaluación de alertas en Supabase. Juan ha comprobado el recorrido hasta la web y una alerta visible en Episodios.

La web incluye inicio y cierre de sesión, monitoreo, gestión de cultivos y dispositivos, históricos con gráficas y estadísticas, reglas y episodios de alertas. También están implementados un contador de alertas activas sin revisar y avisos internos con la web abierta; su comprobación real se registra por separado de las pruebas locales.

Las comprobaciones locales más recientes registran 30 pruebas de web, 75 de n8n y 10 de SQL, además de compilación y pruebas de navegador con datos ficticios. Estas pruebas no sustituyen la validación física ni las pruebas de sesión/API en los servicios. El detalle de evidencia y pendientes está en [docs/estado.md](docs/estado.md).

El segundo nodo equivalente sigue pendiente del DHT22. La iluminación es un índice relativo del ADC, no lux ni una calibración entre sensores. Gemini y la predicción numérica de temperatura todavía no están implementados.

## Arquitectura

Sensores → ESP32 → red con Wi-Fi → MQTT / Mosquitto → n8n → Supabase.

React consulta directamente la información autorizada de Supabase y utiliza Supabase Auth para la sesión. Las operaciones del agricultor se ejecutan mediante funciones autorizadas de base de datos. n8n valida la telemetría, solicita el guardado y llama a la evaluación de reglas deterministas en PostgreSQL. La futura integración con Gemini generará sugerencias contextualizadas; la IA no genera las alertas actuales.

- Nodo 1: ESP32 con DHT22 y LDR para temperatura, humedad relativa del aire e iluminación relativa.
- Nodo 2 previsto: ESP32 con los mismos sensores y variables en otra ubicación del cultivo.
- Web: React, TypeScript y Vite; Bootstrap, CSS y Chart.js.
- Persistencia y autenticación: PostgreSQL y Supabase Auth, con permisos por cuenta y RLS.
- Mensajería: MQTT con Mosquitto. Wi-Fi proporciona acceso a la red.
- IA prevista: Gemini para sugerencias. La predicción numérica de temperatura queda para una fase posterior, con modelo y validación pendientes.

Supabase necesita acceso a Internet. Broker, n8n y servidor web se ejecutan localmente para la demostración; no hay un alojamiento de producción definido. La prueba local no demuestra cobertura de una finca remota ni funcionamiento autónomo sin Internet.

## Ejecución local

Desde la carpeta del proyecto, ejecutar cada comando en una terminal independiente y mantenerla abierta:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\mqtt\agrovigia.ps1 IniciarRed
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\n8n\iniciar-local.ps1
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\web\iniciar-local.ps1
```

Abrir n8n en http://localhost:5678 y la web en http://127.0.0.1:5173. Debe estar publicado un único flujo ambiental de persistencia, actualmente 03e. Estas instrucciones suponen que la configuración local existente está preparada. Si cambia la red o se utiliza otro computador, seguir la [guía de demostración en la universidad](docs/DEMOSTRACION_UNIVERSIDAD.md).

La configuración privada de Wi-Fi/MQTT, el entorno de la web y los datos/credenciales locales de n8n están excluidos de Git. Clonar el repositorio no restaura esos archivos. No repetir migraciones ya aplicadas ni publicar claves en código o capturas.

## Organización

| Carpeta | Contenido |
|---|---|
| `firmware/` | Programa ESP32 y diagnóstico de sensores |
| `mqtt/` | Configuración, ACL, lanzadores y pruebas de Mosquitto |
| `n8n/` | Flujos exportados sin credenciales, generadores, validadores y pruebas |
| `supabase/` | Migraciones, funciones, verificaciones y pruebas transitorias |
| `web/` | Aplicación React para teléfono y computador |
| `docs/` | Arquitectura, contratos, plan, evidencia y estado |
| `docs/referencias/` | Copias del diseño propuesto; no acreditan implementación |

## Guías y contratos

- [Arquitectura y alcance](docs/arquitectura-y-alcance.md) y [plan de implementación](docs/plan-implementacion.md).
- [Contrato MQTT v1](docs/contrato-mqtt-v1.md) y [contrato ambiental v2](docs/contrato-mqtt-v2.md).
- [Broker MQTT](mqtt/README.md) e [integración del nodo ambiental](docs/integrar-nodo-ambiental.md).
- [Ingesta y alertas en n8n](n8n/ALERTAS_SUPABASE.md).
- [Gestión de cultivos](supabase/APLICAR_CULTIVOS.md), [nodos](supabase/APLICAR_NODOS.md) y [backend de alertas](supabase/APLICAR_ALERTAS.md).
- [Pantallas](web/PANTALLAS.md), [históricos](web/HISTORIAL.md) y [alertas y avisos](web/ALERTAS.md).
- [Evidencia inicial MQTT](docs/pruebas/2026-10-25-dht22-mqtt.json), conservada como prueba histórica y no como una captura actual.

## Pendientes

Completar el segundo nodo y comparar los sensores juntos; documentar el ciclo real completo de alertas y la campana; mejorar prioridades y recuperación ante interrupciones; incorporar sugerencias IA y acordar con el profesor el alcance de la predicción. Los datos simulados y las pruebas con fixtures se mantienen separados de las mediciones físicas.
