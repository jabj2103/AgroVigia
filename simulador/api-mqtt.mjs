import { randomBytes } from 'node:crypto';
import { prepararCapturaV3 } from './contrato-v3.mjs';
import { validarVinculos } from './transporte-mqtt.mjs';

export function crearApiMqtt(publicar) {
  const token = randomBytes(32).toString('hex');
  let vinculos = [], ocupado = false, bloqueado = false;
  function json(res, code, data) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data));
  }
  return async (req, res, route) => {
    if (!['/api/estado', '/api/vinculos', '/api/publicar'].includes(route)) return false;
    if (req.headers['sec-fetch-site'] === 'cross-site' ||
        (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)) {
      json(res, 403, { error: 'Origen no autorizado.' }); return true;
    }
    if (route === '/api/estado' && req.method === 'GET') {
      json(res, 200, { token, habilitado: true, configurado: vinculos.length === 4, vinculos, bloqueado }); return true;
    }
    if (req.method !== 'POST') { json(res, 405, { error: 'Método no permitido.' }); return true; }
    if (req.headers.origin !== `http://${req.headers.host}` || req.headers['x-agrovigia-token'] !== token ||
        req.headers['content-type'] !== 'application/json') { json(res, 403, { error: 'Solicitud no autorizada.' }); return true; }
    if (ocupado) { json(res, 409, { error: 'Hay un envío en curso. Espera su resultado.' }); return true; }
    try {
      let size = 0; const chunks = [];
      req.setTimeout(5000, () => req.destroy());
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 16384) { json(res, 413, { error: 'Solicitud demasiado grande.' }); return true; }
        chunks.push(chunk);
      }
      // Buffer evita romper caracteres UTF-8 divididos entre paquetes.
      req.setTimeout(0);
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (route === '/api/vinculos') {
        if (bloqueado) { json(res, 409, { error: 'Reinicia el simulador para cambiar el mapeo después de un envío.' }); return true; }
        vinculos = validarVinculos(data);
        json(res, 200, { configurado: true, vinculos }); return true;
      }
      if (!vinculos.length) throw new Error('Configura primero las cuatro filas del mapeo.');
      const vinculo = vinculos.find(v => v.nodo_local === data?.nodo_codigo);
      if (!vinculo) throw new Error('Nodo local sin mapeo.');
      const preparado = prepararCapturaV3(data, vinculo), age = Date.now() - Date.parse(data.tomada_en);
      if (age > 300000 || age < -120000) throw new Error('La captura está fuera de la ventana de cinco minutos. Genera otra captura.');
      // Volver a comprobar después de la lectura: dos solicitudes pueden leer sus cuerpos en paralelo.
      if (ocupado) { json(res, 409, { error: 'Hay un envío en curso.' }); return true; }
      ocupado = true; bloqueado = true;
      try { json(res, 200, { ...await publicar(preparado), mensaje_id: data.mensaje_id, nodo_codigo: preparado.payload.nodo_codigo }); }
      catch (error) { json(res, 502, { error: error.message, mensaje_id: data.mensaje_id, persistido: null }); }
      finally { ocupado = false; }
    } catch (error) { json(res, 400, { error: error instanceof SyntaxError ? 'JSON no válido. Copia las cuatro filas como JSON.' : error.message }); }
    return true;
  };
}
