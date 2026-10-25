"""Fetch public feeds and normalise them into reader items."""

import hashlib
import html
import json
import re
import ssl
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qsl, quote, urlencode, urljoin, urlsplit, urlunsplit
from urllib.error import HTTPError
from urllib.request import Request, urlopen

USER_AGENT = "brain-reader/0.1 (personal local reader)"
TIMEOUT_SECONDS = 15
MAX_FEED_BYTES = 5 * 1024 * 1024
MAX_ARTICLE_CHARS = 40000
SUMMARY_CHARS = 600
FEED_BODY_CHARS = 20000
HN_HITS = 30
REDDIT_LIMIT = 100
REDDIT_MAX_WAIT_SECONDS = 65
KINDS = ("reddit", "medium", "hn", "rss")
SUBREDDIT_SEARCH_LIMIT = 6
ATOM = "{http://www.w3.org/2005/Atom}"
CONTENT = "{http://purl.org/rss/1.0/modules/content/}encoded"
CREATOR = "{http://purl.org/dc/elements/1.1/}creator"
SYSTEM_CA_FILE = Path("/etc/ssl/cert.pem")
TRACKING_PARAMS = {"source", "ref", "fbclid", "gclid"}


class _Text(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "nav", "footer", "header", "form", "aside", "button"}
    BLOCK = {"p", "div", "br", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "section", "article", "blockquote", "pre"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skip += 1
        elif tag in self.BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.skip:
            self.skip -= 1
        elif tag in self.BLOCK:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def html_to_text(markup):
    """Return readable paragraphs from untrusted HTML."""
    parser = _Text()
    parser.feed(markup or "")
    parser.close()
    lines = (re.sub(r"\s+", " ", line).strip() for line in "".join(parser.parts).split("\n"))
    return "\n\n".join(line for line in lines if line)


def safe_url(url):
    """Accept only absolute http(s) URLs."""
    url = (url or "").strip()
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise ValueError(f"Unsupported URL: {url[:80]}")
    return url


def canonical(url):
    """Drop fragments and tracking parameters so one article keeps one ID."""
    parts = urlsplit(url)
    query = [(k, v) for k, v in parse_qsl(parts.query) if not k.lower().startswith("utm_") and k.lower() not in TRACKING_PARAMS]
    return urlunsplit((parts.scheme, parts.netloc.lower(), parts.path.rstrip("/") or "/", urlencode(query), ""))


def feed_url(source):
    """Map a configured source to its public feed URL."""
    kind, value = source["kind"], source["value"].strip().strip("/")
    if kind == "reddit":
        return f"https://www.reddit.com/r/{quote(value.removeprefix('r/'))}/top/.rss?t=day"
    if kind == "medium":
        return f"https://medium.com/feed/{quote(value, safe='@/')}"
    if kind == "hn":
        return f"https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage={HN_HITS}"
    if kind == "rss":
        return safe_url(source["value"])
    raise ValueError(f"Unknown source kind: {kind}")


def tls_context():
    """Verify TLS, falling back to the macOS system bundle when Python ships without CA certificates."""
    context = ssl.create_default_context()
    if not context.get_ca_certs() and SYSTEM_CA_FILE.exists():
        context.load_verify_locations(SYSTEM_CA_FILE)
    return context


TLS = tls_context()


def fetch(url):
    """Download at most MAX_FEED_BYTES from a public URL."""
    request = Request(safe_url(url), headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    with urlopen(request, timeout=TIMEOUT_SECONDS, context=TLS) as response:
        body = response.read(MAX_FEED_BYTES + 1)
    if len(body) > MAX_FEED_BYTES:
        raise ValueError("Response too large")
    return body


def timestamp(value):
    """Parse RFC 822 or ISO 8601 dates; unknown dates become None."""
    if not value:
        return None
    try:
        moment = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        try:
            moment = datetime.fromisoformat(value.strip())
        except ValueError:
            return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.timestamp()


def make_item(source, title, link, content, published, author=None, tags=()):
    """Build one normalised item, or None when it has no usable link or title."""
    try:
        url = canonical(safe_url(link))
    except ValueError:
        return None
    title = html.unescape(re.sub(r"\s+", " ", title or "")).strip()
    if not title:
        return None
    summary = html_to_text(content)
    # Reddit appends "submitted by /u/name [link] [comments]" to every entry.
    summary = re.sub(r"\s*submitted by\s+/u/\S+.*\Z", "", summary, flags=re.S).strip()
    summary = re.sub(r"\s*Continue reading on .{1,80}»\s*\Z", "", summary).strip()
    return {
        "id": hashlib.sha1(url.encode()).hexdigest()[:16],
        "url": url,
        "title": title,
        "summary": summary[:SUMMARY_CHARS],
        "body": summary[:FEED_BODY_CHARS] if len(summary) > SUMMARY_CHARS else None,
        "published": timestamp(published),
        "source": source["id"],
        "sourceLabel": source.get("label") or source["value"],
        "kind": source["kind"],
        "author": (author or "").strip() or None,
        "tags": sorted({t.strip().lower() for t in tags if t and t.strip()})[:8],
    }


def parse_feed(body, source):
    """Parse RSS 2.0 or Atom into items."""
    root = ET.fromstring(body)
    items = []
    if root.tag == ATOM + "feed":
        for entry in root.findall(ATOM + "entry"):
            links = entry.findall(ATOM + "link")
            link = next((x.get("href") for x in links if x.get("rel", "alternate") == "alternate"), None)
            items.append(make_item(
                source, entry.findtext(ATOM + "title"), link,
                entry.findtext(ATOM + "content") or entry.findtext(ATOM + "summary"),
                entry.findtext(ATOM + "published") or entry.findtext(ATOM + "updated"),
                entry.findtext(f"{ATOM}author/{ATOM}name"),
                [c.get("label") or c.get("term") for c in entry.findall(ATOM + "category")]))
    else:
        for entry in root.iter("item"):
            items.append(make_item(
                source, entry.findtext("title"), entry.findtext("link"),
                entry.findtext(CONTENT) or entry.findtext("description"),
                entry.findtext("pubDate"), entry.findtext(CREATOR),
                [c.text for c in entry.findall("category")]))
    return [item for item in items if item]


def parse_hn(body, source):
    """Parse an Algolia Hacker News search response into items."""
    items = []
    for hit in json.loads(body).get("hits", []):
        discussion = f"https://news.ycombinator.com/item?id={hit.get('objectID')}"
        summary = f"{hit.get('points') or 0} points · {hit.get('num_comments') or 0} comments · {discussion}"
        published = hit.get("created_at")
        items.append(make_item(source, hit.get("title"), hit.get("url") or discussion, html.escape(summary),
                               published, hit.get("author")))
    return [item for item in items if item]


def reddit_download(url, download=fetch):
    """Download from Reddit, waiting once for the announced reset after a 429."""
    try:
        return download(url)
    except HTTPError as error:
        if error.code != 429:
            raise
        # Anonymous quota resets within a minute.
        reset = float(error.headers.get("x-ratelimit-reset") or REDDIT_MAX_WAIT_SECONDS)
        time.sleep(min(reset + 1, REDDIT_MAX_WAIT_SECONDS))
        return download(url)


def fetch_source(source, download=fetch):
    """Fetch and parse one configured source."""
    body = download(feed_url(source))
    return parse_hn(body, source) if source["kind"] == "hn" else parse_feed(body, source)


def subreddit(source):
    return source["value"].strip().strip("/").removeprefix("r/")


def fetch_reddit(sources, download=fetch):
    """Fetch every subreddit in one multireddit request; anonymous Reddit allows about one request a minute."""
    names = "+".join(quote(subreddit(s)) for s in sources)
    url = f"https://www.reddit.com/r/{names}/top/.rss?t=day&limit={REDDIT_LIMIT}"
    body = reddit_download(url, download)
    owners = {"r/" + subreddit(s).lower(): s for s in sources}
    grouped = {s["id"]: [] for s in sources}
    for item in parse_feed(body, sources[0]):
        owner = next((owners[t] for t in item["tags"] if t in owners), sources[0])
        item.update(source=owner["id"], sourceLabel=owner.get("label") or owner["value"])
        grouped[owner["id"]].append(item)
    return grouped


def fetch_article(url, download=fetch):
    """Return the best-effort readable text of an article page."""
    return article_text(download(url).decode("utf-8", errors="replace"))


def medium_text(url, download=fetch):
    """Medium blocks article pages for scripts, but the author's or publication's feed carries the full post."""
    parts = urlsplit(url)
    host, path = parts.netloc.lower(), [s for s in parts.path.split("/") if s]
    if host == "medium.com" and len(path) > 1:
        feed = f"https://medium.com/feed/{quote(path[0], safe='@')}"
    elif host.endswith(".medium.com") and host != "www.medium.com" and path:
        feed = f"https://{host}/feed"
    else:
        return ""
    post = path[-1].rsplit("-", 1)[-1]
    for item in parse_feed(download(feed), {"id": "medium-full", "kind": "medium", "value": feed}):
        if urlsplit(item["url"]).path.rstrip("/").rsplit("-", 1)[-1] == post:
            return max(item["body"] or "", item["summary"], key=len)
    return ""


def fetch_full(url, download=fetch):
    """Best-effort full text: the page itself, or for Medium the post from its feed."""
    try:
        text = fetch_article(url, download)
    except Exception:  # noqa: BLE001 - fall back to the Medium feed below
        text = ""
    if len(text) < SUMMARY_CHARS and "medium.com" in urlsplit(url).netloc.lower():
        try:
            text = max(text, medium_text(url, download), key=len)
        except Exception:  # noqa: BLE001
            pass
    return text


def article_text(page):
    for tag in ("article", "main", "body"):
        match = re.search(rf"<{tag}\b.*?</{tag}>", page, re.S | re.I)
        if match:
            page = match[0]
            break
    return html_to_text(page)[:MAX_ARTICLE_CHARS]


def page_meta(page, name):
    for tag in re.findall(r"<meta\b[^>]*>", page, re.I):
        if re.search(rf"(?:property|name)=[\"']{re.escape(name)}[\"']", tag, re.I):
            content = re.search(r"content=[\"']([^\"']*)", tag, re.I)
            if content:
                return html.unescape(content[1]).strip()
    return ""


def fetch_page(url, download=fetch):
    """Return the title, description and readable text of an article page."""
    page = download(url).decode("utf-8", errors="replace")
    title = re.search(r"<title[^>]*>(.*?)</title>", page, re.S | re.I)
    title = page_meta(page, "og:title") or (html.unescape(re.sub(r"\s+", " ", title[1])).strip() if title else "")
    return {"title": title, "description": page_meta(page, "og:description") or page_meta(page, "description"),
            "text": article_text(page)}


def search_subreddits(query, download=fetch):
    """Find subreddits for one phrase; Reddit returns nothing for OR-combined queries."""
    body = reddit_download(f"https://www.reddit.com/subreddits/search.rss?q={quote(query)}&limit={SUBREDDIT_SEARCH_LIMIT}", download)
    found = []
    for entry in ET.fromstring(body).findall(ATOM + "entry"):
        link = next((x.get("href") for x in entry.findall(ATOM + "link")), "") or ""
        match = re.match(r"https://(?:www\.)?reddit\.com/r/([A-Za-z0-9_]+)/?$", link)
        if match:
            found.append({"kind": "reddit", "value": match[1], "label": f"r/{match[1]}",
                          "text": html_to_text(entry.findtext(ATOM + "content"))[:SUMMARY_CHARS]})
    return found


def discover_feed(page_url, download=fetch):
    """Return the RSS/Atom URL a page advertises, or None."""
    page = download(page_url).decode("utf-8", errors="replace")
    for tag in re.findall(r"<link\b[^>]*>", page, re.I):
        if re.search(r"rel=[\"']?alternate", tag, re.I) and re.search(r"application/(rss|atom)\+xml", tag, re.I):
            href = re.search(r"href=[\"']([^\"']+)", tag, re.I)
            if href:
                return safe_url(urljoin(page_url, html.unescape(href[1])))
    return None
