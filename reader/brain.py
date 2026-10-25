"""Read interest hints from the Brain vault and save articles into it."""

import json
import os
import re
import threading
from collections import Counter
from datetime import datetime
from pathlib import Path

NOTE_DIR = Path("_global") / "library" / "articles"
NOTE_PREFIX = "reader"
SLUG_CHARS = 60
FRONTMATTER_BYTES = 4000
MAX_NOTE_TAGS = 6
TAGS = re.compile(r"^tags:[ \t]*\[(.*?)\]", re.M)
SUMMARY = re.compile(r"^summary:[ \t]*(.+)$", re.M)
HEADING = re.compile(r"^# (.+)$", re.M)
MAX_NOTE_TEXTS = 2000
LIBRARY_LOCK = threading.Lock()


def notes(root):
    """Yield the head of every visible Markdown note."""
    for directory, folders, names in os.walk(root, followlinks=False):
        folders[:] = [f for f in folders if not f.startswith(".")]
        for name in names:
            if not name.endswith(".md") or name.startswith("."):
                continue
            try:
                with open(Path(directory) / name, encoding="utf-8", errors="replace") as handle:
                    yield handle.read(FRONTMATTER_BYTES)
            except OSError:
                continue


def tag_counts(root):
    """Count frontmatter tags across visible Markdown notes."""
    counts = Counter()
    for head in notes(root):
        match = TAGS.search(head)
        if match:
            counts.update(t.strip().strip("\"'") for t in match[1].split(",") if t.strip().strip("\"'"))
    return counts


def note_texts(root):
    """Return heading plus summary of up to MAX_NOTE_TEXTS notes, for a semantic Brain prior."""
    texts = []
    for head in notes(root):
        parts = [m[1].strip().strip("\"'") for m in (HEADING.search(head), SUMMARY.search(head)) if m]
        if parts:
            texts.append(" ".join(parts))
        if len(texts) >= MAX_NOTE_TEXTS:
            break
    return texts


def slug(text):
    words = re.findall(r"[a-zа-яіїєґ0-9]+", text.lower())
    return "-".join(words)[:SLUG_CHARS].strip("-") or "article"


def kebab(text):
    return "-".join(re.findall(r"[a-zа-яіїєґ0-9]+", text.lower()))


def index_article(root, path, title):
    """Link a saved article from the existing library hub without replacing its structure."""
    hub = root / "_global/library.md"
    with LIBRARY_LOCK:
        if not hub.is_file():
            return
        text = hub.read_text(encoding="utf-8")
        target = path.relative_to(root).with_suffix("").as_posix()
        if f"[[{target}" in text:
            return
        label = " ".join(title.split()).replace("|", " ").replace("]", "")
        link = f"- [[{target}|{label}]]\n"
        text = text.replace("Фонд поки порожній. Тут з’являться посилання на справді збережені матеріали.\n", "", 1)
        if "## Каталог\n" in text:
            text = text.replace("## Каталог\n", "## Каталог\n\n"+link, 1)
        else:
            text = text.rstrip()+"\n\n## Каталог\n\n"+link
        hub.write_text(text, encoding="utf-8")


def save_note(root, item, text, why, now=None):
    """Write one article as an inbox document and return its vault-relative path."""
    root = Path(root).resolve()
    moment = now or datetime.now()
    date = moment.strftime("%Y-%m-%d")
    folder = root / NOTE_DIR
    folder.mkdir(parents=True, exist_ok=True)
    base = f"{NOTE_PREFIX}-{date}-{slug(item['title'])}"
    tags = ["reader", item["kind"], *(kebab(t) for t in item.get("tags", []))]
    tags = list(dict.fromkeys(t for t in tags if t))[:MAX_NOTE_TAGS]
    published = datetime.fromtimestamp(item["published"]).strftime("%Y-%m-%d") if item.get("published") else "невідомо"
    byline = " · ".join(x for x in (item["sourceLabel"], item.get("author"), published) if x)
    summary = (item.get("summary") or item["title"]).replace("\n", " ")[:300]
    body = "\n".join([
        "---",
        f"id: global/library/articles/{base}",
        "type: article",
        f"date: {date}",
        "domain: general",
        "importance: reference",
        f"tags: [{', '.join(tags)}]",
        "status: inbox",
        # Project-free article: Brain City lists it in the Knowledge Library.
        "knowledge_scope: library",
        f"source_url: {json.dumps(item['url'])}",
        'related: ["[[_global/library]]"]',
        f"summary: {json.dumps(summary, ensure_ascii=False)}",
        f"source: {json.dumps(item['url'])}",
        f"reader_source: {json.dumps(item['sourceLabel'], ensure_ascii=False)}",
        "---",
        "",
        f"# {item['title']}",
        "",
        f"> {byline}",
        f"> {item['url']}",
        "",
        "## Чому в стрічці",
        "",
        *(f"- {term}" for term in why or ["розвідка поза профілем"]),
        "",
        "## Текст",
        "",
        (text or item.get("summary") or "Текст недоступний; відкрий джерело.").strip(),
        "",
    ])
    for attempt in range(1, 100):
        name = base if attempt == 1 else f"{base}-{attempt}"
        path = folder / f"{name}.md"
        if not path.resolve().is_relative_to(root):
            raise ValueError("Note path escapes the vault")
        try:
            with open(path, "x", encoding="utf-8") as handle:
                handle.write(body.replace(f"id: global/library/articles/{base}\n", f"id: global/library/articles/{name}\n", 1))
        except FileExistsError:
            continue
        index_article(root, path, item["title"])
        return str(path.relative_to(root))
    raise FileExistsError(base)
