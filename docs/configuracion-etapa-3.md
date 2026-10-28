# Configuración desde cero: etapa 3

Decisión de Juan, 25 de octubre de 2026: preparar nosotros los servicios ante la disponibilidad limitada del equipo. Se conserva la arquitectura acordada. Primer objetivo: guardar una captura nueva del DHT22 y mostrarla posteriormente en la web con sesión de usuario.

## Distribución para la demostración

- Mosquitto: instalación existente en Windows, puerto 18883 y usuarios/ACL actuales.
- n8n: local en el mismo computador. Si se ejecuta directamente en Windows podrá acceder al listener `127.0.0.1:18883`. Método y versión de instalación pendientes.
- Supabase: proyecto de desarrollo en línea con la cuenta de Juan; requiere Internet.
- React: siguiente etapa, con Supabase Auth y permisos por cuenta.

El computador debe permanecer encendido durante la demostración. Este recorrido no requiere exponer Mosquitto a Internet. No se presupone recuperación de mensajes publicados mientras n8n está apagado.

## 1. Crear el proyecto Supabase

1. Abrir [Supabase Dashboard](https://supabase.com/dashboard) e iniciar sesión con la cuenta de Juan.
2. Crear o seleccionar una organización personal. Elegir la opción gratuita si está disponible para la cuenta; no contratar un plan de pago para este paso.
3. Seleccionar New project y nombrarlo `AgroVigia-dev`.
4. Generar una contraseña de base de datos y conservarla en un gestor de contraseñas. No enviarla al chat ni guardarla en Git.
5. Elegir una región cercana a Colombia entre las disponibles y comprobar la selección de plan antes de crear.
6. Esperar a que termine la preparación y comprobar que abren Table Editor y SQL Editor. No ejecutar todavía el SQL de `docs/referencias`: es una propuesta pendiente de verificar.

Resultado: proyecto de desarrollo accesible y vacío de tablas propias de AgroVigía. Basta comunicar que quedó listo y la región elegida; no se necesitan claves en el chat para este paso.

## 2. Preparar y verificar persistencia

Escribir migraciones revisadas y una RPC para el lote completo según [supabase/README.md](../supabase/README.md). Preparar cuenta de prueba, cultivo, nodo DHT22 y capacidades. Probar permisos con dos cuentas. Una captura DHT22 crea dos filas atómicas; un duplicado no crea filas y un conflicto no reescribe datos. El SQL de referencia aún no se verificó en PostgreSQL.

La clave de servidor pertenece a las credenciales de n8n; el navegador utilizará la clave pública y su sesión. No incluir claves privilegiadas en firmware, web o exportaciones.

## 3. Preparar n8n local

Seleccionar y registrar una versión compatible y un método soportado. Se encontraron Node v24.16.0 y npm 12.1.0, pero no n8n ni Docker en PATH. La documentación oficial consultada admite Node 20.19–24.x para npm y anuncia que esa vía se depreca desde n8n 3.0. Contrastar la versión disponible antes de fijar la instalación; no se instalaron herramientas durante esta preparación.

Importar como flujo nuevo [03a-inspeccion-mqtt.json](../n8n/03a-inspeccion-mqtt.json), probar la ruta manual y después MQTT con el usuario receptor. Ver [n8n/README.md](../n8n/README.md) para las opciones y la limitación de metadata. Resolver recibida_en y política de retain explícitamente antes de conectar la RPC. Todavía no se importó ni ejecutó el flujo en n8n.

## 4. Comprobar el recorrido

1. Mantener Mosquitto y n8n funcionando y publicar un ejemplo simulado nuevo.
2. Verificar dos filas con mismo mensaje_id, origen simulado, unidades y fechas conservadas.
3. Recibir una captura nueva real y comparar UUID entre monitor serie y filas guardadas.
4. Comprobar rechazo de un lote inválido, duplicado sin filas nuevas y conflicto sin reescritura.
5. Registrar lo observado en estado.md y avanzar a la pantalla React.

Las pruebas locales actuales se ejecutan desde la raíz:

```powershell
node --test n8n/validar-telemetria.test.cjs
```

Son 50 pruebas del código y contrato; no comprueban servicios aún sin configurar.

## Pendientes

Fecha de presentación, método/versión n8n, metadata de entrada, esquema/RPC, RLS y recuperación ante fallos. Después se incorporarán LDR, históricos, alertas y Gemini dentro del alcance acordado.

Fuentes: [crear proyecto Supabase](https://supabase.com/docs/guides/getting-started/quickstarts/reactjs), [requisitos e instalación n8n](https://docs.n8n.io/hosting/installation/npm/). Consulta: 25 de octubre de 2026. Las tablas públicas del tutorial Supabase no constituyen la política de permisos de AgroVigía.
