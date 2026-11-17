# n8n con los flujos de AgroVigia para un servicio web sin disco persistente (por ejemplo Render).
# Contexto de construccion: la raiz del repositorio.
#   docker build -f local/render/n8n.Dockerfile -t agrovigia-n8n .
# No contiene claves: llegan como variables de entorno al iniciar (ver n8n/INGESTA_HTTP.md).
FROM n8nio/n8n:2.44.7
USER root
COPY n8n/03e-ingesta-alertas.json n8n/03f-ingesta-simulada-v3.json n8n/03g-ingesta-http.json n8n/03h-sugerencias-a-peticion.json n8n/03i-ingesta-nodo-https.json /opt/agrovigia/n8n/
COPY local/preparar-n8n.cjs /opt/agrovigia/local/preparar-n8n.cjs
# Servicio de simulacion (opcional, AGROVIGIA_SIMULADOR=si): con transporte HTTP no necesita dependencias de npm.
COPY simulador/servicio.mjs simulador/clima-modelo.mjs simulador/contrato-v3.mjs /opt/agrovigia/simulador/
COPY simulador/public/ /opt/agrovigia/simulador/public/
# El modelo de clima reutiliza los validadores de la ingesta.
COPY n8n/validar-ambiental.cjs n8n/validar-telemetria.cjs /opt/agrovigia/n8n/
COPY local/render/arranque-n8n.sh /opt/agrovigia/arranque-n8n.sh
RUN chmod 755 /opt/agrovigia/arranque-n8n.sh
USER node
ENV N8N_BLOCK_ENV_ACCESS_IN_NODE=true \
    N8N_DIAGNOSTICS_ENABLED=false \
    N8N_VERSION_NOTIFICATIONS_ENABLED=false \
    N8N_PERSONALIZATION_ENABLED=false \
    GENERIC_TIMEZONE=America/Bogota \
    TZ=America/Bogota
ENTRYPOINT ["tini", "--", "/bin/sh", "/opt/agrovigia/arranque-n8n.sh"]
