(() => {
  'use strict';

  /**
   * Popup: previews each caption style, edits the settings, and
   * says whether the active tab is a YouTube or HackerTube video (or asks for
   * site access when it is missing). Settings are written to storage;
   * settings-bridge.js applies them to open video tabs.
   */
  const { Settings } = globalThis.YTSC;
  const {
    DEFAULTS, STYLES, SIZES, SIZE_LABELS, WINDOWS, windowLabel, sizeMigration, highlightSetting,
    TIKTOK_COLORS, TIKTOK_COLOR_LABELS, isSafari,
  } = Settings;
  const api = globalThis.browser ?? globalThis.chrome;
  const store = api.storage.sync ?? api.storage.local; // Safari may lack sync
  // Short's pink highlight is Safari's (the paid build); elsewhere it stays yellow.
  const safari = isSafari(api);

  const state = { ...DEFAULTS };
  const $ = (id) => document.getElementById(id);

  // ---------- Style previews ----------

  const FROSTED_LEVELS = { clear: [0.12, 10], light: [0.25, 14], medium: [0.38, 16], dark: [0.55, 18], solid: [0.78, 20] };
  const BOX_ALPHA = { off: 0, 25: 0.25, 50: 0.5, 75: 0.75, 100: 1 }; // Short's and Boring's background

  // A still caption per style: the look, without words changing under the eye.
  // The second word is marked, as the word being spoken.
  const SAMPLE = ['learn', 'something', 'new'];

  class Preview {
    constructor(el) {
      this.el = el;
      this.style = el.dataset.preview;
      const cap = document.createElement('div');
      cap.className = `cap ${this.style}`;
      SAMPLE.forEach((text, i) => {
        if (i) cap.append(' ');
        const span = document.createElement('span');
        span.className = i === 1 ? 'w cur' : 'w';
        span.textContent = text;
        cap.append(span);
      });
      el.appendChild(cap);
    }

    apply() {
      const [alpha, blur] = FROSTED_LEVELS[state.frostedWindow] || FROSTED_LEVELS.medium;
      this.el.style.setProperty('--pv-alpha', alpha);
      this.el.style.setProperty('--pv-blur', `${blur}px`);
      const shortAlpha = BOX_ALPHA[state.tiktokWindow] ?? 0;
      this.el.style.setProperty('--pv-tt-alpha', shortAlpha);
      this.el.style.setProperty('--pv-tt-pad', shortAlpha ? '.12em .45em' : '0');
      this.el.style.setProperty('--pv-boring-alpha', BOX_ALPHA[state.boringWindow] ?? 0.75);
      this.el.classList.toggle('plain', !state[highlightSetting(this.style)]);
    }
  }
  const previews = [...document.querySelectorAll('[data-preview]')].map((el) => new Preview(el));

  // Only the dots: <body> carries data-tiktok-color too (see render).
  const swatches = [...$('tiktok-color').querySelectorAll('.swatch')];
  for (const b of swatches) {
    b.title = TIKTOK_COLOR_LABELS[b.dataset.tiktokColor];
    b.setAttribute('aria-label', b.title);
  }
  const levels = [...$('clean-level').querySelectorAll('.level')];

  // ---------- Rendering ----------

  const dots = $('size-dots');
  SIZES.forEach((_, i) => {
    const bar = document.createElement('span');
    bar.style.height = `${4 + i * 2}px`; // a rising scale: one bar per size
    dots.appendChild(bar);
  });

  let windowListFor = null;
  function renderWindowList() {
    const w = WINDOWS[state.style];
    $('window-title').textContent = w.label;
    if (windowListFor === state.style) return;
    windowListFor = state.style;
    const list = $('window-list');
    list.textContent = '';
    for (const level of w.levels) {
      const b = document.createElement('button');
      b.dataset.window = level;
      const label = document.createElement('span');
      label.className = 'lift'; // hover lifts the label (popup.css)
      label.textContent = windowLabel(level);
      b.appendChild(label);
      list.appendChild(b);
    }
  }

  function render() {
    renderWindowList();
    const sizeIndex = SIZES.indexOf(state.size);
    const level = state[WINDOWS[state.style].key];

    for (const card of document.querySelectorAll('[data-style]')) {
      const sel = card.dataset.style === state.style;
      card.classList.toggle('sel', sel);
      card.setAttribute('aria-pressed', String(sel));
    }
    [...dots.children].forEach((d, i) => {
      d.classList.toggle('lit', i <= sizeIndex);
      d.classList.toggle('here', i === sizeIndex);
    });
    $('size-label').textContent = SIZE_LABELS[state.size];

    for (const b of document.querySelectorAll('[data-window]')) {
      const sel = b.dataset.window === level;
      b.classList.toggle('sel', sel);
      b.setAttribute('aria-pressed', String(sel));
    }

    // Switched off, the style and settings stay as they are but can't be changed.
    for (const el of document.querySelectorAll('[data-needs-on]')) el.inert = !state.enabled;
    document.body.classList.toggle('switched-off', !state.enabled);
    paintStatus();

    const highlight = state[highlightSetting(state.style)];
    $('highlight').setAttribute('aria-checked', String(highlight));
    $('highlight-hint').textContent = highlight ? 'Mark the spoken word' : 'Show each caption plainly';
    $('clean').setAttribute('aria-checked', String(state.clean));
    $('clean-hint').textContent = state.clean && state.cleanStrict
      ? 'No um, no [Applause]' : 'No um, uh or “I I I”';
    $('clean-level').hidden = !state.clean;
    const cleanLevel = state.cleanStrict ? 'strict' : 'light';
    for (const b of levels) {
      const picked = b.dataset.cleanLevel === cleanLevel;
      b.setAttribute('aria-checked', String(picked));
      b.tabIndex = picked ? 0 : -1;
    }

    // Short's colour: the previews and the TV's hopping word follow it (popup.css).
    const tiktokColor = safari && TIKTOK_COLORS.includes(state.tiktokColor) ? state.tiktokColor : 'yellow';
    document.body.dataset.tiktokColor = tiktokColor;
    $('tiktok-color').hidden = !(safari && state.style === 'tiktok' && highlight);
    for (const b of swatches) {
      const picked = b.dataset.tiktokColor === tiktokColor;
      b.setAttribute('aria-checked', String(picked));
      b.tabIndex = picked ? 0 : -1; // a radio group is one Tab stop: the picked dot
    }

    previews.forEach((p) => p.apply());
  }

  function update(patch, { persist = true } = {}) {
    Object.assign(state, patch);
    render();
    if (persist) store.set(patch).catch(() => {});
  }

  const stepSize = (delta) => {
    const i = Math.min(SIZES.length - 1, Math.max(0, SIZES.indexOf(state.size) + delta));
    update({ size: SIZES[i] });
  };
  const toggleHighlight = () => {
    const key = highlightSetting(state.style);
    update({ [key]: !state[key] });
  };
  const cycleWindow = () => {
    const w = WINDOWS[state.style];
    update({ [w.key]: w.levels[(w.levels.indexOf(state[w.key]) + 1) % w.levels.length] });
  };

  // ---------- Input ----------

  document.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.style) update({ style: t.dataset.style });
    else if (t.dataset.sizeStep) stepSize(Number(t.dataset.sizeStep));
    else if (t.dataset.window) update({ [WINDOWS[state.style].key]: t.dataset.window });
    else if (t.dataset.tiktokColor) update({ tiktokColor: t.dataset.tiktokColor });
    else if (t.dataset.cleanLevel) update({ cleanStrict: t.dataset.cleanLevel === 'strict' });
    else if (t.id === 'highlight') toggleHighlight();
    else if (t.id === 'clean') update({ clean: !state.clean });
    else if (t.id === 'status') {
      $('status').classList.add('switching'); // plays the set turning off or on (popup.css)
      update({ enabled: !state.enabled });
    }
  });

  // A radio group: the arrow keys move the pick (and focus) to the next option, wrapping.
  const ARROWS = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  const radioKeys = (group, options, patchFor) => group.addEventListener('keydown', (e) => {
    const step = ARROWS[e.key];
    const i = options.indexOf(e.target);
    if (!step || i < 0) return;
    e.preventDefault();
    const next = options[(i + step + options.length) % options.length];
    update(patchFor(next));
    next.focus();
  });
  radioKeys($('tiktok-color'), swatches, (b) => ({ tiktokColor: b.dataset.tiktokColor }));
  radioKeys($('clean-level'), levels, (b) => ({ cleanStrict: b.dataset.cleanLevel === 'strict' }));

  $('status').addEventListener('animationend', (e) => {
    if (e.animationName === 'crt-on' || e.animationName === 'crt-off') $('status').classList.remove('switching');
  });

  // The title opens the home page in a new tab (tabs.create needs no permission),
  // and the popup closes, as it does for a link in Chrome.
  $('home').addEventListener('click', (e) => {
    e.preventDefault();
    const { href } = e.currentTarget; // currentTarget is null once the click is handled
    Promise.resolve(api.tabs.create({ url: href }))
      .then(() => window.close(), () => window.open(href, '_blank'));
  });

  // The same keys as on the video (minus `c`, which belongs to the player).
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.repeat || !state.enabled) return;
    if (e.altKey && !e.shiftKey && e.code === 'KeyC') {
      e.preventDefault();
      update({ style: STYLES[(STYLES.indexOf(state.style) + 1) % STYLES.length] });
    } else if (e.altKey) {
      return;
    } else if (e.key === '=' || e.key === '+') stepSize(1);
    else if (e.key === '-') stepSize(-1);
    else if (e.key === 'w') cycleWindow();
    else if (e.key === 'h') toggleHighlight();
    else if (e.key === 'C' && e.shiftKey) update({ clean: !state.clean });
  });

  // The learned caption language lives in local storage, separate from synced settings.
  const LANGUAGE_HISTORY = 'captionLanguageHistory';
  const languageHint = document.querySelector('[data-language-hint]');
  const applyLanguageHint = (history) => {
    if (!languageHint) return;
    const learned = globalThis.YTSC.CaptionLanguagePreference?.preferred(history);
    languageHint.title = learned
      ? `Preferred language: ${learned}. A language you pick in YouTube's subtitles menu replaces it.`
      : "Starts with your browser language. A language you pick in YouTube's subtitles menu replaces it.";
  };
  api.storage.local?.get({ [LANGUAGE_HISTORY]: [] })
    .then((raw) => applyLanguageHint(raw?.[LANGUAGE_HISTORY]))
    .catch(() => {});

  // Keep in step with shortcut changes made on the video while the popup is open.
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' && area !== 'local') return;
    if (area === 'local' && changes[LANGUAGE_HISTORY]) applyLanguageHint(changes[LANGUAGE_HISTORY].newValue);
    const patch = {};
    for (const key of Object.keys(DEFAULTS)) if (changes[key]) patch[key] = changes[key].newValue ?? DEFAULTS[key];
    if (Object.keys(patch).length) update(patch, { persist: false });
  });

  // ---------- Video-site status ----------
  // Host permissions are enough to see supported tabs' URLs; no `tabs` permission needed.

  // Firefox lets the user withhold or revoke host access (MV3 host permissions
  // are opt-in there); without it no content script runs, so offer to grant it.
  const VIDEO_SITES = {
    origins: [
      'https://www.youtube.com/*',
      'https://www.youtube-nocookie.com/*',
      'https://hackertube.org/*',
    ],
  };

  // The little TV in the header is the power switch. Switched on, it shows the
  // active tab: lit with a caption on a video, warm on other supported pages, dark
  // elsewhere. Switched off, its screen is off and its knob unlit.
  // [look, text] for the active tab, once showStatus() knows it.
  let pageStatus = null;
  function paintStatus() {
    const status = $('status');
    status.setAttribute('aria-checked', String(state.enabled));
    status.title = state.enabled ? 'Switch Stable Captions off' : 'Switch Stable Captions on';
    if (!state.enabled) {
      status.dataset.state = 'off';
      $('status-text').textContent = 'switched off';
    } else if (pageStatus) { // else still looking, or asking for site access
      [status.dataset.state, $('status-text').textContent] = pageStatus;
    }
  }

  async function hasAccess(sites = VIDEO_SITES) {
    try {
      return await api.permissions.contains(sites);
    } catch {
      return true; // no permissions API: assume the install granted it
    }
  }

  $('grant').addEventListener('click', async () => {
    let granted = false;
    try {
      granted = await api.permissions.request(VIDEO_SITES); // needs this click as the user gesture
    } catch { /* request refused */ }
    if (!granted) return;
    $('grant').hidden = true;
    pageStatus = ['standby', 'reload page'];
    paintStatus();
  });

  async function showStatus() {
    let url = '';
    try {
      const [tab] = await api.tabs.query({ active: true, currentWindow: true });
      url = tab?.url || '';
    } catch { /* no tab info: treat as an unsupported page */ }
    const host = /^https:\/\/(www\.youtube\.com|www\.youtube-nocookie\.com|hackertube\.org)\//.exec(url)?.[1];
    // Access to an unrelated video site is not required for this page to work.
    // HackerTube also needs access to its youtube-nocookie caption iframe.
    const origins = host ? [`https://${host}/*`] : VIDEO_SITES.origins;
    if (host === 'hackertube.org') origins.push('https://www.youtube-nocookie.com/*');
    if (!(await hasAccess({ origins }))) {
      $('grant').hidden = false;
      pageStatus = ['idle', 'needs access'];
      paintStatus();
      return;
    }
    const onYouTube = host === 'www.youtube.com' || host === 'www.youtube-nocookie.com';
    const onHackerTube = host === 'hackertube.org';
    const onVideo = /^https:\/\/www\.youtube\.com\/watch\b/.test(url)
      || /^https:\/\/www\.youtube-nocookie\.com\/embed\/[^/?#]+/.test(url)
      || /^https:\/\/hackertube\.org\/watch\/[^/?#]+/.test(url);
    pageStatus = onVideo ? ['on', 'on the tube']
      : onYouTube || onHackerTube ? ['standby', 'pick a video']
        : ['idle', 'no video here'];
    paintStatus();
  }

  // ---------- Start ----------

  render();
  // A size saved on the old ladder is moved first (see Settings.sizeMigration).
  store.get(['size', 'sizeLadder'])
    .then((raw) => { const patch = sizeMigration(raw); return patch && store.set(patch); })
    .catch(() => {})
    .then(() => store.get(DEFAULTS))
    .then((saved) => update(saved, { persist: false }), () => {});
  showStatus();
})();
