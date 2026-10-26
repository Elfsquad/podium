// Injected into every deck page (audience window and the presenter's previews).
// It runs in the page's own JS world, so it can see framework APIs like window.Reveal.
// It must be safe to inject more than once.
(() => {
  if (window.__podium) return;

  const ACTIVE_CLASS = /(^|\s)(active|present|current|is-active|is-current|visible)(\s|$)/;

  // Candidate selectors for "one slide", most specific first. A deck can override with
  // <meta name="podium:slide-selector" content="...">.
  const SELECTORS = [
    '.slide', '[data-slide]', '.step', '.slides > section', 'body > section', 'section',
  ];

  const reveal = () => (window.Reveal && typeof window.Reveal.getIndices === 'function' && window.Reveal.isReady && window.Reveal.isReady()) ? window.Reveal : null;

  let cachedSlides = null;
  function slides() {
    if (cachedSlides && cachedSlides.length && cachedSlides.every(el => el.isConnected)) return cachedSlides;
    const meta = document.querySelector('meta[name="podium:slide-selector"]');
    const sels = meta ? [meta.content] : SELECTORS;
    for (const sel of sels) {
      // Only keep outermost matches so nested sections are not counted twice.
      const els = [...document.querySelectorAll(sel)].filter(el => !el.parentElement.closest(sel));
      if (els.length > 1) return (cachedSlides = els);
    }
    return (cachedSlides = []);
  }

  function isShown(el) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.5) return false;
    const r = el.getBoundingClientRect();
    const cx = innerWidth / 2, cy = innerHeight / 2;
    return r.width > 0 && r.left <= cx && r.right >= cx && r.top <= cy && r.bottom >= cy;
  }

  function genericIndex() {
    const els = slides();
    if (!els.length) return 0;
    const byClass = els.findIndex(el => ACTIVE_CLASS.test(el.getAttribute('class') || ''));
    if (byClass >= 0) return byClass;
    const byHash = location.hash ? els.findIndex(el => el.id && '#' + el.id === location.hash) : -1;
    if (byHash >= 0) return byHash;
    return Math.max(0, els.findIndex(isShown));
  }

  function titleOf(el) {
    if (!el) return '';
    const h = el.querySelector('h1, h2, h3, h4, .title');
    const t = (h ? h.textContent : '').replace(/\s+/g, ' ').trim();
    return t.slice(0, 120) || el.id || '';
  }

  function inlineNotesOf(el) {
    if (!el) return '';
    const n = el.querySelector('aside.notes, .notes, [data-notes]');
    if (!n) return el.getAttribute('data-notes') || '';
    return (n.getAttribute('data-notes') || n.innerText || n.textContent || '').trim();
  }

  function allSlides() {
    const r = reveal();
    if (r) return r.getSlides();
    return slides();
  }

  function state() {
    const r = reveal();
    if (r) {
      const list = r.getSlides();
      const cur = r.getCurrentSlide();
      const i = list.indexOf(cur);
      return { ok: true, kind: 'reveal', index: Math.max(0, i), count: list.length, sub: r.getIndices().f ?? -1 };
    }
    const els = slides();
    return { ok: els.length > 0, kind: 'generic', index: genericIndex(), count: els.length, sub: -1 };
  }

  function outline() {
    const r = reveal();
    return allSlides().map((el, i) => ({
      index: i,
      id: el.id || '',
      title: titleOf(el),
      notes: r ? (r.getSlideNotes(el) || '') : inlineNotesOf(el),
    }));
  }

  // Synthetic key presses are enough for nearly every deck; trusted input is sent by the main process
  // for normal next/prev, this is only used for jumps.
  function press(key) {
    const codes = { ArrowRight: 39, ArrowLeft: 37, Home: 36, End: 35 };
    const init = { key, code: key, keyCode: codes[key], which: codes[key], bubbles: true, cancelable: true };
    const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document;
    target.dispatchEvent(new KeyboardEvent('keydown', init));
    target.dispatchEvent(new KeyboardEvent('keyup', init));
  }

  function next() { const r = reveal(); if (r) { r.next(); return true; } return false; }
  function prev() { const r = reveal(); if (r) { r.prev(); return true; } return false; }

  // Go to slide `index`. `sub` is a fragment index (-1 = none shown, 99 = all shown) for decks that have them.
  function goTo(index, sub = -1) {
    const r = reveal();
    if (r) {
      const el = r.getSlides()[index];
      if (!el) return state();
      const ix = r.getIndices(el);
      r.slide(ix.h, ix.v, sub);
      return state();
    }
    const count = slides().length;
    index = Math.max(0, Math.min(count - 1, index));
    let guard = count * 4 + 10;
    while (guard-- > 0) {
      const cur = genericIndex();
      if (cur === index) break;
      press(cur < index ? 'ArrowRight' : 'ArrowLeft');
    }
    return state();
  }

  // Full-screen black or white cover, for "blank the screen" (B / W like PowerPoint).
  function blank(mode) {
    let el = document.getElementById('__podium-blank');
    if (!mode) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = '__podium-blank';
      el.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;transition:opacity .2s';
      document.documentElement.appendChild(el);
    }
    el.style.background = mode === 'white' ? '#fff' : '#000';
  }

  // Hide the mouse pointer after a short idle period (audience window only).
  function autoHideCursor() {
    const style = document.createElement('style');
    style.textContent = 'html.__podium-idle, html.__podium-idle * { cursor: none !important; }';
    document.head.appendChild(style);
    let t;
    const wake = () => {
      document.documentElement.classList.remove('__podium-idle');
      clearTimeout(t);
      t = setTimeout(() => document.documentElement.classList.add('__podium-idle'), 2000);
    };
    addEventListener('mousemove', wake, { passive: true });
    wake();
  }

  // Silence and freeze media (used for the "next slide" preview so it does not play videos).
  function freezeMedia() {
    const stop = () => document.querySelectorAll('video, audio').forEach(m => { m.muted = true; if (!m.paused) m.pause(); });
    stop();
    document.addEventListener('play', stop, true);
  }

  window.__podium = { state, outline, goTo, next, prev, blank, autoHideCursor, freezeMedia };
})();
