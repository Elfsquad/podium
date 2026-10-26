# Podium

Present any HTML slide deck on a projector or second screen, with a presenter view on your own screen:
the current slide, the next slide, your speaker notes from a Markdown file, a timer and a pace indicator.
Runs on macOS and Windows.

## Use it

1. Open Podium and drop an `.html` deck on the window (or a folder with an `index.html`).
2. Podium looks for speaker notes next to the deck: a `.md` file with "notes" in its name, or the only `.md` there.
   You can pick another file, or use notes written inside the deck (`<aside class="notes">`).
3. Pick the audience screen and click **Start presenting**. The slides go full screen there; the presenter view
   stays on your screen. With one screen, the slides open in a window so you can rehearse.

Notes reload by themselves when you save the `.md` file, also during a presentation.

### Keys in the presenter view

| Key | Does |
|---|---|
| `→` `↓` `Space` `PageDown` `Enter` `N` | Next (presentation remotes work too) |
| `←` `↑` `PageUp` `Backspace` `P` | Back |
| `Home` / `End` | First / last slide |
| a number, then `Enter` | Go to that slide |
| `B` or `.` / `W` or `,` | Black / white screen (also works in the audience window) |
| `G` | All slides, click one to jump |
| `T` | Pause or resume the timer |
| `+` / `-` | Bigger / smaller notes |
| `Esc` | Close the overlay, undo a blank screen, or end the presentation |

## Writing speaker notes

One heading per slide. The heading level used is the smallest one (`#`, `##`, `###`) that appears at least twice,
so a single `# Title` at the top is ignored.

```markdown
# My talk: speaker notes

## 1. Welcome
*About 0:45 · ends at 0:45*

Good morning, and welcome…

## 2. Agenda
…
```

- `## 5. Title` maps to slide 5. `## #intro Title` maps to the slide whose element id is `intro`.
  Headings without either are matched in order.
- Without headings, separate slides with a line containing only `---`.
- A line like `*About 1:45 · ends at 5:00*` drives the pace indicator ("1:10 ahead", "On time", "0:40 behind").
  `ends at` is optional; it is added up from the `About` times when missing.

## What decks work

Podium loads the deck as is, in Chromium, and drives it with the same keys a presenter would press.

- **reveal.js** is detected and driven through its API, including vertical slides and fragments.
- **Other decks**: slides are found with the selectors `.slide`, `[data-slide]`, `.step`, `.slides > section`,
  `section`. The current slide is the one with an `active`, `present` or `current` class, the one matching
  `location.hash`, or the one visible in the middle of the screen. The deck has to go to the next slide on `→`.
- If Podium picks the wrong elements, add `<meta name="podium:slide-selector" content=".my-slide">` to the deck.

Videos play with sound in the audience window only; the previews are muted.

## Develop

Needs Node 22 or later. No build step: the app runs straight from `src/`.

```bash
npm install
npm start
```

```bash
npm test
```

| Path | What it is |
|---|---|
| `src/main.js` | Electron main process: windows, screens, loading decks and notes, IPC |
| `src/preload.js` | The `window.podium` API the presenter view uses |
| `src/ui/` | Home screen and presenter view |
| `src/adapter.js` | Script injected into the deck to read and change the current slide |
| `src/notes.js` | Speaker-notes parser (unit tested in `test/`) |
| `build/` | App icons: `icon.svg` is the source, the rest is generated |
| `test/fixtures/reveal/` | A small reveal.js deck with notes, for trying things out |

`npm run smoke -- path/to/deck.html` opens the deck in rehearsal mode, presses keys in the presenter view,
and saves screenshots of both windows to `$PODIUM_SMOKE_OUT` (default: a `podium-smoke` folder in the temp dir).
Try it with `npm run smoke -- test/fixtures/reveal/index.html`.

### Build installers

```bash
npm run dist:mac
```

```bash
npm run dist:win
```

Output goes to `dist/`: a `.dmg` for macOS, an installer and a portable `.exe` for Windows. Builds are not
code-signed, so macOS asks you to right-click → Open the first time and Windows SmartScreen shows a warning.
To change the icon, edit `build/icon.svg` and run `npm run icons` (needs `rsvg-convert` and ImageMagick:
`brew install librsvg imagemagick`). This rewrites `build/icon.png`, `.icns`, `.ico` and `src/ui/icon.png`;
commit them all.

`.github/workflows/build.yml` builds both on GitHub Actions when you push a `v*` tag.

Node 26 note: if `npm install` leaves `node_modules/electron/dist` empty, Electron's zip extraction hung. Unzip the
cached file from `~/Library/Caches/electron` into that folder and write `Electron.app/Contents/MacOS/Electron`
to `node_modules/electron/path.txt`.
