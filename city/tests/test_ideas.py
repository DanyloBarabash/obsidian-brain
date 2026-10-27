"""The Mountain of Ideas: ideas live inside one mountain and are captured and grown through the city."""

import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Vault, handler_for, idea_slug  # noqa: E402
from simulation import Simulation  # noqa: E402


class IdeaTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "vault"
        (self.root / "_global").mkdir(parents=True)
        (self.root / "global.md").write_text("---\ntype: hub\n---\n# Global")
        (self.root / "_global/ideas.md").write_text("---\ntype: hub\ncity_role: idea-mountain\n---\n# Гора ідей")
        self.vault = Vault(self.root, Path(self.temp.name) / "state")

    def tearDown(self):
        self.temp.cleanup()

    def test_ideas_share_the_mountain_instead_of_separate_houses(self):
        first = self.vault.add_idea("Гора ідей\nЗаписувати думки, поки не забулись", now=43200)
        second = self.vault.add_idea("Гора ідей", now=43200)
        self.assertEqual(first, "_global/ideas/idea-1970-01-01-hora-idei.md")
        self.assertEqual(second, "_global/ideas/idea-1970-01-01-hora-idei-2.md")
        data = self.vault.build()
        by_id = {n["id"]: n for n in data["nodes"]}
        self.assertEqual(by_id["_global/ideas.md"]["cityRole"], "idea-mountain")
        self.assertEqual(by_id[first]["cityRole"], "idea")
        model = Simulation()
        model.sync(data)
        hub = model.state["buildings"][by_id["_global/ideas.md"]["stableId"]]
        ideas = [model.state["buildings"][by_id[path]["stableId"]] for path in (first, second)]
        self.assertEqual(by_id[first]["district"], "ideas", "ideas form their own district, not the civic centre")
        self.assertTrue(all(i["physicalId"] == hub["physicalId"] for i in ideas), "ideas are units of one shared house")
        mountain = model.world.state["services"]["facility:ideas"]
        self.assertEqual((mountain["function"], mountain["title"]), ("idea-mountain", "Гора ідей"))
        self.assertEqual(model.audit(), [])

    def test_capture_list_and_stages(self):
        path = self.vault.add_idea("Тиха гра про місто\n\nПовільне зростання.", now=86400 * 400)
        ideas = self.vault.ideas()
        updated = ideas[0].pop("updated")
        self.assertEqual(ideas, [{"path": path, "title": "Тиха гра про місто", "status": "seed", "created": "1971-02-05",
                                  "summary": "Повільне зростання.", "words": 2, "links": []}])
        self.assertRegex(updated, r"^\d{4}-\d{2}-\d{2}$")
        # Wiki links between ideas become ropes on the mountain; links to other notes and to itself do not count.
        linked = self.vault.add_idea(f"Друга думка\nРозвиває [[{path[:-3]}|першу]], див. [[global]]", now=86400 * 400)
        self.assertEqual(next(i for i in self.vault.ideas() if i["path"] == linked)["links"], [path])
        self.vault.set_idea_stage(path, "growing")
        self.assertEqual(self.vault.ideas()[0]["status"], "growing")
        text = (self.root / path).read_text()
        self.assertEqual(text.count("status:"), 1)
        self.assertIn("Повільне зростання.", text)
        for bad in (("_global/ideas.md", "growing"), (path, "done")):
            with self.assertRaises(ValueError):
                self.vault.set_idea_stage(*bad)
        for text in ("", "x" * 20001):
            with self.assertRaises(ValueError):
                self.vault.add_idea(text)
        self.assertEqual(idea_slug("!!!"), "idea")

    def test_http_routes_need_same_origin(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(self.vault))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{server.server_port}"

        def post(path, body, origin=base):
            request = Request(base + path, json.dumps(body).encode(), {"Content-Type": "application/json", "Origin": origin})
            with urlopen(request) as response:
                return json.load(response)
        try:
            path = post("/api/ideas", {"text": "Ідея з міста"})["path"]
            post("/api/ideas/stage", {"path": path, "stage": "project"})
            with urlopen(base + "/api/ideas") as response:
                self.assertEqual([(i["title"], i["status"]) for i in json.load(response)["ideas"]], [("Ідея з міста", "project")])
            with self.assertRaises(HTTPError) as error:
                post("/api/ideas", {"text": "чужа"}, "http://evil.example")
            self.assertEqual(error.exception.code, 403)
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
