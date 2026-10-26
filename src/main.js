const { app, BrowserWindow, ipcMain, dialog, screen, Menu, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { marked } = require('marked');
const { parseNotes, mapToSlides, findNotesFor } = require('./notes');

// Decks start videos from script without a click; allow that.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const IS_MAC = process.platform === 'darwin';
const ADAPTER_SRC = fs.readFileSync(path.join(__dirname, 'adapter.js'), 'utf8');
const SMOKE = process.argv.includes('--smoke');
// Packaged builds take their icon from build/; this one is for the window icon on Windows and Linux.
const ICON = path.join(__dirname, 'ui', 'icon.png');

// ---------- settings ----------

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settings = { recent: [], notesFontSize: 22, notesByDeck: {} };
function loadSettings() {
  try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch { /* first run */ }
}
function saveSettings() {
  if (SMOKE) return;
  try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch (e) { console.error('settings', e); }
}

// ---------- state ----------

let presenter = null;   // BrowserWindow with the home screen and presenter view
let audience = null;    // BrowserWindow showing the deck to the room
let deck = null;        // { deckPath, deckUrl, name, notesPath, parsed }
let show = null;        // { audienceDisplayId, rehearsal, blank, last, outline, pollTimer }
let pendingOpen = null; // file passed on launch / open-file before the window exists

const send = (ch, payload) => { if (presenter && !presenter.isDestroyed()) presenter.webContents.send(ch, payload); };

// ---------- notes ----------

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const TIMING_LINE = /^[*_\s]*about\s+\d{1,2}:\d{2}[^\n]*?ends at\s+\d{1,2}:\d{2}[*_\s]*$/gim;

function readNotes(notesPath) {
  if (!notesPath) return null;
  try {
    const parsed = parseNotes(fs.readFileSync(notesPath, 'utf8'));
    parsed.preambleHtml = marked.parse(parsed.preamble || '');
    // The timing line is shown in the top bar, so leave it out of the notes text.
    parsed.sections.forEach(s => { s.html = marked.parse(s.body.replace(TIMING_LINE, '')); });
    return parsed;
  } catch (e) {
    console.error('notes', e);
    return null;
  }
}

// Notes per slide index, from the .md file when there is one, else from the deck's own inline notes.
function notesForSlides() {
  const outline = (show && show.outline) || [];
  if (deck && deck.parsed) {
    const map = mapToSlides(deck.parsed.sections, outline.map(o => o.id));
    const out = {};
    for (const [i, s] of Object.entries(map)) {
      out[i] = { title: s.title, html: s.html, duration: s.duration, endsAt: s.endsAt };
    }
    return { source: 'file', byIndex: out, preambleHtml: deck.parsed.preambleHtml };
  }
  const out = {};
  outline.forEach((o, i) => {
    if (o.notes) out[i] = { title: o.title, html: o.notes.split(/\n{2,}/).map(p => `<p>${escapeHtml(p)}</p>`).join('') };
  });
  return { source: 'deck', byIndex: out, preambleHtml: '' };
}

let notesWatch = null;
function watchNotes(notesPath) {
  if (notesWatch) { fs.unwatchFile(notesWatch); notesWatch = null; }
  if (!notesPath) return;
  notesWatch = notesPath;
  fs.watchFile(notesPath, { interval: 1000 }, () => {
    if (!deck || deck.notesPath !== notesPath) return;
    deck.parsed = readNotes(notesPath);
    send('deck:changed', deckInfo());
    if (show) send('notes:mapped', notesForSlides());
  });
}

// ---------- deck ----------

function deckInfo() {
  if (!deck) return null;
  return {
    deckPath: deck.deckPath,
    deckUrl: deck.deckUrl,
    name: deck.name,
    notesPath: deck.notesPath,
    notesCount: deck.parsed ? deck.parsed.sections.length : 0,
    notesError: deck.notesPath && !deck.parsed ? 'Could not read the notes file.' : null,
  };
}

function resolveDeckPath(p) {
  try {
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      const idx = ['index.html', 'index.htm'].map(f => path.join(p, f)).find(f => fs.existsSync(f));
      return idx || null;
    }
    return /\.html?$/i.test(p) ? p : null;
  } catch { return null; }
}

function loadDeck(p) {
  const deckPath = resolveDeckPath(p);
  if (!deckPath) throw new Error('Choose an .html file, or a folder with an index.html.');
  const remembered = settings.notesByDeck[deckPath];
  const notesPath = remembered === '' ? null : (remembered && fs.existsSync(remembered) ? remembered : findNotesFor(deckPath));
  deck = {
    deckPath,
    deckUrl: pathToFileURL(deckPath).href,
    name: path.basename(path.dirname(deckPath)) + ' / ' + path.basename(deckPath),
    notesPath,
    parsed: readNotes(notesPath),
  };
  settings.recent = [deckPath, ...settings.recent.filter(r => r !== deckPath)].slice(0, 8);
  saveSettings();
  watchNotes(notesPath);
  return deckInfo();
}

function setNotes(notesPath) {
  if (!deck) return null;
  deck.notesPath = notesPath;
  deck.parsed = readNotes(notesPath);
  settings.notesByDeck[deck.deckPath] = notesPath || '';
  saveSettings();
  watchNotes(notesPath);
  if (show) send('notes:mapped', notesForSlides());
  return deckInfo();
}

// ---------- displays ----------

function displayList() {
  const primary = screen.getPrimaryDisplay().id;
  const presenterDisplay = presenter ? screen.getDisplayMatching(presenter.getBounds()).id : primary;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: d.label || (d.internal ? 'Built-in display' : `Display ${i + 1}`),
    width: d.size.width,
    height: d.size.height,
    primary: d.id === primary,
    hasPresenter: d.id === presenterDisplay,
  }));
}

function displayById(id) { return screen.getAllDisplays().find(d => d.id === id); }

function leaveFullScreen(win) {
  if (IS_MAC) { if (win.isSimpleFullScreen()) win.setSimpleFullScreen(false); }
  else if (win.isFullScreen()) win.setFullScreen(false);
}

// simpleFullScreen on macOS avoids the Spaces animation and works per display.
function enterFullScreen(win) {
  if (IS_MAC) win.setSimpleFullScreen(true); else win.setFullScreen(true);
}

function placeAudience(display, fullscreen) {
  leaveFullScreen(audience);
  if (fullscreen) {
    audience.setBounds(display.bounds);
    enterFullScreen(audience);
  } else {
    const wa = display.workArea;
    const w = Math.min(1280, Math.round(wa.width * 0.6));
    const h = Math.round(w * 9 / 16);
    audience.setBounds({ x: wa.x + wa.width - w - 24, y: wa.y + 24 });
    audience.setContentSize(w, h);
  }
}

function placePresenter(display) {
  if (presenter.isFullScreen()) presenter.setFullScreen(false);
  if (presenter.isMaximized()) presenter.unmaximize();
  presenter.setBounds(display.workArea);
  presenter.maximize();
}

// Pick where the audience goes: the requested display if it is not the presenter's, else any other one.
function chooseAudienceDisplay(requestedId) {
  const presenterDisplay = screen.getDisplayMatching(presenter.getBounds());
  const others = screen.getAllDisplays().filter(d => d.id !== presenterDisplay.id);
  const wanted = others.find(d => d.id === requestedId);
  return { presenterDisplay, audienceDisplay: wanted || others[0] || null };
}

function audienceSize() {
  if (!audience) return { width: 1920, height: 1080 };
  const [width, height] = audience.getContentSize();
  return { width, height };
}

function sendShowInfo() {
  if (!show) return;
  send('show:info', {
    rehearsal: show.rehearsal,
    audienceSize: show.rehearsal ? { width: 1920, height: 1080 } : audienceSize(),
    displays: displayList(),
  });
}

function onDisplaysChanged() {
  send('displays:changed', displayList());
  if (!show || !audience) return;
  const current = displayById(show.audienceDisplayId);
  const { presenterDisplay, audienceDisplay } = chooseAudienceDisplay(show.audienceDisplayId);
  if (show.rehearsal && audienceDisplay) {
    // A projector was plugged in during rehearsal: go full screen on it.
    show.rehearsal = false;
    show.audienceDisplayId = audienceDisplay.id;
    placeAudience(audienceDisplay, true);
  } else if (!show.rehearsal && (!current || current.id === presenterDisplay.id)) {
    // The projector went away: fall back to a window next to the presenter view.
    if (audienceDisplay) { show.audienceDisplayId = audienceDisplay.id; placeAudience(audienceDisplay, true); }
    else { show.rehearsal = true; placeAudience(presenterDisplay, false); }
  }
  setTimeout(sendShowInfo, 300);
}

// ---------- show ----------

async function run(js) {
  if (!audience || audience.isDestroyed()) return null;
  try { return await audience.webContents.executeJavaScript(js, true); } catch { return null; }
}

let polling = false;
async function poll() {
  if (!show || polling) return;
  polling = true;
  try {
    const st = await run('window.__podium ? window.__podium.state() : null');
    if (!show || !st) return;
    const last = show.last;
    if (!last || last.index !== st.index || last.count !== st.count || last.sub !== st.sub) {
      if (!last || last.count !== st.count) {
        show.outline = (await run('window.__podium.outline()')) || [];
        send('show:outline', show.outline.map(({ index, id, title }) => ({ index, id, title })));
        send('notes:mapped', notesForSlides());
      }
      show.last = st;
      send('audience:state', st);
    }
  } finally { polling = false; }
}

function startShow({ audienceDisplayId, forceRehearsal } = {}) {
  if (!deck) throw new Error('Open a presentation first.');
  if (show) stopShow();
  const { presenterDisplay, audienceDisplay } = chooseAudienceDisplay(audienceDisplayId);
  const rehearsal = forceRehearsal || !audienceDisplay;

  show = { audienceDisplayId: audienceDisplay ? audienceDisplay.id : presenterDisplay.id, rehearsal, blank: null, last: null, outline: [] };

  audience = new BrowserWindow({
    show: false,
    title: 'Podium – Audience',
    icon: ICON,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  audience.setMenuBarVisibility(false);
  audience.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  audience.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); }
  });
  audience.webContents.on('dom-ready', async () => {
    await run(ADAPTER_SRC);
    await run('window.__podium.autoHideCursor()');
    if (show && show.blank) run(`window.__podium.blank(${JSON.stringify(show.blank)})`);
    if (show) { show.last = null; poll(); }
  });
  // Blank the screen straight from the audience window too (a remote's "blank" key sends "." or "b").
  audience.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || input.control || input.meta || input.alt) return;
    const k = input.key.toLowerCase();
    if (k === 'b' || k === '.') { e.preventDefault(); setBlank(show && show.blank === 'black' ? null : 'black'); }
    else if (k === 'w' || k === ',') { e.preventDefault(); setBlank(show && show.blank === 'white' ? null : 'white'); }
  });
  audience.on('closed', () => { audience = null; if (show) { stopShow(); send('show:ended'); } });
  audience.on('resize', () => setTimeout(sendShowInfo, 100));

  placePresenter(presenterDisplay);
  placeAudience(rehearsal ? presenterDisplay : audienceDisplay, !rehearsal);
  audience.loadURL(deck.deckUrl);
  audience.once('ready-to-show', () => {
    audience.showInactive();
    if (!rehearsal) presenter.focus();
  });

  show.pollTimer = setInterval(poll, 150);
  setTimeout(sendShowInfo, 400);
  return { rehearsal };
}

function stopShow() {
  if (!show) return;
  clearInterval(show.pollTimer);
  show = null;
  if (audience && !audience.isDestroyed()) {
    leaveFullScreen(audience);
    audience.destroy();
  }
  audience = null;
}

function sendKey(keyCode) {
  const wc = audience.webContents;
  wc.sendInputEvent({ type: 'keyDown', keyCode });
  wc.sendInputEvent({ type: 'keyUp', keyCode });
}

async function nav(cmd) {
  if (!show || !audience) return;
  if (cmd === 'next' || cmd === 'prev') {
    const handled = await run(`window.__podium && window.__podium.${cmd}()`);
    if (!handled) sendKey(cmd === 'next' ? 'Right' : 'Left');
  } else if (cmd === 'first') {
    await run('window.__podium.goTo(0)');
  } else if (cmd === 'last') {
    await run('window.__podium.goTo(window.__podium.state().count - 1)');
  }
  setTimeout(poll, 20);
}

async function goTo(index) {
  if (!show) return;
  await run(`window.__podium.goTo(${Number(index) | 0})`);
  poll();
}

function setBlank(mode) {
  if (!show) return;
  show.blank = mode || null;
  run(`window.__podium.blank(${JSON.stringify(show.blank)})`);
  send('show:blank', show.blank);
}

function swapDisplays() {
  if (!show || show.rehearsal || !audience) return;
  const presenterDisplay = screen.getDisplayMatching(presenter.getBounds());
  const audienceDisplay = displayById(show.audienceDisplayId);
  if (!audienceDisplay) return;
  show.audienceDisplayId = presenterDisplay.id;
  placePresenter(audienceDisplay);
  placeAudience(presenterDisplay, true);
  presenter.focus();
  setTimeout(sendShowInfo, 300);
}

// ---------- windows ----------

function createPresenter() {
  presenter = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Podium',
    icon: ICON,
    backgroundColor: '#14161a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      webviewTag: true,
      backgroundThrottling: false,
    },
  });
  presenter.loadFile(path.join(__dirname, 'ui', 'presenter.html'));
  presenter.once('ready-to-show', () => presenter.show());
  presenter.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  presenter.webContents.on('will-navigate', e => e.preventDefault());
  // Webviews inside the presenter only ever show the deck, with no Node access.
  presenter.webContents.on('will-attach-webview', (e, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.backgroundThrottling = false;
    if (!params.src.startsWith('file:') && params.src !== 'about:blank') e.preventDefault();
  });
  presenter.on('closed', () => { presenter = null; stopShow(); });
}

function openRequested(p) {
  if (!presenter) { pendingOpen = p; return; }
  try { send('deck:loaded', loadDeck(p)); } catch (e) { dialog.showErrorBox('Cannot open presentation', e.message); }
}

async function pickDeck() {
  const r = await dialog.showOpenDialog(presenter, {
    title: 'Open presentation',
    properties: ['openFile'],
    filters: [{ name: 'HTML presentation', extensions: ['html', 'htm'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return loadDeck(r.filePaths[0]);
}

async function pickNotes() {
  const r = await dialog.showOpenDialog(presenter, {
    title: 'Choose speaker notes',
    defaultPath: deck ? path.dirname(deck.deckPath) : undefined,
    properties: ['openFile'],
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return setNotes(r.filePaths[0]);
}

function buildMenu() {
  const template = [
    ...(IS_MAC ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Presentation…', accelerator: 'CmdOrCtrl+O', click: async () => { const d = await pickDeck(); if (d) send('deck:loaded', d); } },
        { label: 'Choose Speaker Notes…', accelerator: 'CmdOrCtrl+Shift+O', click: async () => { const d = await pickNotes(); if (d) send('deck:changed', d); } },
        { type: 'separator' },
        IS_MAC ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'toggleDevTools' },
        { label: 'Audience Developer Tools', click: () => audience && audience.webContents.openDevTools({ mode: 'detach' }) },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- IPC ----------

function registerIpc() {
  const h = (ch, fn) => ipcMain.handle(ch, (_e, ...args) => fn(...args));
  h('app:info', () => ({
    platform: process.platform,
    recent: settings.recent.filter(p => fs.existsSync(p)),
    displays: displayList(),
    notesFontSize: settings.notesFontSize,
    deck: deckInfo(),
  }));
  h('adapter:source', () => ADAPTER_SRC);
  h('deck:pick', pickDeck);
  h('deck:load', p => loadDeck(p));
  h('notes:pick', pickNotes);
  h('notes:clear', () => setNotes(null));
  h('notes:reset', () => { if (!deck) return null; delete settings.notesByDeck[deck.deckPath]; return setNotes(findNotesFor(deck.deckPath)); });
  h('show:start', opts => startShow(opts));
  h('show:stop', () => stopShow());
  h('show:nav', cmd => nav(cmd));
  h('show:goto', i => goTo(i));
  h('show:blank', mode => setBlank(mode));
  h('show:swap', () => swapDisplays());
  h('show:notes', () => notesForSlides());
  h('settings:set', (key, value) => { if (key === 'notesFontSize') { settings.notesFontSize = value; saveSettings(); } });
}

// ---------- lifecycle ----------

const firstHtmlArg = argv => argv.slice(1).find(a => !a.startsWith('-') && /\.html?$/i.test(a) && fs.existsSync(a));

if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const p = firstHtmlArg(argv);
    if (p) openRequested(p);
    if (presenter) { if (presenter.isMinimized()) presenter.restore(); presenter.focus(); }
  });
  app.on('open-file', (e, p) => { e.preventDefault(); openRequested(p); });

  app.whenReady().then(() => {
    // When run from source the Dock shows Electron's icon; use ours (with the macOS margin).
    if (IS_MAC && !app.isPackaged) app.dock.setIcon(path.join(__dirname, '..', 'build', 'icon.png'));
    loadSettings();
    registerIpc();
    buildMenu();
    createPresenter();
    screen.on('display-added', onDisplaysChanged);
    screen.on('display-removed', onDisplaysChanged);
    screen.on('display-metrics-changed', onDisplaysChanged);

    const argPath = !SMOKE && firstHtmlArg(process.argv);
    if (argPath) pendingOpen = argPath;
    presenter.webContents.once('did-finish-load', () => {
      if (pendingOpen) { openRequested(pendingOpen); pendingOpen = null; }
    });

    if (SMOKE) require('./smoke')({ presenter: () => presenter, audience: () => audience, loadDeck, startShow, nav, goTo, setBlank, send, getShow: () => show });
  });

  app.on('window-all-closed', () => app.quit());
}
