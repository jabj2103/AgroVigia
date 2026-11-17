// Demo local de la web con el fixture de IA, hexagonos e historial (datos inventados, sin Supabase).
// Uso: npm run demo  ->  http://127.0.0.1:5188/demo
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root: web, configFile: path.join(web, 'vite.config.ts'), cacheDir: path.resolve(web, '../.local/vite-demo'),
  server: { host: '127.0.0.1', port: Number(process.env.PUERTO_DEMO ?? 5188), strictPort: true, open: false },
  plugins: [{ name: 'demo-local', configureServer(s) { s.middlewares.use('/demo', async (_req, res, next) => {
    try {
      const html = await s.transformIndexHtml('/demo', '<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>AgroVigía demo</title></head><body><!-- screen-economy: endless-motion El punto de Recibiendo titila mientras el nodo recibe datos. Es un indicador de estado en vivo y se detiene con movimiento reducido. --><div id="root"></div><script type="module" src="/tests/ia-fixture.tsx"></script></body></html>');
      res.setHeader('Content-Type', 'text/html'); res.end(html);
    } catch (e) { next(e); }
  }); } }] });
await server.listen();
console.log('Demo en http://127.0.0.1:' + server.config.server.port + '/demo (datos inventados).');
