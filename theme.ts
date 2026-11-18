/**
 * Time of day: light by day, dark at night, and calmer creatures late at night.
 * The theme can also be pinned to Light or Dark from the settings drawer.
 */
import type { AnimalEngine, Theme } from "./src";

export type ThemeMode = "auto" | "light" | "dark";

const MODE_KEY = "wishless-tab:theme";
/** Late at night: fewer and slower creatures, on top of whatever the user set. */
const NIGHT_PACE = { density: 0.6, speed: 0.75 };
const DAY_PACE = { density: 1, speed: 1 };
/** How long a theme change takes to cross over, ms. */
const FADE = 1500;

/** `?hour=23` pretends it's that hour, for trying the day and night looks. */
const fakeHour = (() => {
  const raw = new URLSearchParams(location.search).get("hour");
  const h = raw === null ? NaN : Number(raw);
  return Number.isInteger(h) && h >= 0 && h < 24 ? h : null;
})();

function now() {
  const d = new Date();
  if (fakeHour !== null) d.setHours(fakeHour, 30);
  return d;
}

/** Light from 7am until 7pm, dark otherwise. */
export function themeAt(date: Date): Theme {
  const h = date.getHours();
  return h >= 7 && h < 19 ? "light" : "dark";
}

/** From 10pm until 5am. */
export function lateNight(date: Date) {
  const h = date.getHours();
  return h >= 22 || h < 5;
}

export function getThemeMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved === "light" || saved === "dark" || saved === "auto") return saved;
  } catch {}
  return "auto";
}

/** The theme to show right now. */
export function currentTheme(mode = getThemeMode()): Theme {
  return mode === "auto" ? themeAt(now()) : mode;
}

/** Paint the page's own colours right away (before the engine exists), so it never flashes the wrong theme. */
export function applyPageTheme(theme = currentTheme()) {
  document.documentElement.dataset.theme = theme;
}

/** Keep the page and the engine on the right theme and pace, checking every minute and whenever the tab comes back. */
export function mountTheme(engine: AnimalEngine) {
  let mode = getThemeMode();
  let shown: Theme = currentTheme(mode);

  const apply = (fade: number) => {
    const theme = currentTheme(mode);
    if (theme !== shown) {
      shown = theme;
      applyPageTheme(theme);
      engine.setTheme(theme, { fade });
    }
    engine.setPace(lateNight(now()) ? NIGHT_PACE : DAY_PACE);
  };

  applyPageTheme(shown);
  engine.setTheme(shown);
  apply(0);
  setInterval(() => apply(FADE), 60_000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) apply(FADE);
  });

  return {
    get mode() {
      return mode;
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
