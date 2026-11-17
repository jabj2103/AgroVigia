// Condiciones simuladas: lo que esta activo ahora (Alertas) y el registro de cambios (Historial).
// Un evento de clima o un ajuste manual son datos de prueba puestos por el agricultor, no una medicion.
import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cargarCondiciones, resumenAjustes } from './simulacion-data.ts';
import type { CondicionSimulada } from './simulacion-data.ts';
import { EVENTOS_CLIMA, INTENSIDADES } from './escenario-data.ts';
import { IconoClima } from './iconos-clima.tsx';
import { antiguedad, fechaBogota } from './domain.ts';
import type { Cultivo } from './types.ts';

const titulo = (c: CondicionSimulada) => c.tipo === 'clima' ? `${EVENTOS_CLIMA[c.evento!].nombre}, intensidad ${INTENSIDADES[c.intensidad ?? 2]?.toLowerCase()}` : 'Ajuste manual';
const detalle = (c: CondicionSimulada) => c.tipo === 'clima' ? EVENTOS_CLIMA[c.evento!].efecto : resumenAjustes(c.ajustes ?? {}) || 'Sin cambios';
function Icono({ c }: { c: CondicionSimulada }) {
  return c.tipo === 'clima' ? <IconoClima evento={c.evento!} />
    : <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></svg>;
}

function usarCondiciones(client: SupabaseClient, ids: string, soloActivas: boolean, revision: number) {
  const [lista, setLista] = useState<CondicionSimulada[] | null>(null), [error, setError] = useState(''), [tick, setTick] = useState(0), [ahora, setAhora] = useState(Date.now());
  useEffect(() => { const t = window.setInterval(() => { if (!document.hidden) { setTick(x => x + 1); setAhora(Date.now()); } }, 30_000); return () => window.clearInterval(t); }, []);
  useEffect(() => {
    const abort = new AbortController();
    cargarCondiciones(client, ids.split(',').filter(Boolean), soloActivas, abort.signal).then(l => { setLista(l); setError(''); setAhora(Date.now()); })
      .catch(e => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : 'No pudimos consultar las condiciones simuladas.'); });
    return () => abort.abort();
  }, [client, ids, soloActivas, revision, tick]);
  return { lista, error, ahora };
}

// Alertas: que condiciones simuladas estan activas en el cultivo, para leer las alertas con ese contexto.
export function CondicionesActivas({ client, cultivo, revision, verEscenario }: { client: SupabaseClient; cultivo: Cultivo; revision: number; verEscenario: () => void }) {
  const { lista, error, ahora } = usarCondiciones(client, cultivo.id, true, revision);
  return <section className="condiciones" aria-label="Condiciones simuladas activas">
    <div className="sim-cabecera"><div><h2>Condiciones simuladas activas</h2>
      <p role="status">{!lista ? 'Consultando…' : lista.length ? 'Estas condiciones de prueba están cambiando los datos simulados de este cultivo.' : 'No hay clima ni ajuste manual activo en este cultivo.'}</p></div>
      <button type="button" className="btn boton-secundario" onClick={verEscenario}>Abrir Escenario</button></div>
    {error && <p className="aviso neutral" role="status">{error}</p>}
    {!!lista?.length && <ul className="condiciones-lista">{lista.map(c => <li key={c.id} className="condicion">
      <span className="condicion-icono"><Icono c={c} /></span>
      <div><strong>{titulo(c)}</strong><p>{detalle(c)}</p><span className="condicion-tiempo">Activa desde {antiguedad(c.iniciado_en, ahora).toLowerCase()}</span></div>
    </li>)}</ul>}
    <p className="esc-nota">Las alertas se abren por reglas fijas sobre los valores que llegan. Las que nacen de estas condiciones aparecen en Datos simulados; las del nodo físico, en Datos reales.</p>
  </section>;
}

// Historial: registro de cada evento de clima y de cada ajuste manual, con inicio y fin.
export function RegistroSimulacion({ client, cultivoId, revision }: { client: SupabaseClient; cultivoId: string; revision: number }) {
  const { lista, error } = usarCondiciones(client, cultivoId, false, revision);
  return <section className="resultado-historial registro-simulacion" aria-label="Registro de la simulación">
    <span className="sobre-titulo">REGISTRO DE LA SIMULACIÓN</span>
    <h2>Cambios de clima y ajustes manuales</h2>
    <p className="esc-nota">Cada cambio hecho en el Escenario queda aquí con su inicio y su fin. Sirve para leer las curvas de los nodos simulados y la proyección del nodo físico.</p>
    {error && <p className="aviso neutral" role="status">{error}</p>}
    {lista && !lista.length && <p className="aviso neutral">Todavía no se ha activado ningún clima ni ajuste manual en este cultivo.</p>}
    {!!lista?.length && <ol className="registro-lista">{lista.map(c => <li key={c.id} className="condicion">
      <span className="condicion-icono"><Icono c={c} /></span>
      <div><strong>{titulo(c)}</strong><p>{detalle(c)}</p>
        <span className="condicion-tiempo">{fechaBogota(c.iniciado_en)} {c.finalizado_en ? 'hasta ' + fechaBogota(c.finalizado_en) : '· sigue activo'}</span></div>
      <span className={'estado ' + (c.finalizado_en ? 'neutral' : 'revisar')}>{c.finalizado_en ? 'Terminado' : 'Activo'}</span>
    </li>)}</ol>}
  </section>;
}
