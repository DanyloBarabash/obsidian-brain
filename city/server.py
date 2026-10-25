#!/usr/bin/env python3
"""Serve a private, live city view of a local Markdown vault."""

import argparse
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, unquote, urlsplit
import webbrowser
from city_state import CityState
from preparation import Preparation
from classification import TOPICS, classify, project_profile
from market import READER_URL, Market, ReaderOffline

WEB = Path(__file__).parent / "web"
# Scenario parameters: smaller bodies gain little from gzip; level 1 keeps a 10 MB world under ~0.1 s.
COMPRESS_MIN_BYTES = 1024
COMPRESS_LEVEL = 1
# Bookmarked page text can be long; the reader itself caps it at 1 MB.
MARKET_BODY_BYTES = 1024 * 1024
THEMES = {
    "civic": ("Міське управління", "#e1c66e", "civic"),
    "systems-and-agents": ("Системи й агенти", "#b6a0ff", "observatory"),
    "client-products": ("Продукти й команди", "#f3b989", "workspace"),
    "education-and-research": ("Освіта й дослідження", "#83c9ec", "academy"),
    "games": ("Ігри й творчість", "#f396bc", "studio"),
    "personal-tools": ("Особисті інструменти", "#99d5ad", "garden"),
    "commons": ("Площа пам’яті", "#e5d795", "library"),
}
THEMES.update(TOPICS)


def frontmatter(text):
    """Read scalar metadata without requiring a YAML dependency."""
    match = re.match(r"\A---\s*\n(.*?)\n---(?:\n|$)", text, re.S)
    if not match:
        return {}, text
    fields = {}
    for key, value in re.findall(r"^([\w-]+):[ \t]*(.*)$", match[1], re.M):
        fields[key] = value.strip().strip("\"'")
    return fields, text[match.end():]


def spiral(slot):
    """Give each district a stable position on an expanding square spiral."""
    if slot == 0:
        return 0, 0
    ring = math.ceil((math.sqrt(slot + 1) - 1) / 2)
    edge = 2 * ring
    delta = (2 * ring + 1) ** 2 - 1 - slot
    if delta < edge:
        return ring - delta, -ring
    if delta < 2 * edge:
        return -ring, -ring + delta - edge
    if delta < 3 * edge:
        return -ring + delta - 2 * edge, ring
    return ring, ring - (delta - 3 * edge)


class Vault:
    """Build snapshots while keeping generated layout state outside the vault."""

    def __init__(self, root, state_dir=None):
        self.root = Path(root).expanduser().resolve()
        if not self.root.is_dir():
            raise ValueError(f"Vault does not exist: {self.root}")
        key = hashlib.sha256(str(self.root).encode()).hexdigest()[:16]
        self.state_file = (Path(state_dir) if state_dir else Path.home() / ".cache" / "brain-city") / f"{key}.json"
        if self.state_file.resolve().is_relative_to(self.root):
            raise ValueError("City state must stay outside the vault")
        self.city_state = CityState(self.state_file)
        self.layout = self.city_state.layout
        self.lock = threading.Lock()
        self.signature = None
        self.snapshot = None
        self.preparation = Preparation(self.state_file)

    def files(self):
        """List supported notes without following symlinks or hidden folders."""
        result = []
        for directory, folders, names in os.walk(self.root, followlinks=False):
            folders[:] = sorted(f for f in folders if not f.startswith(".") and not (Path(directory) / f).is_symlink())
            for name in sorted(names):
                file = Path(directory) / name
                if name.lower().endswith(".md") and not name.startswith(".") and not file.is_symlink():
                    result.append(file)
        return result

    def read_note(self, path):
        """Read only an existing Markdown file inside this vault."""
        candidate = (self.root / path).resolve()
        if not candidate.is_relative_to(self.root) or candidate.suffix.lower() != ".md":
            raise ValueError("Invalid note path")
        if any(part.startswith(".") for part in candidate.relative_to(self.root).parts):
            raise ValueError("Hidden files are excluded")
        if any(parent.is_symlink() for parent in [self.root / path, *(self.root / path).parents] if parent != self.root and parent.is_relative_to(self.root)):
            raise ValueError("Symlinks are excluded")
        return candidate.read_text(encoding="utf-8", errors="replace")

    def build(self):
        """Return a fresh graph only when source files have changed."""
        with self.lock:
            files = self.files()
            stats = []
            for file in files:
                try:
                    stat = file.stat()
                    stats.append((file.relative_to(self.root).as_posix(), stat.st_mtime_ns, stat.st_size))
                except FileNotFoundError:
                    continue
            signature = hashlib.sha256(json.dumps(stats).encode()).hexdigest()[:16]
            if signature == self.signature:
                return self.snapshot
            raw = {}
            for path, modified, _ in stats:
                try:
                    text = self.read_note(path)
                except FileNotFoundError:
                    continue
                meta, body = frontmatter(text)
                heading = re.search(r"^# (.+)$", body, re.M)
                title = meta.get("title") or (heading[1].strip() if heading else Path(path).stem.replace("-", " "))
                raw[path] = {"id": path, "title": title, "meta": meta, "body": body,
                             "contentRevision": hashlib.sha256(text.encode()).hexdigest(),
                             "modified": modified / 1e9, "words": len(body.split())}
            hubs = {p: n for p, n in raw.items() if n["meta"].get("type") in ("hub", "org") and p.startswith("projects/")}
            records = self.city_state.layout.get("sources", {})
            profiles = {}
            for path in sorted(hubs, key=lambda p: (len(p), p)):
                parents = [profiles[h] for h in sorted(profiles, key=len, reverse=True) if path.startswith(h[:-3]+"/")]
                previous = next((r for r in records.values() if r["path"] == path or
                                 (hubs[path]["meta"].get("id") and r.get("declaredId") == hubs[path]["meta"]["id"])), None)
                profiles[path] = project_profile(path, hubs[path], parents, previous, previous is not None)
            themes = dict(THEMES)
            for profile in profiles.values():
                themes.setdefault(profile["topic"], (profile["topicTitle"], "#92cbd0", "workspace"))
            thematic = any(h["meta"].get("city_topic") for h in hubs.values())
            districts = {}
            nodes = []
            for path, note in raw.items():
                meta = note["meta"]
                ancestors = sorted((h for h in hubs if path == h or path.startswith(h[:-3]+"/")), key=len, reverse=True)
                topic = meta.get("city_topic") or next((hubs[h]["meta"]["city_topic"] for h in ancestors if hubs[h]["meta"].get("city_topic")), "")
                profile = profiles.get(ancestors[0], {}) if ancestors else {}
                topic = meta.get("city_topic") or profile.get("topic", topic)
                if path.startswith("classes/"):
                    district = meta.get("class", Path(path).stem)
                    project = ""
                else:
                    owners = [h for h in hubs if path == h or path.startswith(h[:-3] + "/")]
                    owner = max(owners, key=len) if owners else None
                    district = ((meta.get("class") if path.startswith("projects/") else None) or (hubs[owner]["meta"].get("class") if owner else None))
                    # Nested hubs can inherit their top-level class.
                    if not district and owner:
                        parents = [h for h in hubs if owner.startswith(h[:-3] + "/")]
                        district = next((hubs[h]["meta"].get("class") for h in sorted(parents, key=len, reverse=True) if hubs[h]["meta"].get("class")), None)
                    district = district or "commons"
                    project = owner or ""
                label, color, theme = THEMES.get(district, (district.replace("-", " ").title(), "#92cbd0", "workspace"))
                class_note = raw.get(f"classes/{district}.md")
                if class_note and district not in THEMES:
                    label = class_note["title"]
                districts.setdefault(district, {"id": district, "title": label, "color": color, "theme": theme, "count": 0})["count"] += 1
                kind = meta.get("type") or ("session" if "/sessions/" in path else "document" if "/documents/" in path else "note")
                if "templates" in Path(path).parts:
                    kind = "document"
                nodes.append({k: note[k] for k in ("id", "title", "words", "modified")} | {
                    "district": district, "project": project, "kind": kind,
                    **classify(path, meta, project, district, topic, thematic),
                    **({"cityQuarter": profile["quarter"], "citySubject": profile["subject"],
                        "cityLandmark": profile["landmark"], "cityLandmarkTitle": profile["landmarkTitle"]} if profile else {}),
                    "sourceId": meta.get("id"), "contentRevision": note["contentRevision"],
                    "archived": meta.get("status", meta.get("stage", "")).lower() in ("archived", "archive"),
                    "summary": meta.get("summary", ""), "uri": f"obsidian://open?vault={quote(self.root.name, safe='')}&file={quote(path, safe='')}"})
            # Resolve wikilinks and local Markdown links, retaining only actual files.
            stems = {}
            for path in raw:
                stems.setdefault(Path(path).stem.casefold(), []).append(path)
            edges = set()
            unresolved = 0
            for path, note in raw.items():
                body = note["body"]
                # Include frontmatter relationships too (related, parent, sibling).
                source = self.read_note(path)
                targets = re.findall(r"\[\[([^\]]+)\]\]", source)
                targets += re.findall(r"(?<!!)\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)", body)
                for target in targets:
                    target = unquote(target.split("|")[0].split("#")[0]).strip("<>")
                    if not target or re.match(r"^[a-zA-Z][\w+.-]*:", target):
                        continue
                    target = target if target.endswith(".md") else target + ".md"
                    relative = os.path.normpath((Path(path).parent / target).as_posix())
                    resolved = target if target in raw else relative if relative in raw else None
                    if not resolved:
                        matches = stems.get(Path(target).stem.casefold(), [])
                        resolved = matches[0] if len(matches) == 1 else None
                    if resolved and resolved != path:
                        edges.add(tuple(sorted((path, resolved))))
                    elif not resolved and target.endswith(".md"):
                        unresolved += 1
            degrees = {p: 0 for p in raw}
            for a, b in edges:
                degrees[a] += 1
                degrees[b] += 1
            self.city_state.reconcile(nodes)
            self.layout = self.city_state.layout
            memory = self.city_state.public()
            for node in nodes:
                if node["cityDistrict"] == "civic" or node.get("cityTopic"):
                    node["district"] = node["cityDistrict"]
            for node in memory["missingSources"]:
                if not node.get("cityDistrict"):
                    node.update(classify(node["sourcePath"], {}, node.get("project", ""), node.get("sourceClass", node["district"])))
                if node["cityDistrict"] == "civic" or node.get("cityTopic"):
                    node["district"] = node["cityDistrict"]
            memory["capabilities"] = self.preparation.capabilities()
            # Classification can change without relocating an established house.
            # Keep absent sources as reserved buildings, outside active counters.
            physical_districts = {n["district"] for n in nodes + memory["missingSources"]}
            districts = {key: value for key, value in districts.items() if key in physical_districts}
            for district in districts.values():
                district["count"] = 0
            for node in nodes + memory["missingSources"]:
                district = node["district"]
                if district not in districts:
                    label, color, theme = themes.get(district, (district.replace("-", " ").title(), "#92cbd0", "workspace"))
                    districts[district] = {"id": district, "title": label, "color": color, "theme": theme, "count": 0}
                districts[district]["count"] += int(node["available"])
            # Assign permanent addresses; adding a note never moves existing houses.
            for district in sorted(districts):
                if district not in self.layout["districts"]:
                    self.layout["districts"][district] = len(self.layout["districts"])
                columns = self.layout.setdefault("columns", {})
                columns.setdefault(district, max(3, min(12, math.ceil(math.sqrt(districts[district]["count"])))))
                districts[district]["columns"] = columns[district]
            for node in sorted(nodes, key=lambda n: (n["kind"] not in ("class", "hub", "org"), n["id"])):
                node["degree"] = degrees[node["id"]]
            # Fixed district pitch leaves space for growth; streets remain stable.
            for district in districts.values():
                district["order"] = self.layout["districts"][district["id"]]
                dx, dy = spiral(district["order"])
                district["x"], district["y"] = dx * 1600, dy * 1600
            self.city_state.save()
            self.snapshot = {"version": f"3:{signature}:{self.layout['revision']}", "vault": self.root.name, "districts": list(districts.values()),
                             "nodes": nodes, "edges": sorted(edges), "unresolved": unresolved,
                             "updated": time.time(), "population": len(nodes), "cityState": memory}
            self.signature = signature
            return self.snapshot


def handler_for(vault, market=None):
    """Create HTTP routes bound to one vault; the only writes are market choices forwarded to the reader."""
    market = market or Market()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            # Reject foreign hosts/origins, including DNS-rebinding requests.
            host = self.headers.get("Host", "")
            expected = f"127.0.0.1:{self.server.server_port}"
            origin = self.headers.get("Origin")
            if host not in (expected, f"localhost:{self.server.server_port}") or (origin and origin not in (f"http://{expected}", f"http://localhost:{self.server.server_port}")):
                self.send_error(403)
                return
            route = urlsplit(self.path)
            try:
                if route.path == "/api/city":
                    snapshot = vault.build()
                    # Conditional request: the client already holds this version, so no body is sent.
                    tag = f'"{snapshot["version"]}"'
                    if self.headers.get("If-None-Match") == tag:
                        self.not_modified(tag)
                        return
                    self.respond(json.dumps(snapshot, ensure_ascii=False).encode(), "application/json; charset=utf-8", tag)
                elif route.path in ("/api/preparation", "/api/preparation/world", "/api/preparation/inspect"):
                    entity = parse_qs(route.query).get("entity", [None])[0] if route.path.endswith("/inspect") else None
                    self.respond(json.dumps(vault.preparation.read(vault.build(), full=route.path.endswith("/world"), entity=entity), ensure_ascii=False).encode(), "application/json; charset=utf-8")
                elif route.path == "/api/world/live":
                    self.respond(json.dumps(vault.preparation.live_state(vault.build()), ensure_ascii=False).encode(), "application/json; charset=utf-8")
                elif route.path == "/api/world/static":
                    revision, body = vault.preparation.static_world(vault.build())
                    tag = f'"{revision}"'
                    if self.headers.get("If-None-Match") == tag:
                        self.not_modified(tag)
                        return
                    self.respond(body, "application/json; charset=utf-8", tag)
                elif route.path == "/api/world":
                    self.respond(json.dumps(vault.preparation.live(vault.build()), ensure_ascii=False).encode(), "application/json; charset=utf-8")
                elif route.path == "/api/market":
                    try:
                        payload = market.stalls()
                    except ReaderOffline:
                        payload = {"offline": True, "reader": market.base}
                    self.respond(json.dumps(payload, ensure_ascii=False).encode(), "application/json; charset=utf-8")
                elif route.path == "/api/note":
                    path = parse_qs(route.query).get("path", [""])[0]
                    self.respond(json.dumps({"path": path, "content": vault.read_note(path)}, ensure_ascii=False).encode(), "application/json; charset=utf-8")
                elif route.path in ("/", "/index.html", "/app.js", "/city-plan.js", "/details.js", "/preparation.js", "/preparation.css", "/style.css", "/market.js", "/city-mesh.js", "/scene3d.js", "/vendor/three.module.min.js", "/vendor/OrbitControls.js"):
                    name = "index.html" if route.path == "/" else route.path[1:]
                    mime = {"html": "text/html", "js": "text/javascript", "css": "text/css"}[name.rsplit(".", 1)[1]]
                    self.respond((WEB / name).read_bytes(), mime + "; charset=utf-8")
                else:
                    self.send_error(404)
            except (FileNotFoundError, IsADirectoryError, KeyError):
                self.send_error(404)
            except ValueError:
                self.send_error(400)
            except OSError:
                self.send_error(503, "Vault temporarily unavailable")

        def do_POST(self):
            port = self.server.server_port
            hosts = (f"127.0.0.1:{port}", f"localhost:{port}")
            # Same-origin JSON only, so another site cannot make the reader save or rate anything.
            if (self.headers.get("Host", "") not in hosts or self.headers.get("Origin") not in (f"http://{h}" for h in hosts)
                    or not self.headers.get("Content-Type", "").startswith("application/json")):
                self.send_error(403)
                return
            length = int(self.headers.get("Content-Length") or 0)
            if length > MARKET_BODY_BYTES:
                self.send_error(413)
                return
            route = urlsplit(self.path).path
            try:
                body = json.loads(self.rfile.read(length) or b"{}")
                if route == "/api/market/act":
                    result = market.act(body)
                elif route == "/api/market/link":
                    result = market.link(body)
                else:
                    self.send_error(404)
                    return
                self.respond(json.dumps(result, ensure_ascii=False).encode(), "application/json; charset=utf-8")
            except ReaderOffline:
                self.send_error(503, "Brain Reader is not running")
            except (KeyError, ValueError, TypeError, AttributeError):
                self.send_error(400)
            except OSError:
                self.send_error(502, "Brain Reader failed")

        def not_modified(self, tag):
            self.send_response(304)
            self.send_header("ETag", tag)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()

        def respond(self, content, mime, tag=None):
            self.send_response(200)
            self.send_header("Content-Type", mime)
            if len(content) >= COMPRESS_MIN_BYTES and "gzip" in self.headers.get("Accept-Encoding", ""):
                content = gzip.compress(content, COMPRESS_LEVEL)
                self.send_header("Content-Encoding", "gzip")
                self.send_header("Vary", "Accept-Encoding")
            if tag:
                self.send_header("ETag", tag)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
            self.end_headers()
            self.wfile.write(content)

        def log_message(self, format, *args):
            pass

    return Handler


def main():
    """Start the local viewer and optionally open its window."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vault", default=str(Path.home() / "Documents" / "brain"))
    parser.add_argument("--port", default=8765, type=int)
    parser.add_argument("--open", action="store_true")
    parser.add_argument("--reader", default=READER_URL, help="local Brain Reader that stocks the article market")
    parser.add_argument("--rebuild", action="store_true", help="replace the saved city with a fresh build (a backup is kept)")
    args = parser.parse_args()
    vault = Vault(args.vault)
    if args.rebuild:
        vault.preparation.rebuild()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler_for(vault, Market(args.reader)))
    url = f"http://127.0.0.1:{server.server_port}"
    print(f"Brain City · {url} · {vault.root}", flush=True)
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
