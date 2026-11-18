/**
 * Page chrome shared by every scene: liquid glass, shortcuts, and the search box.
 */

export interface Shortcut {
  id: string;
  title: string;
  url: string;
  icon: string;
}

const SHORTCUTS_STORE = "wishless-tab:shortcuts";

const DEFAULT_SHORTCUTS: Shortcut[] = [
  { id: "google", title: "Google", url: "https://www.google.com", icon: "G" },
  { id: "youtube", title: "YouTube", url: "https://www.youtube.com", icon: "▶" },
  { id: "github", title: "GitHub", url: "https://github.com", icon: "🐙" },
  { id: "reddit", title: "Reddit", url: "https://www.reddit.com", icon: "●" },
  { id: "x", title: "X", url: "https://x.com", icon: "𝕏" },
  { id: "gmail", title: "Gmail", url: "https://mail.google.com", icon: "✉" },
  { id: "chatgpt", title: "ChatGPT", url: "https://chatgpt.com", icon: "✦" },
];

/** A greeting by the local time: "Good morning, David" … "Still up, David?" after 10pm. */
export function greetingFor(name: string, date = new Date()) {
  const h = date.getHours();
  if (h >= 5 && h < 12) return `Good morning, ${name}`;
  if (h >= 12 && h < 17) return `Good afternoon, ${name}`;
  if (h >= 17 && h < 22) return `Good evening, ${name}`;
  return `Still up, ${name}?`;
}

let activeGreetingName = "David";

export function getGreetingName(): string {
  try {
    const saved = localStorage.getItem("wishless-tab:user-name");
    if (saved) return saved;
  } catch {}
  return "David";
}

export function setGreetingName(name: string) {
  activeGreetingName = name.trim() || "David";
  try {
    localStorage.setItem("wishless-tab:user-name", activeGreetingName);
  } catch {}
  const el = document.querySelector<HTMLElement>(".greeting");
  if (el) el.textContent = greetingFor(activeGreetingName);
}

/** Greet by the time of day, and keep it current if the page stays open. */
export function mountGreeting(defaultName = "David") {
  const el = document.querySelector<HTMLElement>(".greeting");
  if (!el) return;
  activeGreetingName = getGreetingName() || defaultName;

  const update = () => (el.textContent = greetingFor(activeGreetingName));
  update();
  setInterval(update, 60_000);

  el.style.cursor = "pointer";
  el.title = "Click to set your name";
  el.addEventListener("click", () => {
    const next = window.prompt("What should I call you?", activeGreetingName);
    if (next !== null && next.trim() !== "") {
      setGreetingName(next.trim());
      // Also notify any open tweaks input
      const tweaksInput = document.querySelector<HTMLInputElement>(".tweaks-name-input");
      if (tweaksInput) tweaksInput.value = next.trim();
    }
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

/** Search box: Enter goes to a typed web address, or searches Google for anything else. */
export function mountComposer() {
  const form = document.querySelector<HTMLFormElement>(".composer")!;
  const prompt = form.querySelector("textarea")!;
  const send = form.querySelector<HTMLButtonElement>(".send")!;

  function fit() {
    prompt.style.height = "auto";
    prompt.style.height = `${prompt.scrollHeight}px`;
    prompt.style.overflowY = prompt.scrollHeight > prompt.clientHeight + 1 ? "auto" : "hidden";
    send.disabled = prompt.value.trim() === "";
  }

  prompt.addEventListener("input", fit);
  if (matchMedia("(hover: hover) and (pointer: fine)").matches) prompt.focus({ preventScroll: true });
  prompt.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = prompt.value.trim();
    if (!text) return;

    if (/^https?:\/\//i.test(text)) {
      window.location.href = text;
    } else if (/^[a-z0-9-]+(\.[a-z0-9-]+)+($|\/)/i.test(text) && !text.includes(" ")) {
      window.location.href = "https://" + text;
    } else {
      window.location.href = `https://www.google.com/search?q=${encodeURIComponent(text)}`;
    }

    prompt.value = "";
    fit();
  });
}

function loadShortcuts(): Shortcut[] {
  try {
    const raw = localStorage.getItem(SHORTCUTS_STORE);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [...DEFAULT_SHORTCUTS];
}

function saveShortcuts(list: Shortcut[]) {
  try {
    localStorage.setItem(SHORTCUTS_STORE, JSON.stringify(list));
  } catch {}
}

/** Mounts customizable liquid-glass shortcuts directly below the search bar */
export function mountShortcuts(host = document.querySelector<HTMLElement>(".shortcuts-row")) {
  if (!host) return;

  let shortcuts = loadShortcuts();

  function render() {
    host!.replaceChildren();

    for (const item of shortcuts) {
      const a = document.createElement("a");
      a.className = "shortcut-pill";
      a.href = item.url;
      a.title = `${item.title} (${item.url})`;

      const iconSpan = document.createElement("span");
      iconSpan.className = "shortcut-icon";
      iconSpan.textContent = item.icon || item.title.slice(0, 1).toUpperCase();

      const titleSpan = document.createElement("span");
      titleSpan.className = "shortcut-title";
      titleSpan.textContent = item.title;

      const delBtn = document.createElement("button");
      delBtn.className = "shortcut-del";
      delBtn.type = "button";
      delBtn.title = "Delete shortcut";
      delBtn.innerHTML = "&times;";
      delBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        shortcuts = shortcuts.filter((s) => s.id !== item.id);
        saveShortcuts(shortcuts);
        render();
      });

      a.append(iconSpan, titleSpan, delBtn);
      host!.append(a);
    }

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "shortcut-add";
    addBtn.title = "Add custom shortcut";
    addBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg><span>Add</span>`;

    addBtn.addEventListener("click", () => {
      const title = window.prompt("Shortcut Name (e.g. Netflix, Notion):");
      if (!title || !title.trim()) return;
      let url = window.prompt("Shortcut URL (e.g. https://notion.so):");
      if (!url || !url.trim()) return;
      url = url.trim();
      if (!/^https?:\/\//i.test(url)) url = "https://" + url;

      const id = "sc-" + Date.now();
      const icon = title.trim().slice(0, 2).toUpperCase();
      shortcuts.push({ id, title: title.trim(), url, icon });
      saveShortcuts(shortcuts);
      render();
    });

    host!.append(addBtn);
  }

  render();
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
