# Auditoría UX/UI de AgroVigía y propuesta mobile-first

## Contexto

Juan percibe que la web muestra demasiados botones, tarjetas, explicaciones y opciones a la vez. Pide una auditoría basada en las tareas del agricultor, una propuesta de Inicio y navegación, wireframes móviles y un estudio para reemplazar el croquis 2D de Inicio por el visor 3D de Escenario. En esta fase solo se analiza y se propone; la implementación viene después, por etapas.

**Fuente de la evidencia.** Leí el código de la rama `juan/integracion-camilo`: `App.tsx`, `Zonas.tsx`, `Escenario.tsx`, `escena-3d.ts`, `red-data.ts`, `NodoDialogo.tsx`, `Alertas.tsx`, `Sugerencias.tsx`, `Historial.tsx`, `Cultivos.tsx`, `Dispositivos.tsx`, `NodosSimulados.tsx`, `CondicionesSimuladas.tsx`, `ParametrosDialogo.tsx`, `Dialogo.tsx` y los CSS (`tokens.css`, `base.css`, `vistas.css`, `escenario.css`, `simulacion.css`). También usé `docs/estado.md`.
**Lo que no hice:** no ejecuté la app, no tomé capturas nuevas ni probé con usuarios. `docs/estado.md` (revisión del 17 nov) ya registra «etiquetas 3D superpuestas en móvil». Todo lo demás se deduce del código y debe confirmarse en un teléfono real.

## Tareas del agricultor (base de todo el análisis)

| # | Tarea | Pregunta que se hace | Hoy está en |
|---|---|---|---|
| T1 | Entender las condiciones actuales | «¿Cómo está mi cultivo ahora y qué tan recientes son los datos?» | Inicio › Lecturas reales + Nodos simulados (dos bloques) |
| T2 | Ubicar un problema | «¿Dónde? ¿En qué sector o nodo?» | Inicio › Zonas y nodos (otra pestaña) o Escenario |
| T3 | Revisar alertas y sugerencias | «¿Qué pasó, desde cuándo y qué hago?» | Alertas e IA, sin vínculo entre ellas |
| T4 | Ver un nodo en detalle | «¿Qué mide este punto y cómo evolucionó?» | Zonas (panel) o Escenario (diálogo con formularios técnicos) |
| T5 | Configurar (poco frecuente) | Límites, cultivos, dispositivos, simulación | Repartido entre Alertas, Escenario, Cultivos y Dispositivos |

T1–T4 son diarias y T5 es ocasional. Hoy T5 aparece con el mismo peso visual que T1–T4.

---

## 1. Problemas principales (con evidencia y prioridad)

**P1 = bloquea la comprensión o la tarea diaria · P2 = fricción importante · P3 = pulido**

### P1 — Navegación y estructura

1. **Siete destinos en una tira horizontal desplazable, arriba de la pantalla.** Opciones en `App.tsx:245`; en móvil, `.navegacion-movil` es `sticky top` con `overflow-x: auto` y la barra de desplazamiento oculta (`base.css:144-145`). En 360–390 px quedan secciones fuera de la vista y nada indica que se puede deslizar. «IA» aparece antes que «Alertas» y los destinos de configuración (Cultivos, Dispositivos) pesan igual que los diarios.
2. **El mismo destino se repite en tres sitios.** El menú hamburguesa (`App.tsx:248-256`) repite los 7 destinos de la tira. La campana del encabezado (`:261`) y el aviso flotante (`:268`) llevan a Alertas, que también está en la tira. Son tres caminos al mismo lugar en la misma pantalla.
3. **Inicio obliga a elegir entre dos vistas que el agricultor necesita juntas.** El conmutador «Lecturas reales / Zonas y nodos» (`App.tsx:264`) separa *qué valores hay* (T1) de *dónde están* (T2). Además, «Lecturas reales» incluye los nodos simulados debajo (`:281`, `NodosSimulados`), así que el nombre de la pestaña no corresponde a su contenido.
4. **No hay un resumen de atención.** Ninguna pantalla responde «¿hay algo que revisar?» al entrar. El contador de la campana solo cuenta alertas **reales** sin revisar de **todos** los cultivos (`App.tsx:261` title). Falta el equivalente para datos simulados, para nodos sin recibir y para datos antiguos.
5. **Las alertas no se conectan con las mediciones ni con la IA.** Cada tarjeta de episodio muestra «Nodo: código», el valor, el límite y UUIDs en «Ver evidencia» (`Alertas.tsx:64-72`). No ofrece ver el nodo en el mapa, ni la gráfica alrededor del episodio, ni la sugerencia relacionada. `Sugerencia` solo guarda `motivo: 'alerta'` y un `contexto.alertas_abiertas: unknown[]` (`sugerencia-data.ts:16-19`), sin referencia confirmada al episodio.
6. **La configuración de límites está en tres lugares distintos.** (a) Alertas › Reglas › «Configurar regla» + «Plantilla de cultivo» (`Alertas.tsx:41-47, 81-102`). (b) «Parámetros del cultivo» en Escenario (`Escenario.tsx:151`). (c) «Parámetros» en cada tarjeta de Cultivos (`Cultivos.tsx:133`). `ParametrosDialogo` también puede crear reglas (`ParametrosDialogo.tsx:19`, `reglas`). El agricultor no sabe cuál es la fuente válida.

### P1 — Visor 3D (estado actual)

7. **Gestos que atrapan el desplazamiento.** `.capa-etiquetas { touch-action: none }` (`vistas.css:256`) y `OrbitControls` sobre esa capa (`escena-3d.ts:43`). En un teléfono, un dedo sobre el visor (380–496 px de alto) rota la escena en lugar de mover la página. Dentro del visor no hay forma de seguir bajando.
8. **Etiquetas superpuestas.** Ya observado y registrado en `estado.md`. Las etiquetas de nodo son DOM con `white-space: nowrap` (`vistas.css:261`). Por debajo de 900 px solo se ocultan las de cultivos no elegidos (`escena-3d.ts:155,193`); dentro del cultivo elegido no se controlan colisiones.
9. **El visor muestra solo conexión, no problemas.** El color del nodo indica Recibiendo, Sin recibir o En pausa (`escena-3d.ts:15`, `red-data.ts:21-24`). Una alerta activa no se ve en el 3D, de modo que el visor responde «¿llegan datos?» pero no «¿dónde hay un problema?» (T2).
10. **No se pueden elegir sectores.** El raycast solo considera los cuerpos de los nodos y el piso del cultivo (`escena-3d.ts:57-62`). Los sectores son mallas sin identificador. Tampoco existe un resaltado visual del nodo elegido.

### P2 — Ruido, textos y acciones

11. **Hay una explicación permanente en cada bloque.** Ejemplos: la descripción de cada vista (`App.tsx:263`), la nota del croquis (`Zonas.tsx:106`), el párrafo largo de la escena (`Escenario.tsx:194`), la nota del clima (`:183`), la ayuda de alertas (`Alertas.tsx:35`), la advertencia de IA (`Sugerencias.tsx:86`) y el texto «Las diferencias entre sensores…» en **cada** tarjeta de luz (`App.tsx:152`). Son verdaderas, pero repetidas en cada visita entrenan a ignorarlas.
12. **Cuatro botones «Actualizar» y seis frecuencias de refresco distintas.** Encabezado (`App.tsx:261`), «Actualizar zonas» (`Zonas.tsx:86`), «Actualizar alertas» (`Alertas.tsx:34`) y «Actualizar sugerencias» (`Sugerencias.tsx:82`). Refresco cada 30 s en Lecturas y Zonas, 15 s en NodosSimulados, 5/10/30 s en Escenario, 20 s en Cultivos y 60 s en IA. El usuario no sabe qué se actualiza solo.
13. **Hasta 7 acciones por tarjeta de cultivo.** Ver mediciones, Ver historial, Editar, Parámetros, Terreno y sectores, Agregar nodo simulado, Archivar y Eliminar (`Cultivos.tsx:130-137`).
14. **El detalle de nodo mezcla consulta y configuración técnica.** `NodoDialogo` tiene tres secciones: datos, el interruptor «Recepción» con pausa y el formulario de dispositivo con tipo, protocolo e intervalo (`NodoDialogo.tsx:90-126`). Quien quiere *ver* un nodo encuentra controles que pueden detener la recepción.
15. **Escenario mezcla tres propósitos.** Monitoreo en vivo (3D + fichas), laboratorio de simulación (clima, intensidad, ajuste manual con reglas deslizantes) y preferencias técnicas (tiempo real, cada 5/10/30 s) (`Escenario.tsx:147-201`). Su descripción dice «en un solo lugar» (`App.tsx:263`), y ese es justamente el problema.
16. **Condiciones simuladas aparecen en Alertas e Historial antes del contenido principal.** `CondicionesActivas` va encima de Alertas y `RegistroSimulacion` debajo de Historial (`App.tsx:281-282`), incluso cuando el usuario mira datos reales.
17. **La etiqueta «Favorable» de la IA puede leerse como «cultivo sano».** `ESTADOS_GENERALES.favorable` se muestra en verde (`sugerencia-data.ts:5`, `Sugerencias.tsx:14`). Esto choca con la condición del producto: la ausencia de problemas no demuestra salud.
18. **Datos técnicos en primer plano.** En la tarjeta de Inicio aparecen ADC «x / 4095» (`App.tsx:149`), «Recepción de aplicación · aprox.» (`:156`) y el UUID (`:160`). Son útiles para auditar, pero no para la decisión diaria.

### P2 — Tipografía, áreas táctiles y contraste

19. **Texto de 12 px (`--agv-t-xs`) usado como texto de lectura**, no solo en etiquetas: cuerpo de tarjetas de alerta (`vistas.css:223`), títulos de medición (`:37`), fechas (`:9-10`), valores de nodos simulados (`simulacion.css:56-58`) y todas las etiquetas 3D. En exterior, con sol, 12 px se lee mal. Propuesta: mínimo 14 px para texto y 16 px para valores secundarios.
20. **Áreas táctiles por debajo de 44 px.** `.boton-fila` mide 32 px (`simulacion.css:89`, botones Mover/Quitar). `.nodo-croquis` mide 40 px (`vistas.css:324`). Los nodos 3D dependen de la distancia de cámara y pueden quedar en 15–25 px en móvil.
21. **Color como único canal en algunos estados.** Los tonos del 3D (verde, rojo, gris) solo se acompañan de texto en la etiqueta, y en móvil `.etiqueta-nodo span { display:none }` (`vistas.css:269`). Sin la etiqueta, el estado depende solo del color. El contraste de texto base es bueno: #111 y #474747 sobre #f4f6f1 superan 4,5:1.

### P3 — Pulido y deuda

22. `.escena-red` está definida dos veces, con alturas distintas (`vistas.css:260,272` y `escenario.css:58,154`).
23. Mensajes dirigidos al equipo y no al agricultor: «Envía una desde el panel externo» (`Zonas.tsx:45`), «Comprueba que n8n esté en marcha» (`Sugerencias.tsx:61`) y «Comprueba las reglas… y la evaluación en n8n» (`Alertas.tsx:63`).
24. El visor gira solo al abrirse (`autoRotate`, `escena-3d.ts:45`). Esto desorienta y consume batería; ya se respeta `prefers-reduced-motion`.
25. `web/PANTALLAS.md` describe un «tema oscuro», pero `tokens.css` es de tema claro. Es documentación desactualizada.

**Lo que ya está bien y debe conservarse:** la distinción Real/Simulada en cada valor; los estados de antigüedad, ausencia, reloj futuro y error con la última captura conservada (`Zonas.tsx:36-47`); el aviso de captura de una ubicación anterior; «Revisada» y «Cerrada» como estados separados; «Sin alertas no significa cultivo saludable»; la luz como índice relativo; el contexto y las limitaciones de la IA; el diálogo nativo con foco atrapado; y la detección de WebGL con aviso (`Escenario.tsx:77,188`).

---

## 2. Navegación y contenido de Inicio

### Navegación propuesta (barra inferior, 5 destinos)

```
┌─────┬─────────┬────────────┬───────────┬──────┐
│  ⌂  │   🔔3   │     ✦      │    📈     │  ☰   │
│Inicio│ Alertas │Sugerencias │ Historial │  Más │
└─────┴─────────┴────────────┴───────────┴──────┘
```
- La barra va **abajo y fija**, al alcance del pulgar. En escritorio se conserva la barra lateral actual, con un grupo «Configuración»; el detalle está en la sección 6.
- **Más** contiene: Mis cultivos (con Límites, Terreno y sectores), Dispositivos, **Simulación** (el Escenario actual renombrado), Cuenta y Cerrar sesión.
- Se eliminan la tira desplazable, la campana del encabezado en móvil (el contador pasa a la pestaña Alertas) y el aviso flotante de alertas pendientes. Este último se sustituye por el resumen de atención de Inicio.
- «IA» pasa a llamarse **Sugerencias**, con el icono ✦ y el subtítulo «generadas por IA» dentro de la pantalla. Hay que validar el término con usuarios.
- El selector de cultivo se convierte en un chip en el encabezado («Lote Norte ▾»), compartido por todas las pantallas. El selector de origen Real/Simulado se mantiene solo en Alertas y Sugerencias cuando el cultivo es mixto, como ya ocurre en `App.tsx:277`.

### Funciones repetidas: dónde queda cada una

| Función | Hoy | Propuesta |
|---|---|---|
| Ver lecturas actuales | Inicio-Lecturas, Inicio-Zonas, NodosSimulados, Escenario-fichas, NodoDialogo | **Inicio** (lista + visor) y **Detalle de nodo** |
| Límites, plantilla y parámetros | Alertas-Reglas, Escenario-Parámetros, Cultivos-Parámetros | **Más › Cultivo › Límites** (un solo formulario) |
| Pausa y configuración de dispositivo | NodoDialogo (Escenario) y Dispositivos | **Más › Dispositivos › Configurar** |
| Clima simulado y ajuste manual | Escenario; aviso en Inicio, Alertas e Historial | **Más › Simulación**; en otras pantallas, solo una línea «Simulación activa: Lluvia · ver» cuando aplica |
| Actualizar | 4 botones | Refresco automático + indicador «Actualizado hace 12 s» + deslizar para actualizar. Un solo botón en caso de error |
| Ver historial | Cultivos, NodoDialogo, Historial | Historial, abierto **ya filtrado** desde el nodo o la alerta |

### Contenido de Inicio (en orden)
1. **Encabezado:** chip del cultivo e indicador de frescura de la consulta.
2. **Resumen de atención:** una sola tarjeta con, como máximo, tres líneas priorizadas.
   - «2 alertas activas sin revisar» → Alertas.
   - «1 nodo sin recibir desde hace 14 min» → nodo.
   - Sin alertas: «Sin alertas activas. *Esto no confirma que el cultivo esté sano.* Última lectura real hace 40 s».
   - Sin datos: «Aún no llegan lecturas de este cultivo».
   - Los conteos reales y simulados se muestran separados.
3. **Visor del cultivo** (3D, o croquis 2D como alternativa). Solo el cultivo elegido, con nodos marcados por estado.
4. **Hoja del elemento seleccionado** (nodo o sector): valores clave, Real/Simulada, antigüedad, alertas del nodo y «Ver detalle».
5. **Lista de nodos sincronizada con el visor.** Es la alternativa accesible y siempre está presente. Cada fila muestra código, sector, insignia R/S, estado, 2–3 valores y el icono ⚠ si hay alerta.
6. **Última sugerencia:** una línea de resumen, su fecha y «Ver».

Salen de Inicio el conmutador de vistas, los filtros Zona/Tipo (la lista se agrupa por sector), las notas permanentes (pasan a un botón ⓘ o a la primera visita), los datos técnicos (pasan al detalle) y «Cambiar clima o ajuste» (pasa a Simulación).

### Primera visita
- Tres pantallas breves que se pueden omitir y que vuelven desde Más › Ayuda:
  - (a) «R = sensor real, S = simulado; nunca se mezclan».
  - (b) «Verde recibe, naranja sin recibir, ⚠ alerta. Sin alertas no significa cultivo sano».
  - (c) «Toca un punto del mapa para ver su detalle».
- Estados vacíos accionables:
  - Sin cultivo → «Registrar cultivo».
  - Sin nodos → «Vincular un dispositivo».
  - Sin lecturas → explicación sin culpar al usuario y sin inventar la causa.

---

## 3. Wireframes móviles (360–390 px)

### 3.1 Inicio
```
┌──────────────────────────────────────┐
│ AgroVigía        Lote Norte ▾        │
│ Actualizado hace 12 s · ↻ automático │
├──────────────────────────────────────┤
│ ┌──────────────────────────────────┐ │
│ │ ⚠ 2 alertas sin revisar      ›  │ │
│ │ ◌ sim-03 sin recibir · 14 min ›  │ │
│ │ Real: 1 nodo · Simulado: 4 nodos │ │
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │        (visor 3D estático)       │ │
│ │   ┌Norte──────┬Sur────────┐      │ │
│ │   │  (S1)  R1 │  (S2)     │      │ │
│ │   ├Central────┼Drenaje────┤      │ │
│ │   │  (S3)⚠    │  (S4)     │      │ │
│ │   └───────────┴───────────┘      │ │
│ │ [⤢ Explorar en 3D]   [▦ Vista 2D]│ │
│ └──────────────────────────────────┘ │
│ ┌ Seleccionado: S3 · Central ─────┐ │
│ │ SIMULADA · hace 40 s             │ │
│ │ 34,2 °C   48 % HR   22 % VWC     │ │
│ │ ⚠ Temperatura sobre 32 °C        │ │
│ │                  [Ver detalle ›] │ │
│ └──────────────────────────────────┘ │
│ NODOS POR SECTOR                     │
│ Norte                                │
│  R1 agv-dht22-01 REAL ● Recibe 27,5°›│
│  S1 sim-01   SIMULADA ● Recibe 26,1°›│
│ Central                              │
│  S3 sim-03 SIMULADA ● Recibe ⚠ 34,2°›│
│ …                                    │
│ ✦ Sugerencia · hace 25 min           │
│ «Aumentar ventilación en Central…» › │
├──────────────────────────────────────┤
│ ⌂Inicio 🔔Alertas ✦Sug. 📈Hist. ☰Más│
└──────────────────────────────────────┘
```

### 3.2 Detalle de nodo (pantalla completa, con «‹ Volver»)
```
┌──────────────────────────────────────┐
│ ‹ Inicio        sim-03               │
│ SIMULADA · Sector Central · ● Recibe │
│ Última captura: hace 40 s (10:42:05) │
├──────────────────────────────────────┤
│ AHORA                                │
│ ┌────────────┐┌────────────┐         │
│ │Temperatura ││Humedad aire│         │
│ │ 34,2 °C  ⚠ ││  48 % HR   │         │
│ └────────────┘└────────────┘         │
│ ┌────────────┐┌────────────┐         │
│ │Luz relativa││Hum. suelo  │         │
│ │ 61 % rel.  ││ 22 % VWC   │         │
│ └────────────┘└────────────┘         │
│ [Ver las 10 variables ▾]             │
│ ALERTAS DE ESTE NODO                 │
│ ⚠ Temp. sobre 32 °C · desde 10:12    │
│   Activa · Sin revisar          ›    │
│ ÚLTIMAS 24 H  (mini gráfica temp.)   │
│ ▁▂▃▅▆▇█▇ ─ ─ límite 32 °C            │
│ [Ver historial completo ›]           │
│ ▸ Datos técnicos de la captura       │
│   (fecha recepción, ADC, método, ID) │
│ [Configurar dispositivo ›]  (enlace) │
└──────────────────────────────────────┘
```
- Si se trata de un nodo físico con clima simulado activo: un bloque plegado «Proyección simulada (no es lectura real)».
- Se conservan del panel actual de Zonas los avisos de ubicación anterior, reloj futuro, límites del ADC y error con la última captura.

### 3.3 Alertas (lista) y detalle
```
┌──────────────────────────────────────┐
│ Alertas           Lote Norte ▾       │
│ [ Reales | Simuladas ]  (si es mixto)│
│ ⓘ Sin alertas ≠ cultivo sano         │
├──────────────────────────────────────┤
│ POR REVISAR (2)                      │
│ ┌──────────────────────────────────┐ │
│ │ Temperatura sobre el máximo      │ │
│ │ 34,2 °C · límite 32 °C           │ │
│ │ sim-03 · Central · desde 10:12   │ │
│ │ Condición: ACTIVA  Revisión: ✗   │ │
│ │ [Marcar revisada]        [Ver ›] │ │
│ └──────────────────────────────────┘ │
│ ACTIVAS YA REVISADAS (1)        ▸    │
│ CERRADAS (12)                   ▸    │
├──────────────────────────────────────┤
│ ⌂ 🔔 ✦ 📈 ☰                          │
└──────────────────────────────────────┘

Detalle de alerta
┌──────────────────────────────────────┐
│ ‹ Alertas                            │
│ Temperatura sobre el máximo          │
│ SIMULADA · sim-03 · Sector Central   │
│ Condición: ACTIVA · Revisión: Sin rev│
├──────────────────────────────────────┤
│ QUÉ PASÓ                             │
│ Abrió 10:12 con 32,8 °C. Último fuera│
│ de rango 10:42 con 34,2 °C (hace 40s)│
│ (gráfica del episodio + línea límite)│
│ [Ver en el mapa]  [Ver historial]    │
│ SUGERENCIA RELACIONADA ✦ IA          │
│ Generada 10:15 con datos de 10:14    │
│ «Ventilar el sector central…»        │
│ Limitaciones: sin sensor de suelo…   │
│ [Ver sugerencia completa ›]          │
│  — o, si no hay —                    │
│ [Pedir análisis ahora]               │
│ ▸ Evidencia (IDs de medición)        │
│ [ Marcar como revisada ] (principal) │
└──────────────────────────────────────┘
```
Las reglas y límites salen de Alertas y pasan a «Más › Cultivo › Límites». En el detalle queda solo un enlace: «Límite configurado: 32 °C · Cambiar ›».

---

## 4. Integración del visor 3D existente en Inicio

### Qué se reutiliza
- `crearEscena` (`escena-3d.ts`) ya dibuja el terreno a escala, los sectores y cada nodo en su posición real cuando hay plano (`red-data.ts:113-121`, `terreno-data.ts:cargarPlanos`). Si recibe solo las filas de un cultivo, `panalRed` produce un único grupo centrado.
- Datos: `cargarEstadoRed` (estado por nodo) más `cargarPlanos` para el cultivo elegido. El detalle reutiliza `cargarLoteNodo`, junto con la lógica de validación de `LecturaZona` (`Zonas.tsx:13-59`).

### Cambios necesarios en el visor (la API pasa a recibir opciones)
1. **Modo por pantalla:** `crearEscena(contenedor, eventos, { modo: 'inicio' | 'simulacion' })`.
   - `inicio`: sin giro automático, cámara cenital a unos 60°, sin partículas ni pulsos continuos y etiquetas solo para lo seleccionado y lo que tiene alerta.
   - `simulacion`: el comportamiento actual.
2. **Selección de sectores:** guardar el id de cada malla de sector, incluirlas en el raycast (`escena-3d.ts:57-62`) y emitir `alSeleccionarZona(id)`.
3. **Resaltado:** método `resaltar({ nodoId?, zonaId? })` que muestra un anillo bajo el nodo, eleva el sector y lleva la cámara hacia lo elegido. La selección queda sincronizada entre visor, lista y hoja.
4. **Capa de atención:** marca ⚠ (CSS2D o sprite) en nodos con alerta activa del origen visible. El color sigue indicando conexión y la marca indica alerta. Cada estado lleva **forma más texto**, no solo color. Los nodos físicos conservan la antena y los simulados el cilindro bajo, para no depender del color.
5. **Etiquetas sin superposición:**
   - Marcadores cortos «R1, S1…» iguales a los de la lista, dentro de una pastilla de al menos 28 px con un área táctil de 44 px.
   - Etiqueta completa solo para la selección y las alertas.
   - Tras cada renderizado, una comprobación en pantalla oculta la etiqueta de menor prioridad cuando dos se cruzan. Orden de prioridad: seleccionado > alerta > físico > resto.
   - Los nombres de sector aparecen en la esquina del sector y se ocultan cuando el sector mide menos de 80 px en pantalla.
6. **Gestos en móvil:**
   - **Estático por defecto** en Inicio: se desactivan la rotación y el zoom, la capa usa `touch-action: pan-y` y un toque (desplazamiento menor de 6 px, como ya hace `escena-3d.ts:64-66`) selecciona. La página sigue desplazándose.
   - **«⤢ Explorar en 3D»** abre una vista a pantalla completa: un dedo rota, dos dedos acercan, y hay botones grandes «Recentrar», «Vista desde arriba» y «Cerrar».
   - Se añade un botón «+/−» de zoom para quien no domina el pellizco.
7. **Rendimiento:**
   - Renderizar solo cuando cambian los datos o la cámara (sustituye el `requestAnimationFrame` continuo de `escena-3d.ts:212`).
   - Pausar con `IntersectionObserver` cuando el visor sale de la pantalla.
   - Limitar `pixelRatio` a 1,5 en móvil.
   - Cargar Three.js de forma diferida **después** de pintar el resumen y la lista. Hasta entonces se muestra un esqueleto del alto del visor.
   - Medir el tamaño del fragmento de Three, los FPS en un Android de gama media y el tiempo hasta la interacción con red 4G limitada.
8. **Alternativa sin WebGL o «Vista 2D»:**
   - Extraer el croquis de `Zonas.tsx:91-105` como componente de presentación `CroquisCultivo`, con la **misma** API de selección.
   - Se usa automáticamente si `crearEscena` falla (ya se detecta en `Escenario.tsx:77`) y como preferencia guardada «▦ Vista 2D».
   - El lienzo 3D es `aria-hidden` (`escena-3d.ts:34`). La **lista de nodos** es la vía accesible por teclado y lector de pantalla, con anuncio `aria-live` de la selección.
9. **Altura del visor:** unos 45 % del alto de pantalla en móvil (no 380–496 px fijos), para que el resumen y el inicio de la hoja se vean sin desplazar. Se unifica la regla `.escena-red` duplicada.

### Controles: cuáles van en Inicio y cuáles salen
| En Inicio | Fuera de Inicio |
|---|---|
| Tocar nodo o sector, Explorar 3D, Vista 2D, Recentrar (en pantalla completa) | Clima, intensidad, ajuste manual → **Simulación** |
| Hoja del elemento seleccionado y «Ver detalle» | Pausa de recepción, tipo, protocolo, intervalo → **Dispositivos** |
| Lista por sector | Parámetros y límites → **Cultivo › Límites** |
| — | Tiempo real y frecuencia → **Más › Cuenta › Preferencias** (o fijo en un valor razonable) |
| — | Selector multicultivo (panal) → solo en **Simulación** |

---

## 5. Plan incremental (de mayor a menor impacto en comprensión)

Cada etapa es pequeña y verificable y se registra en `docs/estado.md`. No requiere dependencias nuevas, salvo que se decida otra cosa.

**E0 — Validación previa (sin código, 1–2 sesiones).** Prueba con 3–5 personas del perfil, o con representantes si no hay agricultores disponibles, usando la app actual y estos wireframes (papel o HTML). Tareas: (1) «¿Está todo bien en tu lote?», (2) «¿Dónde hay un problema?», (3) «¿Qué te recomienda hacer?», (4) «Muestra cómo estuvo la temperatura de ese punto hoy». Medir aciertos, tiempo, dudas sobre el vocabulario y si «Favorable» o «sin alertas» se leen como «sano».

**E1 — Navegación y ruido.** Bajo riesgo, solo afecta a `App.tsx` y CSS.
- Barra inferior de 5 destinos y menú Más.
- Quitar la descripción por vista, el aviso flotante y la campana duplicada en móvil.
- Un solo indicador de frescura.
- Las notas permanentes pasan a ⓘ.
- Texto mínimo de 14 px y áreas táctiles de 44 px (`.boton-fila`, `.nodo-croquis`).
- Mensajes «n8n / panel externo» reescritos para el agricultor.

**E2 — Inicio con resumen y lista unificada (todavía con croquis 2D).**
- Tarjeta de atención (alertas sin revisar por origen, nodos sin recibir, antigüedad).
- Lista única por sector que fusiona `Lecturas`, `NodosSimulados` y la lista de `Zonas`.
- Pantalla de detalle de nodo de solo lectura, que reutiliza la validación de `LecturaZona` y conserva todas las condiciones de integridad.
- Se retira el conmutador de vistas.

**E3 — Visor 3D en Inicio.** Refactor de `escena-3d.ts` con opciones de modo, selección de sector, resaltado, marca ⚠, colisión de etiquetas, modo estático/explorar y renderizado bajo demanda. Componente `VisorCultivo` con alternativa `CroquisCultivo`. Carga diferida.

**E4 — Alerta ↔ medición ↔ IA.**
- Agrupar por «Por revisar / Revisadas activas / Cerradas».
- Detalle con mini gráfica del episodio (reutiliza la consulta de Historial y Chart.js), «Ver en el mapa» y sugerencia relacionada.
- **Dependencia de datos:** confirmar si `contexto.alertas_abiertas` guarda los ids de los episodios. Si no, se necesita una columna `episodio_id` en `sugerencias_ia`, que implica una migración y un cambio en n8n que habría que planear aparte. Mientras tanto se usa un vínculo temporal identificado como «generada después de abrir esta alerta».
- Cambiar «Favorable» por un texto que no implique salud, por ejemplo «Sin acciones urgentes según los datos disponibles».

**E5 — Configuración en su lugar.**
- «Cultivo › Límites» unifica `ParametrosDialogo`, `PlantillaCultivo` y el editor de reglas.
- Escenario pasa a «Simulación» dentro de Más; sus condiciones solo aparecen como una línea en otras pantallas.
- Pausa y configuración de dispositivo salen de `NodoDialogo` hacia Dispositivos.
- Las acciones secundarias de las tarjetas de Cultivos pasan a un menú «⋯».

**E6 — Primera visita y estados vacíos.** Tres pantallas de bienvenida que se pueden omitir; estados vacíos con una acción clara.

### Comprobaciones por etapa
- `npm test` y `npm run build` en `web/`.
- QA en navegador con datos de prueba a 360, 390, 768 y 1280 px. Revisar sin desbordamiento horizontal, desplazamiento de página sobre el visor, selección sincronizada visor/lista/hoja, alternativa forzada sin WebGL y navegación con teclado y lector de pantalla en la lista.
- Lighthouse de accesibilidad y rendimiento con limitación 4G.
- Revisión de Juan con su sesión real y los servicios en marcha. Sin escrituras a Supabase ni n8n salvo en E4 si se aprueba la migración.

## 6. Escritorio y tablet

Añadido después de E1. Wireframes en [wireframes-escritorio.html](wireframes-escritorio.html): 4 hojas A4 horizontales con los mismos datos de ejemplo que E0. Las pantallas de escritorio están dibujadas a 1280 × 800 y la tablet a 768 × 1024.

### Reglas por ancho
| Ancho | Navegación | Inicio | Detalle de punto o alerta | Visor |
|---|---|---|---|---|
| Menos de 600 px (teléfono) | Barra inferior de 5 y Más | Una columna | Pantalla completa con «‹ Volver» | Quieto; tocar elige; «Explorar en 3D» a pantalla completa |
| 600 a 899 px (tablet vertical) | Barra inferior de 5 y Más | Una columna; punto y sugerencia lado a lado; lista en dos columnas | Pantalla completa | Igual que en el teléfono, más alto |
| 900 a 1199 px (tablet horizontal, portátil pequeño) | Barra lateral con grupo Configuración | Una columna ancha; lista en dos columnas | Panel lateral derecho | Ratón: arrastrar gira, Ctrl + rueda acerca; táctil: igual que el teléfono |
| 1200 px o más (escritorio) | Barra lateral con grupo Configuración | Dos columnas: lote y lista \| atención, punto y sugerencia | Punto: panel lateral. Alertas: lista y detalle juntos | Como en 900 px, con el nombre del punto al pasar el ratón |

- **La tablet usa la barra inferior.** A 768 px una barra lateral ocuparía casi un tercio del ancho, y la tablet se usa con los dedos. La barra lateral empieza en 900 px, como ya hace la web desde E1, así que no cambia nada al girar la tablet a menos de ese ancho.
- **Lo que no cambia con el ancho:** los textos, los avisos de datos simulados, antigüedad y luz relativa, la letra mínima de 14 px, los botones de 44 px y el orden de lectura (primero lo que pide atención, luego dónde, luego el detalle).

### Inicio en escritorio (hoja 1)
- **Columna izquierda:** el visor y la lista por sector en dos columnas.
- **Columna derecha:** el resumen de atención, el punto elegido y la última sugerencia, siempre visibles mientras se mira el lote.
- **Visor con ratón:**
  - Arrastrar gira, porque con ratón no hay conflicto con el desplazamiento de la página.
  - La rueda solo acerca con Ctrl, para no secuestrar el desplazamiento.
  - Al pasar el ratón por un punto se ve su nombre y un valor.
  - Los botones «+», «−» y «centrar» sirven a quien no usa la rueda.
  - El teclado sigue usando la lista.

### Detalle de un punto en escritorio (hoja 2)
- Panel lateral de 440 px a la derecha: el lote sigue visible con el punto marcado.
- Tiene el mismo contenido que la pantalla del teléfono, incluidos los avisos de captura antigua, reloj y ubicación anterior.
- Escape o × lo cierra, y el foco vuelve a la fila o al punto que lo abrió.

### Alertas en escritorio (hoja 3)
- La lista (380 px) y el detalle se ven juntos; elegir una alerta cambia el panel derecho sin salir de la pantalla.
- «Marcar como revisada» va arriba del detalle, separado de los estados, para no confundirlo con cerrar la alerta.
- En el detalle, «Qué pasó» (con la gráfica) y la sugerencia relacionada van lado a lado.
- En el teléfono, la lista y el detalle siguen siendo dos pantallas.

### Dónde entra en el plan
- **E2:** maquetación de Inicio en una y dos columnas, y detalle de punto como panel lateral desde 900 px.
- **E3:** gestos de ratón del visor (arrastrar, Ctrl + rueda, nombre al pasar el ratón, botones de zoom).
- **E4:** Alertas con lista y detalle juntos desde 1200 px.
- **E5:** Historial y Configuración se mantienen como hoy en escritorio; solo cambian las acciones que pasan al menú «⋯».

### Pendiente de validar
Si en escritorio el agricultor prefiere ver primero el lote o la lista, si entiende que el panel lateral se cierra y si usa el visor con ratón o prefiere la lista.

## Qué falta validar con usuarios
- Si el 3D ayuda más que el croquis 2D a ubicar problemas (comparar tiempo y errores en T2), y si «Explorar en 3D» se descubre y se entiende.
- El vocabulario: «nodo», «sector/zona», «simulado», «revisada» frente a «cerrada», «Sugerencias» frente a «IA».
- La lectura en exterior (sol directo), el tamaño del texto y el tipo de teléfono y conexión de los usuarios.
- La confianza en las sugerencias y si las limitaciones se leen.
- Si el resumen de atención sustituye la necesidad de abrir Alertas cada día.
