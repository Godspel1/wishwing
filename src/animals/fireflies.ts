/**
 * Fireflies on a summer night.
 *
 * No stream to follow: each one wanders on a slow random walk, bending back from the edges, with a
 * gentle bob and a little lift as it lights up. Each keeps its own rhythm, flashing in bursts of one
 * to three pulses; a flash nudges nearby rhythms forward (pulse-coupled, scaled by Sync), so at high
 * Sync waves of light travel through the swarm. A click sets off a ripple of flashes.
 *
 * They're curious about the mouse pointer: they drift over and circle it, flashing back when it's
 * close, but a fast swipe scatters them. Now and then one settles on the top of the search box or
 * the clock and goes on blinking there.
 *
 * Each light is a soft round glow (Pen.glow), warm yellow, that adds up where they gather, with a
 * crisp character at its centre that grows from . to + to * as the flash peaks.
 */
import { SHARED_TUNING, type Animal, type Creature, type Flock, type Perch } from "../flock";
import type { RGB } from "../ink";
import { angleDiff, clamp, rand, smoothstep, TAU } from "../math";

const FLY = 0;
const APPROACH = 1;
const PERCHED = 2;
const LEAVE = 3;

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
  /** A flash set off by a click or the pointer, due at this time. */
  flashPending: number;
  /** Phase of its bob. */
  bob: number;
  /** Circling the pointer: which way round (±1), how far out (px), and how much it cares (0 → 1). */
  orbit: number;
  ring: number;
  interest: number;
  /** FLY, APPROACH, PERCHED or LEAVE. */
  mode: number;
  perchId: string;
  perchX: number;
  /** When it picked its spot, and when the current mode began. */
  claimAt: number;
  modeAt: number;
  /** Perched: leaves then. Flying: won't land again before then. */
  restUntil: number;
}

const DEFAULTS = {
  ...SHARED_TUNING,
  farthest: 0.3,
  farBias: 1.2,
  separation: 120,
  fog: 0.7,
  trail: 0,
  grid: 0.8,
  blinkRate: 1,
  glow: 1,
  sync: 0.25,
  wander: 1,
  curiosity: 1,
  landing: 1,
};

/** Warm firefly light: a near-white core in a yellow glow; deeper amber so it shows on a pale sky. */
const CORE_DARK: RGB = [255, 250, 210];
const GLOW_DARK: RGB = [255, 206, 84];
const CORE_LIGHT: RGB = [255, 214, 110];
const GLOW_LIGHT: RGB = [232, 160, 40];
/** Their bodies, seen as specks when unlit on a pale sky. */
const BODY: RGB = [60, 45, 30];

/** Most that sit on ledges at once, and landings per second at Landing 1. */
const PERCH_CAP = 4;
const LAND_RATE = 0.3;

const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
/** Roughly normal, mean 0, spread 1. */
const randn = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2;

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

/** Flash soon (sooner than any flash already due). */
const flashSoon = (f: Firefly, at: number) => (f.flashPending = Math.min(f.flashPending, at));

/** Where a firefly sits on a ledge: just on top of the edge. */
const seatY = (perch: Perch) => perch.y - 3;

function leave(f: Firefly, t: number) {
  f.mode = LEAVE;
  f.modeAt = t;
  f.perchId = "";
  f.restUntil = t + rand(12, 30);
  f.wander = -Math.PI / 2 + rand(-0.8, 0.8);
  f.vy -= 20;
}

export const fireflies: Animal<Firefly> = {
  key: "fireflies",
  label: "Fireflies",
  swatch: [255, 206, 84],
  defaults: DEFAULTS,
  hide: ["corner", "direction", "sway", "spread", "grip", "shimmer", "sparkle", "avoid"],
  controls: [
    ["Light", [
      { key: "blinkRate", label: "Blink rate", min: 0.2, max: 3, step: 0.05, hint: "How often they flash." },
      { key: "glow", label: "Glow", min: 0, max: 2, step: 0.05, hint: "How far their light spreads." },
      { key: "sync", label: "Sync", min: 0, max: 1, step: 0.01, hint: "How much a flash sets off its neighbours. High values send waves of light through the swarm." },
      { key: "wander", label: "Wander", min: 0, max: 2, step: 0.05, hint: "How much their paths meander." },
      { key: "curiosity", label: "Curiosity", min: 0, max: 3, step: 0.05, hint: "How strongly they're drawn to the mouse pointer. 0 ignores it." },
      { key: "landing", label: "Landing", min: 0, max: 3, step: 0.05, hint: "How often they settle on the clock and the search box. 0 never." },
    ]],
  ],
  area: 26000,
  max: 140,
  scale: 0.14,
  speed: 24,
  trail: { light: [232, 160, 40], dark: [255, 206, 84] },

  create: (c) => ({
    ...c, wander: rand(0, TAU), clock: Math.random(), period: rand(2.5, 6), flashAt: -10, pulsesLeft: 0,
    pulses: 1 + Math.floor(Math.random() * 3), glow: 0, flashPending: Infinity, bob: rand(0, TAU),
    orbit: Math.random() < 0.5 ? -1 : 1, ring: rand(36, 110), interest: Math.random() < 0.65 ? rand(0.6, 1) : rand(0, 0.2),
    mode: FLY, perchId: "", perchX: 0, claimAt: 0, modeAt: 0, restUntil: rand(1, 6),
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
    f.mode = FLY;
    f.perchId = "";
  },

  /** Now and then send a free firefly to a spot on a ledge. */
  prepare(flock, dt) {
    const k = flock.tuning as typeof DEFAULTS;
    const t = flock.time;
    if (!flock.perches.length || t < flock.quietUntil || k.landing <= 0) return;
    let busy = 0;
    for (const c of flock.creatures) if (c.mode === APPROACH || c.mode === PERCHED) busy++;
    if (busy >= PERCH_CAP || Math.random() > LAND_RATE * k.landing * dt) return;

    const p = flock.pointer;
    const free = flock.creatures.filter((f) =>
      f.mode === FLY && !f.leaving && f.vanish === 0 && f.depth > 0.5 && t > f.restUntil &&
      f.x > 0 && f.x < flock.width && f.y > 0 && f.y < flock.height &&
      !(p.inside && Math.hypot(f.x - p.x, f.y - p.y) < 160));
    if (!free.length) return;
    const f = free[Math.floor(Math.random() * free.length)];
    const perch = flock.perches[Math.floor(Math.random() * flock.perches.length)];
    // A spot not too close to anyone already there.
    for (let tries = 0; tries < 6; tries++) {
      const x = rand(perch.x0 + 8, perch.x1 - 8);
      const crowded = flock.creatures.some((o) => o.perchId === perch.id && Math.abs(o.perchX - x) < 34);
      if (crowded) continue;
      f.mode = APPROACH;
      f.perchId = perch.id;
      f.perchX = x;
      f.claimAt = t;
      f.modeAt = t;
      return;
    }
  },

  update(f, flock, dt) {
    const k = flock.tuning as typeof DEFAULTS;
    const t = flock.time;
    const { width: W, height: H } = flock;
    const cruise = flock.cruise(f);
    const p = flock.pointer;

    // Give up a spot when disturbed, when the pointer comes for it, or after a rest.
    if (f.mode === APPROACH || f.mode === PERCHED) {
      const perch = flock.perches.find((q) => q.id === f.perchId);
      const near = p.inside && Math.hypot(p.x - f.x, p.y - f.y) < 90;
      const gone = !perch || f.perchX < perch.x0 || f.perchX > perch.x1;
      if (gone || near || f.leaving || flock.disturbedAt > f.claimAt || k.landing <= 0 ||
          (f.mode === PERCHED && t > f.restUntil) || (f.mode === APPROACH && t - f.modeAt > 14)) {
        leave(f, t);
      }
    }

    if (f.mode === PERCHED) {
      const perch = flock.perches.find((q) => q.id === f.perchId)!;
      f.x = f.perchX;
      f.y = seatY(perch);
      f.vx = 0;
      f.vy = 0;
    } else {
      const acc = flock.begin();
      if (f.mode === APPROACH) {
        const perch = flock.perches.find((q) => q.id === f.perchId)!;
        const sy = seatY(perch);
        const d = Math.hypot(f.perchX - f.x, sy - f.y);
        flock.steer(f, Math.atan2(sy - f.y, f.perchX - f.x), Math.min(2.2 * cruise, 6 + d * 0.8), 3);
        if (d < 2.5) {
          f.mode = PERCHED;
          f.modeAt = t;
          f.restUntil = t + rand(10, 30);
        }
      } else {
        // Meander, bending back toward the middle near the edges.
        f.wander += randn() * 1.4 * k.wander * Math.sqrt(dt);
        const m = 0.1 * Math.min(W, H);
        const into = Math.max(m - f.x, f.x - (W - m), m - f.y, f.y - (H - m), 0);
        if (into > 0) f.wander += angleDiff(f.wander, Math.atan2(H / 2 - f.y, W / 2 - f.x)) * clamp(into / m, 0, 1) * 2 * dt;
        flock.steer(f, f.wander, cruise, 1.2);
        if (f.mode === LEAVE && t - f.modeAt > 1.5) f.mode = FLY;

        // Curious about the pointer: circle it and flash back, unless it sweeps through fast.
        if (p.inside && k.curiosity > 0) {
          const dx = p.x - f.x;
          const dy = p.y - f.y;
          const d = Math.hypot(dx, dy) || 1;
          const R = 560 * (0.5 + 0.5 * f.depth);
          const sweep = Math.hypot(p.vx, p.vy);
          if (sweep > 1100 && d < 170) {
            const push = 900 * (1 - d / 170);
            acc.x -= (dx / d) * push;
            acc.y -= (dy / d) * push;
            if (t - f.flashAt > 0.6) flashSoon(f, t + rand(0, 0.15));
          } else if (d < R && f.interest > 0.3) {
            // Head in while far, then circle at its own distance.
            const out = clamp((d - f.ring) / f.ring, -1, 3);
            const round = 0.9 / (1 + Math.max(0, out));
            const ux = (-dy / d) * f.orbit * round + (dx / d) * out;
            const uy = (dx / d) * f.orbit * round + (dy / d) * out;
            const pull = Math.pow(1 - d / R, 0.5) * k.curiosity * f.interest;
            flock.steer(f, Math.atan2(uy, ux), cruise * (1.4 + 2.2 * pull), 3 * pull);
            if (d < f.ring * 1.6 && t - f.flashAt > 1 && Math.random() < 1.2 * dt) flashSoon(f, t + rand(0.05, 0.4));
          }
        }
      }

      acc.y += 8 * Math.sin(1.3 * t + f.bob);
      // A little lift as it lights up (the "J" a real firefly draws).
      if (f.mode !== APPROACH) acc.y -= 40 * f.depth * f.glow;
      flock.separate(f, k.separation * (f.mode === APPROACH ? 0.2 : 1), 1.6);
      const speed = flock.move(f, dt, cruise * 3);
      if (speed > 2) flock.face(f, dt, 4);

      // Strayed well off screen: come back in somewhere else.
      const lost = 2 * f.span + 20;
      if (f.x < -lost || f.x > W + lost || f.y < -lost || f.y > H + lost) {
        if (f.leaving) {
          f.gone = true;
          return;
        }
        fireflies.enter!(f, flock);
      }
    }

    // Blink (sitting ones too).
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
    if (f.mode === PERCHED || f.mode === APPROACH) leave(f, flock.time);
    f.vx += dx * strength * 120 * f.depth;
    f.vy += dy * strength * 120 * f.depth;
    if (strength > 0.15) flashSoon(f, flock.time + (1 - strength) * 0.5);
  },

  drawAll(flock, pen) {
    const k = flock.tuning as typeof DEFAULTS;
    const dark = pen.dark;
    const core = mix(CORE_LIGHT, CORE_DARK, dark);
    const glow = mix(GLOW_LIGHT, GLOW_DARK, dark);
    for (const f of flock.creatures) {
      // Distance dims a firefly, but only half as much as it fades other animals.
      const L = f.glow * (1 - f.vanish) * (1 - 0.5 * pen.fogFor(f.depth));
      if (L > 0.02) {
        const radius = (6 + 16 * k.glow) * (0.45 + 0.55 * f.depth) * (0.75 + 0.25 * L);
        // A sharp point that grows as the flash peaks: . → + → *
        const point = L > 0.7 ? "*" : L > 0.35 ? "+" : ".";
        pen.glow(f.x, f.y, radius, glow, core, L * (0.75 + 0.25 * dark), point);
      }
      // Unlit, they're little dark beetles: a speck, only noticeable on a pale sky.
      if (L < 0.3 && dark < 0.5 && f.vanish < 0.9) pen.dot(f.x, f.y, ".", BODY, f.depth);
    }
  },
};
