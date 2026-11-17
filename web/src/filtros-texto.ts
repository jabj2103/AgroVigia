// Texto de los filtros, separado de los componentes para poder probarlo sin navegador.
// Compara sin distinguir mayusculas ni tildes; todas las palabras de la consulta deben aparecer.
export const plano = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function coincide(texto: string, consulta: string): boolean {
  const palabras = plano(consulta).split(/\s+/).filter(Boolean), base = plano(texto);
  return palabras.every(p => base.includes(p));
}
