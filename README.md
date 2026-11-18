# wishless' tab

A Chrome new tab page: butterflies made of text characters drift across a dark screen, behind a liquid-glass search box and a row of quick shortcuts.

## What it does

- **Clock** with today's date, in your system's 12- or 24-hour style.
- **Day and night**: light from 7am to 7pm and dark otherwise, with fewer, slower butterflies after 10pm. Pin it to Light or Dark in the settings drawer.
- **Greeting** by time of day ("Good morning, David"). Click the name to change it.
- **Search box**: press <kbd>Enter</kbd> to search Google, or type a web address to go straight there.
- **Shortcuts** under the search box, with each site's icon. Hover one to edit (✎) or remove (×) it, drag to reorder, or click **Add** for your own.
- **Settings drawer**: click the gear in the bottom-right corner, press <kbd>T</kbd>, or hold the mouse at the left or right edge of the screen for a second. Pick a theme and a mood (Calm, Lively, Swarm, Still), or set the amount, speed, size and colour yourself. Everything else, including the glass look, is under Advanced.

Everything you change is saved in your browser only. The only permission the extension asks for is `favicon`, to show the shortcuts' site icons from Chrome's own cache.

## Build

```sh
npm install
npm run build
```

The finished extension is written to `dist/`.

## Load in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `dist` folder.
4. Open a new tab.

After changing the code, run `npm run build` again and click the reload icon on the extension's card in `chrome://extensions`.

## Develop

```sh
npm run dev
```

Then open `http://localhost:5173`.

## Files

- `index.html`, `page.css`: the page and its styles.
- `demo.ts`: starts the butterflies, the settings drawer, search and shortcuts.
- `ui.ts`: greeting, clock and search box.
- `shortcuts.ts`: the shortcut pills, their add/edit form and drag-to-reorder.
- `theme.ts`: the day/night theme and the calmer late-night pace. Add `?hour=23` to the URL to preview another hour.
- `panel.ts`: the settings drawer.
- `src/`: the animation engine (`flock.ts`), the character renderer (`renderer.ts`) and the butterflies (`animals/butterflies.ts`).
- `public/`: the extension manifest and icons.
