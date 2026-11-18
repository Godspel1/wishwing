import { ANIMALS, type AnimalKey } from "./animals";
import { Flock, type Animal, type Perch, type PointerState, type Tuning } from "./flock";
import { clamp } from "./math";
import { AsciiRenderer, THEME_SKIES, type Theme } from "./renderer";
import type { Sky } from "./sky";

const STEP = 1 / 60;

/** A built-in animal by name, or any Animal definition. */
const resolve = (animal: AnimalKey | Animal<any>) => (typeof animal === "string" ? ANIMALS[animal] : animal);
const MAX_STEPS = 4;

/**
 * Wires a Flock + AsciiRenderer to a canvas: fixed-timestep loop, resize,
 * click-to-startle, pointer tracking, switching animals, pausing off-screen,
 * and prefers-reduced-motion.
 */
export class AnimalEngine {
  /** The current animal's live knobs; change them through set() so resizes and repaints happen. */
  tuning: Tuning;
  animal: Animal<any>;
  private flock: Flock<any>;
  private renderer: AsciiRenderer;
  private count?: number;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private visible = true;
  private reducedMotion: MediaQueryList;
  private resizeObserver: ResizeObserver;
  private intersectionObserver: IntersectionObserver;
  private disposed = false;
  /** Canvas position, cached on resize so pointer events never read layout. */
  private rect = { left: 0, top: 0 };
  /** Raw pointer input (canvas px), smoothed into `pointer` once per frame. */
  private input = { x: 0, y: 0, vx: 0, vy: 0, at: -Infinity, last: 0, inside: false };
  /** What the flock sees; shared with every Flock (see wire()). */
  private pointer: PointerState = { x: 0, y: 0, vx: 0, vy: 0, stir: 0, inside: false };
  /** Landing ledges in canvas px, kept across setAnimal(). */
  private perches: Perch[] = [];
  private size = { width: 0, height: 0 };

  /** count pins the population; tuning overrides any of the animal's defaults. */
  constructor(
    private canvas: HTMLCanvasElement,
    {
      animal = "butterflies",
      count,
      theme = "light",
      tuning,
    }: { animal?: AnimalKey | Animal<any>; count?: number; theme?: Theme; tuning?: Partial<Tuning> } = {},
  ) {
    this.count = count;
    this.animal = resolve(animal);
    this.tuning = { ...this.animal.defaults, ...tuning } as Tuning;
    this.flock = this.wire(new Flock(this.animal, this.tuning, count));
    this.renderer = new AsciiRenderer(canvas, this.tuning);
    this.renderer.setFontFamily(getComputedStyle(canvas).fontFamily);
    this.renderer.setAnimal(this.animal, this.tuning);
    this.renderer.setTheme(theme);
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.intersectionObserver = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.schedule();
    });
    this.intersectionObserver.observe(canvas);

    this.reducedMotion.addEventListener("change", this.onMotionPreference);
    window.addEventListener("pointerdown", this.onPointerDown, { passive: true });
    window.addEventListener("pointermove", this.onPointerMove, { passive: true });
    window.addEventListener("pointerout", this.onPointerOut, { passive: true });
    window.addEventListener("pointerup", this.onPointerEnd, { passive: true });
    window.addEventListener("pointercancel", this.onPointerEnd, { passive: true });
    window.addEventListener("blur", this.onLeave);
    document.addEventListener("visibilitychange", this.onLeave);

    this.resize();
    // Canvas text can't trigger a webfont load; once the mono face is in, redraw.
    document.fonts?.load(`600 16px ${getComputedStyle(canvas).fontFamily}`).then(() => {
      if (!this.disposed && this.reducedMotion.matches) this.drawStill();
    });
    this.schedule();
  }

  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    this.reducedMotion.removeEventListener("change", this.onMotionPreference);
    window.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerout", this.onPointerOut);
    window.removeEventListener("pointerup", this.onPointerEnd);
    window.removeEventListener("pointercancel", this.onPointerEnd);
    window.removeEventListener("blur", this.onLeave);
    document.removeEventListener("visibilitychange", this.onLeave);
  }

  /** Swap in another animal with its own defaults (plus any overrides); the screen fills with it at once. */
  setAnimal(animal: AnimalKey | Animal<any>, tuning?: Partial<Tuning>) {
    this.animal = resolve(animal);
    this.tuning = { ...this.animal.defaults, ...tuning } as Tuning;
    this.flock = this.wire(new Flock(this.animal, this.tuning, this.count));
    this.renderer.setAnimal(this.animal, this.tuning);
    this.resize();
  }

  /** Hand a new Flock the engine's lasting state, so switching animals keeps it. */
  private wire<F extends Flock<any>>(flock: F): F {
    flock.pointer = this.pointer;
    // reducedMotion isn't set yet when the constructor wires the first flock.
    flock.perches = this.reducedMotion?.matches ? [] : this.perches;
    flock.cellH = this.renderer?.ch ?? flock.cellH;
    return flock;
  }

  /** Where creatures may land, in page (client) px. */
  setPerches(perches: Perch[]) {
    const { left, top } = this.rect;
    this.perches = perches.map((p) => ({
      ...p,
      x0: p.x0 - left,
      x1: p.x1 - left,
      y: p.y - top,
      keepOut: p.keepOut?.map(([a, b]): [number, number] => [a - left, b - left]),
    }));
    this.flock.perches = this.reducedMotion.matches ? [] : this.perches;
  }

  /** Shoo off anything that has landed (the user is typing, say), and hold off landing for a while. */
  disturb() {
    this.flock.disturb();
  }

  set(key: string, value: number | boolean) {
    this.tuning[key] = value;
    if (key === "detail") this.resize();
    else if (key === "hueShift" || key === "grid") this.renderer.restyle();
    if (this.reducedMotion.matches) this.drawStill();
  }

  /** The plain light or dark sky; `fade` crossfades over that many ms. */
  setTheme(theme: Theme, opts: { fade?: number } = {}) {
    this.setSky(THEME_SKIES[theme], opts);
  }

  /** Change the sky; `fade` crossfades over that many ms (never with reduced motion, or while paused). */
  setSky(sky: Sky, { fade = 0 }: { fade?: number } = {}) {
    const still = this.reducedMotion.matches;
    this.renderer.setSky(sky, still || !this.visible ? 0 : fade);
    if (still) this.drawStill();
  }

  private resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    this.rect = { left: rect.left, top: rect.top };
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.resize(rect.width, rect.height, dpr);
    this.flock.resize(rect.width, rect.height);
    this.flock.cellH = this.renderer.ch;
    // A real resize moves the ledges: everyone takes off (the page re-sends perches afterwards).
    const resized = this.size.width > 0 && (rect.width !== this.size.width || rect.height !== this.size.height);
    this.size = { width: rect.width, height: rect.height };
    if (resized) this.flock.disturb(2);
    if (this.reducedMotion.matches) this.drawStill();
  }

  private schedule() {
    cancelAnimationFrame(this.raf);
    if (this.disposed || !this.visible || this.reducedMotion.matches) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.acc += dt;
    this.syncPointer(now, dt);
    let steps = 0;
    while (this.acc >= STEP && steps < MAX_STEPS) {
      this.flock.step(STEP);
      this.acc -= STEP;
      steps++;
    }
    if (steps === MAX_STEPS) this.acc = 0;
    this.renderer.render(this.flock, dt);
    this.raf = requestAnimationFrame(this.frame);
  };

  /** Reduced motion: let the animals spread out, then show a single frame. */
  private drawStill() {
    if (this.flock.time < 4) {
      for (let i = 0; i < 240; i++) this.flock.step(STEP);
    }
    this.renderer.render(this.flock, STEP);
  }

  private onMotionPreference = () => {
    this.flock.perches = this.reducedMotion.matches ? [] : this.perches;
    if (this.reducedMotion.matches) {
      this.flock.disturb();
      cancelAnimationFrame(this.raf);
      this.drawStill();
    } else {
      this.schedule();
    }
  };

  /**
   * Hand the flock this frame's pointer: where it is, how fast it moves, and `stir`, which rises
   * at once when it moves and fades over a few seconds once it rests (at once when it leaves).
   */
  private syncPointer(now: number, dt: number) {
    const i = this.input;
    const p = this.pointer;
    const idle = now - i.at;
    const target = i.inside ? Math.exp(-idle / 2500) : 0;
    p.stir += (target - p.stir) * (1 - Math.exp(-dt / (target > p.stir ? 0.05 : 0.25)));
    const damp = Math.exp(-idle / 160);
    p.vx = i.vx * damp;
    p.vy = i.vy * damp;
    p.x = i.x;
    p.y = i.y;
    p.inside = i.inside;
  }

  private track(e: PointerEvent) {
    const i = this.input;
    const x = e.clientX - this.rect.left;
    const y = e.clientY - this.rect.top;
    const dt = Math.max(4, e.timeStamp - i.last) / 1000;
    if (i.inside) {
      i.vx += (clamp((x - i.x) / dt, -4000, 4000) - i.vx) * 0.35;
      i.vy += (clamp((y - i.y) / dt, -4000, 4000) - i.vy) * 0.35;
    } else {
      i.vx = 0;
      i.vy = 0;
    }
    i.x = x;
    i.y = y;
    i.last = e.timeStamp;
    i.at = performance.now();
    i.inside = true;
  }

  private onPointerMove = (e: PointerEvent) => this.track(e);

  /** Left the window (not just moved between elements). */
  private onPointerOut = (e: PointerEvent) => {
    if (!e.relatedTarget) this.input.inside = false;
  };

  /** A finger lifting is the pointer leaving. */
  private onPointerEnd = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") this.input.inside = false;
  };

  private onLeave = () => {
    this.input.inside = false;
  };

  private onPointerDown = (e: PointerEvent) => {
    this.track(e);
    // Only clicks that land on the canvas itself, not on UI floating above it.
    if (this.reducedMotion.matches || e.target !== this.canvas) return;
    this.flock.startle(e.clientX - this.rect.left, e.clientY - this.rect.top);
  };
}
