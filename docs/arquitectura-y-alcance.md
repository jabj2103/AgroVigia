# Arquitectura y alcance vigentes

## Ampliación acordada: simulación por zonas

3 de noviembre de 2026: tras la revisión del profesor, Juan solicita preparar primero un panel externo de escenarios y señalar explícitamente cada variable como Simulada. Se amplía el diseño para admitir sectores de un cultivo y varios nodos virtuales con variables ambientales, de suelo, lluvia y viento. Los dos ESP32 previstos conservan sus sensores físicos DHT22 + LDR; el resto de esta etapa son datos sintéticos, sin nuevas mediciones físicas.

La primera implementación está aislada en [simulador/](../simulador/README.md): cuatro puntos ficticios, diez variables, escenarios reproducibles, bitácora y exportación local. Aún no altera catálogo, límite de dos nodos, RPC, ACL, firmware ni consultas de la web. La integración posterior necesita migraciones/contrato versionado y resolver zonas históricas, origen y permisos. Los textos locales de cultivo/zona no autorizan escritura en la base. Las descripciones inferiores conservan el diseño previo y deben leerse junto a esta ampliación y el registro de ejecución.

Se proponen perfiles de reglas por cultivo con fuente, versión y condiciones de aplicación; no están implementados en esta etapa. El selector de cultivo del simulador es únicamente contexto. Gemini se mantiene previsto para explicar observaciones y producir sugerencias con evidencias; no fija umbrales agronómicos automáticamente.

Juan solicita además un croquis general del cultivo donde se puedan seleccionar zonas y nodos. Se prepara esa base en 0007 con rectángulos normalizados 0–1 y marcadores relativos a su zona, y se guarda la ubicación histórica en cada nueva medición; no es un mapa GPS ni calcula superficies. Los nodos sin posición aparecerán «Sin ubicar». La futura pantalla deberá ofrecer selección equivalente por teclado/lista, distinguir origen y antigüedad y mostrar solo las capacidades reales del nodo seleccionado, sin mezclar estadísticas de orígenes/métodos diferentes ni presentar colores como salud del cultivo.

En `juan/simulacion-zonas` se preparan contrato/adaptador v3 y migraciones 0007/0008 para guardar diez variables de nodos virtuales autorizados, con hasta dos nodos físicos y dieciséis virtuales por cultivo mediante RPC. Solo se probaron en PGlite aislado; no se han aplicado al Supabase compartido ni se habilitó transporte nuevo. La web gráfica y la integración del emisor/receptor son etapas siguientes. La guía de revisión/aplicación está en [APLICAR_ZONAS_SIMULADAS.md](../supabase/APLICAR_ZONAS_SIMULADAS.md).

## Propósito

Demostrar el monitoreo ambiental de cultivos con equipos disponibles, una plataforma web y sugerencias de IA. El objetivo académico es un prototipo verificable que permita discutir su ampliación; no se afirma que ya exista una solución de producción para fincas sin conectividad.

## Recorrido de los datos

1. Cada uno de los dos ESP32 tendra DHT22 y LDR; mediran las mismas variables en distintos puntos del cultivo (aclaracion de Juan, 26 de octubre de 2026).
2. Cada ESP32 accede a la red por Wi-Fi y publica mensajes MQTT en Mosquitto.
3. n8n recibe los mensajes, contrasta nodo/tópico/autorización, valida el contenido y almacena observaciones en Supabase sin duplicarlas.
4. Las reglas deterministas evalúan las condiciones y actualizan episodios de alerta.
5. Un flujo de n8n reúne contexto pertinente y solicita a Gemini una sugerencia, valida la respuesta y guarda la sugerencia con sus evidencias.
6. React utiliza Supabase Auth y consulta los datos autorizados mediante la API/RPC de Supabase. Las consultas del agricultor no pasan por el receptor MQTT de n8n.

Los mensajes y requisitos de recepción tienen una base de trabajo en [contrato-mqtt-v1.md](contrato-mqtt-v1.md), pendiente de revisión conjunta antes de integrar. El procedimiento ejecutable y las herramientas de firmware se definirán durante la implementación. El broker y n8n pueden probarse en un computador para la demostración. Su ubicación futura no se ha decidido. Si Supabase o Gemini están en Internet, se requiere acceso a Internet desde los componentes que los consultan; disponer de Wi-Fi local no equivale a disponer de Internet.

## Equipos y variables

| Nodo | Sensor | Variable | Unidad o escala |
|---|---|---|---|
| ESP32 1 | DHT22 | Temperatura ambiental | °C |
| ESP32 1 | DHT22 | Humedad relativa del aire | % HR |
| ESP32 1 | LDR | Iluminacion relativa | Escala propuesta 0-100 % relativo, conversion pendiente |
| ESP32 2 | DHT22 | Temperatura ambiental | Grados Celsius |
| ESP32 2 | DHT22 | Humedad relativa del aire | % HR |
| ESP32 2 | LDR | Iluminacion relativa | Misma escala de referencia que ESP32 1, conversion pendiente |

No hay sensor de humedad de suelo ni cámara. El LDR no debe mostrarse como lux sin calibración. No se prometen distancias Wi-Fi ni cobertura de una finca sin una evaluación del sitio. LoRa/LoRaWAN son alternativas futuras por estudiar, no parte de esta demostración.

## Funciones y orden de alcance

CU01: iniciar sesión. CU02: registrar cultivo y vincular nodos habilitados. CU03: consultar condiciones ambientales. CU04: consultar alertas activas y marcarlas como revisadas. CU05: consultar históricos y estadísticas. CU07: cerrar sesión. CU08: consultar sugerencias de IA.

CU06, consultar predicción de temperatura ambiental, permanece como funcionalidad prevista para una fase posterior. No hay modelo temporal, horizonte o validación definidos. No se elimina del diseño ni se afirma que esté implementado.

Las cuentas se preparan por el equipo. No hay autorregistro público ni necesidad de una pantalla de administrador para la primera demostración. El agricultor selecciona uno o ambos nodos previamente habilitados para su cuenta y disponibles. El registro del cultivo exige al menos un nodo; cada nodo tiene a lo sumo un cultivo actual.

## Persistencia

La propuesta contiene once tablas propias: perfiles, cultivos, nodos, variables, nodo_variables, mediciones, reglas_alerta, alertas, sugerencias_ia, sugerencia_mediciones y predicciones. auth.users es administrada por Supabase Auth.

Las mediciones guardan su cultivo histórico, su nodo, variable, valor, mensaje, fechas y origen. Las sugerencias conservan evidencias. Las alertas conservan mediciones inicial/última, revisión y cierre independientes. Los históricos y las estadísticas se derivan de las mediciones.

El SQL de referencia contiene claves, restricciones, índices, catálogo, triggers y políticas de lectura; no se ha ejecutado en una base de datos. Las RPC y los flujos todavía faltan. Revisar RLS y transacciones durante la implementación, y no conceder acceso privilegiado al navegador.

## Reparto de trabajo acordado

- Juan: sensores, firmware ESP32, pruebas de Mosquitto y posteriormente web React.
- Camilo: Supabase, n8n y Gemini.
- Ambos: contrato MQTT, revisión de requisitos, integración y demostración.

Este reparto permite avanzar simultáneamente con mensajes de ejemplo. Las claves, nombres y unidades compartidos deben mantenerse consistentes.
