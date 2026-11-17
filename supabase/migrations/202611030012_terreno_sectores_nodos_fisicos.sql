-- 0012: terreno real del cultivo, sectores libres, ubicacion de nodos y nodos fisicos autogestionados
-- con clave propia para la ingesta por HTTPS. Requiere 0001..0011. No modifica mediciones.
BEGIN;

-- 1. Terreno real del cultivo, en metros. Sirve para dibujar el plano a escala: los sectores siguen
-- guardados como fracciones 0..1 del terreno.
ALTER TABLE public.cultivos ADD COLUMN ancho_m numeric(8,2), ADD COLUMN largo_m numeric(8,2);
ALTER TABLE public.cultivos ADD CONSTRAINT cultivo_terreno CHECK ((ancho_m IS NULL AND largo_m IS NULL)
  OR (ancho_m IS NOT NULL AND largo_m IS NOT NULL AND ancho_m BETWEEN 1 AND 20000 AND largo_m BETWEEN 1 AND 20000));

CREATE FUNCTION public.definir_terreno(p_cultivo_id uuid, p_ancho_m numeric, p_largo_m numeric) RETURNS public.cultivos
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.cultivos; v_ancho numeric := round(p_ancho_m, 2); v_largo numeric := round(p_largo_m, 2);
BEGIN
  SELECT * INTO c FROM public.cultivos WHERE id = p_cultivo_id AND agricultor_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CULTIVO_NO_AUTORIZADO' USING ERRCODE = '42501'; END IF;
  IF c.archivado_en IS NOT NULL THEN RAISE EXCEPTION 'CULTIVO_ARCHIVADO' USING ERRCODE = '22023'; END IF;
  IF (p_ancho_m IS NULL) <> (p_largo_m IS NULL)
     OR (p_ancho_m IS NOT NULL AND (p_ancho_m::text IN ('NaN','Infinity','-Infinity') OR p_largo_m::text IN ('NaN','Infinity','-Infinity')
         OR v_ancho < 1 OR v_ancho > 20000 OR v_largo < 1 OR v_largo > 20000)) THEN
    RAISE EXCEPTION 'TERRENO_INVALIDO' USING ERRCODE = '22023';
  END IF;
  UPDATE public.cultivos SET ancho_m = v_ancho, largo_m = v_largo WHERE id = c.id RETURNING * INTO c;
  RETURN c;
END; $$;

-- 2. Sectores libres sobre la tabla zonas (0007). Coordenadas como fraccion 0..1 del terreno: plano_x y
-- plano_y son la esquina superior izquierda. Pueden solaparse. El contrato v3 no lleva el codigo del
-- sector en el mensaje: la RPC de ingesta lo resuelve desde el nodo, asi que un sector de codigo libre
-- funciona igual que los cuatro por defecto.
-- Un sector con historial (mediciones o auditoria de asignaciones que lo nombran) no puede borrarse
-- sin romper esas referencias: queda marcado con eliminada_en y deja de ofrecerse.
ALTER TABLE public.zonas ADD COLUMN eliminada_en timestamptz;

-- Interna: valida nombre y geometria ya redondeada a cuatro decimales.
CREATE FUNCTION public.validar_sector(p_nombre text, p_x numeric, p_y numeric, p_ancho numeric, p_alto numeric) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF p_nombre IS NULL OR length(btrim(p_nombre)) NOT BETWEEN 1 AND 60
     OR p_x IS NULL OR p_y IS NULL OR p_ancho IS NULL OR p_alto IS NULL
     OR p_x::text IN ('NaN','Infinity','-Infinity') OR p_y::text IN ('NaN','Infinity','-Infinity')
     OR p_ancho::text IN ('NaN','Infinity','-Infinity') OR p_alto::text IN ('NaN','Infinity','-Infinity')
     OR p_x < 0 OR p_y < 0 OR p_ancho < 0.02 OR p_alto < 0.02 OR p_x + p_ancho > 1 OR p_y + p_alto > 1 THEN
    RAISE EXCEPTION 'SECTOR_INVALIDO' USING ERRCODE = '22023';
  END IF;
END; $$;

CREATE FUNCTION public.crear_sector(p_cultivo_id uuid, p_nombre text, p_x numeric, p_y numeric, p_ancho numeric, p_alto numeric)
RETURNS public.zonas LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.cultivos; z public.zonas; cod text;
BEGIN
  SELECT * INTO c FROM public.cultivos WHERE id = p_cultivo_id AND agricultor_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CULTIVO_NO_AUTORIZADO' USING ERRCODE = '42501'; END IF;
  IF c.archivado_en IS NOT NULL THEN RAISE EXCEPTION 'CULTIVO_ARCHIVADO' USING ERRCODE = '22023'; END IF;
  PERFORM public.validar_sector(p_nombre, round(p_x, 4), round(p_y, 4), round(p_ancho, 4), round(p_alto, 4));
  IF (SELECT count(*) FROM public.zonas WHERE cultivo_id = c.id AND eliminada_en IS NULL) >= 24 THEN
    RAISE EXCEPTION 'LIMITE_SECTORES' USING ERRCODE = '22023';
  END IF;
  -- Primer codigo sector-NN libre. Un sector retirado con historial conserva el suyo.
  SELECT 'sector-' || lpad(i::text, 2, '0') INTO cod FROM generate_series(1, 99) i
   WHERE NOT EXISTS (SELECT 1 FROM public.zonas x WHERE x.cultivo_id = c.id AND x.codigo = 'sector-' || lpad(i::text, 2, '0'))
   ORDER BY i LIMIT 1;
  IF cod IS NULL THEN RAISE EXCEPTION 'LIMITE_SECTORES' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.zonas (cultivo_id, codigo, nombre, plano_x, plano_y, plano_ancho, plano_alto)
  VALUES (c.id, cod, btrim(p_nombre), round(p_x, 4), round(p_y, 4), round(p_ancho, 4), round(p_alto, 4)) RETURNING * INTO z;
  RETURN z;
END; $$;

-- Sirve tambien para los cuatro sectores por defecto. Los nodos guardan su posicion relativa al sector
-- (0..1), asi que al cambiar la geometria se mueven con el.
CREATE FUNCTION public.editar_sector(p_zona_id uuid, p_nombre text, p_x numeric, p_y numeric, p_ancho numeric, p_alto numeric)
RETURNS public.zonas LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.cultivos; z public.zonas;
BEGIN
  SELECT ct.* INTO c FROM public.cultivos ct JOIN public.zonas zz ON zz.cultivo_id = ct.id
   WHERE zz.id = p_zona_id AND zz.eliminada_en IS NULL AND ct.agricultor_id = auth.uid() FOR UPDATE OF ct;
  IF NOT FOUND THEN RAISE EXCEPTION 'ZONA_NO_AUTORIZADA' USING ERRCODE = '42501'; END IF;
  IF c.archivado_en IS NOT NULL THEN RAISE EXCEPTION 'CULTIVO_ARCHIVADO' USING ERRCODE = '22023'; END IF;
  PERFORM public.validar_sector(p_nombre, round(p_x, 4), round(p_y, 4), round(p_ancho, 4), round(p_alto, 4));
  UPDATE public.zonas SET nombre = btrim(p_nombre), plano_x = round(p_x, 4), plano_y = round(p_y, 4),
    plano_ancho = round(p_ancho, 4), plano_alto = round(p_alto, 4), actualizada_en = clock_timestamp()
   WHERE id = p_zona_id RETURNING * INTO z;
  RETURN z;
END; $$;

-- Sin nodos dentro. Si ninguna medicion ni entrada de auditoria nombra al sector, se borra ('borrado').
-- Si tiene historial se conserva la fila para no romperlo y queda marcada ('retirado'): ya no admite
-- nodos, no se puede editar y no cuenta para el limite.
CREATE FUNCTION public.eliminar_sector(p_zona_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.cultivos; modo text;
BEGIN
  SELECT ct.* INTO c FROM public.cultivos ct JOIN public.zonas zz ON zz.cultivo_id = ct.id
   WHERE zz.id = p_zona_id AND zz.eliminada_en IS NULL AND ct.agricultor_id = auth.uid() FOR UPDATE OF ct;
  IF NOT FOUND THEN RAISE EXCEPTION 'ZONA_NO_AUTORIZADA' USING ERRCODE = '42501'; END IF;
  IF c.archivado_en IS NOT NULL THEN RAISE EXCEPTION 'CULTIVO_ARCHIVADO' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.nodos WHERE zona_id = p_zona_id) THEN RAISE EXCEPTION 'SECTOR_CON_NODOS' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.mediciones WHERE zona_id = p_zona_id)
     OR EXISTS (SELECT 1 FROM public.nodo_asignaciones WHERE zona_anterior_id = p_zona_id OR zona_nueva_id = p_zona_id) THEN
    UPDATE public.zonas SET eliminada_en = clock_timestamp() WHERE id = p_zona_id;
    modo := 'retirado';
  ELSE
    DELETE FROM public.zonas WHERE id = p_zona_id;
    modo := 'borrado';
  END IF;
  RETURN jsonb_build_object('codigo', 'SECTOR_ELIMINADO', 'zona_id', p_zona_id, 'modo', modo);
END; $$;

-- Un nodo no entra en un sector retirado, lo ubique quien lo ubique.
CREATE FUNCTION public.exigir_zona_activa() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.zona_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.zona_id IS DISTINCT FROM OLD.zona_id)
     AND EXISTS (SELECT 1 FROM public.zonas z WHERE z.id = NEW.zona_id AND z.eliminada_en IS NOT NULL) THEN
    RAISE EXCEPTION 'ZONA_NO_AUTORIZADA' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER c_zona_activa BEFORE INSERT OR UPDATE OF zona_id, cultivo_id ON public.nodos
FOR EACH ROW EXECUTE FUNCTION public.exigir_zona_activa();

-- Las dos auxiliares de la 0011 dejan de contar los sectores retirados. Si a un cultivo no le queda
-- ningun sector activo, vuelven los cuatro por defecto (reactivando los que estuvieran retirados).
CREATE OR REPLACE FUNCTION public.asegurar_sectores_cultivo(p_cultivo_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.zonas WHERE cultivo_id = p_cultivo_id AND eliminada_en IS NULL) THEN RETURN; END IF;
  INSERT INTO public.zonas (cultivo_id, codigo, nombre, plano_x, plano_y, plano_ancho, plano_alto)
  SELECT p_cultivo_id, s.codigo, s.nombre, CASE WHEN s.i IN (1, 3) THEN 0.05 ELSE 0.525 END,
         CASE WHEN s.i <= 2 THEN 0.05 ELSE 0.525 END, 0.425, 0.425
    FROM (VALUES (1, 'zona-norte', 'Sector norte'), (2, 'zona-sur', 'Sector sur'),
                 (3, 'zona-central', 'Sector central'), (4, 'zona-drenaje', 'Sector de drenaje')) s(i, codigo, nombre)
  ON CONFLICT (cultivo_id, codigo) DO UPDATE SET eliminada_en = NULL, actualizada_en = clock_timestamp();
END; $$;
CREATE OR REPLACE FUNCTION public.elegir_sector_nodo(p_cultivo_id uuid, p_zona_id uuid, p_nodo_id uuid) RETURNS uuid
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT z.id FROM public.zonas z
   WHERE z.cultivo_id = p_cultivo_id AND z.eliminada_en IS NULL AND (p_zona_id IS NULL OR z.id = p_zona_id)
   ORDER BY (SELECT count(*) FROM public.nodos x WHERE x.zona_id = z.id AND x.id IS DISTINCT FROM p_nodo_id), z.codigo LIMIT 1;
$$;

-- Ubica un nodo propio, fisico o virtual, en un sector de su cultivo y en una posicion relativa (0..1).
-- Es asignar_zona_nodo (0007) con sector obligatorio y la posicion redondeada a cuatro decimales.
CREATE FUNCTION public.ubicar_nodo(p_nodo_id uuid, p_zona_id uuid, p_x numeric, p_y numeric) RETURNS public.nodos
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_zona_id IS NULL THEN RAISE EXCEPTION 'ZONA_NO_AUTORIZADA' USING ERRCODE = '42501'; END IF;
  RETURN public.asignar_zona_nodo(p_nodo_id, p_zona_id, round(p_x, 4), round(p_y, 4));
END; $$;

-- 3. Nodos fisicos autogestionados. El agricultor registra sus propias placas. Cada nodo registrado
-- recibe una clave que solo se muestra una vez: en la base queda unicamente su hash sha256.
-- El codigo cumple el patron del contrato v2 (agv-<letras y digitos>-<dos digitos>).
CREATE TABLE public.nodo_claves (
  nodo_id uuid PRIMARY KEY REFERENCES public.nodos(id) ON DELETE CASCADE,
  clave_hash text NOT NULL CHECK (clave_hash ~ '^[0-9a-f]{64}$'),
  creada_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  ultimo_uso_en timestamptz,
  intentos_fallidos integer NOT NULL DEFAULT 0 CHECK (intentos_fallidos >= 0),
  ultimo_fallo_en timestamptz
);
-- Sin politicas y sin permisos: ningun cliente, tampoco la clave de servidor, lee o escribe esta tabla.
ALTER TABLE public.nodo_claves ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nodo_claves FROM PUBLIC, anon, authenticated, service_role;

-- Un equipo que entra por HTTPS con su clave no usa MQTT: se agrega ese protocolo al catalogo.
UPDATE public.tipos_dispositivo SET protocolos = protocolos || ARRAY['https_wifi']
 WHERE codigo IN ('esp32', 'raspberry_pi') AND NOT ('https_wifi' = ANY (protocolos));

-- Interna: genera una clave de 32 bytes en base64url y guarda (o sustituye) solo su hash.
CREATE FUNCTION public.emitir_clave_nodo(p_nodo_id uuid) RETURNS text
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE clave text := rtrim(translate(encode(sha256(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid())
    || uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid())), 'base64'), '+/', '-_'), '=');
BEGIN
  INSERT INTO public.nodo_claves (nodo_id, clave_hash) VALUES (p_nodo_id, encode(sha256(convert_to(clave, 'UTF8')), 'hex'))
  ON CONFLICT (nodo_id) DO UPDATE SET clave_hash = EXCLUDED.clave_hash, creada_en = clock_timestamp(),
    ultimo_uso_en = NULL, intentos_fallidos = 0, ultimo_fallo_en = NULL;
  RETURN clave;
END; $$;

CREATE FUNCTION public.registrar_nodo_fisico(p_tipo_dispositivo text, p_sensores text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE usuario uuid := auth.uid(); t public.tipos_dispositivo; n public.nodos; cod text; corto text; intento integer := 0;
BEGIN
  PERFORM 1 FROM public.perfiles WHERE id = usuario FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERFIL_NO_AUTORIZADO' USING ERRCODE = '42501'; END IF;
  SELECT * INTO t FROM public.tipos_dispositivo WHERE codigo = p_tipo_dispositivo AND codigo <> 'virtual';
  IF NOT FOUND THEN RAISE EXCEPTION 'DISPOSITIVO_INVALIDO' USING ERRCODE = '22023'; END IF;
  IF p_sensores IS NULL OR cardinality(p_sensores) NOT BETWEEN 1 AND 2 OR array_ndims(p_sensores) <> 1
     OR array_position(p_sensores, NULL) IS NOT NULL OR NOT p_sensores <@ ARRAY['dht22', 'ldr']
     OR (SELECT count(DISTINCT x) FROM unnest(p_sensores) x) <> cardinality(p_sensores) THEN
    RAISE EXCEPTION 'SENSORES_INVALIDOS' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.nodos WHERE agricultor_id = usuario AND tipo_nodo = 'fisico' AND eliminado_en IS NULL) >= 50 THEN
    RAISE EXCEPTION 'LIMITE_NODOS_CUENTA' USING ERRCODE = '22023';
  END IF;
  corto := CASE t.codigo WHEN 'esp32' THEN 'esp' WHEN 'arduino_uno' THEN 'uno' WHEN 'raspberry_pi' THEN 'rpi' ELSE left(regexp_replace(t.codigo, '[^a-z0-9]', '', 'g'), 3) END;
  LOOP
    intento := intento + 1;
    cod := 'agv-' || corto || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4) || '-' || lpad(floor(random() * 100)::integer::text, 2, '0');
    BEGIN
      INSERT INTO public.nodos (codigo, agricultor_id, tipo_nodo, tipo_dispositivo, protocolo, intervalo_segundos)
      VALUES (cod, usuario, 'fisico', t.codigo, CASE WHEN 'https_wifi' = ANY (t.protocolos) THEN 'https_wifi' ELSE t.protocolo_defecto END, t.intervalo_defecto)
      RETURNING * INTO n;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF intento >= 20 THEN RAISE EXCEPTION 'SIN_CODIGO_DISPONIBLE' USING ERRCODE = '22023'; END IF;
    END;
  END LOOP;
  INSERT INTO public.nodo_variables (nodo_id, variable_codigo, sensor_modelo)
  SELECT n.id, v.variable, v.modelo FROM (VALUES ('dht22', 'temperatura_aire', 'DHT22'), ('dht22', 'humedad_aire', 'DHT22'),
    ('ldr', 'iluminacion_relativa', 'LDR')) v(sensor, variable, modelo) WHERE v.sensor = ANY (p_sensores);
  RETURN jsonb_build_object('codigo', 'NODO_REGISTRADO', 'nodo', to_jsonb(n), 'clave', public.emitir_clave_nodo(n.id));
END; $$;

-- La clave anterior deja de valer en el acto. Tambien sirve para dar una primera clave a un nodo fisico
-- que no tenia (por ejemplo uno aprovisionado antes, que hasta entonces solo entraba por MQTT).
CREATE FUNCTION public.regenerar_clave_nodo(p_nodo_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE usuario uuid := auth.uid(); n public.nodos;
BEGIN
  PERFORM 1 FROM public.perfiles WHERE id = usuario FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERFIL_NO_AUTORIZADO' USING ERRCODE = '42501'; END IF;
  SELECT * INTO n FROM public.nodos WHERE id = p_nodo_id AND agricultor_id = usuario FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NODO_NO_AUTORIZADO' USING ERRCODE = '42501'; END IF;
  IF n.tipo_nodo <> 'fisico' THEN RAISE EXCEPTION 'NODO_NO_FISICO' USING ERRCODE = '22023'; END IF;
  IF n.eliminado_en IS NOT NULL THEN RAISE EXCEPTION 'NODO_ELIMINADO' USING ERRCODE = '22023'; END IF;
  RETURN jsonb_build_object('codigo', 'CLAVE_REGENERADA', 'nodo_id', n.id, 'clave', public.emitir_clave_nodo(n.id));
END; $$;

-- Lo que la web puede saber de las claves de sus nodos: si existe, desde cuando y cuando se uso. Nunca el hash.
CREATE FUNCTION public.claves_nodos() RETURNS TABLE (nodo_id uuid, creada_en timestamptz, ultimo_uso_en timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT k.nodo_id, k.creada_en, k.ultimo_uso_en FROM public.nodo_claves k JOIN public.nodos n ON n.id = k.nodo_id
   WHERE n.agricultor_id = auth.uid() AND n.eliminado_en IS NULL;
$$;

-- Misma semantica que eliminar_nodo_virtual (0011): sin mediciones ni alertas se borra de verdad; con
-- historial queda retirado (suelto, deshabilitado, eliminado_en). En ambos casos se elimina su clave.
CREATE FUNCTION public.eliminar_nodo_fisico(p_nodo_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE usuario uuid := auth.uid(); n public.nodos;
BEGIN
  PERFORM 1 FROM public.perfiles WHERE id = usuario FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERFIL_NO_AUTORIZADO' USING ERRCODE = '42501'; END IF;
  SELECT * INTO n FROM public.nodos WHERE id = p_nodo_id AND agricultor_id = usuario FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NODO_NO_AUTORIZADO' USING ERRCODE = '42501'; END IF;
  IF n.tipo_nodo <> 'fisico' THEN RAISE EXCEPTION 'NODO_NO_FISICO' USING ERRCODE = '22023'; END IF;
  DELETE FROM public.nodo_claves WHERE nodo_id = n.id;
  IF n.eliminado_en IS NOT NULL THEN
    RETURN jsonb_build_object('codigo', 'NODO_ELIMINADO', 'modo', 'retirado', 'nodo_id', n.id);
  END IF;
  IF n.cultivo_id IS NOT NULL THEN UPDATE public.nodos SET cultivo_id = NULL WHERE id = n.id; END IF;
  IF EXISTS (SELECT 1 FROM public.mediciones WHERE nodo_id = n.id) OR EXISTS (SELECT 1 FROM public.alertas WHERE nodo_id = n.id) THEN
    UPDATE public.nodos SET eliminado_en = clock_timestamp(), habilitado = false WHERE id = n.id;
    RETURN jsonb_build_object('codigo', 'NODO_ELIMINADO', 'modo', 'retirado', 'nodo_id', n.id);
  END IF;
  DELETE FROM public.alerta_cursores WHERE nodo_id = n.id;
  PERFORM set_config('agrovigia.borrado_definitivo', 'si', true);
  DELETE FROM public.nodo_asignaciones WHERE nodo_id = n.id;
  PERFORM set_config('agrovigia.borrado_definitivo', '', true);
  DELETE FROM public.nodo_variables WHERE nodo_id = n.id;
  DELETE FROM public.nodos WHERE id = n.id;
  RETURN jsonb_build_object('codigo', 'NODO_ELIMINADO', 'modo', 'borrado', 'nodo_id', n.id);
END; $$;

-- Servidor (n8n, webhook agrovigia/nodo): comprueba la clave de un nodo fisico. La respuesta de fallo es
-- la misma si el nodo no existe, no tiene clave, fue eliminado o la clave no coincide. Registra el ultimo
-- uso y cuenta los fallos. No bloquea por intentos: la clave tiene 256 bits y un bloqueo por codigo de
-- nodo dejaria que cualquiera que conozca un codigo dejara sin servicio a esa placa.
CREATE FUNCTION public.autenticar_nodo(p_codigo text, p_clave text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n public.nodos; k public.nodo_claves; ahora timestamptz := clock_timestamp();
BEGIN
  IF p_codigo IS NULL OR p_clave IS NULL OR length(p_codigo) > 64 OR length(p_clave) NOT BETWEEN 20 AND 200 THEN
    RETURN jsonb_build_object('codigo', 'CLAVE_INVALIDA');
  END IF;
  SELECT x.* INTO n FROM public.nodos x WHERE x.codigo = p_codigo AND x.tipo_nodo = 'fisico' AND x.eliminado_en IS NULL;
  IF FOUND THEN SELECT * INTO k FROM public.nodo_claves WHERE nodo_id = n.id; END IF;
  IF k.nodo_id IS NULL OR k.clave_hash <> encode(sha256(convert_to(p_clave, 'UTF8')), 'hex') THEN
    IF k.nodo_id IS NOT NULL THEN
      UPDATE public.nodo_claves SET intentos_fallidos = intentos_fallidos + 1, ultimo_fallo_en = ahora WHERE nodo_id = k.nodo_id;
    END IF;
    RETURN jsonb_build_object('codigo', 'CLAVE_INVALIDA');
  END IF;
  UPDATE public.nodo_claves SET ultimo_uso_en = ahora, intentos_fallidos = 0 WHERE nodo_id = k.nodo_id;
  RETURN jsonb_build_object('codigo', 'NODO_AUTENTICADO', 'nodo_codigo', n.codigo,
    'intervalo_segundos', n.intervalo_segundos, 'pausado', n.recepcion_pausada);
END; $$;

-- 4. Hasta dieciseis nodos fisicos por cultivo, igual que virtuales (antes dos: 0005 y 0007). Es
-- vincular_nodo de la 0011 con ese unico cambio.
CREATE OR REPLACE FUNCTION public.vincular_nodo(p_nodo_id uuid,p_cultivo_id uuid) RETURNS public.nodos
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE usuario uuid:=auth.uid(); destino public.cultivos; nodo public.nodos;
BEGIN
 PERFORM 1 FROM public.perfiles WHERE id=usuario FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PERFIL_NO_AUTORIZADO' USING ERRCODE='42501'; END IF;
 SELECT * INTO destino FROM public.cultivos WHERE id=p_cultivo_id AND agricultor_id=usuario FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CULTIVO_NO_AUTORIZADO' USING ERRCODE='42501'; END IF;
 IF destino.archivado_en IS NOT NULL THEN RAISE EXCEPTION 'CULTIVO_ARCHIVADO' USING ERRCODE='22023'; END IF;
 SELECT * INTO nodo FROM public.nodos WHERE id=p_nodo_id AND agricultor_id=usuario FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NODO_NO_AUTORIZADO' USING ERRCODE='42501'; END IF;
 IF nodo.eliminado_en IS NOT NULL THEN RAISE EXCEPTION 'NODO_ELIMINADO' USING ERRCODE='22023'; END IF;
 IF NOT nodo.habilitado THEN RAISE EXCEPTION 'NODO_DESHABILITADO' USING ERRCODE='22023'; END IF;
 IF nodo.cultivo_id=p_cultivo_id THEN RETURN nodo; END IF;
 IF nodo.cultivo_id IS NOT NULL THEN RAISE EXCEPTION 'NODO_OCUPADO' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*) FROM public.nodos WHERE cultivo_id=p_cultivo_id AND tipo_nodo=nodo.tipo_nodo)>=16 THEN
  RAISE EXCEPTION 'LIMITE_NODOS_CULTIVO' USING ERRCODE='22023';
 END IF;
 UPDATE public.nodos SET cultivo_id=p_cultivo_id WHERE id=p_nodo_id RETURNING * INTO nodo;
 RETURN nodo;
END; $$;

REVOKE ALL ON FUNCTION public.definir_terreno(uuid,numeric,numeric), public.validar_sector(text,numeric,numeric,numeric,numeric),
  public.crear_sector(uuid,text,numeric,numeric,numeric,numeric), public.editar_sector(uuid,text,numeric,numeric,numeric,numeric),
  public.eliminar_sector(uuid), public.exigir_zona_activa(), public.ubicar_nodo(uuid,uuid,numeric,numeric),
  public.emitir_clave_nodo(uuid), public.registrar_nodo_fisico(text,text[]), public.regenerar_clave_nodo(uuid),
  public.claves_nodos(), public.eliminar_nodo_fisico(uuid), public.autenticar_nodo(text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.definir_terreno(uuid,numeric,numeric), public.crear_sector(uuid,text,numeric,numeric,numeric,numeric),
  public.editar_sector(uuid,text,numeric,numeric,numeric,numeric), public.eliminar_sector(uuid),
  public.ubicar_nodo(uuid,uuid,numeric,numeric), public.registrar_nodo_fisico(text,text[]), public.regenerar_clave_nodo(uuid),
  public.claves_nodos(), public.eliminar_nodo_fisico(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.autenticar_nodo(text,text) TO service_role;
COMMIT;
