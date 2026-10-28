-- 0006: backend de reglas/episodios. Requiere 0001..0005. No activa reglas ni cambia ingesta.
BEGIN;
CREATE TABLE public.reglas_alerta (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cultivo_id uuid NOT NULL REFERENCES public.cultivos(id),
 variable_codigo text NOT NULL REFERENCES public.variables(codigo), origen text NOT NULL CHECK(origen IN ('real','simulado')),
 minimo numeric(12,4), maximo numeric(12,4), habilitada boolean NOT NULL DEFAULT true,
 creada_en timestamptz NOT NULL DEFAULT clock_timestamp(), desactivada_en timestamptz,
 CHECK(minimo IS NOT NULL OR maximo IS NOT NULL),
 CHECK(minimo IS NULL OR minimo::text NOT IN ('NaN','Infinity','-Infinity')),
 CHECK(maximo IS NULL OR maximo::text NOT IN ('NaN','Infinity','-Infinity')),
 CHECK(minimo IS NULL OR maximo IS NULL OR minimo<maximo)
);
CREATE UNIQUE INDEX regla_actual ON public.reglas_alerta(cultivo_id,variable_codigo,origen) WHERE habilitada;
CREATE TABLE public.alertas (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), regla_id uuid NOT NULL REFERENCES public.reglas_alerta(id),
 cultivo_id uuid NOT NULL REFERENCES public.cultivos(id), nodo_id uuid NOT NULL REFERENCES public.nodos(id),
 variable_codigo text NOT NULL, origen text NOT NULL CHECK(origen IN ('real','simulado')),
 limite text NOT NULL CHECK(limite IN ('inferior','superior')), umbral numeric(12,4) NOT NULL,
 medicion_inicial_id uuid NOT NULL, medicion_ultima_id uuid NOT NULL, medicion_cierre_id uuid,
 valor_inicial numeric(12,4) NOT NULL, valor_ultimo numeric(12,4) NOT NULL,
 abierta_en timestamptz NOT NULL DEFAULT clock_timestamp(), ultima_tomada_en timestamptz NOT NULL,
 cerrada_en timestamptz, motivo_cierre text CHECK(motivo_cierre IN ('dentro_de_rango','cambio_de_limite','regla_desactivada','nodo_desvinculado')),
 revisada_en timestamptz, revisada_por uuid REFERENCES public.perfiles(id),
 CHECK((cerrada_en IS NULL)=(motivo_cierre IS NULL)), CHECK((revisada_en IS NULL)=(revisada_por IS NULL)),
 FOREIGN KEY(medicion_inicial_id,cultivo_id,nodo_id,variable_codigo,origen) REFERENCES public.mediciones(id,cultivo_id,nodo_id,variable_codigo,origen),
 FOREIGN KEY(medicion_ultima_id,cultivo_id,nodo_id,variable_codigo,origen) REFERENCES public.mediciones(id,cultivo_id,nodo_id,variable_codigo,origen),
 FOREIGN KEY(medicion_cierre_id,cultivo_id,nodo_id,variable_codigo,origen) REFERENCES public.mediciones(id,cultivo_id,nodo_id,variable_codigo,origen)
);
CREATE UNIQUE INDEX episodio_abierto ON public.alertas(regla_id,nodo_id,origen) WHERE cerrada_en IS NULL;
CREATE INDEX alertas_cultivo_fecha ON public.alertas(cultivo_id,abierta_en DESC,id DESC);
CREATE TABLE public.alerta_cursores (
 regla_id uuid NOT NULL REFERENCES public.reglas_alerta(id), nodo_id uuid NOT NULL REFERENCES public.nodos(id),
 origen text NOT NULL, tomada_en timestamptz NOT NULL, medicion_id uuid NOT NULL REFERENCES public.mediciones(id),
 PRIMARY KEY(regla_id,nodo_id,origen)
);
ALTER TABLE public.reglas_alerta ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alertas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerta_cursores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reglas_alerta,public.alertas,public.alerta_cursores FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.reglas_alerta,public.alertas TO authenticated,service_role;
CREATE POLICY leer_propias ON public.reglas_alerta FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.cultivos c WHERE c.id=cultivo_id AND c.agricultor_id=(SELECT auth.uid())));
CREATE POLICY leer_propias ON public.alertas FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.cultivos c WHERE c.id=cultivo_id AND c.agricultor_id=(SELECT auth.uid())));

CREATE FUNCTION public.configurar_regla_alerta(p_cultivo_id uuid,p_variable_codigo text,p_minimo numeric,p_maximo numeric,p_origen text DEFAULT 'real')
RETURNS public.reglas_alerta LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.cultivos; v public.variables; r public.reglas_alerta;
BEGIN
 SELECT * INTO c FROM public.cultivos WHERE id=p_cultivo_id AND agricultor_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CULTIVO_NO_AUTORIZADO' USING ERRCODE='42501'; END IF;
 IF c.archivado_en IS NOT NULL THEN RAISE EXCEPTION 'CULTIVO_ARCHIVADO' USING ERRCODE='22023'; END IF;
 SELECT * INTO v FROM public.variables WHERE codigo=p_variable_codigo;
 IF NOT FOUND OR p_variable_codigo NOT IN ('temperatura_aire','humedad_aire','iluminacion_relativa')
 OR p_origen IS NULL OR p_origen NOT IN ('real','simulado') OR (p_minimo IS NULL AND p_maximo IS NULL)
 OR (p_minimo IS NOT NULL AND (p_minimo::text IN ('NaN','Infinity','-Infinity') OR p_minimo<>round(p_minimo,4) OR p_minimo<v.valor_min OR p_minimo>v.valor_max))
 OR (p_maximo IS NOT NULL AND (p_maximo::text IN ('NaN','Infinity','-Infinity') OR p_maximo<>round(p_maximo,4) OR p_maximo<v.valor_min OR p_maximo>v.valor_max))
 OR (p_minimo IS NOT NULL AND p_maximo IS NOT NULL AND p_minimo>=p_maximo) THEN
 RAISE EXCEPTION 'LIMITES_INVALIDOS' USING ERRCODE='22023'; END IF;
 SELECT * INTO r FROM public.reglas_alerta WHERE cultivo_id=p_cultivo_id AND variable_codigo=p_variable_codigo AND origen=p_origen AND habilitada FOR UPDATE;
 IF FOUND AND r.minimo IS NOT DISTINCT FROM p_minimo AND r.maximo IS NOT DISTINCT FROM p_maximo THEN RETURN r; END IF;
 IF r.id IS NOT NULL THEN
  UPDATE public.alertas SET cerrada_en=clock_timestamp(),motivo_cierre='regla_desactivada' WHERE regla_id=r.id AND cerrada_en IS NULL;
  UPDATE public.reglas_alerta SET habilitada=false,desactivada_en=clock_timestamp() WHERE id=r.id;
 END IF;
 INSERT INTO public.reglas_alerta(cultivo_id,variable_codigo,minimo,maximo,origen) VALUES(p_cultivo_id,p_variable_codigo,p_minimo,p_maximo,p_origen) RETURNING * INTO r;
 RETURN r;
END; $$;
CREATE FUNCTION public.desactivar_regla_alerta(p_regla_id uuid) RETURNS public.reglas_alerta
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.reglas_alerta; cultivo uuid;
BEGIN
 SELECT cultivo_id INTO cultivo FROM public.reglas_alerta WHERE id=p_regla_id;
 PERFORM 1 FROM public.cultivos WHERE id=cultivo AND agricultor_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'REGLA_NO_AUTORIZADA' USING ERRCODE='42501'; END IF;
 UPDATE public.reglas_alerta SET habilitada=false,desactivada_en=coalesce(desactivada_en,clock_timestamp()) WHERE id=p_regla_id RETURNING * INTO r;
 UPDATE public.alertas SET cerrada_en=clock_timestamp(),motivo_cierre='regla_desactivada' WHERE regla_id=p_regla_id AND cerrada_en IS NULL;
 RETURN r;
END; $$;
CREATE FUNCTION public.revisar_alerta(p_alerta_id uuid) RETURNS public.alertas
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE resultado public.alertas;
BEGIN
 UPDATE public.alertas a SET revisada_en=coalesce(a.revisada_en,clock_timestamp()),revisada_por=coalesce(a.revisada_por,auth.uid())
 WHERE a.id=p_alerta_id AND EXISTS(SELECT 1 FROM public.cultivos c WHERE c.id=a.cultivo_id AND c.agricultor_id=auth.uid()) RETURNING a.* INTO resultado;
 IF NOT FOUND THEN RAISE EXCEPTION 'ALERTA_NO_AUTORIZADA' USING ERRCODE='42501'; END IF;
 RETURN resultado;
END; $$;

-- Solo n8n/servidor. Consulta mediciones persistidas; no acepta valores desde el navegador.
CREATE FUNCTION public.evaluar_alertas_lote(p_nodo_id uuid,p_mensaje_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n public.nodos; m public.mediciones; r public.reglas_alerta; a public.alertas; cursor_fecha timestamptz;
 direccion text; frontera numeric; abiertas integer:=0; actualizadas integer:=0; cerradas integer:=0; evaluadas integer:=0;
BEGIN
 SELECT * INTO n FROM public.nodos WHERE id=p_nodo_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'NODO_DESCONOCIDO' USING ERRCODE='22023'; END IF;
 IF n.cultivo_id IS NULL OR NOT n.habilitado THEN RETURN jsonb_build_object('codigo','NODO_NO_ACTIVO','evaluadas',0); END IF;
 PERFORM 1 FROM public.cultivos WHERE id=n.cultivo_id AND archivado_en IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.nodos WHERE id=n.id AND cultivo_id=n.cultivo_id AND habilitado) THEN
 RETURN jsonb_build_object('codigo','CULTIVO_NO_ACTIVO','evaluadas',0); END IF;
 FOR m IN SELECT * FROM public.mediciones WHERE nodo_id=n.id AND mensaje_id=p_mensaje_id AND cultivo_id=n.cultivo_id ORDER BY variable_codigo LOOP
  -- Solo datos recientes; conserva la tolerancia de reloj futuro de 120s de la ingesta.
  IF m.tomada_en<clock_timestamp()-interval '180 seconds' OR m.tomada_en>clock_timestamp()+interval '120 seconds'
    OR m.recibida_en<clock_timestamp()-interval '180 seconds' OR m.recibida_en>clock_timestamp()+interval '120 seconds' THEN CONTINUE; END IF;
  FOR r IN SELECT * FROM public.reglas_alerta WHERE cultivo_id=m.cultivo_id AND variable_codigo=m.variable_codigo AND origen=m.origen AND habilitada ORDER BY id FOR UPDATE LOOP
   -- Configurar una regla no reevalua capturas anteriores a su creacion.
   IF m.recibida_en<r.creada_en THEN CONTINUE; END IF;
   SELECT tomada_en INTO cursor_fecha FROM public.alerta_cursores WHERE regla_id=r.id AND nodo_id=n.id AND origen=m.origen;
   IF FOUND AND m.tomada_en<=cursor_fecha THEN CONTINUE; END IF;
   direccion:=NULL;frontera:=NULL;
   IF r.minimo IS NOT NULL AND m.valor<r.minimo THEN direccion:='inferior';frontera:=r.minimo;
   ELSIF r.maximo IS NOT NULL AND m.valor>r.maximo THEN direccion:='superior';frontera:=r.maximo; END IF;
   SELECT * INTO a FROM public.alertas WHERE regla_id=r.id AND nodo_id=n.id AND origen=m.origen AND cerrada_en IS NULL FOR UPDATE;
   IF a.id IS NOT NULL AND (direccion IS NULL OR direccion<>a.limite) THEN
    UPDATE public.alertas SET cerrada_en=clock_timestamp(),motivo_cierre=CASE WHEN direccion IS NULL THEN 'dentro_de_rango' ELSE 'cambio_de_limite' END,medicion_cierre_id=m.id WHERE id=a.id;
    cerradas:=cerradas+1;a.id:=NULL;
   END IF;
   IF direccion IS NOT NULL THEN
    IF a.id IS NULL THEN
     INSERT INTO public.alertas(regla_id,cultivo_id,nodo_id,variable_codigo,origen,limite,umbral,medicion_inicial_id,medicion_ultima_id,valor_inicial,valor_ultimo,ultima_tomada_en)
     VALUES(r.id,m.cultivo_id,n.id,m.variable_codigo,m.origen,direccion,frontera,m.id,m.id,m.valor,m.valor,m.tomada_en);
     abiertas:=abiertas+1;
    ELSE
     UPDATE public.alertas SET medicion_ultima_id=m.id,valor_ultimo=m.valor,ultima_tomada_en=m.tomada_en WHERE id=a.id;
     actualizadas:=actualizadas+1;
    END IF;
   END IF;
   INSERT INTO public.alerta_cursores(regla_id,nodo_id,origen,tomada_en,medicion_id) VALUES(r.id,n.id,m.origen,m.tomada_en,m.id)
    ON CONFLICT(regla_id,nodo_id,origen) DO UPDATE SET tomada_en=EXCLUDED.tomada_en,medicion_id=EXCLUDED.medicion_id;
   evaluadas:=evaluadas+1;
  END LOOP;
 END LOOP;
 RETURN jsonb_build_object('codigo','LOTE_EVALUADO','evaluadas',evaluadas,'abiertas',abiertas,'actualizadas',actualizadas,'cerradas',cerradas);
END; $$;
CREATE FUNCTION public.cerrar_alertas_desvinculadas() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.cultivo_id IS DISTINCT FROM NEW.cultivo_id OR (OLD.habilitado AND NOT NEW.habilitado) THEN
  UPDATE public.alertas SET cerrada_en=clock_timestamp(),motivo_cierre='nodo_desvinculado'
   WHERE nodo_id=NEW.id AND cerrada_en IS NULL;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER cerrar_alertas_nodo AFTER UPDATE OF cultivo_id,habilitado ON public.nodos FOR EACH ROW EXECUTE FUNCTION public.cerrar_alertas_desvinculadas();
REVOKE ALL ON FUNCTION public.configurar_regla_alerta(uuid,text,numeric,numeric,text),public.desactivar_regla_alerta(uuid),public.revisar_alerta(uuid),public.evaluar_alertas_lote(uuid,text),public.cerrar_alertas_desvinculadas() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.configurar_regla_alerta(uuid,text,numeric,numeric,text),public.desactivar_regla_alerta(uuid),public.revisar_alerta(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.evaluar_alertas_lote(uuid,text) TO service_role;
COMMIT;
