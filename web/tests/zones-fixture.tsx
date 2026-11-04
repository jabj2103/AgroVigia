// Datos inventados y fetch ficticio del SDK. Nunca conecta servicios.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import type { Session } from '@supabase/supabase-js';
import { Panel } from '../src/App.tsx';
import { captureRows, crop, owner, physical, plano, virtuals } from './zones-fixtures.ts';
import type { MedicionZona } from '../src/zone-domain.ts';
import 'bootstrap/dist/css/bootstrap.min.css';
import '../src/styles.css';
const other = '99999999-9999-4999-8999-999999999999', emptyCrop = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const p = plano(), registros = new Map(virtuals.map(n => [n.id, captureRows(n)]));
const libre = { ...physical, id: '66666666-6666-4666-8666-666666666666', codigo: 'agv-fisico-02', cultivo_id: null };
const fechaReal = new Date(Date.now() - 2000).toISOString();
const reales = ['temperatura_aire', 'humedad_aire', 'iluminacion_relativa'].map((variable_codigo, i) => ({
  id: crypto.randomUUID(), nodo_id: physical.id, cultivo_id: crop, mensaje_id: '77777777-7777-4777-8777-777777777777', origen: 'real', variable_codigo, valor: [28, 60, 50][i],
  tomada_en: fechaReal, recibida_en: fechaReal, zona_id: null, zona_contexto: {}, metadatos: { version_payload: 2, ldr: { metodo: 'adc12_10k_11db_v1', adc_promedio: 2048 } },
}));
declare global { interface Window { qaZonas: { requests: string[]; errorLectura: boolean; vacio: string; errorPlano: boolean; antigua: (id: string) => void; futuro: (id: string) => void; mover: () => void; cambiarCuenta: () => void } } }
window.qaZonas = { requests: [], errorLectura: false, errorPlano: false, vacio: '', antigua: id => registros.set(id, captureRows(virtuals.find(n => n.id === id)!, new Date(Date.now() - 181000))),
  futuro: id => registros.set(id, captureRows(virtuals.find(n => n.id === id)!, new Date(Date.now() + 60000))),
  mover: () => { const n = p.nodos.find(n => n.id === virtuals[0]!.id)!; n.zona_id = p.zonas[2]!.id; n.asignacion_version = crypto.randomUUID(); }, cambiarCuenta: () => {} };
let cuenta = owner;
const client = createClient('https://fixture-no-remoto.supabase.co', 'sb_publishable_ficticia', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
  const u = new URL(String(input)), tabla = u.pathname.split('/').at(-1)!; window.qaZonas.requests.push(u.toString());
  if (init?.method === 'HEAD') return new Response(null, { status: 200, headers: { 'Content-Range': '*/0' } });
  if (init?.method && init.method !== 'GET') throw new Error('QA de zonas no admite escrituras.');
  const enviar = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const otro = cuenta !== owner, cultivoVacio = u.searchParams.get('cultivo_id') === 'eq.' + emptyCrop;
  if (tabla === 'perfiles') return enviar({ nombre: otro ? 'Otra cuenta QA' : 'Cuenta QA de zonas' });
  if (tabla === 'cultivos') return enviar(otro ? [] : [{ id: crop, nombre: 'Cultivo demostración QA', tipo: 'Maíz', area: 1, unidad_area: 'ha', archivado_en: null }, { id: emptyCrop, nombre: 'Cultivo vacío QA', tipo: 'Yuca', area: 1, unidad_area: 'ha', archivado_en: null }]);
  if (tabla === 'nodos') return enviar(otro || cultivoVacio ? [] : u.searchParams.has('cultivo_id') ? p.nodos : [...p.nodos, libre]);
  if (tabla === 'zonas') return window.qaZonas.errorPlano ? enviar({ message: 'ERROR_QA' }, 400) : enviar(otro || cultivoVacio ? [] : p.zonas);
  if (tabla === 'nodo_variables') return enviar(otro ? [] : p.capacidades);
  if (tabla === 'alertas') return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Range': '*/0' } });
  if (tabla === 'mediciones') {
    if (window.qaZonas.errorLectura && u.searchParams.get('origen') === 'eq.simulado') return enviar({ message: 'ERROR_QA' }, 400);
    const id = u.searchParams.get('nodo_id')?.slice(3);
    const rows: MedicionZona[] = id === physical.id ? reales as MedicionZona[] : registros.get(id ?? '') ?? [];
    const selected = otro || cultivoVacio || window.qaZonas.vacio === id ? [] : rows;
    return enviar(u.searchParams.get('select') === 'mensaje_id' ? selected[0] ? { mensaje_id: selected[0].mensaje_id } : null : selected);
  }
  throw new Error('Petición QA inesperada: ' + tabla);
} } });
function Fixture() {
  const [uid, setUid] = useState(owner);
  window.qaZonas.cambiarCuenta = () => { cuenta = other; setUid(other); };
  return <><div className="aviso advertencia" style={{ margin: 0 }}>PRUEBA LOCAL · DATOS INVENTADOS</div><Panel key={uid} client={client} sesion={{ user: { id: uid, email: 'prueba@example.test' } } as Session}/></>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture/></StrictMode>);
