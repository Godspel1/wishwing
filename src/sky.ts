/**
 * The sky behind the animals, through the day: midnight with stars, fog before dawn, morning mist,
 * plain day, golden hour, sunset, twilight, and back to night. Each moment is a blend of the two
 * nearest presets, timed from an estimate of today's sunrise and sunset.
 */
import type { RGB } from "./ink";

export interface Sky {
  /** Background gradient, top → middle (55% down) → bottom. */
  top: RGB;
  mid: RGB;
  bottom: RGB;
  /** Grid line colour and opacity at tuning.grid = 1. */
  grid: [number, number, number, number];
  trailAlpha: number;
  /** A colour that reads against this sky (feelers, outlines). */
  ink: RGB;
  /** Multiplies every colour drawn: warm at golden hour, cool at twilight. */
  tint: RGB;
  /** Colour of the mist or fog. */
  haze: RGB;
  /** How much mist drifts across, 0 → 1. */
  mist: number;
  /** How much farther creatures sink into the mist, 0 → 1. */
  murk: number;
  /** How many stars show, 0 → 1. */
  stars: number;
  /** 0 a light sky → 1 a dark one: picks the page's text colours and the trail colour. */
  dark: number;
}

export type SkyName = "midnight" | "fog" | "mist" | "day" | "golden" | "sunset" | "twilight";

export const SKIES: Record<SkyName, Sky> = {
  midnight: {
    top: [4, 6, 16], mid: [7, 9, 22], bottom: [13, 17, 36],
    grid: [255, 255, 255, 0.05], trailAlpha: 0.85, ink: [150, 160, 200],
    tint: [1, 1, 1], haze: [60, 70, 100], mist: 0, murk: 0, stars: 1, dark: 1,
  },
  fog: {
    top: [24, 28, 38], mid: [42, 48, 60], bottom: [72, 78, 90],
    grid: [255, 255, 255, 0.035], trailAlpha: 0.7, ink: [170, 176, 192],
    tint: [0.94, 0.97, 1], haze: [150, 158, 174], mist: 1, murk: 0.55, stars: 0.12, dark: 0.85,
  },
  mist: {
    top: [196, 207, 224], mid: [226, 219, 223], bottom: [240, 215, 200],
    grid: [40, 44, 70, 0.04], trailAlpha: 0.6, ink: [60, 62, 82],
    tint: [1.02, 1, 1], haze: [255, 253, 250], mist: 1, murk: 0.4, stars: 0, dark: 0.1,
  },
  day: {
    top: [242, 242, 238], mid: [246, 243, 236], bottom: [248, 242, 230],
    grid: [30, 34, 60, 0.07], trailAlpha: 0.7, ink: [42, 42, 59],
    tint: [1, 1, 1], haze: [255, 255, 255], mist: 0, murk: 0, stars: 0, dark: 0,
  },
  golden: {
    top: [244, 228, 200], mid: [246, 213, 162], bottom: [240, 186, 128],
    grid: [90, 56, 20, 0.07], trailAlpha: 0.7, ink: [74, 52, 30],
    tint: [1.1, 1, 0.82], haze: [255, 228, 186], mist: 0.15, murk: 0.05, stars: 0, dark: 0.15,
  },
  sunset: {
    top: [86, 70, 128], mid: [212, 110, 104], bottom: [246, 154, 84],
    grid: [255, 240, 230, 0.06], trailAlpha: 0.8, ink: [255, 226, 210],
    tint: [1.08, 0.94, 0.9], haze: [255, 188, 160], mist: 0.2, murk: 0.08, stars: 0.05, dark: 0.6,
  },
  twilight: {
    top: [18, 24, 60], mid: [50, 60, 116], bottom: [116, 98, 150],
    grid: [255, 255, 255, 0.05], trailAlpha: 0.85, ink: [170, 180, 220],
    tint: [0.92, 0.96, 1.08], haze: [130, 140, 190], mist: 0.1, murk: 0.05, stars: 0.45, dark: 0.85,
  },
};

/** What each preset is called in the settings drawer. */
export const SKY_LABELS: Record<SkyName, string> = {
  midnight: "night sky",
  fog: "fog before dawn",
  mist: "morning mist",
  day: "day",
  golden: "golden hour",
  sunset: "sunset",
  twilight: "twilight",
};

const mix = (a: number, b: number, k: number) => a + (b - a) * k;
const mixRGB = (a: RGB, b: RGB, k: number): RGB => [mix(a[0], b[0], k), mix(a[1], b[1], k), mix(a[2], b[2], k)];

export function mixSky(a: Sky, b: Sky, k: number): Sky {
  return {
    top: mixRGB(a.top, b.top, k),
    mid: mixRGB(a.mid, b.mid, k),
    bottom: mixRGB(a.bottom, b.bottom, k),
    grid: [mix(a.grid[0], b.grid[0], k), mix(a.grid[1], b.grid[1], k), mix(a.grid[2], b.grid[2], k), mix(a.grid[3], b.grid[3], k)],
    trailAlpha: mix(a.trailAlpha, b.trailAlpha, k),
    ink: mixRGB(a.ink, b.ink, k),
    tint: mixRGB(a.tint, b.tint, k),
    haze: mixRGB(a.haze, b.haze, k),
    mist: mix(a.mist, b.mist, k),
    murk: mix(a.murk, b.murk, k),
    stars: mix(a.stars, b.stars, k),
    dark: mix(a.dark, b.dark, k),
  };
}

/** The sky's colour at a height, 0 top → 1 bottom. */
export function skyColorAt(sky: Sky, y: number): RGB {
  return y < 0.55 ? mixRGB(sky.top, sky.mid, y / 0.55) : mixRGB(sky.mid, sky.bottom, (y - 0.55) / 0.45);
}

/**
 * Today's sunrise and sunset in local clock hours. Without the user's location this assumes a
 * mid-northern latitude (42°) and solar noon at 12:30 (13:30 under daylight saving): close enough
 * to put sunset at the right end of the afternoon in most of Europe, North America and Asia.
 */
export function sunTimes(date: Date) {
  const start = new Date(date.getFullYear(), 0, 0);
  const day = Math.floor((date.getTime() - start.getTime()) / 86_400_000);
  const decl = ((23.44 * Math.PI) / 180) * Math.sin((2 * Math.PI * (284 + day)) / 365);
  const lat = (42 * Math.PI) / 180;
  const cosH = Math.max(-1, Math.min(1, -Math.tan(lat) * Math.tan(decl)));
  const half = (Math.acos(cosH) * 180) / Math.PI / 15;
  const jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
  const dst = date.getTimezoneOffset() < Math.max(jan, jul);
  const noon = 12.5 + (dst ? 1 : 0);
  return { rise: noon - half, set: noon + half };
}

/** The sky at this moment, and the name of the preset it is closest to. */
export function skyAt(date: Date): { sky: Sky; name: SkyName } {
  const { rise, set } = sunTimes(date);
  const keys: [number, SkyName][] = [
    [0, "midnight"],
    [rise - 2.5, "midnight"],
    [rise - 1, "fog"],
    [rise + 0.3, "mist"],
    [rise + 1.2, "mist"],
    [rise + 2.5, "day"],
    [set - 2, "day"],
    [set - 0.9, "golden"],
    [set - 0.05, "sunset"],
    [set + 0.6, "twilight"],
    [set + 1.6, "midnight"],
    [24, "midnight"],
  ];
  const h = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  for (let i = 1; i < keys.length; i++) {
    const [h1, b] = keys[i];
    if (h > h1) continue;
    const [h0, a] = keys[i - 1];
    const raw = h1 > h0 ? (h - h0) / (h1 - h0) : 1;
    const k = raw * raw * (3 - 2 * raw);
    return { sky: mixSky(SKIES[a], SKIES[b], k), name: k < 0.5 ? a : b };
  }
  return { sky: SKIES.midnight, name: "midnight" };
}
