-- 0007. Requiere 0001..0006. Preparada para revision en rama; no aplicar sin coordinar.
-- Plano esquematico normalizado, no georreferenciacion. No crea nodos ni mediciones.
BEGIN;
CREATE TABLE public.zonas (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 cultivo_id uuid NOT NULL REFERENCES public.cultivos(id) ON DELETE RESTRICT,
 codigo text NOT NULL CHECK(codigo ~ '^[a-z][a-z0-9-]{1,39}$'),
 nombre text NOT NULL CHECK(length(btrim(nombre)) BETWEEN 1 AND 100),
 plano_x numeric(5,4) NOT NULL, plano_y numeric(5,4) NOT NULL,
 plano_ancho numeric(5,4) NOT NULL, plano_alto numeric(5,4) NOT NULL,
 creada_en timestamptz NOT NULL DEFAULT clock_timestamp(),
 actualizada_en timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(cultivo_id,codigo), UNIQUE(id,cultivo_id),
 CHECK(plano_x BETWEEN 0 AND 1 AND plano_y BETWEEN 0 AND 1),
 CHECK(plano_ancho>0 AND plano_alto>0 AND plano_x+plano_ancho<=1 AND plano_y+plano_alto<=1)
);
ALTER TABLE public.zonas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.zonas FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.zonas TO authenticated,service_role;
CREATE POLICY leer_propias ON public.zonas FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.cultivos c WHERE c.id=cultivo_id AND c.agricultor_id=(SELECT auth.uid())));

ALTER TABLE public.nodos
 ADD COLUMN tipo_nodo text NOT NULL DEFAULT 'fisico' CHECK(tipo_nodo IN ('fisico','virtual')),
 ADD COLUMN zona_id uuid,
 ADD COLUMN posicion_x numeric(5,4), ADD COLUMN posicion_y numeric(5,4),
 ADD COLUMN asignacion_version uuid NOT NULL DEFAULT gen_random_uuid(),
 ADD CONSTRAINT nodo_zona_cultivo FOREIGN KEY(zona_id,cultivo_id) REFERENCES public.zonas(id,cultivo_id),
 ADD CHECK(zona_id IS NULL OR cultivo_id IS NOT NULL),
 ADD CHECK((zona_id IS NULL AND posicion_x IS NULL AND posicion_y IS NULL)
  OR (zona_id IS NOT NULL AND posicion_x IS NOT NULL AND posicion_y IS NOT NULL
   AND posicion_x BETWEEN 0 AND 1 AND posicion_y BETWEEN 0 AND 1)),
 ADD CHECK(tipo_nodo<>'virtual' OR codigo ~ '^sim-[a-z0-9][a-z0-9-]{1,45}$');
ALTER TABLE public.mediciones ADD COLUMN zona_id uuid,
 ADD COLUMN zona_contexto jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(zona_contexto)='object'),
 ADD CONSTRAINT medicion_zona_cultivo FOREIGN KEY(zona_id,cultivo_id) REFERENCES public.zonas(id,cultivo_id);
ALTER TABLE public.nodo_asignaciones
 ADD COLUMN zona_anterior_id uuid REFERENCES public.zonas(id),
 ADD COLUMN zona_nueva_id uuid REFERENCES public.zonas(id),
 ADD COLUMN asignacion_version uuid;
CREATE INDEX nodos_zona ON public.nodos(zona_id);
CREATE INDEX mediciones_zona_fecha ON public.mediciones(zona_id,origen,tomada_en DESC);

CREATE FUNCTION public.preparar_asignacion_zona() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.tipo_nodo IS DISTINCT FROM NEW.tipo_nodo THEN
   RAISE EXCEPTION 'TIPO_NODO_INMUTABLE' USING ERRCODE='23514';
  END IF;
  IF OLD.cultivo_id IS DISTINCT FROM NEW.cultivo_id THEN
   NEW.zona_id:=NULL; NEW.posicion_x:=NULL; NEW.posicion_y:=NULL;
  END IF;
  IF OLD.cultivo_id IS DISTINCT FROM NEW.cultivo_id OR OLD.zona_id IS DISTINCT FROM NEW.zona_id
    OR OLD.posicion_x IS DISTINCT FROM NEW.posicion_x OR OLD.posicion_y IS DISTINCT FROM NEW.posicion_y
    OR OLD.habilitado IS DISTINCT FROM NEW.habilitado THEN
   NEW.asignacion_version:=gen_random_uuid();
  ELSE NEW.asignacion_version:=OLD.asignacion_version;
  END IF;
 END IF;
 IF NEW.zona_id IS NULL THEN NEW.posicion_x:=NULL; NEW.posicion_y:=NULL; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER a_preparar_asignacion_zona BEFORE INSERT OR UPDATE ON public.nodos
 FOR EACH ROW EXECUTE FUNCTION public.preparar_asignacion_zona();

CREATE OR REPLACE FUNCTION public.auditar_asignacion_nodo() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE anterior uuid; zona_anterior uuid;
BEGIN
 IF TG_OP='UPDATE' THEN
  anterior:=OLD.cultivo_id; zona_anterior:=OLD.zona_id;
  IF anterior IS NOT DISTINCT FROM NEW.cultivo_id AND zona_anterior IS NOT DISTINCT FROM NEW.zona_id THEN RETURN NEW; END IF;
 ELSIF NEW.cultivo_id IS NULL THEN RETURN NEW;
 END IF;
 INSERT INTO public.nodo_asignaciones(nodo_id,agricultor_id,cultivo_anterior_id,cultivo_nuevo_id,actor_id,motivo,zona_anterior_id,zona_nueva_id,asignacion_version)
 VALUES(NEW.id,NEW.agricultor_id,anterior,NEW.cultivo_id,auth.uid(),
 CASE WHEN anterior IS NULL THEN 'asignacion' WHEN NEW.cultivo_id IS NULL THEN 'desvinculacion' ELSE 'cambio' END,
 zona_anterior,NEW.zona_id,NEW.asignacion_version);
 RETURN NEW;
END; $$;
DROP TRIGGER auditar_asignacion ON public.nodos;
CREATE TRIGGER auditar_asignacion AFTER INSERT OR UPDATE OF cultivo_id,zona_id ON public.nodos
 FOR EACH ROW EXECUTE FUNCTION public.auditar_asignacion_nodo();

CREATE FUNCTION public.conservar_zona_medicion() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE n public.nodos; z public.zonas;
BEGIN
 SELECT * INTO STRICT n FROM public.nodos WHERE id=NEW.nodo_id FOR SHARE;
 IF n.tipo_nodo='virtual' AND (NEW.origen<>'simulado' OR NEW.metadatos->>'version_payload' IS DISTINCT FROM '3') THEN
  RAISE EXCEPTION 'VIRTUAL_SOLO_SIMULACION_V3' USING ERRCODE='23514';
 END IF;
 IF NEW.zona_id IS NOT NULL AND NEW.zona_id IS DISTINCT FROM n.zona_id THEN
  RAISE EXCEPTION 'ZONA_NO_COINCIDE' USING ERRCODE='23514';
 END IF;
 NEW.zona_id:=n.zona_id;
 IF n.tipo_nodo='virtual' AND NEW.zona_id IS NULL THEN
  RAISE EXCEPTION 'VIRTUAL_SIN_ZONA' USING ERRCODE='23514';
 END IF;
 IF NEW.zona_id IS NOT NULL THEN
  SELECT * INTO STRICT z FROM public.zonas WHERE id=NEW.zona_id FOR SHARE;
  -- Columna independiente: no cambia la comparacion de metadatos/duplicados de v1/v2.
  NEW.zona_contexto:=jsonb_build_object(
   'id',z.id,'codigo',z.codigo,'nombre',z.nombre,'plano_x',z.plano_x,'plano_y',z.plano_y,
   'plano_ancho',z.plano_ancho,'plano_alto',z.plano_alto,'posicion_nodo_x',n.posicion_x,'posicion_nodo_y',n.posicion_y);
 ELSE NEW.zona_contexto:='{}'::jsonb;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER zona_medicion BEFORE INSERT ON public.mediciones
 FOR EACH ROW EXECUTE FUNCTION public.conservar_zona_medicion();

CREATE FUNCTION public.configurar_zona(p_cultivo_id uuid,p_codigo text,p_nombre text,p_x numeric,p_y numeric,p_ancho numeric,p_alto numeric)
RETURNS public.zonas LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.cultivos; resultado public.zonas;
BEGIN
 PERFORM 1 FROM public.perfiles WHERE id=auth.uid() FOR UPDATE;
 SELECT * INTO c FROM public.cultivos WHERE id=p_cultivo_id AND agricultor_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CULTIVO_NO_AUTORIZADO' USING ERRCODE='42501'; END IF;
 IF c.archivado_en IS NOT NULL THEN RAISE EXCEPTION 'CULTIVO_ARCHIVADO' USING ERRCODE='22023'; END IF;
 IF p_codigo IS NULL OR p_codigo !~ '^[a-z][a-z0-9-]{1,39}$'
  OR p_nombre IS NULL OR length(btrim(p_nombre)) NOT BETWEEN 1 AND 100
  OR p_x IS NULL OR p_y IS NULL OR p_ancho IS NULL OR p_alto IS NULL
  OR p_x::text IN ('NaN','Infinity','-Infinity') OR p_y::text IN ('NaN','Infinity','-Infinity')
  OR p_ancho::text IN ('NaN','Infinity','-Infinity') OR p_alto::text IN ('NaN','Infinity','-Infinity')
  OR p_x<0 OR p_y<0 OR p_ancho<=0 OR p_alto<=0 OR p_x+p_ancho>1 OR p_y+p_alto>1
  OR p_x<>round(p_x,4) OR p_y<>round(p_y,4) OR p_ancho<>round(p_ancho,4) OR p_alto<>round(p_alto,4) THEN
  RAISE EXCEPTION 'PLANO_ZONA_INVALIDO' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.zonas(cultivo_id,codigo,nombre,plano_x,plano_y,plano_ancho,plano_alto)
 VALUES(p_cultivo_id,p_codigo,btrim(p_nombre),p_x,p_y,p_ancho,p_alto)
 ON CONFLICT(cultivo_id,codigo) DO UPDATE SET nombre=EXCLUDED.nombre,plano_x=EXCLUDED.plano_x,plano_y=EXCLUDED.plano_y,
  plano_ancho=EXCLUDED.plano_ancho,plano_alto=EXCLUDED.plano_alto,actualizada_en=clock_timestamp()
 WHERE (zonas.nombre,zonas.plano_x,zonas.plano_y,zonas.plano_ancho,zonas.plano_alto)
  IS DISTINCT FROM (EXCLUDED.nombre,EXCLUDED.plano_x,EXCLUDED.plano_y,EXCLUDED.plano_ancho,EXCLUDED.plano_alto)
 RETURNING * INTO resultado;
 IF resultado.id IS NULL THEN SELECT * INTO STRICT resultado FROM public.zonas WHERE cultivo_id=p_cultivo_id AND codigo=p_codigo; END IF;
 RETURN resultado;
END; $$;

CREATE FUNCTION public.asignar_zona_nodo(p_nodo_id uuid,p_zona_id uuid,p_x numeric DEFAULT 0.5,p_y numeric DEFAULT 0.5)
RETURNS public.nodos LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n public.nodos; z public.zonas; c public.cultivos;
BEGIN
 PERFORM 1 FROM public.perfiles WHERE id=auth.uid() FOR UPDATE;
 SELECT ct.* INTO c FROM public.cultivos ct JOIN public.nodos nd ON nd.cultivo_id=ct.id
  WHERE nd.id=p_nodo_id AND nd.agricultor_id=auth.uid() AND ct.agricultor_id=auth.uid() FOR UPDATE OF ct;
 IF NOT FOUND THEN RAISE EXCEPTION 'NODO_SIN_CULTIVO_AUTORIZADO' USING ERRCODE='42501'; END IF;
 IF c.archivado_en IS NOT NULL THEN RAISE EXCEPTION 'CULTIVO_ARCHIVADO' USING ERRCODE='22023'; END IF;
 SELECT * INTO n FROM public.nodos WHERE id=p_nodo_id AND agricultor_id=auth.uid() FOR UPDATE;
 IF p_zona_id IS NOT NULL THEN
  IF NOT n.habilitado THEN RAISE EXCEPTION 'NODO_DESHABILITADO' USING ERRCODE='22023'; END IF;
  SELECT * INTO z FROM public.zonas WHERE id=p_zona_id AND cultivo_id=n.cultivo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ZONA_NO_AUTORIZADA' USING ERRCODE='42501'; END IF;
  IF p_x IS NULL OR p_y IS NULL OR p_x::text IN ('NaN','Infinity','-Infinity') OR p_y::text IN ('NaN','Infinity','-Infinity')
   OR p_x<0 OR p_x>1 OR p_y<0 OR p_y>1 OR p_x<>round(p_x,4) OR p_y<>round(p_y,4) THEN
   RAISE EXCEPTION 'POSICION_NODO_INVALIDA' USING ERRCODE='22023';
  END IF;
 END IF;
 UPDATE public.nodos SET zona_id=p_zona_id,posicion_x=CASE WHEN p_zona_id IS NOT NULL THEN p_x END,
  posicion_y=CASE WHEN p_zona_id IS NOT NULL THEN p_y END WHERE id=n.id RETURNING * INTO n;
 RETURN n;
END; $$;

-- Conserva hasta dos placas fisicas; permite hasta dieciseis virtuales por cultivo.
-- crear_cultivo conserva su contrato inicial de uno/dos nodos; los adicionales se vinculan despues.
CREATE OR REPLACE FUNCTION public.vincular_nodo(p_nodo_id uuid,p_cultivo_id uuid) RETURNS public.nodos
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE usuario uuid:=auth.uid(); destino public.cultivos; nodo public.nodos; limite integer;
BEGIN
 PERFORM 1 FROM public.perfiles WHERE id=usuario FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PERFIL_NO_AUTORIZADO' USING ERRCODE='42501'; END IF;
 SELECT * INTO destino FROM public.cultivos WHERE id=p_cultivo_id AND agricultor_id=usuario FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CULTIVO_NO_AUTORIZADO' USING ERRCODE='42501'; END IF;
 IF destino.archivado_en IS NOT NULL THEN RAISE EXCEPTION 'CULTIVO_ARCHIVADO' USING ERRCODE='22023'; END IF;
 SELECT * INTO nodo FROM public.nodos WHERE id=p_nodo_id AND agricultor_id=usuario FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NODO_NO_AUTORIZADO' USING ERRCODE='42501'; END IF;
 IF NOT nodo.habilitado THEN RAISE EXCEPTION 'NODO_DESHABILITADO' USING ERRCODE='22023'; END IF;
 IF nodo.cultivo_id=p_cultivo_id THEN RETURN nodo; END IF;
 IF nodo.cultivo_id IS NOT NULL THEN RAISE EXCEPTION 'NODO_OCUPADO' USING ERRCODE='22023'; END IF;
 limite:=CASE WHEN nodo.tipo_nodo='virtual' THEN 16 ELSE 2 END;
 IF (SELECT count(*) FROM public.nodos WHERE cultivo_id=p_cultivo_id AND tipo_nodo=nodo.tipo_nodo)>=limite THEN
  RAISE EXCEPTION 'LIMITE_NODOS_CULTIVO' USING ERRCODE='22023';
 END IF;
 UPDATE public.nodos SET cultivo_id=p_cultivo_id WHERE id=p_nodo_id RETURNING * INTO nodo;
 RETURN nodo;
END; $$;

REVOKE ALL ON FUNCTION public.preparar_asignacion_zona(),public.conservar_zona_medicion(),
 public.configurar_zona(uuid,text,text,numeric,numeric,numeric,numeric),public.asignar_zona_nodo(uuid,uuid,numeric,numeric)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.configurar_zona(uuid,text,text,numeric,numeric,numeric,numeric),public.asignar_zona_nodo(uuid,uuid,numeric,numeric) TO authenticated;
COMMIT;
