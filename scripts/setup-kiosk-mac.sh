#!/usr/bin/env bash
# Faz o setup completo a partir do Mac, em um comando:
#   1. envia os cards para config/www do Home Assistant
#   2. cria o lançador do kiosk (~/bin/ha-kiosk.sh) com Chrome em tela cheia
#   3. opcionalmente registra o kiosk para abrir no login (--autostart)
#
# Uso:
#   HA_HOST=192.168.1.50 ./scripts/setup-kiosk-mac.sh --dry-run
#   HA_HOST=192.168.1.50 ./scripts/setup-kiosk-mac.sh
#   HA_HOST=192.168.1.50 DASHBOARD=lovelace/relogio ./scripts/setup-kiosk-mac.sh --autostart
#
# Variáveis:
#   HA_HOST      host/IP do Home Assistant                  (obrigatório)
#   HA_PORT      porta da interface web                      (default: 8123)
#   HA_SSH_PORT  porta SSH do add-on                          (default: 22)
#   HA_SSH_USER  usuário SSH                                  (default: root)
#   HA_CONFIG    caminho local do config (share montado; dispensa SSH)
#   DASHBOARD    caminho do painel a abrir  (default: lovelace/relogio)
#   KIOSK_QUERY  parâmetro de kiosk na URL  (default: ?kiosk)
#   SKIP_DEPLOY  1 para só (re)criar o lançador

set -euo pipefail
cd "$(dirname "$0")/.."

HA_PORT="${HA_PORT:-8123}"
DASHBOARD="${DASHBOARD:-lovelace/relogio}"
KIOSK_QUERY="${KIOSK_QUERY:-?kiosk}"
LAUNCHER="$HOME/bin/ha-kiosk.sh"
PLIST="$HOME/Library/LaunchAgents/com.ha-kiosk.plist"
DRY_RUN=0
AUTOSTART=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --autostart) AUTOSTART=1 ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "erro: argumento desconhecido: $arg" >&2; exit 1 ;;
  esac
done

say()  { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
run()  { if [[ $DRY_RUN -eq 1 ]]; then echo "[dry-run] $*"; else "$@"; fi; }

if [[ "$(uname -s)" != "Darwin" && $DRY_RUN -eq 0 ]]; then
  echo "erro: este script é para macOS. Em Linux/Pi veja docs/KIOSK.md." >&2
  exit 1
fi

URL="http://${HA_HOST:-HA_HOST}:${HA_PORT}/${DASHBOARD}${KIOSK_QUERY}"

# ---------------------------------------------------------------- 1. deploy
if [[ "${SKIP_DEPLOY:-0}" != "1" ]]; then
  say "Enviando os cards para o Home Assistant"
  if [[ $DRY_RUN -eq 1 ]]; then
    ./scripts/deploy-ha.sh --dry-run
  else
    ./scripts/deploy-ha.sh
  fi
fi

# ------------------------------------------------------------- 2. lançador
say "Criando o lançador do kiosk em $LAUNCHER"

CHROME_CANDIDATES=(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  "/Applications/Chromium.app/Contents/MacOS/Chromium"
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
)
CHROME=""
for candidate in "${CHROME_CANDIDATES[@]}"; do
  [[ -x "$candidate" ]] && { CHROME="$candidate"; break; }
done
if [[ -z "$CHROME" ]]; then
  if [[ $DRY_RUN -eq 1 ]]; then
    CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  else
    echo "erro: nenhum navegador baseado em Chromium encontrado em /Applications." >&2
    echo "      Instale o Google Chrome ou o Chromium e rode de novo." >&2
    exit 1
  fi
fi
echo "navegador: $CHROME"
echo "URL:       $URL"

if [[ $DRY_RUN -eq 1 ]]; then
  echo "[dry-run] escreveria $LAUNCHER e faria chmod +x"
else
  mkdir -p "$(dirname "$LAUNCHER")"
  cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
# Gerado por scripts/setup-kiosk-mac.sh — abre o painel do HA em tela cheia.
# Sair do kiosk: Cmd+Q
set -euo pipefail
URL="$URL"
CHROME="$CHROME"
PROFILE="\$HOME/.ha-kiosk"
mkdir -p "\$PROFILE"

# mantém a tela acesa enquanto o kiosk estiver aberto (encerra junto)
caffeinate -dimsu -w \$\$ >/dev/null 2>&1 &

exec "\$CHROME" \\
  --kiosk \\
  --app="\$URL" \\
  --user-data-dir="\$PROFILE" \\
  --noerrdialogs \\
  --disable-infobars \\
  --disable-session-crashed-bubble \\
  --disable-features=TranslateUI \\
  --autoplay-policy=no-user-gesture-required
EOF
  chmod +x "$LAUNCHER"
fi

# ------------------------------------------------------------ 3. autostart
if [[ $AUTOSTART -eq 1 ]]; then
  say "Registrando o kiosk para abrir no login"
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "[dry-run] escreveria $PLIST e faria launchctl load"
  else
    mkdir -p "$(dirname "$PLIST")"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.ha-kiosk</string>
  <key>ProgramArguments</key>
  <array><string>$LAUNCHER</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
</dict>
</plist>
EOF
    launchctl unload "$PLIST" >/dev/null 2>&1 || true
    launchctl load "$PLIST"
    echo "registrado. Para remover: launchctl unload '$PLIST' && rm '$PLIST'"
  fi
fi

# ----------------------------------------------------------------- resumo
cat <<EOF

$(printf '\033[1m')Falta só o passo que exige a interface do HA:$(printf '\033[0m')

  1. Abra http://${HA_HOST:-HA_HOST}:${HA_PORT}/config/lovelace/resources
     (precisa de "Modo avançado" ligado no seu perfil)
  2. Adicionar recurso → URL: /local/screensaver-card.js?v=1
     Tipo: Módulo JavaScript
  3. Crie a view do relógio (Dashboard → Editar → + View):
        título: Relógio   |   url: relogio   |   tipo: Painel (1 card)
     e adicione o card "Protetor de Tela" (YAML em docs/SCREENSAVER.md)

Depois, para abrir o painel em tela cheia:

  $LAUNCHER

EOF
