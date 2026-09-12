# Deploy no Home Assistant + modo kiosk

Guia para colocar o `screensaver-card.js` no servidor e deixar um painel
rodando em tela cheia (Mac, tablet Android ou Raspberry Pi).

## Atalho: tudo em um comando (macOS)

```bash
HA_HOST=192.168.1.50 ./scripts/setup-kiosk-mac.sh --dry-run   # confere sem alterar nada
HA_HOST=192.168.1.50 ./scripts/setup-kiosk-mac.sh             # envia + cria o lançador
HA_HOST=192.168.1.50 ./scripts/setup-kiosk-mac.sh --autostart # ...e abre no login
```

Esse script faz os passos 1 e 5 deste guia: envia os cards para `config/www`,
cria `~/bin/ha-kiosk.sh` (Chrome em kiosk + `caffeinate` para a tela não
apagar) e, com `--autostart`, registra um LaunchAgent para abrir no login.
O registro do recurso no Lovelace (passo 2) continua sendo pela interface do
HA — são quatro cliques e o script imprime o link direto.

Variáveis úteis: `HA_SSH_PORT`, `HA_SSH_USER`, `HA_CONFIG` (share montado, sem
SSH), `DASHBOARD` (default `lovelace/relogio`), `SKIP_DEPLOY=1` (só recria o
lançador).

Remover o autostart:

```bash
launchctl unload ~/Library/LaunchAgents/com.ha-kiosk.plist
rm ~/Library/LaunchAgents/com.ha-kiosk.plist
```

## 1. Enviar o arquivo para o HA

### Opção A — SSH (add-on “Advanced SSH & Web Terminal”)

```bash
HA_HOST=homeassistant.local ./scripts/deploy-ha.sh
# porta/usuário diferentes:
HA_HOST=192.168.1.50 HA_SSH_USER=root HA_SSH_PORT=22222 ./scripts/deploy-ha.sh
```

### Opção B — share de rede montado no Mac

No Finder: **Ir → Conectar ao servidor** → `smb://homeassistant.local` → share
`config`. Depois:

```bash
HA_CONFIG=/Volumes/config ./scripts/deploy-ha.sh
```

### Opção C — add-on Samba/File editor

Copie `screensaver-card.js` manualmente para `config/www/`.

Use `./scripts/deploy-ha.sh --dry-run` para ver os comandos sem executar nada.

## 2. Registrar o recurso no Lovelace

**Configurações → Painéis → aba Recursos** (exige *Modo avançado* no perfil do
usuário) → **Adicionar recurso**:

- URL: `/local/screensaver-card.js?v=1`
- Tipo: **Módulo JavaScript**

Ao atualizar o arquivo depois, incremente o `?v=` (ex.: `?v=2`) para furar o
cache do navegador, ou recarregue com `Cmd+Shift+R`.

Em YAML (`configuration.yaml`, dashboards em modo YAML):

```yaml
lovelace:
  mode: yaml
  resources:
    - url: /local/screensaver-card.js?v=1
      type: module
```

## 3. Adicionar o card

Dashboard → **Editar → Adicionar card → Protetor de Tela**. Configure pelo
editor visual ou cole o YAML de exemplo do
[SCREENSAVER.md](SCREENSAVER.md#exemplos-yaml).

Para o modo overlay, basta **um** card em uma view do painel que fica aberta no
tablet — ele cobre toda a interface quando ocioso.

## 4. Kiosk: esconder cabeçalho e barra lateral

### kiosk-mode (HACS, recomendado)

HACS → Frontend → **kiosk-mode**. Depois, no `raw config` do dashboard:

```yaml
kiosk_mode:
  hide_header: true
  hide_sidebar: true
```

Ou por view/usuário:

```yaml
kiosk_mode:
  admin_settings:
    hide_header: false
  non_admin_settings:
    hide_header: true
    hide_sidebar: true
```

### Sem add-ons

Acrescente os parâmetros na URL do painel:

```
http://homeassistant.local:8123/lovelace/relogio?kiosk
```

(`?kiosk` funciona com o kiosk-mode instalado; sem ele, use uma view com
`panel: true`, que já remove as margens.)

## 5. Tela cheia no dispositivo

### macOS (Chrome ou Chromium)

```bash
open -na "Google Chrome" --args \
  --kiosk \
  --app="http://homeassistant.local:8123/lovelace/relogio?kiosk" \
  --user-data-dir="$HOME/.ha-kiosk" \
  --disable-session-crashed-bubble \
  --noerrdialogs
```

- `--user-data-dir` cria um perfil separado, para não mexer no Chrome do dia a dia.
- Faça login no HA uma vez nesse perfil e marque **“Manter-me conectado”**.
- Para o Mac não dormir enquanto o painel está aberto: `caffeinate -dimsu`
  (ou **Configurações do Sistema → Bloqueio de Tela**).
- Sair do kiosk: `Cmd+Q`.

Atalho: salve como `~/bin/ha-kiosk.sh`, `chmod +x` e adicione em
**Configurações do Sistema → Geral → Itens de Início de Sessão**.

### Android (Fully Kiosk Browser)

- **Web Content → Start URL**: a URL do painel com `?kiosk`
- **Device Management → Keep Screen On**: ligado
- **Screensaver**: *desligado* (o card já faz esse papel; deixar os dois
  brigando faz a tela piscar)
- **Screen Brightness**: se quiser que o próprio tablet baixe o brilho à noite,
  use `dim_dashboard: false` no card e controle o brilho por automação
  (`fully_kiosk.set_screen_brightness` via integração Fully Kiosk).

### Raspberry Pi / Linux

```bash
chromium-browser --kiosk --noerrdialogs --disable-infobars \
  --app="http://homeassistant.local:8123/lovelace/relogio?kiosk"
xset s off -dpms   # impede o blank screen do X, deixando o card cuidar disso
```

## 6. Escurecimento noturno

Três caminhos, do mais simples ao mais completo:

1. **Só o protetor escurece** (default): `night_dim: true`. Usa `sun.sun`
   (ou `night_start`/`night_end` com `use_sun: false`).
2. **Protetor + dashboard escurecem**: `dim_dashboard: true` — aplica um
   `filter: brightness()` na interface do HA inteira naquele navegador.
3. **Brilho real do hardware**: automação no HA chamando
   `fully_kiosk.set_screen_brightness` (Android) ou
   `light.turn_on` no backlight do Pi, disparada por `sun` ou por horário.
   O mais confortável à noite, porque reduz de fato a luz emitida.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| `Custom element doesn't exist: screensaver-card` | Recurso não registrado ou cache; confira o caminho `/local/...` e recarregue com `Cmd+Shift+R` |
| Card aparece, mas o protetor nunca ativa | `idle_seconds: 0`, aba em segundo plano, ou `disable_on_mobile: true` numa tela estreita |
| “Sensores não encontrados” | `entity_prefix` diferente do nome do dispositivo ESPHome — selecione as entidades no editor |
| Protetor pisca / liga e desliga | Outro protetor ativo no dispositivo (Fully Kiosk, mouse jiggler, `pointermove` de animação) |
| Some ao atualizar o arquivo | Cache do navegador: incremente o `?v=` no recurso |
