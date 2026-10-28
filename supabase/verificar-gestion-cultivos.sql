-- Solo lectura, despues de 0004. Las tres primeras columnas deben ser true;
-- las dos ultimas, false.
SELECT
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cultivos' AND column_name='archivado_en') AS columna_archivado,
  has_function_privilege('authenticated','public.crear_cultivo(text,text,numeric,text,uuid[],uuid)','EXECUTE') AS puede_crear_por_funcion,
  has_function_privilege('authenticated','public.editar_cultivo(uuid,text,text,numeric,text)','EXECUTE')
    AND has_function_privilege('authenticated','public.archivar_cultivo(uuid)','EXECUTE') AS puede_editar_archivar_por_funcion,
  has_function_privilege('anon','public.crear_cultivo(text,text,numeric,text,uuid[],uuid)','EXECUTE') AS anon_puede_crear,
  has_table_privilege('authenticated','public.cultivos','INSERT') AS escritura_directa;
