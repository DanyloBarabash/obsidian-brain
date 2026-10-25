"""Check source-matched evidence and the boundary around the current live city."""

from pathlib import Path
import json
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server import Vault, handler_for
from simulation import Simulation
from simulation import migrations
from simulation.engine import LAYOUT_VERSION
from simulation.profile import VALUES
from simulation.rules import RULES, fingerprint, readiness


class PreparationTests(unittest.TestCase):
    def test_report_staleness_is_visible(self):
        proof = {"passed":True,"sourceFingerprint":fingerprint(),
                 "successfulTests":sorted({t for _,_,tests in RULES for t in tests}),
                 "benchmarks":[{"sources":n,"oneTickSeconds":0.01,"auditErrors":[]} for n in (100,1000,10000)]}
        current = readiness(proof)
        self.assertEqual(current["verifiedRules"],len(RULES))
        self.assertTrue(current["safeToRebuild"])
        self.assertTrue(current["currentMapChanged"])
        proof["sourceFingerprint"] = "outdated"
        stale = readiness(proof)
        self.assertFalse(stale["evidenceCurrent"])
        self.assertEqual(stale["verifiedRules"],0)
        self.assertFalse(stale["safeToRebuild"])

    def test_incomplete_or_slow_evidence_cannot_claim_ready(self):
        self.assertFalse(readiness()["safeToRebuild"])
        proof = {"passed":True,"sourceFingerprint":fingerprint(),"successfulTests":[],"benchmarks":[]}
        self.assertFalse(readiness(proof)["safeToRebuild"])
        proof["successfulTests"] = sorted({t for _,_,tests in RULES for t in tests})
        proof["benchmarks"] = [{"sources":n,"oneTickSeconds":0.3,"auditErrors":[]} for n in (100,1000,10000)]
        self.assertFalse(readiness(proof)["safeToRebuild"])

    def test_live_world_advances_by_elapsed_time_and_rebuilds_old_layout(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)/"vault"
            root.mkdir()
            (root/"a.md").write_text("---\nid: real-a\n---\n# A\n[[b]]")
            (root/"b.md").write_text("---\nid: real-b\n---\n# B\n")
            vault = Vault(root,Path(directory)/"state")
            old = Simulation()
            old.state.pop("layoutVersion")
            old.state["world"] = {"blocks": {"block:-2:3": {"cell": [-2, 3]}}}
            old.save(vault.preparation.path)
            original_files = {p.name:p.read_bytes() for p in root.iterdir()}
            first = vault.preparation.live(vault.build(),now=0)
            self.assertTrue(vault.preparation.path.with_name(vault.preparation.path.stem+".layout-1.bak").exists())
            self.assertEqual(len(first["buildings"]),2)
            self.assertTrue(first["ways"] and first["rivers"])
            self.assertEqual(first["metrics"]["deadEnds"],0)
            second = vault.preparation.live(vault.build(),now=2)
            self.assertEqual(second["tick"]-first["tick"],2000//second["tickMs"])
            capped = vault.preparation.live(vault.build(),now=3600)
            self.assertEqual(capped["tick"]-second["tick"],10000//second["tickMs"])
            self.assertEqual(original_files,{p.name:p.read_bytes() for p in root.iterdir()})

    def test_new_file_starts_construction_when_the_city_next_opens(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)/"vault"
            root.mkdir()
            (root/"a.md").write_text("---\nid: real-a\n---\n# A\n")
            vault = Vault(root,Path(directory)/"state")
            vault.preparation.live(vault.build(),now=0)
            vault.preparation.model.advance(2*VALUES["construction_ticks"]+VALUES["building_construction_ticks"])
            (root/"b.md").write_text("---\nid: real-b\n---\n# B\n")
            snapshot = vault.build()
            key = next(node["stableId"] for node in snapshot["nodes"] if node["id"] == "b.md")
            self.assertNotIn(key,vault.preparation.model.state["sources"])
            vault.preparation.live(snapshot,now=3600)
            building = vault.preparation.model.state["buildings"][key]
            self.assertEqual(building["lifecycle"],"reserved")
            self.assertEqual(building["firstSeen"],vault.preparation.model.clock["tick"])
            self.assertEqual(building["nextStage"],building["firstSeen"]+VALUES["construction_ticks"])
            self.assertTrue(vault.preparation.model.inspect(key)["uri"])

    def test_split_save_migration_keeps_city_and_explicit_rebuild(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)/"vault"
            root.mkdir()
            (root/"a.md").write_text("---\nid: real-a\n---\n# A\n[[b]]")
            (root/"b.md").write_text("---\nid: real-b\n---\n# B\n")
            vault = Vault(root,Path(directory)/"state")
            first = vault.preparation.live(vault.build(),now=0)
            path = vault.preparation.path
            # Once construction settles, only queues and agents change between saves.
            vault.preparation.model.advance(3000)
            vault.preparation.model.save(path)
            parts = json.loads(path.read_text())["parts"]
            self.assertEqual(set(parts),{"world","live","events"})
            world_part = path.parent/parts["world"]
            written = world_part.stat().st_mtime_ns
            vault.preparation.model.advance(50)
            vault.preparation.model.save(path)
            self.assertEqual(json.loads(path.read_text())["parts"]["world"],parts["world"])
            self.assertEqual(world_part.stat().st_mtime_ns,written)
            self.assertNotEqual(json.loads(path.read_text())["parts"]["live"],parts["live"])
            self.assertEqual(len(list(path.parent.glob(path.stem+".live-*.json"))),1)
            # An older layout with a migration step keeps every building; trip history is dropped.
            saved = Simulation.read_state(path)
            saved["layoutVersion"] = LAYOUT_VERSION-1
            saved["events"].append({"id":saved["events"][-1]["id"]+1,"type":"tripStarted","tick":0,"schemaVersion":1})
            Simulation(saved).save(path)
            previous_step = migrations.MIGRATIONS.get(LAYOUT_VERSION-1)
            migrations.MIGRATIONS[LAYOUT_VERSION-1] = lambda state:state["budget"].update(migrated=True)
            try:
                vault.preparation.model = None
                again = vault.preparation.live(vault.build(),now=1)
            finally:
                if previous_step is None:
                    del migrations.MIGRATIONS[LAYOUT_VERSION-1]
                else:
                    migrations.MIGRATIONS[LAYOUT_VERSION-1] = previous_step
            self.assertEqual({k:b["footprint"] for k,b in again["buildings"].items()},{k:b["footprint"] for k,b in first["buildings"].items()})
            self.assertTrue(vault.preparation.model.state["budget"]["migrated"])
            self.assertFalse(any(e["type"] == "tripStarted" for e in vault.preparation.model.state["events"]))
            self.assertFalse(list(path.parent.glob("*.layout-*.bak")))
            vault.preparation.rebuild()
            self.assertTrue(list(path.parent.glob(path.stem+".rebuild-*.bak")))
            self.assertFalse(path.exists())
            self.assertEqual(len(vault.preparation.live(vault.build(),now=2)["buildings"]),2)

    def test_preparation_http_does_not_rebuild_or_advance_live_city(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)/"vault"
            root.mkdir()
            (root/"a.md").write_text("---\nid: real-a\n---\n# A\n[[b]]")
            (root/"b.md").write_text("---\nid: real-b\n---\n# B\n")
            vault = Vault(root,Path(directory)/"state")
            before = vault.build()
            old_state = vault.state_file.read_bytes()
            original_files = {p.name:p.read_bytes() for p in root.iterdir()}
            server = ThreadingHTTPServer(("127.0.0.1",0),handler_for(vault))
            thread = threading.Thread(target=server.serve_forever,daemon=True)
            thread.start()
            base = f"http://127.0.0.1:{server.server_port}"
            try:
                with urlopen(base+"/api/preparation") as response:
                    first = json.load(response)
                    self.assertEqual(response.headers["Cache-Control"],"no-store")
                self.assertEqual(first["activation"],"active")
                self.assertEqual(first["model"]["knowledgePopulation"],2)
                self.assertTrue(first["liveDataAudit"]["passed"])
                with urlopen(base+"/api/preparation/world") as response:
                    full = json.load(response)
                for route,mime in (("/preparation.js","text/javascript"),("/preparation.css","text/css")):
                    with urlopen(base+route) as response:
                        self.assertTrue(response.headers["Content-Type"].startswith(mime))
                self.assertEqual(full["model"]["tick"],0)
                self.assertTrue(full["model"]["state"]["world"]["parcels"])
                source = before["nodes"][0]
                with urlopen(base+"/api/preparation/inspect?entity="+source["stableId"]) as response:
                    info = json.load(response)
                self.assertEqual(info["uri"],source["uri"])
                self.assertEqual(vault.build(),before)
                self.assertEqual(vault.state_file.read_bytes(),old_state)
                self.assertEqual(original_files,{p.name:p.read_bytes() for p in root.iterdir()})
                self.assertNotEqual(vault.preparation.path,vault.state_file)
                for endpoint in ("/api/preparation","/api/preparation/world"):
                    with self.assertRaises(HTTPError) as error:
                        urlopen(Request(base+endpoint,headers={"Origin":"https://foreign.example"}))
                    self.assertEqual(error.exception.code,403)
                with self.assertRaises(HTTPError) as error:
                    urlopen(base+"/api/preparation/inspect?entity=../outside.md")
                self.assertEqual(error.exception.code,404)
            finally:
                server.shutdown()
                server.server_close()
                thread.join()
