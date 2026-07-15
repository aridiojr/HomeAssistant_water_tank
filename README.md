# Caixa D'Água Card

Custom card para Home Assistant que exibe o nível de uma caixa d'água no formato
real dela (tronco de cone), com água subindo/descendo conforme um sensor de 0-100%.

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
