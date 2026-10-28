-- Solo lectura: ultimo lote SIMULADO DHT22. Comparar UUID con Publicar/n8n.
WITH ultimo AS (
  SELECT m.nodo_id, m.mensaje_id
  FROM public.mediciones m
  JOIN public.nodos n ON n.id=m.nodo_id
  WHERE n.codigo='agv-dht22-01' AND m.origen='simulado'
  ORDER BY m.recibida_en DESC, m.id DESC LIMIT 1
)
SELECT m.mensaje_id, m.origen, n.codigo AS nodo, c.nombre AS cultivo,
       m.variable_codigo, m.valor, v.unidad, m.tomada_en, m.recibida_en
FROM ultimo u
JOIN public.mediciones m ON m.nodo_id=u.nodo_id AND m.mensaje_id=u.mensaje_id
JOIN public.nodos n ON n.id=m.nodo_id
JOIN public.cultivos c ON c.id=m.cultivo_id
JOIN public.variables v ON v.codigo=m.variable_codigo
ORDER BY m.variable_codigo;
