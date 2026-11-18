// Bundled so the page works offline and doesn't flash while fonts load.
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import { mountTweakPanel, type Control, type ControlKit } from "./panel";
import { ANIMALS, AnimalEngine, SHARED_CONTROLS, type KnobSpec, type Tuning } from "./src";
import { applyPageTheme, currentTheme, mountTheme } from "./theme";
import { mountShortcuts } from "./shortcuts";
import { mountClock, mountComposer, mountGreeting } from "./ui";

// Only Chromium can run an SVG filter inside backdrop-filter; everyone else gets frosted glass.
// (Set here, not in an inline <script>: Chrome blocks inline scripts on extension pages.)
if (/Chrome\//.test(navigator.userAgent)) document.documentElement.classList.add("liquid");

const STORE = "wishless-tab:";

const params = new URLSearchParams(location.search);
const count = Number(params.get("count")) || undefined;

const butterflies = ANIMALS.butterflies;

// Light by day, dark at night (or whatever the drawer pins it to).
applyPageTheme();
const engine = new AnimalEngine(document.querySelector("canvas")!, { animal: "butterflies", count, theme: currentTheme() });
const theme = mountTheme(engine);

const storageKey = `${STORE}tweaks:butterflies`;

function controls(kit: ControlKit<Tuning>): [string, Control[]][] {
  const hidden = new Set<string>(butterflies.hide ?? []);
  const build = (spec: KnobSpec): Control => {
    if ("toggle" in spec) return kit.toggle(spec.key, spec.label, spec.hint);
    const knob = kit.knob(spec.key, spec.label, spec.min, spec.max, spec.step, spec.hint);
    const when = spec.disabledWhen;
    return when ? { ...knob, disabled: () => Boolean(engine.tuning[when]) } : knob;
  };
  const keep = (specs: KnobSpec[]) => specs.filter((s) => !hidden.has(s.key)).map(build);
  return [
    ["Movement", keep(SHARED_CONTROLS.movement)],
    ...butterflies.controls.map(([title, specs]): [string, Control[]] => [title, specs.map(build)]),
    ["Look", keep(SHARED_CONTROLS.look)],
  ];
}

// Tweaks panel with the greeting name input and the butterfly knobs
mountTweakPanel(engine, butterflies.defaults, controls, { storageKey, theme });

window.addEventListener("storage", (e) => {
  if (e.key === storageKey) location.reload();
});

mountComposer();
mountShortcuts();
mountGreeting();
mountClock();
