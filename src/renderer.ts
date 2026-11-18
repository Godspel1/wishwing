/**
 * Draws a Flock as a grid of ASCII cells:
 *   1. the sky (see sky.ts): a gradient with a faint cell grid, stars at night, drifting mist
 *   2. a trail field that animals shed into, diffusing and fading as dots
 *   3. the animals, through a Pen: silhouettes rasterised cell-by-cell with
 *      supersampled edges (solid cells become a block of colour with a glyph,
 *      partial cells a light edge glyph), line glyphs that follow their angle
 *      for legs and feelers, and single-glyph dots. Far animals fade into the
 *      background, and every colour turns with the Hue shift knob.
 */
import type { Animal, Flock, Tuning } from "./flock";
import { INK_BODY, INK_DARK, INK_GLASS, INK_GLOW, INK_LIT, INK_SCALE, INK_SHIMMER, INK_SPOT, type Ink, type RGB } from "./ink";
import { clamp, hash3 } from "./math";
import { mixSky, SKIES, skyColorAt, type Sky } from "./sky";

const ALPHA_LEVELS = 6;
export type Theme = "light" | "dark";

/** The plain skies the Light and Dark settings pin. */
export const THEME_SKIES: Record<Theme, Sky> = { light: SKIES.day, dark: SKIES.midnight };

const STAR_GLYPHS = "..'+*";

// Sparse glyphs on bright skin, dense glyphs in shadow.
const SCALE_RAMP = ".:;+=*%#";
const DARK_GLYPHS = "#%@";
const SPOT_GLYPHS = "o*";
const BODY_GLYPHS = "8#@";
const GLOW_RAMP = ".:+*";
const EDGE_HEAVY = ":;";
const EDGE_LIGHT = ".',`";
const SPARKLES: RGB[] = [[255, 255, 255], [228, 246, 255], [200, 244, 255]];

/** Cell is empty. */
const CELL_NONE = 0;
/** A block of colour with a glyph on top. */
const CELL_SOLID = 1;
/** A bare glyph: soft edges, glows, lines, dots. */
const CELL_SOFT = 2;

// Sub-cell sample offsets for anti-aliased silhouettes.
const SUBSAMPLES = [0.25, 0.3, 0.75, 0.3, 0.25, 0.72, 0.75, 0.72];

/** Where and how big something is drawn: a creature, or one part of it. */
export interface Pose {
  x: number;
  y: number;
  heading: number;
  /** px per unit of body coordinates. */
  span: number;
  depth: number;
  /** Seeds the glyph texture. */
  id: number;
  /** 0 fully present → 1 faded out (arriving or leaving the flock). */
  vanish?: number;
}

/**
 * Classifies one point in body coordinates (fractions of span: u forward along
 * the heading, v across to the right) and its screen position (px, py).
 * On a hit, write pen.ink and return true.
 */
export type Sampler = (u: number, v: number, px: number, py: number) => boolean;

export interface ShapeOptions {
  /** Brightness multiplier (shade, tilt, underside). */
  light?: number;
  /** Extra phase for the shimmer roll, e.g. how open the wings are. */
  tilt?: number;
  /** Overrides how far this fades into the background (default: by depth). */
  fog?: number;
}

/** Hue rotation as a 3×3 colour matrix (the same one CSS hue-rotate() uses). */
function hueMatrix(degrees: number) {
  const a = Math.cos((degrees * Math.PI) / 180);
  const s = Math.sin((degrees * Math.PI) / 180);
  return [
    0.213 + a * 0.787 - s * 0.213, 0.715 - a * 0.715 - s * 0.715, 0.072 - a * 0.072 + s * 0.928,
    0.213 - a * 0.213 + s * 0.143, 0.715 + a * 0.285 + s * 0.14, 0.072 - a * 0.072 - s * 0.283,
    0.213 - a * 0.213 - s * 0.787, 0.715 - a * 0.715 + s * 0.715, 0.072 + a * 0.928 + s * 0.072,
  ];
}

/** A light drawn this frame (a firefly): where, how far it reaches (px), how bright (0 → 1), its colour. */
export interface Light {
  x: number;
  y: number;
  r: number;
  a: number;
  color: RGB;
}

/** Fog deepened by vanish: 0 leaves it as is, 1 fades all the way into the background. */
function withVanish(fog: number, vanish = 0) {
  return vanish > 0 ? 1 - (1 - fog) * (1 - vanish) : fog;
}

const mix = (a: number, b: number, k: number) => a + (b - a) * k;
const mixRGB = (a: RGB, b: RGB, k: number): RGB => [mix(a[0], b[0], k), mix(a[1], b[1], k), mix(a[2], b[2], k)];

/** Faint cell grid, snapped to device pixels. */
export function paintGrid(
  g: CanvasRenderingContext2D, W: number, H: number, cw: number, ch: number, dpr: number, stroke = "rgba(30,34,60,0.07)",
) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.strokeStyle = stroke;
  g.lineWidth = 1;
  g.beginPath();
  for (let c = 0; c <= Math.ceil(W / cw); c++) {
    const x = Math.round(c * cw * dpr) + 0.5;
    g.moveTo(x, 0);
    g.lineTo(x, H * dpr);
  }
  for (let r = 0; r <= Math.ceil(H / ch); r++) {
    const y = Math.round(r * ch * dpr) + 0.5;
    g.moveTo(0, y);
    g.lineTo(W * dpr, y);
  }
  g.stroke();
}

const rgb = (r: number, g: number, b: number) =>
  `rgb(${clamp(Math.round(r), 0, 255)},${clamp(Math.round(g), 0, 255)},${clamp(Math.round(b), 0, 255)})`;

const pack = (r: number, g: number, b: number) =>
  (clamp(Math.round(r), 0, 255) << 16) | (clamp(Math.round(g), 0, 255) << 8) | clamp(Math.round(b), 0, 255);

/** The line glyph closest to a screen-space angle. */
export function lineGlyph(angle: number) {
  let a = angle % Math.PI;
  if (a < 0) a += Math.PI;
  return a < Math.PI / 8 || a >= (7 * Math.PI) / 8 ? "-" : a < (3 * Math.PI) / 8 ? "\\" : a < (5 * Math.PI) / 8 ? "|" : "/";
}

/** What animals draw with. One per renderer, reused every frame. */
export class Pen {
  /** The sampler's output; preset to defaults before every sample. */
  readonly ink: Ink = { r: 0, g: 0, b: 0, kind: 0, glyphs: null, au: 0, av: 0 };
  t = 0;
  theme: Theme = "light";
  /** How dark the sky is right now: 0 light → 1 dark. */
  dark = 0;

  constructor(private r: AsciiRenderer) {}

  get cw() {
    return this.r.cw;
  }

  get ch() {
    return this.r.ch;
  }

  get cols() {
    return this.r.cols;
  }

  get rows() {
    return this.r.rows;
  }

  /** A colour that reads against the background: dark on paper, pale on ink. */
  get contrast(): RGB {
    return this.r.sky.ink;
  }

  /** Body coordinates → screen px. */
  toWorld(p: Pose, u: number, v: number, out: { x: number; y: number }) {
    const c = Math.cos(p.heading);
    const s = Math.sin(p.heading);
    out.x = p.x + (u * c - v * s) * p.span;
    out.y = p.y + (u * s + v * c) * p.span;
    return out;
  }

  /** Default fade for something at this depth, deepened while it fades in or out of the flock. */
  fogFor(depth: number, vanish = 0) {
    return withVanish(this.r.depthFog(depth), vanish);
  }

  /** Rasterise a silhouette within `reach` (fraction of span) of the pose. */
  shape(p: Pose, reach: number, sample: Sampler, opts: ShapeOptions = {}) {
    this.r.shape(p, reach, sample, opts);
  }

  /** A line of glyphs from (x0, y0) to (x1, y1) in px, faded by depth (or by `fog`), optionally ending in `tip`. */
  line(x0: number, y0: number, x1: number, y1: number, color: RGB, depth: number, tip?: string, fog = this.fogFor(depth)) {
    this.r.line(x0, y0, x1, y1, color, fog, tip);
  }

  private a = { x: 0, y: 0 };
  private b = { x: 0, y: 0 };

  /** A line in body coordinates. */
  lineBody(p: Pose, u0: number, v0: number, u1: number, v1: number, color: RGB, tip?: string) {
    const a = this.toWorld(p, u0, v0, this.a);
    const b = this.toWorld(p, u1, v1, this.b);
    this.r.line(a.x, a.y, b.x, b.y, color, this.fogFor(p.depth, p.vanish), tip);
  }

  /** A single glyph at (x, y) px, faded by depth (or by `fog` if given). Soft dots never cover solid cells. */
  dot(x: number, y: number, glyph: string, color: RGB, depth: number, fog = this.fogFor(depth)) {
    this.r.dot(x, y, glyph, color, fog);
  }

  /**
   * Exactly one solid cell at (x, y) px: a block of `fill` with `glyph` in `color`, over whatever is
   * there. For small features that must look the same however the animal turns, like a pair of eyes.
   */
  spot(x: number, y: number, glyph: string, color: RGB, fill: RGB, depth: number, fog = this.fogFor(depth)) {
    this.r.spot(x, y, glyph, color, fill, fog);
  }

  /** Leave something in the trail at (x, y), scaled by the trail knob. */
  shed(x: number, y: number, amount: number) {
    this.r.shed(x, y, amount);
  }

  /**
   * A soft round light at (x, y), `radius` px, drawn over the cells: a `core` colour at the centre
   * fading through `color` to nothing. Additive on a dark sky, so overlapping lights add up.
   * `glyph` puts a crisp character on top at the centre, so the light has a sharp point.
   */
  glow(x: number, y: number, radius: number, color: RGB, core: RGB, alpha: number, glyph = "") {
    this.r.glow(x, y, radius, color, core, alpha, glyph);
  }

  /** Cell index under (x, y), or -1 off screen. */
  cellIndex(x: number, y: number) {
    return this.r.cellIndex(x, y);
  }
}

export class AsciiRenderer {
  cw = 12;
  ch = 18;
  cols = 0;
  rows = 0;
  sky: Sky = SKIES.day;
  readonly pen = new Pen(this);

  private ctx: CanvasRenderingContext2D;
  private bg: HTMLCanvasElement;
  private dpr = 1;
  private width = 0;
  private height = 0;
  private fontFamily = "ui-monospace, Menlo, monospace";
  private animal: Animal<any> | null = null;
  /** A sky crossfade in progress: from → to over ms, started at `start` (performance.now()). */
  private blend: { from: Sky; to: Sky; start: number; ms: number } | null = null;
  /** The sky's colour behind each row, packed 0xRRGGBB: what far things fade into. */
  private rowSky = new Uint32Array(0);
  /** Stars: cell, glyph, brightness and twinkle phase. Regenerated on resize. */
  private stars: { x: number; y: number; glyph: string; b: number; phase: number; speed: number }[] = [];
  /** Soft white mist blobs, tileable left to right, and a copy tinted in the sky's haze colour. */
  private mistShape: HTMLCanvasElement = document.createElement("canvas");
  private mistTinted: HTMLCanvasElement = document.createElement("canvas");
  private mistColor = "";
  /** Soft lights queued by the animals this frame (see Pen.glow). */
  private glows: { x: number; y: number; r: number; color: RGB; core: RGB; a: number; glyph: string }[] = [];

  private energy = new Float32Array(0);
  private energyTmp = new Float32Array(0);
  private trailStyles: string[] = [];
  private hue = hueMatrix(0);
  private hueOn = false;

  private cellFlag = new Uint8Array(0);
  /** Block colour, packed 0xRRGGBB. */
  private cellFill = new Uint32Array(0);
  /** Glyph colour, packed 0xRRGGBB. */
  private cellColor = new Uint32Array(0);
  private cellGlyph = new Uint16Array(0);

  constructor(private canvas: HTMLCanvasElement, public tuning: Tuning) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
    this.bg = document.createElement("canvas");
    this.setSky(SKIES.day);
  }

  setFontFamily(family: string) {
    if (family) this.fontFamily = family;
  }

  /** The plain light or dark sky. */
  setTheme(theme: Theme, ms = 0) {
    this.setSky(THEME_SKIES[theme], ms);
  }

  /** Change the sky, at once or (ms > 0) as a crossfade that render() carries out. */
  setSky(sky: Sky, ms = 0) {
    if (ms > 0 && this.cols > 0) {
      this.blend = { from: this.sky, to: sky, start: performance.now(), ms };
      return;
    }
    this.blend = null;
    this.useSky(sky);
  }

  private useSky(sky: Sky) {
    this.sky = sky;
    this.pen.dark = sky.dark;
    this.pen.theme = sky.dark >= 0.5 ? "dark" : "light";
    this.restyle();
  }

  /** Advance a sky crossfade. */
  private stepBlend() {
    const b = this.blend;
    if (!b) return;
    const raw = clamp((performance.now() - b.start) / b.ms, 0, 1);
    if (raw >= 1) this.blend = null;
    this.useSky(mixSky(b.from, b.to, raw * raw * (3 - 2 * raw)));
  }

  /** How far something at this depth fades into the sky: the Distance fade knob, deeper in mist. */
  depthFog(depth: number) {
    const base = (1 - depth) * this.tuning.fog;
    const murk = this.sky.murk * (0.25 + 0.75 * (1 - depth));
    return murk > 0 ? 1 - (1 - base) * (1 - murk) : base;
  }

  /** Switch to another animal and its tuning; the old trail washes away. */
  setAnimal(animal: Animal<any>, tuning: Tuning) {
    this.animal = animal;
    this.tuning = tuning;
    this.energy.fill(0);
    this.restyle();
  }

  /** Rebuild cached colours and the background after a sky, animal, hue or grid change. */
  restyle() {
    const sky = this.sky;
    const trail = this.animal?.trail;
    const base = trail ? mixRGB(trail.light, trail.dark, sky.dark) : sky.ink;
    this.hue = hueMatrix(this.tuning.hueShift);
    this.hueOn = this.tuning.hueShift % 360 !== 0;
    const [tr, tg, tb] = sky.tint;
    const [r, g, bl] = this.turn(base[0], base[1], base[2]);
    const [cr, cg, cb] = [r * tr, g * tg, bl * tb].map((v) => clamp(Math.round(v), 0, 255));
    this.trailStyles = [];
    for (let l = 0; l < ALPHA_LEVELS; l++) {
      this.trailStyles.push(`rgba(${cr},${cg},${cb},${((sky.trailAlpha * (l + 1)) / ALPHA_LEVELS).toFixed(3)})`);
    }
    this.measureRows();
    this.tintMist();
    this.paintBackground();
  }

  /** The sky colour behind each row, for fading far things into it. */
  private measureRows() {
    const { rows, ch, height } = this;
    if (this.rowSky.length !== rows) this.rowSky = new Uint32Array(rows);
    for (let r = 0; r < rows; r++) {
      const [sr, sg, sb] = skyColorAt(this.sky, height > 0 ? clamp(((r + 0.5) * ch) / height, 0, 1) : 0.5);
      this.rowSky[r] = pack(sr, sg, sb);
    }
  }

  /** Apply the Hue shift knob to a colour. */
  private turn(r: number, g: number, b: number): RGB {
    if (!this.hueOn) return [r, g, b];
    const m = this.hue;
    return [m[0] * r + m[1] * g + m[2] * b, m[3] * r + m[4] * g + m[5] * b, m[6] * r + m[7] * g + m[8] * b];
  }

  /**
   * Light a colour by the sky's tint, then blend it toward the sky behind `row` by f
   * (0 → colour, 1 → sky), packed 0xRRGGBB.
   */
  private fade(r: number, g: number, b: number, f: number, row: number) {
    const [tr, tg, tb] = this.sky.tint;
    r *= tr;
    g *= tg;
    b *= tb;
    const bgc = this.rowSky[clamp(row, 0, this.rowSky.length - 1)] ?? 0;
    const br = bgc >>> 16;
    const bg = (bgc >>> 8) & 255;
    const bb = bgc & 255;
    return pack(r + (br - r) * f, g + (bg - g) * f, b + (bb - b) * f);
  }

  resize(width: number, height: number, dpr: number) {
    const prevCols = this.cols;
    const prevRows = this.rows;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.cw = clamp(Math.round(width / 124 / this.tuning.detail), 5, 24);
    this.ch = Math.round(this.cw * 1.45);
    this.cols = Math.ceil(width / this.cw);
    this.rows = Math.ceil(height / this.ch);

    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.bg.width = this.canvas.width;
    this.bg.height = this.canvas.height;

    const n = this.cols * this.rows;
    if (this.cols !== prevCols || this.rows !== prevRows) {
      this.energy = new Float32Array(n);
      this.energyTmp = new Float32Array(n);
      this.cellFlag = new Uint8Array(n);
      this.cellFill = new Uint32Array(n);
      this.cellColor = new Uint32Array(n);
      this.cellGlyph = new Uint16Array(n);
    }
    this.placeStars();
    this.shapeMist();
    this.measureRows();
    this.paintBackground();
  }

  /** Scatter stars over the upper sky, fewer toward the horizon. */
  private placeStars() {
    const { cols, rows, cw, ch } = this;
    this.stars = [];
    const count = Math.round((cols * rows) / 45);
    for (let k = 0; k < count; k++) {
      const c = Math.floor(hash3(k, 11, 3) * cols);
      const r = Math.floor(Math.pow(hash3(k, 17, 5), 1.6) * rows * 0.8);
      const b = hash3(k, 23, 7);
      this.stars.push({
        x: c * cw + cw / 2,
        y: r * ch + ch / 2 + 1,
        glyph: STAR_GLYPHS[Math.min(STAR_GLYPHS.length - 1, Math.floor(b * b * STAR_GLYPHS.length))],
        b: (0.35 + 0.65 * b) * (1 - 0.6 * (r / rows)),
        phase: hash3(k, 29, 9) * 40,
        speed: 0.6 + hash3(k, 31, 11) * 2.2,
      });
    }
  }

  /** Soft blobs of mist, heavier near the ground, drawn small and stretched over the screen. */
  private shapeMist() {
    const w = Math.max(32, Math.round(this.width / 6));
    const h = Math.max(24, Math.round(this.height / 6));
    for (const c of [this.mistShape, this.mistTinted]) {
      c.width = w;
      c.height = h;
    }
    const g = this.mistShape.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, w, h);
    const ground = g.createLinearGradient(0, 0, 0, h);
    ground.addColorStop(0, "rgba(255,255,255,0)");
    ground.addColorStop(0.55, "rgba(255,255,255,0.08)");
    ground.addColorStop(1, "rgba(255,255,255,0.32)");
    g.fillStyle = ground;
    g.fillRect(0, 0, w, h);
    for (let k = 0; k < 46; k++) {
      const x = hash3(k, 3, 41) * w;
      const y = h * (0.25 + 0.75 * Math.pow(hash3(k, 5, 43), 0.6));
      const rad = w * (0.06 + 0.16 * hash3(k, 7, 47));
      const a = 0.05 + 0.12 * hash3(k, 9, 53);
      // Drawn three times so the texture wraps seamlessly left to right.
      for (const dx of [-w, 0, w]) {
        const blob = g.createRadialGradient(x + dx, y, 0, x + dx, y, rad);
        blob.addColorStop(0, `rgba(255,255,255,${a.toFixed(3)})`);
        blob.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = blob;
        g.beginPath();
        g.ellipse(x + dx, y, rad, rad * 0.55, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    this.mistColor = "";
    this.tintMist();
  }

  /** Recolour the mist texture in the sky's haze colour (only when that colour changes). */
  private tintMist() {
    const [hr, hg, hb] = this.sky.haze.map(Math.round);
    const color = `rgb(${hr},${hg},${hb})`;
    if (color === this.mistColor || !this.mistShape.width) return;
    this.mistColor = color;
    const g = this.mistTinted.getContext("2d");
    if (!g) return;
    g.globalCompositeOperation = "copy";
    g.drawImage(this.mistShape, 0, 0);
    g.globalCompositeOperation = "source-in";
    g.fillStyle = color;
    g.fillRect(0, 0, this.mistTinted.width, this.mistTinted.height);
    g.globalCompositeOperation = "source-over";
  }

  /** One layer of drifting mist, `speed` px/s to the right, at `alpha`. */
  private drawMist(t: number, speed: number, alpha: number, lift: number) {
    if (alpha <= 0.003) return;
    const { ctx, width: W, height: H } = this;
    const x = (t * speed) % W;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.drawImage(this.mistTinted, x - W, lift, W, H);
    ctx.drawImage(this.mistTinted, x, lift, W, H);
    ctx.globalAlpha = 1;
  }

  private drawStars(t: number) {
    const amount = this.sky.stars;
    if (amount <= 0.01) return;
    const { ctx, cellFlag, cw, ch, cols } = this;
    ctx.fillStyle = "rgb(236,240,255)";
    for (const s of this.stars) {
      const i = Math.floor(s.y / ch) * cols + Math.floor(s.x / cw);
      if (cellFlag[i] === CELL_SOLID) continue;
      ctx.globalAlpha = amount * s.b * (0.55 + 0.45 * Math.sin(t * s.speed + s.phase));
      ctx.fillText(s.glyph, s.x, s.y);
    }
    ctx.globalAlpha = 1;
  }

  private paintBackground() {
    const g = this.bg.getContext("2d");
    if (!g) return;
    const { width: W, height: H, dpr, cw, ch } = this;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { top, mid, bottom } = this.sky;
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, rgb(...top));
    sky.addColorStop(0.55, rgb(...mid));
    sky.addColorStop(1, rgb(...bottom));
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    const [gr, gg, gb, ga] = this.sky.grid;
    paintGrid(g, W, H, cw, ch, dpr, `rgba(${Math.round(gr)},${Math.round(gg)},${Math.round(gb)},${(ga * this.tuning.grid).toFixed(3)})`);
  }

  render(flock: Flock<any>, dt: number) {
    const { ctx, dpr, cols, ch } = this;
    if (cols === 0) return;
    this.pen.t = flock.time;
    this.stepBlend();

    for (const e of flock.events) this.stamp(e.x, e.y, e.radius, e.amount);
    flock.events.length = 0;
    this.diffuse(dt);

    this.cellFlag.fill(CELL_NONE);
    this.glows.length = 0;
    const animal = flock.animal;
    if (animal.drawAll) animal.drawAll(flock, this.pen);
    else if (animal.draw) for (const c of flock.creatures) animal.draw(c, this.pen, flock);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bg, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.font = `600 ${Math.round(ch * 0.74)}px ${this.fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const t = flock.time;
    const mist = this.sky.mist * (0.85 + 0.15 * Math.sin(t * 0.07));
    this.drawStars(t);
    this.drawMist(t, 7, mist * 0.9, 0);
    this.drawTrail(t);
    this.drawCells();
    this.drawGlows();
    // A thinner, faster layer in front, so near creatures drift through it too.
    this.drawMist(t + 400, 13, mist * 0.35, this.height * 0.06);
  }

  // ── trail ───────────────────────────────────────────────────────────

  cellIndex(x: number, y: number) {
    const c = Math.floor(x / this.cw);
    const r = Math.floor(y / this.ch);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  glow(x: number, y: number, r: number, color: RGB, core: RGB, a: number, glyph = "") {
    if (a > 0.01 && r > 0.5) this.glows.push({ x, y, r, color, core, a: Math.min(1, a), glyph });
  }

  /** The lights drawn this frame (see Pen.glow), moved by (dx, dy), in their on-screen colour. */
  lights(dx = 0, dy = 0): Light[] {
    return this.glows.map((l) => ({ x: l.x + dx, y: l.y + dy, r: l.r, a: l.a, color: this.turn(l.color[0], l.color[1], l.color[2]) }));
  }

  private drawGlows() {
    const { ctx, glows } = this;
    if (!glows.length) return;
    const dark = this.pen.dark;
    // Light adds up on a dark sky; on a pale one it has to be painted on.
    ctx.globalCompositeOperation = dark > 0.4 ? "lighter" : "source-over";
    const rgba = (c: RGB, a: number) => {
      const [r, g, b] = this.turn(c[0], c[1], c[2]);
      return `rgba(${clamp(Math.round(r), 0, 255)},${clamp(Math.round(g), 0, 255)},${clamp(Math.round(b), 0, 255)},${a.toFixed(3)})`;
    };
    for (const l of glows) {
      // With a glyph for its point, the light itself stays soft at the centre instead of a blob.
      const hot = l.glyph ? 0.6 : 1;
      const grad = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
      grad.addColorStop(0, rgba(l.core, l.a * hot));
      grad.addColorStop(0.1, rgba(l.core, l.a * 0.85 * hot));
      grad.addColorStop(0.22, rgba(l.color, l.a * 0.55 * hot));
      grad.addColorStop(0.5, rgba(l.color, l.a * 0.16));
      grad.addColorStop(1, rgba(l.color, 0));
      ctx.fillStyle = grad;
      ctx.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
    }
    // The light catches the grid lines around it, a little further out than the glow itself.
    const lines = Math.min(1, this.tuning.grid) * 0.4;
    if (lines > 0) {
      const { cw, ch, dpr } = this;
      const snap = (v: number) => (Math.round(v * dpr) + 0.5) / dpr;
      ctx.lineWidth = 1 / dpr;
      for (const l of glows) {
        const R = l.r * 2;
        const grad = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, R);
        grad.addColorStop(0, rgba(l.color, l.a * lines));
        grad.addColorStop(1, rgba(l.color, 0));
        ctx.strokeStyle = grad;
        ctx.beginPath();
        for (let c = Math.max(0, Math.ceil((l.x - R) / cw)); c * cw <= l.x + R; c++) {
          ctx.moveTo(snap(c * cw), l.y - R);
          ctx.lineTo(snap(c * cw), l.y + R);
        }
        for (let r = Math.max(0, Math.ceil((l.y - R) / ch)); r * ch <= l.y + R; r++) {
          ctx.moveTo(l.x - R, snap(r * ch));
          ctx.lineTo(l.x + R, snap(r * ch));
        }
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = "source-over";
    // The points, painted on top so they stay crisp: pale gold on a dark sky (warmer than the white
    // stars), deep amber on a pale one.
    const [pr, pg, pb] = this.turn(mix(150, 255, dark), mix(84, 236, dark), mix(10, 150, dark));
    ctx.fillStyle = rgb(pr, pg, pb);
    for (const l of glows) {
      if (!l.glyph) continue;
      ctx.globalAlpha = Math.min(1, l.a * 1.3);
      ctx.fillText(l.glyph, l.x, l.y + 1);
    }
    ctx.globalAlpha = 1;
  }

  shed(x: number, y: number, amount: number) {
    const i = this.cellIndex(x, y);
    if (i >= 0) this.energy[i] = Math.min(1.6, this.energy[i] + amount * this.tuning.trail);
  }

  private stamp(x: number, y: number, radius: number, amount: number) {
    const field = this.energy;
    const c0 = Math.floor(x / this.cw);
    const r0 = Math.floor(y / this.ch);
    for (let r = r0 - radius; r <= r0 + radius; r++) {
      for (let c = c0 - radius; c <= c0 + radius; c++) {
        if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
        const d = Math.hypot(c - c0, (r - r0) * 1.4);
        if (d > radius + 0.5) continue;
        const i = r * this.cols + c;
        field[i] = Math.min(1.6, field[i] + amount * (1 - d / (radius + 1)));
      }
    }
  }

  /** Blur + decay so the trail drifts outward and fades. */
  private diffuse(dt: number) {
    const { cols, rows, energy, energyTmp: tmp } = this;
    const decay = Math.exp(-dt * this.tuning.trailFade);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const l = c > 0 ? energy[i - 1] : energy[i];
        const rt = c < cols - 1 ? energy[i + 1] : energy[i];
        const u = r > 0 ? energy[i - cols] : energy[i];
        const d = r < rows - 1 ? energy[i + cols] : energy[i];
        tmp[i] = (energy[i] * 4 + l + rt + u + d) * 0.125 * decay;
      }
    }
    this.energy = tmp;
    this.energyTmp = energy;
  }

  private drawTrail(t: number) {
    const { ctx, cols, cw, ch, energy, cellFlag } = this;
    const small = Math.max(2, Math.round(cw * 0.19));
    for (let level = 0; level < ALPHA_LEVELS; level++) {
      ctx.fillStyle = this.trailStyles[level];
      for (let i = 0; i < energy.length; i++) {
        const e = energy[i];
        if (e < 0.12 || cellFlag[i] === CELL_SOLID) continue;
        const col = i % cols;
        const row = (i / cols) | 0;
        // Each grain twinkles on its own clock.
        const twinkle = 0.75 + 0.25 * Math.sin(t * 5 + hash3(col, row, 3) * 40);
        if (clamp(Math.floor(e * twinkle * 4 * ALPHA_LEVELS) - 1, 0, ALPHA_LEVELS - 1) !== level) continue;
        const size = e > 0.6 ? small + 1 : small;
        ctx.fillRect(Math.round(col * cw + cw * 0.5 - size / 2), Math.round(row * ch + ch * 0.6 - size / 2), size, size);
      }
    }
  }

  // ── drawing into cells ──────────────────────────────────────────────

  /** Run the sampler for one point, with the ink preset to its defaults. */
  private probe(sample: Sampler, p: Pose, hc: number, hs: number, px: number, py: number) {
    const ink = this.pen.ink;
    const dx = px - p.x;
    const dy = py - p.y;
    const u = (dx * hc + dy * hs) / p.span;
    const v = (dy * hc - dx * hs) / p.span;
    ink.glyphs = null;
    ink.au = u;
    ink.av = v;
    return sample(u, v, px, py);
  }

  /**
   * Supersample every cell within reach of the pose. Fully covered cells
   * become solid (or glyph-only, for glows); partial cells become soft edge
   * glyphs, which never cover anything solid.
   */
  shape(p: Pose, reach: number, sample: Sampler, { light = 1, tilt = 0, fog: baseFog = this.depthFog(p.depth) }: ShapeOptions) {
    const fog = withVanish(baseFog, p.vanish);
    const { cellFlag, cellFill, cellColor, cellGlyph, cw, ch, cols, rows } = this;
    const ink = this.pen.ink;
    const t = this.pen.t;
    const { shimmer, sparkle } = this.tuning;
    const S = p.span;
    const hc = Math.cos(p.heading);
    const hs = Math.sin(p.heading);
    const R = reach * S;
    const c0 = Math.max(0, Math.floor((p.x - R) / cw));
    const c1 = Math.min(cols - 1, Math.floor((p.x + R) / cw));
    const r0 = Math.max(0, Math.floor((p.y - R) / ch));
    const r1 = Math.min(rows - 1, Math.floor((p.y + R) / ch));

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const x = c * cw;
        const y = r * ch;
        const center = this.probe(sample, p, hc, hs, x + cw / 2, y + ch / 2);
        let hits = center ? 1 : 0;
        let ir = ink.r;
        let ig = ink.g;
        let ib = ink.b;
        const kind = ink.kind;
        const glyphs = ink.glyphs;
        const au = ink.au;
        const av = ink.av;
        for (let k = 0; k < SUBSAMPLES.length; k += 2) {
          if (this.probe(sample, p, hc, hs, x + SUBSAMPLES[k] * cw, y + SUBSAMPLES[k + 1] * ch)) {
            if (hits === 0) {
              ir = ink.r;
              ig = ink.g;
              ib = ink.b;
            }
            hits++;
          }
        }
        if (hits === 0) continue;
        const coverage = hits / 5;
        const i = r * cols + c;
        const solid = center && coverage >= 0.6;
        if (!solid && cellFlag[i] === CELL_SOLID) continue;

        [ir, ig, ib] = this.turn(ir, ig, ib);
        let k = light * (1 + (hash3(c, r, Math.floor(t * 6)) - 0.5) * 0.06);
        if (solid && kind === INK_SHIMMER) {
          // Iridescence: brightness rolls across the surface as it tilts and turns.
          k *= 1 - 0.4 * shimmer + shimmer * Math.sin(t * 2.2 + au * 9 + av * 6 + tilt + p.heading * 2);
        }
        ir *= k;
        ig *= k;
        ib *= k;
        // Body-anchored key so each glyph rides along with the animal.
        const key = (hash3(Math.round((au * S) / (cw * 0.9)), Math.round((av * S) / (cw * 0.9)), p.id) * 4294967295) >>> 0;

        if (!solid) {
          // Soft, anti-aliased silhouette: just a glyph that fades into the background.
          const set = coverage >= 0.5 ? EDGE_HEAVY : EDGE_LIGHT;
          cellFlag[i] = CELL_SOFT;
          cellColor[i] = this.fade(ir, ig, ib, Math.min(1, fog + 0.55 - 0.45 * coverage), r);
          cellGlyph[i] = set.charCodeAt((key >>> 8) % set.length);
          continue;
        }

        if (kind === INK_GLOW) {
          if (cellFlag[i] === CELL_SOLID) continue;
          const lum = (0.3 * ir + 0.59 * ig + 0.11 * ib) / 255;
          const set = glyphs ?? GLOW_RAMP;
          cellFlag[i] = CELL_SOFT;
          cellColor[i] = this.fade(ir, ig, ib, fog, r);
          cellGlyph[i] = set.charCodeAt(glyphs ? (key >>> 8) % set.length : clamp(Math.floor(lum * set.length), 0, set.length - 1));
          continue;
        }

        cellFlag[i] = CELL_SOLID;
        const roll = hash3(key, Math.floor(t * 2.4 + (key % 997) / 97), 7);
        let set: string;
        let gr: number;
        let gg: number;
        let gb: number;
        if (kind === INK_GLASS) {
          // See-through: the block mostly lets the background through; the glyph carries the colour.
          cellFill[i] = this.fade(ir, ig, ib, Math.min(1, 0.62 + fog * 0.38), r);
          set = glyphs ?? SCALE_RAMP;
          cellColor[i] = this.fade(ir, ig, ib, fog, r);
          cellGlyph[i] = set.charCodeAt((key >>> 8) % set.length);
          if (roll < sparkle) cellColor[i] = pack(...SPARKLES[key % SPARKLES.length]);
          continue;
        }
        if (kind === INK_LIT) {
          // Glowing: the block carries a deep version of the colour, the glyph a bright one.
          cellFill[i] = this.fade(ir * 0.58, ig * 0.58, ib * 0.58, fog, r);
          set = glyphs ?? ".:*";
          cellColor[i] = roll < sparkle
            ? pack(...SPARKLES[key % SPARKLES.length])
            : this.fade(Math.min(255, ir * 1.05 + 50), Math.min(255, ig * 1.05 + 50), Math.min(255, ib * 1.05 + 50), fog, r);
          cellGlyph[i] = set.charCodeAt((key >>> 8) % set.length);
          continue;
        }
        const fill = this.fade(ir, ig, ib, fog, r);
        cellFill[i] = fill;
        const fr = fill >>> 16;
        const fg = (fill >>> 8) & 255;
        const fb = fill & 255;
        if (kind === INK_BODY) {
          set = glyphs ?? BODY_GLYPHS;
          [gr, gg, gb] = [fr * 1.6 + 44, fg * 1.6 + 40, fb * 1.6 + 36];
        } else if (kind === INK_DARK) {
          set = glyphs ?? DARK_GLYPHS;
          [gr, gg, gb] = [fr * 1.7 + 34, fg * 1.7 + 30, fb * 1.7 + 30];
        } else if (kind === INK_SPOT) {
          set = glyphs ?? SPOT_GLYPHS;
          [gr, gg, gb] = [fr * 0.4, fg * 0.4, fb * 0.4];
        } else {
          set = glyphs ?? SCALE_RAMP;
          [gr, gg, gb] = [fr * 0.42, fg * 0.42, fb * 0.42];
        }
        let glyph: number;
        if (glyphs || (kind !== INK_SCALE && kind !== INK_SHIMMER)) {
          glyph = set.charCodeAt((key >>> 8) % set.length);
        } else {
          // Sparse glyphs on bright skin, dense in shadow.
          const lum = (0.3 * fr + 0.59 * fg + 0.11 * fb) / 255;
          const jitter = ((key >>> 4) % 3) - 1;
          glyph = set.charCodeAt(clamp(Math.floor((1 - lum) * (set.length - 0.01)) + jitter, 0, set.length - 1));
        }
        cellGlyph[i] = glyph;
        const glints = kind === INK_SHIMMER ? sparkle : kind === INK_SCALE ? sparkle / 3 : 0;
        cellColor[i] = roll < glints ? pack(...SPARKLES[key % SPARKLES.length]) : pack(gr, gg, gb);
      }
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, color: RGB, fog: number, tip?: string) {
    const { cellFlag, cellColor, cellGlyph, cw } = this;
    const [r, g, b] = this.turn(color[0], color[1], color[2]);
    const cols = this.cols;
    const glyph = lineGlyph(Math.atan2(y1 - y0, x1 - x0)).charCodeAt(0);
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (cw * 0.5)));
    let last = -1;
    for (let s = 1; s <= steps; s++) {
      const i = this.cellIndex(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps);
      if (i < 0 || cellFlag[i] === CELL_SOLID) continue;
      cellFlag[i] = CELL_SOFT;
      cellColor[i] = this.fade(r, g, b, fog, (i / cols) | 0);
      cellGlyph[i] = glyph;
      last = i;
    }
    if (tip && last >= 0) cellGlyph[last] = tip.charCodeAt(0);
  }

  dot(x: number, y: number, glyph: string, color: RGB, fog: number) {
    const i = this.cellIndex(x, y);
    if (i < 0 || this.cellFlag[i] === CELL_SOLID) return;
    const [r, g, b] = this.turn(color[0], color[1], color[2]);
    this.cellFlag[i] = CELL_SOFT;
    this.cellColor[i] = this.fade(r, g, b, fog, (i / this.cols) | 0);
    this.cellGlyph[i] = glyph.charCodeAt(0);
  }

  spot(x: number, y: number, glyph: string, color: RGB, fill: RGB, fog: number) {
    const i = this.cellIndex(x, y);
    if (i < 0) return;
    const [r, g, b] = this.turn(color[0], color[1], color[2]);
    const [fr, fg, fb] = this.turn(fill[0], fill[1], fill[2]);
    this.cellFlag[i] = CELL_SOLID;
    const row = (i / this.cols) | 0;
    this.cellFill[i] = this.fade(fr, fg, fb, fog, row);
    this.cellColor[i] = this.fade(r, g, b, fog, row);
    this.cellGlyph[i] = glyph.charCodeAt(0);
  }

  private drawCells() {
    const { ctx, cols, rows, cw, ch, cellFlag, cellFill, cellColor, cellGlyph } = this;
    const n = cols * rows;
    for (let i = 0; i < n; i++) {
      const flag = cellFlag[i];
      if (!flag) continue;
      const x = (i % cols) * cw;
      const y = ((i / cols) | 0) * ch;
      if (flag === CELL_SOLID) {
        const f = cellFill[i];
        ctx.fillStyle = rgb(f >>> 16, (f >>> 8) & 255, f & 255);
        ctx.fillRect(x + 1, y + 1, cw - 1, ch - 1);
      }
      const g = cellColor[i];
      ctx.fillStyle = rgb(g >>> 16, (g >>> 8) & 255, g & 255);
      ctx.fillText(String.fromCharCode(cellGlyph[i]), x + cw / 2, y + ch / 2 + 1);
    }
  }
}

