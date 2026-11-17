-- Ejecutar completo con rol postgres DESPUES de 0007, 0008 y 0009. Repetirlo no duplica nada.
-- Tres hexagonos de 6 nodos en la cuenta duena del nodo fisico agv-dht22-01:
--   Platano:    el cultivo REAL de agv-dht22-01 + 5 nodos virtuales (los 4 de provisionar-simulacion.sql + 1).
--   Yuca:       cultivo de demostracion 'Simulado · Yuca' + 6 nodos virtuales.
--   Hortalizas: cultivo de demostracion 'Simulado · Hortalizas de clima cálido' + 6 nodos virtuales.
-- Cada cultivo tiene los cuatro sectores del croquis (norte, sur, central, drenaje). Los nodos virtuales
-- siguen la convencion de Juan: sim-<12 primeros hex del cultivo>-NN, diez capacidades SIMULADOR_V3.
-- No crea mediciones ni toca el nodo fisico ni sus reglas reales. Al cultivo real solo se le asigna la
-- plantilla platano si no tenia. Las reglas creadas son de origen 'simulado'.
-- Si un nodo existente no coincide (otra cuenta, otro cultivo o zona, deshabilitado, otras capacidades)
-- el script aborta en vez de apropiarselo.
BEGIN;
DO $$
DECLARE
  cuenta uuid; real_cultivo uuid; cultivo uuid; c public.cultivos; t public.cultivo_plantillas; z public.zonas; n public.nodos;
  cod text; zona_codigo text; px numeric; py numeric; cantidad integer;
  zonas_cod CONSTANT text[] := ARRAY['zona-norte','zona-sur','zona-central','zona-drenaje'];
  zonas_nom CONSTANT text[] := ARRAY['Sector norte','Sector sur','Sector central','Sector de drenaje'];
  -- Nodos 01..04: uno por sector al centro (igual que provisionar-simulacion.sql); 05 y 06: segundo punto en norte y sur.
  ubic_zona CONSTANT int[] := ARRAY[1,2,3,4,1,2];
  ubic_x CONSTANT numeric[] := ARRAY[0.5,0.5,0.5,0.5,0.25,0.75];
  ubic_y CONSTANT numeric[] := ARRAY[0.5,0.5,0.5,0.5,0.3,0.7];
  variables CONSTANT text[] := ARRAY['temperatura_aire','humedad_aire','iluminacion_relativa','radiacion_solar','humedad_suelo_vwc',
    'temperatura_suelo','ph_suelo','conductividad_suelo_ece','precipitacion_60min','velocidad_viento'];
  grupos CONSTANT text[][] := ARRAY[['platano','5','5e5e5e5e-0000-4000-8000-000000000002'],
                                    ['yuca','6','5e5e5e5e-0000-4000-8000-000000000001'],
                                    ['hortalizas','6','5e5e5e5e-0000-4000-8000-000000000003']];
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Usar rol postgres.'; END IF;
  IF to_regclass('public.zonas') IS NULL OR to_regclass('public.cultivo_plantillas') IS NULL THEN
    RAISE EXCEPTION 'Faltan 0007 (zonas) o 0009 (plantillas).';
  END IF;
  SELECT agricultor_id, cultivo_id INTO STRICT cuenta, real_cultivo FROM public.nodos WHERE codigo = 'agv-dht22-01';
  PERFORM 1 FROM public.perfiles WHERE id = cuenta FOR UPDATE;
  FOR g IN 1..3 LOOP
    SELECT * INTO STRICT t FROM public.cultivo_plantillas WHERE codigo = grupos[g][1];
    IF g = 1 AND real_cultivo IS NOT NULL THEN
      cultivo := real_cultivo;
      UPDATE public.cultivos SET plantilla_codigo = t.codigo WHERE id = cultivo AND plantilla_codigo IS NULL;
      IF (SELECT plantilla_codigo FROM public.cultivos WHERE id = cultivo) <> t.codigo THEN
        RAISE NOTICE 'El cultivo real ya tenia otra plantilla; se conserva.';
      END IF;
    ELSE
      INSERT INTO public.cultivos (agricultor_id, nombre, tipo, area, unidad_area, solicitud_id, plantilla_codigo)
      VALUES (cuenta, 'Simulado · ' || t.nombre, t.nombre || ' (simulado)', 0.5, 'ha', grupos[g][3]::uuid, t.codigo)
      ON CONFLICT (agricultor_id, solicitud_id) DO NOTHING;
      SELECT id INTO STRICT cultivo FROM public.cultivos WHERE agricultor_id = cuenta AND solicitud_id = grupos[g][3]::uuid;
    END IF;
    SELECT * INTO STRICT c FROM public.cultivos WHERE id = cultivo FOR UPDATE;
    IF c.archivado_en IS NOT NULL THEN RAISE EXCEPTION 'CULTIVO_ARCHIVADO: %', c.nombre; END IF;

    -- Cuatro sectores del croquis, misma geometria que provisionar-simulacion.sql.
    FOR i IN 1..4 LOOP
      INSERT INTO public.zonas (cultivo_id, codigo, nombre, plano_x, plano_y, plano_ancho, plano_alto)
      VALUES (cultivo, zonas_cod[i], zonas_nom[i], CASE WHEN i IN (1,3) THEN 0.05 ELSE 0.525 END,
              CASE WHEN i <= 2 THEN 0.05 ELSE 0.525 END, 0.425, 0.425)
      ON CONFLICT (cultivo_id, codigo) DO NOTHING;
    END LOOP;

    FOR i IN 1..grupos[g][2]::int LOOP
      cod := 'sim-' || substr(replace(cultivo::text, '-', ''), 1, 12) || '-' || lpad(i::text, 2, '0');
      SELECT * INTO STRICT z FROM public.zonas WHERE cultivo_id = cultivo AND codigo = zonas_cod[ubic_zona[i]];
      SELECT * INTO n FROM public.nodos WHERE codigo = cod FOR UPDATE;
      IF NOT FOUND THEN
        IF (SELECT count(*) FROM public.nodos WHERE cultivo_id = cultivo AND tipo_nodo = 'virtual') >= 16 THEN RAISE EXCEPTION 'LIMITE_VIRTUALES'; END IF;
        INSERT INTO public.nodos (codigo, agricultor_id, cultivo_id, tipo_nodo, zona_id, posicion_x, posicion_y)
        VALUES (cod, cuenta, cultivo, 'virtual', z.id, ubic_x[i], ubic_y[i]) RETURNING * INTO n;
        INSERT INTO public.nodo_variables (nodo_id, variable_codigo, sensor_modelo)
        SELECT n.id, v, 'SIMULADOR_V3' FROM unnest(variables) v;
      ELSIF n.agricultor_id <> cuenta OR n.cultivo_id IS DISTINCT FROM cultivo OR n.tipo_nodo <> 'virtual'
            OR n.zona_id IS DISTINCT FROM z.id OR NOT n.habilitado THEN
        RAISE EXCEPTION 'NODO_EXISTENTE_NO_COINCIDE: %', cod;
      END IF;
      SELECT count(*) INTO cantidad FROM public.nodo_variables WHERE nodo_id = n.id;
      IF cantidad <> 10 OR EXISTS (SELECT 1 FROM public.nodo_variables WHERE nodo_id = n.id
          AND (sensor_modelo <> 'SIMULADOR_V3' OR NOT variable_codigo = ANY (variables))) THEN
        RAISE EXCEPTION 'CAPACIDADES_VIRTUALES_NO_COINCIDEN: %', cod;
      END IF;
    END LOOP;

    -- Reglas SIMULADAS desde la plantilla que tenga el cultivo: aire y humedad del suelo.
    INSERT INTO public.reglas_alerta (cultivo_id, variable_codigo, origen, minimo, maximo)
    SELECT cultivo, x.variable, 'simulado', x.minimo, x.maximo
    FROM public.cultivo_plantillas p
    CROSS JOIN LATERAL (VALUES ('temperatura_aire', p.temperatura_min, p.temperatura_max),
                               ('humedad_aire', p.humedad_min, p.humedad_max),
                               ('humedad_suelo_vwc', p.suelo_vwc_min, p.suelo_vwc_max)) x(variable, minimo, maximo)
    WHERE p.codigo = (SELECT plantilla_codigo FROM public.cultivos WHERE id = cultivo)
      AND NOT EXISTS (SELECT 1 FROM public.reglas_alerta r WHERE r.cultivo_id = cultivo
                      AND r.variable_codigo = x.variable AND r.origen = 'simulado' AND r.habilitada);
  END LOOP;
END $$;
COMMIT;

-- Resultado esperado: 3 filas (un hexagono por cultivo) con 6 nodos, 4 sectores y 3 reglas simuladas.
SELECT c.nombre AS cultivo, c.plantilla_codigo,
       count(n.id) AS nodos, count(n.id) FILTER (WHERE n.tipo_nodo = 'virtual') AS virtuales,
       (SELECT count(*) FROM public.zonas z WHERE z.cultivo_id = c.id) AS sectores,
       (SELECT count(*) FROM public.reglas_alerta r WHERE r.cultivo_id = c.id AND r.origen = 'simulado' AND r.habilitada) AS reglas_simuladas
FROM public.cultivos c JOIN public.nodos n ON n.cultivo_id = c.id
WHERE c.id IN (SELECT cultivo_id FROM public.nodos WHERE tipo_nodo = 'virtual')
GROUP BY c.id ORDER BY min(n.codigo);
