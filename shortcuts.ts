/**
 * The row of shortcut pills under the search box: site icons, an inline form to add or edit one,
 * × to remove, and drag to reorder. Saved in localStorage.
 */

export interface Shortcut {
  id: string;
  title: string;
  url: string;
  /** Older saves carried an emoji or letters here; only used if a site icon can't be shown. */
  icon?: string;
}

const STORE = "wishless-tab:shortcuts";

const DEFAULT_SHORTCUTS: Shortcut[] = [
  { id: "google", title: "Google", url: "https://www.google.com" },
  { id: "youtube", title: "YouTube", url: "https://www.youtube.com" },
  { id: "github", title: "GitHub", url: "https://github.com" },
  { id: "reddit", title: "Reddit", url: "https://www.reddit.com" },
  { id: "x", title: "X", url: "https://x.com" },
  { id: "gmail", title: "Gmail", url: "https://mail.google.com" },
  { id: "chatgpt", title: "ChatGPT", url: "https://chatgpt.com" },
];

/** Drag data type, so a dragged pill isn't mistaken for a link dropped from elsewhere. */
const DRAG_TYPE = "application/x-wishless-shortcut";

const PENCIL = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>`;
const CROSS = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`;

function load(): Shortcut[] {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list.filter((s) => s && typeof s.url === "string" && typeof s.title === "string");
    }
  } catch {}
  return DEFAULT_SHORTCUTS.map((s) => ({ ...s }));
}

function save(list: Shortcut[]) {
  try {
    localStorage.setItem(STORE, JSON.stringify(list));
  } catch {}
}

/** The extension's own runtime, when running as the installed extension (not on the dev server). */
function extensionRuntime(): { id?: string; getURL(path: string): string } | null {
  const chromeApi = (globalThis as { chrome?: { runtime?: { id?: string; getURL(path: string): string } } }).chrome;
  return chromeApi?.runtime?.id ? chromeApi.runtime : null;
}

/** The site's icon from Chrome's own favicon cache (needs the "favicon" permission); null on the dev server. */
function faviconFor(url: string): string | null {
  const runtime = extensionRuntime();
  return runtime ? runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`) : null;
}

/** "notion.so" → https://notion.so/. Returns null for anything that isn't a web address. */
export function normaliseUrl(input: string): string | null {
  let text = input.trim();
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = "https://" + text;
  try {
    const u = new URL(text);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname.includes(".") && u.hostname !== "localhost") return null;
    return u.href;
  } catch {
    return null;
  }
}

/** A readable name from an address: https://www.notion.so → "Notion". */
function nameFromUrl(url: string) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const word = host.split(".")[0];
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Mounts the shortcut pills (and their add/edit form) into `host`. */
export function mountShortcuts(host = document.querySelector<HTMLElement>(".shortcuts-row")) {
  let shortcuts = load();
  if (!host) return null;
  const row = host;

  // ── add / edit form ──

  const form = document.createElement("form");
  form.className = "shortcut-form glass";
  form.hidden = true;
  form.noValidate = true;
  form.innerHTML = `
    <label class="shortcut-field"><span>Name</span><input name="title" type="text" placeholder="Netflix" autocomplete="off" spellcheck="false" /></label>
    <label class="shortcut-field"><span>Address</span><input name="url" type="text" placeholder="netflix.com" autocomplete="off" spellcheck="false" inputmode="url" /></label>
    <p class="shortcut-error" role="alert" hidden></p>
    <div class="shortcut-form-bar">
      <button type="button" class="shortcut-cancel">Cancel</button>
      <button type="submit" class="shortcut-save">Add</button>
    </div>`;
  row.after(form);
  const titleInput = form.querySelector<HTMLInputElement>('input[name="title"]')!;
  const urlInput = form.querySelector<HTMLInputElement>('input[name="url"]')!;
  const error = form.querySelector<HTMLElement>(".shortcut-error")!;
  const saveBtn = form.querySelector<HTMLButtonElement>(".shortcut-save")!;

  /** The shortcut being edited, or null when adding. */
  let editing: Shortcut | null = null;
  /** Where focus goes back to when the form closes. */
  let opener: HTMLElement | null = null;

  function openForm(item: Shortcut | null, from: HTMLElement) {
    editing = item;
    opener = from;
    titleInput.value = item?.title ?? "";
    urlInput.value = item ? item.url.replace(/^https:\/\//, "").replace(/\/$/, "") : "";
    saveBtn.textContent = item ? "Save" : "Add";
    form.setAttribute("aria-label", item ? `Edit ${item.title}` : "Add a shortcut");
    showError("");
    form.hidden = false;
    (item ? titleInput : urlInput).focus();
    (item ? titleInput : urlInput).select();
  }

  function closeForm() {
    if (form.hidden) return;
    form.hidden = true;
    editing = null;
    opener?.focus({ preventScroll: true });
    opener = null;
  }

  function showError(message: string) {
    error.textContent = message;
    error.hidden = !message;
    urlInput.setAttribute("aria-invalid", String(Boolean(message)));
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const url = normaliseUrl(urlInput.value);
    if (!url) {
      showError("That doesn't look like a web address.");
      urlInput.focus();
      return;
    }
    const title = titleInput.value.trim() || nameFromUrl(url);
    if (editing) {
      Object.assign(editing, { title, url });
      delete editing.icon;
    } else {
      shortcuts.push({ id: `sc-${Date.now().toString(36)}`, title, url });
    }
    save(shortcuts);
    render();
    closeForm();
  });
  urlInput.addEventListener("input", () => showError(""));
  form.querySelector(".shortcut-cancel")!.addEventListener("click", closeForm);
  form.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeForm();
    }
  });
  // Clicking anywhere else closes it.
  document.addEventListener("pointerdown", (e) => {
    const target = e.target as Node;
    if (!form.hidden && !form.contains(target) && !(opener && opener.contains(target))) closeForm();
  });

  // ── pills ──

  function icon(item: Shortcut) {
    const box = document.createElement("span");
    box.className = "shortcut-icon";
    const letter = () => {
      box.replaceChildren(document.createTextNode(item.title.slice(0, 1).toUpperCase() || "?"));
    };
    const src = faviconFor(item.url);
    if (src) {
      const img = document.createElement("img");
      img.alt = "";
      img.width = 16;
      img.height = 16;
      img.decoding = "async";
      img.draggable = false;
      img.addEventListener("error", letter, { once: true });
      img.src = src;
      box.classList.add("has-img");
      box.append(img);
    } else {
      letter();
    }
    return box;
  }

  function badge(className: string, label: string, svg: string, onClick: (e: MouseEvent) => void) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `shortcut-badge ${className}`;
    b.title = label;
    b.setAttribute("aria-label", label);
    b.innerHTML = svg;
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick(e);
    });
    return b;
  }

  function render() {
    row.replaceChildren();

    for (const item of shortcuts) {
      const a = document.createElement("a");
      a.className = "shortcut-pill";
      a.href = item.url;
      a.title = `${item.title} (${hostOf(item.url)})`;
      a.dataset.id = item.id;
      a.draggable = true;

      const name = document.createElement("span");
      name.className = "shortcut-title";
      name.textContent = item.title;

      const edit = badge("shortcut-edit", `Edit ${item.title}`, PENCIL, () => openForm(item, a));
      const del = badge("shortcut-del", `Remove ${item.title}`, CROSS, () => {
        shortcuts = shortcuts.filter((s) => s.id !== item.id);
        save(shortcuts);
        closeForm();
        render();
      });

      a.append(icon(item), name, edit, del);
      row.append(a);
    }

    const add = document.createElement("button");
    add.type = "button";
    add.className = "shortcut-add";
    add.title = "Add a shortcut";
    add.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>Add</span>`;
    add.addEventListener("click", () => (form.hidden ? openForm(null, add) : closeForm()));
    row.append(add);
  }

  // ── drag to reorder ──

  let dragId: string | null = null;
  let dropAt = -1;

  const pills = () => [...row.querySelectorAll<HTMLElement>(".shortcut-pill")];
  const clearMarks = () => row.querySelectorAll(".drop-before, .drop-after").forEach((n) => n.classList.remove("drop-before", "drop-after"));

  /** Index to insert at for a pointer at (x, y): before or after the nearest pill on that line. */
  function insertionIndex(x: number, y: number) {
    const list = pills();
    let best = -1;
    let bestDist = Infinity;
    list.forEach((p, i) => {
      const r = p.getBoundingClientRect();
      const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      const dist = dy * 4 + Math.abs(x - (r.left + r.width / 2));
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    if (best < 0) return 0;
    const r = list[best].getBoundingClientRect();
    return x < r.left + r.width / 2 ? best : best + 1;
  }

  row.addEventListener("dragstart", (e) => {
    const pill = (e.target as HTMLElement).closest<HTMLElement>(".shortcut-pill");
    if (!pill || !e.dataTransfer) return;
    dragId = pill.dataset.id ?? null;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(DRAG_TYPE, dragId ?? "");
    closeForm();
    // Mark it after the browser has taken its drag image.
    requestAnimationFrame(() => pill.classList.add("dragging"));
  });

  row.addEventListener("dragover", (e) => {
    if (!dragId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    dropAt = insertionIndex(e.clientX, e.clientY);
    clearMarks();
    const list = pills();
    if (dropAt < list.length) list[dropAt].classList.add("drop-before");
    else list[list.length - 1]?.classList.add("drop-after");
  });

  row.addEventListener("drop", (e) => {
    if (!dragId) return;
    e.preventDefault();
    const from = shortcuts.findIndex((s) => s.id === dragId);
    if (from >= 0 && dropAt >= 0) {
      const [moved] = shortcuts.splice(from, 1);
      shortcuts.splice(dropAt > from ? dropAt - 1 : dropAt, 0, moved);
      save(shortcuts);
    }
    render();
  });

  row.addEventListener("dragend", () => {
    dragId = null;
    dropAt = -1;
    clearMarks();
    row.querySelector(".dragging")?.classList.remove("dragging");
  });

  render();

  return {
    get list(): readonly Shortcut[] {
      return shortcuts;
    },
  };
}

export type ShortcutsControl = NonNullable<ReturnType<typeof mountShortcuts>>;
