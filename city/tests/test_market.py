"""Check the article market end to end: city routes forward to a real Brain Reader."""

import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

CITY = Path(__file__).resolve().parents[1]
READER = CITY.parent / "reader"
if not READER.is_dir():
    READER = CITY / "reader"
sys.path.insert(0, str(CITY))
sys.path.insert(1, str(READER))
from market import Market  # noqa: E402
from server import Vault, handler_for  # noqa: E402
from reader import Reader  # noqa: E402

spec = importlib.util.spec_from_file_location("reader_server", READER / "server.py")
reader_server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader_server)

FEED = b"""<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>Pose estimation for sprinters</title><link>https://blog.example/pose</link><description>Tracking</description></item>
<item><title>Sourdough at home</title><link>https://blog.example/bread</link><description>Bread</description></item>
</channel></rss>"""


def download(url):
    if url == "https://blog.example/feed":
        return FEED
    if url == "https://blog.example/pose":
        return b"<html><article><p>Full pose article.</p></article></html>"
    raise OSError("offline")


def serve(handler):
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


class MarketTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.brain = root / "vault"
        (self.brain / "projects").mkdir(parents=True)
        (self.brain / "projects" / "lab.md").write_text("---\ntype: hub\n---\n# Lab\n", encoding="utf-8")
        reader = Reader(self.brain, root / "reader", download)
        reader.set_sources([{"kind": "rss", "value": "https://blog.example/feed", "label": "Blog"}])
        reader.refresh()
        self.reader = serve(reader_server.handler_for(reader))
        market = Market(f"http://127.0.0.1:{self.reader.server_port}")
        self.city = serve(handler_for(Vault(self.brain, root / "city"), market))
        self.base = f"http://127.0.0.1:{self.city.server_port}"

    def tearDown(self):
        for server in (self.city, self.reader):
            server.shutdown()
            server.server_close()
        self.temp.cleanup()

    def post(self, path, body, origin=True):
        headers = {"Content-Type": "application/json", **({"Origin": self.base} if origin else {})}
        with urlopen(Request(self.base + path, json.dumps(body).encode(), headers)) as response:
            return json.load(response)

    def test_stalls_take_and_drop_links(self):
        with urlopen(self.base + "/api/market") as response:
            market = json.load(response)
        self.assertEqual(market["new"], 2)
        self.assertEqual([s["name"] for s in market["stalls"]], ["Ряд блогів"])
        pose = next(i for i in market["stalls"][0]["items"] if i["title"].startswith("Pose"))
        self.assertNotIn("vec", pose)
        note = self.post("/api/market/act", {"id": pose["id"], "action": "save"})["note"]
        self.assertTrue(note.startswith('_global/library/articles/'))
        with urlopen(self.base + '/api/city') as response:
            saved = next(n for n in json.load(response)['nodes'] if n['id']==note)
        self.assertEqual(saved['knowledgeScope'],'library')
        self.assertEqual(saved['cityRole'],'library-item')
        self.assertEqual(saved['ownerProject'],'')
        self.assertIn("Full pose article.", (self.brain / note).read_text(encoding="utf-8"))
        with urlopen(self.base + "/api/market") as response:
            self.assertEqual(json.load(response)["new"], 1)
        dropped = self.post("/api/market/link", {"url": "https://other.example/a", "title": "Dropped", "text": "Body"})
        self.assertTrue((self.brain / dropped["note"]).exists())

    def test_writes_need_same_origin_json_and_known_actions(self):
        for body, origin in (({"id": "x", "action": "save"}, False), ({"url": "https://a.example"}, False)):
            with self.assertRaises(HTTPError) as error:
                self.post("/api/market/act", body, origin)
            self.assertEqual(error.exception.code, 403)
        with self.assertRaises(HTTPError) as error:
            urlopen(Request(self.base + "/api/market/act", b"{}", {"Origin": self.base, "Content-Type": "text/plain"}))
        self.assertEqual(error.exception.code, 403)
        for body in ({"id": "x", "action": "delete"}, {"id": "missing", "action": "like"}):
            with self.assertRaises(HTTPError) as error:
                self.post("/api/market/act", body)
            self.assertEqual(error.exception.code, 400)

    def test_offline_reader_is_reported_not_raised(self):
        self.reader.shutdown()
        self.reader.server_close()
        with urlopen(self.base + "/api/market") as response:
            self.assertTrue(json.load(response)["offline"])
        with self.assertRaises(HTTPError) as error:
            self.post("/api/market/link", {"url": "https://a.example"})
        self.assertEqual(error.exception.code, 503)
        self.reader = serve(reader_server.handler_for(Reader(self.brain, Path(self.temp.name) / "r2", download)))


if __name__ == "__main__":
    unittest.main()
