/**
 * The search box. Enter searches Google, opens a typed web address, searches one site when the text
 * starts with a prefix ("yt lofi" → YouTube), or opens the shortcut picked with Tab.
 */
import type { Shortcut, ShortcutsControl } from "./shortcuts";

interface Site {
  name: string;
  url: (query: string) => string;
}

const q = encodeURIComponent;

/** "<prefix> <query>" searches that site instead of Google. */
export const PREFIXES: Record<string, Site> = {
  yt: { name: "YouTube", url: (s) => `https://www.youtube.com/results?search_query=${q(s)}` },
  gh: { name: "GitHub", url: (s) => `https://github.com/search?q=${q(s)}` },
  r: { name: "Reddit", url: (s) => `https://www.reddit.com/search/?q=${q(s)}` },
  w: { name: "Wikipedia", url: (s) => `https://en.wikipedia.org/w/index.php?search=${q(s)}` },
  m: { name: "Google Maps", url: (s) => `https://www.google.com/maps/search/${q(s)}` },
  // "img", not "i": plenty of ordinary searches start with "i ".
  img: { name: "Google Images", url: (s) => `https://www.google.com/search?tbm=isch&q=${q(s)}` },
};

/** The site a prefix picks, and the rest of the text to search for. */
export function parsePrefix(text: string): (Site & { query: string }) | null {
  const m = /^(\S+)\s+([\s\S]*)$/.exec(text.trimStart());
  const site = m && PREFIXES[m[1].toLowerCase()];
  return site ? { ...site, query: m[2].trim() } : null;
}

/** Where Enter goes for this text (no prefix, no shortcut picked). */
export function destinationFor(text: string) {
  if (/^https?:\/\//i.test(text)) return text;
  if (/^localhost(:\d+)?(\/|$)/i.test(text)) return "http://" + text;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?($|\/)/i.test(text) && !/\s/.test(text)) return "https://" + text;
  return `https://www.google.com/search?q=${q(text)}`;
}

const TIP = "yt, gh, r, w, m or img and a space searches that site";

export function mountComposer(shortcuts?: ShortcutsControl | null) {
  const form = document.querySelector<HTMLFormElement>(".composer")!;
  const prompt = form.querySelector("textarea")!;
  const send = form.querySelector<HTMLButtonElement>(".send")!;
  const hint = form.querySelector<HTMLElement>(".composer-hint");

  /** Shortcuts matching a one-word entry, and the one picked with Tab (-1: none). */
  let matches: Shortcut[] = [];
  let picked = -1;

  const pickedShortcut = () => (picked >= 0 ? matches[picked] : null);

  function showHint() {
    if (!hint) return;
    const text = prompt.value;
    const prefix = parsePrefix(text);
    hint.replaceChildren();
    hint.classList.remove("tip");
    if (prefix) {
      const chip = document.createElement("span");
      chip.className = "composer-chip";
      chip.textContent = prefix.name;
      hint.append(chip, prefix.query ? "" : document.createTextNode("type what to search for"));
    } else if (pickedShortcut()) {
      hint.append(key("Enter"), ` opens ${pickedShortcut()!.title} · `, key("Esc"), " to search instead");
    } else if (matches.length) {
      const more = matches.length > 1 ? ` (${matches.length} matches)` : "";
      hint.append(key("Tab"), ` to open ${matches[0].title}${more}`);
    } else if (!text && document.activeElement === prompt) {
      hint.classList.add("tip");
      hint.textContent = TIP;
    }
  }

  function key(name: string) {
    const k = document.createElement("kbd");
    k.textContent = name;
    return k;
  }

  function pick(index: number) {
    picked = index;
    shortcuts?.select(pickedShortcut()?.id ?? null);
    showHint();
  }

  function update() {
    prompt.style.height = "auto";
    prompt.style.height = `${prompt.scrollHeight}px`;
    prompt.style.overflowY = prompt.scrollHeight > prompt.clientHeight + 1 ? "auto" : "hidden";

    const text = prompt.value.trim();
    const prefix = parsePrefix(prompt.value);
    // Filter shortcuts only for a single word; a sentence is a search.
    const word = Boolean(text) && !prefix && !/\s/.test(text);
    matches = shortcuts?.filter(word ? text : "") ?? [];
    picked = -1;
    shortcuts?.select(null);
    send.disabled = prefix ? !prefix.query : !text;
    showHint();
  }

  prompt.addEventListener("input", update);
  prompt.addEventListener("focus", showHint);
  prompt.addEventListener("blur", () => {
    // Leaving the box drops the pick, so the shortcuts don't stay dimmed behind a hidden choice.
    if (!prompt.value) shortcuts?.filter("");
    showHint();
  });
  if (matchMedia("(hover: hover) and (pointer: fine)").matches) prompt.focus({ preventScroll: true });

  prompt.addEventListener("keydown", (e) => {
    if (e.isComposing) return;
    if ((e.key === "Tab" && !e.shiftKey) || e.key === "ArrowDown") {
      if (!matches.length) return;
      e.preventDefault();
      pick((picked + 1) % matches.length);
    } else if ((e.key === "Tab" && e.shiftKey) || e.key === "ArrowUp") {
      if (picked < 0) return;
      e.preventDefault();
      pick(picked - 1);
    } else if (e.key === "Escape" && picked >= 0) {
      e.preventDefault();
      pick(-1);
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = prompt.value.trim();
    const chosen = pickedShortcut();
    const prefix = parsePrefix(prompt.value);
    let target: string | null = null;
    if (chosen) target = chosen.url;
    else if (prefix) target = prefix.query ? prefix.url(prefix.query) : null;
    else if (text) target = destinationFor(text);
    if (!target) return;
    window.location.href = target;
  });

  update();
}
