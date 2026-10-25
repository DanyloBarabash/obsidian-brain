"use strict";

const POLL_MS = 4000;
const TOAST_MS = 3500;
const CLOSE_MS = 1500;
const BOOKMARK_TEXT_CHARS = 40000;
const view = document.getElementById("view");
const statusLine = document.getElementById("status");
const toast = document.getElementById("toast");
let tab = "feed";
let cards = [];
let current = -1;
let poll = null;

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child != null) node.append(child);
  return node;
}

async function api(path, body) {
  const options = body === undefined ? {} : {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)};
  const response = await fetch(path, options);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function say(text) {
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(say.timer);
  say.timer = setTimeout(() => toast.classList.remove("show"), TOAST_MS);
}

function ago(seconds) {
  if (!seconds) return "дата невідома";
  const hours = (Date.now() / 1000 - seconds) / 3600;
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} хв тому`;
  if (hours < 48) return `${Math.round(hours)} год тому`;
  return `${Math.round(hours / 24)} дн тому`;
}

function card(item) {
  const buttons = {};
  const act = async (action) => {
    try {
      if (action === "save") say("Зберігаю статтю в Brain…");
      const result = await api("/api/feedback", {id: item.id, action});
      item.status = action;
      for (const [name, button] of Object.entries(buttons)) button.classList.toggle("on", name === action || (name === "like" && action === "save"));
      if (result.note) say(`У мозку: ${result.note}`);
      if (tab === "feed" && action !== "like") node.classList.add("gone");
      if (tab === "feed") move(1);
    } catch (error) {
      say(`Помилка: ${error.message}`);
    }
  };
  buttons.like = el("button", {title: "Подобається (l)", onclick: () => act("like")}, "👍");
  buttons.dislike = el("button", {class: "no", title: "Не цікаво (d)", onclick: () => act("dislike")}, "👎");
  buttons.hide = el("button", {title: "Сховати без оцінки (x)", onclick: () => act("hide")}, "✕");
  buttons.save = el("button", {title: "Внести в Brain (s)", onclick: () => act("save")}, "🧠 У мозок");
  const follow = item.suggested ? el("button", {title: "Додати це джерело до своїх", onclick: async () => {
    try {
      await api("/api/suggestions", {id: item.source, accept: true});
      follow.replaceWith(el("span", {class: "muted"}, "джерело додано"));
    } catch (error) {
      say(`Не вдалося: ${error.message}`);
    }
  }}, "＋ Джерело") : null;
  for (const [name, button] of Object.entries(buttons)) button.classList.toggle("on", item.status === name || (name === "like" && item.status === "save"));
  const meta = el("div", {class: "meta"},
    el("span", {class: "chip"}, item.sourceLabel),
    item.suggested ? el("span", {class: "chip explore", title: "Стаття з джерела, яке пропонується на базі твоїх вподобань"}, "нове джерело") : null,
    item.explore ? el("span", {class: "chip explore", title: "Випадкова стаття поза профілем, щоб стрічка не звужувалась"}, "розвідка") : null,
    el("span", {}, ago(item.published)),
    item.author ? el("span", {}, item.author) : null,
    item.score != null ? el("span", {title: "Передбачена ймовірність вподобання"}, `${Math.round(item.score * 100)}%`) : null,
    item.why && item.why.length ? el("span", {}, `через: ${item.why.join(", ")}`) : null,
    item.note ? el("span", {title: item.note}, "🧠 збережено") : null);
  const node = el("article", {class: "card", tabindex: "-1"}, meta,
    el("a", {class: "title", href: item.url, target: "_blank", rel: "noopener noreferrer"}, item.title),
    item.about || item.summary ? el("p", {class: "summary"}, item.about || item.summary) : null,
    el("div", {class: "actions"}, buttons.like, buttons.dislike, buttons.hide, buttons.save, follow));
  node.item = item;
  node.act = act;
  return node;
}

function move(step) {
  if (!cards.length) return;
  if (current >= 0) cards[current].classList.remove("current");
  current = Math.max(0, Math.min(cards.length - 1, current + step));
  cards[current].classList.add("current");
  cards[current].focus({preventScroll: true});
  cards[current].scrollIntoView({block: "nearest"});
}

function showCards(items, empty, ...header) {
  cards = items.map(card);
  current = -1;
  view.replaceChildren(...header, ...(cards.length ? cards : [el("p", {class: "muted"}, empty)]));
}

async function addLink(body) {
  const result = await api("/api/links", body);
  say(result.duplicate ? `Уже в мозку: ${result.note}` : `У мозку: ${result.note}`);
  return result;
}

function linkForm() {
  const input = el("input", {type: "url", placeholder: "Встав посилання на статтю — збережу в мозок і врахую в добірці", required: ""});
  return el("form", {class: "add", onsubmit: async (event) => {
    event.preventDefault();
    say("Зберігаю статтю в Brain…");
    try {
      await addLink({url: input.value.trim()});
      input.value = "";
    } catch (error) {
      say(`Не вдалося: ${error.message}`);
    }
  }}, input, el("button", {type: "submit"}, "🧠 Закинути"));
}

function bookmarklet() {
  // Sends the selection or the page text the browser already rendered, so paywalled articles keep their body.
  const code = `(()=>{const s=String(getSelection()),b=document.querySelector('article')||document.querySelector('main')||document.body,`
    + `p=new URLSearchParams({url:location.href,title:document.title,text:(s||b.innerText||'').slice(0,${BOOKMARK_TEXT_CHARS})});`
    + `window.open('${location.origin}/add#'+p,'brain-add','width=560,height=480')})()`;
  return el("a", {class: "bookmarklet", href: `javascript:${encodeURIComponent(code)}`, title: "Перетягни на панель закладок"}, "🧠 В Brain");
}

function showAdd() {
  const params = new URLSearchParams(location.hash.slice(1));
  // Keep the article text out of the address bar and history.
  history.replaceState(null, "", "/add");
  const body = {url: params.get("url") || "", title: params.get("title") || "", text: params.get("text") || ""};
  if (!body.url) return show("feed");
  const button = el("button", {class: "primary", onclick: async () => {
    button.disabled = true;
    try {
      await addLink(body);
      button.textContent = "✓ У мозку";
      setTimeout(() => window.close(), CLOSE_MS);
    } catch (error) {
      button.disabled = false;
      say(`Не вдалося: ${error.message}`);
    }
  }}, "🧠 Зберегти в мозок");
  view.replaceChildren(
    el("h3", {}, body.title || body.url),
    el("p", {class: "muted"}, body.url),
    el("p", {class: "muted"}, body.text ? `${body.text.length} символів зі сторінки` : "Текст завантажу сам"),
    el("p", {}, button));
  button.focus();
}

async function showFeed() {
  const data = await api("/api/feed");
  if (data.setup) return show("sources");
  const errors = Object.keys(data.errors || {}).length;
  statusLine.textContent = `${data.new} нових · оновлено ${data.lastFetch ? ago(data.lastFetch) : "ще ні"}${data.refreshing ? " · оновлюю…" : ""}${errors ? ` · ${errors} джерел з помилкою` : ""}`;
  if (tab !== "feed") return;
  if (!cards.length || !data.refreshing) showCards(data.items, data.refreshing ? "Збираю статті…" : "Нових статей немає. Натисни ⟳.", linkForm());
  clearTimeout(poll);
  if (data.refreshing) poll = setTimeout(() => tab === "feed" && showFeed(), POLL_MS);
}

async function showList(status) {
  const data = await api(`/api/items?status=${status}`);
  showCards(data.items, status === "save" ? "У мозку ще нічого немає." : "Ще нічого не вподобано.");
}

function termRows(terms, negative, onForget) {
  const peak = Math.max(...terms.map(([, w]) => Math.abs(w)), 1e-6);
  return terms.map(([term, weight]) => {
    // CSSOM width works under the strict style-src CSP, unlike a style attribute.
    const bar = el("div", {class: negative ? "bar neg" : "bar"});
    bar.style.width = `${Math.round(60 * Math.abs(weight) / peak)}px`;
    return [term, weight, bar];
  }).map(([term, weight, bar]) => el("div", {class: "row"},
    el("span", {}, term),
    bar,
    el("span", {class: "muted"}, weight.toFixed(2)),
    onForget ? el("button", {title: "Прибрати цей термін із профілю", onclick: () => onForget(term)}, "забути") : null));
}

async function showInterests(data) {
  data = data || await api("/api/interests");
  const forget = async (term) => showInterests(await api("/api/forget", {term}));
  const counts = Object.entries(data.counts).map(([k, v]) => `${k}: ${v}`).join(" · ");
  view.replaceChildren(
    el("p", {class: "muted"}, `Профіль вчиться з 👍 / 👎 / 🧠; на старті має слабкий пріор з тегів Brain. ${counts}`),
    el("div", {class: "grid"},
      el("section", {}, el("h3", {}, "Тягне вгору"), termRows(data.liked, false, forget)),
      el("section", {}, el("h3", {}, "Тягне вниз"), data.disliked.length ? termRows(data.disliked, true, forget) : el("p", {class: "muted"}, "Ще немає 👎.")),
      el("section", {}, el("h3", {}, "Джерела"), data.sources.length ? termRows(data.sources, false, null) : el("p", {class: "muted"}, "Ще немає оцінок."))));
}

function chips(values, placeholder, onChange) {
  const list = el("div", {class: "chips"});
  const input = el("input", {placeholder});
  const render = () => list.replaceChildren(...values.map((value, index) => el("span", {class: "chip"}, value,
    el("button", {class: "x", title: "Прибрати", onclick: () => { values.splice(index, 1); render(); onChange(); }}, "×"))));
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || !input.value.trim()) return;
    event.preventDefault();
    values.push(input.value.trim());
    input.value = "";
    render();
    onChange();
  });
  render();
  return el("div", {}, list, input);
}

async function showSources() {
  const data = await api("/api/sources");
  const chosen = new Map(data.sources.map((source) => [source.id, source]));
  const topics = {like: [...data.topics.like], mute: [...data.topics.mute]};
  const catalogIds = new Set(data.catalog.flatMap((group) => group.sources.map((source) => source.id)));
  const saveTopics = async () => {
    try {
      await api("/api/topics", topics);
      say("Теми збережено");
    } catch (error) {
      say(`Не вдалося: ${error.message}`);
    }
  };
  const saveSources = async () => {
    if (!chosen.size) return say("Обери хоча б одне джерело");
    try {
      await api("/api/sources", {sources: [...chosen.values()]});
      await api("/api/refresh", {});
      say("Збережено; збираю статті…");
      cards = [];
      show("feed");
    } catch (error) {
      say(`Не вдалося: ${error.message}`);
    }
  };
  const error = (id) => data.errors[id] ? el("div", {class: "error"}, data.errors[id]) : null;
  const group = (entry) => el("fieldset", {class: "group"}, el("legend", {}, entry.topic), ...entry.sources.map((source) => {
    const box = el("input", {type: "checkbox"});
    box.checked = chosen.has(source.id);
    box.addEventListener("change", () => box.checked ? chosen.set(source.id, source) : chosen.delete(source.id));
    return el("label", {class: "pick"}, box, el("span", {}, source.label, " ", el("span", {class: "muted"}, source.kind), error(source.id)));
  }));
  const ownRow = (key, source) => {
    const row = el("div", {class: "row"},
      el("span", {}, `${source.label || source.value} `, el("span", {class: "muted"}, `${source.kind} · ${source.value}`), error(source.id)),
      el("button", {onclick: () => { chosen.delete(key); row.remove(); }}, "Прибрати"));
    return row;
  };
  const own = el("div", {}, ...[...chosen].filter(([key]) => !catalogIds.has(key)).map(([key, source]) => ownRow(key, source)));
  const kind = el("select", {}, ...["reddit", "medium", "rss", "hn"].map((k) => el("option", {value: k}, k)));
  const value = el("input", {placeholder: "сабредіт (LocalLLaMA) · tag/python · @user · https://site/feed", required: ""});
  const label = el("input", {placeholder: "Назва (необов’язково)"});
  const form = el("form", {onsubmit: (event) => {
    event.preventDefault();
    const source = {kind: kind.value, value: value.value.trim(), label: label.value.trim()};
    const key = `${source.kind}:${source.value}`;
    chosen.set(key, source);
    own.append(ownRow(key, source));
    value.value = label.value = "";
  }}, kind, value, label, el("button", {type: "submit"}, "Додати"));
  const dropping = el("section", {},
    el("h3", {}, "Закидати посилання"),
    el("p", {class: "muted"}, "Перетягни кнопку на панель закладок. На будь-якій статті натисни її: збереже виділене або весь текст сторінки, навіть платної статті Medium, яку ти бачиш. Посилання ще можна вставити вгорі «Стрічки». Кожне закинуте посилання вчить добірку сильніше за 👍."),
    el("p", {}, bookmarklet()));
  view.replaceChildren(
    data.setup ? el("p", {class: "intro"}, "Обери, що читати: галочки в каталозі або свої сабредіти, теги Medium і RSS нижче. Потім «Зберегти й зібрати».") : null,
    el("h3", {}, "Цікаві теми"),
    el("p", {class: "muted"}, "Слово або фраза, Enter — додати. Статті з ними піднімаються вище."),
    chips(topics.like, "напр. pose estimation, agents, solar", saveTopics),
    el("h3", {}, "Не показувати"),
    el("p", {class: "muted"}, "Стаття ховається, якщо містить усі слова фрази."),
    chips(topics.mute, "напр. crypto, giveaway", saveTopics),
    dropping,
    el("h3", {}, "Каталог джерел"),
    el("div", {class: "grid"}, ...data.catalog.map(group)),
    el("h3", {}, "Свої джерела"),
    own, form,
    el("p", {}, el("button", {class: "primary", onclick: saveSources}, "Зберегти й зібрати")));
}

async function showSuggestions() {
  const data = await api("/api/suggestions");
  if (tab !== "suggestions") return;
  const find = el("button", {class: "primary", onclick: async () => {
    await api("/api/discover", {});
    say("Шукаю нові джерела…");
    showSuggestions();
  }}, data.discovering ? "Шукаю…" : "Знайти нові");
  const answer = async (id, accept, node) => {
    try {
      await api("/api/suggestions", {id, accept});
      node.classList.add("gone");
      say(accept ? "Джерело додано; статті підтягнуться при наступному ⟳" : "Більше не пропонуватиму");
    } catch (error) {
      say(`Не вдалося: ${error.message}`);
    }
  };
  const list = data.suggestions.map((suggestion) => {
    const node = el("article", {class: "card"},
      el("div", {class: "meta"}, el("span", {class: "chip"}, suggestion.kind), el("span", {title: "Передбачена ймовірність вподобання"}, `${Math.round(suggestion.score * 100)}%`),
        el("span", {}, suggestion.reasons.join(" · "))),
      el("div", {class: "title"}, suggestion.label),
      suggestion.about ? el("p", {class: "summary"}, suggestion.about) : null,
      suggestion.samples.length ? el("ul", {class: "samples"}, ...suggestion.samples.map((sample) =>
        el("li", {}, el("a", {href: sample.url, target: "_blank", rel: "noopener noreferrer"}, sample.title)))) : null,
      el("div", {class: "actions"}));
    node.lastChild.append(el("button", {onclick: () => answer(suggestion.id, true, node)}, "＋ Додати"),
      el("button", {class: "no", onclick: () => answer(suggestion.id, false, node)}, "Не цікаво"));
    return node;
  });
  const errors = Object.entries(data.errors || {});
  view.replaceChildren(
    el("p", {class: "muted"}, "Нові сабредіти, автори Medium і блоги на основі твоїх 👍, 🧠, закинутих посилань і обраних тем. Їхні статті також з’являються в стрічці з позначкою «нове джерело»."),
    el("p", {}, find, " ", el("span", {class: "muted"}, data.discoveredAt ? `останній пошук ${ago(data.discoveredAt)}` : "ще не шукали")),
    ...(list.length ? list : [el("p", {class: "muted"}, data.discovering ? "Шукаю… Reddit дозволяє ~1 запит на хвилину, тож це може тривати кілька хвилин." : "Пропозицій поки немає. Вподобай кілька статей і натисни «Знайти нові».")]),
    errors.length ? el("details", {}, el("summary", {class: "muted"}, `Помилки пошуку: ${errors.length}`), ...errors.map(([k, v]) => el("div", {class: "error"}, `${k}: ${v}`))) : null);
  clearTimeout(poll);
  if (data.discovering) poll = setTimeout(() => tab === "suggestions" && showSuggestions(), POLL_MS);
}

async function show(name) {
  tab = name;
  for (const button of document.querySelectorAll("#tabs button")) button.classList.toggle("active", button.dataset.tab === name);
  try {
    if (name === "feed") await showFeed();
    else if (name === "interests") await showInterests();
    else if (name === "sources") await showSources();
    else if (name === "suggestions") await showSuggestions();
    else await showList(name);
  } catch (error) {
    view.replaceChildren(el("p", {class: "error"}, `Сервер недоступний: ${error.message}`));
  }
}

document.getElementById("tabs").addEventListener("click", (event) => {
  const name = event.target.dataset && event.target.dataset.tab;
  if (name) show(name);
});
document.getElementById("refresh").addEventListener("click", async () => {
  await api("/api/refresh", {});
  say("Оновлюю джерела…");
  cards = [];
  show("feed");
});
document.addEventListener("keydown", (event) => {
  if (event.target.closest("input, select, textarea") || event.metaKey || event.ctrlKey || event.altKey) return;
  const node = cards[current];
  const keys = {j: () => move(1), k: () => move(-1), l: () => node && node.act("like"), d: () => node && node.act("dislike"),
    x: () => node && node.act("hide"), s: () => node && node.act("save"), o: () => node && window.open(node.item.url, "_blank", "noopener")};
  if (keys[event.key]) {
    event.preventDefault();
    keys[event.key]();
  }
});
if (location.pathname === "/add") showAdd();
else show("feed");
