import http.client
import json
import sys
import tempfile
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import brain  # noqa: E402
import describe  # noqa: E402
import embed  # noqa: E402
import feeds  # noqa: E402
from model import Profile, features, rank  # noqa: E402
from reader import Reader  # noqa: E402
from server import handler_for  # noqa: E402

REDDIT = b"""<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><author><name>/u/alice</name></author><category term="LocalLLaMA" label="r/LocalLLaMA"/>
<content type="html">&lt;div class="md"&gt;&lt;p&gt;Quantized agents run fast&lt;/p&gt;&lt;/div&gt; submitted by /u/alice &lt;a href="x"&gt;[link]&lt;/a&gt;</content>
<link href="https://www.reddit.com/r/LocalLLaMA/comments/1/agents/"/><published>2026-10-25T06:00:00+00:00</published>
<title>New local agents benchmark</title></entry></feed>"""
MEDIUM = b"""<?xml version="1.0"?><rss xmlns:dc="http://purl.org/dc/elements/1.1/"
xmlns:content="http://purl.org/rss/1.0/modules/content/" version="2.0"><channel>
<item><title>Pose estimation for sport</title><link>https://medium.com/p/abc?source=rss----1&amp;sk=keep</link>
<dc:creator>Bob</dc:creator><category>computer-vision</category><pubDate>Sat, 25 Oct 2026 05:00:00 GMT</pubDate>
<content:encoded><![CDATA[<p>Tracking athletes</p><script>alert(1)</script>]]></content:encoded></item>
<item><title></title><link>https://medium.com/p/empty</link></item>
<item><title>Bad link</title><link>javascript:alert(1)</link></item></channel></rss>"""
HN = json.dumps({"hits": [{"objectID": "42", "title": "Show HN: Garden planner", "url": "https://garden.example/",
                           "points": 120, "num_comments": 30, "created_at": "2026-10-25T04:00:00Z", "author": "carol"}]}).encode()
SOURCES = [{"id": "r", "kind": "reddit", "value": "LocalLLaMA", "label": "r/LocalLLaMA"},
           {"id": "m", "kind": "medium", "value": "tag/computer-vision", "label": "Medium"},
           {"id": "h", "kind": "hn", "value": "front_page", "label": "HN"}]
ARTICLE = b"<html><nav>menu</nav><article><h1>Pose</h1><p>Full article text.</p></article></html>"


SUBS = b"""<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>Sports Analytics</title><link href="https://www.reddit.com/r/sportsanalytics/"/>
<content type="html">&lt;div&gt;Data in sport&lt;/div&gt;</content></entry>
<entry><title>Spam</title><link href="https://example.com/r/x"/></entry></feed>"""
SITE = b'<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head></html>'
PAGE = (b'<html><head><title>ignored</title><meta property="og:title" content="Pose tracking with SAM">'
        b'<meta property="og:description" content="Segment athletes"></head><body><article><p>Tracking sprinters.</p></article></body></html>')


def download(url):
    if url == "https://blog.example/pose":
        return PAGE
    if "subreddits/search" in url:
        return SUBS
    if url == "https://garden.example/":
        return SITE
    if url == "https://garden.example/feed.xml":
        return MEDIUM
    if "reddit.com/r/" in url:
        return REDDIT
    if "medium.com/feed" in url:
        return MEDIUM
    if "algolia" in url:
        return HN
    if url.startswith("https://medium.com/p/abc"):
        return ARTICLE
    raise OSError("offline")


def item(title, source="s", summary="", tags=()):
    return {"id": title, "title": title, "summary": summary, "source": source, "tags": list(tags), "published": None}


class FeedTests(unittest.TestCase):
    def test_atom_reddit_strips_footer_and_keeps_category(self):
        [entry] = feeds.parse_feed(REDDIT, SOURCES[0])
        self.assertEqual(entry["title"], "New local agents benchmark")
        self.assertEqual(entry["summary"], "Quantized agents run fast")
        self.assertEqual(entry["tags"], ["r/localllama"])
        self.assertEqual(entry["author"], "/u/alice")
        self.assertIsNotNone(entry["published"])

    def test_reddit_uses_one_request_and_splits_by_subreddit(self):
        urls = []
        python = {"id": "p", "kind": "reddit", "value": "r/Python", "label": "r/Python"}
        grouped = feeds.fetch_reddit([python, SOURCES[0]], lambda url: urls.append(url) or REDDIT)
        self.assertEqual(urls, ["https://www.reddit.com/r/Python+LocalLLaMA/top/.rss?t=day&limit=100"])
        self.assertEqual(grouped["p"], [])
        self.assertEqual([(i["source"], i["sourceLabel"]) for i in grouped["r"]], [("r", "r/LocalLLaMA")])

    def test_reddit_retries_once_after_rate_limit(self):
        calls = []

        def limited(url):
            calls.append(url)
            if len(calls) == 1:
                raise HTTPError(url, 429, "Too Many Requests", {"x-ratelimit-reset": "0"}, None)
            return REDDIT

        self.assertEqual(len(feeds.fetch_reddit([SOURCES[0]], limited)["r"]), 1)
        self.assertEqual(len(calls), 2)

    def test_rss_drops_scripts_tracking_and_unsafe_items(self):
        entries = feeds.parse_feed(MEDIUM, SOURCES[1])
        self.assertEqual([e["title"] for e in entries], ["Pose estimation for sport"])
        self.assertEqual(entries[0]["url"], "https://medium.com/p/abc?sk=keep")
        self.assertEqual(entries[0]["summary"], "Tracking athletes")

    def test_hn_uses_story_url(self):
        [entry] = feeds.parse_hn(HN, SOURCES[2])
        self.assertEqual(entry["url"], "https://garden.example/")
        self.assertIn("120 points", entry["summary"])

    def test_rejects_non_http_sources(self):
        with self.assertRaises(ValueError):
            feeds.feed_url({"kind": "rss", "value": "file:///etc/passwd"})
        with self.assertRaises(ValueError):
            feeds.fetch("file:///etc/passwd")

    def test_medium_full_text_comes_from_author_feed(self):
        author = (b'<?xml version="1.0"?><rss xmlns:content="http://purl.org/rss/1.0/modules/content/" version="2.0"><channel>'
                  b'<item><title>Pose</title><link>https://medium.com/@ann/pose-1a2b3c4d5e6f?source=rss</link>'
                  b'<content:encoded><![CDATA[<p>' + b"Full member text. " * 60 + b'</p>]]></content:encoded></item></channel></rss>')

        def fake(url):
            if url == "https://medium.com/feed/@ann":
                return author
            raise HTTPError(url, 403, "Forbidden", {}, None)
        text = feeds.fetch_full("https://medium.com/@ann/pose-1a2b3c4d5e6f", fake)
        self.assertTrue(text.startswith("Full member text."))
        self.assertEqual(feeds.fetch_full("https://blog.example/x", fake), "")

    def test_article_text_prefers_article_tag(self):
        self.assertEqual(feeds.fetch_article("https://medium.com/p/abc", download), "Pose\n\nFull article text.")


class ModelTests(unittest.TestCase):
    def test_feedback_moves_similar_items(self):
        profile = Profile()
        liked, disliked = item("rust compiler internals"), item("celebrity gossip roundup")
        for _ in range(3):
            profile.learn(features(liked), 1)
            profile.learn(features(disliked), 0)
        self.assertGreater(profile.probability(features(item("rust compiler speed"))), 0.6)
        self.assertLess(profile.probability(features(item("gossip about celebrity"))), 0.4)
        self.assertIn("rust", profile.explain(features(item("rust news"))))

    def test_rank_explores_and_spreads_sources(self):
        profile = Profile(weights={"good": 3.0})
        items = [item(f"good {i}", source="a") for i in range(10)] + [item(f"plain {i}", source=f"b{i}") for i in range(10)]
        ranked = rank(items, profile, time.time(), "2026-10-25", 10)
        self.assertEqual(len({x["id"] for x in ranked}), 10)
        self.assertTrue(ranked[4]["explore"])
        self.assertTrue(ranked[4]["title"].startswith("plain"))
        self.assertEqual(ranked, rank(items, profile, time.time(), "2026-10-25", 10))


class ReaderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.vault, self.state = root / "vault", root / "state"
        (self.vault / "projects").mkdir(parents=True)
        (self.vault / "projects" / "cv.md").write_text("---\ntags: [computer-vision, pose-estimation]\n---\n")
        self.reader = Reader(self.vault, self.state, download)
        self.reader.set_sources(SOURCES)
        self.reader.refresh()

    def tearDown(self):
        self.temp.cleanup()

    def test_refresh_merges_sources_and_uses_brain_prior(self):
        feed = self.reader.feed()
        self.assertEqual(feed["new"], 3)
        self.assertEqual(feed["errors"], {})
        self.assertGreater(self.reader.profile.prior["pose"], 0)
        self.assertEqual(feed["items"][0]["title"], "Pose estimation for sport")

    def test_save_writes_inbox_note_once_and_learns(self):
        hub = self.vault / '_global/library.md'
        hub.parent.mkdir(exist_ok=True)
        hub.write_text('# Бібліотека\n\n## Каталог\n\nФонд поки порожній. Тут з’являться посилання на справді збережені матеріали.\n\n## Розміщення\nПравила.\n')
        target = next(i for i in self.reader.feed()["items"] if i["kind"] == "medium")
        note = self.reader.act(target["id"], "save")["note"]
        text = (self.vault / note).read_text()
        self.assertTrue(note.startswith("_global/library/articles/reader-"))
        self.assertIn("type: article", text)
        self.assertIn("domain: general", text)
        self.assertIn("importance: reference", text)
        self.assertNotIn("project:", text)
        self.assertIn("status: inbox", text)
        self.assertIn("knowledge_scope: library", text)
        self.assertIn("Full article text.", text)
        self.assertNotIn("menu", text)
        self.assertEqual(self.reader.act(target["id"], "save")["note"], note)
        self.assertEqual(hub.read_text().count('[['+note[:-3]), 1)
        self.assertNotIn('Фонд поки порожній', hub.read_text())
        self.assertIn('## Розміщення\nПравила.', hub.read_text())
        self.assertEqual(len(list((self.vault / "_global/library/articles").iterdir())), 1)
        self.assertEqual(self.reader.feed()["new"], 2)
        self.assertEqual([i["id"] for i in self.reader.listed("save")["items"]], [target["id"]])

    def test_article_text_is_fetched_once_and_never_written_to_the_vault(self):
        target = next(i for i in self.reader.feed()["items"] if i["kind"] == "medium")
        calls = []
        self.reader.download = lambda url: calls.append(url) or download(url)
        article = self.reader.article(target["id"])
        self.assertIn("Full article text.", article["text"])
        self.assertEqual(article["title"], target["title"])
        fetched = len(calls)
        self.assertEqual(self.reader.article(target["id"])["text"], article["text"])
        self.assertEqual(len(calls), fetched, "the second read uses the kept text")
        self.assertFalse((self.vault / "_global").exists())
        with self.assertRaises(KeyError):
            self.reader.article("missing")

    def test_state_survives_restart_and_stays_outside_vault(self):
        target = self.reader.feed()["items"][0]
        self.reader.act(target["id"], "dislike")
        again = Reader(self.vault, self.state, download)
        self.assertEqual(again.state["items"][target["id"]]["status"], "dislike")
        self.assertEqual(again.profile.weights, self.reader.profile.weights)
        with self.assertRaises(ValueError):
            Reader(self.vault, self.vault / "inside", download)

    def test_failed_source_is_reported_without_stopping_others(self):
        self.reader.set_sources(SOURCES + [{"kind": "rss", "value": "https://offline.example/feed"}])
        self.reader.refresh()
        self.assertEqual(list(self.reader.sources()["errors"]), ["rss-https-offline-example-feed"])

    def test_fresh_reader_waits_for_user_choice(self):
        fresh = Reader(self.vault, Path(self.temp.name) / "fresh", download)
        fresh.refresh()
        self.assertTrue(fresh.feed()["setup"])
        self.assertEqual(fresh.state["items"], {})
        catalog = fresh.sources()["catalog"]
        self.assertIn("reddit-localllama", [s["id"] for g in catalog for s in g["sources"]])
        self.assertFalse(self.reader.feed()["setup"])

    def test_topics_boost_and_mute(self):
        self.reader.set_topics(["garden planner"], ["agents"])
        titles = [i["title"] for i in self.reader.feed()["items"]]
        self.assertEqual(titles[0], "Show HN: Garden planner")
        self.assertNotIn("New local agents benchmark", titles)
        self.assertEqual(Reader(self.vault, self.state, download).profile.topics["garden"], 1.5)

    def test_note_names_do_not_collide(self):
        entry = feeds.parse_feed(MEDIUM, SOURCES[1])[0]
        first = brain.save_note(self.vault, entry, "a", [])
        second = brain.save_note(self.vault, entry, "b", [])
        self.assertNotEqual(first, second)
        self.assertNotEqual((self.vault / first).read_text().splitlines()[1], (self.vault / second).read_text().splitlines()[1])


class LinkTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.vault = Path(self.temp.name) / "vault"
        self.vault.mkdir()
        self.reader = Reader(self.vault, Path(self.temp.name) / "state", download)

    def tearDown(self):
        self.temp.cleanup()

    def test_dropped_link_is_fetched_saved_and_learnt_strongly(self):
        result = self.reader.add_link("https://blog.example/pose?utm_source=x")
        text = (self.vault / result["note"]).read_text()
        self.assertEqual(result["title"], "Pose tracking with SAM")
        self.assertIn("Tracking sprinters.", text)
        self.assertIn("ти сам закинув це посилання", text)
        self.assertIn('source: "https://blog.example/pose"', text)
        self.assertEqual(self.reader.listed("save")["items"][0]["id"], result["id"])
        liked = Profile()
        liked.learn(features(self.reader.state["items"][result["id"]]), 1)
        self.assertGreater(self.reader.profile.weights["sam"], liked.weights["sam"])
        again = self.reader.add_link("https://blog.example/pose")
        self.assertTrue(again["duplicate"])
        self.assertEqual(len(list((self.vault / "_global/library/articles").iterdir())), 1)

    def test_browser_text_beats_fetch_and_bad_links_fail(self):
        url = "https://medium.com/@ann/pose-estimation-in-football-1a2b3c4d5e6f"
        note = self.reader.add_link(url, "Pose estimation in football", "Members-only body.")["note"]
        self.assertIn("Members-only body.", (self.vault / note).read_text())
        self.assertEqual(self.reader.add_link("https://offline.example/")["title"], "https://offline.example/")
        self.assertEqual(self.reader.add_link("https://medium.com/@k/software-2-0-a64152b37c35")["title"], "Software 2 0")
        for bad in ("javascript:alert(1)", "file:///etc/passwd", ""):
            with self.assertRaises(ValueError):
                self.reader.add_link(bad)

    def test_discovery_suggests_new_sources_with_sample_articles(self):
        self.reader.set_sources([SOURCES[0], SOURCES[2]])
        self.reader.refresh()
        garden = next(i for i in self.reader.feed()["items"] if i["kind"] == "hn")
        self.reader.act(garden["id"], "like")
        self.reader.add_link("https://medium.com/@ann/pose-estimation-in-football-1a2b3c4d5e6f", "Pose estimation in football", "x")
        self.reader.add_link("https://www.reddit.com/r/sportsanalytics/comments/9/xg/", "xG models", "y")
        self.reader.discover()
        found = {s["id"]: s for s in self.reader.suggestions()["suggestions"]}
        self.assertIn("reddit-sportsanalytics", found)
        self.assertIn("medium-ann", found)
        self.assertIn("rss-https-garden-example-feed-xml", found)
        self.assertNotIn("reddit-localllama", found)
        self.assertEqual(found["medium-ann"]["samples"][0]["title"], "Pose estimation for sport")
        sample = next(i for i in self.reader.feed()["items"] if i.get("suggested"))
        self.assertIn(sample["suggested"], [s["label"] for s in found.values()])

        self.reader.answer_suggestion("medium-ann", False)
        self.reader.answer_suggestion("reddit-sportsanalytics", True)
        self.assertIn("reddit-sportsanalytics", [s["id"] for s in self.reader.state["sources"]])
        self.assertNotIn("medium-ann", [i["source"] for i in self.reader.state["items"].values() if i["status"] == "new"])
        self.reader.discover()
        remaining = [s["id"] for s in self.reader.suggestions()["suggestions"]]
        self.assertNotIn("medium-ann", remaining)
        self.assertNotIn("reddit-sportsanalytics", remaining)

    def test_old_account_sources_are_dropped_on_load(self):
        state = Path(self.temp.name) / "state" / "state.json"
        self.reader.set_sources([SOURCES[0]])
        data = json.loads(state.read_text())
        data["sources"].append({"id": "gmail-x", "kind": "gmail", "value": "from:x", "label": "x"})
        state.write_text(json.dumps(data))
        again = Reader(self.vault, state.parent, download)
        self.assertEqual([s["kind"] for s in again.state["sources"]], ["reddit"])


CONCEPTS = {"football": 0, "soccer": 0, "футбол": 0, "xg": 0, "bread": 1, "sourdough": 1, "хліб": 1, "agents": 2, "llm": 2}


class FakeEmbedder:
    """Maps synonyms across languages to one dimension, like a multilingual model would."""

    def __init__(self):
        self.calls = 0

    def vectors(self, texts):
        self.calls += 1
        result = []
        for text in texts:
            values = [0.0] * 4
            for word in text.lower().replace(":", " ").split():
                values[CONCEPTS.get(word, 3)] += 1.0 if word in CONCEPTS else 0.1
            result.append(embed.encode(values))
        return result


class EmbeddingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.vault = Path(self.temp.name) / "vault"
        self.vault.mkdir()
        (self.vault / "bake.md").write_text('---\nsummary: "Sourdough notes"\n---\n# Bread log\n')
        self.embedder = FakeEmbedder()
        self.reader = Reader(self.vault, Path(self.temp.name) / "state", download, self.embedder)

    def tearDown(self):
        self.temp.cleanup()

    def items(self, *titles):
        found = [feeds.make_item({"id": f"s{i}", "kind": "rss", "label": "x"}, t, f"https://e.example/{i}", "", None)
                 for i, t in enumerate(titles)]
        self.reader._embed(found)
        return found

    def test_vectors_round_trip_as_unit_float16(self):
        values = embed.decode(embed.encode([3.0, 4.0]))
        self.assertAlmostEqual(values[0], 0.6, places=3)
        self.assertAlmostEqual(values[1], 0.8, places=3)

    def test_meaning_transfers_without_shared_words(self):
        liked, football, bread = self.items("Soccer tactics explained", "Аналітика: футбол у цифрах", "Shaping a loaf at home")
        before = self.reader.profile.probability(features(football)) - self.reader.profile.probability(features(bread))
        for _ in range(3):
            self.reader.profile.learn(features(liked), 1)
        after = self.reader.profile.probability(features(football)) - self.reader.profile.probability(features(bread))
        self.assertGreater(after - before, 0.1)
        self.assertIn("схожий зміст", self.reader.profile.explain(features(football)))

    def test_brain_and_topics_add_semantic_prior(self):
        self.assertTrue(any(k.startswith("e:") for k in self.reader.profile.prior))
        bread, agents = self.items("Хліб на заквасці", "Agents everywhere")
        self.assertGreater(self.reader.profile.probability(features(bread)), self.reader.profile.probability(features(agents)))
        self.reader.set_topics(["llm"], [])
        self.assertGreater(self.reader.profile.probability(features(agents)), self.reader.profile.probability(features(bread)))
        self.assertFalse(any(t.startswith("e:") for t, _ in self.reader.interests()["liked"]))

    def test_feed_items_get_vectors_but_api_hides_them(self):
        self.reader.set_sources(SOURCES)
        self.reader.refresh()
        self.assertTrue(all(i.get("vec") for i in self.reader.state["items"].values()))
        self.assertFalse(any("vec" in i for i in self.reader.feed()["items"]))
        calls = self.embedder.calls
        self.reader.refresh()
        self.assertEqual(self.embedder.calls, calls)

    def test_broken_model_falls_back_to_terms(self):
        class Broken:
            def vectors(self, texts):
                raise OSError("no model")
        reader = Reader(self.vault, Path(self.temp.name) / "broken", download, Broken())
        self.assertIsNone(reader.embedder)
        reader.set_sources(SOURCES)
        reader.refresh()
        self.assertEqual(reader.feed()["new"], 3)


class DescribeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        vault = Path(self.temp.name) / "vault"
        vault.mkdir()
        self.calls = []

        def describer(articles):
            self.calls.append(articles)
            return {a["id"]: f"Опис: {a['title']}" for a in articles}
        self.reader = Reader(vault, Path(self.temp.name) / "state", download, describer=describer)
        self.reader.set_sources(SOURCES)
        self.reader.refresh()

    def tearDown(self):
        self.temp.cleanup()

    def test_top_items_are_described_once_with_article_text(self):
        feed = self.reader.feed(limit=2)
        self.assertEqual(len(feed["items"]), 2)
        self.assertTrue(self.reader.needs_description(feed["items"]))
        self.reader.describe(2)
        self.assertEqual(len(self.calls[0]), 2)
        pose = next(a for a in self.calls[0] if a["title"] == "Pose estimation for sport")
        self.assertIn("Full article text.", pose["text"])
        described = self.reader.feed(limit=2)["items"]
        self.assertTrue(all(i["about"].startswith("Опис:") for i in described))
        self.assertFalse(self.reader.needs_description(described))
        self.reader.describe(2)
        self.assertEqual(len(self.calls), 1)

    def test_failure_backs_off_and_keeps_summaries(self):
        def broken(articles):
            raise RuntimeError("no auth")
        self.reader.describer = broken
        self.reader.describe(3)
        self.assertIn("descriptions", self.reader.state["errors"])
        self.assertFalse(self.reader.needs_description(self.reader.feed()["items"]))
        self.assertFalse(any(i.get("about") for i in self.reader.feed()["items"]))

    def test_cli_call_has_no_tools_and_reads_structured_output(self):
        seen = {}

        def run(command, **options):
            seen.update(command=command, **options)
            reply = {"is_error": False, "structured_output": {"items": [{"id": "a", "about": " Про пози. "}, {"id": "zz", "about": "x"}]}}
            return type("Done", (), {"returncode": 0, "stdout": json.dumps(reply), "stderr": ""})()
        found = describe.Describer("claude", Path(self.temp.name) / "work", run)([{"id": "a", "title": "T", "source": "S", "text": "x" * 9000}])
        self.assertEqual(found, {"a": "Про пози."})
        self.assertEqual(seen["command"][seen["command"].index("--tools") + 1], "")
        self.assertIn("--no-session-persistence", seen["command"])
        self.assertLess(len(seen["input"]), 4000)


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        vault = Path(self.temp.name) / "vault"
        vault.mkdir()
        reader = Reader(vault, Path(self.temp.name) / "state", download)
        reader.set_sources(SOURCES)
        reader.refresh()
        self.item = reader.feed()["items"][0]["id"]
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(reader))
        self.port = self.server.server_port
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.temp.cleanup()

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port)
        connection.request(method, path, body, {"Host": f"127.0.0.1:{self.port}", **(headers or {})})
        response = connection.getresponse()
        data = response.read()
        connection.close()
        return response.status, data

    def test_get_feed_and_static(self):
        status, body = self.request("GET", "/api/feed")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["new"], 3)
        self.assertEqual(self.request("GET", "/")[0], 200)
        self.assertEqual(self.request("GET", "/../server.py")[0], 404)

    def test_post_requires_same_origin_json(self):
        body = json.dumps({"id": self.item, "action": "like"})
        same = {"Origin": f"http://127.0.0.1:{self.port}", "Content-Type": "application/json"}
        self.assertEqual(self.request("POST", "/api/feedback", body, {"Content-Type": "application/json"})[0], 403)
        self.assertEqual(self.request("POST", "/api/feedback", body, {**same, "Origin": "http://evil.example"})[0], 403)
        self.assertEqual(self.request("POST", "/api/feedback", body, {**same, "Content-Type": "text/plain"})[0], 403)
        self.assertEqual(self.request("POST", "/api/feedback", body, same)[0], 200)
        self.assertEqual(self.request("POST", "/api/feedback", json.dumps({"id": "nope", "action": "like"}), same)[0], 404)
        self.assertEqual(self.request("GET", "/api/feed", headers={"Host": "evil.example"})[0], 403)

    def test_links_require_same_origin_json(self):
        same = {"Origin": f"http://127.0.0.1:{self.port}", "Content-Type": "application/json"}
        body = json.dumps({"url": "https://blog.example/pose", "title": "Pose", "text": "Body text"})
        self.assertEqual(self.request("POST", "/api/links", body, {**same, "Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.request("POST", "/api/links", json.dumps({"url": "ftp://x"}), same)[0], 400)
        status, data = self.request("POST", "/api/links", body, same)
        self.assertEqual((status, json.loads(data)["title"]), (200, "Pose"))
        self.assertEqual(self.request("GET", "/add")[0], 200)

if __name__ == "__main__":
    unittest.main()
