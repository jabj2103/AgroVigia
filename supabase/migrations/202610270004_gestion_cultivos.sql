-- Ejecutar completa una vez, despues de 0003. No modifica cultivos existentes.
BEGIN;
ALTER TABLE public.cultivos ADD COLUMN archivado_en timestamptz;
CREATE FUNCTION public.exigir_cultivo_activo() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE archivo timestamptz;
BEGIN
  IF NEW.cultivo_id IS NULL THEN RETURN NEW; END IF;
  SELECT c.archivado_en INTO archivo FROM public.cultivos c WHERE c.id=NEW.cultivo_id FOR SHARE;
  IF NOT FOUND OR archivo IS NOT NULL THEN
    RAISE EXCEPTION 'CULTIVO_NO_ACTIVO' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER nodo_cultivo_activo BEFORE INSERT OR UPDATE OF cultivo_id ON public.nodos
FOR EACH ROW EXECUTE FUNCTION public.exigir_cultivo_activo();
CREATE TRIGGER medicion_cultivo_activo BEFORE INSERT ON public.mediciones
FOR EACH ROW EXECUTE FUNCTION public.exigir_cultivo_activo();

CREATE FUNCTION public.crear_cultivo(
  p_nombre text,p_tipo text,p_area numeric,p_unidad_area text,p_nodos uuid[],p_solicitud_id uuid
) RETURNS public.cultivos LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE usuario uuid := auth.uid(); resultado public.cultivos; cantidad integer;
BEGIN
  IF usuario IS NULL OR NOT EXISTS (SELECT 1 FROM public.perfiles WHERE id=usuario) THEN
    RAISE EXCEPTION 'PERFIL_NO_AUTORIZADO' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.perfiles WHERE id=usuario FOR UPDATE;
  IF p_solicitud_id IS NULL OR p_nombre IS NULL OR length(btrim(p_nombre)) NOT BETWEEN 1 AND 100
    OR p_tipo IS NULL OR length(btrim(p_tipo)) NOT BETWEEN 1 AND 100
    OR p_area IS NULL OR p_area::text IN ('NaN','Infinity','-Infinity') OR p_area<=0
    OR p_area>99999999.9999 OR p_area<>round(p_area,4)
    OR p_unidad_area IS NULL OR p_unidad_area NOT IN ('ha','m2')
    OR p_nodos IS NULL OR cardinality(p_nodos) NOT BETWEEN 1 AND 2
    OR array_ndims(p_nodos)<>1 OR array_position(p_nodos,NULL) IS NOT NULL
    OR (SELECT count(DISTINCT x) FROM unnest(p_nodos) x)<>cardinality(p_nodos) THEN
    RAISE EXCEPTION 'DATOS_CULTIVO_INVALIDOS' USING ERRCODE='22023';
  END IF;
  SELECT * INTO resultado FROM public.cultivos WHERE agricultor_id=usuario AND solicitud_id=p_solicitud_id;
  IF FOUND THEN
    IF resultado.nombre<>btrim(p_nombre) OR resultado.tipo<>btrim(p_tipo)
      OR resultado.area<>p_area OR resultado.unidad_area<>p_unidad_area
      OR resultado.archivado_en IS NOT NULL
      OR ARRAY(SELECT id FROM public.nodos WHERE cultivo_id=resultado.id ORDER BY id)
         <>ARRAY(SELECT x FROM unnest(p_nodos) x ORDER BY x) THEN
      RAISE EXCEPTION 'SOLICITUD_EN_CONFLICTO' USING ERRCODE='22023';
    END IF;
    RETURN resultado;
  END IF;
  PERFORM id FROM public.nodos WHERE id=ANY(p_nodos) ORDER BY id FOR UPDATE;
  SELECT count(*) INTO cantidad FROM public.nodos
    WHERE id=ANY(p_nodos) AND agricultor_id=usuario AND habilitado AND cultivo_id IS NULL;
  IF cantidad<>cardinality(p_nodos) THEN
    RAISE EXCEPTION 'NODOS_NO_DISPONIBLES' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.cultivos (agricultor_id,nombre,tipo,area,unidad_area,solicitud_id)
    VALUES (usuario,btrim(p_nombre),btrim(p_tipo),p_area,p_unidad_area,p_solicitud_id)
    RETURNING * INTO resultado;
  UPDATE public.nodos SET cultivo_id=resultado.id WHERE id=ANY(p_nodos);
  RETURN resultado;
END; $$;
CREATE FUNCTION public.editar_cultivo(p_cultivo_id uuid,p_nombre text,p_tipo text,p_area numeric,p_unidad_area text)
RETURNS public.cultivos LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE resultado public.cultivos;
BEGIN
  SELECT * INTO resultado FROM public.cultivos WHERE id=p_cultivo_id AND agricultor_id=auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CULTIVO_NO_AUTORIZADO' USING ERRCODE='42501'; END IF;
  IF resultado.archivado_en IS NOT NULL THEN RAISE EXCEPTION 'CULTIVO_ARCHIVADO' USING ERRCODE='22023'; END IF;
  IF p_nombre IS NULL OR length(btrim(p_nombre)) NOT BETWEEN 1 AND 100
    OR p_tipo IS NULL OR length(btrim(p_tipo)) NOT BETWEEN 1 AND 100
    OR p_area IS NULL OR p_area::text IN ('NaN','Infinity','-Infinity') OR p_area<=0
    OR p_area>99999999.9999 OR p_area<>round(p_area,4)
    OR p_unidad_area IS NULL OR p_unidad_area NOT IN ('ha','m2') THEN
    RAISE EXCEPTION 'DATOS_CULTIVO_INVALIDOS' USING ERRCODE='22023';
  END IF;
  UPDATE public.cultivos SET nombre=btrim(p_nombre),tipo=btrim(p_tipo),area=p_area,unidad_area=p_unidad_area
    WHERE id=resultado.id RETURNING * INTO resultado;
  RETURN resultado;
END; $$;
CREATE FUNCTION public.archivar_cultivo(p_cultivo_id uuid) RETURNS public.cultivos
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE resultado public.cultivos;
BEGIN
  SELECT * INTO resultado FROM public.cultivos WHERE id=p_cultivo_id AND agricultor_id=auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CULTIVO_NO_AUTORIZADO' USING ERRCODE='42501'; END IF;
  IF resultado.archivado_en IS NOT NULL THEN RETURN resultado; END IF;
  UPDATE public.nodos SET cultivo_id=NULL WHERE cultivo_id=resultado.id;
  UPDATE public.cultivos SET archivado_en=clock_timestamp() WHERE id=resultado.id RETURNING * INTO resultado;
  RETURN resultado;
END; $$;
REVOKE ALL ON FUNCTION public.exigir_cultivo_activo() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.crear_cultivo(text,text,numeric,text,uuid[],uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.editar_cultivo(uuid,text,text,numeric,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.archivar_cultivo(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.crear_cultivo(text,text,numeric,text,uuid[],uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.editar_cultivo(uuid,text,text,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archivar_cultivo(uuid) TO authenticated;
COMMIT;
