#!/usr/bin/env python3
"""Serve the local Brain Reader: a learning feed of public articles plus links the user drops in."""

import argparse
import json
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import describe
import embed
from reader import FEED_LIMIT, Reader

WEB = Path(__file__).parent / "web"
# /add is the page the browser bookmarklet opens with the article in its URL fragment.
STATIC = {"/": "index.html", "/index.html": "index.html", "/add": "index.html", "/app.js": "app.js", "/style.css": "style.css"}
MIME = {"html": "text/html", "js": "text/javascript", "css": "text/css"}
MAX_BODY_BYTES = 64 * 1024
MAX_LINK_BYTES = 1024 * 1024
LINK_ROUTE = "/api/links"


def handler_for(reader):
    """Create HTTP routes bound to one reader; writes only through JSON POSTs from this origin."""
    class Handler(BaseHTTPRequestHandler):
        def allowed(self, require_origin):
            # Reject foreign hosts/origins, including DNS-rebinding and cross-site POSTs.
            port = self.server.server_port
            hosts = (f"127.0.0.1:{port}", f"localhost:{port}")
            origin = self.headers.get("Origin")
            if self.headers.get("Host", "") not in hosts:
                return False
            if origin is None:
                return not require_origin
            return origin in (f"http://{h}" for h in hosts)

        def do_GET(self):
            if not self.allowed(False):
                self.send_error(403)
                return
            route = urlsplit(self.path)
            try:
                if route.path == "/api/feed":
                    if reader.stale() and not reader.refreshing:
                        threading.Thread(target=reader.refresh, daemon=True).start()
                    limit = int(parse_qs(route.query).get("limit", [FEED_LIMIT])[0])
                    feed = reader.feed(limit=limit)
                    if not feed["refreshing"] and reader.needs_description(feed["items"]):
                        threading.Thread(target=reader.describe, args=(limit,), daemon=True).start()
                        feed["describing"] = True
                    self.json(feed)
                elif route.path == "/api/items":
                    self.json(reader.listed(parse_qs(route.query).get("status", ["like"])[0]))
                elif route.path == "/api/interests":
                    self.json(reader.interests())
                elif route.path == "/api/sources":
                    self.json(reader.sources())
                elif route.path == "/api/suggestions":
                    self.json(reader.suggestions())
                elif route.path in STATIC:
                    name = STATIC[route.path]
                    self.respond((WEB / name).read_bytes(), MIME[name.rsplit(".", 1)[1]] + "; charset=utf-8")
                else:
                    self.send_error(404)
            except ValueError:
                self.send_error(400)

        def do_POST(self):
            route = urlsplit(self.path).path
            kind = self.headers.get("Content-Type", "")
            if not self.allowed(True) or not kind.startswith("application/json"):
                self.send_error(403)
                return
            length = int(self.headers.get("Content-Length") or 0)
            if length > (MAX_LINK_BYTES if route == LINK_ROUTE else MAX_BODY_BYTES):
                self.send_error(413)
                return
            try:
                body = json.loads(self.rfile.read(length) or b"{}")
                if route == LINK_ROUTE:
                    self.json(reader.add_link(body["url"], body.get("title", ""), body.get("text", "")))
                elif route == "/api/discover":
                    threading.Thread(target=reader.discover, daemon=True).start()
                    self.json({"discovering": True})
                elif route == "/api/suggestions":
                    self.json(reader.answer_suggestion(str(body["id"]), bool(body["accept"])))
                elif route == "/api/feedback":
                    self.json(reader.act(str(body["id"]), str(body["action"])))
                elif route == "/api/refresh":
                    threading.Thread(target=reader.refresh, daemon=True).start()
                    self.json({"refreshing": True})
                elif route == "/api/sources":
                    self.json(reader.set_sources(list(body["sources"])))
                elif route == "/api/topics":
                    self.json(reader.set_topics(list(body["like"]), list(body["mute"])))
                elif route == "/api/forget":
                    reader.forget(str(body["term"]))
                    self.json(reader.interests())
                else:
                    self.send_error(404)
            except KeyError:
                self.send_error(404)
            except (ValueError, TypeError):
                self.send_error(400)
            except OSError:
                self.send_error(503, "Vault temporarily unavailable")

        def json(self, payload):
            self.respond(json.dumps(payload, ensure_ascii=False).encode(), "application/json; charset=utf-8")

        def respond(self, content, mime):
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
            self.end_headers()
            self.wfile.write(content)

        def log_message(self, format, *args):
            pass

    return Handler


def main():
    """Start the local reader and optionally open it in a browser."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vault", default=str(Path.home() / "Documents" / "brain"))
    parser.add_argument("--port", default=8766, type=int)
    parser.add_argument("--open", action="store_true")
    args = parser.parse_args()
    reader = Reader(args.vault, embedder=embed.load(), describer=describe.load(Path.home() / ".cache" / "brain-reader" / "claude"))
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler_for(reader))
    url = f"http://127.0.0.1:{server.server_port}"
    ranking = "terms + embeddings" if reader.embedder else "terms only (run with: uv run --with fastembed)"
    descriptions = "claude -p descriptions" if reader.describer else "no descriptions (claude CLI not found)"
    print(f"Brain Reader · {url} · {reader.vault} · {ranking} · {descriptions}", flush=True)
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
