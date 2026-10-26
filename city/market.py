"""Proxy the city's article market to the local Brain Reader, which owns every write."""

import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

READER_URL = "http://127.0.0.1:8766"
TIMEOUT_SECONDS = 20
# One delivery: a short list to read over coffee, each with a written description.
MARKET_LIMIT = 12
STALLS = {"reddit": "Ряд Reddit", "medium": "Ряд Medium", "hn": "Ряд Hacker News", "rss": "Ряд блогів"}
NEW_STALL = "Нові постачальники"
ACTIONS = ("like", "dislike", "hide", "save")
LIKED_FIELDS = ("id", "url", "title", "about", "summary", "sourceLabel")
ITEM_FIELDS = ("id", "url", "title", "summary", "sourceLabel", "published", "score", "why", "explore", "suggested", "about")


class ReaderOffline(OSError):
    """The reader process is not running."""


class Market:
    """Read the reader's ranked feed as market stalls and forward the user's choices."""

    def __init__(self, base=READER_URL):
        self.base = base.rstrip("/")

    def call(self, path, body=None):
        headers = {"Accept": "application/json"}
        data = None
        if body is not None:
            # The reader accepts writes only from its own origin.
            headers.update({"Content-Type": "application/json", "Origin": self.base})
            data = json.dumps(body).encode()
        try:
            with urlopen(Request(self.base + path, data, headers), timeout=TIMEOUT_SECONDS) as response:
                return json.loads(response.read())
        except HTTPError as error:
            if error.code in (400, 404):
                raise ValueError(f"Reader rejected {path}: {error.code}") from error
            raise
        except URLError as error:
            raise ReaderOffline(str(error.reason)) from error

    def stalls(self, limit=MARKET_LIMIT):
        """Group today's top `limit` ranked articles into stalls by where they came from."""
        feed = self.call(f"/api/feed?limit={limit}")
        stalls = {}
        for item in feed["items"]:
            name = NEW_STALL if item.get("suggested") else STALLS.get(item.get("kind"), "Ряд блогів")
            stalls.setdefault(name, []).append({k: item.get(k) for k in ITEM_FIELDS})
        return {"stalls": [{"name": name, "items": items} for name, items in stalls.items()],
                "new": feed["new"], "lastFetch": feed["lastFetch"], "refreshing": feed["refreshing"], "setup": feed["setup"],
                "describing": feed.get("describing", False),
                "more": len(feed["items"]) >= limit and feed["new"] > len(feed["items"])}

    def liked(self):
        """Liked articles not yet taken into Brain: the library's reading shelf."""
        items = self.call("/api/items?status=like")["items"]
        return {"items": [{k: item.get(k) for k in LIKED_FIELDS} for item in items if item.get("status") == "like"]}

    def act(self, body):
        if body.get("action") not in ACTIONS:
            raise ValueError("Unknown market action")
        return self.call("/api/feedback", {"id": str(body["id"]), "action": body["action"]})

    def link(self, body):
        return self.call("/api/links", {"url": str(body["url"]), "title": str(body.get("title", "")),
                                        "text": str(body.get("text", ""))})
