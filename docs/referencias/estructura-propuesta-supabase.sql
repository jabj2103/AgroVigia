-- AgroVigia: propuesta de estructura PostgreSQL / Supabase.
-- No se ha ejecutado en un proyecto remoto. Revisar antes de usar como migración.
-- No incluye todavía las RPC de los casos de uso ni el flujo n8n.
-- Las tablas nuevas están en public; auth.users ya pertenece a Supabase Auth.
BEGIN;

CREATE TABLE public.perfiles (
  id uuid NOT NULL,
  nombre text NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (id) REFERENCES auth.users (id) ON DELETE RESTRICT,
  CHECK (length(btrim(nombre)) > 0)
 );

CREATE TABLE public.cultivos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agricultor_id uuid NOT NULL,
  nombre text NOT NULL,
  tipo text NOT NULL,
  area numeric(12,4) NOT NULL,
  unidad_area text NOT NULL,
  solicitud_id uuid NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (id, agricultor_id),
  UNIQUE (agricultor_id, solicitud_id),
  FOREIGN KEY (agricultor_id) REFERENCES public.perfiles (id) ON DELETE RESTRICT,
  CHECK (length(btrim(nombre)) > 0),
  CHECK (length(btrim(tipo)) > 0),
  CHECK (area > 0 AND area <> 'NaN'::numeric),
  CHECK (unidad_area IN ('ha', 'm2'))
 );

CREATE TABLE public.nodos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  codigo text NOT NULL,
  agricultor_id uuid NOT NULL,
  cultivo_id uuid,
  habilitado boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (codigo),
  FOREIGN KEY (agricultor_id) REFERENCES public.perfiles (id) ON DELETE RESTRICT,
  FOREIGN KEY (cultivo_id, agricultor_id) REFERENCES public.cultivos (id, agricultor_id) ON DELETE RESTRICT,
  CHECK (length(btrim(codigo)) > 0)
 );

CREATE TABLE public.variables (
  codigo text NOT NULL,
  nombre text NOT NULL,
  unidad text NOT NULL,
  valor_min numeric(12,4),
  valor_max numeric(12,4),
  PRIMARY KEY (codigo),
  CHECK (valor_min IS NULL OR valor_min <> 'NaN'::numeric),
  CHECK (valor_max IS NULL OR valor_max <> 'NaN'::numeric),
  CHECK (valor_min IS NULL OR valor_max IS NULL OR valor_min <= valor_max)
 );

CREATE TABLE public.nodo_variables (
  nodo_id uuid NOT NULL,
  variable_codigo text NOT NULL,
  sensor_modelo text NOT NULL,
  PRIMARY KEY (nodo_id, variable_codigo),
  FOREIGN KEY (nodo_id) REFERENCES public.nodos (id) ON DELETE RESTRICT,
  FOREIGN KEY (variable_codigo) REFERENCES public.variables (codigo) ON DELETE RESTRICT
 );

CREATE TABLE public.mediciones (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  cultivo_id uuid NOT NULL,
  nodo_id uuid NOT NULL,
  variable_codigo text NOT NULL,
  mensaje_id text NOT NULL,
  valor numeric(12,4) NOT NULL,
  tomada_en timestamptz NOT NULL,
  recibida_en timestamptz NOT NULL DEFAULT now(),
  origen text NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (nodo_id, mensaje_id, variable_codigo),
  UNIQUE (id, cultivo_id, nodo_id, variable_codigo, origen),
  UNIQUE (id, cultivo_id, origen),
  FOREIGN KEY (cultivo_id) REFERENCES public.cultivos (id) ON DELETE RESTRICT,
  FOREIGN KEY (nodo_id, variable_codigo) REFERENCES public.nodo_variables (nodo_id, variable_codigo) ON DELETE RESTRICT,
  CHECK (valor <> 'NaN'::numeric),
  CHECK (origen IN ('real','simulado')),
  CHECK (length(btrim(mensaje_id)) > 0)
 );

CREATE TABLE public.reglas_alerta (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  cultivo_id uuid NOT NULL,
  variable_codigo text NOT NULL,
  operador text NOT NULL,
  umbral numeric(12,4) NOT NULL,
  prioridad smallint NOT NULL,
  activa boolean NOT NULL DEFAULT true,
  hora_inicio time,
  hora_fin time,
  zona_horaria text NOT NULL DEFAULT 'America/Bogota',
  PRIMARY KEY (id),
  UNIQUE (id, cultivo_id, variable_codigo),
  FOREIGN KEY (cultivo_id) REFERENCES public.cultivos (id) ON DELETE RESTRICT,
  FOREIGN KEY (variable_codigo) REFERENCES public.variables (codigo) ON DELETE RESTRICT,
  CHECK (operador IN ('lt','lte','gt','gte')),
  CHECK (umbral <> 'NaN'::numeric),
  CHECK (prioridad BETWEEN 1 AND 3),
  CHECK ((hora_inicio IS NULL) = (hora_fin IS NULL)),
  CHECK (hora_inicio IS NULL OR hora_inicio <> hora_fin)
 );

CREATE TABLE public.alertas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  regla_id uuid NOT NULL,
  cultivo_id uuid NOT NULL,
  nodo_id uuid NOT NULL,
  variable_codigo text NOT NULL,
  origen text NOT NULL,
  medicion_inicio_id uuid NOT NULL,
  medicion_ultima_id uuid NOT NULL,
  prioridad smallint NOT NULL,
  descripcion text NOT NULL,
  criterio jsonb NOT NULL,
  abierta_en timestamptz NOT NULL DEFAULT now(),
  revisada_en timestamptz,
  cerrada_en timestamptz,
  PRIMARY KEY (id),
  FOREIGN KEY (regla_id, cultivo_id, variable_codigo) REFERENCES public.reglas_alerta (id, cultivo_id, variable_codigo) ON DELETE RESTRICT,
  FOREIGN KEY (medicion_inicio_id, cultivo_id, nodo_id, variable_codigo, origen) REFERENCES public.mediciones (id, cultivo_id, nodo_id, variable_codigo, origen) ON DELETE RESTRICT,
  FOREIGN KEY (medicion_ultima_id, cultivo_id, nodo_id, variable_codigo, origen) REFERENCES public.mediciones (id, cultivo_id, nodo_id, variable_codigo, origen) ON DELETE RESTRICT,
  CHECK (prioridad BETWEEN 1 AND 3),
  CHECK (origen IN ('real','simulado')),
  CHECK (jsonb_typeof(criterio) = 'object'),
  CHECK (revisada_en IS NULL OR revisada_en >= abierta_en),
  CHECK (cerrada_en IS NULL OR cerrada_en >= abierta_en)
 );

CREATE TABLE public.sugerencias_ia (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  cultivo_id uuid NOT NULL,
  contenido text NOT NULL,
  modelo text NOT NULL,
  generada_en timestamptz NOT NULL DEFAULT now(),
  origen text NOT NULL,
  contexto_desde timestamptz NOT NULL,
  contexto_hasta timestamptz NOT NULL,
  contexto jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (id),
  UNIQUE (id, cultivo_id, origen),
  FOREIGN KEY (cultivo_id) REFERENCES public.cultivos (id) ON DELETE RESTRICT,
  CHECK (length(btrim(contenido)) > 0),
  CHECK (length(btrim(modelo)) > 0),
  CHECK (origen IN ('real','simulado')),
  CHECK (contexto_desde <= contexto_hasta AND contexto_hasta <= generada_en),
  CHECK (jsonb_typeof(contexto) = 'object')
 );

CREATE TABLE public.sugerencia_mediciones (
  sugerencia_id uuid NOT NULL,
  medicion_id uuid NOT NULL,
  cultivo_id uuid NOT NULL,
  origen text NOT NULL,
  PRIMARY KEY (sugerencia_id, medicion_id),
  FOREIGN KEY (sugerencia_id, cultivo_id, origen) REFERENCES public.sugerencias_ia (id, cultivo_id, origen) ON DELETE RESTRICT,
  FOREIGN KEY (medicion_id, cultivo_id, origen) REFERENCES public.mediciones (id, cultivo_id, origen) ON DELETE RESTRICT
 );

CREATE TABLE public.predicciones (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  cultivo_id uuid NOT NULL,
  nodo_id uuid NOT NULL,
  variable_codigo text NOT NULL DEFAULT 'temperatura_aire',
  valor numeric(12,4) NOT NULL,
  modelo text NOT NULL,
  origen text NOT NULL,
  generada_en timestamptz NOT NULL DEFAULT now(),
  objetivo_en timestamptz NOT NULL,
  vigente_hasta timestamptz NOT NULL,
  referencia_desde timestamptz NOT NULL,
  referencia_hasta timestamptz NOT NULL,
  PRIMARY KEY (id),
  FOREIGN KEY (cultivo_id) REFERENCES public.cultivos (id) ON DELETE RESTRICT,
  FOREIGN KEY (nodo_id, variable_codigo) REFERENCES public.nodo_variables (nodo_id, variable_codigo) ON DELETE RESTRICT,
  CHECK (variable_codigo = 'temperatura_aire'),
  CHECK (valor <> 'NaN'::numeric),
  CHECK (origen IN ('real','simulado')),
  CHECK (objetivo_en > generada_en),
  CHECK (vigente_hasta > generada_en AND vigente_hasta <= objetivo_en),
  CHECK (referencia_desde < referencia_hasta AND referencia_hasta <= generada_en),
  CHECK (length(btrim(modelo)) > 0)
 );

CREATE UNIQUE INDEX una_alerta_abierta_por_regla_nodo_origen ON public.alertas (regla_id,nodo_id,origen) WHERE cerrada_en IS NULL;
CREATE INDEX mediciones_consulta ON public.mediciones (cultivo_id,nodo_id,variable_codigo,origen,tomada_en DESC);
CREATE INDEX sugerencias_consulta ON public.sugerencias_ia (cultivo_id,generada_en DESC);
CREATE INDEX predicciones_consulta ON public.predicciones (cultivo_id,nodo_id,generada_en DESC);
CREATE INDEX cultivos_propietario ON public.cultivos (agricultor_id);
CREATE INDEX nodos_propietario ON public.nodos (agricultor_id);

INSERT INTO public.variables (codigo,nombre,unidad,valor_min,valor_max) VALUES ('temperatura_aire','Temperatura del aire','°C',NULL,NULL), ('humedad_aire','Humedad relativa del aire','% HR',0,100), ('iluminacion_relativa','Iluminación relativa','% relativo',0,100);

-- Iluminación: normalización propuesta de 0 a 100; no representa lux.

-- Valida la asociación actual al insertar; el cultivo de la lectura queda histórico.
CREATE FUNCTION public.validar_nueva_medicion() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE destino uuid; habilitado boolean; minimo numeric; maximo numeric;
BEGIN
  SELECT n.cultivo_id,n.habilitado INTO destino,habilitado
    FROM public.nodos n WHERE n.id = NEW.nodo_id FOR SHARE;
  IF NOT FOUND OR NOT habilitado OR destino IS NULL OR destino <> NEW.cultivo_id THEN
    RAISE EXCEPTION 'Nodo no habilitado o no vinculado al cultivo' USING ERRCODE = '23514';
  END IF;
  SELECT v.valor_min,v.valor_max INTO minimo,maximo FROM public.variables v
    WHERE v.codigo = NEW.variable_codigo;
  IF (minimo IS NOT NULL AND NEW.valor < minimo) OR (maximo IS NOT NULL AND NEW.valor > maximo) THEN
    RAISE EXCEPTION 'Valor fuera del rango admisible' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER validar_medicion BEFORE INSERT ON public.mediciones
FOR EACH ROW EXECUTE FUNCTION public.validar_nueva_medicion();

-- El soporte de alertas y sugerencias conserva observaciones inmutables.
CREATE FUNCTION public.impedir_cambio_medicion() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Una medición confirmada no se modifica; registre una nueva' USING ERRCODE = '23514';
END; $$;
CREATE TRIGGER medicion_inmutable BEFORE UPDATE ON public.mediciones
FOR EACH ROW EXECUTE FUNCTION public.impedir_cambio_medicion();

ALTER TABLE public.perfiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.perfiles FROM anon, authenticated;
GRANT SELECT ON TABLE public.perfiles TO authenticated;
GRANT ALL ON TABLE public.perfiles TO service_role;
CREATE POLICY leer_propios ON public.perfiles FOR SELECT TO authenticated USING (id = (select auth.uid()));

ALTER TABLE public.cultivos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cultivos FROM anon, authenticated;
GRANT SELECT ON TABLE public.cultivos TO authenticated;
GRANT ALL ON TABLE public.cultivos TO service_role;
CREATE POLICY leer_propios ON public.cultivos FOR SELECT TO authenticated USING (agricultor_id = (select auth.uid()));

ALTER TABLE public.nodos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nodos FROM anon, authenticated;
GRANT SELECT ON TABLE public.nodos TO authenticated;
GRANT ALL ON TABLE public.nodos TO service_role;
CREATE POLICY leer_propios ON public.nodos FOR SELECT TO authenticated USING (agricultor_id = (select auth.uid()));

ALTER TABLE public.variables ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.variables FROM anon, authenticated;
GRANT SELECT ON TABLE public.variables TO authenticated;
GRANT ALL ON TABLE public.variables TO service_role;
CREATE POLICY leer_propios ON public.variables FOR SELECT TO authenticated USING (true);

ALTER TABLE public.nodo_variables ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nodo_variables FROM anon, authenticated;
GRANT SELECT ON TABLE public.nodo_variables TO authenticated;
GRANT ALL ON TABLE public.nodo_variables TO service_role;
CREATE POLICY leer_propios ON public.nodo_variables FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.nodos n WHERE n.id = nodo_variables.nodo_id AND n.agricultor_id = (select auth.uid())));

ALTER TABLE public.mediciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mediciones FROM anon, authenticated;
GRANT SELECT ON TABLE public.mediciones TO authenticated;
GRANT ALL ON TABLE public.mediciones TO service_role;
CREATE POLICY leer_propios ON public.mediciones FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.cultivos c WHERE c.id = mediciones.cultivo_id AND c.agricultor_id = (select auth.uid())));

ALTER TABLE public.reglas_alerta ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.reglas_alerta FROM anon, authenticated;
GRANT SELECT ON TABLE public.reglas_alerta TO authenticated;
GRANT ALL ON TABLE public.reglas_alerta TO service_role;
CREATE POLICY leer_propios ON public.reglas_alerta FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.cultivos c WHERE c.id = reglas_alerta.cultivo_id AND c.agricultor_id = (select auth.uid())));

ALTER TABLE public.alertas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.alertas FROM anon, authenticated;
GRANT SELECT ON TABLE public.alertas TO authenticated;
GRANT ALL ON TABLE public.alertas TO service_role;
CREATE POLICY leer_propios ON public.alertas FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.cultivos c WHERE c.id = alertas.cultivo_id AND c.agricultor_id = (select auth.uid())));

ALTER TABLE public.sugerencias_ia ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sugerencias_ia FROM anon, authenticated;
GRANT SELECT ON TABLE public.sugerencias_ia TO authenticated;
GRANT ALL ON TABLE public.sugerencias_ia TO service_role;
CREATE POLICY leer_propios ON public.sugerencias_ia FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.cultivos c WHERE c.id = sugerencias_ia.cultivo_id AND c.agricultor_id = (select auth.uid())));

ALTER TABLE public.sugerencia_mediciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sugerencia_mediciones FROM anon, authenticated;
GRANT SELECT ON TABLE public.sugerencia_mediciones TO authenticated;
GRANT ALL ON TABLE public.sugerencia_mediciones TO service_role;
CREATE POLICY leer_propios ON public.sugerencia_mediciones FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.cultivos c WHERE c.id = sugerencia_mediciones.cultivo_id AND c.agricultor_id = (select auth.uid())));

ALTER TABLE public.predicciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.predicciones FROM anon, authenticated;
GRANT SELECT ON TABLE public.predicciones TO authenticated;
GRANT ALL ON TABLE public.predicciones TO service_role;
CREATE POLICY leer_propios ON public.predicciones FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.cultivos c WHERE c.id = predicciones.cultivo_id AND c.agricultor_id = (select auth.uid())));

-- Las RPC de escritura autorizada se diseñan aparte; todavía no se habilitan escrituras del navegador.
-- Las funciones de trigger no son RPC públicas.
REVOKE EXECUTE ON FUNCTION public.validar_nueva_medicion() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.impedir_cambio_medicion() FROM PUBLIC, anon, authenticated;
COMMIT;
