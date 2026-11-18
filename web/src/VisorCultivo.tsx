// Visor 3D del cultivo en Inicio: el mismo de Simulación (escena-3d.ts) en modo 'inicio', con un solo cultivo.
// Three.js se descarga aparte, solo al abrir Inicio. Sin WebGL se muestra la alternativa (croquis 2D) que recibe.
// El lienzo es decorativo para lectores de pantalla: la lista de nodos de Inicio es la vía accesible y equivalente.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Escena } from './escena-3d.ts';
import { lotesNuevos } from './red-data.ts';
import type { EstadoNodoRed } from './red-data.ts';
import type { Terreno } from './terreno-data.ts';

export default function VisorCultivo({ cultivoId, filas, terreno, alertas, elegido, alElegir, alternativa }: {
  cultivoId: string; filas: EstadoNodoRed[]; terreno: Terreno; alertas: Set<string>; elegido: string | null;
  alElegir: (nodoId: string) => void; alternativa: ReactNode;
}) {
  const lienzo = useRef<HTMLDivElement>(null), escena = useRef<Escena | null>(null), previas = useRef<EstadoNodoRed[] | null>(null);
  const elegir = useRef(alElegir); elegir.current = alElegir;
  const [estado, setEstado] = useState<'cargando' | 'listo' | 'sin-webgl'>('cargando');
  const [ahora, setAhora] = useState(Date.now()), [nuevos, setNuevos] = useState<Set<string>>(new Set());
  const planos = useMemo(() => new Map([[cultivoId, terreno]]), [cultivoId, terreno]);

  useEffect(() => { const t = window.setInterval(() => setAhora(Date.now()), 1000); return () => window.clearInterval(t); }, []);
  useEffect(() => {
    let vivo = true;
    import('./escena-3d.ts').then(m => {
      if (!vivo || !lienzo.current) return;
      try { escena.current = m.crearEscena(lienzo.current, id => elegir.current(id), () => undefined, { modo: 'inicio' }); setEstado('listo'); }
      catch { setEstado('sin-webgl'); }
    }).catch(() => { if (vivo) setEstado('sin-webgl'); });
    return () => { vivo = false; escena.current?.destruir(); escena.current = null; };
  }, []);
  // Pulso verde en el nodo cuyo último lote cambió desde la consulta anterior.
  useEffect(() => { setNuevos(lotesNuevos(previas.current, filas)); previas.current = filas; }, [filas]);
  useEffect(() => { if (estado === 'listo') escena.current?.actualizar(filas, nuevos, ahora, cultivoId, undefined, planos, alertas); }, [estado, filas, nuevos, ahora, cultivoId, planos, alertas]);
  useEffect(() => { if (estado === 'listo') escena.current?.resaltar(elegido); }, [estado, elegido, filas, planos]);

  return <div className="visor-cultivo">
    <div className="escena-red escena-inicio" ref={lienzo} hidden={estado === 'sin-webgl'}>
      {estado === 'cargando' && <p className="visor-cargando" role="status">Cargando el visor 3D…</p>}
    </div>
    {estado === 'sin-webgl' && <>
      <p className="aviso neutral" role="status">Este navegador no permite gráficos 3D (WebGL). Se muestra el croquis plano con la misma información.</p>
      {alternativa}
    </>}
  </div>;
}
