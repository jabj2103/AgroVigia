// Dialogo modal sobre el elemento nativo <dialog>: el navegador atrapa el foco, cierra con Escape y
// devuelve el foco al control que lo abrio. Clic fuera del panel tambien cierra.
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
// Los estilos del dialogo viven en escenario.css. Se importan aqui para que el detalle de nodo de Inicio
// los tenga aunque todavia no se haya abierto Simulacion, Cultivos ni Dispositivos.
import './escenario.css';

// variante 'panel': pantalla completa en el telefono y panel lateral derecho desde 900 px (detalle de nodo).
export function Dialogo({ titulo, detalle, alCerrar, children, variante }: { titulo: string; detalle?: ReactNode; alCerrar: () => void; children: ReactNode; variante?: 'panel' }) {
  const ref = useRef<HTMLDialogElement>(null), id = useId();
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (!d.open) d.showModal();
    // Con un dialogo abierto la pagina de atras no se desplaza. El hueco de la barra se conserva (scrollbar-gutter), asi nada salta.
    const raiz = document.documentElement, abiertos = Number(raiz.dataset.dialogos ?? '0') + 1;
    raiz.dataset.dialogos = String(abiertos); raiz.classList.add('con-dialogo');
    return () => {
      if (d.open) d.close();
      const quedan = Math.max(0, Number(raiz.dataset.dialogos ?? '1') - 1); raiz.dataset.dialogos = String(quedan);
      if (!quedan) raiz.classList.remove('con-dialogo');
    };
  }, []);
  return <dialog ref={ref} className={'dialogo-agv' + (variante === 'panel' ? ' dialogo-panel' : '')} aria-labelledby={id}
    onCancel={e => { e.preventDefault(); alCerrar(); }} onClick={e => { if (e.target === ref.current) alCerrar(); }}>
    <header className="dialogo-cabecera">
      <div><h2 id={id}>{titulo}</h2>{detalle && <p>{detalle}</p>}</div>
      <button type="button" className="dialogo-cerrar" aria-label="Cerrar" onClick={alCerrar}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </header>
    <div className="dialogo-cuerpo">{children}</div>
  </dialog>;
}

// Confirmacion de una accion que no se deshace. El boton usa la variante de peligro en todos los lugares.
// salida: cuando el servidor rechaza la accion con ese codigo, el boton de peligro se cambia por la alternativa segura.
export function Confirmar({ titulo, texto, accion, alConfirmar, alCerrar, salida }: { titulo: string; texto: ReactNode; accion: string; alConfirmar: () => Promise<void>; alCerrar: () => void;
  salida?: { codigo: string; texto: string; accion: () => void } }) {
  const [ocupado, setOcupado] = useState(false), [error, setError] = useState(''), [ofrecer, setOfrecer] = useState(false);
  function confirmar() {
    if (ocupado) return;
    setOcupado(true); setError('');
    alConfirmar().then(alCerrar).catch(e => { setError(e instanceof Error ? e.message : 'No pudimos completar la acción.'); setOfrecer(!!salida && (e as { codigo?: string } | null)?.codigo === salida.codigo); setOcupado(false); });
  }
  return <Dialogo titulo={titulo} alCerrar={alCerrar}>
    {error && <p className="aviso error" role="alert">{error}</p>}
    <p className="dlg-nota">{texto}</p>
    <div className="dlg-acciones">{ofrecer && salida ? <button type="button" className="btn boton-principal" onClick={salida.accion}>{salida.texto}</button>
      : <button type="button" className="btn boton-peligro" disabled={ocupado} onClick={confirmar}>{ocupado ? 'Un momento…' : accion}</button>}
      <button type="button" className="btn boton-secundario" disabled={ocupado} onClick={alCerrar}>Cancelar</button></div>
  </Dialogo>;
}
