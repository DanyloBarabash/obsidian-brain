"""Keep reader state outside the vault and connect feeds, profile and Brain."""

import html
import json
import re
import sys
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from itertools import zip_longest
from datetime import date
from pathlib import Path
from urllib.parse import urlsplit

import brain
import embed
import feeds
from model import (PRIOR_WEIGHT, SEMANTIC, TOPIC_WEIGHT, Profile, features, rank, semantic, tokens, topic_weights,
                   vault_prior)

CATALOG = Path(__file__).parent / "sources.json"
STATE_VERSION = 1
REFRESH_SECONDS = 3 * 3600
RETENTION_SECONDS = 14 * 24 * 3600
FEED_LIMIT = 40
# A failed `claude -p` run is not retried on every poll.
DESCRIBE_RETRY_SECONDS = 1800
# Descriptions cost an API call, so only the head of the feed gets them.
DESCRIBE_LIMIT = 12
LIST_LIMIT = 200
LOG_LIMIT = 2000
FETCH_WORKERS = 6
INTEREST_TERMS = 30
LABELS = {"like": 1, "save": 1, "dislike": 0}
ACTIONS = ("like", "dislike", "hide", "save")
TOPIC_LIMIT = 50
SOURCE_ID = re.compile(r"[^a-z0-9]+")
DISCOVERY_QUERIES = 2
DISCOVERY_SAMPLED = 15
DISCOVERY_SITES = 3
SUGGESTION_SAMPLES = 3
SUGGESTION_LIMIT = 20
LINK_SOURCE = {"id": "link", "kind": "link", "label": "Закинуте посилання"}
# A link the user dropped is a stronger signal than a like.
LINK_WEIGHT = 2
LINK_WHY = ["ти сам закинув це посилання"]
IGNORED_SITES = {"github.com", "www.youtube.com", "youtube.com", "twitter.com", "x.com", "arxiv.org", "en.wikipedia.org",
                 "medium.com", "www.reddit.com", "reddit.com", "news.ycombinator.com"}


def source_id(kind, value):
    return SOURCE_ID.sub("-", f"{kind}-{value}".lower()).strip("-")[:60]


def link_source(url):
    """Map a dropped Reddit or Medium link to its subreddit, writer or publication."""
    parts = urlsplit(url)
    host, path = parts.netloc.lower(), [s for s in parts.path.split("/") if s]
    if (host == "reddit.com" or host.endswith(".reddit.com")) and len(path) > 1 and path[0] == "r":
        return {"kind": "reddit", "value": path[1], "label": f"r/{path[1]}"}
    if host.endswith(".medium.com") and host != "www.medium.com":
        writer = "@" + host.split(".")[0]
        return {"kind": "medium", "value": writer, "label": f"Medium · {writer}"}
    if host in ("medium.com", "www.medium.com") and len(path) > 1 and path[0] not in ("p", "m", "tag"):
        value = path[0].lower()
        return {"kind": "medium", "value": value, "label": f"Medium · {value}"}
    return None


def discovery_queries(profile, topics):
    """Declared topics first, then the strongest learnt words; each costs one Reddit request."""
    learnt = sorted(((k, v) for k, v in profile.weights.items() if v > 0 and not k.startswith(("src:", SEMANTIC))),
                    key=lambda p: -p[1])
    queries = list(topics) + [k for k, _ in learnt]
    if not queries:
        queries = [k for k, _ in sorted(profile.prior.items(), key=lambda p: -p[1]) if not k.startswith(SEMANTIC)]
    return list(dict.fromkeys(queries))[:DISCOVERY_QUERIES]


def is_muted(item, muted):
    """True when every word of some muted phrase occurs in the item."""
    words = set(tokens(" ".join([item["title"], item.get("summary", ""), *item.get("tags", [])])))
    return any(phrase and phrase <= words for phrase in muted)


class Reader:
    """Thread-safe reader state backed by one JSON file."""

    def __init__(self, vault_root, state_dir=None, download=feeds.fetch, embedder=None, describer=None):
        self.vault = Path(vault_root).expanduser().resolve()
        if not self.vault.is_dir():
            raise ValueError(f"Vault does not exist: {self.vault}")
        self.state_file = Path(state_dir or Path.home() / ".cache" / "brain-reader") / "state.json"
        if self.state_file.resolve().is_relative_to(self.vault):
            raise ValueError("Reader state must stay outside the vault")
        self.download = download
        self.embedder = embedder
        self.describer = describer
        self.describing = False
        self.describe_failed = 0
        self.lock = threading.Lock()
        self.refreshing = False
        self.discovering = False
        self.state = self._load()
        if self.embedder:
            try:
                self.embedder.vectors(["warm-up"])
            except Exception as error:  # noqa: BLE001 - no model (e.g. offline first run) means term-only ranking
                print(f"Embeddings off: {type(error).__name__}: {error}", file=sys.stderr)
                self.embedder = None
        self.profile = Profile(**self.state["profile"], topics=self._topics(self.state["topics"]["like"]))
        if not self.profile.prior and not self.state["prior_built"]:
            self.profile.prior = vault_prior(brain.tag_counts(self.vault))
            self.state["prior_built"] = True
            self._save()
        if self.embedder and not self.state.get("prior_semantic"):
            # Weak pull towards what the Brain is about, beyond its tags.
            centre = embed.mean(self.embedder.vectors(brain.note_texts(self.vault)))
            if centre:
                self.profile.prior.update(semantic(centre, PRIOR_WEIGHT))
            self.state["prior_semantic"] = True
            self._save()

    def _topics(self, phrases):
        """Declared topics as fixed term boosts plus, with embeddings, their mean meaning."""
        weights = topic_weights(phrases)
        centre = embed.mean(self.embedder.vectors(phrases)) if self.embedder and phrases else None
        if centre:
            weights.update(semantic(centre, TOPIC_WEIGHT))
        return weights

    def _embed(self, items):
        """Attach an embedding to items that lack one; return an error text instead of failing."""
        missing = [i for i in items if not i.get("vec")]
        if not self.embedder or not missing:
            return None
        try:
            for item, vector in zip(missing, self.embedder.vectors(embed.item_text(i) for i in missing)):
                item["vec"] = vector
        except Exception as error:  # noqa: BLE001 - ranking still works on terms
            return f"{type(error).__name__}: {error}"[:200]
        return None

    def _load(self):
        if self.state_file.exists():
            state = json.loads(self.state_file.read_text(encoding="utf-8"))
            if state.get("version") != STATE_VERSION:
                raise ValueError(f"Unknown reader state version: {state.get('version')}")
            for key, default in (("suggestions", []), ("dismissed", []), ("discoveredAt", 0)):
                state.setdefault(key, default)
            # Account sources (Gmail, private Reddit feeds) are no longer supported.
            state["sources"] = [s for s in state["sources"] if s["kind"] in feeds.KINDS]
            return state
        return {"version": STATE_VERSION, "items": {}, "profile": {}, "prior_built": False,
                "sources": [], "topics": {"like": [], "mute": []}, "setup": True,
                "lastFetch": 0, "errors": {}, "log": [], "suggestions": [], "dismissed": [], "discoveredAt": 0}

    def _save(self):
        self.state["profile"] = self.profile.to_json()
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.state_file.with_suffix(".tmp")
        temporary.write_text(json.dumps(self.state, ensure_ascii=False), encoding="utf-8")
        temporary.replace(self.state_file)

    def stale(self, now=None):
        return (now or time.time()) - self.state["lastFetch"] >= REFRESH_SECONDS

    def refresh(self):
        """Fetch every source; failures are recorded per source and do not stop the rest."""
        with self.lock:
            if self.refreshing:
                return
            self.refreshing = True
            sources = list(self.state["sources"])
        if not sources:
            self.refreshing = False
            return
        results, errors = [], {}
        try:
            # Every Reddit request shares one anonymous quota, so they run in one sequential group.
            reddit = [s for s in sources if s["kind"] == "reddit"]
            groups = [reddit] + [[s] for s in sources if s not in reddit]
            with ThreadPoolExecutor(FETCH_WORKERS) as pool:
                outcomes = [pool.submit(self._fetch_group, group) for group in groups if group]
            for outcome in outcomes:
                for source_id, value in outcome.result().items():
                    if isinstance(value, Exception):
                        errors[source_id] = f"{type(value).__name__}: {value}"[:200]
                    else:
                        results.extend(value)
            with self.lock:
                known = set(self.state["items"])
            failure = self._embed([i for i in results if i["id"] not in known])
            if failure:
                errors["embeddings"] = failure
            now = time.time()
            with self.lock:
                items = self.state["items"]
                for item in results:
                    items.setdefault(item["id"], {**item, "status": "new", "fetched": now})
                for key in [k for k, v in items.items() if v["status"] in ("new", "hide")
                            and now - v["fetched"] > RETENTION_SECONDS]:
                    del items[key]
                self.state["lastFetch"] = now
                self.state["errors"] = errors
                self._save()
        finally:
            self.refreshing = False

    def _fetch_group(self, group):
        """Fetch one group in order; one broken feed must not stop the others."""
        outcome = {}
        public = [s for s in group if s["kind"] == "reddit"]
        if public:
            try:
                outcome.update(feeds.fetch_reddit(public, self.download))
            except Exception as error:  # noqa: BLE001
                outcome.update({s["id"]: error for s in public})
        for source in group:
            if source["kind"] != "reddit":
                try:
                    outcome[source["id"]] = feeds.fetch_source(source, self.download)
                except Exception as error:  # noqa: BLE001
                    outcome[source["id"]] = error
        return outcome

    def feed(self, now=None, limit=FEED_LIMIT):
        now = now or time.time()
        with self.lock:
            muted = [set(tokens(phrase)) for phrase in self.state["topics"]["mute"]]
            candidates = [v for v in self.state["items"].values() if v["status"] == "new" and not is_muted(v, muted)]
            ranked = rank(candidates, self.profile, now, date.fromtimestamp(now).isoformat(), max(1, min(limit, FEED_LIMIT)))
            for item in ranked:
                item.pop("body", None)
                item.pop("vec", None)
            return {"items": ranked, "new": len(candidates), "lastFetch": self.state["lastFetch"],
                    "refreshing": self.refreshing, "errors": self.state["errors"], "setup": self.state["setup"],
                    "describing": self.describing}

    def needs_description(self, items):
        return bool(self.describer) and not self.describing and time.time() - self.describe_failed > DESCRIBE_RETRY_SECONDS \
            and any(not i.get("described") for i in items[:DESCRIBE_LIMIT])

    def describe(self, limit):
        """Describe the top `limit` feed items that have no description yet; one claude call per batch."""
        with self.lock:
            if self.describing:
                return
            self.describing = True
        try:
            wanted = [i["id"] for i in self.feed(limit=min(limit, DESCRIBE_LIMIT))["items"] if not i.get("described")]
            with self.lock:
                chosen = [dict(self.state["items"][k]) for k in wanted if k in self.state["items"]]
            if not chosen:
                return

            def text(item):
                return max(feeds.fetch_full(item["url"], self.download), item.get("body") or "", item.get("summary") or "", key=len)

            with ThreadPoolExecutor(FETCH_WORKERS) as pool:
                texts = list(pool.map(text, chosen))
            articles = [{"id": i["id"], "title": i["title"], "source": i["sourceLabel"], "text": t} for i, t in zip(chosen, texts)]
            try:
                found = self.describer(articles)
            except Exception as error:  # noqa: BLE001 - the market falls back to feed summaries
                self.describe_failed = time.time()
                with self.lock:
                    self.state["errors"]["descriptions"] = f"{type(error).__name__}: {error}"[:200]
                return
            with self.lock:
                for item in chosen:
                    stored = self.state["items"].get(item["id"])
                    if stored:
                        stored["described"] = True
                        if found.get(item["id"]):
                            stored["about"] = found[item["id"]]
                self.state["errors"].pop("descriptions", None)
                self._save()
        finally:
            self.describing = False

    def listed(self, status):
        with self.lock:
            statuses = ("like", "save") if status == "like" else (status,)
            chosen = [v for v in self.state["items"].values() if v["status"] in statuses]
            chosen.sort(key=lambda v: -v.get("rated", 0))
            return {"items": [{k: v for k, v in item.items() if k not in ("body", "vec")} for item in chosen[:LIST_LIMIT]]}

    def act(self, item_id, action):
        """Apply feedback; `save` also writes the article into the vault."""
        if action not in ACTIONS:
            raise ValueError(f"Unknown action: {action}")
        with self.lock:
            item = self.state["items"].get(item_id)
            if item is None:
                raise KeyError(item_id)
            snapshot = dict(item)
        result = {"id": item_id, "status": action}
        if action == "save":
            if snapshot.get("note"):
                result["note"] = snapshot["note"]
            else:
                text = feeds.fetch_full(snapshot["url"], self.download)
                if len(text) < len(snapshot.get("body") or ""):
                    text = snapshot["body"]
                result["note"] = brain.save_note(self.vault, snapshot, text, self.profile.explain(features(snapshot)))
        with self.lock:
            item = self.state["items"][item_id]
            if action in LABELS and item["status"] != action:
                self.profile.learn(features(item), LABELS[action])
            if "note" in result:
                item["note"] = result["note"]
            item["status"], item["rated"] = action, time.time()
            self.state["log"] = (self.state["log"] + [[item["rated"], item_id, action]])[-LOG_LIMIT:]
            self._save()
        return result

    def interests(self):
        with self.lock:
            weights = {k: v + self.profile.fixed(k) for k, v in self.profile.weights.items()}
            for k in {**self.profile.prior, **self.profile.topics}:
                weights.setdefault(k, self.profile.fixed(k))
            terms = [(k, round(v, 3)) for k, v in weights.items() if not k.startswith(("src:", SEMANTIC))]
            terms.sort(key=lambda p: -p[1])
            labels = {s["id"]: s["label"] for s in self.state["sources"]}
            sources = sorted(((labels.get(k[4:], k[4:]), round(v, 3)) for k, v in self.profile.weights.items()
                              if k.startswith("src:")), key=lambda p: -p[1])
            counts = {}
            for v in self.state["items"].values():
                counts[v["status"]] = counts.get(v["status"], 0) + 1
            return {"liked": terms[:INTEREST_TERMS], "disliked": [t for t in reversed(terms) if t[1] < 0][:INTEREST_TERMS],
                    "sources": sources, "counts": counts}

    def forget(self, term):
        with self.lock:
            self.profile.forget(term)
            self._save()

    def sources(self):
        with self.lock:
            catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
            for group in catalog:
                for source in group["sources"]:
                    source["id"] = source_id(source["kind"], source["value"])
            return {"sources": self.state["sources"], "errors": self.state["errors"],
                    "catalog": catalog, "topics": self.state["topics"], "setup": self.state["setup"]}

    def set_sources(self, sources):
        """Replace the source list after validating each entry."""
        clean, seen = [], set()
        for source in sources:
            kind, value = source.get("kind"), str(source.get("value", "")).strip()
            if kind not in feeds.KINDS or not value:
                raise ValueError("Each source needs a known kind and a value")
            entry = {"kind": kind, "value": value, "label": str(source.get("label") or value).strip()[:80]}
            entry["id"] = source.get("id") or source_id(kind, value)
            feeds.feed_url(entry)
            if entry["id"] not in seen:
                seen.add(entry["id"])
                clean.append(entry)
        with self.lock:
            self.state["sources"] = clean
            self.state["setup"] = False
            self._save()
        return self.sources()

    def set_topics(self, like, mute):
        """Store declared interests (boost) and muted topics (filter)."""
        clean = {name: list(dict.fromkeys(str(t).strip()[:60] for t in values if str(t).strip()))[:TOPIC_LIMIT]
                 for name, values in (("like", like), ("mute", mute))}
        topics = self._topics(clean["like"])
        with self.lock:
            self.state["topics"] = clean
            self.profile.topics = topics
            self._save()
        return self.sources()

    def suggestions(self):
        with self.lock:
            return {"suggestions": self.state["suggestions"], "discovering": self.discovering,
                    "discoveredAt": self.state["discoveredAt"], "errors": self.state.get("discoveryErrors", {})}

    def discover(self):
        """Propose new sources from likes, dropped links and a subreddit search, with sample articles."""
        with self.lock:
            if self.discovering:
                return
            self.discovering = True
            chosen = {s["id"] for s in self.state["sources"]}
            dismissed = set(self.state["dismissed"])
            liked = [dict(v) for v in self.state["items"].values() if v["status"] in ("like", "save")]
            known = set(self.state["items"])
            queries = discovery_queries(self.profile, self.state["topics"]["like"])
        candidates, errors, sites = {}, {}, Counter()

        def add(source, reason, text=""):
            source = {"kind": source["kind"], "value": source["value"], "label": source["label"]}
            source["id"] = source_id(source["kind"], source["value"])
            if source["id"] in chosen or source["id"] in dismissed:
                return
            entry = candidates.setdefault(source["id"], {**source, "reasons": Counter(), "text": ""})
            entry["reasons"][reason] += 1
            entry["text"] = (entry["text"] + " " + text).strip()

        try:
            for item in liked:
                for tag in item.get("tags", []):
                    if tag.startswith("r/"):
                        add({"kind": "reddit", "value": tag[2:], "label": tag}, "сабредіт вподобаних статей")
                    elif item["kind"] == "medium" and brain.kebab(tag):
                        add({"kind": "medium", "value": f"tag/{brain.kebab(tag)}", "label": f"Medium · {tag}"},
                            "тег вподобаних статей")
                host = urlsplit(item["url"]).netloc.lower()
                origin = link_source(item["url"]) if item["kind"] == "link" else None
                if origin:
                    add(origin, "звідти твоє закинуте посилання", item["title"])
                elif item["kind"] in ("hn", "rss", "link") and host not in IGNORED_SITES:
                    sites[host] += 1
            for query in queries:
                try:
                    for found in feeds.search_subreddits(query, self.download):
                        add(found, f"пошук Reddit: {query}", found["text"])
                except Exception as error:  # noqa: BLE001
                    errors[f"reddit-search: {query}"] = f"{type(error).__name__}: {error}"[:200]
            for host, _ in sites.most_common(DISCOVERY_SITES):
                try:
                    feed = feeds.discover_feed(f"https://{host}/", self.download)
                except Exception as error:  # noqa: BLE001
                    errors[host] = f"{type(error).__name__}: {error}"[:200]
                    continue
                if feed:
                    add({"kind": "rss", "value": feed, "label": host}, "сайт вподобаних статей")
            # Interleave kinds so frequent Medium tags do not crowd out subreddits and sites.
            buckets = {}
            for candidate in sorted(candidates.values(), key=lambda c: (-sum(c["reasons"].values()), c["id"])):
                buckets.setdefault(candidate["kind"], []).append(candidate)
            picked = [c for row in zip_longest(*buckets.values()) for c in row if c][:DISCOVERY_SAMPLED]
            samples = self._fetch_group([{k: c[k] for k in ("id", "kind", "value", "label")} for c in picked])
            now = time.time()
            suggestions, fresh = [], []
            for candidate in picked:
                found = samples.get(candidate["id"])
                if isinstance(found, Exception):
                    errors[candidate["id"]] = f"{type(found).__name__}: {found}"[:200]
                    found = []
                found = [i for i in found or [] if i["id"] not in known]
                self._embed(found)
                if not found and candidate["kind"] != "reddit":
                    continue
                scored = sorted(((self.profile.probability(features(i)), i) for i in found), key=lambda p: -p[0])
                top = scored[:SUGGESTION_SAMPLES]
                text_item = {"title": candidate["label"], "summary": candidate["text"], "source": candidate["id"], "tags": []}
                score = sum(p for p, _ in top) / len(top) if top else self.profile.probability(features(text_item))
                for _, item in top:
                    fresh.append({**item, "status": "new", "fetched": now, "suggested": candidate["label"]})
                suggestions.append({**{k: candidate[k] for k in ("id", "kind", "value", "label")},
                                    "reasons": [r for r, _ in candidate["reasons"].most_common()], "score": round(score, 3),
                                    "about": candidate["text"][:300],
                                    "samples": [{"title": i["title"], "url": i["url"]} for _, i in top]})
            suggestions.sort(key=lambda x: -x["score"])
            with self.lock:
                for item in fresh:
                    self.state["items"].setdefault(item["id"], item)
                self.state["suggestions"] = suggestions[:SUGGESTION_LIMIT]
                self.state["discoveredAt"] = now
                self.state["discoveryErrors"] = errors
                self._save()
        finally:
            self.discovering = False

    def answer_suggestion(self, suggestion_id, accept):
        """Accept a suggestion as a source, or dismiss it and drop its unrated sample articles."""
        with self.lock:
            suggestion = next((x for x in self.state["suggestions"] if x["id"] == suggestion_id), None)
            if suggestion is None:
                raise KeyError(suggestion_id)
            self.state["suggestions"] = [x for x in self.state["suggestions"] if x["id"] != suggestion_id]
            if not accept:
                self.state["dismissed"].append(suggestion_id)
                for key in [k for k, v in self.state["items"].items() if v["source"] == suggestion_id and v["status"] == "new"]:
                    del self.state["items"][key]
            else:
                for item in self.state["items"].values():
                    if item["source"] == suggestion_id:
                        item.pop("suggested", None)
            self._save()
            current = list(self.state["sources"])
        if accept:
            self.set_sources(current + [{k: suggestion[k] for k in ("id", "kind", "value", "label")}])
        return self.suggestions()

    def add_link(self, url, title="", text=""):
        """Save a dropped link into the vault and learn from it; page text from the browser beats a fetch."""
        url = feeds.canonical(feeds.safe_url(str(url)))
        title, text = str(title or "").strip()[:feeds.SUMMARY_CHARS], str(text or "").strip()[:feeds.MAX_ARTICLE_CHARS]
        description = ""
        if not text:
            try:
                page = feeds.fetch_page(url, self.download)
            except Exception:  # noqa: BLE001 - the note still keeps the link
                page = {}
            title, text, description = title or page.get("title", ""), page.get("text", ""), page.get("description", "")
        # A blocked page (Medium answers scripts with 403) still gets a readable title from its slug.
        slug = re.sub(r"-[0-9a-f]{10,16}$", "", urlsplit(url).path.rstrip("/").rsplit("/", 1)[-1]).replace("-", " ").strip()
        item = feeds.make_item(LINK_SOURCE, title or slug.capitalize() or url, url, html.escape(description or text[:feeds.SUMMARY_CHARS]), None)
        origin = link_source(url)
        if origin and origin["kind"] == "reddit":
            item["tags"] = [origin["label"].lower()]
        self._embed([item])
        with self.lock:
            known = self.state["items"].get(item["id"])
            if known and known.get("note"):
                return {"id": item["id"], "note": known["note"], "title": known["title"], "duplicate": True}
        note = brain.save_note(self.vault, item, text, LINK_WHY)
        now = time.time()
        with self.lock:
            entry = {**(self.state["items"].get(item["id"]) or item), "status": "save", "rated": now, "note": note}
            entry.setdefault("fetched", now)
            entry.pop("body", None)
            for _ in range(LINK_WEIGHT):
                self.profile.learn(features(entry), 1)
            self.state["items"][item["id"]] = entry
            self.state["log"] = (self.state["log"] + [[now, item["id"], "link"]])[-LOG_LIMIT:]
            self._save()
        return {"id": item["id"], "note": note, "title": entry["title"]}
