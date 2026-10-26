/* global podium */
'use strict';

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  kids.forEach(k => e.append(k));
  return e;
};
const fmt = secs => {
  secs = Math.max(0, Math.round(secs));
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
};

let info = null;          // app info from main
let deck = null;          // current deck info
let selectedDisplay = null;

// ====================== Home ======================

function renderDeck() {
  $('deck').hidden = !deck;
  $('drop').hidden = !!deck;
  if (!deck) return;
  $('deck-name').textContent = deck.name;
  $('deck-path').textContent = deck.deckPath;
  const nf = $('notes-file');
  nf.replaceChildren();
  if (deck.notesError) {
    nf.append(el('span', { className: 'warn', textContent: deck.notesError }));
  } else if (deck.notesPath) {
    nf.append(
      el('span', { className: 'ok', textContent: '✓ ' }),
      el('span', { textContent: deck.notesPath.split(/[\\/]/).pop() }),
      el('span', { className: 'muted', textContent: ` · ${deck.notesCount} slide${deck.notesCount === 1 ? '' : 's'} of notes` }),
    );
  } else {
    nf.append(el('span', { className: 'muted', textContent: 'No .md file. Notes written inside the deck (e.g. <aside class="notes">) are used if present.' }));
  }
  $('clear-notes').hidden = !deck.notesPath;
}

function renderDisplays() {
  const list = info.displays;
  const box = $('displays');
  box.replaceChildren();
  const others = list.filter(d => !d.hasPresenter);
  if (!others.some(d => d.id === selectedDisplay)) selectedDisplay = others[0] ? others[0].id : null;
  for (const d of list) {
    const b = el('button', { className: 'display' + (d.id === selectedDisplay ? ' selected' : ''), disabled: d.hasPresenter },
      el('b', { textContent: d.label }),
      el('span', { textContent: `${d.width} × ${d.height}${d.hasPresenter ? ' · presenter view' : ''}` }));
    b.onclick = () => { selectedDisplay = d.id; renderDisplays(); };
    box.append(b);
  }
  $('display-hint').textContent = others.length
    ? 'The slides go full screen on the selected screen. Your notes stay on this one.'
    : 'Only one screen found. Connect a projector or second screen, or rehearse in a window.';
  $('start').textContent = others.length ? 'Start presenting' : 'Start (in a window)';
}

function renderRecent() {
  const list = (info.recent || []).filter(p => !deck || p !== deck.deckPath);
  $('recent-wrap').hidden = !list.length;
  $('recent').replaceChildren(...list.map(p => {
    const parts = p.split(/[\\/]/);
    const b = el('button', {}, el('span', { textContent: parts.slice(-2).join(' / ') }), el('small', { textContent: p }));
    b.onclick = () => load(() => podium.loadDeck(p));
    return el('li', {}, b);
  }));
}

async function load(fn) {
  try {
    const d = await fn();
    if (d) { deck = d; info = await podium.info(); renderDeck(); renderRecent(); }
  } catch (e) {
    alert(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  }
}

$('open').onclick = () => load(podium.pickDeck);
$('change-deck').onclick = () => load(podium.pickDeck);
$('pick-notes').onclick = () => load(podium.pickNotes);
$('clear-notes').onclick = () => load(podium.clearNotes);
$('start').onclick = () => startShow(false);
$('rehearse').onclick = () => startShow(true);

const drop = $('drop');
for (const t of [document.body]) {
  t.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  t.addEventListener('dragleave', e => { if (!e.relatedTarget) drop.classList.remove('over'); });
  t.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('over');
    if (!$('present').hidden) return;
    const f = e.dataTransfer.files[0];
    if (!f) return;
    const p = podium.pathForFile(f);
    if (/\.(md|markdown)$/i.test(p) && deck) return; // notes are chosen with the button, keep drops simple
    load(() => podium.loadDeck(p));
  });
}

podium.onDeckLoaded(d => { deck = d; podium.info().then(i => { info = i; renderDeck(); renderRecent(); renderDisplays(); }); });
podium.onDeckChanged(d => { deck = d; renderDeck(); });
podium.onDisplays(list => { info.displays = list; renderDisplays(); });

// ====================== Previews ======================

// A <webview> that shows the deck at the audience's resolution, scaled down to fit its frame,
// so the preview looks exactly like the room's screen whatever the deck's layout.
class Preview {
  constructor(webview, frame, { freeze }) {
    this.wv = webview;
    this.frame = frame;
    this.freeze = freeze;
    this.ready = false;
    this.want = null;
    this.size = { width: 1920, height: 1080 };
    webview.addEventListener('dom-ready', () => this.onReady());
    new ResizeObserver(() => this.fit()).observe(frame);
  }
  async onReady() {
    if (this.wv.getURL() === 'about:blank') return;
    this.wv.setAudioMuted(true);
    await this.wv.executeJavaScript(adapterSrc);
    if (this.freeze) await this.wv.executeJavaScript('window.__podium.freezeMedia()');
    this.ready = true;
    this.apply();
  }
  load(url) { this.ready = false; this.wv.src = url; }
  unload() { this.ready = false; this.want = null; this.wv.src = 'about:blank'; }
  setSize(size) { this.size = size; this.fit(); }
  fit() {
    const { width, height } = this.size;
    this.wv.style.width = width + 'px';
    this.wv.style.height = height + 'px';
    this.wv.style.transform = `scale(${this.frame.clientWidth / width})`;
  }
  goTo(index, sub = -1) { this.want = { index, sub }; this.apply(); }
  async apply() {
    if (!this.ready || !this.want) return;
    const { index, sub } = this.want;
    try { await this.wv.executeJavaScript(`window.__podium && window.__podium.goTo(${index}, ${sub})`); } catch { /* reloading */ }
  }
}

let adapterSrc = '';
const cur = new Preview($('cur'), $('cur-frame'), { freeze: false });
const nxt = new Preview($('nextv'), $('next-frame'), { freeze: true });

// ====================== Presenter view ======================

const S = {
  active: false,
  index: 0,
  count: 0,
  sub: -1,
  outline: [],
  notes: { byIndex: {}, source: 'deck' },
  blank: null,
  timer: { acc: 0, since: null },
  slideStartedAt: 0,
  jump: '',
  fontSize: 22,
};

const elapsed = () => S.timer.acc + (S.timer.since ? (Date.now() - S.timer.since) / 1000 : 0);

async function startShow(rehearsal) {
  if (!deck) return;
  adapterSrc = adapterSrc || await podium.adapterSource();
  Object.assign(S, { active: true, index: 0, count: 0, sub: -1, outline: [], blank: null, jump: '' });
  S.timer = { acc: 0, since: Date.now() };
  S.slideStartedAt = 0;
  $('home').hidden = true;
  $('present').hidden = false;
  renderBlank();
  const r = await podium.start({ audienceDisplayId: selectedDisplay, forceRehearsal: rehearsal });
  $('mode').hidden = !r.rehearsal;
  $('btn-swap').hidden = r.rehearsal;
  cur.load(deck.deckUrl);
  nxt.load(deck.deckUrl);
  S.notes = await podium.notes();
  render();
}

async function endShow(fromMain) {
  if (!S.active) return;
  S.active = false;
  $('grid').hidden = true;
  cur.unload();
  nxt.unload();
  if (!fromMain) await podium.stop();
  $('present').hidden = true;
  $('home').hidden = false;
  info = await podium.info();
  renderDisplays();
}

podium.onShowInfo(si => {
  const { width, height } = si.audienceSize;
  document.documentElement.style.setProperty('--ar', (width / height).toFixed(4));
  cur.setSize(si.audienceSize);
  nxt.setSize(si.audienceSize);
  $('mode').hidden = !si.rehearsal;
  $('btn-swap').hidden = si.rehearsal;
});

podium.onState(st => {
  if (!S.active) return;
  if (st.index !== S.index) S.slideStartedAt = elapsed();
  Object.assign(S, { index: st.index, count: st.count, sub: st.sub });
  cur.goTo(st.index, st.sub);
  if (st.index + 1 < st.count) nxt.goTo(st.index + 1, -1);
  render();
});
podium.onOutline(o => { S.outline = o; renderGrid(); render(); });
podium.onNotes(n => { S.notes = n; render(); renderGrid(); });
podium.onBlank(mode => { S.blank = mode; renderBlank(); });
podium.onEnded(() => endShow(true));

function titleFor(i) {
  const n = S.notes.byIndex[i];
  return (n && n.title) || (S.outline[i] && S.outline[i].title) || `Slide ${i + 1}`;
}

function render() {
  $('counter').textContent = S.count ? `${S.index + 1} / ${S.count}` : '– / –';
  $('cur-title').textContent = S.count ? titleFor(S.index) : '';
  const last = S.count && S.index >= S.count - 1;
  $('end-card').hidden = !last;
  $('next-title').textContent = !S.count ? '' : last ? '' : titleFor(S.index + 1);
  $('notes-source').textContent = S.notes.source === 'file' ? 'from .md file' : 'from the deck';

  const n = S.notes.byIndex[S.index];
  const box = $('notes');
  if (n && n.html) {
    box.innerHTML = n.html;
  } else {
    box.replaceChildren(el('p', { className: 'empty', textContent: 'No notes for this slide.' }));
  }
  box.scrollTop = 0;
  renderGridCurrent();
  tick();
}

function renderBlank() {
  const b = $('blank-badge');
  b.hidden = !S.blank;
  b.className = 'blank-badge' + (S.blank === 'white' ? ' white' : '');
  b.textContent = S.blank === 'white' ? 'Audience sees a white screen' : 'Audience sees a black screen';
  $('btn-black').classList.toggle('active', S.blank === 'black');
  $('btn-white').classList.toggle('active', S.blank === 'white');
}

// ---------- timer, clock and pace ----------

function tick() {
  if (!S.active) return;
  const e = elapsed();
  const el2 = $('elapsed');
  el2.textContent = fmt(e);
  el2.classList.toggle('paused', !S.timer.since);
  $('timer-toggle').textContent = S.timer.since ? '❚❚' : '▶';
  const now = new Date();
  $('clock').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const n = S.notes.byIndex[S.index];
  const onSlide = e - S.slideStartedAt;
  $('slide-time').textContent = 'On this slide ' + fmt(onSlide) + (n && n.duration ? ` · planned ${fmt(n.duration)}` : '');

  const pace = $('pace');
  if (n && n.endsAt != null) {
    const start = n.endsAt - (n.duration || 0);
    const slack = 15;
    let cls, text;
    if (e < start - slack) { cls = 'ahead'; text = `${fmt(start - e)} ahead`; }
    else if (e > n.endsAt + slack) { const over = e - n.endsAt; cls = over > 120 ? 'late' : 'behind'; text = `${fmt(over)} behind`; }
    else { cls = 'ontime'; text = 'On time'; }
    pace.hidden = false;
    pace.className = 'pace ' + cls;
    pace.textContent = text;
    pace.title = `Plan for this slide: ${fmt(start)} – ${fmt(n.endsAt)}`;
  } else {
    pace.hidden = true;
  }
}
setInterval(tick, 500);

function toggleTimer() {
  if (S.timer.since) { S.timer.acc = elapsed(); S.timer.since = null; } else S.timer.since = Date.now();
  tick();
}
$('timer-toggle').onclick = toggleTimer;
$('timer-reset').onclick = () => { S.timer = { acc: 0, since: S.timer.since ? Date.now() : null }; S.slideStartedAt = 0; tick(); };

// ---------- grid ----------

function renderGrid() {
  const n = S.count || S.outline.length;
  const items = [];
  for (let i = 0; i < n; i++) {
    const notes = S.notes.byIndex[i];
    const b = el('button', {},
      el('span', { className: 'num', textContent: String(i + 1) }),
      el('span', { textContent: titleFor(i) }),
      el('span', { className: 'time', textContent: notes && notes.endsAt != null ? `ends at ${fmt(notes.endsAt)}` : '' }));
    b.dataset.i = i;
    b.onclick = () => { podium.goTo(i); toggleGrid(false); };
    items.push(el('li', {}, b));
  }
  $('grid-list').replaceChildren(...items);
  renderGridCurrent();
}
function renderGridCurrent() {
  $('grid-list').querySelectorAll('button').forEach(b => b.classList.toggle('current', Number(b.dataset.i) === S.index));
}
function toggleGrid(force) {
  const g = $('grid');
  g.hidden = force === undefined ? !g.hidden : !force;
  if (!g.hidden) {
    renderGrid();
    const c = g.querySelector('button.current') || g.querySelector('button');
    if (c) { c.scrollIntoView({ block: 'center' }); c.focus(); }
  }
}

// ---------- controls ----------

const setBlank = mode => podium.blank(S.blank === mode ? null : mode);
const setFont = size => {
  S.fontSize = Math.max(12, Math.min(48, size));
  document.documentElement.style.setProperty('--notes-size', S.fontSize + 'px');
  podium.setSetting('notesFontSize', S.fontSize);
};

$('prev').onclick = () => podium.nav('prev');
$('next').onclick = () => podium.nav('next');
$('btn-grid').onclick = () => toggleGrid();
$('btn-black').onclick = () => setBlank('black');
$('btn-white').onclick = () => setBlank('white');
$('btn-swap').onclick = () => podium.swap();
$('btn-end').onclick = () => endShow(false);
$('font-up').onclick = () => setFont(S.fontSize + 2);
$('font-down').onclick = () => setFont(S.fontSize - 2);
$('grid').addEventListener('click', e => { if (e.target.id === 'grid') toggleGrid(false); });

function setJump(v) {
  S.jump = v;
  $('jump').hidden = !v;
  $('jump').textContent = v ? `Go to ${v}` : '';
}

document.addEventListener('keydown', e => {
  if (!S.active || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  const gridOpen = !$('grid').hidden;

  if (k === 'Escape') {
    e.preventDefault();
    if (gridOpen) toggleGrid(false);
    else if (S.jump) setJump('');
    else if (S.blank) podium.blank(null);
    else endShow(false);
    return;
  }
  if (gridOpen) return; // let buttons in the grid take Enter/Tab

  if (/^[0-9]$/.test(k)) { e.preventDefault(); setJump((S.jump + k).slice(0, 4)); return; }
  if (k === 'Backspace' && S.jump) { e.preventDefault(); setJump(S.jump.slice(0, -1)); return; }
  if (k === 'Enter' && S.jump) {
    e.preventDefault();
    podium.goTo(Number(S.jump) - 1);
    setJump('');
    return;
  }

  const lower = k.toLowerCase();
  const map = {
    ArrowRight: 'next', ArrowDown: 'next', PageDown: 'next', ' ': 'next', Enter: 'next', n: 'next',
    ArrowLeft: 'prev', ArrowUp: 'prev', PageUp: 'prev', Backspace: 'prev', p: 'prev',
    Home: 'first', End: 'last',
  };
  const cmd = map[k] || map[lower];
  if (cmd) { e.preventDefault(); if (!e.repeat || cmd === 'next' || cmd === 'prev') podium.nav(cmd); return; }
  if (lower === 'b' || k === '.') { e.preventDefault(); setBlank('black'); }
  else if (lower === 'w' || k === ',') { e.preventDefault(); setBlank('white'); }
  else if (lower === 'g') { e.preventDefault(); toggleGrid(); }
  else if (lower === 't') { e.preventDefault(); toggleTimer(); }
  else if (k === '+' || k === '=') { e.preventDefault(); setFont(S.fontSize + 2); }
  else if (k === '-') { e.preventDefault(); setFont(S.fontSize - 2); }
});

// Buttons should not keep focus, or Space/Enter would "click" them again instead of going to the next slide.
document.addEventListener('mouseup', () => {
  if (S.active && document.activeElement && document.activeElement.tagName === 'BUTTON' && $('grid').hidden) document.activeElement.blur();
});

// ====================== Boot ======================

(async () => {
  info = await podium.info();
  deck = info.deck;
  setFont(info.notesFontSize || 22);
  renderDeck();
  renderDisplays();
  renderRecent();
})();
