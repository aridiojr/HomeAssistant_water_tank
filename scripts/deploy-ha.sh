#!/usr/bin/env bash
# Copia os cards deste repositório para a pasta www/ do Home Assistant.
#
# Uso:
#   HA_HOST=homeassistant.local ./scripts/deploy-ha.sh
#   HA_HOST=192.168.1.50 HA_SSH_USER=root HA_SSH_PORT=22222 ./scripts/deploy-ha.sh
#   HA_CONFIG=/Volumes/config ./scripts/deploy-ha.sh          # share SMB montado no Mac
#   ./scripts/deploy-ha.sh --dry-run
#
# Variáveis:
#   HA_HOST      host/IP do Home Assistant (modo SSH)
#   HA_SSH_USER  usuário SSH                      (default: root)
#   HA_SSH_PORT  porta SSH                        (default: 22)
#   HA_WWW       caminho do www no HA             (default: /config/www)
#   HA_CONFIG    caminho local do config do HA (modo cópia direta, sem SSH)
#   FILES        arquivos a enviar (default: os dois cards)

set -euo pipefail

HA_SSH_USER="${HA_SSH_USER:-root}"
HA_SSH_PORT="${HA_SSH_PORT:-22}"
HA_WWW="${HA_WWW:-/config/www}"
FILES="${FILES:-screensaver-card.js caixa-dagua-card.js}"
DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

cd "$(dirname "$0")/.."

for f in $FILES; do
  [[ -f "$f" ]] || { echo "erro: arquivo não encontrado: $f" >&2; exit 1; }
done

run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "[dry-run] $*"
  else
    "$@"
  fi
}

if [[ -n "${HA_CONFIG:-}" ]]; then
  # ---- modo cópia direta (share montado, ex.: SMB no Mac) ----
  dest="$HA_CONFIG/www"
  run mkdir -p "$dest"
  for f in $FILES; do
    run cp -v "$f" "$dest/"
  done
  echo "OK: arquivos copiados para $dest"
else
  # ---- modo SSH ----
  [[ -n "${HA_HOST:-}" ]] || { echo "erro: defina HA_HOST ou HA_CONFIG" >&2; exit 1; }
  ssh_opts=(-p "$HA_SSH_PORT")
  run ssh "${ssh_opts[@]}" "$HA_SSH_USER@$HA_HOST" "mkdir -p '$HA_WWW'"
  for f in $FILES; do
    run scp -P "$HA_SSH_PORT" "$f" "$HA_SSH_USER@$HA_HOST:$HA_WWW/"
  done
  echo "OK: arquivos enviados para $HA_SSH_USER@$HA_HOST:$HA_WWW"
fi

cat <<'EOF'

Próximos passos no Home Assistant:
  1. Configurações → Painéis → aba Recursos (precisa do Modo Avançado no perfil)
  2. Adicione/confirme, como "Módulo JavaScript":
       /local/screensaver-card.js?v=1
       /local/caixa-dagua-card.js?v=1
     (se o recurso já existir, incremente o ?v= para furar o cache do navegador)
  3. Recarregue o navegador com cache limpo (Cmd+Shift+R)
  4. Adicione o card: "Protetor de Tela" (type: custom:screensaver-card)
EOF
