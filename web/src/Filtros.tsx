// Piezas para acortar listas largas: un buscador y un desplegable propio con busqueda dentro.
// El desplegable no usa el <select> del navegador: es un boton que abre una lista, con teclado completo
// (flechas, Inicio, Fin, Enter, Escape y escribir para buscar).
import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { coincide, plano } from './filtros-texto.ts';
export { coincide };

export function Buscador({ etiqueta, valor, alCambiar, marcador }: { etiqueta: string; valor: string; alCambiar: (v: string) => void; marcador?: string }) {
  const id = useId();
  return <div className="buscador">
    <label className="form-label" htmlFor={id}>{etiqueta}</label>
    <div className="buscador-caja">
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input id={id} type="search" className="form-control" autoComplete="off" placeholder={marcador} value={valor} onChange={e => alCambiar(e.target.value)} />
      {valor && <button type="button" className="buscador-limpiar" aria-label="Borrar la búsqueda" onClick={() => alCambiar('')}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg></button>}
    </div>
  </div>;
}

export interface Opcion { valor: string; texto: string; detalle?: string; grupo?: string }
export function Selector({ etiqueta, valor, opciones, alCambiar, conBusqueda, id: idBoton, desactivado, claseEtiqueta }: { etiqueta: string; valor: string; opciones: Opcion[]; alCambiar: (v: string) => void; conBusqueda?: boolean;
  id?: string; desactivado?: boolean; claseEtiqueta?: string }) {
  const id = useId(), raiz = useRef<HTMLDivElement>(null), boton = useRef<HTMLButtonElement>(null), campo = useRef<HTMLInputElement>(null), lista = useRef<HTMLUListElement>(null);
  const [abierto, setAbierto] = useState(false), [q, setQ] = useState(''), [activa, setActiva] = useState(0);
  const buscar = conBusqueda ?? opciones.length > 6, actual = opciones.find(o => o.valor === valor) ?? opciones[0];
  const filtradas = useMemo(() => opciones.filter(o => coincide(o.texto + ' ' + (o.detalle ?? '') + ' ' + (o.grupo ?? ''), q)), [opciones, q]);
  function abrir() { setQ(''); setActiva(Math.max(0, opciones.findIndex(o => o.valor === valor))); setAbierto(true); }
  function cerrar(devolverFoco: boolean) { setAbierto(false); if (devolverFoco) boton.current?.focus(); }
  function elegir(o: Opcion | undefined) { if (!o) return; alCambiar(o.valor); cerrar(true); }
  // Al abrir, el foco pasa al buscador (o a la lista) y la opcion vigente queda a la vista.
  useEffect(() => { if (!abierto) return; (buscar ? campo.current : lista.current)?.focus(); }, [abierto, buscar]);
  useEffect(() => { if (abierto) lista.current?.querySelector('[data-activa=true]')?.scrollIntoView({ block: 'nearest' }); }, [abierto, activa, filtradas.length]);
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: PointerEvent) => { if (!raiz.current?.contains(e.target as Node)) setAbierto(false); };
    document.addEventListener('pointerdown', fuera); return () => document.removeEventListener('pointerdown', fuera);
  }, [abierto]);
  function teclas(e: KeyboardEvent) {
    const n = filtradas.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiva(a => Math.min(n - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiva(a => Math.max(0, a - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActiva(0); }
    else if (e.key === 'End') { e.preventDefault(); setActiva(Math.max(0, n - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); elegir(filtradas[activa]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(true); }
    else if (e.key === 'Tab') cerrar(false);
    else if (!buscar && e.key.length === 1) { const i = filtradas.findIndex(o => plano(o.texto).startsWith(plano(e.key))); if (i >= 0) setActiva(i); }
  }
  return <div className="selector" ref={raiz}>
    <span className={claseEtiqueta ?? 'form-label'} id={id + 'e'}>{etiqueta}</span>
    <button ref={boton} id={idBoton} type="button" className="selector-boton" data-valor={valor} disabled={desactivado} aria-haspopup="listbox" aria-expanded={abierto} aria-labelledby={`${id}e ${id}v`}
      onClick={() => abierto ? cerrar(false) : abrir()} onKeyDown={e => { if (!abierto && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); abrir(); } }}>
      <span id={id + 'v'}>{actual?.texto ?? 'Elegir'}</span>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    {abierto && <div className="selector-panel">
      {buscar && <input ref={campo} className="form-control" type="search" autoComplete="off" role="combobox" aria-expanded="true" aria-controls={id + 'l'} aria-autocomplete="list"
        aria-activedescendant={filtradas[activa] ? `${id}o${activa}` : undefined} aria-label={'Buscar en ' + etiqueta.toLowerCase()} placeholder="Escribe para buscar" value={q}
        onChange={e => { setQ(e.target.value); setActiva(0); }} onKeyDown={teclas} />}
      <ul ref={lista} id={id + 'l'} role="listbox" aria-labelledby={id + 'e'} tabIndex={buscar ? -1 : 0} aria-activedescendant={!buscar && filtradas[activa] ? `${id}o${activa}` : undefined} onKeyDown={buscar ? undefined : teclas}>
        {filtradas.map((o, i) => <Fragment key={o.valor}>{o.grupo && o.grupo !== filtradas[i - 1]?.grupo && <li className="selector-grupo" role="presentation">{o.grupo}</li>}
          <li id={`${id}o${i}`} role="option" data-valor={o.valor} aria-selected={o.valor === valor} data-activa={i === activa} onPointerEnter={() => setActiva(i)} onClick={() => elegir(o)}>
            <span>{o.texto}</span>{o.detalle && <small>{o.detalle}</small>}</li></Fragment>)}
        {!filtradas.length && <li className="selector-vacio" role="presentation">Sin resultados para "{q}"</li>}
      </ul>
    </div>}
  </div>;
}
