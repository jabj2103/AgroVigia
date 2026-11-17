#!/usr/bin/env bash
# Pasa las copias HTML de capturar-vistas.mjs por los gates de ux-ui-agent-skills (plugin de Claude Code).
# Uso: tests/gates-ux.sh <carpeta-con-html> [gate...]
# Cada fallo deja su detalle en <carpeta>/<gate>.<pagina>.txt
KIT="${UX_UI_KIT:-$HOME/.claude/plugins/cache/ux-ui-agent-skills/ux-ui-agent-skills/3.1.0}"
DIR="$1"; shift
GATES=("$@")
[ ${#GATES[@]} -eq 0 ] && GATES=(measure_render verify_target_size verify_overflow verify_spacing verify_states verify_responsive verify_mobile_first verify_reduced_motion verify_keyboard slop_tells taste_audit verify_screen_economy)
export DS_REQUIRE_BROWSER=1
for g in "${GATES[@]}"; do
  printf '%-24s' "$g"
  for f in "$DIR"/*.html; do
    n=$(basename "$f" .html); extra=""; [ "$g" = verify_responsive ] && extra="--no-fold"
    salida="$(timeout 170 node "$KIT/scripts/gate.mjs" "$g.mjs" "$f" $extra 2>&1)"
    if [ $? -eq 0 ]; then rm -f "$DIR/$g.$n.txt"; else printf ' %s:FALLA' "$n"; echo "$salida" | grep -v '^\s*$' | tail -14 | cut -c1-260 > "$DIR/$g.$n.txt"; fi
  done
  echo
done
