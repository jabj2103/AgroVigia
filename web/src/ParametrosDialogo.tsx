// Parametros del cultivo: parte del catalogo de cultivos y permite un ajuste propio de los doce rangos.
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Dialogo } from './Dialogo.tsx';
import { cargarPlantillas } from './alert-data.ts';
import type { Plantilla } from './alert-data.ts';
import { CAMPOS_RANGOS, GRUPOS_RANGOS, SUFIJOS_RANGO, ajustarParametros, cargarParametros, restablecerParametros, validarRangos, limitesPorPorcentaje } from './escenario-data.ts';
import type { Rangos } from './escenario-data.ts';
import type { Cultivo, Origen } from './types.ts';

const aTexto = (r: Record<string, unknown>) => Object.fromEntries(CAMPOS_RANGOS.map(c => [c, r[c] === undefined || r[c] === null ? '' : String(Number(r[c])).replace('.', ',')]));

export default function ParametrosDialogo({ client, cultivo, origenes, alGuardar, alCerrar }: {
  client: SupabaseClient; cultivo: Cultivo; origenes: Origen[]; alGuardar: () => void; alCerrar: () => void;
}) {
  const [plantillas, setPlantillas] = useState<Plantilla[] | null>(null), [propio, setPropio] = useState<Rangos | null>(null);
  const [campos, setCampos] = useState<Record<string, string>>({}), [base, setBase] = useState('');
  const [reglas, setReglas] = useState(true), [origen, setOrigen] = useState<Origen>(origenes.includes('simulado') ? 'simulado' : 'real');
  const [cargando, setCargando] = useState(true), [ocupado, setOcupado] = useState(false), [error, setError] = useState(''), [aviso, setAviso] = useState('');
  const [margen, setMargen] = useState('15');
  function porPorcentaje() {
    try { setCampos(limitesPorPorcentaje(campos, margen)); setBase(''); setError(''); setAviso(`Límites de alerta calculados con un margen de ${margen.trim()} % sobre el rango óptimo. Revísalos y guarda.`); }
    catch (err) { setError(err instanceof Error ? err.message : 'Revisa el margen.'); setAviso(''); }
  }
  const plantilla = plantillas?.find(p => p.codigo === cultivo.plantilla_codigo) ?? null;
  useEffect(() => {
    const abort = new AbortController();
    Promise.all([cargarPlantillas(client, abort.signal), cargarParametros(client, cultivo.id, abort.signal)]).then(([lista, ajuste]) => {
      const propia = lista.find(p => p.codigo === cultivo.plantilla_codigo);
      setPlantillas(lista); setPropio(ajuste);
      setCampos(aTexto((ajuste ?? propia ?? {}) as Record<string, unknown>)); setBase(ajuste ? 'propio' : propia?.codigo ?? '');
    }).catch(e => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : 'No pudimos consultar los parámetros.'); })
      .finally(() => { if (!abort.signal.aborted) setCargando(false); });
    return () => abort.abort();
  }, [client, cultivo.id, cultivo.plantilla_codigo]);
  function guardar(e: FormEvent) {
    e.preventDefault();
    if (ocupado) return;
    let rangos: Rangos;
    try { rangos = validarRangos(campos); } catch (err) { setError(err instanceof Error ? err.message : 'Revisa los rangos.'); setAviso(''); return; }
    setOcupado(true); setError(''); setAviso('');
    ajustarParametros(client, cultivo.id, rangos, reglas, origen).then(() => { setPropio(rangos); setBase('propio'); setAviso('Parámetros guardados para este cultivo.' + (reglas ? ' Las reglas de alerta se actualizaron.' : '')); alGuardar(); })
      .catch(err => setError(err instanceof Error ? err.message : 'No pudimos guardar.')).finally(() => setOcupado(false));
  }
  function restablecer() {
    if (ocupado) return;
    setOcupado(true); setError(''); setAviso('');
    restablecerParametros(client, cultivo.id).then(() => { setPropio(null); setCampos(aTexto((plantilla ?? {}) as unknown as Record<string, unknown>)); setBase(plantilla?.codigo ?? '');
      setAviso('El cultivo volvió a los rangos de su plantilla. Las reglas de alerta vigentes no cambiaron.'); alGuardar(); })
      .catch(err => setError(err instanceof Error ? err.message : 'No pudimos restablecer.')).finally(() => setOcupado(false));
  }
  return <Dialogo titulo="Parámetros del cultivo" alCerrar={alCerrar}
    detalle={<>{cultivo.nombre} · {propio ? 'con ajuste propio' : plantilla ? 'usa la plantilla ' + plantilla.nombre : 'sin plantilla'}</>}>
    {error && <p className="aviso error" role="alert">{error}</p>}{aviso && <p className="aviso exito" role="status">{aviso}</p>}
    {cargando ? <p role="status" className="dlg-vacio">Consultando el catálogo de cultivos…</p> : plantillas && <form onSubmit={guardar} noValidate>
      <fieldset className="grupo-opciones"><legend>Partir de los valores de</legend>
        {propio && <label className="opcion-ficha"><input type="radio" name="base-rangos" checked={base === 'propio'} disabled={ocupado} onChange={() => { setBase('propio'); setCampos(aTexto(propio)); }} /><span>Mi ajuste</span></label>}
        {plantillas.map(p => <label key={p.codigo} className="opcion-ficha"><input type="radio" name="base-rangos" checked={base === p.codigo} disabled={ocupado}
          onChange={() => { setBase(p.codigo); setCampos(aTexto(p as unknown as Record<string, unknown>)); }} /><span>{p.nombre}</span></label>)}
      </fieldset>
      <p className="dlg-nota">El catálogo trae rangos orientativos para trópico bajo, no validados en campo. Ajústalos a tu cultivo: se usan en las alertas, el historial, las sugerencias de IA y la simulación.</p>
      {GRUPOS_RANGOS.map(g => <fieldset className="rangos-grupo" key={g.prefijo}><legend>{g.nombre} <span>({g.unidad})</span></legend>
        <div className="rangos-campos">{SUFIJOS_RANGO.map(([sufijo, etiqueta]) => { const id = 'rango-' + g.prefijo + sufijo; return <div key={sufijo}>
          <label className="form-label" htmlFor={id}>{etiqueta}</label>
          <input id={id} className="form-control" inputMode="decimal" autoComplete="off" value={campos[g.prefijo + sufijo] ?? ''} disabled={ocupado}
            onChange={e => { setCampos(c => ({ ...c, [g.prefijo + sufijo]: e.target.value })); setBase(''); }} /></div>; })}</div>
      </fieldset>)}
      <fieldset className="rangos-grupo"><legend>Límites por porcentaje</legend>
        <p className="dlg-nota">Si prefieres trabajar con un margen, escribe el rango óptimo arriba y calcula aquí los límites de alerta: óptimo desde menos el porcentaje y óptimo hasta más el porcentaje.</p>
        <div className="rangos-porcentaje"><div><label className="form-label" htmlFor="rango-margen">Margen sobre el óptimo (%)</label>
          <input id="rango-margen" className="form-control campo-corto" inputMode="decimal" autoComplete="off" value={margen} disabled={ocupado} onChange={e => setMargen(e.target.value)} /></div>
          <button type="button" className="btn boton-secundario" disabled={ocupado} onClick={porPorcentaje}>Calcular límites de alerta</button></div>
      </fieldset>
      <label className="opcion-nodo"><input type="checkbox" checked={reglas} disabled={ocupado} onChange={e => setReglas(e.target.checked)} />Actualizar también las reglas de alerta con estos límites</label>
      {reglas && origenes.length > 1 && <fieldset className="grupo-opciones"><legend>Reglas para</legend>
        {origenes.map(o => <label key={o} className="opcion-ficha"><input type="radio" name="origen-reglas" checked={origen === o} disabled={ocupado} onChange={() => setOrigen(o)} /><span>{o === 'real' ? 'Datos reales' : 'Datos simulados'}</span></label>)}
      </fieldset>}
      {reglas && <p className="dlg-nota">{origen === 'simulado' ? 'Se actualizan las reglas de temperatura, humedad del aire y humedad del suelo de los datos simulados.' : 'Se actualizan las reglas de temperatura y humedad del aire de los datos reales. El nodo físico no mide el suelo.'}</p>}
      <div className="dlg-acciones">
        <button className="btn boton-principal" disabled={ocupado}>{ocupado ? 'Guardando…' : 'Guardar parámetros'}</button>
        {propio && plantilla && <button type="button" className="btn boton-secundario" disabled={ocupado} onClick={restablecer}>Volver a la plantilla {plantilla.nombre}</button>}
      </div>
    </form>}
  </Dialogo>;
}
