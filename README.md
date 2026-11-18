# wishless' tab

A Chrome new tab page: butterflies made of text characters drift across a dark screen, behind a liquid-glass search box and a row of quick shortcuts.

## What it does

- **Butterflies** drift aside from the mouse pointer and scatter when you click empty sky. A few seconds after you open a tab, one lands on top of the clock or the search box, folds its wings up and rests there side-on, until you type, come close with the mouse, or click it. Shyness and Landing, under Advanced, set how much.
- **Clock** with today's date, in your system's 12- or 24-hour style.
- **A sky that follows the day**: night with twinkling stars, fog before dawn, morning mist, plain day, golden hour, sunset and twilight, blending smoothly from one to the next. Sunrise and sunset are estimated for a mid-northern latitude, since the extension doesn't ask for your location. Pin it to Light or Dark in the settings drawer.
- **Greeting** by time of day ("Good morning"). Click it to add your name ("Good morning, Sam").
- **Search box**: press <kbd>Enter</kbd> to search Google, or type a web address to go straight there.
  - Start with a prefix and a space to search one site: `yt` YouTube, `gh` GitHub, `r` Reddit, `w` Wikipedia, `m` Google Maps, `img` Google Images.
  - Type part of a shortcut's name and press <kbd>Tab</kbd> to pick it (again for the next match), then <kbd>Enter</kbd> to open it.
- **Shortcuts** under the search box, with each site's icon. Hover one to edit (✎) or remove (×) it, drag to reorder, or click **Add** for your own.
- **Fireflies** instead of butterflies, picked under Creature in the settings drawer: soft warm lights with a crisp point that wander and blink in bursts, setting each other off in waves. Most hover low over a meadow of swaying ASCII grass along the bottom, lighting up the blades and grid lines around them. They drift over to circle the mouse pointer and flash back at it (a fast swipe scatters them), and some settle on the clock and the search box, whose rim glows where they sit. Click the sky for a ripple of flashes.
- **Settings drawer**: click the gear in the bottom-right corner, press <kbd>T</kbd>, or hold the mouse at the left or right edge of the screen for a second. Pick the sky, the creature and a mood (Calm, Lively, Swarm, Still), or set the amount, speed, size and colour yourself. Everything else, including the glass look, is under Advanced.

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
- `ui.ts`: greeting and clock.
- `search.ts`: the search box, its site prefixes and picking shortcuts with Tab.
- `shortcuts.ts`: the shortcut pills, their add/edit form and drag-to-reorder.
- `theme.ts` and `src/sky.ts`: the sky through the day, and the page colours that follow it. Add `?hour=17.2` to the URL to preview another time.
- `panel.ts`: the settings drawer.
- `src/`: the animation engine (`flock.ts`), the character renderer (`renderer.ts`), the sky (`sky.ts`) and the creatures (`animals/butterflies.ts`, `animals/fireflies.ts`).
- `public/`: the extension manifest and icons.

## Credits

Built on an open-source project by drewdi, under the MIT License (see `LICENSE`).
