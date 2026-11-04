export function iniciarTransporte({ ultimaCaptura, pausar }) {
  const $ = id => document.getElementById(id);
  let token = null, configurado = false, bloqueado = false, enviando = false;
  const resultados = new Map();
  const texto = message => { $('mqtt-status').textContent = message; };
  async function solicitar(route, data) {
    const response = await fetch(route, data === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Agrovigia-Token': token }, body: JSON.stringify(data),
    });
    if (!response.ok) {
      let error; try { error = (await response.json()).error; } catch { /* Respuesta local no JSON. */ }
      throw new Error(error ?? 'No se pudo conectar con el servidor local.');
    }
    return response.json();
  }
  function actualizar() {
    const capture = ultimaCaptura();
    $('mqtt-send').disabled = !token || !configurado || !capture || enviando;
    $('mqtt-bind').disabled = !token || bloqueado || enviando;
    $('mqtt-mapping').disabled = bloqueado || enviando;
    $('mqtt-target').textContent = capture ? `${capture.simulacion.zona_nombre} · ${capture.mensaje_id}` : 'Genera una captura para elegir el envío.';
    $('mqtt-send').textContent = enviando ? 'Esperando MQTT…' : resultados.has(capture?.mensaje_id) ? 'Reenviar la misma captura' : 'Enviar última captura a MQTT';
  }
  $('mqtt-bind').addEventListener('click', async () => {
    try {
      const filas = JSON.parse($('mqtt-mapping').value);
      const result = await solicitar('/api/vinculos', filas);
      configurado = result.configurado;
      texto('Cuatro nodos configurados. Captura valores y envía una captura reciente. El cultivo autorizado lo resuelve Supabase.');
      $('mqtt-mapping').value = '';
    } catch (error) { texto(error.message); }
    actualizar();
  });
  $('mqtt-send').addEventListener('click', async () => {
    const capture = ultimaCaptura();
    if (!capture || enviando || !configurado || !token) return;
    pausar(); enviando = true; bloqueado = true; actualizar();
    texto(`Enviando captura simulada ${capture.mensaje_id}…`);
    try {
      const result = await solicitar('/api/publicar', capture);
      resultados.set(capture.mensaje_id, { mensaje_id: capture.mensaje_id, estado: result.estado, nodo_codigo: result.nodo_codigo, persistido: null });
      texto(`MQTT confirmó ${capture.mensaje_id} (${result.nodo_codigo}). Guardado en Supabase pendiente de comprobar en n8n y SQL.`);
    } catch (error) {
      resultados.set(capture.mensaje_id, { mensaje_id: capture.mensaje_id, estado: 'sin_confirmacion', persistido: null });
      texto(`${error.message} Sin confirmación de Supabase. Si reintentas, usa la misma captura para conservar su identificador.`);
    } finally {
      enviando = false;
      const conservados = new Set(ultimaCaptura(true).map(c => c.mensaje_id));
      for (const id of resultados.keys()) if (!conservados.has(id)) resultados.delete(id);
      actualizar();
    }
  });
  solicitar('/api/estado').then(state => {
    token = state.token; configurado = state.configurado; bloqueado = state.bloqueado;
    texto(configurado ? 'Mapeo preparado. Los envíos son manuales; MQTT no confirma el guardado en Supabase.' : 'Pega las cuatro filas de la consulta como JSON y pulsa Configurar nodos. No pegues contraseñas.');
    actualizar();
  }).catch(() => { texto('Envío desactivado. Para habilitarlo, reinicia el panel con -ConMqtt. Puedes seguir capturando y exportando localmente.'); actualizar(); });
  actualizar();
  return {
    actualizar,
    exportar(data) {
      const ids = new Set(data.capturas.map(c => c.mensaje_id));
      const intentos = [...resultados.values()].filter(r => ids.has(r.mensaje_id));
      if (!intentos.length) return data;
      return { ...data, enviado_mqtt: intentos.some(r => r.estado === 'mqtt_confirmado'), persistido_supabase: null,
        transporte: { comprobacion_supabase: 'pendiente', resultados: intentos } };
    },
  };
}
