"""Exercise graph fidelity, incremental growth and local file boundaries."""

import gzip
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from http.server import ThreadingHTTPServer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from simulation.rules import RULES
from server import Vault, handler_for


class CityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "vault"
        self.root.mkdir()
        self.write("classes/research.md", "---\ntype: class\nclass: research\n---\n# Research\n[[projects/lab]]")
        self.write("projects/lab.md", "---\ntype: hub\nclass: research\n---\n# Lab\n[[projects/lab/notes/alpha]]")
        self.write("projects/lab/child.md", "---\ntype: hub\n---\n# Child\n")
        self.write("projects/lab/notes/alpha.md", "# Alpha\n[[Beta]] [[missing]] [child](../child.md)")
        self.write("projects/lab/child/notes/beta.md", "# Beta\n[[Alpha]]")
        self.write("_global/templates/sample.md", "---\nclass: '{{class}}'\ntype: class\n---\nTemplate")
        self.vault = Vault(self.root, Path(self.temp.name) / "state")

    def tearDown(self):
        self.temp.cleanup()

    def write(self, path, content):
        file = self.root / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(content, encoding="utf-8")

    def test_inheritance_links_and_templates(self):
        city = self.vault.build()
        nodes = {n["id"]: n for n in city["nodes"]}
        self.assertEqual(nodes["projects/lab/child/notes/beta.md"]["district"], "research")
        self.assertEqual(nodes["_global/templates/sample.md"]["district"], "civic")
        self.assertEqual(nodes["_global/templates/sample.md"]["sourceClass"], "commons")
        self.assertEqual(len(city["districts"]), 2)
        edge = sorted(["projects/lab/notes/alpha.md", "projects/lab/child.md"])
        self.assertIn(tuple(edge), city["edges"])
        self.assertEqual(len(city["edges"]), len(set(city["edges"])))
        self.assertTrue(nodes["projects/lab.md"]["uri"].startswith("obsidian://open?vault=vault&file=projects%2Flab.md"))

    def test_live_growth_keeps_addresses_across_restart(self):
        before = self.vault.build()
        original = {n["id"]: (n["district"], n["slot"]) for n in before["nodes"]}
        columns = {d["id"]: d["columns"] for d in before["districts"]}
        self.assertIs(self.vault.build(), before)
        self.write("projects/lab/notes/new.md", "# New arrival\n[[Alpha]]")
        after = self.vault.build()
        self.assertNotEqual(before["version"], after["version"])
        self.assertEqual(after["population"], before["population"] + 1)
        for node in after["nodes"]:
            if node["id"] in original:
                self.assertEqual((node["district"], node["slot"]), original[node["id"]])
        self.assertEqual({d["id"]: d["columns"] for d in after["districts"]}, columns)
        restarted = Vault(self.root, self.vault.state_file.parent).build()
        self.assertEqual({n["id"]: n["slot"] for n in restarted["nodes"]}, {n["id"]: n["slot"] for n in after["nodes"]})

    def test_modify_remove_and_ambiguous_links(self):
        before = self.vault.build()
        self.write("other/beta.md", "# Another Beta")
        self.write("projects/lab/notes/alpha.md", "# Alpha changed\n[[Beta]]")
        after = self.vault.build()
        self.assertNotEqual(before["version"], after["version"])
        # The Alpha → Beta ambiguous reference is ignored; Beta's unique backlink remains.
        self.assertNotIn(tuple(sorted(["other/beta.md", "projects/lab/notes/alpha.md"])), after["edges"])
        (self.root / "other/beta.md").unlink()
        removed = self.vault.build()
        self.assertEqual(len(removed["nodes"]), len(before["nodes"]))

    def test_file_containment_hidden_and_symlinks(self):
        self.write(".obsidian/private.md", "private")
        outside = Path(self.temp.name) / "outside.md"
        outside.write_text("outside")
        (self.root / "escape.md").symlink_to(outside)
        ids = [n["id"] for n in self.vault.build()["nodes"]]
        self.assertNotIn("escape.md", ids)
        self.assertNotIn(".obsidian/private.md", ids)
        for path in ("../outside.md", "escape.md", ".obsidian/private.md", "file.txt"):
            with self.assertRaises(ValueError):
                self.vault.read_note(path)

    def test_http_reads_and_rejects_foreign_origin(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(self.vault))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            with urlopen(base + "/api/city") as response:
                city = json.load(response)
                self.assertEqual(city["population"], 6)
                self.assertEqual(len(city["cityState"]["capabilities"]), len(RULES))
                tag = response.headers["ETag"]
                self.assertEqual(response.headers["Cache-Control"], "no-store")
            # Unchanged sources and geometry come back as 304 without a body; live state is always fresh.
            with self.assertRaises(HTTPError) as error:
                urlopen(Request(base + "/api/city", headers={"If-None-Match": tag}))
            self.assertEqual(error.exception.code, 304)
            with urlopen(base + "/api/world/live") as response:
                live = json.load(response)
            self.assertNotIn("buildings", live)
            with urlopen(base + "/api/world/static") as response:
                static = json.load(response)
                static_tag = response.headers["ETag"]
            self.assertEqual(static["staticRevision"], live["staticRevision"])
            self.assertNotIn("residents", static)
            with self.assertRaises(HTTPError) as error:
                urlopen(Request(base + "/api/world/static", headers={"If-None-Match": static_tag}))
            self.assertEqual(error.exception.code, 304)
            with urlopen(Request(base + "/api/world/static", headers={"Accept-Encoding": "gzip"})) as response:
                self.assertEqual(response.headers["Content-Encoding"], "gzip")
                self.assertEqual(json.loads(gzip.decompress(response.read())), static)
            for route in ("/api/note?path=../outside.md", "/api/note?path=.obsidian/private.md"):
                with self.assertRaises(HTTPError) as error:
                    urlopen(base + route)
                self.assertEqual(error.exception.code, 400)
            self.write("projects/lab/notes/figure.svg",'<svg xmlns="http://www.w3.org/2000/svg"/>')
            with urlopen(base+"/api/asset?path=figure.svg&note=projects/lab/notes/alpha.md") as response:
                self.assertEqual(response.headers["Content-Type"],"image/svg+xml")
                self.assertIn(b"<svg",response.read())
            for route in ("/document-reader.js","/document-reader.css","/vendor/marked.min.js","/vendor/purify.min.js","/vendor/mermaid.min.js"):
                with urlopen(base+route) as response:
                    self.assertEqual(response.status,200)
                    self.assertTrue(response.read())
            with self.assertRaises(HTTPError) as error:
                urlopen(Request(base + "/api/city", headers={"Origin": "https://foreign.example"}))
            self.assertEqual(error.exception.code, 403)
            with self.assertRaises(HTTPError) as error:
                urlopen(Request(base + "/api/city", headers={"Host": "foreign.example"}))
            self.assertEqual(error.exception.code, 403)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_illustrations_resolve_relative_unique_names_and_reject_unsafe_paths(self):
        svg='<svg xmlns="http://www.w3.org/2000/svg"/>'
        self.write("attachments/plot.svg",svg)
        self.assertEqual(self.vault.read_asset("../attachments/plot.svg","projects/lab.md"),(svg.encode(),"image/svg+xml"))
        self.assertEqual(self.vault.read_asset("plot.svg","projects/lab/notes/alpha.md"),(svg.encode(),"image/svg+xml"))
        self.write("other/plot.svg",svg)
        with self.assertRaises(FileNotFoundError):
            self.vault.read_asset("plot.svg","projects/lab/notes/alpha.md")
        outside=Path(self.temp.name)/"outside.png";outside.write_bytes(b"private")
        (self.root/"escape.png").symlink_to(outside)
        self.write(".obsidian/private.png","private")
        for path in ("../outside.png","escape.png",".obsidian/private.png","projects/lab.md","https://example.org/a.png"):
            with self.assertRaises(ValueError):
                self.vault.read_asset(path)


if __name__ == "__main__":
    unittest.main()
