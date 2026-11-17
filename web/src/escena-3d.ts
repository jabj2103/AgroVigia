// Escena 3D del Escenario: un hexagono por cultivo, un nodo por vertice. Solo dibuja; los datos y las
// acciones viven en Escenario.tsx. Verde: recibe. Naranja: no recibe. Gris: en pausa o fuera de servicio.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { RADIO_HEXAGONO, TEXTO_CONEXION, estadoConexion, panalRed, tonoConexion, vertice } from './red-data.ts';
import type { Conexion, EstadoNodoRed, GrupoRed, TonoConexion } from './red-data.ts';
import { EVENTOS_CLIMA, INTENSIDADES } from './escenario-data.ts';
import { iconoClimaDom } from './iconos-clima.tsx';
import { crearEfecto, efectosDe, firmaEfectos } from './efectos-clima.ts';
import type { Efecto } from './efectos-clima.ts';
import type { Ajustes } from './simulacion-data.ts';
import type { Terreno } from './terreno-data.ts';

export const COLOR_TONO: Record<TonoConexion, number> = { recibe: 0x2f9e63, no_recibe: 0xb3372b, inactivo: 0xa9b3ad };
// Tinte del piso del hexagono segun el evento de clima simulado activo.
const PISO_CLIMA = { lluvia: 0xcfe3f2, sol_fuerte: 0xf6e7b8, tierra_seca: 0xe9d8c2, viento: 0xdfe7ea } as const;
const nombreCorto = (n: string) => n.replace(/^Simulado · /, '');

interface Visual { grupo: THREE.Group; cuerpo: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial>; enlace: THREE.Line; destino: THREE.Vector3;
  particulas: THREE.Mesh[]; etiqueta: HTMLDivElement; objeto: CSS2DObject; pulso: { malla: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>; inicio: number } | null;
  conexion: Conexion; fisico: boolean; clave: string }
interface Hexagono { raiz: THREE.Group; piso: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>; borde: THREE.LineLoop; etiqueta: HTMLDivElement; cultivo: string | null; efectos: Efecto[]; firma: string; rotulos: CSS2DObject[] }
export interface Escena { actualizar: (filas: EstadoNodoRed[], nuevos: Set<string>, ahora: number, elegido: string, ajustes?: Map<string, Ajustes>, planos?: Map<string, Terreno>) => void; destruir: () => void }

function liberar(o: THREE.Object3D) {
  o.traverse(x => { const m = x as THREE.Mesh; m.geometry?.dispose(); const mat = m.material as THREE.Material | THREE.Material[] | undefined; (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach(y => y.dispose()); });
  o.traverse(x => { if (x instanceof CSS2DObject) x.element.remove(); });
}

export function crearEscena(contenedor: HTMLDivElement, alSeleccionar: (id: string) => void, alElegirCultivo: (id: string) => void): Escena {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.domElement.setAttribute('aria-hidden', 'true');
  contenedor.appendChild(renderer.domElement);
  const etiquetas = new CSS2DRenderer();
  etiquetas.domElement.className = 'capa-etiquetas';
  contenedor.appendChild(etiquetas.domElement);
  const escena = new THREE.Scene();
  escena.fog = new THREE.Fog(0xf4f6f1, 30, 80); // tema claro: se funde con el fondo de la tarjeta
  const camara = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  const direccion = new THREE.Vector3(0, 15, 9).normalize(); // unos 59° de elevación
  const controles = new OrbitControls(camara, etiquetas.domElement);
  const reducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  Object.assign(controles, { enableDamping: true, enablePan: false, minDistance: 8, maxDistance: 90, maxPolarAngle: 1.35, autoRotate: !reducido, autoRotateSpeed: 0.35 });
  controles.addEventListener('start', () => { controles.autoRotate = false; });
  escena.add(new THREE.HemisphereLight(0xffffff, 0xc9d6c5, 1.25));
  const sol = new THREE.DirectionalLight(0xffffff, 1.4); sol.position.set(8, 20, 10); escena.add(sol);

  const visuales = new Map<string, Visual>(), hexagonos = new Map<string, Hexagono>();
  let estructura = '', semiAncho = 8, semiFondo = 8, centro = new THREE.Vector3(), ancho = 0;
  const rayo = new THREE.Raycaster(), puntero = new THREE.Vector2();
  function tocar(e: PointerEvent) {
    const caja = etiquetas.domElement.getBoundingClientRect();
    puntero.set(((e.clientX - caja.left) / caja.width) * 2 - 1, -((e.clientY - caja.top) / caja.height) * 2 + 1);
    rayo.setFromCamera(puntero, camara);
    const nodo = rayo.intersectObjects([...visuales.values()].map(v => v.cuerpo))[0];
    const id = nodo && [...visuales.entries()].find(([, v]) => v.cuerpo === nodo.object)?.[0];
    if (id) { alSeleccionar(id); return; }
    const piso = rayo.intersectObjects([...hexagonos.values()].map(h => h.piso))[0];
    const hex = piso && [...hexagonos.values()].find(h => h.piso === piso.object);
    if (hex?.cultivo) alElegirCultivo(hex.cultivo);
  }
  let abajo = { x: 0, y: 0 };
  const presionar = (e: PointerEvent) => { abajo = { x: e.clientX, y: e.clientY }; };
  const soltar = (e: PointerEvent) => { if (Math.hypot(e.clientX - abajo.x, e.clientY - abajo.y) < 6) tocar(e); };
  etiquetas.domElement.addEventListener('pointerdown', presionar);
  etiquetas.domElement.addEventListener('pointerup', soltar);

  function crearHexagono(g: GrupoRed): Hexagono {
    const raiz = new THREE.Group(); raiz.position.set(g.x, 0, g.z); escena.add(raiz);
    const rectangulo = (cx: number, cz: number, w: number, l: number, y: number) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.Vector3(cx + a! * w / 2, y, cz + b! * l / 2));
    // Con plano real el piso es el terreno a escala y cada sector queda dibujado en su sitio; sin plano, el hexagono.
    const piso = new THREE.Mesh(g.plano ? new THREE.PlaneGeometry(g.plano.W + 0.7, g.plano.L + 0.7) : new THREE.CircleGeometry(RADIO_HEXAGONO + 1.2, 6), new THREE.MeshStandardMaterial({ color: 0xe8f1e0, roughness: 0.95, transparent: true, opacity: 0.95 }));
    piso.rotation.x = -Math.PI / 2; if (!g.plano) piso.rotation.z = Math.PI / 6; raiz.add(piso);
    const borde = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(g.plano ? rectangulo(0, 0, g.plano.W, g.plano.L, 0.03) : Array.from({ length: 6 }, (_, j) => { const v = vertice(j); return new THREE.Vector3(v.x, 0.03, v.z); })),
      new THREE.LineBasicMaterial({ color: 0x9fbf8f, transparent: true, opacity: 0.9 }));
    raiz.add(borde);
    const rotulos: CSS2DObject[] = [];
    for (const s of g.plano?.sectores ?? []) {
      const area = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(0.1, s.w - 0.08), Math.max(0.1, s.l - 0.08)), new THREE.MeshBasicMaterial({ color: 0xd5e9a7, transparent: true, opacity: 0.45, depthWrite: false }));
      area.rotation.x = -Math.PI / 2; area.position.set(s.x, 0.02, s.z); raiz.add(area);
      raiz.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(rectangulo(s.x, s.z, s.w, s.l, 0.04)), new THREE.LineBasicMaterial({ color: 0x174d3d, transparent: true, opacity: 0.55 })));
      const rotulo = document.createElement('div'); rotulo.className = 'etiqueta-sector'; rotulo.textContent = s.nombre;
      const marca = new CSS2DObject(rotulo); marca.position.set(s.x - s.w / 2 + 0.25, 0.05, s.z - s.l / 2 + 0.3); marca.center.set(0, 0); raiz.add(marca); rotulos.push(marca);
    }
    // Centro del cultivo: punto de llegada de los datos de sus nodos.
    const nucleo = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.12, 6), new THREE.MeshStandardMaterial({ color: 0x9fbf8f, roughness: 0.6 }));
    nucleo.position.y = 0.06; raiz.add(nucleo);
    const etiqueta = document.createElement('div'); etiqueta.className = 'etiqueta-cultivo';
    const objeto = new CSS2DObject(etiqueta); objeto.position.set(0, 0.2, 0); raiz.add(objeto);
    return { raiz, piso, borde, etiqueta, cultivo: g.cultivo_id, efectos: [], firma: '', rotulos };
  }

  function crearVisual(x: number, z: number, fisico: boolean, destino: THREE.Vector3, clave: string): Visual {
    const grupo = new THREE.Group(); grupo.position.set(x, 0, z); escena.add(grupo);
    const r = fisico ? 0.75 : 0.6, h = fisico ? 1.0 : 0.45;
    const cuerpo = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 6), new THREE.MeshStandardMaterial({ color: 0x6b7a73, roughness: 0.45, metalness: 0.15, emissive: 0x000000 }));
    cuerpo.position.y = h / 2; grupo.add(cuerpo);
    if (fisico) {
      const antena = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 8), new THREE.MeshStandardMaterial({ color: 0x7d8c84 }));
      antena.position.y = h + 0.55; grupo.add(antena);
      const punta = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), new THREE.MeshBasicMaterial({ color: 0x9ccb61 }));
      punta.position.y = h + 1.15; grupo.add(punta);
    }
    const enlace = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, 0.25, z), destino]),
      new THREE.LineDashedMaterial({ color: 0x6b7a73, dashSize: 0.3, gapSize: 0.22, transparent: true, opacity: 0.8 }));
    enlace.computeLineDistances(); escena.add(enlace);
    const particulas: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), new THREE.MeshBasicMaterial({ color: 0x2e9d63 }));
      p.visible = false; p.userData.fase = i / 3; escena.add(p); particulas.push(p);
    }
    const etiqueta = document.createElement('div'); etiqueta.className = 'etiqueta-nodo' + (fisico ? ' central' : '');
    const objeto = new CSS2DObject(etiqueta); objeto.position.set(0, fisico ? 2.5 : 1.2, 0); grupo.add(objeto);
    return { grupo, cuerpo, enlace, destino, particulas, etiqueta, objeto, pulso: null, conexion: 'sin_datos', fisico, clave };
  }

  function quitarTodo() {
    for (const v of visuales.values()) { for (const o of [v.grupo, v.enlace, ...v.particulas]) { escena.remove(o); liberar(o); } }
    for (const h of hexagonos.values()) { escena.remove(h.raiz); liberar(h.raiz); }
    visuales.clear(); hexagonos.clear();
  }

  function encuadrar() {
    const { width, height } = contenedor.getBoundingClientRect(); ancho = width;
    renderer.setSize(width, height); etiquetas.setSize(width, height);
    camara.aspect = width / Math.max(1, height);
    // Distancia minima para que el panal entre a lo ancho y a lo alto. Con unos 59° de elevacion
    // el fondo se ve acortado (seno del angulo); se suma margen para las etiquetas sobre los nodos.
    const mitad = Math.tan(THREE.MathUtils.degToRad(camara.fov / 2));
    // En pantallas angostas las etiquetas laterales necesitan mas margen que los propios nodos.
    const margen = camara.aspect < 1.2 ? 3.4 : 1.6;
    const d = Math.min(85, Math.max(12, 1.1 * Math.max((semiAncho + margen) / (mitad * camara.aspect), (semiFondo * direccion.y + 1.8) / mitad)));
    controles.target.copy(centro);
    camara.position.copy(centro).addScaledVector(direccion, d);
    const niebla = escena.fog as THREE.Fog; niebla.near = d * 0.9; niebla.far = d * 2.4;
    camara.updateProjectionMatrix();
  }

  function actualizar(filas: EstadoNodoRed[], nuevos: Set<string>, ahora: number, elegido: string, ajustes?: Map<string, Ajustes>, planos?: Map<string, Terreno>) {
    const panal = panalRed(filas, planos);
    // La escena se rearma si cambian los nodos, su posicion real o los sectores del plano.
    const clave = panal.grupos.map(g => g.clave + ':' + g.nodos.map(n => { const p = panal.posiciones.get(n.nodo_id)!; return `${n.nodo_id}@${p.x},${p.z}`; }).join(',') + (g.plano ? '#' + g.plano.sectores.map(s => `${s.id}:${s.nombre}:${s.x},${s.z},${s.w},${s.l}`).join(';') : '')).join('|');
    if (clave !== estructura) {
      quitarTodo(); estructura = clave;
      for (const g of panal.grupos) {
        hexagonos.set(g.clave, crearHexagono(g));
        const destino = new THREE.Vector3(g.x, 0.3, g.z);
        for (const f of g.nodos) { const p = panal.posiciones.get(f.nodo_id)!; visuales.set(f.nodo_id, crearVisual(p.x, p.z, p.fisico, destino, g.clave)); }
      }
      semiAncho = panal.semiAncho; semiFondo = panal.semiFondo; centro = new THREE.Vector3(panal.centro.x, 0, panal.centro.z); encuadrar();
    }
    // En pantallas angostas solo el cultivo elegido muestra los nombres de sus nodos.
    const todas = ancho >= 900;
    for (const g of panal.grupos) {
      const h = hexagonos.get(g.clave)!, activo = g.cultivo_id !== null && g.cultivo_id === elegido;
      const clima = g.nodos.find(n => n.clima_evento)?.clima_evento ?? null, intensidad = g.nodos.find(n => n.clima_evento)?.clima_intensidad ?? 2;
      h.piso.material.color.setHex(clima ? PISO_CLIMA[clima] : activo ? 0xd5e9a7 : 0xe8f1e0);
      (h.borde.material as THREE.LineBasicMaterial).color.setHex(activo ? 0x174d3d : 0x9fbf8f);
      const enviando = g.nodos.filter(n => estadoConexion(n, ahora) === 'conectado').length;
      h.etiqueta.innerHTML = ''; h.etiqueta.classList.toggle('activo', activo);
      // Los nombres de los sectores y el estado de cada nodo se muestran completos solo en el cultivo elegido.
      for (const r of h.rotulos) r.visible = activo;
      const t = document.createElement('strong'); t.textContent = nombreCorto(g.nombre);
      const s = document.createElement('span'); s.textContent = `${enviando} de ${g.nodos.length} recibiendo` + (g.plano ? ` · ${Math.round(g.plano.ancho_m)} × ${Math.round(g.plano.largo_m)} m` : '');
      h.etiqueta.append(t, s);
      // Gotas, rachas, grietas o sol sobre el hexagono segun el evento y el ajuste manual activos.
      const manual = g.cultivo_id ? ajustes?.get(g.cultivo_id) : undefined, pedidos = efectosDe(clima, intensidad, manual), firma = firmaEfectos(pedidos);
      if (firma !== h.firma) {
        for (const e of h.efectos) { h.raiz.remove(e.objeto); liberar(e.objeto); }
        h.efectos = pedidos.map(p => { const e = crearEfecto(p, RADIO_HEXAGONO + 0.6); h.raiz.add(e.objeto); e.animar(0); return e; });
        h.firma = firma;
      }
      h.etiqueta.dataset.efectos = firma;
      // Icono del clima simulado activo sobre el cultivo donde estan graficados sus nodos.
      h.etiqueta.dataset.clima = clima ?? 'normal';
      if (clima) {
        const c = document.createElement('em'); c.className = 'clima-etiqueta';
        c.append(iconoClimaDom(clima), document.createTextNode(`${EVENTOS_CLIMA[clima].nombre} · ${INTENSIDADES[intensidad] ?? ''}`));
        h.etiqueta.append(c);
      } else if (manual && Object.keys(manual).length) {
        const c = document.createElement('em'); c.className = 'clima-etiqueta'; c.textContent = 'Ajuste manual activo';
        h.etiqueta.append(c);
      }
      for (const f of g.nodos) {
        const v = visuales.get(f.nodo_id)!;
        v.conexion = estadoConexion(f, ahora);
        const tono = tonoConexion(v.conexion), color = COLOR_TONO[tono];
        v.cuerpo.material.color.setHex(color);
        const m = v.enlace.material as THREE.LineDashedMaterial; m.color.setHex(color);
        m.opacity = v.conexion === 'conectado' ? 0.95 : 0.3;
        v.objeto.visible = todas || activo || v.fisico;
        v.etiqueta.innerHTML = '';
        // En el 3D el hexagono ya nombra el cultivo: el virtual se muestra corto (sim-05); el codigo completo va en la tabla.
        const c = document.createElement('strong'); c.textContent = f.simulado ? f.codigo.replace(/^sim-[a-z0-9]+-(?=[a-z0-9]+$)/, 'sim-') : f.codigo;
        const e = document.createElement('span'); e.textContent = (v.fisico ? 'Físico · ' : '') + TEXTO_CONEXION[v.conexion];
        v.etiqueta.append(c, e); v.etiqueta.dataset.estado = v.conexion; v.etiqueta.dataset.tono = tono;
        v.etiqueta.classList.toggle('compacta', !!g.plano && !activo && !v.fisico);
        if (nuevos.has(f.nodo_id)) {
          if (v.pulso) { v.grupo.remove(v.pulso.malla); v.pulso.malla.geometry.dispose(); v.pulso.malla.material.dispose(); }
          const malla = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.85, 6), new THREE.MeshBasicMaterial({ color: 0x2e9d63, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
          malla.rotation.x = -Math.PI / 2; malla.position.y = 0.05; v.grupo.add(malla); v.pulso = { malla, inicio: performance.now() };
        }
      }
    }
  }

  let marco = 0;
  const reloj = new THREE.Timer();
  const origen = new THREE.Vector3();
  function animar(instante?: number) {
    marco = requestAnimationFrame(animar);
    if (document.hidden) return;
    reloj.update(instante);
    const t = reloj.getElapsed();
    for (const v of visuales.values()) {
      const vivo = v.conexion === 'conectado';
      v.cuerpo.material.emissive.setHex(vivo ? 0x1d6b45 : 0x000000);
      v.cuerpo.material.emissiveIntensity = vivo ? 0.6 + Math.sin(t * 3) * 0.35 : 0;
      origen.fromBufferAttribute(v.enlace.geometry.getAttribute('position') as THREE.BufferAttribute, 0);
      v.particulas.forEach(p => { p.visible = vivo; if (vivo) p.position.lerpVectors(origen, v.destino, (t * 0.35 + (p.userData.fase as number)) % 1); });
      if (v.pulso) {
        const k = (performance.now() - v.pulso.inicio) / 1600;
        if (k >= 1) { v.grupo.remove(v.pulso.malla); v.pulso.malla.geometry.dispose(); v.pulso.malla.material.dispose(); v.pulso = null; }
        else { v.pulso.malla.scale.setScalar(1 + k * 2.2); v.pulso.malla.material.opacity = 0.9 * (1 - k); }
      }
    }
    if (!reducido) for (const h of hexagonos.values()) for (const e of h.efectos) e.animar(t);
    controles.update();
    renderer.render(escena, camara); etiquetas.render(escena, camara);
  }
  const observador = new ResizeObserver(encuadrar); observador.observe(contenedor); encuadrar(); animar();
  return {
    actualizar,
    destruir() {
      cancelAnimationFrame(marco); observador.disconnect(); controles.dispose(); reloj.dispose();
      etiquetas.domElement.removeEventListener('pointerdown', presionar); etiquetas.domElement.removeEventListener('pointerup', soltar);
      quitarTodo(); liberar(escena);
      renderer.dispose(); renderer.domElement.remove(); etiquetas.domElement.remove();
    },
  };
}
