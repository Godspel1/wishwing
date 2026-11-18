/**
 * Fireflies on a summer night.
 *
 * No stream to follow: each one wanders on a slow random walk, bending back from the edges, with a
 * gentle bob and a little lift as it lights up. Each keeps its own rhythm, flashing in bursts of one
 * to three pulses; a flash nudges nearby rhythms forward (pulse-coupled, scaled by Sync), so at high
 * Sync waves of light travel through the swarm. A click sets off a ripple of flashes.
 *
 * Drawn all at once (drawAll) so overlapping halos add up: a light field over the cells, read out as
 * glow glyphs, with a lit cell for each lantern on top.
 */
import { SHARED_TUNING, type Animal, type Creature, type Flock } from "../flock";
import type { RGB } from "../ink";
import { angleDiff, clamp, rand, smoothstep, TAU } from "../math";

interface Firefly extends Creature {
  /** Heading of its random walk. */
  wander: number;
  /** Blink rhythm, 0 → 1; flashes on reaching 1. */
  clock: number;
  /** Seconds per rhythm at Blink rate 1. */
  period: number;
  /** When the current pulse started. */
  flashAt: number;
  /** Pulses still to come in this burst, and how many a burst has. */
  pulsesLeft: number;
  pulses: number;
  /** Brightness right now, 0 → 1. */
  glow: number;
  /** A flash set off by a click, due at this time. */
  flashPending: number;
  /** Phase of its bob. */
  bob: number;
}

const DEFAULTS = {
  ...SHARED_TUNING,
  farthest: 0.3,
  farBias: 1.2,
  separation: 120,
  sparkle: 0.06,
  fog: 0.7,
  trail: 1.2,
  trailFade: 1.4,
  grid: 0.8,
  blinkRate: 1,
  glow: 1,
  sync: 0.25,
  wander: 1,
};

/** Lantern and halo colours on a dark sky and on a light one (deeper, so they read on cream). */
const CORE_DARK: RGB = [214, 255, 120];
const CORE_LIGHT: RGB = [178, 190, 30];
const HALO_DARK: RGB = [150, 230, 70];
const HALO_LIGHT: RGB = [130, 142, 24];
const BODY: RGB = [60, 45, 30];
const HALO_GLYPHS = " .:+*";

const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
/** Roughly normal, mean 0, spread 1. */
const randn = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2;

/** Light field for the halos, one value per cell, reused between frames. */
let field = new Float32Array(0);

function flash(f: Firefly, flock: Flock<Firefly>, sync: number) {
  const t = flock.time;
  f.clock = 0;
  f.flashAt = t;
  f.pulsesLeft = f.pulses - 1;
  f.flashPending = Infinity;
  if (sync <= 0) return;
  // Nudge the neighbours' rhythms forward: chains of these become travelling waves.
  const R = 220 * (0.5 + 0.5 * f.depth);
  for (const o of flock.creatures) {
    if (o === f || o.leaving || Math.abs(o.depth - f.depth) > 0.3 || t - o.flashAt < 0.3) continue;
    const d = Math.hypot(o.x - f.x, o.y - f.y);
    if (d < R) o.clock = Math.min(1, o.clock + 0.08 * sync * (1 - d / R));
  }
}

export const fireflies: Animal<Firefly> = {
  key: "fireflies",
  label: "Fireflies",
  swatch: [200, 240, 80],
  defaults: DEFAULTS,
  hide: ["corner", "direction", "sway", "spread", "grip", "shimmer"],
  controls: [
    ["Light", [
      { key: "blinkRate", label: "Blink rate", min: 0.2, max: 3, step: 0.05, hint: "How often they flash." },
      { key: "glow", label: "Glow", min: 0, max: 2, step: 0.05, hint: "How far their light spreads." },
      { key: "sync", label: "Sync", min: 0, max: 1, step: 0.01, hint: "How much a flash sets off its neighbours. High values send waves of light through the swarm." },
      { key: "wander", label: "Wander", min: 0, max: 2, step: 0.05, hint: "How much their paths meander." },
    ]],
  ],
  area: 26000,
  max: 140,
  scale: 0.14,
  speed: 24,
  trail: { light: [120, 140, 30], dark: [176, 236, 92] },

  create: (c) => ({
    ...c, wander: rand(0, TAU), clock: Math.random(), period: rand(2.5, 6), flashAt: -10, pulsesLeft: 0,
    pulses: 1 + Math.floor(Math.random() * 3), glow: 0, flashPending: Infinity, bob: rand(0, TAU),
  }),

  /** Anywhere on screen: it's dark between flashes, so nobody sees it arrive. */
  enter(f, flock) {
    f.x = rand(0, flock.width);
    f.y = rand(0, flock.height);
    f.wander = rand(0, TAU);
    f.vx = Math.cos(f.wander) * 8;
    f.vy = Math.sin(f.wander) * 8;
    f.heading = f.wander;
    f.clock = Math.random();
    f.glow = 0;
  },

  update(f, flock, dt) {
    const k = flock.tuning as typeof DEFAULTS;
    const t = flock.time;
    const { width: W, height: H } = flock;
    const cruise = flock.cruise(f);

    // Meander, bending back toward the middle near the edges.
    f.wander += randn() * 1.4 * k.wander * Math.sqrt(dt);
    const m = 0.1 * Math.min(W, H);
    const into = Math.max(m - f.x, f.x - (W - m), m - f.y, f.y - (H - m), 0);
    if (into > 0) f.wander += angleDiff(f.wander, Math.atan2(H / 2 - f.y, W / 2 - f.x)) * clamp(into / m, 0, 1) * 2 * dt;

    const acc = flock.begin();
    flock.steer(f, f.wander, cruise, 1.2);
    acc.y += 8 * Math.sin(1.3 * t + f.bob);
    // A little lift as it lights up (the "J" a real firefly draws).
    acc.y -= 40 * f.depth * f.glow;
    flock.separate(f, k.separation, 1.6);
    flock.avoidPointer(f, k.avoid * 0.3);
    const speed = flock.move(f, dt, cruise * 3);
    if (speed > 2) flock.face(f, dt, 4);

    // Strayed well off screen: come back in from an edge.
    const lost = 2 * f.span + 20;
    if (f.x < -lost || f.x > W + lost || f.y < -lost || f.y > H + lost) {
      if (f.leaving) {
        f.gone = true;
        return;
      }
      fireflies.enter!(f, flock);
    }

    // Blink.
    if (!f.leaving) {
      f.clock += (dt * k.blinkRate) / f.period;
      if (f.clock >= 1 || t >= f.flashPending) flash(f, flock, k.sync);
      else if (f.pulsesLeft > 0 && t - f.flashAt > 0.45) {
        f.flashAt = t;
        f.pulsesLeft--;
      }
    }
    const since = t - f.flashAt;
    f.glow = smoothstep(0, 0.08, since) * (since < 0.2 ? 1 : Math.exp(-(since - 0.2) / 0.5));
  },

  /** A click pushes them a little and sets off a ripple of flashes spreading out from it. */
  startle(f, dx, dy, strength, flock) {
    f.vx += dx * strength * 120 * f.depth;
    f.vy += dy * strength * 120 * f.depth;
    if (strength > 0.15) f.flashPending = flock.time + (1 - strength) * 0.5;
  },

  drawAll(flock, pen) {
    const k = flock.tuning as typeof DEFAULTS;
    const { cols, rows, cw, ch } = pen;
    if (field.length !== cols * rows) field = new Float32Array(cols * rows);
    else field.fill(0);
    const dark = pen.dark;
    const core = mix(CORE_LIGHT, CORE_DARK, dark);
    const halo = mix(HALO_LIGHT, HALO_DARK, dark);
    const haloK = 0.6 + 0.4 * dark;

    // Unlit bodies: faint specks, under everything else.
    for (const f of flock.creatures) {
      if (f.glow < 0.3 && f.vanish < 0.9) pen.dot(f.x, f.y, ".", BODY, f.depth, pen.fogFor(f.depth, Math.max(f.vanish, 0.35)));
    }

    /** How bright a firefly shows: distance dims it, but only half as much as it fades other animals. */
    const shine = (f: Firefly) => f.glow * (1 - f.vanish) * (1 - 0.5 * pen.fogFor(f.depth));

    // Halos: every lit firefly adds light to the cells around it.
    for (const f of flock.creatures) {
      const L = shine(f);
      if (L < 0.02) continue;
      const R = (1.2 + 3.2 * k.glow) * cw * (0.5 + 0.5 * f.depth);
      const c0 = Math.max(0, Math.floor((f.x - R) / cw));
      const c1 = Math.min(cols - 1, Math.floor((f.x + R) / cw));
      const r0 = Math.max(0, Math.floor((f.y - R) / ch));
      const r1 = Math.min(rows - 1, Math.floor((f.y + R) / ch));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const d = Math.hypot((c + 0.5) * cw - f.x, (r + 0.5) * ch - f.y);
          if (d < R) field[r * cols + c] += L * (1 - d / R) ** 2 * haloK;
        }
      }
      pen.shed(f.x, f.y, 0.06 * L);
    }
    for (let i = 0; i < field.length; i++) {
      const light = field[i];
      if (light < 0.035) continue;
      const glyph = HALO_GLYPHS[clamp(Math.floor(light * HALO_GLYPHS.length * 1.6), 1, HALO_GLYPHS.length - 1)];
      pen.dot(((i % cols) + 0.5) * cw, (((i / cols) | 0) + 0.5) * ch, glyph, halo, 1, 1 - Math.min(1, 2.4 * light));
    }

    // Lanterns: one lit cell each, with a dark head just ahead of it on the near ones.
    for (const f of flock.creatures) {
      const L = shine(f);
      if (L < 0.3) continue;
      const lit = mix(halo, core, L);
      const fog = (1 - L) * 0.6;
      // A bright, nearly white glyph on a block of the lantern's colour.
      const hot = mix(lit, [255, 255, 225], 0.55 * L * dark);
      pen.spot(f.x, f.y, "*", hot, [lit[0] * 0.75, lit[1] * 0.75, lit[2] * 0.75], f.depth, fog);
      if (f.span >= 1.2 * cw) {
        const reach = Math.max(cw, 0.6 * f.span);
        pen.dot(f.x + Math.cos(f.heading) * reach, f.y + Math.sin(f.heading) * reach, "o", BODY, f.depth);
      }
    }
  },
};
