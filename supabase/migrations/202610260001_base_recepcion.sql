-- AgroVigia 0001: base de recepcion. Ejecutar UNA vez en un proyecto vacio.
-- Derivada de la propuesta revisada, que permanece intacta.
-- No instala RPC, no recibe MQTT, no crea cuentas ni lecturas.
-- Seis tablas ahora; alertas, sugerencias y predicciones en etapas posteriores.
-- RLS y permisos se publican en la misma transaccion que las tablas.
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
  recibida_en timestamptz NOT NULL,
  origen text NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (nodo_id, mensaje_id, variable_codigo),
  UNIQUE (id, cultivo_id, nodo_id, variable_codigo, origen),
  UNIQUE (id, cultivo_id, origen),
  FOREIGN KEY (cultivo_id) REFERENCES public.cultivos (id) ON DELETE RESTRICT,
  FOREIGN KEY (nodo_id, variable_codigo) REFERENCES public.nodo_variables (nodo_id, variable_codigo) ON DELETE RESTRICT,
  CHECK (valor <> 'NaN'::numeric),
  CHECK (origen IN ('real','simulado')),
  CHECK (length(mensaje_id) = 36 AND mensaje_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
 );


CREATE INDEX cultivos_propietario ON public.cultivos (agricultor_id);
CREATE INDEX nodos_propietario ON public.nodos (agricultor_id);
CREATE INDEX nodos_cultivo ON public.nodos (cultivo_id);
CREATE INDEX capacidades_variable ON public.nodo_variables (variable_codigo);
CREATE INDEX mediciones_consulta ON public.mediciones
  (cultivo_id,nodo_id,variable_codigo,origen,tomada_en DESC);

INSERT INTO public.variables (codigo,nombre,unidad,valor_min,valor_max) VALUES ('temperatura_aire','Temperatura del aire','°C',-40,80), ('humedad_aire','Humedad relativa del aire','% HR',0,100), ('iluminacion_relativa','Iluminación relativa','% relativo',0,100);


-- La fecha de recepcion debe ser explicita; su origen en n8n sigue pendiente.
-- El trigger protege vinculo/rangos, no sustituye la futura RPC de lote atomico.
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
CREATE TRIGGER medicion_inmutable BEFORE UPDATE OR DELETE ON public.mediciones
FOR EACH ROW EXECUTE FUNCTION public.impedir_cambio_medicion();


-- Solo lectura propia desde clientes autenticados. Anonimo sin acceso.
-- service_role tambien queda solo con SELECT hasta una RPC de escritura revisada.
-- Provisionar catalogo/cuenta/cultivo/nodo desde SQL Editor; sin escritura web.
ALTER TABLE public.perfiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.perfiles FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.perfiles TO authenticated;
GRANT SELECT ON TABLE public.perfiles TO service_role;
CREATE POLICY leer_propios ON public.perfiles FOR SELECT TO authenticated USING (id = (select auth.uid()));

ALTER TABLE public.cultivos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cultivos FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.cultivos TO authenticated;
GRANT SELECT ON TABLE public.cultivos TO service_role;
CREATE POLICY leer_propios ON public.cultivos FOR SELECT TO authenticated USING (agricultor_id = (select auth.uid()));

ALTER TABLE public.nodos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nodos FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.nodos TO authenticated;
GRANT SELECT ON TABLE public.nodos TO service_role;
CREATE POLICY leer_propios ON public.nodos FOR SELECT TO authenticated USING (agricultor_id = (select auth.uid()));

ALTER TABLE public.variables ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.variables FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.variables TO authenticated;
GRANT SELECT ON TABLE public.variables TO service_role;
CREATE POLICY leer_propios ON public.variables FOR SELECT TO authenticated USING (true);

ALTER TABLE public.nodo_variables ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nodo_variables FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.nodo_variables TO authenticated;
GRANT SELECT ON TABLE public.nodo_variables TO service_role;
CREATE POLICY leer_propios ON public.nodo_variables FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.nodos n WHERE n.id = nodo_variables.nodo_id AND n.agricultor_id = (select auth.uid())));

ALTER TABLE public.mediciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mediciones FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.mediciones TO authenticated;
GRANT SELECT ON TABLE public.mediciones TO service_role;
CREATE POLICY leer_propios ON public.mediciones FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.cultivos c WHERE c.id = mediciones.cultivo_id AND c.agricultor_id = (select auth.uid())));


REVOKE EXECUTE ON FUNCTION public.validar_nueva_medicion() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.impedir_cambio_medicion() FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
