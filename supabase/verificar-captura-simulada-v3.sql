-- SOLO LECTURA. Sustituye el UUID por el de la captura enviada desde el panel.
SELECT m.mensaje_id,n.codigo AS nodo_codigo,z.codigo AS zona_codigo,m.origen,
 count(*)::int AS cantidad_variables,count(DISTINCT m.variable_codigo)::int AS variables_distintas,
 min(m.tomada_en) AS tomada_en,min(m.recibida_en) AS recibida_en,
 bool_and(m.metadatos->>'version_payload'='3') AS version_v3,
 jsonb_object_agg(m.variable_codigo,jsonb_build_object('valor',m.valor,'unidad',m.metadatos->>'unidad')) AS valores
FROM public.mediciones m
JOIN public.nodos n ON n.id=m.nodo_id
LEFT JOIN public.zonas z ON z.id=m.zona_id
WHERE m.mensaje_id='00000000-0000-4000-8000-000000000000'
GROUP BY m.mensaje_id,n.codigo,z.codigo,m.origen;
-- Esperado: una fila, origen simulado, cantidades 10/10 y version_v3 true.
-- Reenviar la misma captura no debe aumentar las cantidades.
