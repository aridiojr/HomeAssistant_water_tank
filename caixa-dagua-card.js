// Caixa D'Água Card - custom Lovelace card
// Mostra o nível de água no formato real da caixa (tronco de cone),
// com dimensões, cores e sensor configuráveis via editor visual (GUI) ou YAML.
//
// Config disponível:
//   entity          (obrigatório) - sensor com estado 0-100 (%)
//   title           - título do card
//   show_percent    - mostrar/ocultar o número da % (default: true)
//   water_color     - cor da água em nível normal (default: #2196f3)
//   low_color       - cor da água em nível baixo (default: #f44336)
//   low_threshold   - % abaixo da qual usa low_color (default: 20)
//   top_diameter    - diâmetro da boca/topo em metros (default: 1.51)
//   base_diameter   - diâmetro da base em metros (default: 1.16)
//   height          - altura útil da caixa em metros (default: 0.76)
//   volume_liters   - capacidade total da caixa em litros (default: 1000)
//   show_volume     - mostrar o volume em litros junto com a % (default: true)

class CaixaDaguaCard extends HTMLElement {
  setConfig(config) {
    if (!config.entity) {
      throw new Error("Defina 'entity' na config (sensor de nível 0-100%)");
    }
    this.config = config;
    this._level = null;

    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
    }
  }

  set hass(hass) {
    this._hass = hass;
    const stateObj = hass.states[this.config.entity];
    if (!stateObj) {
      this._renderError(`Entidade não encontrada: ${this.config.entity}`);
      return;
    }

    let level = parseFloat(stateObj.state);
    if (isNaN(level)) {
      this._renderError(`Estado não é numérico: ${stateObj.state}`);
      return;
    }
    level = Math.max(0, Math.min(100, level));

    if (level !== this._level) {
      this._level = level;
      this._render(level, stateObj);
    }
  }

  _renderError(msg) {
    this.shadowRoot.innerHTML = `
      <ha-card>
        <div style="padding:16px;color:var(--error-color)">${msg}</div>
      </ha-card>
    `;
  }

  // Gera o "path" SVG do tronco de cone a partir das dimensões reais (em metros).
  // Trabalha num viewBox fixo de 170 (largura) x 100 (altura útil do corpo),
  // escalando topo/base proporcionalmente entre si e centralizando.
  _buildTankGeometry() {
    const topD = Number(this.config.top_diameter) || 1.51;
    const baseD = Number(this.config.base_diameter) || 1.16;
    const heightM = Number(this.config.height) || 0.76;

    const VIEW_W = 170;
    const LIP_H = 8;      // pequena aba no topo
    const CORNER = 6;     // raio do canto arredondado da base
    const MAX_BODY_H = 100; // altura máxima do corpo dentro do viewBox

    // maior diâmetro entre os dois define a escala horizontal
    const maxD = Math.max(topD, baseD);
    const scale = (VIEW_W - 20) / maxD; // 10px de margem de cada lado

    const topW = topD * scale;
    const baseW = baseD * scale;
    let bodyH = heightM * scale;
    // limita altura pra não estourar o card em caixas muito altas/estreitas
    if (bodyH > MAX_BODY_H) bodyH = MAX_BODY_H;
    if (bodyH < 40) bodyH = 40;

    const centerX = VIEW_W / 2;
    const topLeft = centerX - topW / 2;
    const topRight = centerX + topW / 2;
    const baseLeft = centerX - baseW / 2;
    const baseRight = centerX + baseW / 2;

    const yLipTop = 2;
    const yBodyTop = yLipTop + LIP_H;
    const yBodyBottom = yBodyTop + bodyH;

    const path = `
      M ${topLeft - 2},${yLipTop}
      L ${topRight + 2},${yLipTop}
      L ${topRight},${yBodyTop}
      L ${baseRight},${yBodyBottom - CORNER}
      C ${baseRight - 1},${yBodyBottom - 2} ${baseRight - 5},${yBodyBottom} ${baseRight - CORNER},${yBodyBottom}
      L ${baseLeft + CORNER},${yBodyBottom}
      C ${baseLeft + 5},${yBodyBottom} ${baseLeft + 1},${yBodyBottom - 2} ${baseLeft},${yBodyBottom - CORNER}
      L ${topLeft},${yBodyTop}
      Z
    `;

    return {
      path,
      viewW: VIEW_W,
      viewH: yBodyBottom + 4,
      topY: yBodyTop,
      bottomY: yBodyBottom
    };
  }

  _render(level, stateObj) {
    const title = this.config.title || stateObj.attributes.friendly_name || 'Caixa D\'Água';
    const showPercent = this.config.show_percent !== false;
    const showVolume = this.config.show_volume !== false;
    const waterColor = this.config.water_color || '#2196f3';
    const lowColor = this.config.low_color || '#f44336';
    const lowThreshold = this.config.low_threshold ?? 20;
    const volumeLiters = Number(this.config.volume_liters) || 1000;

    const fillColor = level <= lowThreshold ? lowColor : waterColor;
    const currentLiters = (level / 100) * volumeLiters;

    const fmtLiters = (v) => {
      // formata sem casas decimais, com separador de milhar no padrão BR
      return Math.round(v).toLocaleString('pt-BR');
    };

    const geo = this._buildTankGeometry();
    const waterY = geo.bottomY - (level / 100) * (geo.bottomY - geo.topY);
    const uid = this._uid();

    this.shadowRoot.innerHTML = `
      <style>
        ha-card {
          padding: 16px;
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .title {
          font-size: 1.1em;
          font-weight: 500;
          margin-bottom: 8px;
          align-self: flex-start;
        }
        .tank-wrap {
          position: relative;
          width: 140px;
        }
        .stats-row {
          margin-top: 10px;
          display: flex;
          align-items: baseline;
          gap: 10px;
        }
        .percent-label {
          font-size: 1.4em;
          font-weight: 600;
          color: ${fillColor};
        }
        .volume-label {
          font-size: 1em;
          font-weight: 500;
          color: var(--secondary-text-color, #999);
        }
        .volume-label::before {
          content: "•";
          margin-right: 10px;
          color: var(--secondary-text-color, #999);
        }
        .water {
          transition: y 0.8s ease, fill 0.5s ease;
        }
        .wave {
          transition: fill 0.5s ease;
        }
      </style>
      <ha-card>
        <div class="title">${title}</div>
        <div class="tank-wrap">
          <svg viewBox="0 0 ${geo.viewW} ${geo.viewH}" width="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <clipPath id="tankClip-${uid}">
                <path d="${geo.path}" />
              </clipPath>
            </defs>

            <!-- contorno da caixa -->
            <path d="${geo.path}" fill="#e3e9ee" stroke="#8fa3b3" stroke-width="1.5"/>

            <!-- água recortada pela silhueta -->
            <g clip-path="url(#tankClip-${uid})">
              <rect class="water" x="0" y="${waterY}" width="${geo.viewW}" height="${geo.bottomY - waterY + 10}" fill="${fillColor}" fill-opacity="0.85"/>
              <path class="wave" d="M 0,${waterY} q ${geo.viewW / 17},-3 ${geo.viewW / 8.5},0 t ${geo.viewW / 8.5},0 t ${geo.viewW / 8.5},0 t ${geo.viewW / 8.5},0 t ${geo.viewW / 8.5},0 t ${geo.viewW / 8.5},0 t ${geo.viewW / 8.5},0 t ${geo.viewW / 8.5},0 v 4 h -${geo.viewW} z"
                fill="${fillColor}" fill-opacity="0.6"/>
            </g>
          </svg>
        </div>
        ${(showPercent || showVolume) ? `
          <div class="stats-row">
            ${showPercent ? `<div class="percent-label">${level.toFixed(0)}%</div>` : ''}
            ${showVolume ? `<div class="volume-label">${fmtLiters(currentLiters)} L / ${fmtLiters(volumeLiters)} L</div>` : ''}
          </div>
        ` : ''}
      </ha-card>
    `;
  }

  _uid() {
    if (!this._uidVal) {
      this._uidVal = Math.random().toString(36).slice(2, 8);
    }
    return this._uidVal;
  }

  getCardSize() {
    return 4;
  }

  static getConfigElement() {
    return document.createElement('caixa-dagua-card-editor');
  }

  static getStubConfig() {
    return CaixaDaguaCardHelpers.defaults();
  }
}

customElements.define('caixa-dagua-card', CaixaDaguaCard);

// ---------------------------------------------------------------------
// Editor visual (aparece ao clicar em "Editar" no card pelo Lovelace UI)
// ---------------------------------------------------------------------
class CaixaDaguaCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...CaixaDaguaCardHelpers.defaults(), ...config };
    if (!this._built) {
      // primeira vez: monta o formulário do zero
      this._render();
      this._built = true;
    } else {
      // atualizações seguintes (inclusive as que vêm do próprio usuário
      // digitando): só sincroniza valores nos campos que existem e que
      // NÃO estão com foco no momento, sem recriar o DOM.
      this._syncFieldsFromConfig();
    }
  }

  set hass(hass) {
    this._hass = hass;
    if (this._entityPicker) {
      this._entityPicker.hass = hass;
    }
  }

  // Atualiza os valores exibidos nos campos sem tocar no elemento que
  // está atualmente focado (pra não perder o cursor/foco enquanto digita).
  _syncFieldsFromConfig() {
    if (!this.shadowRoot) return;
    const active = this.shadowRoot.activeElement;

    const textIds = ['title', 'top_diameter', 'base_diameter', 'height', 'volume_liters',
                      'water_color', 'low_color', 'low_threshold'];
    textIds.forEach((id) => {
      const el = this.shadowRoot.getElementById(id);
      if (!el || el === active) return;
      const val = this._config[id];
      if (val !== undefined && String(el.value) !== String(val)) {
        el.value = val;
      }
    });

    const showPercentEl = this.shadowRoot.getElementById('show_percent');
    if (showPercentEl && showPercentEl !== active) {
      showPercentEl.checked = this._config.show_percent !== false;
    }
    const showVolumeEl = this.shadowRoot.getElementById('show_volume');
    if (showVolumeEl && showVolumeEl !== active) {
      showVolumeEl.checked = this._config.show_volume !== false;
    }
    if (this._entityPicker && this._entityPicker.value !== this._config.entity) {
      this._entityPicker.value = this._config.entity || '';
    }
  }

  _render() {
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });

    this.shadowRoot.innerHTML = `
      <style>
        .row {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          margin-bottom: 12px;
        }
        .field {
          display: flex;
          flex-direction: column;
          flex: 1;
          min-width: 140px;
        }
        label {
          font-size: 0.85em;
          color: var(--secondary-text-color, #666);
          margin-bottom: 4px;
        }
        input[type="text"], input[type="number"], select {
          padding: 8px;
          border-radius: 6px;
          border: 1px solid var(--divider-color, #ccc);
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color, #000);
          font-size: 0.95em;
        }
        input[type="color"] {
          width: 100%;
          height: 36px;
          border: 1px solid var(--divider-color, #ccc);
          border-radius: 6px;
          padding: 2px;
        }
        .checkbox-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        fieldset {
          border: 1px solid var(--divider-color, #ccc);
          border-radius: 8px;
          margin-bottom: 12px;
          padding: 10px 12px 4px;
        }
        legend {
          font-size: 0.85em;
          font-weight: 600;
          color: var(--secondary-text-color, #666);
          padding: 0 4px;
        }
        small {
          color: var(--secondary-text-color, #888);
        }
      </style>

      <div style="padding:8px 0">
        <fieldset>
          <legend>Sensor e título</legend>
          <div class="row">
            <div class="field" style="flex:2">
              <label for="entity">Sensor de nível (%)</label>
              <div id="entity-picker-slot"></div>
              <small>Selecione o sensor de nível (0-100%)</small>
            </div>
            <div class="field" style="flex:2">
              <label for="title">Título</label>
              <input type="text" id="title" value="${this._config.title || ''}" />
            </div>
          </div>
          <div class="row">
            <div class="checkbox-row">
              <input type="checkbox" id="show_percent" ${this._config.show_percent !== false ? 'checked' : ''} />
              <label for="show_percent" style="margin:0">Mostrar porcentagem</label>
            </div>
            <div class="checkbox-row">
              <input type="checkbox" id="show_volume" ${this._config.show_volume !== false ? 'checked' : ''} />
              <label for="show_volume" style="margin:0">Mostrar volume (L)</label>
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend>Dimensões e capacidade da caixa</legend>
          <div class="row">
            <div class="field">
              <label for="top_diameter">Diâmetro do topo (m)</label>
              <input type="number" step="0.01" min="0.1" id="top_diameter" value="${this._config.top_diameter}" />
            </div>
            <div class="field">
              <label for="base_diameter">Diâmetro da base (m)</label>
              <input type="number" step="0.01" min="0.1" id="base_diameter" value="${this._config.base_diameter}" />
            </div>
            <div class="field">
              <label for="height">Altura útil (m)</label>
              <input type="number" step="0.01" min="0.1" id="height" value="${this._config.height}" />
            </div>
            <div class="field">
              <label for="volume_liters">Capacidade total (L)</label>
              <input type="number" step="1" min="1" id="volume_liters" value="${this._config.volume_liters}" />
            </div>
          </div>
          <small>Valores da etiqueta do fabricante (ex.: caixa 1000L → topo 1,51m / base 1,16m / altura 0,76m / 1000L)</small>
        </fieldset>

        <fieldset>
          <legend>Cores</legend>
          <div class="row">
            <div class="field">
              <label for="water_color">Água (nível normal)</label>
              <input type="color" id="water_color" value="${this._config.water_color}" />
            </div>
            <div class="field">
              <label for="low_color">Água (nível baixo)</label>
              <input type="color" id="low_color" value="${this._config.low_color}" />
            </div>
            <div class="field">
              <label for="low_threshold">Limite nível baixo (%)</label>
              <input type="number" min="0" max="100" id="low_threshold" value="${this._config.low_threshold}" />
            </div>
          </div>
        </fieldset>
      </div>
    `;

    const ids = ['title', 'top_diameter', 'base_diameter', 'height', 'volume_liters',
                 'water_color', 'low_color', 'low_threshold'];
    ids.forEach((id) => {
      const el = this.shadowRoot.getElementById(id);
      el.addEventListener('change', () => this._valueChanged(id, el));
      el.addEventListener('input', () => this._valueChanged(id, el));
    });

    const showPercentEl = this.shadowRoot.getElementById('show_percent');
    showPercentEl.addEventListener('change', () => {
      this._config = { ...this._config, show_percent: showPercentEl.checked };
      this._fireChanged();
    });

    const showVolumeEl = this.shadowRoot.getElementById('show_volume');
    showVolumeEl.addEventListener('change', () => {
      this._config = { ...this._config, show_volume: showVolumeEl.checked };
      this._fireChanged();
    });

    this._mountEntityPicker();
  }

  // Monta o seletor de entidades nativo do HA (ha-entity-picker), com fallback
  // pra um input de texto simples caso o componente não esteja disponível
  // (ex.: fora do contexto do HA, ou versão muito antiga do frontend).
  _mountEntityPicker() {
    const slot = this.shadowRoot.getElementById('entity-picker-slot');
    if (!slot) return;

    if (customElements.get('ha-entity-picker')) {
      const picker = document.createElement('ha-entity-picker');
      picker.hass = this._hass;
      picker.value = this._config.entity || '';
      picker.style.display = 'block';
      // filtra pra sugerir só sensores (o card espera um sensor 0-100%)
      picker.includeDomains = ['sensor', 'input_number'];
      picker.addEventListener('value-changed', (ev) => {
        this._config = { ...this._config, entity: ev.detail.value };
        this._fireChanged();
      });
      slot.innerHTML = '';
      slot.appendChild(picker);
      this._entityPicker = picker;
    } else {
      // fallback: input de texto simples
      slot.innerHTML = `<input type="text" id="entity_fallback" placeholder="sensor.nivel_caixa_dagua" value="${this._config.entity || ''}" />`;
      const el = slot.querySelector('#entity_fallback');
      el.addEventListener('change', () => {
        this._config = { ...this._config, entity: el.value };
        this._fireChanged();
      });
    }
  }

  _valueChanged(id, el) {
    let value = el.value;
    if (['top_diameter', 'base_diameter', 'height', 'low_threshold'].includes(id)) {
      value = value === '' ? undefined : Number(value);
    }
    this._config = { ...this._config, [id]: value };
    this._fireChanged();
  }

  _fireChanged() {
    const event = new CustomEvent('config-changed', {
      detail: { config: this._config },
      bubbles: true,
      composed: true
    });
    this.dispatchEvent(event);
  }
}

customElements.define('caixa-dagua-card-editor', CaixaDaguaCardEditor);

const CaixaDaguaCardHelpers = {
  defaults() {
    return {
      entity: '',
      title: "Caixa D'Água",
      show_percent: true,
      show_volume: true,
      water_color: '#2196f3',
      low_color: '#f44336',
      low_threshold: 20,
      top_diameter: 1.51,
      base_diameter: 1.16,
      height: 0.76,
      volume_liters: 1000
    };
  }
};

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'caixa-dagua-card',
  name: "Caixa D'Água",
  description: 'Mostra o nível de água no formato real da caixa, com dimensões, cores e sensor configuráveis pelo editor visual.'
});
