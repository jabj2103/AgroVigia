-- Preparado, NO ejecutado en servicios. Requiere 0007 y 0008.
-- Coordinar con el companero antes de usar el proyecto compartido.
-- Cambiar SOLO el NULL siguiente por el UUID del cultivo activo elegido.
BEGIN;
DO $$
DECLARE
 p_cultivo_id uuid := NULL;
 c public.cultivos; z public.zonas; n public.nodos; nuevo boolean; i integer;
 codes text[]:=ARRAY['zona-norte','zona-sur','zona-central','zona-drenaje'];
 names text[]:=ARRAY['Sector norte','Sector sur','Sector central','Sector de drenaje'];
 node_code text;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'Ejecutar con postgres en SQL Editor.'; END IF;
 IF p_cultivo_id IS NULL THEN RAISE EXCEPTION 'CONFIGURAR_CULTIVO_ID: sustituir NULL por UUID, no una clave.'; END IF;
 SELECT * INTO c FROM public.cultivos WHERE id=p_cultivo_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'CULTIVO_NO_EXISTE'; END IF;
 PERFORM 1 FROM public.perfiles WHERE id=c.agricultor_id FOR UPDATE;
 SELECT * INTO c FROM public.cultivos WHERE id=p_cultivo_id FOR UPDATE;
 IF c.archivado_en IS NOT NULL THEN RAISE EXCEPTION 'CULTIVO_ARCHIVADO'; END IF;
 PERFORM set_config('agrovigia.provision_cultivo',c.id::text,true);
 FOR i IN 1..4 LOOP
  INSERT INTO public.zonas(cultivo_id,codigo,nombre,plano_x,plano_y,plano_ancho,plano_alto)
  VALUES(c.id,codes[i],names[i],CASE WHEN i IN (1,3) THEN 0.05 ELSE 0.525 END,
   CASE WHEN i<=2 THEN 0.05 ELSE 0.525 END,0.425,0.425)
  ON CONFLICT(cultivo_id,codigo) DO NOTHING;
  SELECT * INTO STRICT z FROM public.zonas WHERE cultivo_id=c.id AND codigo=codes[i];
  node_code:='sim-'||substr(replace(c.id::text,'-',''),1,12)||'-'||lpad(i::text,2,'0');
  SELECT * INTO n FROM public.nodos WHERE codigo=node_code FOR UPDATE; nuevo:=NOT FOUND;
  IF nuevo THEN
   IF (SELECT count(*) FROM public.nodos WHERE cultivo_id=c.id AND tipo_nodo='virtual')>=16 THEN RAISE EXCEPTION 'LIMITE_VIRTUALES'; END IF;
   INSERT INTO public.nodos(codigo,agricultor_id,cultivo_id,tipo_nodo,zona_id,posicion_x,posicion_y)
    VALUES(node_code,c.agricultor_id,c.id,'virtual',z.id,0.5,0.5) RETURNING * INTO n;
   INSERT INTO public.nodo_variables(nodo_id,variable_codigo,sensor_modelo)
    SELECT n.id,codigo,'SIMULADOR_V3' FROM public.variables WHERE codigo IN
    ('temperatura_aire','humedad_aire','iluminacion_relativa','radiacion_solar','humedad_suelo_vwc','temperatura_suelo','ph_suelo','conductividad_suelo_ece','precipitacion_60min','velocidad_viento');
  ELSE
   IF n.agricultor_id<>c.agricultor_id OR n.cultivo_id IS DISTINCT FROM c.id OR n.tipo_nodo<>'virtual'
     OR n.zona_id IS DISTINCT FROM z.id OR NOT n.habilitado THEN RAISE EXCEPTION 'NODO_EXISTENTE_NO_COINCIDE: %',node_code; END IF;
  END IF;
  IF (SELECT count(*) FROM public.nodo_variables WHERE nodo_id=n.id)<>10 OR EXISTS(
   SELECT 1 FROM public.nodo_variables WHERE nodo_id=n.id AND (sensor_modelo<>'SIMULADOR_V3' OR variable_codigo NOT IN
    ('temperatura_aire','humedad_aire','iluminacion_relativa','radiacion_solar','humedad_suelo_vwc','temperatura_suelo','ph_suelo','conductividad_suelo_ece','precipitacion_60min','velocidad_viento'))) THEN RAISE EXCEPTION 'CAPACIDADES_VIRTUALES_NO_COINCIDEN'; END IF;
 END LOOP;
END; $$;
-- Vinculos publicos para configurar posteriormente el emisor. No contienen claves.
SELECT 'sim-zona-'||right(n.codigo,2) AS nodo_local,n.codigo AS nodo_codigo,n.asignacion_version,
 n.cultivo_id,n.zona_id,z.codigo AS zona_codigo,z.nombre AS zona_nombre
FROM public.nodos n JOIN public.zonas z ON z.id=n.zona_id
WHERE n.cultivo_id=current_setting('agrovigia.provision_cultivo')::uuid AND n.tipo_nodo='virtual'
 AND n.codigo='sim-'||substr(replace(n.cultivo_id::text,'-',''),1,12)||'-'||right(n.codigo,2)
 AND z.codigo IN ('zona-norte','zona-sur','zona-central','zona-drenaje')
ORDER BY n.cultivo_id,n.codigo;
COMMIT;
