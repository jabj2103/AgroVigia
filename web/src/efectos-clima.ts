// Efectos visuales del clima simulado sobre un hexagono de la escena 3D: gotas de lluvia, rachas de
// viento, grietas y polvo de tierra seca y sol fuerte. Solo dibujan lo que ya esta activo en los datos;
// con movimiento reducido quedan quietos.
import * as THREE from 'three';
import type { Ajustes } from './simulacion-data.ts';

export type TipoEfecto = 'lluvia' | 'viento' | 'tierra_seca' | 'sol_fuerte';
export interface EfectoPedido { tipo: TipoEfecto; fuerza: number }
export interface Efecto { objeto: THREE.Group; animar: (t: number) => void }
const COLOR: Record<TipoEfecto, number> = { lluvia: 0x2f7fc4, viento: 0x6f8f9c, tierra_seca: 0x8a5a2b, sol_fuerte: 0xe0a21a };
const ALTO = 4.5;

// Que efectos corresponden al evento activo y al ajuste manual de un cultivo. Sin duplicar tipos.
export function efectosDe(clima: string | null | undefined, intensidad: number | null | undefined, ajustes: Ajustes | undefined): EfectoPedido[] {
  const mapa = new Map<TipoEfecto, number>();
  const poner = (tipo: TipoEfecto, fuerza: number) => mapa.set(tipo, Math.min(3, Math.max(mapa.get(tipo) ?? 0, Math.max(1, Math.round(fuerza)))));
  if (clima === 'lluvia' || clima === 'viento' || clima === 'tierra_seca' || clima === 'sol_fuerte') poner(clima, intensidad ?? 2);
  if (ajustes) {
    if ((ajustes.precipitacion_60min ?? 0) > 0) poner('lluvia', ajustes.precipitacion_60min! / 17);
    if ((ajustes.velocidad_viento ?? 0) > 0) poner('viento', ajustes.velocidad_viento! / 5);
    if ((ajustes.humedad_suelo_vwc ?? 0) < 0) poner('tierra_seca', -ajustes.humedad_suelo_vwc! / 10);
    if ((ajustes.temperatura_aire ?? 0) > 0) poner('sol_fuerte', ajustes.temperatura_aire! / 3.4);
  }
  return [...mapa].map(([tipo, fuerza]) => ({ tipo, fuerza }));
}
export const firmaEfectos = (e: EfectoPedido[]) => e.map(x => x.tipo + x.fuerza).sort().join(',');

const azar = (radio: number) => { const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radio; return [Math.cos(a) * r, Math.sin(a) * r] as const; };
function lineas(puntos: number, color: number, opacidad: number) {
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(puntos * 3), 3));
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: opacidad }));
}

export function crearEfecto({ tipo, fuerza }: EfectoPedido, radio: number): Efecto {
  const objeto = new THREE.Group(); objeto.userData.efecto = tipo;
  if (tipo === 'lluvia') {
    const n = 45 * fuerza, malla = lineas(n * 2, COLOR.lluvia, 0.75), pos = malla.geometry.getAttribute('position') as THREE.BufferAttribute;
    const gotas = Array.from({ length: n }, () => { const [x, z] = azar(radio); return { x, z, fase: Math.random(), vel: 0.9 + Math.random() * 0.5 }; });
    objeto.add(malla);
    return { objeto, animar(t) {
      gotas.forEach((g, i) => { const y = ALTO - ((t * g.vel + g.fase) % 1) * ALTO; pos.setXYZ(i * 2, g.x, y, g.z); pos.setXYZ(i * 2 + 1, g.x - 0.05, Math.max(0.05, y - 0.38), g.z); });
      pos.needsUpdate = true;
    } };
  }
  if (tipo === 'viento') {
    const n = 12 * fuerza, malla = lineas(n * 2, COLOR.viento, 0.7), pos = malla.geometry.getAttribute('position') as THREE.BufferAttribute;
    const rachas = Array.from({ length: n }, () => ({ z: (Math.random() * 2 - 1) * radio * 0.8, y: 0.5 + Math.random() * 2.4, fase: Math.random(), largo: 0.8 + Math.random() * 1.1, vel: 0.35 + Math.random() * 0.3 }));
    objeto.add(malla);
    return { objeto, animar(t) {
      rachas.forEach((r, i) => { const x = -radio + ((t * r.vel * fuerza + r.fase) % 1) * radio * 2; pos.setXYZ(i * 2, x, r.y, r.z); pos.setXYZ(i * 2 + 1, x + r.largo, r.y + 0.04, r.z); });
      pos.needsUpdate = true;
    } };
  }
  if (tipo === 'tierra_seca') {
    // Grietas quietas sobre el piso y un poco de polvo que sube despacio.
    const puntos: THREE.Vector3[] = [];
    for (let i = 0; i < 5 + fuerza * 3; i++) {
      let [x, z] = azar(radio * 0.85);
      for (let k = 0; k < 4; k++) { const nx = x + (Math.random() - 0.5) * 1.1, nz = z + (Math.random() - 0.5) * 1.1; puntos.push(new THREE.Vector3(x, 0.07, z), new THREE.Vector3(nx, 0.07, nz)); x = nx; z = nz; }
    }
    objeto.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(puntos), new THREE.LineBasicMaterial({ color: COLOR.tierra_seca, transparent: true, opacity: 0.85 })));
    const n = 16 * fuerza, geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const polvo = new THREE.Points(geo, new THREE.PointsMaterial({ color: COLOR.tierra_seca, size: 0.09, transparent: true, opacity: 0.55 })), pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const motas = Array.from({ length: n }, () => { const [x, z] = azar(radio * 0.9); return { x, z, fase: Math.random() }; });
    objeto.add(polvo);
    return { objeto, animar(t) { motas.forEach((m, i) => pos.setXYZ(i, m.x + Math.sin(t + m.fase * 6) * 0.15, 0.1 + ((t * 0.12 + m.fase) % 1) * 1.4, m.z)); pos.needsUpdate = true; } };
  }
  // Sol fuerte: disco alto con rayos que giran despacio.
  const sol = new THREE.Mesh(new THREE.SphereGeometry(0.42 + fuerza * 0.08, 18, 18), new THREE.MeshBasicMaterial({ color: COLOR.sol_fuerte }));
  sol.position.set(radio * 0.55, ALTO + 0.6, -radio * 0.55);
  const rayos: THREE.Vector3[] = [];
  for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; rayos.push(new THREE.Vector3(Math.cos(a) * 0.75, Math.sin(a) * 0.75, 0), new THREE.Vector3(Math.cos(a) * (1.05 + fuerza * 0.12), Math.sin(a) * (1.05 + fuerza * 0.12), 0)); }
  const corona = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(rayos), new THREE.LineBasicMaterial({ color: COLOR.sol_fuerte, transparent: true, opacity: 0.9 }));
  corona.position.copy(sol.position); objeto.add(sol, corona);
  return { objeto, animar(t) { corona.rotation.z = t * 0.25; const k = 1 + Math.sin(t * 2) * 0.05; sol.scale.setScalar(k); } };
}
