/**
 * The sky follows the time of day: midnight with stars, fog before dawn, morning mist, day, golden
 * hour, sunset, twilight (see src/sky.ts). The settings drawer can pin it to plain Light or Dark.
 * The page's own colours follow: light text on a dark sky, dark text on a light one.
 */
import { skyAt, skyColorAt, SKY_LABELS, THEME_SKIES, type AnimalEngine, type Sky, type Theme } from "./src";

export type ThemeMode = "auto" | "light" | "dark";

const MODE_KEY = "wishless-tab:theme";
/** How long a change of sky takes to cross over, ms. */
const FADE = 2500;
/** Roughly where the clock and greeting sit, as a fraction of the screen height. */
const MASTHEAD_Y = 0.27;

/** `?hour=18.5` pretends it's that time of day (18:30), for previewing the sky. */
const fakeHour = (() => {
  const raw = new URLSearchParams(location.search).get("hour");
  const h = raw === null ? NaN : Number(raw);
  return Number.isFinite(h) && h >= 0 && h < 24 ? h : null;
})();

function now() {
  const d = new Date();
  if (fakeHour !== null) d.setHours(Math.floor(fakeHour), Math.round((fakeHour % 1) * 60), 0, 0);
  return d;
}

export function getThemeMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved === "light" || saved === "dark" || saved === "auto") return saved;
  } catch {}
  return "auto";
}

/** The sky to show right now for this mode. */
export function currentSky(mode = getThemeMode()): Sky {
  return mode === "auto" ? skyAt(now()).sky : THEME_SKIES[mode];
}

/** Which set of page colours suits this sky. */
export function themeFor(sky: Sky): Theme {
  return sky.dark >= 0.5 ? "dark" : "light";
}

const css = ([r, g, b]: [number, number, number]) => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;

/**
 * Match the page to the sky: light or dark text, and the halo behind the clock and greeting in the
 * sky's colour there. Call it before the engine starts so nothing flashes the wrong colours.
 */
export function applyPageTheme(sky = currentSky()) {
  const root = document.documentElement;
  root.dataset.theme = themeFor(sky);
  root.style.setProperty("--bg", css(skyColorAt(sky, MASTHEAD_Y)));
}

/** Keep the page and the engine on the current sky, checking every minute and whenever the tab comes back. */
export function mountTheme(engine: AnimalEngine) {
  let mode = getThemeMode();

  const apply = (fade: number) => {
    const sky = currentSky(mode);
    applyPageTheme(sky);
    engine.setSky(sky, { fade });
  };

  apply(0);
  setInterval(() => apply(FADE), 60_000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) apply(FADE);
  });

  return {
    get mode() {
      return mode;
    },
    /** What the sky is doing now, for the drawer: "golden hour", or "" when pinned. */
    get now() {
      return mode === "auto" ? SKY_LABELS[skyAt(now()).name] : "";
    },
    setMode(next: ThemeMode) {
      mode = next;
      try {
        localStorage.setItem(MODE_KEY, next);
      } catch {}
      apply(FADE);
    },
  };
}

export type ThemeControl = ReturnType<typeof mountTheme>;
