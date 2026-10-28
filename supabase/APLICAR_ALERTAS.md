# Etapa 1 de alertas: backend Supabase

Requiere las migraciones0001..0005 aplicadas. Esta etapa prepara tablas y funciones. No crea reglas permanentes ni cambia la ingesta, firmware, n8n o React. Los limites de demostracion solo se utilizan dentro de la prueba que se revierte. No son recomendaciones agronomicas.

## Pasos para Juan

1. Mantener ESP32, Mosquitto, n8n y la web como estan.
2. Supabase > SQL Editor > nueva consulta, rol postgres. Copiar TODO supabase/migrations/202610270006_alertas.sql y ejecutar UNA vez. Esperado Success. No rows returned. No repetir migraciones anteriores.
3. En otra consulta copiar y ejecutar TODO supabase/probar-alertas.sql, incluidos BEGIN y ROLLBACK. Esperado una fila OK que termina Prueba revertida. Usa un cultivo/nodo ficticios y mediciones SIMULADAS temporales; no toca el nodo ni el cultivo reales. Crea tambien una regla de origen real temporal para comprobar que no se mezcla con las simuladas, sin crear mediciones reales. No ejecutar solo SELECT final: su resumen depende de que todo el script termine sin errores. Si falla antes de ROLLBACK, ejecutar ROLLBACK en la misma sesion y conservar el error antes de continuar.
4. En otra consulta ejecutar TODO supabase/verificar-alertas.sql. Esperado true,true,true,false,false.
5. Revisar que las mediciones del cultivo real siguen actualizandose en web. No se esperan alertas nuevas ni cambios de pantalla en esta etapa.
6. Compartir los resultados de3y4. Despues conectar n8n y construir configuracion/pantalla de alertas; aun no modificar el flujo receptor.

Si aparece error de tabla/funcion existente no repetir a ciegas: verificar si ya se aplico. No introducir valores para el cultivo real como parte de la prueba.

## Contrato de reglas

configurar_regla_alerta(p_cultivo_id,p_variable_codigo,p_minimo,p_maximo,p_origen default real): solo propietario de cultivo activo. Variables temperatura_aire, humedad_aire e iluminacion_relativa. Uno o ambos limites; cuatro decimales maximo, dentro del rango fisico/catalogo existente. Minimo menor que maximo cuando se usan ambos. Limites incluidos: igual al minimo/maximo esta dentro. Solo valores estrictamente inferiores/superiores abren alerta. Un origen real y otro simulado se gestionan por separado.

Repetir configuracion identica conserva la regla y los episodios. Cambiar limites conserva una version historica: desactiva regla vieja y cierra sus episodios por regla_desactivada; no afirma recuperacion ambiental. Nueva regla solo usa mediciones recibidas desde su creacion, no reevalua todo el historial. desactivar_regla_alerta es idempotente, cierra episodios administrativamente. No hay limites activados por defecto.

## Episodios y evaluacion

evaluar_alertas_lote(p_nodo_id,p_mensaje_id) solo service_role/n8n: lee mediciones ya persistidas, resuelve cultivo y reglas en servidor. No acepta valores, umbrales o propietario del navegador. No modifica mediciones. Nodo debe seguir habilitado y vinculado a cultivo activo. No mezcla nodos, cultivos, variables ni origenes. FK compuestas conservan evidencia inicial/ultima/cierre y unidad por catalogo; umbral/valor inicial se conservan en el episodio.

Primera lectura fuera de rango abre episodio. Las siguientes del mismo extremo actualizan valor/medicion ultima. Una lectura nueva dentro de rango cierra por dentro_de_rango. Pasar directamente de extremo alto a bajo cierra por cambio_de_limite y abre episodio del otro extremo. Volver a exceder despues de cierre crea episodio nuevo. Indice unico impide dos episodios abiertos de la misma regla/nodo/origen.

Cursor por regla/nodo/origen ignora duplicados y capturas de fecha igual o anterior a la ya evaluada. Reintentar no renueva fechas ni revision. Si dos UUID diferentes tienen la misma fecha de captura, solo el primero evaluado participa; no hay orden fisico conocido para muestras simultaneas. Datos con captura o recepcion de mas de180s se omiten; reloj futuro tolerado hasta120s, igual que el contrato de ingesta. No se cierra una alerta por ausencia de mensajes ni por una lectura antigua; una alerta abierta con evidencia vieja no confirma que la condicion siga ocurriendo ahora. La pantalla futura mostrara antiguedad.

revisar_alerta(p_alerta_id) solo propietario: guarda fecha/usuario la primera vez, sin cerrar condicion ni reiniciar la revision al actualizarse el mismo episodio. Revision y cierre son independientes. Desvincular/deshabilitar nodo (incluido archivado que libera nodos) cierra episodios por nodo_desvinculado, sin fingir normalizacion.

## Permisos y pendientes

Tablas reglas_alerta/alertas con SELECT propio RLS; sin escritura directa para navegador ni service_role. alerta_cursores privada, usada desde funciones. Usuario autenticado configura/desactiva/revisa; anon no accede; solo servidor evalua. Funciones definer con search_path vacio. Operaciones de regla/evaluacion bloquean cultivo y regla, e indice unico protege duplicados; no hay prueba de concurrencia de sesiones distintas en esta etapa.

Diez pruebas SQL locales con PostgreSQL embebido aprobadas: episodios, revision independiente, duplicados, nuevo episodio, cambio de extremo, orden, frescura/futuro, versiones, RLS, origenes, desvinculacion y rollback; regresion de ingesta y nodos. No acreditan JWT/API remoto ni hardware adicional. No se ejecutaron escrituras remotas desde Codex.

Siguiente etapa: n8n llamara al evaluador despues de persistencia confirmada, con manejo de error/reintento sin convertir un fallo de alertas en fallo aparente de guardado. Falta politica de recuperacion de evaluaciones no confirmadas; no prometer entrega exactamente una vez. Despues React configurara limites y listara episodios reales activos/cerrados y revisados/no revisados. No hay WhatsApp/email ni sugerencias IA en esta etapa.
