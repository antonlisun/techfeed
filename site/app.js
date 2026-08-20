/* TechFeed — Discover-style news client. No dependencies. Settings live in config.js. */

const CFG = window.FEED_CONFIG;

const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
  },
};

const saved = store.get("filters", {});

const state = {
  items: [],
  sources: [],            // [{name, color, category, count}] from the feed payload
  categoryOf: new Map(),
  visible: [],
  shown: 0,
  query: "",
  read: new Set(store.get("readLinks", [])),
  seen: new Set(),
  pending: null,
  fetchedAt: null,

  filters: {
    // Sources switched off. Seeded from the old key so existing hides carry over.
    muted: new Set(saved.muted ?? store.get("hiddenSources", [])),
    topics: new Set(saved.topics ?? []),   // topic labels; empty means every subject
    hours: saved.hours ?? 0,               // 0 means any time
    sort: saved.sort ?? "newest",          // "newest" | "coverage"
  },
};

const $ = (sel) => document.querySelector(sel);
const feedEl = $("#feed");

function saveFilters() {
  const f = state.filters;
  store.set("filters", {
    muted: [...f.muted], topics: [...f.topics], hours: f.hours, sort: f.sort,
  });
}

/* ------------------------------------------------------------------ theme */

function applyTheme(mode) {
  const dark = mode === "dark" ||
    (mode == null && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}
applyTheme(store.get("theme", null));

$("#theme").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  store.set("theme", next);
  applyTheme(next);
});

/* ------------------------------------------------------------- formatting */

function relTime(iso) {
  if (!iso) return "";
  const then = new Date(iso);
  if (isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h`;
  if (mins < 60 * 24 * 7) return `${Math.round(mins / 1440)}d`;
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const initials = (name) =>
  name.replace(/^(the|on)\s+/i, "").trim().charAt(0).toUpperCase();

const safeUrl = (url) => (/^https?:\/\//i.test(url || "") ? url : null);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function icon(path) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", path);
  svg.appendChild(p);
  return svg;
}

function avatarFor(name, color) {
  const node = el("span", "avatar", initials(name));
  node.style.background = color || "#5f6368";
  return node;
}

const ICONS = {
  dots: "M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z",
  open: "M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z",
  link: "M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7a5 5 0 0 0 0 10h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4a5 5 0 0 0 0-10z",
  hide: "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  only: "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
};

/* ------------------------------------------------------------------ cards */

function buildCard(item, position) {
  const img = safeUrl(item.image);
  const hero = img && position % 3 !== 1;

  const card = el("a", `card ${hero ? "hero" : "compact"}`);
  card.href = item.link;
  card.target = "_blank";
  card.rel = "noopener noreferrer";
  if (state.read.has(item.link)) card.classList.add("read");
  card.addEventListener("click", () => markRead(item, card));

  const picture = img ? Object.assign(new Image(), {
    className: "thumb",
    src: img,
    alt: "",
    loading: "lazy",
    referrerPolicy: "no-referrer",
  }) : null;
  if (picture) {
    picture.addEventListener("error", () => {
      picture.remove();
      card.classList.replace("hero", "compact");
    });
  }

  const title = el("h2", null, item.title);

  if (hero) {
    card.append(picture, title);
  } else {
    const top = el("div", "top");
    const txt = el("div", "txt");
    txt.append(title);
    if (!picture && item.summary) txt.append(el("p", "snippet", item.summary));
    top.append(txt);
    if (picture) top.append(picture);
    card.append(top);
  }

  if (item.also?.length) card.append(coverageChip(item));
  card.append(metaRow(item, card));
  return card;
}

function coverageChip(item) {
  const chip = el("div", "coverage");
  const dots = el("span", "dots");
  for (const other of [item, ...item.also].slice(0, 3)) {
    const dot = el("span", "dot");
    dot.style.background = other.color || "#5f6368";
    dots.append(dot);
  }
  chip.append(dots, el("span", null, `${item.also.length + 1} sources covering this`));
  return chip;
}

function metaRow(item, card) {
  const meta = el("div", "meta");
  const time = relTime(item.published);

  meta.append(avatarFor(item.source, item.color), el("span", "name", item.source));
  if (time) meta.append(el("span", null, `· ${time}`));
  meta.append(el("span", "spacer"));

  const more = el("button", "more");
  more.type = "button";
  more.setAttribute("aria-label", `More options for ${item.source}`);
  more.append(icon(ICONS.dots));
  more.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openMenu(more, item);
  });
  meta.append(more);
  void card;
  return meta;
}

function markRead(item, card) {
  state.read.add(item.link);
  card.classList.add("read");
  store.set("readLinks", [...state.read].slice(-800));
}

/* ------------------------------------------------------------------- menu */

const menuEl = $("#menu");
const scrimEl = $("#scrim");

function openMenu(anchor, item) {
  menuEl.textContent = "";

  const add = (label, path, action) => {
    const btn = el("button", null);
    btn.type = "button";
    btn.append(icon(path), el("span", null, label));
    btn.addEventListener("click", () => { closeMenu(); action(); });
    menuEl.append(btn);
  };

  add("Open in new tab", ICONS.open, () => window.open(item.link, "_blank", "noopener"));
  add("Copy link", ICONS.link, async () => {
    try { await navigator.clipboard.writeText(item.link); showToast("Link copied"); }
    catch { showToast("Couldn't copy link"); }
  });
  add(`Only show ${item.source}`, ICONS.only, () => soloSource(item.source));
  add(`Hide stories from ${item.source}`, ICONS.hide, () => muteSource(item.source));

  menuEl.classList.remove("hidden");
  scrimEl.classList.remove("hidden");

  const box = anchor.getBoundingClientRect();
  const width = menuEl.offsetWidth;
  const height = menuEl.offsetHeight;
  menuEl.style.left = `${Math.max(8, Math.min(box.right - width, innerWidth - width - 8))}px`;
  menuEl.style.top = box.bottom + height > innerHeight - 8
    ? `${Math.max(8, box.top - height - 4)}px`
    : `${box.bottom + 4}px`;
}

function closeMenu() {
  menuEl.classList.add("hidden");
  if (panelEl.classList.contains("hidden")) scrimEl.classList.add("hidden");
}

scrimEl.addEventListener("click", () => { closeMenu(); closePanel(); });
addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  closeMenu();
  closePanel();
});
addEventListener("resize", closeMenu);
addEventListener("scroll", () => {
  if (!menuEl.classList.contains("hidden")) closeMenu();
}, { passive: true });

/* ------------------------------------------------------------------ toast */

const toastEl = $("#toast");
let toastTimer;

function showToast(message, undo) {
  clearTimeout(toastTimer);
  toastEl.querySelector("span").textContent = message;
  const btn = toastEl.querySelector("button");
  btn.classList.toggle("hidden", !undo);
  btn.onclick = () => { toastEl.classList.add("hidden"); undo?.(); };
  toastEl.classList.remove("hidden");
  toastTimer = setTimeout(() => toastEl.classList.add("hidden"), undo ? 6000 : 3000);
}

function muteSource(name) {
  const before = new Set(state.filters.muted);
  state.filters.muted.add(name);
  commitFilters();
  showToast(`Hiding stories from ${name}`, () => {
    state.filters.muted = before;
    commitFilters();
  });
}

function soloSource(name) {
  const before = new Set(state.filters.muted);
  state.filters.muted = new Set(state.sources.map((s) => s.name).filter((n) => n !== name));
  commitFilters();
  showToast(`Showing only ${name}`, () => {
    state.filters.muted = before;
    commitFilters();
  });
}

/* --------------------------------------------------------------- filtering */

const topicByLabel = new Map(CFG.topics.map((t) => [t.label, t]));

function matchesTopics(item) {
  const { topics } = state.filters;
  if (!topics.size) return true;
  const hay = `${item.title} ${item.summary} ${(item.tags || []).join(" ")}`;
  for (const label of topics) {
    if (topicByLabel.get(label)?.test.test(hay)) return true;
  }
  return false;
}

function matches(item) {
  const f = state.filters;
  if (f.muted.has(item.source)) return false;

  if (f.hours) {
    const when = Date.parse(item.published || 0);
    if (!when || Date.now() - when > f.hours * 3600 * 1000) return false;
  }

  if (!matchesTopics(item)) return false;

  if (state.query) {
    const hay = `${item.title} ${item.summary} ${item.source} ${(item.tags || []).join(" ")}`.toLowerCase();
    if (!state.query.split(/\s+/).every((word) => hay.includes(word))) return false;
  }
  return true;
}

function activeFilterCount() {
  const f = state.filters;
  return (f.muted.size ? 1 : 0) + (f.topics.size ? 1 : 0) +
         (f.hours ? 1 : 0) + (f.sort !== "newest" ? 1 : 0);
}

/** Re-run filters, repaint everything that reflects them, and persist. */
function commitFilters({ scroll = false } = {}) {
  saveFilters();
  applyFilters();                 // before the panel repaints, so its count is current
  syncChips();
  syncFilterBadge();
  if (!panelEl.classList.contains("hidden")) renderPanel();
  if (scroll && scrollY > 200) scrollTo({ top: 0 });
}

function resetFilters() {
  state.filters = { muted: new Set(), topics: new Set(), hours: 0, sort: "newest" };
  commitFilters({ scroll: true });
}

/* --------------------------------------------------------------- rendering */

function applyFilters() {
  state.visible = state.items.filter(matches);

  if (state.filters.sort === "coverage") {
    state.visible.sort((a, b) =>
      (b.also?.length ?? 0) - (a.also?.length ?? 0) ||
      Date.parse(b.published || 0) - Date.parse(a.published || 0));
  }

  state.shown = 0;
  feedEl.textContent = "";

  if (!state.visible.length) {
    renderEmpty();
    return;
  }
  renderMore();
}

function renderMore() {
  const slice = state.visible.slice(state.shown, state.shown + CFG.batch);
  if (!slice.length) return;

  let sheet = null;
  slice.forEach((item, i) => {
    const index = state.shown + i;
    if (index % CFG.perSheet === 0) {
      sheet = el("div", "sheet");
      if (index === 0) sheet.append(el("div", "sheet-label", feedHeading()));
      feedEl.append(sheet);
    }
    sheet.append(buildCard(item, index));
  });

  state.shown += slice.length;

  if (state.shown >= state.visible.length) {
    const age = relTime(state.fetchedAt);
    const stamp = !age ? "" : age === "now" ? " · updated just now" : ` · updated ${age} ago`;
    const sources = new Set(state.visible.map((i) => i.source)).size;
    feedEl.append(el("div", "footnote",
      `${state.visible.length} stories from ${sources} sources${stamp}`));
  }
}

function feedHeading() {
  const { topics } = state.filters;
  if (state.query) return `Results for "${state.query}"`;
  if (topics.size === 1) return [...topics][0];
  if (topics.size > 1) return `${topics.size} subjects`;
  return "Discover";
}

function renderEmpty() {
  const box = el("div", "empty");
  box.append(el("strong", null, "No stories here"));
  box.append(el("div", null, state.query
    ? `Nothing matches "${state.query}".`
    : "Your filters are narrower than the current feed."));
  if (activeFilterCount()) {
    const btn = el("button", null, "Reset filters");
    btn.type = "button";
    btn.addEventListener("click", resetFilters);
    box.append(btn);
  }
  feedEl.append(box);
}

function renderSkeleton() {
  feedEl.textContent = "";
  for (let s = 0; s < 3; s++) {
    const sheet = el("div", "sheet skeleton");
    for (let c = 0; c < 2; c++) {
      const card = el("div", "card");
      if (c === 1) card.append(el("div", "block"));
      card.append(el("div", "line"), el("div", "line short"));
      sheet.append(card);
    }
    feedEl.append(sheet);
  }
}

/* ------------------------------------------------------------ filter panel */

const panelEl = $("#panel");

function renderPanel() {
  const f = state.filters;
  // Toggling a source repaints the panel; without this you'd be thrown back to the
  // top of the source list after every checkbox.
  const keepScroll = panelEl.querySelector(".panel-body")?.scrollTop ?? 0;
  panelEl.textContent = "";

  const head = el("div", "panel-head");
  head.append(el("h3", null, "Filters"));
  const reset = el("button", "linkbtn", "Reset");
  reset.type = "button";
  reset.disabled = !activeFilterCount();
  reset.addEventListener("click", resetFilters);
  head.append(reset);
  panelEl.append(head);

  const body = el("div", "panel-body");

  // ---- sources, grouped by category
  const byCategory = new Map();
  for (const source of state.sources) {
    if (!byCategory.has(source.category)) byCategory.set(source.category, []);
    byCategory.get(source.category).push(source);
  }

  const sourcesSection = el("section", "panel-section");
  const shead = el("div", "section-head");
  shead.append(el("h4", null, "Sources"));
  const active = state.sources.filter((s) => !f.muted.has(s.name)).length;
  const allOn = active === state.sources.length;
  const toggleAll = el("button", "linkbtn", allOn ? "Clear all" : "Select all");
  toggleAll.type = "button";
  toggleAll.addEventListener("click", () => {
    f.muted = allOn ? new Set(state.sources.map((s) => s.name)) : new Set();
    commitFilters();
  });
  shead.append(toggleAll);
  sourcesSection.append(shead);

  for (const [category, list] of byCategory) {
    sourcesSection.append(el("div", "group-label", category));
    for (const source of list) {
      sourcesSection.append(sourceRow(source, f));
    }
  }
  body.append(sourcesSection);

  // ---- time range
  body.append(pillSection("Published", CFG.timeRanges.map((range) => ({
    label: range.label,
    on: f.hours === range.hours,
    pick: () => { f.hours = range.hours; commitFilters({ scroll: true }); },
  }))));

  // ---- sort
  body.append(pillSection("Sort by", [
    { label: "Newest", on: f.sort === "newest",
      pick: () => { f.sort = "newest"; commitFilters({ scroll: true }); } },
    { label: "Most covered", on: f.sort === "coverage",
      pick: () => { f.sort = "coverage"; commitFilters({ scroll: true }); } },
  ]));

  panelEl.append(body);
  body.scrollTop = keepScroll;

  const foot = el("div", "panel-foot");
  const done = el("button", "primary", `Show ${state.visible.length} stories`);
  done.type = "button";
  done.addEventListener("click", closePanel);
  foot.append(done);
  panelEl.append(foot);
}

function sourceRow(source, f) {
  const on = !f.muted.has(source.name);
  const row = el("label", `source-row${source.count ? "" : " quiet"}`);

  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = on;
  box.addEventListener("change", () => {
    if (box.checked) f.muted.delete(source.name);
    else f.muted.add(source.name);
    commitFilters();
  });

  row.append(box, avatarFor(source.name, source.color), el("span", "name", source.name));
  row.append(el("span", "count", source.count
    ? String(source.count)
    : "none recent"));
  return row;
}

function pillSection(title, options) {
  const section = el("section", "panel-section");
  section.append(el("h4", null, title));
  const wrap = el("div", "pillrow");
  for (const opt of options) {
    const pill = el("button", "pill", opt.label);
    pill.type = "button";
    pill.setAttribute("aria-pressed", String(opt.on));
    pill.addEventListener("click", opt.pick);
    wrap.append(pill);
  }
  section.append(wrap);
  return section;
}

function openPanel() {
  renderPanel();
  panelEl.classList.remove("hidden");
  scrimEl.classList.remove("hidden");
}

function closePanel() {
  panelEl.classList.add("hidden");
  if (menuEl.classList.contains("hidden")) scrimEl.classList.add("hidden");
}

function syncFilterBadge() {
  const count = activeFilterCount();
  const badge = $("#filtercount");
  badge.textContent = count || "";
  badge.classList.toggle("hidden", !count);
  $("#filter").classList.toggle("active", !!count);
}

/* ------------------------------------------------------------------- chips */

const chipsEl = $("#chips");

function buildChips() {
  const all = el("button", "chip", "Top stories");
  all.type = "button";
  all.dataset.topic = "";
  all.addEventListener("click", () => {
    state.filters.topics.clear();
    commitFilters({ scroll: true });
  });
  chipsEl.append(all);

  for (const topic of CFG.topics) {
    const chip = el("button", "chip", topic.label);
    chip.type = "button";
    chip.dataset.topic = topic.label;
    chip.addEventListener("click", () => {
      const topics = state.filters.topics;
      if (topics.has(topic.label)) topics.delete(topic.label);
      else topics.add(topic.label);
      commitFilters({ scroll: true });
      chip.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    });
    chipsEl.append(chip);
  }
}

function syncChips() {
  const topics = state.filters.topics;
  for (const chip of chipsEl.children) {
    const label = chip.dataset.topic;
    chip.setAttribute("aria-pressed", String(label ? topics.has(label) : !topics.size));
  }
}

/* --------------------------------------------------------------- data load */

async function getJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const stamp = (data) => Date.parse(data?.fetchedAt || 0) || 0;

async function fetchFeed(force) {
  const { repo } = CFG;
  const bust = force ? `?t=${Date.now()}` : "";
  let data = null;
  let failure = null;

  try {
    data = await getJSON(CFG.localData + bust);
  } catch (err) {
    failure = err;
  }

  // The locally served copy may be behind; go to the repo for the current one.
  if (repo.owner && (!data || Date.now() - stamp(data) > CFG.staleAfter)) {
    const raw = `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${repo.branch}/site/data/feed.json`;
    try {
      const remote = await getJSON(raw + (bust || `?t=${Date.now()}`));
      if (stamp(remote) >= stamp(data)) data = remote;
    } catch { /* offline or repo private — the local copy still stands */ }
  }

  if (!data) throw failure || new Error("No feed data");
  return data;
}

async function load({ force = false, silent = false } = {}) {
  const btn = $("#refresh");
  btn.classList.add("spin");
  if (!silent) renderSkeleton();

  try {
    const data = await fetchFeed(force || silent);

    if (silent && state.items.length) {
      const fresh = data.items.filter((i) => !state.seen.has(i.link));
      if (!fresh.length) return;
      state.pending = data;
      showNewPill(fresh.length);
      return;
    }
    commit(data);
  } catch (err) {
    if (!silent) {
      feedEl.textContent = "";
      const box = el("div", "empty");
      box.append(el("strong", null, "Couldn't load the feed"));
      box.append(el("div", null, String(err.message || err)));
      const retry = el("button", null, "Try again");
      retry.type = "button";
      retry.addEventListener("click", () => load({ force: true }));
      box.append(retry);
      feedEl.append(box);
    }
  } finally {
    btn.classList.remove("spin");
  }
}

function commit(data) {
  state.items = data.items || [];
  state.sources = (data.sources || []).map((s) =>
    typeof s === "string" ? { name: s, color: "#5f6368", category: "News", count: 0 } : s);
  state.categoryOf = new Map(state.sources.map((s) => [s.name, s.category]));
  state.fetchedAt = data.fetchedAt;
  state.items.forEach((i) => state.seen.add(i.link));
  state.pending = null;

  syncChips();
  syncFilterBadge();
  applyFilters();
}

/* ------------------------------------------------------------- "new" pill */

const pillEl = $("#newpill");

function showNewPill(count) {
  pillEl.querySelector("span").textContent =
    `${count} new ${count === 1 ? "story" : "stories"}`;
  pillEl.classList.remove("hidden");
}

pillEl.addEventListener("click", () => {
  pillEl.classList.add("hidden");
  if (state.pending) commit(state.pending);
  scrollTo({ top: 0, behavior: "smooth" });
});

/* ---------------------------------------------------------------- controls */

const searchEl = $("#search");
let searchTimer;

searchEl.addEventListener("input", () => {
  $("#clear").classList.toggle("hidden", !searchEl.value);
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = searchEl.value.trim().toLowerCase();
    applyFilters();
    if (scrollY > 200) scrollTo({ top: 0 });
  }, 140);
});

$("#clear").addEventListener("click", () => {
  searchEl.value = "";
  state.query = "";
  $("#clear").classList.add("hidden");
  applyFilters();
  searchEl.focus();
});

$("#refresh").addEventListener("click", () => {
  pillEl.classList.add("hidden");
  load({ force: true });
});

$("#filter").addEventListener("click", () => {
  if (panelEl.classList.contains("hidden")) openPanel();
  else closePanel();
});

addEventListener("scroll", () => {
  if (scrollY + innerHeight > document.body.offsetHeight - 900) renderMore();
}, { passive: true });

setInterval(() => {
  if (document.visibilityState === "visible") load({ silent: true });
}, CFG.autoRefresh);

/* pull-to-refresh on touch devices */
let pullStart = null;
addEventListener("touchstart", (e) => {
  pullStart = scrollY === 0 ? e.touches[0].clientY : null;
}, { passive: true });
addEventListener("touchend", (e) => {
  if (pullStart != null && e.changedTouches[0].clientY - pullStart > 110) load({ force: true });
  pullStart = null;
}, { passive: true });

buildChips();
syncChips();
syncFilterBadge();
load();
