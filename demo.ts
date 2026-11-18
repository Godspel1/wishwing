// Bundled so the page works offline and doesn't flash while fonts load.
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import { mountTweakPanel, type Control, type ControlKit } from "./panel";
import { ANIMAL_KEYS, ANIMALS, AnimalEngine, SHARED_CONTROLS, type AnimalKey, type KnobSpec, type Tuning } from "./src";
import { applyPageTheme, currentSky, mountTheme, themeFor } from "./theme";
import { mountComposer } from "./search";
import { mountShortcuts } from "./shortcuts";
import { measureLedges, mountClock, mountGreeting, rimLight } from "./ui";

// Only Chromium can run an SVG filter inside backdrop-filter; everyone else gets frosted glass.
// (Set here, not in an inline <script>: Chrome blocks inline scripts on extension pages.)
if (/Chrome\//.test(navigator.userAgent)) document.documentElement.classList.add("liquid");

const STORE = "wishless-tab:";

const params = new URLSearchParams(location.search);
const count = Number(params.get("count")) || undefined;

/** The creature picked in the drawer (butterflies unless changed). */
const ANIMAL_STORE = `${STORE}animal`;
function savedAnimal(): AnimalKey {
  try {
    const key = localStorage.getItem(ANIMAL_STORE);
    if (key && key in ANIMALS) return key as AnimalKey;
  } catch {}
  return "butterflies";
}
let animal = savedAnimal();
const tweaksKey = (key: AnimalKey) => `${STORE}tweaks:${key}`;

// The sky follows the time of day (or whatever the drawer pins it to).
const sky = currentSky();
applyPageTheme(sky);
const engine = new AnimalEngine(document.querySelector("canvas")!, { animal, count, theme: themeFor(sky) });
const theme = mountTheme(engine);

/** The current creature's knobs, grouped for the drawer (shared ones it ignores are left out). */
function controls(kit: ControlKit<Tuning>): [string, Control[]][] {
  const current = engine.animal;
  const hidden = new Set<string>(current.hide ?? []);
  const build = (spec: KnobSpec): Control => {
    if ("toggle" in spec) return kit.toggle(spec.key, spec.label, spec.hint);
    const knob = kit.knob(spec.key, spec.label, spec.min, spec.max, spec.step, spec.hint);
    const when = spec.disabledWhen;
    return when ? { ...knob, disabled: () => Boolean(engine.tuning[when]) } : knob;
  };
  const keep = (specs: KnobSpec[]) => specs.filter((s) => !hidden.has(s.key)).map(build);
  return [
    ["Movement", keep(SHARED_CONTROLS.movement)],
    ...current.controls.map(([title, specs]): [string, Control[]] => [title, specs.map(build)]),
    ["Look", keep(SHARED_CONTROLS.look)],
  ];
}

const rgbCss = ([r, g, b]: [number, number, number]) => `rgb(${r}, ${g}, ${b})`;

const panel = mountTweakPanel(engine, ANIMALS[animal].defaults, controls, {
  storageKey: tweaksKey(animal),
  theme,
  animals: ANIMAL_KEYS.map((key) => ({ key, label: ANIMALS[key].label, swatch: rgbCss(ANIMALS[key].swatch) })),
  currentAnimal: animal,
  onPickAnimal(key) {
    animal = key as AnimalKey;
    engine.setAnimal(animal);
    panel.updateAnimal(animal, ANIMALS[animal].defaults, controls, tweaksKey(animal));
    try {
      localStorage.setItem(ANIMAL_STORE, animal);
    } catch {}
  },
});

// Settings changed in another tab: start over with them.
window.addEventListener("storage", (e) => {
  if (e.key === tweaksKey(animal) || e.key === ANIMAL_STORE) location.reload();
});

mountComposer(mountShortcuts());

// Butterflies land on the search box and the clock: keep their ledges up to date, and shoo them off
// while the user types.
let ledgeFrame = 0;
const refreshLedges = () => {
  if (ledgeFrame) return;
  ledgeFrame = requestAnimationFrame(() => {
    ledgeFrame = 0;
    engine.setPerches(measureLedges());
  });
};
const ledgeWatch = new ResizeObserver(refreshLedges);
for (const sel of [".composer", ".clock-time", ".greeting"]) {
  const el = document.querySelector(sel);
  if (el) ledgeWatch.observe(el);
}
window.addEventListener("resize", refreshLedges);
document.fonts?.ready.then(refreshLedges);
refreshLedges();
document.querySelector(".composer textarea")?.addEventListener("input", () => engine.disturb());
// Fireflies close to the search box light up its rim.
const composer = document.querySelector<HTMLElement>(".composer");
if (composer) engine.onLights(rimLight(composer));
mountGreeting();
mountClock();
