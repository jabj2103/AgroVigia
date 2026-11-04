# Croquis del cultivo y capturas por nodo

Vista implementada en **Inicio → Zonas y nodos**, junto a **Lecturas reales**. Consulta la cuenta mediante el SDK público de Supabase y RLS; no necesita claves privadas, otro backend ni nuevas migraciones después de 0007/0008.

Juan aportó confirmación de persistencia con diez IDs y considera lista la etapa del panel. Esta pantalla se comprobó con datos ficticios: su revisión con las capturas de la cuenta queda pendiente. No se publicaron mediciones ni se modificaron flujos/base remota durante esta implementación.

## Probar con la cuenta

1. Mantener Mosquitto, n8n y el simulador en sus terminales propias. Publicado 03f para simulados; 03e puede seguir publicado para reales. El panel de escenarios continúa separado en 5190.
2. Si la web no está abierta, desde la raíz del proyecto ejecutar en otra terminal:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\web\iniciar-local.ps1
   ```

3. Abrir `http://127.0.0.1:5173`, iniciar sesión y elegir el cultivo utilizado para las cuatro zonas.
4. En **Inicio**, pulsar **Zonas y nodos**. Deben verse los cuatro sectores provisionados y sus marcadores S1–S4. Los nodos físicos todavía sin zona aparecen en la lista como **Sin ubicar**; no se inventa su posición.
5. Pulsar una zona, un marcador o un botón de la lista. También se puede seleccionar la zona y filtrar por tipo de nodo mediante los desplegables. Los botones admiten teclado con Tab y Enter/Espacio.
6. En un nodo virtual con capturas deben aparecer diez tarjetas con **Simulada**, valores/unidades, antigüedad, fechas y UUID desplegable. Si no hay captura para ese nodo, se indica explícitamente.
7. Enviar una captura nueva desde el simulador para ese nodo. Esperar hasta 30 segundos o pulsar **Actualizar zonas**. Comparar su UUID/valores con Resultado de persistencia de 03f y la consulta SQL de verificación. Una captura local sin envío no aparece aquí.
8. Seleccionar otra zona para comprobar que consulta su propio nodo. Seleccionar **Sin ubicar** y **Físicos · datos reales** para ver únicamente el perfil real del ESP32, si tiene capturas. La segunda placa solo tendrá lecturas cuando esté equipada, configurada y publicando.
9. Revisar ausencia de datos, antigüedad tras detener envíos, recuperación al enviar otra captura y una cuenta sin asignaciones. Cambiar de cultivo/cuenta debe limpiar la vista anterior. No cambiar fechas ni ampliar umbrales para disimular antigüedad.

## Significado de lo mostrado

- **R / Real**: nodo físico, lecturas de origen real. Solo DHT22 (dos variables) o DHT22+LDR (tres) según las capacidades registradas y la captura.
- **S / Simulada**: nodo virtual con diez capacidades SIMULADOR_V3. Los valores se presentan como sintéticos y no son evidencia de sensores físicos.
- Los colores/formas distinguen procedencia y selección; no resumen la salud del cultivo. Es un croquis normalizado, no un mapa GPS, una estimación de superficie ni de cobertura.
- **Datos recientes** corresponde a captura y recepción de hasta 180 segundos. **Datos desactualizados**, **Revisar reloj**, **Sin datos** y **Error de actualización** son estados separados. Una fecha de recepción no demuestra conexión actual del dispositivo.
- Una captura anterior a un cambio de zona/posición o de versión de asignación se conserva con aviso y su zona histórica. No se reasignan sus valores silenciosamente a la posición nueva. Los registros anteriores a las zonas pueden seguir figurando Sin ubicar.
- La iluminación sigue siendo relativa, no lux. En virtuales es un índice sintético; en físicos se conserva el método ADC. Radiación solar es otra variable, independiente.
- La conductividad simulada expresa ECe de extracto de pasta saturada a 25 °C. La lluvia es el acumulado móvil de los 60 minutos anteriores: no sumar capturas sucesivas.
- Se consulta un lote completo del nodo/origen seleccionado. No hay promedios entre nodos, combinación de orígenes ni mezcla de métodos. Un error conserva la última captura válida con un aviso visible y la fecha de la consulta correcta.

## Integración y límites

`zone-data.ts` carga zonas del cultivo, nodos acotados a cuenta/cultivo y capacidades de esos nodos. Para la lectura consulta primero el último mensaje de ese cultivo/nodo/origen y después todas las variables de ese mismo mensaje. `zone-domain.ts` valida geometría, propiedad, origen, perfil, diez variables únicas, fechas y trazabilidad de las simulaciones (incluidos profundidad, método ECe y ventana de lluvia).

`Zonas.tsx` cancela consultas al cambiar contexto y refresca cada 30 segundos. El croquis usa las posiciones actuales del catálogo; las fechas, zona de captura y versión se conservan desde las mediciones. No reconstruye ubicación histórica desde el nodo actual.

La vista de lecturas reales, el historial y la campana mantienen su origen real. Mis dispositivos identifica los virtuales y remite a su vista de zonas; en esta etapa su asignación se prepara con el equipo. La gestión de nodos físicos cuenta solo los físicos para el límite de dos y la creación de cultivos ofrece dispositivos físicos disponibles. Los virtuales no consumen ese cupo.

Todavía no hay editor visual de zonas/posiciones, historial/gráficas de las siete variables nuevas, envío automático de toda una secuencia del panel, reglas agronómicas preestablecidas ni IA. Las reglas/episodios de la web y la campana siguen siendo los del recorrido real implementado anteriormente. Próximos pasos después de revisar esta pantalla con Juan: ajustar interacción/presentación y ampliar reglas/perfiles con contexto/fuentes antes de las sugerencias IA.

## Comprobaciones locales

```powershell
npm.cmd --prefix web test
npm.cmd --prefix web run build
npm.cmd --prefix web run test:browser:zonas
npm.cmd --prefix web run test:browser:dispositivos
npm.cmd --prefix web run test:browser:avisos
```

37 pruebas unitarias aprobadas. QA de zonas: selección por mapa/lista/teclado, diez simuladas/tres reales, ausencia/error/antigüedad/reloj, captura de asignación anterior, cultivo vacío y cambio de cuenta, disposición 360/390/768/1280/1440px, virtuales sin acciones físicas y cuatro virtuales sin consumir el cupo físico. Capturas de prueba inspeccionadas en `.local/qa-zonas`. QA de dispositivos/avisos previas también comprobadas. Son fixtures con fetch ficticio del SDK, sin llamadas remotas; no sustituyen la validación de sesión/API/RLS con las cuentas reales.
