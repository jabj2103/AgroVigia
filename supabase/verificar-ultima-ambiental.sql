-- Solo lectura. Ejecutar tras aplicar 0003 y recibir una captura REAL v2 nueva.
-- Esperado: tres filas del mismo UUID/captura/recepcion/cultivo/nodo.
WITH ultimo AS (
  SELECT m.mensaje_id,m.nodo_id FROM public.mediciones m
  JOIN public.nodos n ON n.id=m.nodo_id
  WHERE n.codigo='agv-dht22-01' AND m.origen='real'
    AND m.metadatos->>'version_payload'='2'
  ORDER BY m.tomada_en DESC,m.recibida_en DESC,m.mensaje_id DESC LIMIT 1
)
SELECT n.codigo,m.mensaje_id,m.variable_codigo,m.valor,v.unidad,
       m.tomada_en,m.recibida_en,m.origen,m.cultivo_id,
       m.metadatos->'ldr'->>'metodo' AS metodo_ldr,
       m.metadatos->'ldr'->>'adc_promedio' AS adc_promedio
FROM public.mediciones m JOIN ultimo u ON u.nodo_id=m.nodo_id AND u.mensaje_id=m.mensaje_id
JOIN public.nodos n ON n.id=m.nodo_id JOIN public.variables v ON v.codigo=m.variable_codigo
WHERE m.origen='real' ORDER BY m.variable_codigo;