# Conectar n8n y la simulación en Windows

Usa el proyecto Supabase de AgroVigía con las migraciones `0001` a `0012` y la cuenta local de n8n que Juan ya creó. La configuración actualiza los receptores `03e` y `03f` conservando sus identificadores y añade los flujos HTTP `03g`, solicitudes de IA `03h` y nodos físicos por HTTPS `03i`.

La configuración de Juan se comprobó el 17 de noviembre de 2026. Un ciclo del servicio automático guardó 40 mediciones de cuatro nodos virtuales y n8n almacenó una sugerencia generada por Gemini de origen simulado. Para mantener las actualizaciones, sigue el arranque del punto 3.

1. Obtén la **Secret key** que empieza por `sb_secret_` en Supabase, **Settings → API Keys**. Obtén también una **API key de Gemini** en [Google AI Studio](https://aistudio.google.com/apikey).
2. Si n8n está abierto, detenlo con `Ctrl+C` en su terminal. Desde la raíz de AgroVigía, ejecuta la configuración.

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\n8n\configurar-windows.ps1
   ```

   Introduce las claves en los avisos de la terminal. Quedan en `.local/secretos.env`, excluido de Git. El modelo predeterminado es `gemini-3.5-flash-lite`; se puede cambiar con `-Modelo`. Para corregir claves, repite con `-RenovarClaves`.

   El guion comprueba acceso de servidor a Supabase y consulta la disponibilidad del modelo de Gemini. Después respalda la base SQLite y su clave de cifrado en `.local/respaldos/n8n-...`, prepara la configuración MQTT para `127.0.0.1:18883`, importa credenciales mediante la CLI oficial de n8n 2.44.7 y publica los cinco flujos. El archivo temporal de credenciales de importación se elimina al terminar. La salida final esperada es `CONFIGURACION LISTA`.

3. Ejecuta cada servicio en una terminal independiente y mantenla abierta.

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\mqtt\agrovigia.ps1 IniciarRed
   ```

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\n8n\iniciar-local.ps1
   ```

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\simulador\iniciar-servicio.ps1
   ```

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\web\iniciar-local.ps1
   ```

   El servicio automático consulta los cultivos y sus parámetros en Supabase y envía los datos simulados por MQTT. Para una única vuelta, usa `-UnaVez`. El panel manual de `5190` debe permanecer detenido mientras el servicio automático publique sobre los mismos nodos.

4. Abre `http://localhost:5678` y comprueba que `03e` y `03f` están publicados. El broker debe estar disponible antes de que n8n arranque. En `http://127.0.0.1:5173`, revisa las nuevas lecturas de los cuatro nodos virtuales. Solicita un análisis en la pantalla de IA y comprueba su estado y evidencias. La base ya limita las solicitudes de IA por cultivo y globalmente. La disponibilidad y cuota de Gemini dependen del proyecto al que pertenece la API key.

La especie del cultivo actual y la carga de los hexágonos de demostración se eligen desde la aplicación como una etapa independiente.

[CLI oficial de n8n](https://docs.n8n.io/hosting/cli-commands/) · [Modelos de Gemini](https://ai.google.dev/gemini-api/docs/models)
