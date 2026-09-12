# Cards customizados para Home Assistant

Dois custom cards, sem dependências e sem build:

| Card | Tipo | O que faz |
|---|---|---|
| **Caixa D'Água** | `custom:caixa-dagua-card` | Nível da caixa no formato real dela (tronco de cone), com água subindo/descendo conforme um sensor de 0-100%. |
| **Protetor de Tela** | `custom:screensaver-card` | Protetor de tela para painéis: fundo escuro, relógio, data e sensores (temperatura, umidade, pressão) com escurecimento noturno. Veja [docs/SCREENSAVER.md](docs/SCREENSAVER.md). |

Deploy e modo kiosk (Mac, tablet, Raspberry Pi): [docs/KIOSK.md](docs/KIOSK.md).
Enviar os arquivos para o HA: `./scripts/deploy-ha.sh` (use `--dry-run` primeiro).
No Mac, `./scripts/setup-kiosk-mac.sh` faz o envio, o registro do recurso no
Lovelace (com `HA_TOKEN`) e o lançador de kiosk de uma vez.

---

## Caixa D'Água Card

Exibe o nível de uma caixa d'água no formato real dela (tronco de cone), com
água subindo/descendo conforme um sensor de 0-100%.

![preview](preview.png)

## Instalação via HACS

1. HACS → menu (⋮) → **Repositórios personalizados**
2. URL: `https://github.com/SEU_USUARIO/SEU_REPO`
3. Categoria: **Dashboard**
4. Instalar e recarregar o navegador

## Instalação manual

1. Copie `caixa-dagua-card.js` para `config/www/`
2. Configurações → Painéis → Recursos → adicione `/local/caixa-dagua-card.js` como módulo JavaScript

## Configuração

| Opção | Descrição | Padrão |
|---|---|---|
| `entity` | Sensor de nível, estado 0-100 (%) | *(obrigatório)* |
| `title` | Título do card | `Caixa D'Água` |
| `show_percent` | Mostrar o número de % | `true` |
| `top_diameter` | Diâmetro do topo (m) | `1.51` |
| `base_diameter` | Diâmetro da base (m) | `1.16` |
| `height` | Altura útil (m) | `0.76` |
| `water_color` | Cor da água em nível normal | `#2196f3` |
| `low_color` | Cor da água em nível baixo | `#f44336` |
| `low_threshold` | % abaixo do qual usa `low_color` | `20` |

As dimensões default correspondem a uma caixa d'água de polietileno de 1000L.
Ajuste conforme a etiqueta do fabricante da sua caixa.

### Exemplo YAML

```yaml
type: custom:caixa-dagua-card
entity: sensor.nivel_caixa_dagua
title: Caixa D'Água
top_diameter: 1.51
base_diameter: 1.16
height: 0.76
water_color: "#2196f3"
low_color: "#f44336"
low_threshold: 20
```

Também é possível configurar tudo pelo editor visual do Lovelace (sem precisar de YAML).

---

## Protetor de Tela

![protetor de tela](docs/screensaver-preview.png)

Depois de alguns segundos sem interação, cobre o painel com um fundo escuro
mostrando relógio, data e os sensores do ESPHome (temperatura, umidade e
pressão atmosférica). À noite o conteúdo escurece sozinho (via `sun.sun` ou
faixa de horário) e qualquer toque desliga o protetor.

```yaml
type: custom:screensaver-card
mode: overlay
idle_seconds: 120
entity_prefix: utilidades
night_brightness: 0.3
```

- Todas as opções e exemplos: [docs/SCREENSAVER.md](docs/SCREENSAVER.md)
- Instalação, kiosk e escurecimento noturno: [docs/KIOSK.md](docs/KIOSK.md)
- Prévia local sem o HA: abra `docs/preview.html` no navegador
