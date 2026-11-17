// Crear un nodo simulado en un cultivo, o volver a vincular uno que quedo suelto. En ambos casos se
// elige el cultivo y el sector del croquis donde va a transmitir.
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Dialogo } from './Dialogo.tsx';
import { cargarZonasCultivo, crearNodoVirtual, moverNodoVirtual } from './simulacion-data.ts';
import type { ZonaCultivo } from './simulacion-data.ts';
import type { Cultivo, Nodo } from './types.ts';

export default function NodoVirtualDialogo({ client, cultivos, cultivoInicial, nodo, alGuardar, alCerrar }: {
  client: SupabaseClient; cultivos: Cultivo[]; cultivoInicial?: string; nodo?: Nodo; alGuardar: (mensaje: string) => void; alCerrar: () => void;
}) {
  const activos = cultivos.filter(c => !c.archivado_en);
  const [cultivoId, setCultivoId] = useState(cultivoInicial && activos.some(c => c.id === cultivoInicial) ? cultivoInicial : activos[0]?.id ?? '');
  const [zonas, setZonas] = useState<ZonaCultivo[] | null>(null), [zonaId, setZonaId] = useState('');
  const [ocupado, setOcupado] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    if (!cultivoId) return;
    const abort = new AbortController(); setZonas(null); setZonaId('');
    cargarZonasCultivo(client, cultivoId, abort.signal).then(z => { setZonas(z); setZonaId(z[0]?.id ?? ''); setError(''); })
      .catch(e => { if (!abort.signal.aborted) { setZonas([]); setError(e instanceof Error ? e.message : 'No pudimos consultar los sectores.'); } });
    return () => abort.abort();
  }, [client, cultivoId]);
  function guardar(e: FormEvent) {
    e.preventDefault();
    if (ocupado || !cultivoId || !zonas) return;
    setOcupado(true); setError('');
    const nombre = activos.find(c => c.id === cultivoId)?.nombre ?? 'el cultivo';
    (nodo ? moverNodoVirtual(client, nodo.id, cultivoId, zonaId || null).then(() => `${nodo.codigo} quedó en ${nombre}. Su historial anterior se conserva.`)
      : crearNodoVirtual(client, cultivoId, zonaId || null).then(n => `Nodo simulado ${n.codigo} creado en ${nombre}. Empieza a transmitir con el servicio de simulación.`))
      .then(m => { alGuardar(m); alCerrar(); }).catch(err => setError(err instanceof Error ? err.message : 'No pudimos guardar.')).finally(() => setOcupado(false));
  }
  return <Dialogo titulo={nodo ? (nodo.cultivo_id ? 'Mover ' : 'Vincular ') + nodo.codigo : 'Nuevo nodo simulado'} alCerrar={alCerrar}
    detalle="Un nodo simulado transmite diez variables de prueba: aire, suelo, lluvia y viento.">
    {error && <p className="aviso error" role="alert">{error}</p>}
    {!activos.length ? <p className="dlg-vacio">Primero registra un cultivo activo.</p> : <form onSubmit={guardar}>
      <fieldset className="grupo-opciones"><legend>Cultivo</legend>
        {activos.map(c => <label key={c.id} className="opcion-ficha"><input type="radio" name="nv-cultivo" checked={cultivoId === c.id} disabled={ocupado} onChange={() => setCultivoId(c.id)} /><span>{c.nombre}</span></label>)}
      </fieldset>
      {!zonas ? <p role="status" className="dlg-vacio">Consultando los sectores…</p> : !zonas.length ? <p className="aviso neutral">Este cultivo todavía no tiene sectores. Al recibir su primer nodo simulado se arman sus cuatro sectores (norte, sur, central y drenaje).</p>
        : <fieldset className="grupo-opciones"><legend>Sector donde transmite</legend>
          {zonas.map(z => <label key={z.id} className="opcion-ficha"><input type="radio" name="nv-zona" checked={zonaId === z.id} disabled={ocupado} onChange={() => setZonaId(z.id)} /><span>{z.nombre}</span></label>)}
        </fieldset>}
      <p className="dlg-nota">Sus datos son simulados y se guardan aparte de los reales. Puedes desvincularlo cuando quieras: su historial se conserva.</p>
      <div className="dlg-acciones"><button className="btn boton-principal" disabled={ocupado || !zonas}>{ocupado ? 'Guardando…' : nodo ? (nodo.cultivo_id ? 'Mover nodo' : 'Vincular nodo') : 'Crear nodo simulado'}</button>
        <button type="button" className="btn boton-secundario" disabled={ocupado} onClick={alCerrar}>Cancelar</button></div>
    </form>}
  </Dialogo>;
}
