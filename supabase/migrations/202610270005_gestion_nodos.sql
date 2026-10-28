-- Aplicar completa una vez despues de 0004. No cambia asignaciones existentes.
BEGIN;
CREATE TABLE public.nodo_asignaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nodo_id uuid NOT NULL REFERENCES public.nodos(id) ON DELETE RESTRICT,
  agricultor_id uuid NOT NULL REFERENCES public.perfiles(id) ON DELETE RESTRICT,
  cultivo_anterior_id uuid REFERENCES public.cultivos(id) ON DELETE RESTRICT,
  cultivo_nuevo_id uuid REFERENCES public.cultivos(id) ON DELETE RESTRICT,
  actor_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  motivo text NOT NULL CHECK(motivo IN ('estado_inicial','asignacion','desvinculacion','cambio')),
  realizado_en timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX nodo_asignaciones_cuenta_fecha ON public.nodo_asignaciones(agricultor_id,realizado_en DESC,id DESC);
ALTER TABLE public.nodo_asignaciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nodo_asignaciones FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.nodo_asignaciones TO authenticated,service_role;
CREATE POLICY leer_propios ON public.nodo_asignaciones FOR SELECT TO authenticated
  USING(agricultor_id=(SELECT auth.uid()));
-- Es una fotografia de la migracion; no inventa la fecha del vinculo original.
INSERT INTO public.nodo_asignaciones(nodo_id,agricultor_id,cultivo_nuevo_id,motivo)
SELECT id,agricultor_id,cultivo_id,'estado_inicial' FROM public.nodos;
CREATE FUNCTION public.auditar_asignacion_nodo() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE anterior uuid;
BEGIN
  IF TG_OP='UPDATE' THEN
    anterior:=OLD.cultivo_id;
    IF anterior IS NOT DISTINCT FROM NEW.cultivo_id THEN RETURN NEW; END IF;
  ELSIF NEW.cultivo_id IS NULL THEN RETURN NEW;
  END IF;
  INSERT INTO public.nodo_asignaciones(nodo_id,agricultor_id,cultivo_anterior_id,cultivo_nuevo_id,actor_id,motivo)
  VALUES(NEW.id,NEW.agricultor_id,anterior,NEW.cultivo_id,auth.uid(),
    CASE WHEN anterior IS NULL THEN 'asignacion' WHEN NEW.cultivo_id IS NULL THEN 'desvinculacion' ELSE 'cambio' END);
  RETURN NEW;
END; $$;
CREATE TRIGGER auditar_asignacion AFTER INSERT OR UPDATE OF cultivo_id ON public.nodos
FOR EACH ROW EXECUTE FUNCTION public.auditar_asignacion_nodo();
CREATE TRIGGER asignacion_inmutable BEFORE UPDATE OR DELETE ON public.nodo_asignaciones
FOR EACH ROW EXECUTE FUNCTION public.impedir_cambio_medicion();

CREATE FUNCTION public.vincular_nodo(p_nodo_id uuid,p_cultivo_id uuid) RETURNS public.nodos
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
  IF NOT nodo.habilitado THEN RAISE EXCEPTION 'NODO_DESHABILITADO' USING ERRCODE='22023'; END IF;
  IF nodo.cultivo_id=p_cultivo_id THEN RETURN nodo; END IF;
  IF nodo.cultivo_id IS NOT NULL THEN RAISE EXCEPTION 'NODO_OCUPADO' USING ERRCODE='22023'; END IF;
  IF (SELECT count(*) FROM public.nodos WHERE cultivo_id=p_cultivo_id)>=2 THEN
    RAISE EXCEPTION 'LIMITE_NODOS_CULTIVO' USING ERRCODE='22023';
  END IF;
  UPDATE public.nodos SET cultivo_id=p_cultivo_id WHERE id=p_nodo_id RETURNING * INTO nodo;
  RETURN nodo;
END; $$;
CREATE FUNCTION public.desvincular_nodo(p_nodo_id uuid,p_cultivo_esperado_id uuid) RETURNS public.nodos
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE usuario uuid:=auth.uid(); nodo public.nodos;
BEGIN
  PERFORM 1 FROM public.perfiles WHERE id=usuario FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERFIL_NO_AUTORIZADO' USING ERRCODE='42501'; END IF;
  IF p_cultivo_esperado_id IS NULL THEN RAISE EXCEPTION 'CULTIVO_ESPERADO_REQUERIDO' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.cultivos WHERE id=p_cultivo_esperado_id AND agricultor_id=usuario FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CULTIVO_NO_AUTORIZADO' USING ERRCODE='42501'; END IF;
  SELECT * INTO nodo FROM public.nodos WHERE id=p_nodo_id AND agricultor_id=usuario FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NODO_NO_AUTORIZADO' USING ERRCODE='42501'; END IF;
  IF nodo.cultivo_id IS NULL THEN RETURN nodo; END IF;
  IF nodo.cultivo_id<>p_cultivo_esperado_id THEN RAISE EXCEPTION 'ASIGNACION_CAMBIO' USING ERRCODE='22023'; END IF;
  UPDATE public.nodos SET cultivo_id=NULL WHERE id=p_nodo_id RETURNING * INTO nodo;
  RETURN nodo;
END; $$;
-- Misma serializacion por cuenta que crear/vincular/desvincular.
CREATE OR REPLACE FUNCTION public.archivar_cultivo(p_cultivo_id uuid) RETURNS public.cultivos
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE resultado public.cultivos;
BEGIN
  PERFORM 1 FROM public.perfiles WHERE id=auth.uid() FOR UPDATE;
  SELECT * INTO resultado FROM public.cultivos WHERE id=p_cultivo_id AND agricultor_id=auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CULTIVO_NO_AUTORIZADO' USING ERRCODE='42501'; END IF;
  IF resultado.archivado_en IS NOT NULL THEN RETURN resultado; END IF;
  UPDATE public.nodos SET cultivo_id=NULL WHERE cultivo_id=resultado.id;
  UPDATE public.cultivos SET archivado_en=clock_timestamp() WHERE id=resultado.id RETURNING * INTO resultado;
  RETURN resultado;
END; $$;
REVOKE ALL ON FUNCTION public.auditar_asignacion_nodo() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.vincular_nodo(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.desvincular_nodo(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.vincular_nodo(uuid,uuid),public.desvincular_nodo(uuid,uuid) TO authenticated;
COMMIT;
