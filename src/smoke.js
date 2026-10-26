// `npm run smoke -- <deck.html>`: opens the deck in rehearsal mode, drives the presenter view with real
// key presses, saves screenshots of both windows and the slide state, then quits.
// Output goes to $PODIUM_SMOKE_OUT (default: <tmp>/podium-smoke).
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const wait = ms => new Promise(r => setTimeout(r, ms));

module.exports = async function smoke(api) {
  const out = process.env.PODIUM_SMOKE_OUT || path.join(os.tmpdir(), 'podium-smoke');
  fs.mkdirSync(out, { recursive: true });
  const deckArg = process.argv.slice(process.argv.indexOf('--smoke') + 1).find(a => !a.startsWith('-'));
  const log = [];
  const note = (...a) => { const line = a.join(' '); log.push(line); console.log('[smoke]', line); };

  const presenter = api.presenter();
  presenter.webContents.on('console-message', e => { if (e.level === 'error' || e.level === 'warning') note('presenter console:', e.message); });
  await new Promise(r => presenter.webContents.once('did-finish-load', r));
  const deck = api.loadDeck(path.resolve(deckArg || '.'));
  note('deck', deck.deckPath, 'notes', deck.notesPath, deck.notesCount);
  api.send('deck:loaded', deck);
  await wait(800);
  await shot('0-home');

  await presenter.webContents.executeJavaScript("document.getElementById('rehearse').click()");
  await wait(3500);
  await shot('1-start');
  note('state after start', JSON.stringify(api.getShow().last));

  const key = async (keyCode, n = 1) => {
    for (let i = 0; i < n; i++) {
      presenter.webContents.sendInputEvent({ type: 'keyDown', keyCode });
      presenter.webContents.sendInputEvent({ type: 'char', keyCode });
      presenter.webContents.sendInputEvent({ type: 'keyUp', keyCode });
      await wait(250);
    }
  };

  await key('Right', 4);
  await wait(1500);
  await shot('2-after-4-next');
  note('state after 4x next', JSON.stringify(api.getShow().last));

  await key('Left');
  await wait(600);
  note('state after back', JSON.stringify(api.getShow().last));

  await key('2'); await key('1'); await key('Return');
  await wait(3000);
  await shot('3-jump-21');
  note('state after jump to 21', JSON.stringify(api.getShow().last));

  await key('B');
  await wait(600);
  await shot('4-black');
  await key('B');

  await key('G');
  await wait(600);
  await shot('5-grid');
  await key('Escape');

  await key('End');
  await wait(1500);
  await shot('6-last');
  note('state after End', JSON.stringify(api.getShow().last));

  fs.writeFileSync(path.join(out, 'log.txt'), log.join('\n') + '\n');
  note('screenshots in', out);
  app.quit();

  async function shot(name) {
    const p = api.presenter();
    if (p) fs.writeFileSync(path.join(out, name + '-presenter.png'), (await p.webContents.capturePage()).toPNG());
    const a = api.audience();
    if (a) fs.writeFileSync(path.join(out, name + '-audience.png'), (await a.webContents.capturePage()).toPNG());
  }
};
