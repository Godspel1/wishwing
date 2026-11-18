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
import { INK_BODY, INK_DARK, INK_SHIMMER, INK_SPOT, ink } from "../ink";
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
 * the clock), flies over, settles upright on it and basks, wings slowly opening and closing. It
 * takes off when the user types, the pointer comes close, it's clicked, its spot stops fitting,
 * or after a while. Which spots are taken is read off the flock itself, so nothing can go stale.
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
/** Landings per second at Landing 1, while someone is free to land. */
const LAND_RATE = 0.12;
/** How far the wings open while basking (for spacing them out on a ledge). */
const PERCH_OPEN = 0.75;

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
  /** A slight tilt off upright while sitting. */
  lean: number;
  /** Basking clock: wings open and close as it turns. */
  bask: number;
}

type Flock$ = Flock<Butterfly>;

/**
 * Body centre for sitting on a ledge: the lowest wing point on the edge, snapped to the cell grid.
 * It would rather dip a little into the ledge (feet on it) than hover visibly above it.
 */
function seatY(flock: Flock$, perch: Perch, S: number) {
  const ch = flock.cellH;
  const rowTop = Math.floor(perch.y / ch) * ch;
  const edge = perch.y - rowTop > 0.4 * ch ? rowTop + ch : rowTop;
  return edge - HIND_DROP * S;
}

/** Could a butterfly of span S sit at x on this ledge, clear of the keep-outs and the others there? */
function fits(flock: Flock$, perch: Perch, self: Butterfly, S: number, x: number) {
  if (x < perch.x0 + 0.15 * S || x > perch.x1 - 0.15 * S) return false;
  if (perch.y - (HIND_DROP + TOP_REACH) * S < 4) return false;
  const half = WING_HALF * PERCH_OPEN * S;
  for (const [k0, k1] of perch.keepOut ?? []) {
    if (x + half + 10 > k0 && x - half - 10 < k1) return false;
  }
  for (const o of flock.creatures) {
    if (o === self || o.perchId !== perch.id || o.mode === FLY || o.mode === LEAVE) continue;
    if (Math.abs(x - o.perchX) < WING_HALF * PERCH_OPEN * (S + o.span) + 12) return false;
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
  label: "Butterfly",
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
    mode: FLY, perchId: "", perchX: 0, perchEdge: 0, claimAt: 0, modeAt: 0, restUntil: rand(3, 12), lean: 0, bask: 0,
  }),

  enter(b) {
    b.flutterX = 0;
    b.flutterY = 0;
    b.mode = FLY;
    b.perchId = "";
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
    if (busy >= Math.min(CAP, Math.max(1, Math.floor(active * 0.15)))) return;
    if (Math.random() > LAND_RATE * k.landing * dt) return;

    const p = flock.pointer;
    let pick: { b: Butterfly; perch: Perch; x: number } | null = null;
    let bestCost = Infinity;
    for (const b of flock.creatures) {
      if (b.mode !== FLY || b.leaving || b.vanish > 0 || b.depth < NEAR) continue;
      if (t < b.restUntil || t < b.startledUntil) continue;
      if (b.x < 0 || b.x > flock.width || b.y < 0 || b.y > flock.height) continue;
      if (p.inside && Math.hypot(b.x - p.x, b.y - p.y) < 160) continue;
      for (const perch of flock.perches) {
        const x = findSlot(flock, perch, b);
        if (x === null) continue;
        const wy = seatY(flock, perch, b.span) - b.span;
        const d = Math.hypot(x - b.x, wy - b.y);
        if (d > 0.6 * Math.max(flock.width, flock.height)) continue;
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
    b.lean = rand(-0.08, 0.08);
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

    if (b.mode === PERCHED) {
      // Sitting: pinned to the seat (which follows any change of size), basking.
      const perch = flock.perches.find((p) => p.id === b.perchId)!;
      b.x = b.perchX;
      b.y = seatY(flock, perch, S);
      b.vx = 0;
      b.vy = 0;
      b.heading = UP + b.lean + 0.03 * Math.sin(0.7 * t + b.id);
      b.bask += dt * (0.55 + 0.25 * Math.sin(0.23 * t + b.id));
      const w = 0.5 - 0.5 * Math.cos(b.bask);
      const target = 0.12 + (PERCH_OPEN - 0.12) * smoothstep(0.1, 0.9, w);
      b.open += (target - b.open) * Math.min(1, 3 * dt);
      b.glide = 1;
      return;
    }

    const acc = flock.begin();
    let flutterK = 1;
    let thrustK = 1;
    let separateK = 1;
    let faceUp = false;

    if (b.mode === APPROACH) {
      // Fly to a point one span above the spot, slowing on arrival.
      const perch = flock.perches.find((p) => p.id === b.perchId)!;
      const wx = b.perchX;
      const wy = seatY(flock, perch, S) - S;
      const d = Math.hypot(wx - b.x, wy - b.y);
      flock.steer(b, Math.atan2(wy - b.y, wx - b.x), Math.min(1.1 * cruise, (cruise * d) / (2.5 * S)), 3);
      flutterK = 0.3;
      if (d < 0.5 * S || (b.y < wy && Math.abs(b.x - wx) < 0.5 * S)) {
        b.mode = DESCEND;
        b.modeAt = t;
      } else if (t - b.modeAt > 10) {
        takeOff(b, flock, 0, -1, false);
      }
    } else if (b.mode === DESCEND) {
      // Settle onto the seat slowly, turning upright, wings still beating.
      const perch = flock.perches.find((p) => p.id === b.perchId)!;
      const sy = seatY(flock, perch, S);
      const d = Math.hypot(b.perchX - b.x, sy - b.y);
      flock.steer(b, Math.atan2(sy - b.y, b.perchX - b.x), Math.min(0.35 * cruise, (cruise * d) / S), 4);
      flutterK = 0.2;
      thrustK = 0.5;
      separateK = 0.3;
      faceUp = true;
      b.glideUntil = 0;
      if ((d < Math.max(2, 0.03 * S) && Math.hypot(b.vx, b.vy) < 0.2 * cruise) || t - b.modeAt > 5) {
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
    if (faceUp) flock.face(b, dt, 3, UP + b.lean);
    else if (speed > 12) flock.face(b, dt);

    if (b.mode === FLY && b.glide < 0.5 && t > b.glideUntil && speed > cruise * 0.5 && Math.random() < GLIDE * k.glide * dt) {
      b.glideUntil = t + rand(0.5, 1.4);
    }
    b.glide += ((t < b.glideUntil ? 1 : 0) - b.glide) * Math.min(1, dt * 6);
    const urgency = clamp(speed / (cruise * 2), 0, 1);
    b.phase += dt * TAU * FLAP_HZ * k.flapRate * (0.8 + 0.6 * urgency) * (1 - 0.9 * b.glide);
    const beat = Math.pow(0.5 + 0.5 * Math.cos(b.phase), 0.8);
    b.open = 0.1 + 0.9 * (beat * (1 - b.glide) + 0.96 * b.glide);
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
    const ink$ = pen.ink;
    const settled = b.mode === PERCHED || b.mode === DESCEND;
    // The body yaws a touch with each beat (not while sitting still).
    const yaw = settled ? 0 : 0.06 * Math.sin(b.phase);
    const pose = { x: b.x, y: b.y, heading: b.heading + yaw, span: S, depth: b.depth, id: b.id, vanish: b.vanish };
    const minBody = pen.cw * 0.4;

    pen.shape(pose, 0.75, (u, v) => {
      const av = Math.abs(v);
      const bw = bodyHalfWidth(u);
      if (bw > 0 && av * S <= Math.max(bw * S, minBody)) {
        ink(ink$, ...BODY, INK_BODY);
        return true;
      }
      const vw = av / open;
      let part: number;
      if (inLobe(FORE, u - FORE_ROOT, vw)) part = 0;
      else if (inLobe(HIND, u - HIND_ROOT, vw)) part = 1;
      else return false;
      const { t, r } = lobe;
      // Black margin with white spots on the forewing, dark roots and leading edge, shimmering blue.
      if (r > 0.86) {
        if (part === 0 && r < 0.95 && Math.abs(frac(t * 5) - 0.5) < 0.14) ink(ink$, 236, 240, 255, INK_SPOT);
        else ink(ink$, 22, 28, 62, INK_DARK);
      } else if (r < 0.08) ink(ink$, 26, 44, 110, INK_DARK);
      else if (part === 0 && t > 0.9) ink(ink$, 30, 50, 120, INK_DARK);
      else ink(ink$, 50 + 70 * r, 135 + 60 * r, 255, INK_SHIMMER);
      return true;
    }, { light: 0.6 + 0.4 * b.open, tilt: b.open * 3 });

    // Feelers with clubbed tips.
    const sway = 0.012 * Math.sin(pen.t * 3 + b.id);
    for (const side of [-1, 1]) {
      pen.lineBody(pose, 0.16, 0.012 * side, 0.37 + sway, (0.12 + sway) * side, pen.contrast, S > 120 ? "o" : undefined);
    }

    // Downstrokes shed scales from the forewing tips (a sitting butterfly sheds nothing).
    if (b.mode === PERCHED) return;
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
