/**
 * Page chrome shared by every scene: greeting, clock, landing ledges, and segmented choices.
 * The search box lives in search.ts, the shortcut pills in shortcuts.ts.
 */

const NAME_KEY = "wishless-tab:user-name";

/**
 * A greeting by the local time: "Good morning" … "Still up?" after 10pm, with the user's name
 * once they've set one ("Good morning, Sam").
 */
export function greetingFor(name: string, date = new Date()) {
  const h = date.getHours();
  const to = name ? `, ${name}` : "";
  if (h >= 5 && h < 12) return `Good morning${to}`;
  if (h >= 12 && h < 17) return `Good afternoon${to}`;
  if (h >= 17 && h < 22) return `Good evening${to}`;
  return `Still up${to}?`;
}

let activeGreetingName = "";

/** The name the user set, or "" for none. */
export function getGreetingName(): string {
  try {
    return localStorage.getItem(NAME_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

/** Set (or, with "", clear) the name in the greeting. */
export function setGreetingName(name: string) {
  activeGreetingName = name.trim();
  try {
    if (activeGreetingName) localStorage.setItem(NAME_KEY, activeGreetingName);
    else localStorage.removeItem(NAME_KEY);
  } catch {}
  const el = document.querySelector<HTMLElement>(".greeting");
  if (el) el.textContent = greetingFor(activeGreetingName);
}

/** Greet by the time of day, and keep it current if the page stays open. Click it to set a name. */
export function mountGreeting() {
  const el = document.querySelector<HTMLElement>(".greeting");
  if (!el) return;
  activeGreetingName = getGreetingName();

  const update = () => (el.textContent = greetingFor(activeGreetingName));
  update();
  setInterval(update, 60_000);

  el.style.cursor = "pointer";
  el.title = "Click to set your name";
  el.addEventListener("click", () => {
    const next = window.prompt("What should I call you? (Leave empty for no name.)", activeGreetingName);
    if (next === null) return;
    setGreetingName(next);
    // Keep the drawer's name field in step.
    const field = document.querySelector<HTMLInputElement>(".tweaks-name-input");
    if (field) field.value = next.trim();
  });
}

/** Big clock above the greeting, in the system's own 12/24-hour style, plus today's date. */
export function mountClock() {
  const timeEl = document.querySelector<HTMLTimeElement>(".clock-time");
  const dateEl = document.querySelector<HTMLElement>(".clock-date");
  if (!timeEl) return;

  const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  const dateFormat = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" });
  let shown = "";

  const update = () => {
    const now = new Date();
    const parts = timeFormat.formatToParts(now);
    const key = parts.map((p) => p.value).join("");
    if (key === shown) return;
    shown = key;

    const nodes: Node[] = [];
    for (const p of parts) {
      if (p.type === "hour" || p.type === "minute") {
        nodes.push(document.createTextNode(p.value));
      } else if (p.type === "dayPeriod") {
        const span = document.createElement("span");
        span.className = "period";
        span.textContent = p.value;
        nodes.push(span);
      } else if (p.value.trim() === ":" || p.value.trim() === ".") {
        const span = document.createElement("span");
        span.className = "sep";
        span.textContent = p.value.trim();
        nodes.push(span);
      }
    }
    timeEl.replaceChildren(...nodes);
    timeEl.dateTime = now.toISOString();
    if (dateEl) dateEl.textContent = dateFormat.format(now);
  };

  update();
  setInterval(update, 1000);
}

/** A ledge creatures can land on (client px); the engine's Perch. */
export interface Ledge {
  id: string;
  x0: number;
  x1: number;
  y: number;
  keepOut?: [number, number][];
}

let metrics: CanvasRenderingContext2D | null = null;

/**
 * Where butterflies may land: the top edge of the search box (except under the greeting and clock,
 * whose text would cover them) and the top of the clock's digits.
 */
export function measureLedges(): Ledge[] {
  const ledges: Ledge[] = [];
  const composer = document.querySelector<HTMLElement>(".composer");
  const time = document.querySelector<HTMLElement>(".clock-time");
  const greeting = document.querySelector<HTMLElement>(".greeting");

  const above: [number, number][] = [];
  for (const el of [time, greeting]) {
    const r = el?.getBoundingClientRect();
    if (r && r.width) above.push([r.left - 12, r.right + 12]);
  }

  if (composer) {
    const r = composer.getBoundingClientRect();
    const radius = parseFloat(getComputedStyle(composer).borderTopLeftRadius) || 0;
    ledges.push({ id: "composer", x0: r.left + radius, x1: r.right - radius, y: r.top, keepOut: above });
  }

  if (time && time.textContent) {
    // The digits' tops, not the line box (line-height 1 leaves room above the glyphs).
    metrics ??= document.createElement("canvas").getContext("2d");
    const r = time.getBoundingClientRect();
    const cs = getComputedStyle(time);
    let top = r.top;
    if (metrics) {
      metrics.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const m = metrics.measureText("0123456789");
      const baseline = r.top + (r.height - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
      top = baseline - m.actualBoundingBoxAscent;
    }
    const period = time.querySelector<HTMLElement>(".period")?.getBoundingClientRect();
    ledges.push({ id: "clock", x0: r.left, x1: period && period.width ? period.left - 4 : r.right, y: top - 6 });
  }
  return ledges;
}

export interface Choice {
  value: string;
  label: string;
  swatch?: string;
}

/**
 * A row of segmented buttons with a thumb sliding under the chosen one (arrow keys move it).
 * `current` may match none of them; the returned `select()` changes the choice without calling onPick.
 */
export function mountChoices(host: HTMLElement, choices: Choice[], current: string, onPick: (value: string) => void) {
  const thumb = document.createElement("span");
  thumb.className = "thumb";
  thumb.setAttribute("aria-hidden", "true");
  host.append(thumb);

  const buttons = choices.map((c) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "radio");
    b.dataset.value = c.value;
    const dot = c.swatch ? `<span class="dot" style="--swatch: ${c.swatch}" aria-hidden="true"></span>` : "";
    b.innerHTML = `${dot}<span>${c.label}</span>`;
    b.addEventListener("click", () => select(c.value, true));
    host.append(b);
    return b;
  });

  function place() {
    const b = buttons.find((x) => x.getAttribute("aria-checked") === "true");
    thumb.style.opacity = b ? "1" : "0";
    if (!b) return;
    thumb.style.translate = `${b.offsetLeft}px 0`;
    thumb.style.width = `${b.offsetWidth}px`;
  }

  function select(value: string, pick: boolean) {
    const any = buttons.some((b) => b.dataset.value === value);
    buttons.forEach((b, i) => {
      const on = b.dataset.value === value;
      b.setAttribute("aria-checked", String(on));
      // Keep one button tabbable even when none is chosen.
      b.tabIndex = on || (!any && i === 0) ? 0 : -1;
      // Only on a pick: scrolling a hidden drawer into view would shift the page.
      if (on && pick) b.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    place();
    if (pick) onPick(value);
  }

  host.addEventListener("keydown", (e) => {
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0 || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
    e.preventDefault();
    const next = buttons[(at + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length];
    next.focus();
    select(next.dataset.value!, true);
  });

  select(current, false);
  document.fonts?.ready.then(place);
  window.addEventListener("resize", place);

  return {
    select: (value: string) => select(value, false),
    /** Re-measure, e.g. once a hidden container is shown. */
    place,
    destroy: () => window.removeEventListener("resize", place),
  };
}
