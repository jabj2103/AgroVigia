// Detalle de un nodo: que datos esta enviando, su conexion (con pausa de recepcion) y su dispositivo.
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Dialogo } from './Dialogo.tsx';
import { TEXTO_CONEXION, estadoConexion, tonoConexion, ventanaConexionMs } from './red-data.ts';
import type { EstadoNodoRed } from './red-data.ts';
import { EVENTOS_CLIMA, PROTOCOLOS, cargarLoteNodo, cargarTiposDispositivo, configurarDispositivo, pausarNodo } from './escenario-data.ts';
import type { LecturaVariable, TipoDispositivo } from './escenario-data.ts';
import { VARIABLES_ZONA } from './zone-domain.ts';
import { antiguedad, fechaBogota } from './domain.ts';

const numero = (v: number) => v.toLocaleString('es-CO', { maximumFractionDigits: 1 });
const unidad = (u: string) => u === 'sin unidad' ? '' : u;

export default function NodoDialogo({ client, nodo, ahora, alCambiar, alCerrar, verHistorial }: {
  client: SupabaseClient; nodo: EstadoNodoRed; ahora: number; alCambiar: () => void; alCerrar: () => void; verHistorial: (cultivoId: string) => void;
}) {
  const conexion = estadoConexion(nodo, ahora), tono = tonoConexion(conexion), origen = nodo.simulado ? 'simulado' as const : 'real' as const;
  const [lote, setLote] = useState<{ mensaje: string; filas: LecturaVariable[] } | null>(null), [errorLote, setErrorLote] = useState('');
  const [tipos, setTipos] = useState<TipoDispositivo[] | null>(null), [errorTipos, setErrorTipos] = useState('');
  const [tipo, setTipo] = useState(nodo.tipo_dispositivo ?? (nodo.simulado ? 'virtual' : 'esp32'));
  const [manual, setManual] = useState(!!nodo.configuracion_manual), [protocolo, setProtocolo] = useState(nodo.protocolo ?? '');
  const [intervalo, setIntervalo] = useState(String(nodo.intervalo_segundos ?? 60));
  const [ocupado, setOcupado] = useState(''), [error, setError] = useState(''), [aviso, setAviso] = useState('');

  useEffect(() => {
    if (!nodo.mensaje_id || !nodo.cultivo_id) { setLote(null); return; }
    const abort = new AbortController(), mensaje = nodo.mensaje_id;
    cargarLoteNodo(client, nodo, mensaje, origen, abort.signal).then(filas => { setLote({ mensaje, filas }); setErrorLote(''); })
      .catch(e => { if (!abort.signal.aborted) setErrorLote(e instanceof Error ? e.message : 'No pudimos consultar el lote.'); });
    return () => abort.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, nodo.nodo_id, nodo.mensaje_id]);
  useEffect(() => {
    const abort = new AbortController();
    cargarTiposDispositivo(client, abort.signal).then(setTipos).catch(e => { if (!abort.signal.aborted) setErrorTipos(e instanceof Error ? e.message : 'No pudimos consultar los tipos.'); });
    return () => abort.abort();
  }, [client]);

  const disponibles = (tipos ?? []).filter(t => (t.codigo === 'virtual') === nodo.simulado);
  const elegido = disponibles.find(t => t.codigo === tipo) ?? disponibles[0];
  const protocoloElegido = elegido?.protocolos.includes(protocolo) ? protocolo : elegido?.protocolo_defecto ?? '';
  async function ejecutar(clave: string, accion: () => Promise<void>, hecho: string) {
    if (ocupado) return;
    setOcupado(clave); setError(''); setAviso('');
    try { await accion(); setAviso(hecho); alCambiar(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No pudimos completar el cambio.'); }
    finally { setOcupado(''); }
  }
  function guardar(e: FormEvent) {
    e.preventDefault();
    if (!elegido) return;
    const segundos = Number(intervalo);
    if (manual && (!/^\d{2,4}$/.test(intervalo.trim()) || segundos < 10 || segundos > 3600)) { setError('El intervalo va de 10 a 3600 segundos, sin decimales.'); return; }
    void ejecutar('dispositivo', () => configurarDispositivo(client, nodo.nodo_id, elegido.codigo, manual ? protocoloElegido : null, manual ? segundos : null),
      manual ? 'Configuración manual guardada.' : 'Configuración automática aplicada.');
  }
  const filas = lote && lote.mensaje === nodo.mensaje_id ? lote.filas : null;
  const p = nodo.proyeccion;
  return <Dialogo titulo={nodo.codigo} alCerrar={alCerrar}
    detalle={<>{nodo.simulado ? 'Nodo virtual' : 'Nodo físico'} · {nodo.cultivo_nombre ?? 'Sin cultivo asignado'}{nodo.zona_nombre ? ' · ' + nodo.zona_nombre : ''}</>}>
    <p className="dlg-estado"><span className="pastilla-tono" data-tono={tono}><i aria-hidden="true" />{TEXTO_CONEXION[conexion]}</span>
      <span>{nodo.tomada_en ? 'Última captura ' + antiguedad(nodo.tomada_en, ahora).toLowerCase() : 'Aún no ha llegado ninguna captura'}</span></p>
    {error && <p className="aviso error" role="alert">{error}</p>}{aviso && <p className="aviso exito" role="status">{aviso}</p>}

    <section className="dlg-seccion" aria-labelledby="dlg-datos">
      <h3 id="dlg-datos">Datos que está enviando</h3>
      <p className="dlg-nota">{origen === 'simulado' ? 'Datos simulados del servicio de simulación.' : 'Lecturas reales del sensor.'}{nodo.tomada_en ? ' Captura: ' + fechaBogota(nodo.tomada_en) : ''}</p>
      {errorLote ? <p className="aviso error" role="alert">{errorLote}</p>
        : !nodo.mensaje_id ? <p className="dlg-vacio">Todavía no hay datos guardados de este nodo.</p>
        : !filas ? <p role="status" className="dlg-vacio">Consultando el último lote…</p>
        : <dl className="dlg-datos">{VARIABLES_ZONA.filter(v => filas.some(f => f.variable_codigo === v.codigo)).map(v => {
            const f = filas.find(x => x.variable_codigo === v.codigo)!;
            return <div key={v.codigo}><dt>{v.nombre}</dt><dd>{numero(f.valor)} <span>{unidad(v.unidad)}</span></dd></div>;
          })}</dl>}
      {conexion !== 'conectado' && nodo.mensaje_id && <p className="dlg-nota">Este es el último lote guardado; el nodo no está recibiendo ahora.</p>}
      {!nodo.simulado && nodo.clima_evento && <div className="dlg-proyeccion">
        <h4>Con el evento simulado: {EVENTOS_CLIMA[nodo.clima_evento].nombre}</h4>
        {p ? <dl className="dlg-datos">
            {p.temperatura !== null && <div><dt>Temperatura del aire</dt><dd>{numero(p.temperatura)} <span>°C</span></dd></div>}
            {p.humedad !== null && <div><dt>Humedad del aire</dt><dd>{numero(p.humedad)} <span>% HR</span></dd></div>}
            {p.iluminacion !== null && <div><dt>Iluminación relativa</dt><dd>{numero(p.iluminacion)} <span>% relativo</span></dd></div>}
          </dl> : <p className="dlg-vacio">Aún no hay proyección: hace falta una lectura real reciente y el servicio de simulación en marcha.</p>}
        <p className="dlg-nota">Proyección simulada sobre su lectura real. La lectura real guardada no cambia.</p>
      </div>}
      {nodo.cultivo_id && <button type="button" className="btn boton-secundario" onClick={() => verHistorial(nodo.cultivo_id!)}>Ver historial del cultivo</button>}
    </section>

    <section className="dlg-seccion" aria-labelledby="dlg-conexion">
      <h3 id="dlg-conexion">Conexión con el servicio</h3>
      <p className="dlg-nota">Se espera un lote cada {nodo.intervalo_segundos ?? 60} s. Pasa a "Sin recibir" si no llega ninguno en {Math.round(ventanaConexionMs(nodo) / 1000)} s.</p>
      <div className="dlg-interruptor">
        <button type="button" role="switch" aria-checked={!nodo.recepcion_pausada} className="interruptor" disabled={!!ocupado || !nodo.habilitado}
          onClick={() => { void ejecutar('pausa', () => pausarNodo(client, nodo.nodo_id, !nodo.recepcion_pausada), nodo.recepcion_pausada ? 'Recepción reanudada.' : 'Recepción en pausa: sus lotes se rechazan hasta reanudarla.'); }}>
          <span aria-hidden="true" /><span className="visually-hidden">Recepción de datos de este nodo</span>
        </button>
        <div><strong>{nodo.recepcion_pausada ? 'Recepción en pausa' : 'Recepción activa'}</strong>
          <p>{!nodo.habilitado ? 'El equipo deshabilitó este dispositivo.' : nodo.recepcion_pausada ? 'El servicio rechaza lo que envíe este nodo. No se desvincula del cultivo ni se borra su historial.' : 'El servicio guarda lo que envíe este nodo. Apágalo aquí para desconectarlo sin desvincularlo.'}</p></div>
      </div>
    </section>

    <section className="dlg-seccion" aria-labelledby="dlg-dispositivo">
      <h3 id="dlg-dispositivo">Dispositivo</h3>
      {errorTipos ? <p className="aviso error" role="alert">{errorTipos}</p> : !elegido ? <p role="status" className="dlg-vacio">Consultando tipos de dispositivo…</p> : <form onSubmit={guardar}>
        {disponibles.length > 1 && <fieldset className="grupo-opciones"><legend>Tipo de equipo</legend>
          {disponibles.map(t => <label key={t.codigo} className="opcion-ficha"><input type="radio" name="tipo-dispositivo" value={t.codigo} checked={elegido.codigo === t.codigo} disabled={!!ocupado}
            onChange={() => { setTipo(t.codigo); setProtocolo(t.protocolo_defecto); if (!manual) setIntervalo(String(t.intervalo_defecto)); }} /><span>{t.nombre}</span></label>)}
        </fieldset>}
        <p className="dlg-nota"><strong>{elegido.nombre}.</strong> {elegido.descripcion} {elegido.conexion}</p>
        <p className="dlg-nota">{elegido.probado ? 'Probado en este proyecto.' : 'Perfil de configuración: este proyecto todavía no tiene firmware probado para este equipo.'}{elegido.adc_bits ? ` Conversor analógico de ${elegido.adc_bits} bits.` : ''}</p>
        <fieldset className="grupo-opciones"><legend>Configuración</legend>
          <label className="opcion-ficha"><input type="radio" name="modo-dispositivo" checked={!manual} disabled={!!ocupado} onChange={() => { setManual(false); setProtocolo(elegido.protocolo_defecto); setIntervalo(String(elegido.intervalo_defecto)); }} /><span>Automática</span></label>
          <label className="opcion-ficha"><input type="radio" name="modo-dispositivo" checked={manual} disabled={!!ocupado} onChange={() => setManual(true)} /><span>Manual</span></label>
        </fieldset>
        {!manual ? <p className="dlg-nota">Usa los valores del tipo: {PROTOCOLOS[elegido.protocolo_defecto] ?? elegido.protocolo_defecto}, un lote cada {elegido.intervalo_defecto} s.</p> : <>
          {elegido.protocolos.length > 1 && <fieldset className="grupo-opciones"><legend>Protocolo</legend>
            {elegido.protocolos.map(x => <label key={x} className="opcion-ficha"><input type="radio" name="protocolo-dispositivo" checked={protocoloElegido === x} disabled={!!ocupado} onChange={() => setProtocolo(x)} /><span>{PROTOCOLOS[x] ?? x}</span></label>)}
          </fieldset>}
          <label className="form-label" htmlFor="dlg-intervalo">{nodo.simulado ? 'Publicar un lote cada (segundos)' : 'Intervalo esperado entre lotes (segundos)'}</label>
          <input id="dlg-intervalo" className="form-control campo-corto" inputMode="numeric" value={intervalo} disabled={!!ocupado} onChange={e => setIntervalo(e.target.value)} aria-describedby="dlg-intervalo-ayuda" />
          <p id="dlg-intervalo-ayuda" className="dlg-nota">De 10 a 3600. {nodo.simulado ? 'El servicio de simulación publica este nodo con esa cadencia.' : 'No cambia el firmware: indica cada cuánto debería llegar un lote, para decidir si el nodo está recibiendo.'}</p>
        </>}
        <button className="btn boton-principal" disabled={!!ocupado}>{ocupado === 'dispositivo' ? 'Guardando…' : 'Guardar dispositivo'}</button>
      </form>}
    </section>
  </Dialogo>;
}
