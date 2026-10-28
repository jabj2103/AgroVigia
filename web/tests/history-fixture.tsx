// Solo harness local de pruebas. Datos inventados, no se publican ni guardan.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import Historial from '../src/Historial.tsx';
import 'bootstrap/dist/css/bootstrap.min.css';
import '../src/styles.css';
declare global { interface Window { qaError: boolean; qaSolicitudes: string[] } }
window.qaError = false; window.qaSolicitudes = [];
const crop = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const node = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', otro = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const uuid = (n: number) => '00000000-0000-4000-8000-' + n.toString(16).padStart(12, '0');
const ahora = Date.now();
const filas = [node, otro].flatMap((n, ni) => Array.from({ length: 45 }, (_, i) => {
  const adc = i === 0 ? 0 : 625 + i * 50;
  return ['temperatura_aire', 'iluminacion_relativa'].map((v, vi) => ({
    id: uuid(ni * 1000 + i * 3 + vi + 1), mensaje_id: uuid(ni * 1000 + i + 10000),
    cultivo_id: crop, nodo_id: n, variable_codigo: v, origen: 'real',
    tomada_en: new Date(ahora - (46 - i) * 60_000).toISOString(),
    recibida_en: new Date(ahora - (46 - i) * 60_000 + 1000).toISOString(),
    valor: v === 'temperatura_aire' ? 20 + ni * 10 + (i % 10) / 10 : Math.round(adc * 1000 / 4095) / 10,
    metadatos: v === 'iluminacion_relativa' ? { version_payload: 2, ldr: { metodo: 'adc12_10k_11db_v1', adc_promedio: adc } } : {},
  }));
}).flat());
const client = createClient('https://fixture-no-remoto.supabase.co', 'sb_publishable_ficticia', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: async input => {
    const u = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    window.qaSolicitudes.push(u.href);
    if (window.qaError) return new Response(JSON.stringify({ message: 'Fallo QA inventado' }), { status: 400 });
    const filtrosTiempo = u.searchParams.getAll('tomada_en');
    const inicio = Date.parse(filtrosTiempo.find(t => t.startsWith('gte.'))!.slice(4));
    const fin = Date.parse(filtrosTiempo.find(t => t.startsWith('lte.'))!.slice(4));
    const corte = Date.parse(u.searchParams.get('recibida_en')!.slice(4));
    let datos = filas.filter(f =>
      u.searchParams.get('nodo_id') === 'eq.' + f.nodo_id &&
      u.searchParams.get('cultivo_id') === 'eq.' + f.cultivo_id &&
      u.searchParams.get('variable_codigo') === 'eq.' + f.variable_codigo &&
      u.searchParams.get('origen') === 'eq.' + f.origen &&
      Date.parse(f.tomada_en) >= inicio && Date.parse(f.tomada_en) <= fin && Date.parse(f.recibida_en) <= corte);
    const or = u.searchParams.get('or');
    if (or) {
      const cursor = or.match(/tomada_en\.gt\.(.+),and\(tomada_en\.eq\.(.+),id\.gt\.([0-9a-f-]+)\)/)!;
      const fecha = Date.parse(cursor[1]!); const id = cursor[3]!;
      datos = datos.filter(f => Date.parse(f.tomada_en) > fecha || (Date.parse(f.tomada_en) === fecha && f.id > id));
    }
    datos.sort((a,b) => Date.parse(a.tomada_en) - Date.parse(b.tomada_en) || a.id.localeCompare(b.id));
    return new Response(JSON.stringify(datos.slice(0, Math.min(17, Number(u.searchParams.get('limit'))))),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  } },
});
const nodos = [{ id: node, codigo: 'agv-prueba-01', cultivo_id: crop, habilitado: true },
  { id: otro, codigo: 'agv-prueba-02', cultivo_id: crop, habilitado: true }];
const capacidades = nodos.flatMap(n => ['temperatura_aire','humedad_aire','iluminacion_relativa'].map(v => ({
  nodo_id: n.id, variable_codigo: v, sensor_modelo: v === 'iluminacion_relativa' ? 'LDR' : 'DHT22',
})));
function Harness() {
  const [sinNodos, setSinNodos] = useState(false);
  return <main className="contenido" style={{ maxWidth: 1200, margin: 'auto' }}>
    <h1>PRUEBA LOCAL · DATOS INVENTADOS</h1><button onClick={() => setSinNodos(true)}>Cuenta sin nodos</button>
    <Historial key={sinNodos ? 'cuenta-vacia' : 'cuenta-datos'} client={client} cultivoId={crop}
      nodos={sinNodos ? [] : nodos} capacidades={sinNodos ? [] : capacidades} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);