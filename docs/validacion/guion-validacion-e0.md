# Guion de validación E0 · AgroVigía en el teléfono

Etapa E0 de la [auditoría UX móvil](../revisiones/2026-11-17-auditoria-ux-movil.md). Su objetivo es observar a personas reales usando la aplicación **antes** de cambiar la interfaz, para decidir con evidencia qué etapas hacer primero (E1–E6).

Este documento es un guion. Todavía no se ha aplicado con nadie y no hay resultados.

---

## 1. Qué queremos averiguar

Cada pregunta se responde con una o más tareas de la sección 5.

| # | Pregunta | Tareas | Decide |
|---|---|---|---|
| Q1 | ¿Se entiende al entrar cómo está el cultivo y qué tan recientes son los datos? | T1 | E1, E2 |
| Q2 | ¿Se encuentra **dónde** hay un problema? ¿Ayuda el croquis 2D o el visor 3D? | T2, T6 | E2, E3 |
| Q3 | ¿Se llega desde una alerta a lo que conviene hacer? | T3 | E4 |
| Q4 | ¿Se distingue «revisada» de «cerrada»? | T4 | E4 |
| Q5 | ¿Alguien interpreta «sin alertas» o «Favorable» como «cultivo sano»? | T5 | E4, E6 |
| Q6 | ¿Se distinguen los datos reales de los simulados? | T1, T2, sondeo de vocabulario | E2 |
| Q7 | ¿Se encuentra el historial de un punto? | T7 | E2, E4 |
| Q8 | ¿Se usan bien los gestos del visor 3D en el teléfono? | T6 | E3 |
| Q9 | ¿Qué palabras confunden: nodo, sector, simulado, IA, % relativo…? | Sondeo de vocabulario | E1 |

## 2. Participantes

- **Cantidad:** de 3 a 5 personas. Con cinco ya aparecen la mayoría de los problemas grandes; no se busca estadística.
- **Perfil ideal:** personas que cultivan o trabajan en un cultivo, con **distintos niveles de experiencia digital**. Al menos una que use poco el teléfono además de WhatsApp.
- **Si no hay agricultores disponibles:** familiares o conocidos con experiencia agrícola, o estudiantes de áreas agrarias. Marcarlos como **«representante»** en la hoja; sus resultados valen menos para las preguntas de vocabulario y confianza.
- **No conviene** que participen integrantes del equipo ni personas que ya hayan visto la aplicación funcionando.
- Cada persona se identifica solo con un código (P1, P2…). No se anotan nombres, teléfonos ni datos de su finca.

## 3. Consentimiento (leer en voz alta)

> «Estamos probando una aplicación de un proyecto académico de la Universidad de Cartagena. **No te estamos evaluando a ti; evaluamos la aplicación.** Si algo es difícil, es un problema de la aplicación y nos sirve saberlo. Vas a usar un teléfono con una cuenta de prueba, no tus datos. Tomaré notas sin tu nombre. ¿Puedo grabar solo la pantalla del teléfono y la voz, sin tu cara? Puedes decir que no, saltar cualquier tarea o terminar cuando quieras. Dura unos 35 minutos.»

- Anotar en la hoja si acepta la grabación. Si no acepta, solo se toman notas.
- Si el curso o la universidad tiene un formato propio de consentimiento, usar ese en lugar de este texto.
- Las grabaciones se guardan fuera de Git y se borran después del análisis.

## 4. Preparación (el día anterior y 30 minutos antes)

### Equipo
- [ ] Un teléfono Android con Chrome. Preferiblemente uno de gama media, parecido al que usarían los participantes. Brillo automático.
- [ ] La cuenta de prueba con sesión iniciada. **No usar la cuenta personal del participante.**
- [ ] Desactivar notificaciones del teléfono (modo No molestar).
- [ ] Pantallas impresas: [wireframes-e0.html](wireframes-e0.html), abierto en Chrome e impreso en A4 horizontal al 100 % con gráficos de fondo (5 hojas). Las hojas 1 a 4 llevan las pantallas A–E; la hoja 5 es la clave para quien modera y **no se muestra** a los participantes.
- [ ] Hojas de registro impresas (Anexo A), una por participante, y un cronómetro.

### Servicios (en la terminal de Juan)
- [ ] Broker, n8n, servicio automático del simulador y web en marcha, con los lanzadores habituales.
- [ ] Abrir Inicio y confirmar que hay lecturas recientes de los nodos simulados.

### Estado del cultivo que verán los participantes
Hace falta que el cultivo muestre situaciones reales que buscar. **Todo se prepara con la cuenta de prueba y queda registrado en el historial de simulación.**

1. **Plantilla y reglas simuladas.** Según `docs/estado.md`, hoy no hay reglas simuladas aplicables. En Alertas, con el origen **Datos simulados**, ir a Reglas › Plantilla de cultivo, elegir una plantilla y aplicarla con sus reglas.
2. **Una alerta simulada activa.** En Escenario, aplicar **Sol fuerte** con intensidad alta al cultivo y esperar a que algún nodo simulado supere el límite de temperatura (unos dos minutos). Comprobar en Alertas que aparece una alerta **activa y sin revisar**.
3. **Una alerta activa ya revisada** (para T4). Esperar o provocar una segunda alerta y marcarla como revisada **antes** de la sesión, sin que la condición se cierre.
4. **Un nodo sin recibir.**
   - Opción A (preferida): desconectar el ESP32 unos 5 minutos antes, para que el nodo real aparezca «Sin recibir».
   - Opción B: pausar la recepción de un nodo simulado desde su detalle en Escenario. Aparecerá «En pausa», que no es lo mismo; anotarlo en la hoja.
5. **Una sugerencia reciente.** En IA, con Datos simulados, pulsar «Analizar ahora» y esperar a que llegue.
6. Volver a Inicio y dejar la aplicación ahí, con la vista «Lecturas reales».

> Si alguno de estos estados no se consigue, anotarlo en la hoja. La tarea correspondiente se hace igual, pero sus resultados se marcan como «estado incompleto».

**Después de cada sesión:** comprobar que la alerta sigue activa y sin revisar (o crear otra), porque el participante puede haberla marcado como revisada.

## 5. Desarrollo de la sesión (unos 35 minutos)

### 5.1 Inicio (3 min)
- Consentimiento (sección 3).
- Explicar el «pensar en voz alta»: «Mientras usas la aplicación, dime lo que piensas, lo que buscas y lo que esperas que pase. No hay respuestas buenas ni malas».

### 5.2 Preguntas previas (4 min)
1. ¿Qué cultivas o en qué cultivo trabajas?
2. ¿Para qué usas el teléfono normalmente? (Llamadas, WhatsApp, redes, banca, otras aplicaciones.)
3. ¿Usas alguna aplicación o servicio para el clima o para tu cultivo?
4. ¿Qué te gustaría saber de tu cultivo cada día al mirar el teléfono?

### 5.3 Tareas en la aplicación actual (18 min)

Leer cada tarea **tal como está escrita**, sin nombrar botones ni pantallas. Si la persona pregunta «¿dónde toco?», responder: «¿Dónde lo buscarías tú?». Ayudar solo si lleva más del tiempo límite o se frustra; en ese caso anotar **«con ayuda»**.

Al terminar cada tarea, preguntar: **«Del 1 al 5, ¿qué tan fácil fue?»** (1 = muy difícil, 5 = muy fácil). Para quien prefiera, mostrar cinco caritas.

---

**T1 · Condiciones actuales** (límite: 2 min)
> «Imagina que acabas de llegar a tu lote y abres la aplicación. ¿Cómo está tu cultivo en este momento?»

- **Éxito:** menciona al menos un valor con su unidad **y** cuándo se tomó (por ejemplo «hace un minuto»).
- **Observar:**
  - ¿Lee los valores reales y los simulados como si fueran lo mismo?
  - ¿Ve la antigüedad del dato?
  - ¿Se detiene en textos técnicos (ADC, UUID, «recepción de aplicación»)?
  - ¿Desliza la tira superior?
- **Seguimiento:** «¿Esos datos son de ahora? ¿Cómo lo sabes?» «¿Qué significa la etiqueta Real o Simulada?»

**T2 · Dónde hay un problema** (límite: 3 min)
> «¿Hay algún lugar del lote que necesite atención? Muéstrame dónde está.»

- **Éxito:** señala el nodo o sector correcto (el de la alerta activa o el nodo sin recibir) y dice por qué.
- **Observar:**
  - ¿Encuentra el conmutador «Zonas y nodos»?
  - ¿Abre Alertas, Escenario o el croquis?
  - ¿Relaciona la alerta con un lugar del croquis?
- **Seguimiento:** «¿Qué te hizo pensar que ese lugar necesita atención?»

**T3 · Qué hacer** (límite: 3 min)
> «Sobre ese problema, ¿qué te recomienda hacer la aplicación?»

- **Éxito:** encuentra la sugerencia y dice una acción concreta que propone.
- **Observar:**
  - ¿Pasa de Alertas a IA por su cuenta?
  - ¿Lee la fecha de la sugerencia y sus limitaciones?
  - ¿Entiende que la genera una IA?
- **Seguimiento:** «¿De dónde sale esa recomendación? ¿Qué tanto le harías caso? ¿Por qué?»

**T4 · Revisada frente a cerrada** (límite: 2 min)
> «Esta alerta dice “Revisada”. ¿El problema ya se solucionó?» (Mostrar la alerta activa que ya fue revisada.)

- **Éxito:** entiende que fue vista por alguien, pero que la condición **sigue activa**.
- **Observar:** ¿confunde las dos etiquetas de estado? ¿Lee «Activa»?
- **Seguimiento:** «¿Qué crees que pasa cuando tocas “Marcar como revisada”?»

**T5 · Ausencia de alertas y «Favorable»** (límite: 2 min)
- Mostrar Alertas con el filtro **Cerradas**, o un cultivo sin alertas activas si existe, y preguntar:
  > «Si la aplicación no muestra ninguna alerta activa, ¿qué significa para tu cultivo?»
- Si la última sugerencia dice «Favorable», mostrarla y preguntar:
  > «¿Qué quiere decir “Favorable” aquí?»
- **Respuesta de riesgo (anotar textual):** «está sano», «todo está bien», «no hay que hacer nada».
- **Respuesta esperada:** «no se detectó nada fuera de los límites» o «con los datos que tiene…».

**T6 · Ubicar un punto en el visor 3D** (límite: 3 min)
> (Abrir Escenario.) «Busca en el dibujo el punto que mostraste antes y mira qué datos envía.»

- **Éxito:** toca el nodo correcto y abre su detalle.
- **Observar:**
  - ¿Intenta desplazar la página con el dedo sobre el visor y queda atrapado?
  - ¿Gira o acerca sin querer?
  - ¿Lee las etiquetas o se tapan entre sí?
  - ¿Entiende los colores?
  - ¿Le distraen los controles de clima simulado o de dispositivo?
- **Seguimiento:** «¿Te sirve este dibujo en 3D o el croquis plano de Inicio? ¿Por qué?» Si no vio el croquis 2D, mostrárselo.

**T7 · Historial de un punto** (límite: 3 min)
> «Muéstrame cómo estuvo la temperatura de ese punto hoy.»

- **Éxito:** consigue una gráfica o tabla de ese nodo en las últimas 24 horas.
- **Observar:**
  - ¿Encuentra Historial?
  - ¿Entiende que debe elegir nodo, variable y período y pulsar Consultar?
  - ¿Lee la gráfica?

---

### 5.4 Sondeo de vocabulario (3 min)
Señalar cada palabra en la pantalla y preguntar **«¿Qué significa esto para ti?»**. Anotar la respuesta textual.

| Palabra | Dónde está | Significado correcto (para el moderador) |
|---|---|---|
| Nodo | En casi todas las pantallas | Aparato que mide en un punto del lote |
| Sector / Zona | Croquis | Parte del lote |
| Simulada / Simulado | Etiquetas de valores | Dato generado para pruebas, no medido por un sensor |
| Iluminación relativa · % relativo | Tarjeta de luz | Cuánta luz recibe el sensor en comparación con sus extremos; no es una medida en lux |
| Revisada | Alertas | Alguien ya la vio |
| Cerrada | Alertas | La condición terminó |
| IA | Navegación | Sugerencias generadas por un programa de inteligencia artificial |
| Escenario | Navegación | (Anotar qué espera encontrar ahí) |

### 5.5 Comparación con los wireframes (5 min)
Usar las hojas impresas. La pantalla **A** es el Inicio de hoy y la **B** el Inicio propuesto, dibujadas con el mismo nivel de detalle y los mismos datos de ejemplo para que la comparación sea justa. Llamarlas siempre «pantalla A» y «pantalla B», nunca «actual» o «nueva».

**Orden:** P1, P3 y P5 empiezan con A; P2 y P4 empiezan con B.

1. Mostrar la primera pantalla **sola** (doblar la hoja o tapar la otra) y preguntar: «En esta pantalla, ¿dónde hay un problema?». Cronometrar. Repetir con la otra pantalla.
2. Con B: «Toca dónde verías los datos de ese punto». Si toca bien, mostrar C (detalle del punto).
3. Poner A y B juntas: «¿Cuál de las dos preferirías ver cada mañana? ¿Por qué?».
4. Mostrar E (detalle de alerta) y preguntar: «¿Qué harías después de ver esto?».
5. Opcional, si hay tiempo: mostrar D (lista de alertas) y preguntar: «¿Qué diferencia hay entre estas dos alertas?».

Las respuestas esperadas están en la hoja 5.

> La preferencia declarada vale menos que lo observado en las tareas. Si alguien prefiere una pantalla pero falla en ella, gana lo observado.

### 5.6 Cierre (2 min)
1. «¿Qué fue lo más difícil o confuso?»
2. «Si pudieras cambiar una sola cosa, ¿cuál sería?»
3. «¿Usarías algo así en tu cultivo? ¿Qué le falta?»

Agradecer. No explicar cómo «debía» hacerse una tarea hasta terminar todo; luego sí se puede mostrar.

## 6. Reglas para quien modera

- **Leer las tareas tal cual.** No decir «toca Alertas» ni «abre Escenario».
- **Respuestas neutrales:** «¿Qué esperabas que pasara?», «¿Qué buscas ahora?», «Cuéntame qué piensas». Evitar «¿verdad que es fácil?».
- **No corregir** durante las tareas. Si la persona se equivoca, observar y anotar.
- **Rescatar** solo al llegar al tiempo límite o ante frustración visible: «Gracias, pasemos a la siguiente». Anotar «sin completar».
- **Separar roles** si hay dos personas del equipo: una modera y otra anota (y cronometra).
- Si la aplicación falla (error de red, servicio caído), anotarlo como **fallo técnico**, no como fallo del participante, y repetir la tarea si se recupera.

## 7. Cómo resumir los resultados

Al terminar todas las sesiones:

1. **Tabla por tarea:** éxito / con ayuda / sin completar, tiempo y facilidad 1–5 para cada participante.
2. **Lista de problemas observados.** Cada uno con:
   - la tarea donde apareció;
   - cuántos participantes lo tuvieron (por ejemplo 3/5);
   - una cita textual;
   - una gravedad: **Alta** (impide completar la tarea o produce una interpretación peligrosa), **Media** (retrasa o necesita ayuda) o **Baja** (molestia).
3. **Vocabulario:** qué palabras entendió cada persona.
4. **Decisión** con las reglas de la sección 8.
5. Registrar el resumen en `docs/estado.md` y guardar el informe en `docs/validacion/`, sin nombres ni grabaciones.

## 8. Reglas de decisión

Son orientativas: con 3–5 personas, un patrón repetido pesa más que un caso aislado.

| Si se observa… | Entonces… |
|---|---|
| 2 o más fallan T1 o no ven la antigüedad del dato | Hacer E1 y E2 primero (navegación, resumen de atención e indicador de frescura) |
| 2 o más no encuentran el problema en T2 | Priorizar el resumen de atención y la lista por sector de E2, antes que el 3D |
| En T6 el visor 3D atrapa el desplazamiento o confunde a 2 o más, **y** el croquis 2D funciona mejor | E3 empieza con el modo estático y la vista 2D por defecto; el 3D queda como «Explorar» |
| El 3D ayuda claramente a ubicar el problema | Seguir con E3 tal como está propuesto |
| 2 o más no llegan de la alerta a la sugerencia (T3) | Adelantar E4 (detalle de alerta con sugerencia relacionada) |
| **Una sola persona** lee «sin alertas» o «Favorable» como «sano» (T5) | Cambiar esos textos en E1, sin esperar a E4. Es una interpretación de riesgo |
| 2 o más confunden «revisada» con «cerrada» (T4) | Renombrar y separar visualmente los dos estados en E4 |
| Una palabra la entienden menos de la mitad | Cambiarla o añadir una explicación breve en E1 |
| T7 se resuelve sin problemas | Historial no necesita cambios urgentes |

## 9. Límites de esta prueba

- Pocas personas: muestra problemas, no porcentajes.
- Si participan representantes en lugar de agricultores, los resultados de vocabulario y confianza son menos fiables.
- Los datos son sobre todo simulados y el escenario está preparado. No reproduce una jornada real en campo.
- Se hace bajo techo: no prueba la lectura con sol directo ni con mala señal. Si es posible, repetir T1 al aire libre con al menos una persona.
- Los wireframes en papel no prueban gestos ni rendimiento; eso se valida después de E3.

---

## Anexo A · Hoja de registro (una por participante)

**Participante:** P__ · **Fecha:** ____ · **Modera:** ____ · **Anota:** ____
**Perfil:** ☐ Agricultor/a ☐ Representante · **Uso del teléfono:** ☐ Bajo ☐ Medio ☐ Alto
**Teléfono usado:** ____ · **Grabación aceptada:** ☐ Sí ☐ No
**Estado preparado:** ☐ Alerta activa sin revisar ☐ Alerta activa revisada ☐ Nodo sin recibir (☐ A real ☐ B pausa) ☐ Sugerencia reciente

| Tarea | Resultado | Tiempo | Facilidad 1–5 | Observaciones y citas |
|---|---|---|---|---|
| T1 Condiciones actuales | ☐ Éxito ☐ Con ayuda ☐ Sin completar | | | |
| T2 Dónde hay un problema | ☐ Éxito ☐ Con ayuda ☐ Sin completar | | | |
| T3 Qué hacer | ☐ Éxito ☐ Con ayuda ☐ Sin completar | | | |
| T4 Revisada vs. cerrada | ☐ Entiende ☐ Confunde | | | |
| T5 Sin alertas / Favorable | ☐ Correcta ☐ «Sano» (riesgo) | | | |
| T6 Visor 3D | ☐ Éxito ☐ Con ayuda ☐ Sin completar | | | ☐ Quedó atrapado al desplazar ☐ Giró sin querer ☐ Etiquetas tapadas |
| T7 Historial | ☐ Éxito ☐ Con ayuda ☐ Sin completar | | | |

**Vocabulario** (✓ entiende · ~ a medias · ✗ no entiende, con su respuesta textual):
Nodo __ · Sector/Zona __ · Simulado __ · % relativo __ · Revisada __ · Cerrada __ · IA __ · Escenario __

**Pantallas impresas:** empezó por ☐ A ☐ B · problema encontrado en A ☐ Ninguno ☐ Uno ☐ Los dos (tiempo ____) · en B ☐ Ninguno ☐ Uno ☐ Los dos (tiempo ____) · Prefiere ☐ A ☐ B · Motivo: ____

**Cierre:** lo más difícil: ____ · cambiaría: ____

**Fallos técnicos durante la sesión:** ____

---

### Nota sobre las pantallas impresas
[wireframes-e0.html](wireframes-e0.html) contiene las pantallas A–E y la clave. La pantalla A reproduce el Inicio de la rama `juan/integracion-camilo` (commit 77d8661), dibujado desde el código y no desde una captura, para que tenga el mismo nivel de detalle que B. Si la web cambia antes de las sesiones, hay que revisar A. Los datos son de ejemplo y no corresponden a mediciones reales.
