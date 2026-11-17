// Ajuste manual de la simulacion: una regla por variable, con el cero al centro. Mover a la derecha
// sube el valor simulado y a la izquierda lo baja. Se aplica al pulsar el boton y queda en el historial.
import { useEffect, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AJUSTES, ajustarSimulacion, hayAjustes, limpiarAjustes, mismosAjustes, resumenAjustes, textoAjuste } from './simulacion-data.ts';
import type { Ajustes, DefAjuste } from './simulacion-data.ts';

function Regla({ d, valor, ocupado, alCambiar }: { d: DefAjuste; valor: number; ocupado: boolean; alCambiar: (v: number) => void }) {
  const id = 'regla-' + d.clave, limitar = (v: number) => Math.round(Math.min(d.max, Math.max(d.min, v)) * 10) / 10;
  const pos = (valor - d.min) / (d.max - d.min) * 100, cero = (0 - d.min) / (d.max - d.min) * 100;
  return <div className="regla" data-activa={valor !== 0}>
    <div className="regla-cabecera">
      <label htmlFor={id}>{d.nombre}</label>
      <output htmlFor={id}>{textoAjuste(d, valor)}</output>
    </div>
    <div className="regla-control">
      <button type="button" className="regla-paso" disabled={ocupado || valor <= d.min} aria-label={`${d.baja}: bajar ${d.nombre}`} onClick={() => alCambiar(limitar(valor - d.paso))}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14" /></svg></button>
      <div className="regla-pista" style={{ '--regla-ini': Math.min(cero, pos) + '%', '--regla-fin': Math.max(cero, pos) + '%' } as CSSProperties}>
        <input id={id} type="range" min={d.min} max={d.max} step={d.paso} value={valor} disabled={ocupado}
          aria-valuetext={textoAjuste(d, valor)} onChange={e => alCambiar(limitar(Number(e.target.value)))} /></div>
      <button type="button" className="regla-paso" disabled={ocupado || valor >= d.max} aria-label={`${d.sube}: subir ${d.nombre}`} onClick={() => alCambiar(limitar(valor + d.paso))}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg></button>
    </div>
    <div className="regla-escala" aria-hidden="true"><span>{d.baja}</span><span>{d.sube}</span></div>
    <p className="regla-alcance">{d.fisico ? 'Nodos simulados y proyección del nodo físico.' : 'Solo nodos simulados: el nodo físico no mide esta variable.'}</p>
  </div>;
}

export default function AjusteManual({ client, cultivoId, activos, todosDefecto, alCambiar }: {
  client: SupabaseClient; cultivoId: string; activos: Ajustes; todosDefecto: boolean; alCambiar: () => void;
}) {
  const [valores, setValores] = useState<Ajustes>(activos), [todos, setTodos] = useState(todosDefecto);
  const [ocupado, setOcupado] = useState(false), [error, setError] = useState(''), [aviso, setAviso] = useState('');
  const firma = JSON.stringify(activos);
  // Al cambiar de cultivo o al confirmarse un ajuste, las reglas muestran lo que esta activo.
  useEffect(() => { setValores(JSON.parse(firma) as Ajustes); setError(''); }, [cultivoId, firma]);
  useEffect(() => { setTodos(todosDefecto); }, [todosDefecto]);
  function enviar(ajustes: Ajustes) {
    if (ocupado || !cultivoId) return;
    setOcupado(true); setError(''); setAviso('');
    ajustarSimulacion(client, cultivoId, ajustes, todos).then(n => {
      setAviso(!hayAjustes(ajustes) ? 'Simulación en automático. Los nodos vuelven a seguir el clima elegido.'
        : n === 0 ? 'Ese ajuste ya estaba activo.' : `Ajuste aplicado en ${n === 1 ? 'un cultivo' : n + ' cultivos'}. Los nodos lo reflejan en su siguiente envío y las alertas se evalúan con esos valores.`);
      alCambiar();
    }).catch(e => setError(e instanceof Error ? e.message : 'No pudimos aplicar el ajuste.')).finally(() => setOcupado(false));
  }
  const limpio = limpiarAjustes(valores), sinCambio = mismosAjustes(limpio, activos) && !todos;
  return <form className="esc-ajuste" aria-labelledby="esc-ajuste-titulo" onSubmit={(e: FormEvent) => { e.preventDefault(); enviar(limpio); }}>
    <div className="esc-clima-cabecera">
      <h2 id="esc-ajuste-titulo">Ajuste manual</h2>
      <p role="status" className="esc-clima-activo" data-manual={hayAjustes(activos)}>{hayAjustes(activos) ? 'Manual: ' + resumenAjustes(activos) : 'Automático'}</p>
    </div>
    <p className="esc-nota">Cada regla empieza en el centro, sin cambio. Muévela a la derecha para subir el valor simulado o a la izquierda para bajarlo. El ajuste se suma al clima elegido arriba.</p>
    <div className="reglas">{AJUSTES.map(d => <Regla key={d.clave} d={d} valor={valores[d.clave] ?? 0} ocupado={ocupado} alCambiar={v => setValores(a => ({ ...a, [d.clave]: v }))} />)}</div>
    <div className="esc-clima-pie">
      <label className="opcion-nodo"><input type="checkbox" checked={todos} disabled={ocupado} onChange={e => setTodos(e.target.checked)} />Aplicar a todos mis cultivos</label>
      <div className="dlg-acciones">
        <button type="button" className="btn boton-secundario" disabled={ocupado || (!hayAjustes(activos) && !hayAjustes(limpio))} onClick={() => { setValores({}); enviar({}); }}>Volver a automático</button>
        <button className="btn boton-principal" disabled={ocupado || !cultivoId || sinCambio}>{ocupado ? 'Aplicando…' : 'Aplicar ajuste'}</button>
      </div>
    </div>
    {error && <p className="aviso error" role="alert">{error}</p>}{aviso && <p className="aviso exito" role="status">{aviso}</p>}
    <p className="esc-nota">El nodo físico lee temperatura y humedad del aire (DHT22) y un índice de luz (LDR). Su lectura real nunca se modifica: los ajustes de temperatura y humedad del aire se le aplican como proyección simulada, aparte.</p>
  </form>;
}
