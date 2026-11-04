import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZONAS } from './public/motor.mjs';

const raiz = fileURLToPath(new URL('../', import.meta.url));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const uuid4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// El mapeo no acredita propiedad. La RPC resuelve la cuenta/zona y valida la versión.
export function validarVinculos(filas) {
  if (!Array.isArray(filas) || filas.length !== 4) throw new Error('Se necesitan las cuatro filas JSON de verificar-provision-simulacion.sql.');
  const cultivo = filas[0]?.cultivo_id;
  if (typeof cultivo !== 'string' || !uuid.test(cultivo)) throw new Error('Cultivo no válido.');
  const zonas = new Set();
  return ZONAS.map((zona, i) => {
    const coincidencias = filas.filter(f => f?.nodo_local === zona.nodo);
    const f = coincidencias[0];
    const codigo = `sim-${cultivo.replaceAll('-', '').slice(0, 12)}-${String(i + 1).padStart(2, '0')}`;
    if (coincidencias.length !== 1 || f.nodo_codigo !== codigo || f.cultivo_id !== cultivo || f.zona_codigo !== zona.codigo ||
        typeof f.asignacion_version !== 'string' || !uuid4.test(f.asignacion_version) ||
        typeof f.zona_id !== 'string' || !uuid.test(f.zona_id) || zonas.has(f.zona_id) ||
        f.habilitado !== true || f.variables_simuladas !== 10) throw new Error('El mapeo no coincide con cuatro nodos habilitados y diez variables por zona.');
    zonas.add(f.zona_id);
    return { nodo_local: zona.nodo, nodo_codigo: f.nodo_codigo, asignacion_version: f.asignacion_version };
  });
}

export function publicarMqtt({ topico, mensaje }, {
  binario = path.join(homedir(), 'Documents', 'Mosquitto', 'mosquitto_pub.exe'),
  opciones = path.join(raiz, '.local', 'mqtt', 'simulador.conf'),
  puerto = 18883, timeoutMs = 12000,
} = {}) {
  // Sin shell, contraseña fuera de argv, UTF-8 por stdin; MQTT v5 permite observar ACL negativa.
  return new Promise((resolve, reject) => {
    const child = spawn(binario, ['-o', opciones, '-h', '127.0.0.1', '-p', String(puerto), '-V', 'mqttv5', '-q', '1', '-d', '-t', topico, '-s'],
      { cwd: raiz, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', expired = false;
    const timer = setTimeout(() => { expired = true; child.kill(); }, timeoutMs);
    const collect = data => { output = (output + data.toString('utf8')).slice(-16384); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.stdin.on('error', () => {});
    child.once('error', () => { clearTimeout(timer); reject(new Error('No se pudo iniciar mosquitto_pub. Revisa la instalación local.')); });
    child.once('close', code => {
      clearTimeout(timer);
      // Mosquitto 2.1.2 puede salir con 0 incluso cuando PUBACK indica rechazo.
      const acks = [...output.matchAll(/received PUBACK[^\r\n]*RC:(\d+)\)/g)].map(m => Number(m[1]));
      if (!expired && code === 0 && acks.length === 1 && [0, 16].includes(acks[0])) {
        resolve({ estado: 'mqtt_confirmado', codigo: 'PUBACK_RECIBIDO', qos: 1, retain: false, persistido: null, comprobacion_supabase: 'pendiente' });
      } else reject(new Error(expired ? 'MQTT agotó el tiempo de espera. El resultado puede ser desconocido; reintenta la misma captura.' : 'MQTT no confirmó la publicación. Revisa broker, ACL y credenciales locales.'));
    });
    child.stdin.end(mensaje, 'utf8');
  });
}
