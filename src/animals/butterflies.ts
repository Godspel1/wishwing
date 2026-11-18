/**
 * Blue morpho butterflies on migration.
 *
 * Wings are seen from above. Each lobe (forewing, hindwing) is a fan in polar
 * coordinates around its root on the body, so an outline is just a radius per
 * angle, and the paint gets a point in lobe space (t across the fan, r from
 * root to margin): margins are high r, spots repeat across t. Raised wings
 * are foreshortened across the body, so the sampler unfolds v by how open
 * the wings are before testing the outline; that one division is the flap.
 *
 * Flight: hold the course, plus a flutter (a random walk that decays back to
 * zero), a thrust pulse on every downstroke, and now and then a glide with
 * the wings held flat. Now and then one lands on the page (see below).
 */
import { SHARED_TUNING, type Animal, type Creature, type Flock, type Perch } from "../flock";
import { INK_BODY, INK_DARK, INK_SCALE, INK_SHIMMER, INK_SPOT, ink, type Ink } from "../ink";
import { angleDiff, clamp, frac, rand, smoothstep, TAU } from "../math";

interface Lobe {
  /** Angle range in radians: 0 points straight out sideways, positive sweeps toward the head. */
  from: number;
  to: number;
  /** Longest radius, as a fraction of wingspan. */
  reach: number;
  /** Where across [from, to] (0–1) the reach peaks. */
  peak: number;
  /** <1 gives a blunt, rounded fan; >1 a pointed one. */
  round: number;
  /** Depth of a wavy (scalloped) margin; 0 for a smooth edge. */
  scallop: number;
}

const FORE: Lobe = { from: -0.3, to: 1.0, reach: 0.56, peak: 0.55, round: 0.5, scallop: 0 };
const HIND: Lobe = { from: -1.45, to: 0.15, reach: 0.44, peak: 0.48, round: 0.42, scallop: 0.04 };
/** Where each wing pair joins the body, as a fraction of span ahead of the centre. */
const FORE_ROOT = 0.06;
const HIND_ROOT = -0.02;
const BODY: [number, number, number] = [30, 30, 42];
/** Eyespots on the underside: [0 forewing / 1 hindwing, t across the fan, r out from the root]. */
const EYESPOTS: [number, number, number][] = [[0, 0.5, 0.62], [1, 0.3, 0.56], [1, 0.66, 0.6]];

/** A wing's underside, seen when it sits with them folded: warm browns, an ochre line, dark margins, ringed eyespots. */
function paintUnderside(out: Ink, part: number, t: number, r: number) {
  if (r > 0.9) return ink(out, 62, 42, 28, INK_DARK);
  for (const [sp, st, sr] of EYESPOTS) {
    if (sp !== part) continue;
    const d = Math.hypot((t - st) * 2.2, r - sr);
    if (d < 0.06) return ink(out, 238, 228, 200, INK_SPOT);
    if (d < 0.12) return ink(out, 38, 28, 20, INK_DARK);
    if (d < 0.18) return ink(out, 214, 168, 74, INK_SCALE);
  }
  if (r < 0.1) return ink(out, 72, 52, 36, INK_DARK);
  if (Math.abs(r - 0.42) < 0.035) return ink(out, 176, 136, 80, INK_SCALE);
  return ink(out, 112 + 34 * r, 80 + 22 * r, 52 + 10 * r, INK_SCALE);
}
const FLAP_HZ = 2.6;
const GLIDE = 0.35;
const FLUTTER = 1.3;

/** Lobe radius at angle phi, or 0 outside its fan. */
function lobeReach(l: Lobe, phi: number, t = (phi - l.from) / (l.to - l.from)) {
  if (t <= 0 || t >= 1) return 0;
  const s = t < l.peak ? (t / l.peak) * 0.5 : 0.5 + ((t - l.peak) / (1 - l.peak)) * 0.5;
  const R = l.reach * Math.pow(Math.sin(Math.PI * s), l.round);
  return l.scallop ? R * (1 - l.scallop * (0.5 + 0.5 * Math.cos(t * Math.PI * 14))) : R;
}

/** Body half-width at u (fraction of span, + toward the head): round head, thorax, tapering abdomen. */
function bodyHalfWidth(u: number) {
  if (u > 0.17 || u < -0.32) return 0;
  if (u > 0.11) return Math.sqrt(Math.max(0, 0.03 * 0.03 - (u - 0.14) ** 2));
  if (u > -0.04) return 0.034;
  return 0.03 * (1 - 0.6 * ((-0.04 - u) / 0.28));
}

/** Where a point falls in a lobe, or null outside it. */
const lobe = { t: 0, r: 0 };
function inLobe(l: Lobe, du: number, vw: number) {
  const phi = Math.atan2(du, vw);
  const t = (phi - l.from) / (l.to - l.from);
  const R = lobeReach(l, phi, t);
  const r = Math.hypot(du, vw);
  if (r > R) return false;
  lobe.t = t;
  lobe.r = r / R;
  return true;
}

/*
 * Landing. Now and then a near butterfly picks a free spot on a ledge (the top of the search box or
 * the clock) and flies over. As it touches down it turns side-on, as you'd see a butterfly resting
 * on a ledge at eye level: body level along the edge, standing on its legs, wings folded together
 * straight up, showing their brown, eye-spotted undersides. Now and then it flexes them. It takes
 * off when the user types, the pointer comes close, it's clicked, its spot stops fitting, or after
 * a while. Which spots are taken is read off the flock itself, so nothing can go stale.
 */
const FLY = 0;
const APPROACH = 1;
const DESCEND = 2;
const PERCHED = 3;
const LEAVE = 4;
/** Heading of a butterfly sitting upright: head up the screen. */
const UP = -Math.PI / 2;
/** Only butterflies at least this near land, so they look about the size of the page they sit on. */
const NEAR = 0.55;
/** Most that may be landing or landed at once. */
const CAP = 3;
/** Landings per second at Landing 1, while someone is free to land (three times that just after opening). */
const LAND_RATE = 0.35;
/** Body centre above the ledge while sitting: half the body plus the legs, in span units. */
const LEG = 0.1;

/** The wing outline's extent in body units (fractions of span), measured from the lobes once. */
const { HIND_DROP, TOP_REACH, WING_HALF } = (() => {
  let minU = -0.32; // tip of the abdomen
  let maxU = 0.39; // tips of the feelers
  let maxV = 0;
  for (const [l, root] of [[FORE, FORE_ROOT], [HIND, HIND_ROOT]] as const) {
    for (let k = 1; k < 240; k++) {
      const phi = l.from + ((l.to - l.from) * k) / 240;
      const R = lobeReach(l, phi);
      minU = Math.min(minU, root + R * Math.sin(phi));
      maxU = Math.max(maxU, root + R * Math.sin(phi));
      maxV = Math.max(maxV, R * Math.cos(phi));
    }
  }
  return { HIND_DROP: -minU, TOP_REACH: maxU, WING_HALF: maxV };
})();
/** Half the length of a sitting butterfly, head to tail, wings folded (span units). */
const HALF_LEN = Math.max(TOP_REACH, HIND_DROP);

interface Butterfly extends Creature {
  /** Wingbeat phase. */
  phase: number;
  /** How flat the wings are seen from above: ~0.1 raised together → 1 spread open. */
  open: number;
  /** 0 flapping → 1 gliding. */
  glide: number;
  glideUntil: number;
  flutterX: number;
  flutterY: number;
  /** FLY, APPROACH, DESCEND, PERCHED or LEAVE. */
  mode: number;
  /** The ledge it's headed for or sitting on ("" when flying). */
  perchId: string;
  /** Its spot on that ledge, px. */
  perchX: number;
  /** The ledge's height when it picked the spot, to notice the ledge moving. */
  perchEdge: number;
  /** When it picked the spot (anything disturbing after that sends it off). */
  claimAt: number;
  /** When the current mode began. */
  modeAt: number;
  /** Perched: leaves then. Flying: won't land again before then. */
  restUntil: number;
  /** A slight tilt while sitting. */
  lean: number;
  /** Resting clock: now and then the folded wings flex. */
  bask: number;
  /** 0 seen from above, flying → 1 seen side-on, sitting with its wings folded up. */
  fold: number;
  /** Which way it faces while sitting: 0 right, π left. */
  face: number;
  /** Height of the folded wings seen side-on (dips when they flex). */
  lift: number;
  /** The ledge under its feet, px (for drawing the legs). */
  ground: number;
}

type Flock$ = Flock<Butterfly>;

/** The ledge's edge snapped to the cell grid, so the feet meet it rather than hover a part-cell above. */
function groundY(flock: Flock$, perch: Perch) {
  const ch = flock.cellH;
  const rowTop = Math.floor(perch.y / ch) * ch;
  return perch.y - rowTop > 0.4 * ch ? rowTop + ch : rowTop;
}

/** Body centre for sitting on a ledge: standing on its legs on the edge. */
function seatY(flock: Flock$, perch: Perch, S: number) {
  return groundY(flock, perch) - LEG * S;
}

/** Could a butterfly of span S sit at x on this ledge, clear of the keep-outs and the others there? */
function fits(flock: Flock$, perch: Perch, self: Butterfly, S: number, x: number) {
  if (x < perch.x0 + 0.1 * S || x > perch.x1 - 0.1 * S) return false;
  if (perch.y - (LEG + WING_HALF) * S < 4) return false;
  const half = HALF_LEN * S;
  for (const [k0, k1] of perch.keepOut ?? []) {
    if (x + half + 8 > k0 && x - half - 8 < k1) return false;
  }
  for (const o of flock.creatures) {
    if (o === self || o.perchId !== perch.id || o.mode === FLY || o.mode === LEAVE) continue;
    if (Math.abs(x - o.perchX) < HALF_LEN * (S + o.span) + 10) return false;
  }
  return true;
}

/** The free spot on this ledge nearest to the butterfly, or null. */
function findSlot(flock: Flock$, perch: Perch, b: Butterfly) {
  const tries = [clamp(b.x, perch.x0, perch.x1)];
  for (let k = 0; k <= 6; k++) tries.push(perch.x0 + ((perch.x1 - perch.x0) * k) / 6);
  let best: number | null = null;
  for (const x of tries) {
    if (fits(flock, perch, b, b.span, x) && (best === null || Math.abs(x - b.x) < Math.abs(best - b.x))) best = x;
  }
  return best;
}

const landing = (b: Butterfly) => b.mode === APPROACH || b.mode === DESCEND || b.mode === PERCHED;

/** Lift off a ledge (or give up on reaching it), pushed along (ax, ay) but never down into the page. */
function takeOff(b: Butterfly, flock: Flock$, ax = 0, ay = -1, burst = true) {
  const t = flock.time;
  if (burst) {
    ay = Math.min(ay, -0.4);
    const n = Math.hypot(ax, ay) || 1;
    const up = 1.6 * flock.cruise(b);
    b.vx += (ax / n) * up + rand(-0.3, 0.3) * flock.cruise(b);
    b.vy += (ay / n) * up;
    b.startledUntil = t + 0.6;
    b.phase = 0;
  }
  b.mode = LEAVE;
  b.modeAt = t;
  b.perchId = "";
  b.restUntil = t + rand(20, 40);
  b.glideUntil = 0;
  b.glide = 0;
}

/** Should a landing or landed butterfly give up its spot now? Returns the push direction, or null to stay. */
function shooed(b: Butterfly, flock: Flock$, perch: Perch | undefined): [number, number] | null {
  const k = flock.tuning as typeof DEFAULTS;
  const p = flock.pointer;
  if (p.inside && p.stir > 0.15) {
    const dx = b.x - p.x;
    const dy = b.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d < 120 + 0.3 * b.span) return [dx / (d || 1), dy / (d || 1)];
  }
  const stale =
    !perch ||
    Math.abs(perch.y - b.perchEdge) > 2 ||
    !fits(flock, perch, b, b.span, b.perchX) ||
    b.depth < NEAR - 0.05 ||
    b.leaving ||
    flock.disturbedAt > b.claimAt ||
    k.landing <= 0 ||
    (b.mode === PERCHED && flock.time > b.restUntil);
  return stale ? [rand(-0.3, 0.3), -1] : null;
}

const DEFAULTS = {
  ...SHARED_TUNING,
  density: 1.05,
  speed: 1.05,
  sway: 0,
  spread: 0,
  size: 1.25,
  farthest: 0.18,
  farBias: 1.7,
  grip: 5,
  separation: 700,
  trail: 1.55,
  trailFade: 0.15,
  flutter: 0,
  glide: 2.75,
  flapRate: 1,
  landing: 1,
};

export const butterflies: Animal<Butterfly> = {
  key: "butterflies",
  label: "Butterflies",
  swatch: [50, 135, 255],
  defaults: DEFAULTS,
  controls: [
    ["Flight", [
      { key: "flutter", label: "Flutter", min: 0, max: 3, step: 0.05, hint: "How much their path zigzags." },
      { key: "glide", label: "Glide", min: 0, max: 4, step: 0.05, hint: "How often they stop flapping and glide with wings held flat." },
      { key: "flapRate", label: "Flap rate", min: 0.2, max: 3, step: 0.05, hint: "How fast their wings beat." },
      { key: "landing", label: "Landing", min: 0, max: 3, step: 0.05, hint: "How often they land on the clock and the search box. 0 never." },
    ]],
  ],
  area: 48000,
  scale: 1,
  speed: 90,
  trail: { light: [70, 118, 226], dark: [96, 156, 255] },

  create: (c) => ({
    ...c, phase: rand(0, TAU), open: 1, glide: 0, glideUntil: 0, flutterX: 0, flutterY: 0,
    mode: FLY, perchId: "", perchX: 0, perchEdge: 0, claimAt: 0, modeAt: 0, restUntil: rand(0.5, 2.5), lean: 0, bask: 0,
    fold: 0, face: 0, lift: 1, ground: 0,
  }),

  enter(b) {
    b.flutterX = 0;
    b.flutterY = 0;
    b.mode = FLY;
    b.perchId = "";
    b.fold = 0;
  },

  /** Now and then, send the best-placed free butterfly to a spot on a ledge. */
  prepare(flock, dt) {
    const k = flock.tuning as typeof DEFAULTS;
    const t = flock.time;
    if (!flock.perches.length || t < flock.quietUntil || k.landing <= 0) return;
    let busy = 0;
    let active = 0;
    for (const c of flock.creatures) {
      if (!c.leaving) active++;
      if (landing(c)) busy++;
    }
    if (busy >= Math.min(CAP, Math.max(2, Math.floor(active * 0.15)))) return;
    // Busier just after the tab opens, so there's a fair chance to see one land.
    if (Math.random() > LAND_RATE * k.landing * (t < 8 ? 3 : 1) * dt) return;

    const p = flock.pointer;
    let pick: { b: Butterfly; perch: Perch; x: number } | null = null;
    let bestCost = Infinity;
    for (const b of flock.creatures) {
      if (b.mode !== FLY || b.leaving || b.vanish > 0 || b.depth < NEAR) continue;
      if (t < b.restUntil || t < b.startledUntil) continue;
      if (b.x < 0 || b.x > flock.width || b.y < 0 || b.y > flock.height) continue;
      if (p.inside && Math.hypot(b.x - p.x, b.y - p.y) < 120) continue;
      for (const perch of flock.perches) {
        const x = findSlot(flock, perch, b);
        if (x === null) continue;
        const wy = seatY(flock, perch, b.span) - 0.6 * b.span;
        const d = Math.hypot(x - b.x, wy - b.y);
        // Only ones already close by, so a landing is over in a few seconds.
        if (d > 0.28 * Math.max(flock.width, flock.height)) continue;
        const away = Math.cos(angleDiff(b.heading, Math.atan2(wy - b.y, x - b.x))) < 0;
        const cost = d * (away ? 2 : 1);
        if (cost < bestCost) {
          bestCost = cost;
          pick = { b, perch, x };
        }
      }
    }
    if (!pick) return;
    const { b, perch, x } = pick;
    b.mode = APPROACH;
    b.perchId = perch.id;
    b.perchX = x;
    b.perchEdge = perch.y;
    b.claimAt = t;
    b.modeAt = t;
    b.lean = rand(-0.04, 0.04);
  },

  update(b, flock, dt) {
    const k = flock.tuning as typeof DEFAULTS;
    const t = flock.time;
    const cruise = flock.cruise(b);
    const S = b.span;

    if (landing(b)) {
      const perch = flock.perches.find((p) => p.id === b.perchId);
      const push = shooed(b, flock, perch);
      if (push) takeOff(b, flock, push[0], push[1], b.mode !== APPROACH);
    }

    // Fold side-on while touching down and sitting, unfold to fly.
    const foldTo = b.mode === PERCHED ? 1 : b.mode === DESCEND ? b.fold : 0;
    b.fold += (foldTo - b.fold) * Math.min(1, dt * (b.mode === LEAVE ? 8 : 4));

    if (b.mode === PERCHED) {
      // Sitting: pinned to the seat (which follows any change of size), wings folded up, resting.
      const perch = flock.perches.find((p) => p.id === b.perchId)!;
      b.x = b.perchX;
      b.y = seatY(flock, perch, S);
      b.ground = groundY(flock, perch);
      b.vx = 0;
      b.vy = 0;
      b.heading = b.face + b.lean + 0.015 * Math.sin(0.6 * t + b.id);
      // Every so often the folded wings part a little and close again.
      b.bask += dt * (0.32 + 0.1 * Math.sin(0.19 * t + b.id));
      const w = 0.5 - 0.5 * Math.cos(b.bask);
      b.lift += (1 - 0.22 * smoothstep(0.75, 1, w) - b.lift) * Math.min(1, 4 * dt);
      b.open = 0.1;
      b.glide = 1;
      return;
    }

    const acc = flock.begin();
    let flutterK = 1;
    let thrustK = 1;
    let separateK = 1;
    let faceSide = false;

    if (b.mode === APPROACH) {
      // Fly to a point just above the spot, slowing on arrival.
      const perch = flock.perches.find((p) => p.id === b.perchId)!;
      const wx = b.perchX;
      const wy = seatY(flock, perch, S) - 0.6 * S;
      const d = Math.hypot(wx - b.x, wy - b.y);
      flock.steer(b, Math.atan2(wy - b.y, wx - b.x), Math.min(1.7 * cruise, (cruise * d) / (0.6 * S)), 3);
      flutterK = 0.3;
      if (d < 0.5 * S || (b.y < wy && Math.abs(b.x - wx) < 0.5 * S)) {
        b.mode = DESCEND;
        b.modeAt = t;
        // Sit facing the way it was heading along the ledge.
        b.face = Math.abs(b.vx) > 4 ? (b.vx > 0 ? 0 : Math.PI) : Math.random() < 0.5 ? 0 : Math.PI;
      } else if (t - b.modeAt > 10) {
        takeOff(b, flock, 0, -1, false);
      }
    } else if (b.mode === DESCEND) {
      // Settle onto the seat slowly, turning side-on and folding the wings up as it gets close.
      const perch = flock.perches.find((p) => p.id === b.perchId)!;
      const sy = seatY(flock, perch, S);
      const d = Math.hypot(b.perchX - b.x, sy - b.y);
      flock.steer(b, Math.atan2(sy - b.y, b.perchX - b.x), Math.min(0.7 * cruise, (cruise * d) / (0.25 * S)), 5);
      flutterK = 0.2;
      thrustK = 0.3;
      separateK = 0.3;
      faceSide = true;
      b.glideUntil = 0;
      b.fold = Math.max(b.fold, smoothstep(1.2 * S, 0.15 * S, d));
      b.lift = 1;
      b.ground = groundY(flock, perch);
      if ((d < Math.max(3, 0.04 * S) && Math.hypot(b.vx, b.vy) < 0.4 * cruise) || t - b.modeAt > 2.5) {
        b.x = b.perchX;
        b.y = sy;
        b.vx = 0;
        b.vy = 0;
        b.mode = PERCHED;
        b.modeAt = t;
        b.restUntil = t + rand(15, 45);
        b.bask = Math.PI / 2;
        return;
      }
    } else if (b.mode === LEAVE) {
      // Lift away upward, easing back onto the stream's course.
      const s = smoothstep(0, 1.2, t - b.modeAt);
      flock.steer(b, UP + angleDiff(UP, flock.heading + b.bias * k.spread) * s, cruise, k.grip);
      b.ground = 0;
      if (t - b.modeAt > 1.2) b.mode = FLY;
    } else {
      flock.steer(b, flock.heading + b.bias * k.spread, cruise, k.grip);
    }

    // Flutter: a random walk that keeps decaying back to zero, so the path
    // zigzags without drifting. Gliding calms it; distance shrinks it.
    const kick = Math.sqrt(dt) * 520 * FLUTTER * k.flutter * flutterK * (1 - 0.8 * b.glide) * (0.5 + 0.5 * b.depth);
    b.flutterX += -b.flutterX * 3 * dt + (Math.random() * 2 - 1) * kick;
    b.flutterY += -b.flutterY * 3 * dt + (Math.random() * 2 - 1) * kick;
    acc.x += b.flutterX;
    acc.y += b.flutterY;

    // Every downstroke shoves the butterfly forward a little.
    const down = Math.max(0, -Math.sin(b.phase)) * (1 - b.glide) * thrustK;
    acc.x += Math.cos(b.heading) * down * cruise * 1.4;
    acc.y += Math.sin(b.heading) * down * cruise * 1.4;

    if (b.mode !== DESCEND) flock.avoidPointer(b);
    flock.separate(b, k.separation * separateK);
    const speed = flock.move(b, dt, cruise * 2.2);
    if (flock.passed(b)) flock.reenter(b);
    if (faceSide) flock.face(b, dt, 3, b.face + b.lean);
    else if (speed > 12) flock.face(b, dt);

    if (b.mode === FLY && b.glide < 0.5 && t > b.glideUntil && speed > cruise * 0.5 && Math.random() < GLIDE * k.glide * dt) {
      b.glideUntil = t + rand(0.5, 1.4);
    }
    b.glide += ((t < b.glideUntil ? 1 : 0) - b.glide) * Math.min(1, dt * 6);
    const urgency = clamp(speed / (cruise * 2), 0, 1);
    b.phase += dt * TAU * FLAP_HZ * k.flapRate * (0.8 + 0.6 * urgency) * (1 - 0.9 * b.glide);
    const beat = Math.pow(0.5 + 0.5 * Math.cos(b.phase), 0.8);
    b.open = (0.1 + 0.9 * (beat * (1 - b.glide) + 0.96 * b.glide)) * (1 - 0.9 * b.fold);
  },

  startle(b, dx, dy, strength, flock) {
    if (landing(b)) {
      takeOff(b, flock, dx, dy);
      return;
    }
    const k = strength * 420 * b.depth;
    b.vx += dx * k;
    b.vy += dy * k;
    b.startledUntil = flock.time + rand(0.6, 1.2);
    b.glideUntil = 0;
  },

  draw(b, pen) {
    if (b.vanish >= 0.99) return;
    const S = b.span;
    const open = Math.max(0.08, b.open);
    const fold = b.fold;
    const ink$ = pen.ink;
    // The body yaws a touch with each beat (not once it's settling).
    const yaw = fold > 0.05 ? 0 : 0.06 * Math.sin(b.phase);
    const pose = { x: b.x, y: b.y, heading: b.heading + yaw, span: S, depth: b.depth, id: b.id, vanish: b.vanish };
    const minBody = pen.cw * 0.4;
    // Side-on, one side of the body is "up" the screen: the folded wings stand there; the other side's
    // wing folds away behind them. Seen from above (fold 0) both sides show equally.
    const up = Math.cos(pose.heading) >= 0 ? -1 : 1;
    const upScale = open + (b.lift - open) * fold;
    const downScale = open * (1 - fold);
    const underside = fold > 0.5;

    pen.shape(pose, 0.75, (u, v) => {
      const av = Math.abs(v);
      const bw = bodyHalfWidth(u);
      if (bw > 0 && av * S <= Math.max(bw * S, minBody)) {
        ink(ink$, ...BODY, INK_BODY);
        return true;
      }
      const scale = Math.sign(v) === up ? upScale : downScale;
      if (scale < 0.03) return false;
      const vw = av / scale;
      let part: number;
      if (inLobe(FORE, u - FORE_ROOT, vw)) part = 0;
      else if (inLobe(HIND, u - HIND_ROOT, vw)) part = 1;
      else return false;
      const { t, r } = lobe;
      if (underside) return paintUnderside(ink$, part, t, r);
      // Black margin with white spots on the forewing, dark roots and leading edge, shimmering blue.
      if (r > 0.86) {
        if (part === 0 && r < 0.95 && Math.abs(frac(t * 5) - 0.5) < 0.14) ink(ink$, 236, 240, 255, INK_SPOT);
        else ink(ink$, 22, 28, 62, INK_DARK);
      } else if (r < 0.08) ink(ink$, 26, 44, 110, INK_DARK);
      else if (part === 0 && t > 0.9) ink(ink$, 30, 50, 120, INK_DARK);
      else ink(ink$, 50 + 70 * r, 135 + 60 * r, 255, INK_SHIMMER);
      return true;

    }, { light: underside ? 0.9 : 0.6 + 0.4 * b.open, tilt: b.open * 3 });

    // Feelers with clubbed tips: one each side from above, both pointing forward and up side-on.
    const sway = 0.012 * Math.sin(pen.t * 3 + b.id);
    for (const side of [-1, 1]) {
      const reach = underside ? up * (side < 0 ? 0.08 : 0.13) + sway * up : (0.12 + sway) * side;
      pen.lineBody(pose, 0.16, underside ? 0.02 * up : 0.012 * side, 0.37 + sway, reach, pen.contrast, S > 120 ? "o" : undefined);
    }

    // Sitting: three thin legs down to the ledge.
    if (fold > 0.7 && b.ground > 0) {
      const at = { x: 0, y: 0 };
      for (const u of [0.11, 0.05, -0.01]) {
        pen.toWorld(pose, u, 0, at);
        const reachX = Math.cos(pose.heading) * (u - 0.04) * S * 0.6;
        pen.line(at.x, at.y, at.x + reachX, b.ground - 1, pen.contrast, b.depth);
      }
    }

    // Downstrokes shed scales from the forewing tips (nothing once it's settling).
    if (fold > 0.5) return;
    const stroke = Math.max(0, -Math.sin(b.phase)) * (1 - b.glide);
    const phi = FORE.from + (FORE.to - FORE.from) * FORE.peak;
    const tipU = FORE_ROOT + Math.sin(phi) * FORE.reach * 0.95;
    const tipV = Math.cos(phi) * FORE.reach * 0.95 * b.open;
    const at = { x: 0, y: 0 };
    for (const side of [-1, 1]) {
      pen.toWorld(pose, tipU, tipV * side, at);
      pen.shed(at.x, at.y, (0.02 + 0.1 * stroke) * b.depth * (1 - b.vanish));
    }
  },
};
