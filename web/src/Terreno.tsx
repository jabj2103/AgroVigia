// Terreno del cultivo a escala real: medidas en metros, sectores que el agricultor dibuja o escribe, y
// ubicacion de cada nodo con sus distancias. Todo lo que se puede hacer con el puntero sobre el plano
// tambien se puede hacer con los campos del formulario.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, PointerEvent as PunteroReact } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Confirmar } from './Dialogo.tsx';
import { ajustarRect, cargarTerreno, crearSector, definirTerreno, distanciaMetros, editarSector, eliminarSector, medidasDe, metros, posicionNodo, sectorEn, ubicarNodo } from './terreno-data.ts';
import type { CultivoTerreno, Sector, Terreno as DatosTerreno } from './terreno-data.ts';
import './escenario.css';

type Rect = { x: number; y: number; ancho: number; alto: number };
const numero = (t: string) => Number(t.trim().replace(',', '.'));
const texto = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',');
// Paso "redondo" (1, 2 o 5 por una potencia de diez) para la cuadricula y la barra de escala.
function pasoRedondo(total: number, partes: number) { const bruto = total / partes, p = 10 ** Math.floor(Math.log10(bruto)), m = bruto / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; }

export default function Terreno({ client, cultivo, alVolver, actualizado }: { client: SupabaseClient; cultivo: CultivoTerreno; alVolver: () => void; actualizado: () => void }) {
  const [datos, setDatos] = useState<DatosTerreno | null>(null), [recarga, setRecarga] = useState(0);
  const [error, setError] = useState(''), [aviso, setAviso] = useState(''), [ocupado, setOcupado] = useState(false);
  const base = medidasDe(cultivo), [ancho, setAncho] = useState(texto(base.ancho)), [largo, setLargo] = useState(texto(base.largo));
  const [medidas, setMedidas] = useState(base);
  const [modo, setModo] = useState<'ver' | 'dibujar' | 'colocar'>('ver'), [trazo, setTrazo] = useState<Rect | null>(null);
  const [sectorId, setSectorId] = useState<string | 'nuevo' | ''>(''), [nodoId, setNodoId] = useState('');
  const [campos, setCampos] = useState({ nombre: '', x: '0', y: '0', ancho: '0', alto: '0' }), [borrar, setBorrar] = useState<Sector | null>(null);
  const svg = useRef<SVGSVGElement>(null), inicio = useRef<{ x: number; y: number } | null>(null), formulario = useRef<HTMLFormElement>(null), finTrazo = useRef(0);

  useEffect(() => {
    const abort = new AbortController();
    cargarTerreno(client, { ...cultivo, ancho_m: medidas.declaradas ? medidas.ancho : null, largo_m: medidas.declaradas ? medidas.largo : null }, abort.signal)
      .then(t => { setDatos({ ...t, medidas }); setError(''); }).catch(e => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : 'No pudimos consultar el terreno.'); });
    return () => abort.abort();
  }, [client, cultivo, medidas, recarga]);

  const W = 1000, H = Math.round(Math.min(2000, Math.max(350, 1000 * medidas.largo / medidas.ancho)));
  const sectores = datos?.sectores ?? [], nodos = datos?.nodos ?? [];
  const puntos = useMemo(() => new Map(nodos.map(n => [n.id, posicionNodo(n, sectores, medidas)])), [nodos, sectores, medidas]);
  const nodo = nodos.find(n => n.id === nodoId), puntoNodo = nodo ? puntos.get(nodo.id) ?? null : null;
  const distancias = puntoNodo ? nodos.filter(n => n.id !== nodoId && puntos.get(n.id)).map(n => ({ n, p: puntos.get(n.id)!, d: distanciaMetros(puntoNodo, puntos.get(n.id)!) })).sort((a, b) => a.d - b.d) : [];
  const paso = pasoRedondo(medidas.ancho, 5), barra = pasoRedondo(medidas.ancho, 4);

  // Tras guardar se relee solo el terreno. La cuenta completa se actualiza unicamente al cambiar las medidas.
  // Al entrar a dibujar o a colocar un nodo, el plano se trae a la vista: los botones pueden estar lejos de el.
  useEffect(() => {
    if (modo === 'ver') return;
    // Tras el siguiente pintado, cuando el resto de la pantalla ya tomo su tamano definitivo.
    const t = window.setTimeout(() => svg.current?.parentElement?.scrollIntoView({ block: 'nearest', behavior: 'instant' }), 60);
    return () => window.clearTimeout(t);
  }, [modo]);
  const hecho = (mensaje: string) => { setAviso(mensaje); setError(''); setRecarga(r => r + 1); };
  function accion(p: Promise<string>) { if (ocupado) return; setOcupado(true); setError(''); setAviso(''); p.then(hecho).catch(e => setError(e instanceof Error ? e.message : 'No pudimos guardar.')).finally(() => setOcupado(false)); }

  function guardarMedidas(e: FormEvent) {
    e.preventDefault();
    const a = numero(ancho), l = numero(largo);
    if (!(a >= 1 && a <= 20000 && l >= 1 && l <= 20000)) { setError('Escribe el ancho y el largo en metros, entre 1 y 20.000.'); return; }
    accion(definirTerreno(client, cultivo.id, a, l).then(() => { setMedidas({ ancho: a, largo: l, declaradas: true }); actualizado(); return `Terreno de ${metros(a)} por ${metros(l)} guardado. Las distancias entre nodos ya usan estas medidas.`; }));
  }
  const aCampos = (nombre: string, r: Rect) => setCampos({ nombre, x: texto(r.x * medidas.ancho), y: texto(r.y * medidas.largo), ancho: texto(r.ancho * medidas.ancho), alto: texto(r.alto * medidas.largo) });
  const mostrarFormulario = () => window.requestAnimationFrame(() => { formulario.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' }); formulario.current?.querySelector<HTMLInputElement>('#sector-nombre')?.focus({ preventScroll: true }); });
  function elegirSector(s: Sector) { setSectorId(s.id); setNodoId(''); setModo('ver'); aCampos(s.nombre, { x: s.plano_x, y: s.plano_y, ancho: s.plano_ancho, alto: s.plano_alto }); mostrarFormulario(); }
  function nuevoSector(r?: Rect) { setSectorId('nuevo'); setNodoId(''); aCampos('', r ?? { x: 0.05, y: 0.05, ancho: 0.4, alto: 0.4 }); mostrarFormulario(); }
  function guardarSector(e: FormEvent) {
    e.preventDefault();
    const v = [campos.x, campos.y, campos.ancho, campos.alto].map(numero);
    if (!campos.nombre.trim() || v.some(n => !Number.isFinite(n) || n < 0)) { setError('Escribe un nombre y medidas válidas en metros.'); return; }
    const d = { nombre: campos.nombre, ...ajustarRect(v[0]! / medidas.ancho, v[1]! / medidas.largo, v[2]! / medidas.ancho, v[3]! / medidas.largo) };
    accion(sectorId === 'nuevo' ? crearSector(client, cultivo.id, d).then(s => { setSectorId(''); return `Sector ${s.nombre} creado. Puedes dibujar el siguiente.`; })
      : editarSector(client, sectorId, d).then(s => { setSectorId(''); return `Sector ${s.nombre} guardado.`; }));
  }
  // Puntero sobre el plano: dibujar un sector arrastrando, o colocar el nodo elegido con un toque.
  function fraccion(e: PunteroReact) {
    const m = svg.current!.getScreenCTM(); if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: Math.min(1, Math.max(0, p.x / W)), y: Math.min(1, Math.max(0, p.y / H)) };
  }
  function bajar(e: PunteroReact<SVGSVGElement>) {
    if (modo === 'dibujar') { inicio.current = fraccion(e); setTrazo({ ...inicio.current, ancho: 0, alto: 0 }); e.currentTarget.setPointerCapture(e.pointerId); return; }
    if (modo === 'colocar' && nodo) {
      const p = fraccion(e), s = sectorEn(p.x, p.y, sectores);
      if (!s) { setError('Toca dentro de un sector: los nodos se ubican siempre en un sector.'); return; }
      setModo('ver');
      accion(ubicarNodo(client, nodo.id, s.id, (p.x - s.plano_x) / s.plano_ancho, (p.y - s.plano_y) / s.plano_alto).then(() => `${nodo.codigo} ubicado en ${s.nombre}, a ${metros(p.x * medidas.ancho)} del borde izquierdo y ${metros(p.y * medidas.largo)} del borde superior.`));
    }
  }
  function mover(e: PunteroReact) { if (modo !== 'dibujar' || !inicio.current) return; const p = fraccion(e), i = inicio.current; setTrazo({ x: Math.min(i.x, p.x), y: Math.min(i.y, p.y), ancho: Math.abs(p.x - i.x), alto: Math.abs(p.y - i.y) }); }
  function soltar() {
    if (modo !== 'dibujar' || !inicio.current || !trazo) return;
    inicio.current = null; finTrazo.current = Date.now(); setModo('ver');
    const r = ajustarRect(trazo.x, trazo.y, trazo.ancho, trazo.alto); setTrazo(null);
    if (sectorId && sectorId !== 'nuevo') { aCampos(campos.nombre, r); mostrarFormulario(); } else nuevoSector(r);
  }
  // Vista previa del sector que se esta creando o editando, tal como quedaria con las medidas del formulario.
  const previa = (() => { if (!sectorId) return null; const v = [campos.x, campos.y, campos.ancho, campos.alto].map(numero); if (v.some(n => !Number.isFinite(n) || n < 0)) return null;
    return ajustarRect(v[0]! / medidas.ancho, v[1]! / medidas.largo, v[2]! / medidas.ancho, v[3]! / medidas.largo); })();
  function ubicarConCampos(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!nodo) return;
    const f = new FormData(e.currentTarget), x = numero(String(f.get('x') ?? '')) / medidas.ancho, y = numero(String(f.get('y') ?? '')) / medidas.largo, s = Number.isFinite(x) && Number.isFinite(y) ? sectorEn(x, y, sectores) : null;
    if (!s) { setError('Ese punto no cae dentro de ningún sector. Revisa las distancias o crea un sector ahí.'); return; }
    accion(ubicarNodo(client, nodo.id, s.id, (x - s.plano_x) / s.plano_ancho, (y - s.plano_y) / s.plano_alto).then(() => `${nodo.codigo} ubicado en ${s.nombre}.`));
  }

  return <section className="terreno" aria-label={'Terreno de ' + cultivo.nombre} aria-busy={ocupado}>
    <div className="sim-cabecera"><div><span className="sobre-titulo">TERRENO Y SECTORES</span><h2>{cultivo.nombre}</h2>
      <p>{metros(medidas.ancho)} de ancho por {metros(medidas.largo)} de largo{medidas.declaradas ? '' : ' (estimado como un cuadrado a partir del área registrada)'}.</p></div>
      <button type="button" className="btn boton-secundario" onClick={alVolver}>Volver a mis cultivos</button></div>
    <form className="terreno-medidas" onSubmit={guardarMedidas}>
      <div><label className="form-label" htmlFor="terreno-ancho">Ancho del terreno (m)</label><input id="terreno-ancho" className="form-control campo-corto" inputMode="decimal" autoComplete="off" value={ancho} disabled={ocupado} onChange={e => setAncho(e.target.value)} /></div>
      <div><label className="form-label" htmlFor="terreno-largo">Largo del terreno (m)</label><input id="terreno-largo" className="form-control campo-corto" inputMode="decimal" autoComplete="off" value={largo} disabled={ocupado} onChange={e => setLargo(e.target.value)} /></div>
      <button className="btn boton-secundario" disabled={ocupado}>Guardar medidas</button>
    </form>

    <div className="terreno-barra">
      <button type="button" className="btn boton-principal" aria-pressed={modo === 'dibujar'} disabled={ocupado || !datos} onClick={() => { if (modo !== 'dibujar') { setSectorId(''); setNodoId(''); } setModo(modo === 'dibujar' ? 'ver' : 'dibujar'); setTrazo(null); }}>{modo === 'dibujar' ? 'Cancelar dibujo' : 'Dibujar sector'}</button>
      <button type="button" className="btn boton-secundario" disabled={ocupado || !datos} onClick={() => nuevoSector()}>Nuevo sector con medidas</button>
      <p>{modo === 'dibujar' ? 'Arrastra sobre el plano para marcar el sector.' : modo === 'colocar' && nodo ? `Toca el punto del plano donde está ${nodo.codigo}.` : `Escala: cada cuadro mide ${metros(paso)}.`}</p>
    </div>
    <p className="terreno-estado" data-tono={error ? 'error' : aviso ? 'exito' : 'neutro'} role={error ? 'alert' : 'status'}>{error || aviso || (ocupado ? 'Guardando…' : '')}</p>

    {sectorId && <form ref={formulario} className="terreno-form terreno-sector" onSubmit={guardarSector} noValidate>
          <h3>{sectorId === 'nuevo' ? 'Nuevo sector' : 'Editar sector'}</h3>
          <p className="dlg-nota">El recuadro punteado del plano muestra cómo queda. Cambia las medidas aquí o vuelve a dibujarlo.</p>
          <div><label className="form-label" htmlFor="sector-nombre">Nombre</label><input id="sector-nombre" className="form-control" maxLength={60} autoComplete="off" value={campos.nombre} disabled={ocupado} onChange={e => setCampos(c => ({ ...c, nombre: e.target.value }))} /></div>
          <div className="rangos-campos">{([['x', 'Desde el borde izquierdo (m)'], ['y', 'Desde el borde superior (m)'], ['ancho', 'Ancho (m)'], ['alto', 'Largo (m)']] as const).map(([k, etiqueta]) => <div key={k}>
            <label className="form-label" htmlFor={'sector-' + k}>{etiqueta}</label><input id={'sector-' + k} className="form-control" inputMode="decimal" autoComplete="off" value={campos[k]} disabled={ocupado} onChange={e => setCampos(c => ({ ...c, [k]: e.target.value }))} /></div>)}</div>
          <div className="dlg-acciones"><button className="btn boton-principal" disabled={ocupado}>{ocupado ? 'Guardando…' : sectorId === 'nuevo' ? 'Crear sector' : 'Guardar sector'}</button>
            {sectorId !== 'nuevo' && <button type="button" className="btn boton-peligro" disabled={ocupado} onClick={() => setBorrar(sectores.find(s => s.id === sectorId) ?? null)}>Eliminar sector</button>}
            <button type="button" className="btn boton-secundario" disabled={ocupado} onClick={() => { setModo('dibujar'); setTrazo(null); }}>Dibujar de nuevo</button>
            <button type="button" className="btn boton-secundario" disabled={ocupado} onClick={() => setSectorId('')}>{sectorId === 'nuevo' ? 'Descartar' : 'Cerrar'}</button></div>
        </form>}

    <div className="terreno-plano" data-modo={modo}>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} style={{ aspectRatio: `${W} / ${H}` }} role="img" aria-label={`Plano del terreno con ${sectores.length} sectores y ${nodos.length} nodos`}
        onPointerDown={bajar} onPointerMove={mover} onPointerUp={soltar} onPointerCancel={() => { inicio.current = null; setTrazo(null); }}>
        <rect className="plano-fondo" x="0" y="0" width={W} height={H} />
        {Array.from({ length: Math.floor(medidas.ancho / paso) }, (_, i) => <line key={'v' + i} className="plano-cuadricula" x1={(i + 1) * paso / medidas.ancho * W} y1="0" x2={(i + 1) * paso / medidas.ancho * W} y2={H} />)}
        {Array.from({ length: Math.floor(medidas.largo / paso) }, (_, i) => <line key={'h' + i} className="plano-cuadricula" x1="0" y1={(i + 1) * paso / medidas.largo * H} x2={W} y2={(i + 1) * paso / medidas.largo * H} />)}
        {sectores.map(s => <g key={s.id} className="plano-sector" data-elegido={s.id === sectorId} onClick={() => { if (modo === 'ver' && Date.now() - finTrazo.current > 400) elegirSector(s); }}>
          <rect x={s.plano_x * W} y={s.plano_y * H} width={s.plano_ancho * W} height={s.plano_alto * H} rx="8" />
          <text x={s.plano_x * W + 14} y={s.plano_y * H + 34}>{s.nombre}</text>
          <text className="plano-medida" x={s.plano_x * W + 14} y={s.plano_y * H + 62}>{metros(s.plano_ancho * medidas.ancho)} × {metros(s.plano_alto * medidas.largo)}</text></g>)}
        {previa && !trazo && <rect className="plano-trazo" x={previa.x * W} y={previa.y * H} width={previa.ancho * W} height={previa.alto * H} rx="8" />}
        {trazo && <rect className="plano-trazo" x={trazo.x * W} y={trazo.y * H} width={trazo.ancho * W} height={trazo.alto * H} rx="8" />}
        {puntoNodo && distancias.slice(0, 6).map(({ n, p, d }) => <g key={n.id} className="plano-distancia">
          <line x1={puntoNodo.fx * W} y1={puntoNodo.fy * H} x2={p.fx * W} y2={p.fy * H} />
          <text x={(puntoNodo.fx + p.fx) / 2 * W} y={(puntoNodo.fy + p.fy) / 2 * H - 8}>{metros(d)}</text></g>)}
        {nodos.map(n => { const p = puntos.get(n.id); return p && <g key={n.id} className="plano-nodo" data-tipo={n.tipo_nodo} data-elegido={n.id === nodoId} onClick={e => { if (modo !== 'ver') return; e.stopPropagation(); setNodoId(n.id); setSectorId(''); }}>
          {n.tipo_nodo === 'fisico' ? <rect x={p.fx * W - 13} y={p.fy * H - 13} width="26" height="26" rx="5" /> : <circle cx={p.fx * W} cy={p.fy * H} r="13" />}
          <text x={p.fx * W + 20} y={p.fy * H + 7}>{n.codigo.replace(/^sim-[a-z0-9]+-(?=[a-z0-9]+$)/, 'sim-')}</text></g>; })}
        <g className="plano-escala"><line x1="20" y1={H - 24} x2={20 + barra / medidas.ancho * W} y2={H - 24} /><text x="20" y={H - 36}>{metros(barra)}</text></g>
      </svg>
    </div>
    <ul className="esc-leyenda" aria-label="Leyenda del plano"><li><span className="plano-marca" data-tipo="fisico" aria-hidden="true" />Nodo físico</li><li><span className="plano-marca" data-tipo="virtual" aria-hidden="true" />Nodo simulado</li></ul>

    <div className="terreno-paneles">
      <section className="terreno-panel" aria-label="Sectores"><h3>Sectores</h3>
        {datos && !sectores.length && <p className="dlg-nota">Todavía no hay sectores. Dibuja el primero sobre el plano o créalo con medidas.</p>}
        <ul className="terreno-lista">{sectores.map(s => <li key={s.id}><div><strong>{s.nombre}</strong><span>{metros(s.plano_ancho * medidas.ancho)} × {metros(s.plano_alto * medidas.largo)} · {nodos.filter(n => n.zona_id === s.id).length} nodos</span></div>
          <button type="button" className="boton-fila" aria-label={'Editar ' + s.nombre} aria-pressed={s.id === sectorId} onClick={() => elegirSector(s)}>Editar</button></li>)}</ul>
      </section>

      <section className="terreno-panel" aria-label="Nodos"><h3>Nodos</h3>
        {datos && !nodos.length && <p className="dlg-nota">Este cultivo no tiene nodos. Agrégalos desde Mis cultivos o Dispositivos.</p>}
        <ul className="terreno-lista">{nodos.map(n => { const p = puntos.get(n.id), s = sectores.find(z => z.id === n.zona_id); return <li key={n.id}>
          <div><strong>{n.codigo}</strong><span>{n.tipo_nodo === 'virtual' ? 'Simulado' : 'Físico'} · {p && s ? `${s.nombre}, a ${metros(p.x)} y ${metros(p.y)} de los bordes` : 'sin ubicar'}</span></div>
          <button type="button" className="boton-fila" aria-label={'Ubicar ' + n.codigo} aria-pressed={n.id === nodoId} onClick={() => { setNodoId(n.id); setSectorId(''); setModo('ver'); }}>Ubicar</button></li>; })}</ul>
        {nodo && <form className="terreno-form" key={nodo.id} onSubmit={ubicarConCampos} noValidate>
          <h4>Ubicar {nodo.codigo}</h4>
          <div className="rangos-campos"><div><label className="form-label" htmlFor="nodo-x">Desde el borde izquierdo (m)</label><input id="nodo-x" name="x" className="form-control" inputMode="decimal" autoComplete="off" defaultValue={puntoNodo ? texto(puntoNodo.x) : ''} disabled={ocupado} /></div>
            <div><label className="form-label" htmlFor="nodo-y">Desde el borde superior (m)</label><input id="nodo-y" name="y" className="form-control" inputMode="decimal" autoComplete="off" defaultValue={puntoNodo ? texto(puntoNodo.y) : ''} disabled={ocupado} /></div></div>
          <div className="dlg-acciones"><button className="btn boton-principal" disabled={ocupado || !sectores.length}>Guardar ubicación</button>
            <button type="button" className="btn boton-secundario" aria-pressed={modo === 'colocar'} disabled={ocupado || !sectores.length} onClick={() => setModo(modo === 'colocar' ? 'ver' : 'colocar')}>{modo === 'colocar' ? 'Cancelar' : 'Tocar en el plano'}</button></div>
          {!!distancias.length && <><h4>Distancias desde {nodo.codigo}</h4>
            <ul className="terreno-distancias">{distancias.map(({ n, d }) => <li key={n.id}><span>{n.codigo}</span><strong>{metros(d)}</strong></li>)}</ul></>}
          {!sectores.length && <p className="dlg-nota">Crea primero un sector: los nodos se ubican dentro de un sector.</p>}
        </form>}
      </section>
    </div>
    {borrar && <Confirmar titulo={'Eliminar ' + borrar.nombre} accion="Eliminar sector" alCerrar={() => setBorrar(null)}
      texto="El sector se borra del plano. Solo es posible si no tiene nodos dentro: muévelos antes a otro sector."
      alConfirmar={() => eliminarSector(client, borrar.id).then(() => { setSectorId(''); hecho(`Sector ${borrar.nombre} eliminado.`); })} />}
  </section>;
}
