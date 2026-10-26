# Podium

Electron app that presents any HTML slide deck on a second screen, with a presenter view (current slide, next
slide, Markdown speaker notes, timer, pace) on the presenter's screen. macOS and Windows. See README.md for
what users see.

## Commands

```bash
npm start                                   # run the app
npm test                                    # unit tests (node --test, only covers src/notes.js)
npm run smoke -- test/fixtures/reveal/index.html   # drive the real app, save screenshots
npm run dist:mac / npm run dist:win         # installers into dist/
```

The smoke run writes PNGs of both windows plus `log.txt` to `$PODIUM_SMOKE_OUT` (default `<tmp>/podium-smoke`).
Look at the screenshots to check a UI change; there are no UI tests. The reveal fixture loads reveal.js from
jsDelivr, so it needs network.

## Layout

No build step, no bundler, no framework, no TypeScript. Plain CommonJS in the main process, plain browser JS in
the UI. Only runtime dependency is `marked`.

| File | Runs in | Role |
|---|---|---|
| `src/main.js` | main process | Windows, displays, deck/notes loading, show state, IPC handlers, settings, menu |
| `src/preload.js` | presenter preload | Exposes `window.podium` (IPC wrappers) via `contextBridge` |
| `src/ui/presenter.{html,js,css}` | presenter window | Home screen and presenter view in one page; `#home` / `#present` toggled with `hidden` |
| `src/adapter.js` | deck pages | Injected into every deck page; defines `window.__podium` |
| `src/notes.js` | main process | Pure Markdown-notes parsing and slide mapping; the only unit-tested module |
| `src/smoke.js` | main process | Loaded only with `--smoke` |

## How it works

- **Two windows.** `presenter` (home + presenter view) and `audience` (the deck itself, full screen on the
  other display, or a window in rehearsal mode). The presenter shows two `<webview>` previews of the same deck
  (current and next), rendered at the audience's resolution and scaled down.
- **The adapter.** `adapter.js` is read as text by main and injected with `executeJavaScript` into the audience
  window and both previews. It runs in the deck's own JS world so it can reach `window.Reveal`. It must stay
  idempotent (guarded by `if (window.__podium) return`) and self-contained: no `require`, no imports.
- **Two deck modes.** reveal.js is driven through its API. Anything else is "generic": slides found by CSS
  selectors, current slide guessed from active class / hash / visibility, navigation by key presses.
- **State flows one way.** Main polls `__podium.state()` in the audience window every 150 ms and pushes changes
  to the presenter (`audience:state`). The presenter never decides the current slide itself; it asks main to
  navigate and waits for the next poll. The previews follow via `Preview.goTo`.
- **Key presses.** Normal next/prev from main uses `webContents.sendInputEvent` (trusted events) when the
  adapter does not handle it. Jumps (`goTo` on generic decks) use synthetic `KeyboardEvent`s inside the page.
- **Notes.** The `.md` file is parsed in main (`notes.js` + `marked`), mapped to slide indexes by number, by
  `#id`, or in order, and sent as HTML (`notes:mapped`). Without a file, inline deck notes are used. The file is
  watched with `fs.watchFile` and reloads live.
- **Settings** live in `<userData>/settings.json`: recent decks, notes font size, and a per-deck notes choice
  (`''` means "deliberately no file"). Smoke runs never write settings.

## Adding a feature that crosses processes

1. Handler in `registerIpc()` in `main.js` (`h('area:action', ...)`), or a `send('area:event', payload)` push.
2. Matching wrapper in `preload.js` (`ipcRenderer.invoke` for calls, `on('channel')` for pushes).
3. Use it from `presenter.js` through `podium.*`.

Channel names are `area:verb`. Keep the three files in step.

## Security constraints (keep these)

- All windows: `contextIsolation: true`, `sandbox: true`, no `nodeIntegration`.
- `will-attach-webview` strips preloads from webviews and only allows `file:` or `about:blank`.
- The audience window opens non-`file:` links in the system browser instead of navigating.
- `presenter.html` has a strict CSP (`script-src 'self'`): no inline scripts or `eval` in the UI.
- In `presenter.js`, build DOM with `el()` and `textContent`. `innerHTML` is only used for notes HTML from
  `marked`, which comes from the presenter's own file.

## Code style

- Match the existing terse style: small functions, `const` arrow helpers, short `// ----- section -----`
  dividers, comments only where the reason is not obvious.
- User-facing text is plain, short English ("Choose an .html file, or a folder with an index.html.").
- Platform differences go behind `IS_MAC` (e.g. `setSimpleFullScreen` on macOS to avoid the Spaces animation).
- Don't add dependencies unless there is no reasonable way around it.
- Add a test in `test/notes.test.js` for any change to notes parsing or mapping.
- Keep README.md in step when keys, notes syntax, or deck detection change; it is the user manual.

## Gotchas

- `podium.resetNotes` / `notes:reset` exists but no UI button uses it yet.
- CI (`.github/workflows/build.yml`) uses Node 22 and only runs on `v*` tags or manually. Builds are unsigned.
- On Node 26, `npm install` can leave `node_modules/electron/dist` empty; README has the manual fix.
