-- Solo lectura: captura REAL comparada con el monitor serie de Juan.
-- Resultado esperado: dos filas, 28.2 grados Celsius y 51.0 % HR.
SELECT m.id, m.mensaje_id, m.origen, n.codigo AS nodo,
       m.variable_codigo, m.valor, v.unidad, m.tomada_en, m.recibida_en
FROM public.mediciones m
JOIN public.nodos n ON n.id=m.nodo_id
JOIN public.variables v ON v.codigo=m.variable_codigo
WHERE n.codigo='agv-dht22-01' AND m.origen='real'
  AND m.mensaje_id='796c87eb-4154-407e-9426-5701ef058cf7'
ORDER BY m.variable_codigo;
