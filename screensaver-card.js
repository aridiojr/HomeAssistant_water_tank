// Screensaver Card - protetor de tela para painéis do Home Assistant
//
// Dois modos de uso:
//   mode: overlay (default) -> monitora inatividade e cobre TODA a interface do HA
//                              com um fundo escuro + relógio + sensores.
//   mode: card              -> renderiza direto dentro do card/view (útil em uma
//                              view com "panel: true" aberta em um tablet/kiosk).
//
// Config disponível:
//   mode                 - "overlay" | "card"            (default: overlay)
//   idle_seconds         - segundos sem interação para ativar (default: 120)
//   temperature_entity   - sensor de temperatura
//   humidity_entity      - sensor de umidade
//   pressure_entity      - sensor de pressão atmosférica
//   entity_prefix        - prefixo usado na autodescoberta   (default: utilidades)
//   extra_entities       - lista extra: string ou {entity, name, icon}
//   show_date            - mostrar data                      (default: true)
//   show_seconds         - mostrar segundos no relógio        (default: false)
//   clock_24h            - relógio 24h                        (default: true)
//   locale               - locale de data/hora                (default: pt-BR)
//   background           - cor de fundo                        (default: #000000)
//   text_color           - cor do relógio                      (default: #f5f5f5)
//   accent_color         - cor dos valores dos sensores        (default: #8ab4f8)
//   night_dim            - escurecer à noite                   (default: true)
//   day_brightness       - brilho de dia   (0.05-1)            (default: 1)
//   night_brightness     - brilho de noite (0.05-1)            (default: 0.35)
//   night_start          - início da noite  "HH:MM"            (default: 22:00)
//   night_end            - fim da noite     "HH:MM"            (default: 06:30)
//   use_sun              - usar sun.sun em vez dos horários    (default: true)
//   dim_dashboard        - escurecer também o dashboard à noite (default: false)
//   burn_in_protection   - deslocar o conteúdo devagar          (default: true)
//   fade_ms              - duração do fade                      (default: 800)
//   disable_on_mobile    - não ativar em telas estreitas        (default: false)

// Envolvido em IIFE para não vazar nada no escopo global
// (o HA carrega como módulo, mas assim também funciona como <script> comum).
(function () {
'use strict';

const SS_DEFAULTS = {
  mode: 'overlay',
  idle_seconds: 120,
  temperature_entity: '',
  humidity_entity: '',
  pressure_entity: '',
  entity_prefix: 'utilidades',
  extra_entities: [],
  show_date: true,
  show_seconds: false,
  clock_24h: true,
  locale: 'pt-BR',
  background: '#000000',
  text_color: '#f5f5f5',
  accent_color: '#8ab4f8',
  night_dim: true,
  day_brightness: 1,
  night_brightness: 0.35,
  night_start: '22:00',
  night_end: '06:30',
  use_sun: true,
  dim_dashboard: false,
  burn_in_protection: true,
  fade_ms: 800,
  disable_on_mobile: false,
};

// ---------------------------------------------------------------------
// Helpers compartilhados (descoberta de sensores, formatação, noite)
// ---------------------------------------------------------------------
const SS = {
  defaults() {
    return JSON.parse(JSON.stringify(SS_DEFAULTS));
  },

  num(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  },

  clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  },

  // Procura no hass um sensor cujo device_class combine e cujo entity_id
  // contenha o prefixo configurado (ex.: sensor.utilidades_temperatura).
  discover(hass, prefix, deviceClasses) {
    if (!hass || !prefix) return '';
    const wanted = deviceClasses.map((c) => c.toLowerCase());
    const p = String(prefix).toLowerCase().replace(/^sensor\./, '');
    const ids = Object.keys(hass.states).filter((id) => id.startsWith('sensor.'));

    // 1) device_class correto + prefixo no entity_id
    for (const id of ids) {
      const st = hass.states[id];
      const dc = (st.attributes.device_class || '').toLowerCase();
      if (wanted.includes(dc) && id.toLowerCase().includes(p)) return id;
    }
    // 2) sem device_class: tenta pelo nome da entidade
    const byName = {
      temperature: ['temperatura', 'temperature', '_temp'],
      humidity: ['umidade', 'humidity', '_hum'],
      pressure: ['pressao', 'pressão', 'pressure', 'atmospheric'],
    };
    const words = wanted.flatMap((c) => byName[c] || []);
    for (const id of ids) {
      const low = id.toLowerCase();
      if (low.includes(p) && words.some((w) => low.includes(w))) return id;
    }
    return '';
  },

  resolveSensors(hass, config) {
    const prefix = config.entity_prefix;
    const temperature = config.temperature_entity || SS.discover(hass, prefix, ['temperature']);
    const humidity = config.humidity_entity || SS.discover(hass, prefix, ['humidity']);
    const pressure = config.pressure_entity
      || SS.discover(hass, prefix, ['pressure', 'atmospheric_pressure']);
    return { temperature, humidity, pressure };
  },

  formatValue(stateObj, decimals) {
    if (!stateObj) return null;
    const raw = stateObj.state;
    if (raw === undefined || raw === null || raw === 'unknown' || raw === 'unavailable' || raw === '') {
      return null;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return { text: String(raw), unit: '' };
    const unit = stateObj.attributes.unit_of_measurement || '';
    return { text: n.toFixed(decimals).replace('.', ','), unit };
  },

  // Considera noite via sun.sun (se disponível e habilitado) ou pelos horários.
  isNight(hass, config, now = new Date()) {
    if (config.use_sun !== false && hass && hass.states['sun.sun']) {
      return hass.states['sun.sun'].state === 'below_horizon';
    }
    const toMin = (hhmm, fallback) => {
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
      if (!m) return fallback;
      return SS.clamp(Number(m[1]), 0, 23) * 60 + SS.clamp(Number(m[2]), 0, 59);
    };
    const start = toMin(config.night_start, 22 * 60);
    const end = toMin(config.night_end, 6 * 60 + 30);
    const cur = now.getHours() * 60 + now.getMinutes();
    // intervalo que cruza a meia-noite
    return start <= end ? (cur >= start && cur < end) : (cur >= start || cur < end);
  },

  brightness(hass, config) {
    if (config.night_dim === false) return SS.clamp(SS.num(config.day_brightness, 1), 0.05, 1);
    const night = SS.isNight(hass, config);
    const value = night ? SS.num(config.night_brightness, 0.35) : SS.num(config.day_brightness, 1);
    return SS.clamp(value, 0.05, 1);
  },

  formatClock(config, now = new Date()) {
    const opts = {
      hour: '2-digit',
      minute: '2-digit',
      hour12: config.clock_24h === false,
    };
    if (config.show_seconds) opts.second = '2-digit';
    let time;
    try {
      time = new Intl.DateTimeFormat(config.locale || 'pt-BR', opts).format(now);
    } catch (e) {
      time = now.toTimeString().slice(0, config.show_seconds ? 8 : 5);
    }
    let date = '';
    try {
      date = new Intl.DateTimeFormat(config.locale || 'pt-BR', {
        weekday: 'long', day: '2-digit', month: 'long',
      }).format(now);
      date = date.charAt(0).toUpperCase() + date.slice(1);
    } catch (e) {
      date = now.toDateString();
    }
    return { time, date };
  },

  // Monta a lista de itens (temperatura/umidade/pressão + extras) já formatada.
  buildItems(hass, config) {
    if (!hass) return [];
    const sensors = SS.resolveSensors(hass, config);
    const items = [];

    const push = (entityId, icon, label, decimals) => {
      if (!entityId) return;
      const stateObj = hass.states[entityId];
      const val = SS.formatValue(stateObj, decimals);
      if (!val) return;
      items.push({ icon, label, value: val.text, unit: val.unit });
    };

    push(sensors.temperature, 'mdi:thermometer', 'Temperatura', 1);
    push(sensors.humidity, 'mdi:water-percent', 'Umidade', 0);
    push(sensors.pressure, 'mdi:gauge', 'Pressão', 0);

    (config.extra_entities || []).forEach((extra) => {
      const entityId = typeof extra === 'string' ? extra : (extra && extra.entity);
      if (!entityId) return;
      const stateObj = hass.states[entityId];
      const val = SS.formatValue(stateObj, 1);
      if (!val) return;
      const label = (typeof extra === 'object' && extra.name)
        || (stateObj.attributes.friendly_name || entityId);
      const icon = (typeof extra === 'object' && extra.icon)
        || stateObj.attributes.icon || 'mdi:information-outline';
      items.push({ icon, label, value: val.text, unit: val.unit });
    });

    return items;
  },

  // HTML do conteúdo (relógio + sensores). Usado pelo overlay e pelo modo card.
  contentHtml(items, clock, config) {
    // No HA usa o <ha-icon> nativo; fora dele (preview local) cai num emoji.
    const fallbackIcons = {
      'mdi:thermometer': '\u{1F321}',
      'mdi:water-percent': '\u{1F4A7}',
      'mdi:gauge': '\u{1F30D}',
    };
    const iconTag = customElements.get('ha-icon')
      ? (icon) => `<ha-icon icon="${icon}"></ha-icon>`
      : (icon) => `<span class="ss-icon-fallback">${fallbackIcons[icon] || '\u{2022}'}</span>`;
    return `
      <div class="ss-clock">${clock.time}</div>
      ${config.show_date !== false ? `<div class="ss-date">${clock.date}</div>` : ''}
      ${items.length ? `
        <div class="ss-sensors">
          ${items.map((it) => `
            <div class="ss-sensor">
              <div class="ss-icon">${iconTag(it.icon)}</div>
              <div class="ss-value">${it.value}<span class="ss-unit">${it.unit}</span></div>
              <div class="ss-label">${it.label}</div>
            </div>
          `).join('')}
        </div>
      ` : ''}
    `;
  },

  // Assinatura do que está na tela: evita reescrever o DOM a cada
  // atualização do hass (o HA chama set hass a cada mudança de estado).
  signature(items, clock, brightness, config) {
    return JSON.stringify([
      clock.time, config.show_date !== false ? clock.date : '',
      brightness, items, config.background, config.text_color, config.accent_color,
      config.mode, config.idle_seconds,
    ]);
  },

  styles(config) {
    return `
      .ss-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
        width: 100%;
        height: 100%;
        text-align: center;
        color: ${config.text_color || '#f5f5f5'};
        font-family: var(--paper-font-body1_-_font-family, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
        transition: filter 4s linear, transform 8s ease-in-out;
        will-change: filter, transform;
      }
      .ss-clock {
        font-size: clamp(3.5rem, 18vw, 12rem);
        font-weight: 200;
        line-height: 1;
        letter-spacing: 0.02em;
        font-variant-numeric: tabular-nums;
      }
      .ss-date {
        font-size: clamp(0.9rem, 3.2vw, 1.9rem);
        font-weight: 300;
        opacity: 0.65;
        margin-top: 4px;
      }
      .ss-sensors {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: clamp(16px, 6vw, 64px);
        margin-top: clamp(18px, 5vh, 56px);
      }
      .ss-sensor {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        min-width: 72px;
      }
      .ss-icon-fallback {
        font-size: clamp(18px, 3vw, 26px);
        line-height: 1;
      }
      .ss-icon {
        color: ${config.accent_color || '#8ab4f8'};
        opacity: 0.9;
        --mdc-icon-size: clamp(20px, 3.4vw, 30px);
        height: clamp(20px, 3.4vw, 30px);
      }
      .ss-value {
        font-size: clamp(1.3rem, 4.6vw, 2.6rem);
        font-weight: 400;
        color: ${config.accent_color || '#8ab4f8'};
        font-variant-numeric: tabular-nums;
      }
      .ss-unit {
        font-size: 0.5em;
        margin-left: 3px;
        opacity: 0.75;
      }
      .ss-label {
        font-size: clamp(0.65rem, 1.6vw, 0.9rem);
        text-transform: uppercase;
        letter-spacing: 0.12em;
        opacity: 0.45;
      }
    `;
  },
};

// ---------------------------------------------------------------------
// Controller (singleton): dono do overlay, dos listeners e dos timers.
// Um único overlay é compartilhado mesmo que o card esteja em várias views.
// ---------------------------------------------------------------------
class ScreensaverController {
  constructor() {
    this.config = SS.defaults();
    this.hass = null;
    this.active = false;
    this.lastActivity = Date.now();
    this.owners = new Set();
    this.overlay = null;
    this.contentEl = null;
    this.styleEl = null;
    this._boundActivity = (ev) => this._onActivity(ev);
    this._boundDismiss = (ev) => this._onDismiss(ev);
    this._offset = { x: 0, y: 0 };
  }

  register(owner, config, hass) {
    this.owners.add(owner);
    this.config = config;
    if (hass) this.hass = hass;
    this._ensureOverlay();
    this._attachListeners();
    this._startTimer();
    this._applyDashboardDim();
  }

  unregister(owner) {
    this.owners.delete(owner);
    if (this.owners.size === 0) this.teardown();
  }

  update(config, hass) {
    this.config = config;
    this.hass = hass;
    if (this.active) this._renderContent();
    this._applyDashboardDim();
  }

  teardown() {
    this._detachListeners();
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
    this.overlay = null;
    this.contentEl = null;
    this.active = false;
    this._setDashboardBrightness(1);
  }

  // ---- ciclo de vida interno -------------------------------------------
  _ensureOverlay() {
    if (this.overlay && this.overlay.isConnected) return;
    const overlay = document.createElement('div');
    overlay.id = 'ha-screensaver-overlay';
    overlay.setAttribute('role', 'presentation');
    const shadow = overlay.attachShadow({ mode: 'open' });
    this.styleEl = document.createElement('style');
    const host = document.createElement('div');
    host.className = 'ss-content';
    shadow.appendChild(this.styleEl);
    shadow.appendChild(host);
    this.contentEl = host;
    this.overlay = overlay;
    this._applyOverlayStyle();
    document.body.appendChild(overlay);
  }

  _applyOverlayStyle() {
    const fade = SS.num(this.config.fade_ms, 800);
    Object.assign(this.overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483000',
      background: this.config.background || '#000000',
      opacity: this.active ? '1' : '0',
      pointerEvents: this.active ? 'auto' : 'none',
      transition: `opacity ${fade}ms ease`,
      display: 'block',
      cursor: this.active ? 'none' : 'auto',
      overscrollBehavior: 'none',
    });
  }

  _attachListeners() {
    if (this._listening) return;
    this._listening = true;
    const opts = { capture: true, passive: true };
    ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll']
      .forEach((ev) => window.addEventListener(ev, this._boundActivity, opts));
    document.addEventListener('visibilitychange', this._boundActivity, true);
  }

  _detachListeners() {
    if (!this._listening) return;
    this._listening = false;
    const opts = { capture: true };
    ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll']
      .forEach((ev) => window.removeEventListener(ev, this._boundActivity, opts));
    document.removeEventListener('visibilitychange', this._boundActivity, true);
  }

  _startTimer() {
    if (this._timer) return;
    this._timer = setInterval(() => this._tick(), 1000);
  }

  _onActivity(ev) {
    // Enquanto o protetor está visível, o overlay engole a interação
    // (o primeiro toque só desliga o protetor, não clica no que está atrás).
    if (this.active) {
      this._onDismiss(ev);
      return;
    }
    this.lastActivity = Date.now();
  }

  _onDismiss() {
    if (!this.active) return;
    if (this._dismissGuard && Date.now() - this._dismissGuard < 250) return;
    this.deactivate();
  }

  _tick() {
    if (this.active) {
      this._renderContent();
      this._applyBurnInShift();
      return;
    }
    if (document.visibilityState === 'hidden') {
      this.lastActivity = Date.now();
      return;
    }
    if (this.config.disable_on_mobile && window.innerWidth < 500) return;
    const idle = SS.num(this.config.idle_seconds, 120);
    if (idle <= 0) return;
    if ((Date.now() - this.lastActivity) / 1000 >= idle) this.activate();
  }

  activate() {
    this._ensureOverlay();
    if (this.active) return;
    this.active = true;
    this._dismissGuard = Date.now();
    this._sig = null;
    this._renderContent();
    this._applyOverlayStyle();
    // clique/toque em cima do overlay também desliga
    this.overlay.addEventListener('pointerdown', this._boundDismiss, true);
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;
    this.lastActivity = Date.now();
    if (this.overlay) {
      this.overlay.removeEventListener('pointerdown', this._boundDismiss, true);
      this._applyOverlayStyle();
    }
  }

  _renderContent() {
    if (!this.contentEl) return;
    const config = this.config;
    const clock = SS.formatClock(config);
    const items = SS.buildItems(this.hass, config);
    const brightness = SS.brightness(this.hass, config);
    const sig = SS.signature(items, clock, brightness, config);
    if (sig === this._sig) return;
    this._sig = sig;
    this.styleEl.textContent = SS.styles(config);
    this.contentEl.innerHTML = SS.contentHtml(items, clock, config);
    this.contentEl.style.filter = `brightness(${brightness})`;
    this.contentEl.style.transform =
      `translate(${this._offset.x}px, ${this._offset.y}px)`;
    this.overlay.style.background = config.background || '#000000';
  }

  // Anti burn-in: a cada ~60s desloca o conteúdo alguns pixels.
  _applyBurnInShift() {
    if (this.config.burn_in_protection === false) return;
    const now = Date.now();
    if (this._lastShift && now - this._lastShift < 60000) return;
    this._lastShift = now;
    const range = 24;
    this._offset = {
      x: Math.round((Math.random() - 0.5) * range),
      y: Math.round((Math.random() - 0.5) * range),
    };
    if (this.contentEl) {
      this.contentEl.style.transform =
        `translate(${this._offset.x}px, ${this._offset.y}px)`;
    }
  }

  // Escurece o próprio dashboard à noite (opcional).
  _applyDashboardDim() {
    if (!this.config.dim_dashboard) {
      this._setDashboardBrightness(1);
      return;
    }
    this._setDashboardBrightness(SS.brightness(this.hass, this.config));
  }

  _setDashboardBrightness(value) {
    const root = document.documentElement;
    if (value >= 0.999) {
      if (this._dashboardDimmed) {
        root.style.removeProperty('filter');
        root.style.removeProperty('transition');
        this._dashboardDimmed = false;
      }
      return;
    }
    this._dashboardDimmed = true;
    root.style.transition = 'filter 4s linear';
    root.style.filter = `brightness(${value})`;
  }
}

function ssController() {
  if (!window.__haScreensaverController) {
    window.__haScreensaverController = new ScreensaverController();
  }
  return window.__haScreensaverController;
}

// ---------------------------------------------------------------------
// O card
// ---------------------------------------------------------------------
class ScreensaverCard extends HTMLElement {
  setConfig(config) {
    this.config = { ...SS.defaults(), ...(config || {}) };
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this._built = false;
    this._sig = null;
    if (this._registered) {
      ssController().update(this.config, this._hass);
    }
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this.config && this.config.mode !== 'card' && this._registered) {
      ssController().update(this.config, hass);
    }
    this._render();
  }

  connectedCallback() {
    if (!this.config) return;
    this._start();
  }

  disconnectedCallback() {
    this._stop();
  }

  _start() {
    if (this.config.mode === 'card') {
      this._startCardTimer();
      return;
    }
    ssController().register(this, this.config, this._hass);
    this._registered = true;
  }

  _stop() {
    if (this._registered) {
      ssController().unregister(this);
      this._registered = false;
    }
    if (this._cardTimer) {
      clearInterval(this._cardTimer);
      this._cardTimer = null;
    }
  }

  _startCardTimer() {
    if (this._cardTimer) return;
    this._cardTimer = setInterval(() => this._render(), 1000);
  }

  _render() {
    if (!this.config || !this.shadowRoot) return;
    const config = this.config;
    const clock = SS.formatClock(config);
    const items = SS.buildItems(this._hass, config);
    const brightness = SS.brightness(this._hass, config);
    const sig = SS.signature(items, clock, brightness, config);
    if (sig === this._sig) return;
    this._sig = sig;

    if (config.mode === 'card') {
      this.shadowRoot.innerHTML = `
        <style>
          :host { display: block; height: 100%; }
          ha-card {
            height: 100%;
            min-height: 240px;
            background: ${config.background || '#000000'};
            border: none;
            box-shadow: none;
            overflow: hidden;
            display: flex;
          }
          ${SS.styles(config)}
        </style>
        <ha-card>
          <div class="ss-content" style="filter:brightness(${brightness})">
            ${SS.contentHtml(items, clock, config)}
          </div>
        </ha-card>
      `;
      return;
    }

    // modo overlay: o card no dashboard é só o painel de status/controle
    const idle = SS.num(config.idle_seconds, 120);
    const night = SS.isNight(this._hass, config);
    const sensors = SS.resolveSensors(this._hass, config);
    const missing = ['temperature', 'humidity', 'pressure'].filter((k) => !sensors[k]);

    this.shadowRoot.innerHTML = `
      <style>
        ha-card { padding: 16px; }
        .head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 10px;
        }
        .name { font-size: 1.05em; font-weight: 500; }
        .badge {
          font-size: 0.72em;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          padding: 2px 8px;
          border-radius: 10px;
          background: ${night ? 'rgba(120,140,255,0.18)' : 'rgba(255,193,7,0.18)'};
          color: var(--secondary-text-color, #888);
        }
        .preview {
          background: ${config.background || '#000'};
          border-radius: 10px;
          padding: 18px 10px;
          overflow: hidden;
        }
        .preview .ss-clock { font-size: 2.6rem; }
        .preview .ss-date { font-size: 0.8rem; }
        .preview .ss-sensors { gap: 22px; margin-top: 14px; }
        .preview .ss-value { font-size: 1.1rem; }
        .preview .ss-label { font-size: 0.6rem; }
        .info {
          margin-top: 10px;
          font-size: 0.82em;
          color: var(--secondary-text-color, #888);
          line-height: 1.45;
        }
        .warn { color: var(--warning-color, #ffa726); }
        button {
          margin-top: 10px;
          padding: 7px 14px;
          border-radius: 8px;
          border: 1px solid var(--divider-color, #ccc);
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color, #000);
          font-size: 0.86em;
          cursor: pointer;
        }
        ${SS.styles(config)}
      </style>
      <ha-card>
        <div class="head">
          <div class="name">Protetor de tela</div>
          <div class="badge">${night ? 'noite' : 'dia'} · ${Math.round(brightness * 100)}%</div>
        </div>
        <div class="preview">
          <div class="ss-content" style="filter:brightness(${brightness})">
            ${SS.contentHtml(items, clock, config)}
          </div>
        </div>
        <div class="info">
          Ativa após <b>${idle}s</b> sem interação neste navegador.
          ${missing.length ? `<div class="warn">Sensores não encontrados: ${missing.join(', ')} — defina as entidades no editor.</div>` : ''}
        </div>
        <button id="test">Testar agora</button>
      </ha-card>
    `;

    const btn = this.shadowRoot.getElementById('test');
    if (btn) {
      btn.addEventListener('click', () => {
        const c = ssController();
        c.register(this, this.config, this._hass);
        this._registered = true;
        c.activate();
      });
    }
  }

  getCardSize() {
    return this.config && this.config.mode === 'card' ? 10 : 5;
  }

  static getConfigElement() {
    return document.createElement('screensaver-card-editor');
  }

  static getStubConfig() {
    return SS.defaults();
  }
}

customElements.define('screensaver-card', ScreensaverCard);

// ---------------------------------------------------------------------
// Editor visual
// ---------------------------------------------------------------------
class ScreensaverCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...SS.defaults(), ...(config || {}) };
    if (!this._built) {
      this._render();
      this._built = true;
    } else {
      this._sync();
    }
  }

  set hass(hass) {
    this._hass = hass;
    (this._pickers || []).forEach((p) => { p.hass = hass; });
  }

  _sync() {
    if (!this.shadowRoot) return;
    const active = this.shadowRoot.activeElement;
    ['idle_seconds', 'entity_prefix', 'locale', 'background', 'text_color', 'accent_color',
     'day_brightness', 'night_brightness', 'night_start', 'night_end', 'fade_ms']
      .forEach((id) => {
        const el = this.shadowRoot.getElementById(id);
        if (!el || el === active) return;
        if (String(el.value) !== String(this._config[id])) el.value = this._config[id];
      });
    ['show_date', 'show_seconds', 'clock_24h', 'night_dim', 'use_sun', 'dim_dashboard',
     'burn_in_protection', 'disable_on_mobile'].forEach((id) => {
      const el = this.shadowRoot.getElementById(id);
      if (el && el !== active) el.checked = !!this._config[id];
    });
    const mode = this.shadowRoot.getElementById('mode');
    if (mode && mode !== active) mode.value = this._config.mode;
  }

  _render() {
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    const c = this._config;

    this.shadowRoot.innerHTML = `
      <style>
        .row { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
        .field { display: flex; flex-direction: column; flex: 1; min-width: 140px; }
        label { font-size: 0.85em; color: var(--secondary-text-color, #666); margin-bottom: 4px; }
        input[type="text"], input[type="number"], select {
          padding: 8px; border-radius: 6px;
          border: 1px solid var(--divider-color, #ccc);
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color, #000);
          font-size: 0.95em;
        }
        input[type="color"] {
          width: 100%; height: 36px; padding: 2px;
          border: 1px solid var(--divider-color, #ccc); border-radius: 6px;
        }
        .checkbox-row { display: flex; align-items: center; gap: 8px; min-width: 170px; }
        fieldset {
          border: 1px solid var(--divider-color, #ccc); border-radius: 8px;
          margin-bottom: 12px; padding: 10px 12px 4px;
        }
        legend { font-size: 0.85em; font-weight: 600; color: var(--secondary-text-color, #666); padding: 0 4px; }
        small { color: var(--secondary-text-color, #888); }
      </style>

      <div style="padding:8px 0">
        <fieldset>
          <legend>Comportamento</legend>
          <div class="row">
            <div class="field">
              <label for="mode">Modo</label>
              <select id="mode">
                <option value="overlay">Overlay (cobre o HA quando inativo)</option>
                <option value="card">Card / view em painel</option>
              </select>
            </div>
            <div class="field">
              <label for="idle_seconds">Inatividade para ativar (s)</label>
              <input type="number" min="0" step="5" id="idle_seconds" value="${c.idle_seconds}" />
            </div>
            <div class="field">
              <label for="fade_ms">Duração do fade (ms)</label>
              <input type="number" min="0" step="100" id="fade_ms" value="${c.fade_ms}" />
            </div>
          </div>
          <div class="row">
            <div class="checkbox-row">
              <input type="checkbox" id="burn_in_protection" ${c.burn_in_protection ? 'checked' : ''} />
              <label for="burn_in_protection" style="margin:0">Proteção anti burn-in</label>
            </div>
            <div class="checkbox-row">
              <input type="checkbox" id="disable_on_mobile" ${c.disable_on_mobile ? 'checked' : ''} />
              <label for="disable_on_mobile" style="margin:0">Não ativar em telas pequenas</label>
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend>Sensores (ESPHome)</legend>
          <div class="row">
            <div class="field"><label>Temperatura</label><div id="slot_temperature_entity"></div></div>
            <div class="field"><label>Umidade</label><div id="slot_humidity_entity"></div></div>
            <div class="field"><label>Pressão atmosférica</label><div id="slot_pressure_entity"></div></div>
          </div>
          <div class="row">
            <div class="field">
              <label for="entity_prefix">Prefixo para autodescoberta</label>
              <input type="text" id="entity_prefix" value="${c.entity_prefix || ''}" />
              <small>Se os campos acima ficarem vazios, o card procura sensores cujo ID contenha esse prefixo (ex.: <code>utilidades</code>).</small>
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend>Relógio</legend>
          <div class="row">
            <div class="checkbox-row">
              <input type="checkbox" id="clock_24h" ${c.clock_24h ? 'checked' : ''} />
              <label for="clock_24h" style="margin:0">Formato 24h</label>
            </div>
            <div class="checkbox-row">
              <input type="checkbox" id="show_seconds" ${c.show_seconds ? 'checked' : ''} />
              <label for="show_seconds" style="margin:0">Mostrar segundos</label>
            </div>
            <div class="checkbox-row">
              <input type="checkbox" id="show_date" ${c.show_date ? 'checked' : ''} />
              <label for="show_date" style="margin:0">Mostrar data</label>
            </div>
            <div class="field">
              <label for="locale">Locale</label>
              <input type="text" id="locale" value="${c.locale}" />
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend>Escurecer à noite</legend>
          <div class="row">
            <div class="checkbox-row">
              <input type="checkbox" id="night_dim" ${c.night_dim ? 'checked' : ''} />
              <label for="night_dim" style="margin:0">Ativar</label>
            </div>
            <div class="checkbox-row">
              <input type="checkbox" id="use_sun" ${c.use_sun ? 'checked' : ''} />
              <label for="use_sun" style="margin:0">Usar sun.sun</label>
            </div>
            <div class="checkbox-row">
              <input type="checkbox" id="dim_dashboard" ${c.dim_dashboard ? 'checked' : ''} />
              <label for="dim_dashboard" style="margin:0">Escurecer o dashboard também</label>
            </div>
          </div>
          <div class="row">
            <div class="field">
              <label for="day_brightness">Brilho de dia (0.05-1)</label>
              <input type="number" step="0.05" min="0.05" max="1" id="day_brightness" value="${c.day_brightness}" />
            </div>
            <div class="field">
              <label for="night_brightness">Brilho de noite (0.05-1)</label>
              <input type="number" step="0.05" min="0.05" max="1" id="night_brightness" value="${c.night_brightness}" />
            </div>
            <div class="field">
              <label for="night_start">Início da noite</label>
              <input type="text" id="night_start" value="${c.night_start}" placeholder="22:00" />
            </div>
            <div class="field">
              <label for="night_end">Fim da noite</label>
              <input type="text" id="night_end" value="${c.night_end}" placeholder="06:30" />
            </div>
          </div>
          <small>Com <b>sun.sun</b> marcado, os horários são ignorados e o card usa o nascer/pôr do sol.</small>
        </fieldset>

        <fieldset>
          <legend>Cores</legend>
          <div class="row">
            <div class="field"><label for="background">Fundo</label><input type="color" id="background" value="${c.background}" /></div>
            <div class="field"><label for="text_color">Relógio</label><input type="color" id="text_color" value="${c.text_color}" /></div>
            <div class="field"><label for="accent_color">Sensores</label><input type="color" id="accent_color" value="${c.accent_color}" /></div>
          </div>
        </fieldset>
      </div>
    `;

    const numeric = ['idle_seconds', 'fade_ms', 'day_brightness', 'night_brightness'];
    ['idle_seconds', 'fade_ms', 'entity_prefix', 'locale', 'background', 'text_color',
     'accent_color', 'day_brightness', 'night_brightness', 'night_start', 'night_end']
      .forEach((id) => {
        const el = this.shadowRoot.getElementById(id);
        const handler = () => {
          const raw = el.value;
          const value = numeric.includes(id) ? (raw === '' ? undefined : Number(raw)) : raw;
          this._config = { ...this._config, [id]: value };
          this._fire();
        };
        el.addEventListener('change', handler);
        el.addEventListener('input', handler);
      });

    ['show_date', 'show_seconds', 'clock_24h', 'night_dim', 'use_sun', 'dim_dashboard',
     'burn_in_protection', 'disable_on_mobile'].forEach((id) => {
      const el = this.shadowRoot.getElementById(id);
      el.addEventListener('change', () => {
        this._config = { ...this._config, [id]: el.checked };
        this._fire();
      });
    });

    const mode = this.shadowRoot.getElementById('mode');
    mode.value = this._config.mode;
    mode.addEventListener('change', () => {
      this._config = { ...this._config, mode: mode.value };
      this._fire();
    });

    this._pickers = [];
    ['temperature_entity', 'humidity_entity', 'pressure_entity']
      .forEach((key) => this._mountPicker(key));
  }

  _mountPicker(key) {
    const slot = this.shadowRoot.getElementById(`slot_${key}`);
    if (!slot) return;
    if (customElements.get('ha-entity-picker')) {
      const picker = document.createElement('ha-entity-picker');
      picker.hass = this._hass;
      picker.value = this._config[key] || '';
      picker.style.display = 'block';
      picker.includeDomains = ['sensor'];
      picker.addEventListener('value-changed', (ev) => {
        this._config = { ...this._config, [key]: ev.detail.value };
        this._fire();
      });
      slot.innerHTML = '';
      slot.appendChild(picker);
      this._pickers.push(picker);
    } else {
      slot.innerHTML = `<input type="text" placeholder="sensor.${key}" value="${this._config[key] || ''}" />`;
      const el = slot.querySelector('input');
      el.addEventListener('change', () => {
        this._config = { ...this._config, [key]: el.value };
        this._fire();
      });
    }
  }

  _fire() {
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: this._config },
      bubbles: true,
      composed: true,
    }));
  }
}

customElements.define('screensaver-card-editor', ScreensaverCardEditor);

// Exposto para o preview local (docs/preview.html) e para depuração no console.
window.ScreensaverCardHelpers = SS;

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'screensaver-card',
  name: 'Protetor de Tela',
  description: 'Protetor de tela para painéis: fundo escuro, relógio e sensores (temperatura, umidade, pressão), com escurecimento noturno.',
  preview: true,
});
})();
