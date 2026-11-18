/**
 * The shared world every animal lives in: a population that crosses the
 * screen along one course, re-entering upstream once it leaves downstream.
 *
 * Size stands in for distance. Each creature gets a fixed random roll that
 * maps to a depth (0 far → 1 near) through the current tuning; depth scales
 * its size and speed (parallax) and how far it fades into the background.
 * The list stays sorted far → near, so near creatures draw over far ones.
 *
 * What an animal does with that (flap, leap, pulse, scuttle, school) lives in
 * its Animal definition; the helpers here cover the steering they share.
 */
import type { RGB } from "./ink";
import { angleDiff, clamp, rand } from "./math";
import type { Pen } from "./renderer";

export interface Creature {
  id: number;
  /** Fixed per creature; depth is derived from it with the current tuning. */
  roll: number;
  /** 0 far / faded → 1 near / vivid. */
  depth: number;
  /** Size of this creature in px (wingspan, body length…: whatever its shape is measured in). */
  span: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  /** Personal deviation from the course, -1 → 1 (scaled by tuning.spread). */
  bias: number;
  startledUntil: number;
  /** Being retired: it fades out (or leaves downstream) and is then removed. */
  leaving: boolean;
  /** 0 fully present → 1 invisible. Eases in for newcomers and out for leavers. */
  vanish: number;
  /** Removed from the flock; anyone holding a reference should let go. */
  gone: boolean;
}

/** The mouse pointer as the flock sees it (canvas px), written by the engine every frame. */
export interface PointerState {
  x: number;
  y: number;
  /** Smoothed velocity, px/s; fades to 0 once the pointer stops. */
  vx: number;
  vy: number;
  /** 0 still or gone → 1 moving right now. */
  stir: number;
  /** Over the window at all. */
  inside: boolean;
}

/**
 * A ledge creatures can land on: the top edge of the search box, the top of the clock (canvas px).
 * `keepOut` lists x-ranges their wings must not cover (the greeting just above the search box).
 */
export interface Perch {
  id: string;
  x0: number;
  x1: number;
  y: number;
  keepOut?: [number, number][];
}

/** Strength of avoidPointer at Shyness 1, px/s². */
const AVOID_ACCEL = 1000;


/** Knobs every animal has. Each animal's defaults start from these and add its own. */
export const SHARED_TUNING = {
  // Movement
  /** Individuals per screen, relative to the area-based default. */
  density: 1,
  /** Cross corner to corner (bottom-left → top-right) whatever the screen shape. */
  corner: false,
  /** Course in degrees when not corner to corner: 0 → right, 90 → up. */
  direction: 49,
  speed: 1,
  /** How far the whole stream sways off course, radians. */
  sway: 0.04,
  /** How far each individual's own course can differ from the stream's, radians. */
  spread: 0.06,
  /** Size multiplier. */
  size: 1,
  /** Depth of the farthest individuals (1 = everyone equally near). */
  farthest: 0.45,
  /** >1 puts more of the population far away; <1 brings it close. */
  farBias: 1.6,
  /** How tightly individuals hold their course. */
  grip: 2,
  /** How much they veer away from the moving pointer. */
  avoid: 1,
  /** Push between neighbours at the same depth. */
  separation: 300,

  // Look
  /**
   * Turns the animal's colours around the colour wheel, degrees. For trying colours out: each
   * animal's own colour is fixed in its file. (Named hueShift so shifts saved by the old Hue knob
   * don't come back.)
   */
  hueShift: 0,
  /** Strength of the iridescent brightness roll. */
  shimmer: 0.3,
  /** Chance a shimmering cell flashes white; plain ones get a third of it. */
  sparkle: 0.12,
  /** How much the farthest individuals fade into the background. */
  fog: 0.75,
  /** How much they leave in the trail. */
  trail: 1,
  /** How fast the trail fades, per second. */
  trailFade: 1.3,
  /** Grid line strength. */
  grid: 1.05,
  /** ASCII resolution: higher means smaller cells. */
  detail: 1.3,
};

export type SharedTuning = typeof SHARED_TUNING;
export type Tuning = SharedTuning & Record<string, number | boolean>;

/** A slider (or, with toggle, a switch) in the tweak panel; hint explains it in a tooltip. */
export type KnobSpec =
  | { key: string; label: string; min: number; max: number; step: number; hint: string; disabledWhen?: string }
  | { key: string; label: string; toggle: true; hint: string };

export type ControlGroup = [title: string, knobs: KnobSpec[]];

export const SHARED_CONTROLS: { movement: KnobSpec[]; look: KnobSpec[] } = {
  movement: [
    { key: "density", label: "Density", min: 0.1, max: 4, step: 0.05, hint: "How many are on screen." },
    { key: "corner", label: "Corner to corner", toggle: true, hint: "Cross from the bottom-left corner to the top-right, whatever the window's shape. Turn off to set Direction yourself." },
    { key: "direction", label: "Direction (°)", min: 0, max: 360, step: 1, disabledWhen: "corner", hint: "Which way they travel, in degrees: 0 is right, 90 is up. Only used when Corner to corner is off." },
    { key: "speed", label: "Speed", min: 0.1, max: 3, step: 0.05, hint: "How fast they travel." },
    { key: "sway", label: "Sway", min: 0, max: 0.6, step: 0.01, hint: "How much the whole group slowly drifts left and right off course. 0 is a dead-straight line." },
    { key: "spread", label: "Spread", min: 0, max: 0.8, step: 0.01, hint: "How far each one's own path can stray from the group's. 0 means everyone keeps exactly the same line." },
    { key: "size", label: "Size", min: 0.3, max: 2.5, step: 0.05, hint: "How big they are." },
    { key: "farthest", label: "Farthest depth", min: 0.1, max: 1, step: 0.01, hint: "How small and faint the farthest ones get. 1 makes them all equally close." },
    { key: "farBias", label: "Far bias", min: 0.3, max: 3, step: 0.05, hint: "How many sit far away versus close. Higher puts more of them in the distance." },
    { key: "grip", label: "Hold course", min: 0.2, max: 5, step: 0.05, hint: "How hard they steer back onto course after drifting. Higher is stricter." },
    { key: "separation", label: "Separation", min: 0, max: 1000, step: 10, hint: "How strongly neighbours keep their distance from each other." },
    { key: "avoid", label: "Shyness", min: 0, max: 3, step: 0.05, hint: "How much they veer away from the moving mouse pointer. 0 ignores it." },
  ],
  look: [
    { key: "hueShift", label: "Hue shift (°)", min: -180, max: 180, step: 1, hint: "Turns their colours around the colour wheel, in degrees. 0 is their natural colour." },
    { key: "shimmer", label: "Shimmer", min: 0, max: 1, step: 0.01, hint: "How much iridescent surfaces roll brighter and darker as the animal turns." },
    { key: "sparkle", label: "Sparkle", min: 0, max: 0.5, step: 0.01, hint: "How often cells flash white, like light catching scales or wings." },
    { key: "fog", label: "Distance fade", min: 0, max: 1, step: 0.01, hint: "How much far-away ones fade into the background." },
    { key: "trail", label: "Trail", min: 0, max: 4, step: 0.05, hint: "How much they leave behind: scales, ripples, footprints or glow." },
    { key: "trailFade", label: "Trail fade", min: 0.05, max: 6, step: 0.05, hint: "How quickly that trail fades. Lower lingers longer." },
    { key: "grid", label: "Grid", min: 0, max: 4, step: 0.05, hint: "How visible the background grid lines are." },
    { key: "detail", label: "Detail", min: 0.5, max: 2, step: 0.05, hint: "Resolution. Higher means smaller characters and finer butterflies." },
  ],
};

export interface Animal<C extends Creature = Creature> {
  key: string;
  /** Name in the animal choices. */
  label: string;
  /** Its defining colour, for its dot in the animal choices. Every animal has its own. */
  swatch: RGB;
  defaults: Tuning;
  /** This animal's own knobs, shown between Movement and Look. */
  controls: ControlGroup[];
  /** Shared knobs that do nothing for this animal. */
  hide?: (keyof SharedTuning)[];
  /** Screen area per individual at density 1 on a laptop-sized screen (see REFERENCE_SIZE), px². */
  area: number;
  /** Most individuals the flock will hold. */
  max?: number;
  /** Size of the nearest at size 1, relative to the shared base (a fifth of the screen's short side). */
  scale: number;
  /** Cruising speed of the nearest at speed 1, px/s. */
  speed: number;
  /** Trail colour per theme. */
  trail: { light: RGB; dark: RGB };

  /** Add this animal's own fields to a fresh creature. */
  create(c: Creature, flock: Flock<C>): C;
  /** A creature has just been placed at the upstream edge (or anywhere, when seeding). */
  enter?(c: C, flock: Flock<C>): void;
  /** Once per step, before any individual moves. */
  prepare?(flock: Flock<C>, dt: number): void;
  update(c: C, flock: Flock<C>, dt: number): void;
  /** Take the click itself (e.g. dropping food), instead of startling the creatures near it. */
  tap?(x: number, y: number, flock: Flock<C>): void;
  /** React to a click; (dx, dy) points away from it and strength fades 1 → 0 with distance. */
  startle?(c: C, dx: number, dy: number, strength: number, flock: Flock<C>): void;
  /** Draw one creature. */
  draw?(c: C, pen: Pen, flock: Flock<C>): void;
  /** Draw the whole flock at once instead, for animals drawn as a crowd. */
  drawAll?(flock: Flock<C>, pen: Pen): void;
}

export interface WorldEvent {
  x: number;
  y: number;
  /** In cells. */
  radius: number;
  amount: number;
}

const STARTLE_RADIUS = 240;
/**
 * Size of the nearest individuals (before an animal's own scale) on a laptop-sized screen, about
 * 800px on the short side, px. Populations are tuned at this size; smaller screens draw everyone
 * smaller and spawn more to cover the same share of the screen.
 */
const REFERENCE_SIZE = 160;

export class Flock<C extends Creature = Creature> {
  width = 0;
  height = 0;
  time = 0;
  creatures: C[] = [];
  events: WorldEvent[] = [];
  /** Size of the nearest individuals at size 1, px. */
  base = 120;
  /** Scratch acceleration the steering helpers add into. */
  readonly acc = { x: 0, y: 0 };
  /** The pointer, shared with the engine (see AnimalEngine.wire()). */
  pointer: PointerState = { x: 0, y: 0, vx: 0, vy: 0, stir: 0, inside: false };
  /** Where creatures may land (see Perch). Empty under reduced motion. */
  perches: Perch[] = [];
  /** When something last shooed perched creatures off (typing, a resize); nothing lands until quietUntil. */
  disturbedAt = -Infinity;
  quietUntil = 0;
  /** Height of one renderer cell, px, so landings can line up with the grid. */
  cellH = 18;

  private nextId = 1;
  /** Fractional retirements carried between steps. */
  private retireDebt = 0;

  /** count pins the population, overriding tuning.density. */
  constructor(readonly animal: Animal<C>, readonly tuning: Tuning, private count?: number) {}

  resize(width: number, height: number) {
    const first = this.width === 0;
    this.width = width;
    this.height = height;
    this.base = clamp(Math.min(width, height) * 0.2, 80, 190) * this.animal.scale;
    if (first) this.populate(true);
  }

  /** Course in radians (screen space, y down). */
  get course() {
    const k = this.tuning;
    return k.corner ? Math.atan2(-this.height, this.width) : (-k.direction * Math.PI) / 180;
  }

  /** The course with the whole stream's slow sway applied. */
  get heading() {
    const t = this.time;
    return this.course + this.tuning.sway * (Math.sin(t * 0.13) + 0.5 * Math.sin(t * 0.31 + 1.7));
  }

  /**
   * How many to keep on screen. By how much of the screen they cover, not by raw area: on a small
   * screen each one draws smaller (see base), so more of them spawn to make up for it, and a phone
   * looks as lively as a laptop. `area` is screen area per individual at the reference size.
   */
  get target() {
    const { width: W, height: H, animal } = this;
    const shrink = (this.base / animal.scale / REFERENCE_SIZE) ** 2;
    return this.count ?? clamp(Math.round(((W * H) / (animal.area * shrink)) * this.tuning.density), 1, animal.max ?? 200);
  }

  depthOf(roll: number) {
    const k = this.tuning;
    return k.farthest + (1 - k.farthest) * Math.pow(roll, k.farBias);
  }

  /** Parallax: far individuals cover less screen per second. */
  cruise(c: Creature) {
    return this.animal.speed * (0.55 + 0.45 * c.depth) * this.tuning.speed;
  }

  /** Shoo off anything that has landed, and let nothing land for `quiet` seconds. */
  disturb(quiet = 6) {
    this.disturbedAt = this.time;
    this.quietUntil = this.time + quiet;
  }

  /** Click: everything nearby reacts, then rejoins the stream (or the animal takes the tap itself). */
  startle(x: number, y: number) {
    if (this.animal.tap) {
      this.animal.tap(x, y, this);
      return;
    }
    this.events.push({ x, y, radius: 6, amount: 1.4 });
    for (const c of this.creatures) {
      const dx = c.x - x;
      const dy = c.y - y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > STARTLE_RADIUS) continue;
      const strength = 1 - d / STARTLE_RADIUS;
      if (this.animal.startle) {
        this.animal.startle(c, dx / d, dy / d, strength, this);
      } else {
        const k = strength * 420 * c.depth;
        c.vx += (dx / d) * k;
        c.vy += (dy / d) * k;
        c.startledUntil = this.time + rand(0.6, 1.2);
      }
    }
  }

  step(dt: number) {
    this.time += dt;
    this.populate(false, dt);
    for (const c of this.creatures) {
      c.depth = this.depthOf(c.roll);
      c.span = this.base * c.depth * this.tuning.size;
      if (c.leaving) {
        c.vanish = Math.min(1, c.vanish + dt / 2);
        if (c.vanish >= 1) c.gone = true;
      } else if (c.vanish > 0) {
        c.vanish = Math.max(0, c.vanish - dt / 1.2);
      }
    }
    this.sweep();
    this.animal.prepare?.(this, dt);
    for (const c of this.creatures) this.animal.update(c, this, dt);
    this.sweep();
  }

  /** Drop everything marked gone. */
  private sweep() {
    if (this.creatures.some((c) => c.gone)) this.creatures = this.creatures.filter((c) => !c.gone);
  }

  /**
   * Bring the population toward the target. Seeding fills (or trims) at once; after that, newcomers
   * fade in and the surplus is retired a few at a time, farthest first, so nobody pops in or out.
   */
  private populate(scatter: boolean, dt = 0) {
    const target = this.target;
    let active = 0;
    for (const c of this.creatures) if (!c.leaving) active++;

    if (active > target) {
      if (scatter) {
        for (const c of this.creatures) c.gone = true;
        this.sweep();
        active = 0;
      } else {
        this.retireDebt += ((active - target) * dt) / 1.5;
        for (; this.retireDebt >= 1 && active > target; this.retireDebt--, active--) this.retireOne();
        return;
      }
    }
    this.retireDebt = 0;
    // Short of the target: call back any that were on their way out first.
    for (const c of this.creatures) {
      if (active >= target) break;
      if (c.leaving) {
        c.leaving = false;
        active++;
      }
    }
    for (; active < target; active++) {
      const c = this.spawn();
      if (scatter || Math.random() < 0.5) {
        // Seeding (or growing the flock): drop it in anywhere so the screen fills at once.
        c.x = rand(0, this.width);
        c.y = rand(0, this.height);
        if (!scatter) c.vanish = 1;
        this.animal.enter?.(c, this);
      }
      this.insert(c);
    }
  }

  /** Retire the farthest of a few at random: far ones are already faint, so their fade goes unnoticed. */
  private retireOne() {
    let pick: C | null = null;
    for (let i = 0; i < 5; i++) {
      const c = this.creatures[Math.floor(Math.random() * this.creatures.length)];
      if (!c.leaving && (!pick || c.depth < pick.depth)) pick = c;
    }
    pick ??= this.creatures.find((c) => !c.leaving) ?? null;
    if (pick) pick.leaving = true;
  }

  /** Keep farther individuals first so the near ones draw over them. */
  insert(c: C) {
    const at = this.creatures.findIndex((o) => o.roll > c.roll);
    this.creatures.splice(at < 0 ? this.creatures.length : at, 0, c);
  }

  private spawn(): C {
    const base: Creature = {
      id: this.nextId++,
      roll: Math.random(),
      depth: 1,
      span: 0,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      heading: 0,
      bias: 0,
      startledUntil: 0,
      leaving: false,
      vanish: 0,
      gone: false,
    };
    base.depth = this.depthOf(base.roll);
    base.span = this.base * base.depth * this.tuning.size;
    const c = this.animal.create(base, this);
    this.reenter(c);
    return c;
  }

  /** Bring a creature back in from the upstream edges, spread evenly across the flow. One on its way out just leaves. */
  reenter(c: C) {
    if (c.leaving) {
      c.gone = true;
      return;
    }
    const { width: W, height: H, course } = this;
    const m = c.span * 0.6;
    const cos = Math.cos(course);
    const sin = Math.sin(course);
    // Upstream edges: the side the stream comes from, weighted by how much of it crosses each.
    const sideways = H * Math.abs(cos);
    const vertical = W * Math.abs(sin);
    if (Math.random() * (sideways + vertical) < sideways) {
      c.x = cos >= 0 ? -m : W + m;
      c.y = rand(0, H);
    } else {
      c.x = rand(0, W);
      c.y = sin <= 0 ? H + m : -m;
    }
    const cruise = this.cruise(c);
    c.heading = course;
    c.vx = cos * cruise;
    c.vy = sin * cruise;
    c.bias = rand(-1, 1);
    this.animal.enter?.(c, this);
  }

  /** Past the downstream edges (done crossing), or lost far off any edge. */
  passed(c: Creature, margin = c.span) {
    const { width: W, height: H, course } = this;
    const cos = Math.cos(course);
    const sin = Math.sin(course);
    const out =
      (cos > 0.05 && c.x > W + margin) || (cos < -0.05 && c.x < -margin) ||
      (sin < -0.05 && c.y < -margin) || (sin > 0.05 && c.y > H + margin);
    const lost = c.x < -3 * margin || c.x > W + 3 * margin || c.y < -3 * margin || c.y > H + 3 * margin;
    return out || lost;
  }

  // ── steering helpers: each adds into this.acc ─────────────────────

  /** Clear the scratch acceleration. */
  begin() {
    this.acc.x = 0;
    this.acc.y = 0;
    return this.acc;
  }

  /** Pull the velocity toward `speed` along `dir`, as hard as `grip`. */
  steer(c: Creature, dir: number, speed: number, grip: number) {
    this.acc.x += (Math.cos(dir) * speed - c.vx) * grip;
    this.acc.y += (Math.sin(dir) * speed - c.vy) * grip;
  }

  /** Push away from neighbours at about the same depth, within `range` × their combined size. */
  separate(c: Creature, strength = this.tuning.separation, range = 0.42) {
    if (strength <= 0) return;
    for (const o of this.creatures) {
      if (o === c || Math.abs(o.depth - c.depth) > 0.18) continue;
      const ox = c.x - o.x;
      const oy = c.y - o.y;
      const d = Math.hypot(ox, oy);
      const r = (c.span + o.span) * range;
      if (d < r && d > 1e-3) {
        const w = (1 - d / r) * strength;
        this.acc.x += (ox / d) * w;
        this.acc.y += (oy / d) * w;
      }
    }
  }

  /**
   * Veer away from the moving pointer, as hard as `strength`. Looks a little ahead of the pointer,
   * dodges sideways when it heads straight for the creature, and barely touches far ones.
   */
  avoidPointer(c: Creature, strength = this.tuning.avoid, reach = 200) {
    const p = this.pointer;
    if (strength <= 0 || p.stir < 0.01 || !p.inside) return;
    const sp = Math.hypot(p.vx, p.vy);
    const lead = Math.min(90, sp * 0.12);
    const px = p.x + (sp > 1 ? (p.vx / sp) * lead : 0);
    const py = p.y + (sp > 1 ? (p.vy / sp) * lead : 0);
    const dx = c.x - px;
    const dy = c.y - py;
    const d = Math.hypot(dx, dy);
    const R = reach * (0.5 + 0.5 * c.depth) + 0.4 * c.span;
    if (d >= R) return;
    let ax = d > 1 ? dx / d : -p.vy / (sp || 1);
    let ay = d > 1 ? dy / d : p.vx / (sp || 1);
    if (sp > 30) {
      // Heading for us: step aside rather than just back away.
      const ux = p.vx / sp;
      const uy = p.vy / sp;
      // How directly the pointer is moving at us (a points from the pointer to the creature).
      const toward = Math.max(0, ux * ax + uy * ay);
      const side = Math.sign(-uy * dx + ux * dy) || 1;
      ax += -uy * side * toward * 0.8;
      ay += ux * side * toward * 0.8;
      const n = Math.hypot(ax, ay) || 1;
      ax /= n;
      ay /= n;
    }
    const w = (1 - d / R) ** 2 * strength * p.stir * c.depth ** 2 * (0.35 + 0.65 * clamp(sp / 700, 0, 1)) * AVOID_ACCEL;
    this.acc.x += ax * w;
    this.acc.y += ay * w;
  }

  /** Apply this.acc, cap the speed (startled creatures may go faster), move. Returns the speed. */
  move(c: Creature, dt: number, max: number) {
    c.vx += this.acc.x * dt;
    c.vy += this.acc.y * dt;
    let speed = Math.hypot(c.vx, c.vy);
    const cap = max + (this.time < c.startledUntil ? 300 : 0);
    if (speed > cap) {
      c.vx *= cap / speed;
      c.vy *= cap / speed;
      speed = cap;
    }
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    return speed;
  }

  /** Turn to face the direction of travel, at most `rate` rad/s. */
  face(c: Creature, dt: number, rate = 7, angle = Math.atan2(c.vy, c.vx)) {
    const turn = rate * dt;
    c.heading += clamp(angleDiff(c.heading, angle), -turn, turn);
  }
}
