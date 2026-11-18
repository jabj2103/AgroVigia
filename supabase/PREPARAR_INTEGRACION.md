## Respaldo y actualización de AgroVigía

La actualización del 17 de noviembre de 2026 quedó aplicada en el proyecto `vzylofqutecvfcbmcjac`. El historial remoto contiene `0001` a `0012`, con las versiones exactas del repositorio. La auditoría previa hizo coincidir 271 objetos del esquema anterior con la instalación de referencia. El respaldo real quedó en `.local/respaldos/supabase-20261117-182352-947/`; se verificaron las tres huellas SHA-256 de su resumen.

Después de aplicar las cuatro ampliaciones, coincidieron las huellas de las 394 mediciones, los vínculos, la auditoría de asignaciones, la regla y los episodios de alerta. Se conservaron las dos cuentas. Hay 21 tablas públicas con RLS. En pruebas SQL con rol de usuario, el propietario vio sus cinco nodos y 394 mediciones; la segunda cuenta vio cero registros ajenos. Las seis plantillas son visibles para ambas cuentas. La comprobación de la sesión web con JWT real queda para la etapa de integración.

Los dos verificadores pasaron sus 46 indicadores de esquema y permisos. `tres_hexagonos_de_seis` y `hexagono_del_fisico` quedan en `false` hasta decidir el aprovisionamiento de demostración. Los avisos de seguridad describen las RPC autorizadas con `SECURITY DEFINER`, las tablas internas con RLS sin políticas de cliente y la protección de contraseñas filtradas desactivada. [Referencia del aviso sobre RPC](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) · [Protección de contraseñas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)

El procedimiento que sigue documenta una instalación que todavía tenga únicamente `0001` a `0008`. Para el proyecto actual, la consulta del historial debe mostrar las doce versiones antes de considerar cualquier aplicación de SQL.

1. Abre Docker Desktop. En el proyecto AgroVigía de Supabase, entra en **Connect → Session pooler** y copia el valor **Host**. Ejecuta el respaldo desde la raíz del proyecto en VS Code.

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\herramientas\respaldar-supabase.ps1
   ```

   El guion pide el Host y la contraseña de la base en la terminal. Usa Supabase CLI 3.2.0 para exportar roles, esquema y datos a una carpeta privada bajo `.local/respaldos/`. La línea `RESPALDO LISTO` confirma que existen los tres archivos y que el volcado contiene las mediciones y las cuentas. `resumen.json` guarda conteos y huellas SHA-256. Se comprobó la generación de ese resumen con un volcado ficticio. Mantén privados los archivos SQL por sus datos de cuentas. Para una restauración, usa el procedimiento documentado por Supabase y prueba primero en una base separada.

2. Con el respaldo disponible, usar `supabase migration repair --status applied` para registrar las ocho versiones que ya existen. Los identificadores son `202610260001`, `202610260002`, `202610260003`, `202610270004`, `202610270005`, `202610270006`, `202611030007` y `202611030008`. Esta operación actualiza el historial sin volver a ejecutar esos archivos.
3. En el mismo proyecto remoto, comprobar que `migration list` muestra las ocho versiones alineadas y que `db push --dry-run` anuncia únicamente `202611030009` a `202611030012`. Aplicar en ese orden con `db push` y guardar el resultado de `migration list`.
4. Comprobar `verificar-ia-hexagonos.sql` y `verificar-terreno-nodos.sql`. `tres_hexagonos_de_seis` y `hexagono_del_fisico` describen el aprovisionamiento de demostración y pueden quedar en `false` hasta que se decida cargarlo. La prueba local de migración conservó 13 mediciones ficticias, sus asignaciones y la detección de duplicados. En la nube, comprobar también los conteos anteriores, la actividad del nodo físico y los permisos de las nuevas RPC.

`provisionar-hexagonos.sql` es un paso independiente. Puede asociar la plantilla de Plátano al cultivo del ESP32. Conviene confirmar la especie y la configuración de la demostración antes de ejecutarlo.

[Guía oficial de respaldo y restauración](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) · [Migración a la CLI v3](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3)
