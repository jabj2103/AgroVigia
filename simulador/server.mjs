import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { crearApiMqtt } from './api-mqtt.mjs';
import { publicarMqtt } from './transporte-mqtt.mjs';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/transporte.mjs', ['transporte.mjs', 'text/javascript; charset=utf-8']],
  ['/motor.mjs', ['motor.mjs', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);

export function createPanelServer({ publicar = null } = {}) {
  const api = publicar ? crearApiMqtt(publicar) : null;
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    const host = req.headers.host;
    if (!host || !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
      res.writeHead(403); res.end('Acceso local solamente.'); return;
    }
    let route;
    try { route = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); }
    catch { res.writeHead(400); res.end('Dirección no válida.'); return; }
    if (api && await api(req, res, route)) return;
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.setHeader('Allow', 'GET, HEAD'); res.writeHead(405); res.end('Método no permitido.'); return;
    }
    if (!files.has(route)) { res.writeHead(404); res.end('No encontrado.'); return; }
    const [name, mime] = files.get(route);
    try {
      const data = await readFile(path.join(publicDir, name));
      res.setHeader('Content-Type', mime); res.setHeader('Content-Length', data.length);
      res.writeHead(200); res.end(req.method === 'HEAD' ? undefined : data);
    } catch { res.writeHead(500); res.end('No se pudo cargar el panel.'); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const rawPort = process.argv[2] ?? '5190';
  if (!/^\d{1,5}$/.test(rawPort) || Number(rawPort) < 1024 || Number(rawPort) > 65535) {
    console.error('El puerto debe ser un número entero entre 1024 y 65535.'); process.exitCode = 1;
  } else {
    const conMqtt = process.argv[3] === '--mqtt';
    const port = Number(rawPort), server = createPanelServer({ publicar: conMqtt ? publicarMqtt : null });
    server.on('error', error => {
      console.error(error.code === 'EADDRINUSE' ? `El puerto ${port} está ocupado. Cierra la otra instancia o elige otro puerto.` : `No se pudo iniciar el panel (${error.code ?? 'ERROR'}).`);
      process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () => {
      console.log(`Simulador local: http://127.0.0.1:${port}`);
      console.log(conMqtt ? 'Datos SIMULADOS. Envío manual MQTT habilitado; configurar mapeo en el panel. PUBACK no confirma Supabase.' : 'Datos SIMULADOS. Registro y exportación locales; iniciar con -ConMqtt para habilitar envíos.');
      console.log(conMqtt ? 'Ctrl+C para detener. Usa las credenciales MQTT locales existentes; no requiere claves Supabase en el panel.' : 'Ctrl+C para detener. No requiere npm install ni claves.');
    });
    process.on('SIGINT', () => server.close());
    process.on('SIGTERM', () => server.close());
  }
}
