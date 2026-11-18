/**
 * Settings drawer. Hidden until the mouse rests at the left or right edge for a second, the gear
 * in the corner is clicked, or T is pressed.
 *
 *   Scene     theme, creature, a mood preset, and the four sliders most people want
 *   Profile   the name in the greeting
 *   Advanced  (collapsed) every other knob, the search box glass, Copy and Reset
 */
import type { ThemeMode } from "./theme";
import { getGreetingName, mountChoices, setGreetingName } from "./ui";

const GLASS_DEFAULTS = {
  blur: 3.5,
  refraction: 40,
  ripple: 0.007,
  tint: 0,
  edge: 0.55,
  radius: 24,
  width: 720,
};

type Glass = typeof GLASS_DEFAULTS;

/** The glass belongs to the page, not to an animal, so it has its own key. */
const GLASS_KEY = "wishless-tab:glass";

interface Range {
  kind: "range";
  /** The tuning key behind it, when there is one. */
  key?: string;
  label: string;
  hint?: string;
  min: number;
  max: number;
  step: number;
  def: number;
  get(): number;
  set(v: number): void;
  disabled?(): boolean;
}

interface Toggle {
  kind: "toggle";
  key?: string;
  label: string;
  hint?: string;
  def: boolean;
  get(): boolean;
  set(v: boolean): void;
}

export type Control = Range | Toggle;

type Knobs = Record<string, number | boolean>;

export interface Tunable<T extends Knobs> {
  readonly tuning: T;
  set<K extends keyof T>(key: K, value: T[K]): void;
}

export interface ControlKit<T extends Knobs> {
  knob(key: keyof T, label: string, min: number, max: number, step: number, hint?: string): Range;
  toggle(key: keyof T, label: string, hint?: string): Toggle;
}

export interface AnimalChoice {
  key: string;
  label: string;
  swatch: string;
}

/** The sliders shown up front, pulled out of the animal's groups (everything else goes under Advanced). */
const MAIN: { key: string; label: string; hint: string }[] = [
  { key: "density", label: "Amount", hint: "How many are on screen." },
  { key: "speed", label: "Speed", hint: "How fast they travel." },
  { key: "size", label: "Size", hint: "How big they are." },
  { key: "hueShift", label: "Colour", hint: "Turns their colours around the colour wheel. 0 is their natural colour." },
];

/** Presets scale the current animal's own defaults, so they suit every animal. */
const PRESETS: Record<string, Partial<Record<"density" | "speed" | "size", number>>> = {
  calm: { density: 0.6, speed: 0.65 },
  lively: {},
  swarm: { density: 2.2, speed: 1.3, size: 0.8 },
  still: { density: 0.5, speed: 0.2 },
};
const PRESET_KEYS = ["density", "speed", "size"] as const;

function load<T>(storageKey: string): { tuning?: Partial<T>; glass?: Partial<Glass> } {
  try {
    return JSON.parse(localStorage.getItem(storageKey) ?? "{}");
  } catch {
    return {};
  }
}

function loadGlass(fallback?: Partial<Glass>): Partial<Glass> {
  try {
    const raw = localStorage.getItem(GLASS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  // Older versions kept the glass with the butterflies' settings.
  return fallback ?? {};
}

function changed<T extends object>(values: T, defaults: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    if (values[key] !== defaults[key]) out[key] = values[key];
  }
  return out;
}

function applyGlass(g: Glass) {
  const composer = document.querySelector<HTMLElement>(".composer");
  if (composer) {
    composer.style.setProperty("--blur", `${g.blur}px`);
    composer.style.borderRadius = `${g.radius}px`;
    composer.style.width = `min(${g.width}px, calc(100vw - 32px))`;
  }
  document.documentElement.style.setProperty("--tint", String(g.tint));
  document.documentElement.style.setProperty("--edge", String(g.edge));
  document.querySelector("#liquid-glass feDisplacementMap")?.setAttribute("scale", String(g.refraction));
  document.querySelector("#liquid-glass feTurbulence")?.setAttribute("baseFrequency", `${g.ripple} ${g.ripple * 1.5}`);
}

const decimals = (step: number) => (step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step))));

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

const GEAR = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;

export function mountTweakPanel<T extends Knobs>(
  engine: Tunable<T>,
  defaults: T,
  groups: (kit: ControlKit<T>) => [string, Control[]][],
  {
    storageKey = "tweaks",
    onChange,
    animals = [],
    currentAnimal = "",
    onPickAnimal,
    theme,
  }: {
    storageKey?: string;
    onChange?: () => void;
    animals?: AnimalChoice[];
    currentAnimal?: string;
    onPickAnimal?: (key: string) => void;
    /** The time-of-day theme, to pick Auto / Light / Dark. */
    theme?: { readonly mode: ThemeMode; setMode(mode: ThemeMode): void };
  } = {},
) {
  let activeStorageKey = storageKey;
  let activeDefaults = defaults;
  let activeGroups = groups;
  let activeAnimal = currentAnimal;

  // Read the tuning live: setAnimal() gives the engine a new tuning object.
  const tune = () => engine.tuning;

  const restore = (key: string) => {
    for (const [k, value] of Object.entries(load<T>(key).tuning ?? {})) {
      if (k in activeDefaults) engine.set(k as keyof T, value as never);
    }
  };
  restore(activeStorageKey);
  const glass: Glass = { ...GLASS_DEFAULTS, ...loadGlass(load<T>(activeStorageKey).glass) };
  applyGlass(glass);

  const save = () => {
    try {
      localStorage.setItem(activeStorageKey, JSON.stringify({ tuning: changed(tune(), activeDefaults) }));
      localStorage.setItem(GLASS_KEY, JSON.stringify(changed(glass, GLASS_DEFAULTS)));
    } catch {}
    onChange?.();
  };

  const kit: ControlKit<T> = {
    knob: (key, label, min, max, step, hint) => ({
      kind: "range", key: String(key), label, min, max, step, hint,
      def: activeDefaults[key] as number,
      get: () => tune()[key] as number,
      set: (v) => engine.set(key, v as T[typeof key]),
    }),
    toggle: (key, label, hint) => ({
      kind: "toggle", key: String(key), label, hint,
      def: activeDefaults[key] as boolean,
      get: () => tune()[key] as boolean,
      set: (v) => engine.set(key, v as T[typeof key]),
    }),
  };

  const pane = <K extends keyof Glass>(key: K, label: string, min: number, max: number, step: number, hint: string): Range => ({
    kind: "range", label, min, max, step, hint,
    def: GLASS_DEFAULTS[key],
    get: () => glass[key],
    set: (v) => {
      glass[key] = v;
      applyGlass(glass);
    },
  });

  // ── presets ──

  const presetValue = (name: string, key: (typeof PRESET_KEYS)[number]) =>
    (activeDefaults[key] as number) * (PRESETS[name][key] ?? 1);

  /** The preset the current values match, or "" when they've been hand-tuned. */
  const matchPreset = () => {
    const t = tune();
    return Object.keys(PRESETS).find((name) =>
      PRESET_KEYS.every((key) => key in activeDefaults && Math.abs((t[key] as number) - presetValue(name, key)) < 1e-6),
    ) ?? "";
  };

  const applyPreset = (name: string) => {
    for (const key of PRESET_KEYS) {
      if (key in activeDefaults) engine.set(key, presetValue(name, key) as T[typeof key]);
    }
  };

  // ── DOM ──

  const panel = el("aside", "tweaks glass");
  panel.setAttribute("aria-label", "Settings");

  const header = el("header", "tweaks-head");
  const title = el("h2", "", "Settings");
  const close = el("button", "tweaks-close");
  close.setAttribute("aria-label", "Close settings");
  close.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>`;
  header.append(title, close);

  const body = el("div", "tweaks-body");
  panel.append(header, body);

  const gear = el("button", "tweaks-gear");
  gear.type = "button";
  gear.setAttribute("aria-label", "Settings");
  gear.title = "Settings (T)";
  gear.innerHTML = GEAR;

  // Tooltip beside the drawer, explaining the hovered setting.
  const tip = el("div", "tweaks-tip");
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  const showTip = (row: HTMLElement, hint?: string) => {
    if (!hint) return;
    tip.innerHTML = "";
    tip.append(el("span", "", hint), el("small", "", "Double-click the name to reset it."));
    tip.hidden = false;
    const r = row.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    tip.style.right = `${window.innerWidth - p.left + 10}px`;
    tip.style.top = `${Math.max(8, Math.min(window.innerHeight - tip.offsetHeight - 8, r.top + r.height / 2 - tip.offsetHeight / 2))}px`;
  };
  const hideTip = () => (tip.hidden = true);

  // Edge hotzones: rest the mouse at the left or right edge for a second to open.
  const hotzoneRight = el("div", "edge-hotzone right");
  const hotzoneLeft = el("div", "edge-hotzone left");

  let hoverTimer: number | null = null;
  let closeTimer: number | null = null;

  const startHoverTimer = (hz: HTMLElement) => {
    if (panel.classList.contains("open")) return;
    hz.classList.add("priming");
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = window.setTimeout(() => {
      hz.classList.remove("priming");
      setOpen(true);
    }, 1000);
  };

  const cancelHoverTimer = (hz: HTMLElement) => {
    hz.classList.remove("priming");
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
  };

  for (const hz of [hotzoneLeft, hotzoneRight]) {
    hz.addEventListener("mouseenter", () => startHoverTimer(hz));
    hz.addEventListener("mouseleave", () => cancelHoverTimer(hz));
  }

  panel.addEventListener("mouseenter", () => {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  });
  panel.addEventListener("mouseleave", () => {
    if (closeTimer) clearTimeout(closeTimer);
    // Not while something in the drawer has focus (typing a name, a slider held by keyboard).
    closeTimer = window.setTimeout(() => {
      if (!panel.contains(document.activeElement)) setOpen(false);
    }, 1200);
  });

  let refreshers: (() => void)[] = [];
  let cleanups: (() => void)[] = [];
  const refreshAll = () => refreshers.forEach((r) => r());

  /** One slider or switch row. */
  function row(c: Control) {
    const line = el("label", `tweaks-row ${c.kind}`);
    const label = el("span", "tweaks-label", c.label);
    line.addEventListener("pointerenter", () => showTip(line, c.hint));
    line.addEventListener("pointerleave", hideTip);
    line.addEventListener("focusin", () => showTip(line, c.hint));
    line.addEventListener("focusout", hideTip);

    if (c.kind === "toggle") {
      const box = el("input");
      box.type = "checkbox";
      box.addEventListener("change", () => {
        c.set(box.checked);
        refreshAll();
        save();
      });
      refreshers.push(() => (box.checked = c.get()));
      label.addEventListener("dblclick", (e) => {
        e.preventDefault();
        c.set(c.def);
        refreshAll();
        save();
      });
      line.append(label, box);
      return line;
    }

    const out = el("output", "tweaks-value");
    const input = el("input");
    input.type = "range";
    input.min = String(c.min);
    input.max = String(c.max);
    input.step = String(c.step);
    const show = () => {
      const v = c.get();
      input.value = String(v);
      out.textContent = v.toFixed(decimals(c.step));
      input.style.setProperty("--fill", `${((v - c.min) / (c.max - c.min)) * 100}%`);
      const off = c.disabled?.() ?? false;
      input.disabled = off;
      line.classList.toggle("off", off);
    };
    input.addEventListener("input", () => {
      c.set(Number(input.value));
      refreshAll();
      save();
    });
    label.addEventListener("dblclick", (e) => {
      e.preventDefault();
      c.set(c.def);
      refreshAll();
      save();
    });
    refreshers.push(show);
    line.append(label, out, input);
    return line;
  }

  /** A labelled segmented control. */
  function choiceRow(name: string, host: HTMLElement) {
    const wrap = el("div", "tweaks-field");
    wrap.append(el("span", "tweaks-field-label", name), host);
    host.setAttribute("role", "radiogroup");
    host.setAttribute("aria-label", name);
    return wrap;
  }

  function section(name: string, ...children: HTMLElement[]) {
    const s = el("section", "tweaks-group");
    s.append(el("h3", "", name), ...children);
    return s;
  }

  function buildBody() {
    cleanups.forEach((f) => f());
    body.replaceChildren();
    refreshers = [];
    cleanups = [];

    const all = activeGroups(kit);
    const mainKeys = new Set(MAIN.map((m) => m.key));
    const main = MAIN.flatMap(({ key, label, hint }) => {
      for (const [, controls] of all) {
        const found = controls.find((c) => c.key === key);
        if (found) return [{ ...found, label, hint } as Control];
      }
      return [];
    });

    // 1. Scene
    const look: HTMLElement[] = [];
    if (theme) {
      const host = el("div", "choices");
      look.push(choiceRow("Theme", host));
      const c = mountChoices(host, [
        { value: "auto", label: "Auto" },
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
      ], theme.mode, (v) => theme.setMode(v as ThemeMode));
      cleanups.push(c.destroy);
    }
    if (animals.length > 1) {
      const host = el("div", "choices");
      look.push(choiceRow("Creature", host));
      const c = mountChoices(host, animals.map((a) => ({ value: a.key, label: a.label, swatch: a.swatch })), activeAnimal, (key) => {
        if (key === activeAnimal) return;
        activeAnimal = key;
        onPickAnimal?.(key);
      });
      cleanups.push(c.destroy);
    }
    {
      const host = el("div", "choices");
      look.push(choiceRow("Mood", host));
      const c = mountChoices(host, [
        { value: "calm", label: "Calm" },
        { value: "lively", label: "Lively" },
        { value: "swarm", label: "Swarm" },
        { value: "still", label: "Still" },
      ], matchPreset(), (name) => {
        applyPreset(name);
        refreshAll();
        save();
      });
      cleanups.push(c.destroy);
      refreshers.push(() => c.select(matchPreset()));
    }
    look.push(...main.map(row));
    body.append(section("Scene", ...look));

    // 2. Profile
    const nameRow = el("div", "tweaks-field");
    const nameLabel = el("label", "tweaks-field-label", "Greeting name");
    const nameInput = el("input", "tweaks-name-input");
    nameInput.type = "text";
    nameInput.id = "tweaks-name";
    nameLabel.htmlFor = nameInput.id;
    nameInput.value = getGreetingName();
    nameInput.placeholder = "David";
    nameInput.addEventListener("input", () => setGreetingName(nameInput.value));
    nameRow.append(nameLabel, nameInput);
    body.append(section("Profile", nameRow));

    // 3. Advanced: everything else, collapsed.
    const advanced = el("details", "tweaks-advanced");
    advanced.append(el("summary", "", "Advanced"));
    const rest: [string, Control[]][] = [
      ...all.map(([name, controls]): [string, Control[]] => [name, controls.filter((c) => !c.key || !mainKeys.has(c.key))]),
      ["Search box", [
        pane("blur", "Blur (px)", 0, 30, 0.5, "How frosted the search box is."),
        pane("refraction", "Refraction", 0, 150, 1, "How strongly the glass bends what's behind it."),
        pane("ripple", "Ripple", 0.001, 0.04, 0.001, "Size of the refraction ripples."),
        pane("tint", "Tint", 0, 3, 0.05, "How milky the glass is."),
        pane("edge", "Edge", 0, 2, 0.05, "Strength of the glass rims and borders."),
        pane("radius", "Corner radius", 0, 48, 1, "Rounding of the search box corners."),
        pane("width", "Width", 320, 960, 10, "Width of the search box."),
      ]],
    ];
    for (const [name, controls] of rest) {
      if (controls.length) advanced.append(section(name, ...controls.map(row)));
    }

    const actions = el("div", "tweaks-actions");
    const copy = el("button", "tweaks-action", "Copy settings");
    copy.type = "button";
    copy.title = "Copy these settings as JSON";
    const reset = el("button", "tweaks-action", "Reset all");
    reset.type = "button";
    actions.append(copy, reset);
    advanced.append(actions);
    body.append(advanced);

    copy.addEventListener("click", async () => {
      const json = JSON.stringify({ tuning: changed(tune(), activeDefaults), glass: changed(glass, GLASS_DEFAULTS) }, null, 2);
      try {
        await navigator.clipboard.writeText(json);
        copy.textContent = "Copied";
      } catch {
        copy.textContent = "In console";
        console.log(json);
      }
      setTimeout(() => (copy.textContent = "Copy settings"), 1400);
    });

    // Reset asks once: the first click arms it for three seconds.
    let armed = 0;
    const disarm = () => {
      clearTimeout(armed);
      armed = 0;
      reset.textContent = "Reset all";
      reset.classList.remove("confirm");
    };
    reset.addEventListener("click", () => {
      if (!armed) {
        reset.textContent = "Reset everything?";
        reset.classList.add("confirm");
        armed = window.setTimeout(disarm, 3000);
        return;
      }
      disarm();
      for (const key of Object.keys(activeDefaults) as (keyof T)[]) engine.set(key, activeDefaults[key]);
      Object.assign(glass, GLASS_DEFAULTS);
      applyGlass(glass);
      refreshAll();
      try {
        localStorage.removeItem(activeStorageKey);
        localStorage.removeItem(GLASS_KEY);
      } catch {}
      onChange?.();
    });

    refreshAll();
  }

  buildBody();

  const setOpen = (open: boolean) => {
    panel.classList.toggle("open", open);
    gear.setAttribute("aria-expanded", String(open));
    if (!open) hideTip();
  };

  close.addEventListener("click", () => setOpen(false));
  gear.addEventListener("click", () => setOpen(!panel.classList.contains("open")));

  // Esc closes, T toggles (not while typing).
  const onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest("input, textarea, [contenteditable]")) {
      if (e.key === "Escape" && panel.contains(target)) setOpen(false);
      return;
    }
    if (e.key === "Escape" && panel.classList.contains("open")) {
      setOpen(false);
    } else if (e.key.toLowerCase() === "t" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      setOpen(!panel.classList.contains("open"));
    }
  };
  window.addEventListener("keydown", onKey);

  document.body.append(hotzoneLeft, hotzoneRight, gear, panel, tip);

  return {
    sync() {
      refreshAll();
      save();
    },
    /** Show another animal's knobs and saved settings (after engine.setAnimal). */
    updateAnimal(newKey: string, newDefaults: T, newGroups: (kit: ControlKit<T>) => [string, Control[]][], newStorageKey: string) {
      activeAnimal = newKey;
      activeDefaults = newDefaults;
      activeGroups = newGroups;
      activeStorageKey = newStorageKey;
      restore(activeStorageKey);
      buildBody();
    },
    destroy() {
      cleanups.forEach((f) => f());
      window.removeEventListener("keydown", onKey);
      for (const node of [panel, hotzoneLeft, hotzoneRight, gear, tip]) node.remove();
    },
  };
}
