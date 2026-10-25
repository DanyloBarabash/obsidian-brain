"""Acceptance scenarios for BC-01/02/05/12/28/35 and legacy migration."""

from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Vault


class StateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "vault"
        self.root.mkdir()
        self.state_dir = Path(self.temp.name) / "state"
        self.write("alpha.md", "---\nid: alpha\n---\n# Alpha\nOriginal content.")
        self.vault = Vault(self.root, self.state_dir)

    def tearDown(self):
        self.temp.cleanup()

    def write(self, path, content):
        file = self.root / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(content, encoding="utf-8")

    def node(self, city, path="alpha.md"):
        return next(node for node in city["nodes"] if node["id"] == path)

    def test_legacy_migration_and_restart(self):
        legacy = {"districts": {"commons": 3}, "notes": {"alpha.md": ["commons", 17]}, "columns": {"commons": 9}}
        self.state_dir.mkdir()
        original = json.dumps(legacy).encode()
        self.vault.state_file.write_bytes(original)
        self.vault = Vault(self.root, self.state_dir)
        first = self.vault.build()
        self.assertEqual(self.node(first)["slot"], 17)
        self.assertEqual(first["districts"][0]["order"], 3)
        self.assertEqual(first["districts"][0]["columns"], 9)
        self.assertEqual(first["cityState"]["schemaVersion"], 2)
        self.assertEqual(self.vault.state_file.with_suffix(".schema-1.bak").read_bytes(), original)
        again = Vault(self.root, self.state_dir).build()
        self.assertEqual(first["nodes"], again["nodes"])
        self.assertEqual(first["cityState"], again["cityState"])
        self.assertEqual([e["type"] for e in first["cityState"]["events"]], ["stateMigrated", "sourceImported"])

    def test_rename_and_conflicting_ids(self):
        before = self.node(self.vault.build())
        (self.root / "alpha.md").rename(self.root / "renamed.md")
        renamed = self.node(self.vault.build(), "renamed.md")
        for field in ("stableId", "slot", "appearance", "history"):
            self.assertEqual(before[field], renamed[field])
        self.assertIn("renamed.md", renamed["uri"])
        self.write("alpha.md", "---\nid: other\n---\n# New file at the old path")
        replacement = self.node(self.vault.build())
        self.assertNotEqual(replacement["slot"], before["slot"])
        self.write("copy.md", "---\nid: alpha\n---\n# Copy")
        city = self.vault.build()
        self.assertEqual(city["cityState"]["identityConflicts"], ["alpha"])
        self.assertEqual(len({n["stableId"] for n in city["nodes"]}), 3)
        self.assertEqual(len({n["slot"] for n in city["nodes"]}), 3)
        (self.root / "renamed.md").rename(self.root / "ambiguous-rename.md")
        moved = self.node(self.vault.build(), "ambiguous-rename.md")
        self.assertNotEqual(moved["stableId"], before["stableId"])
        self.assertEqual(len(self.vault.build()["cityState"]["missingSources"]), 1)

    def test_path_fallback_does_not_guess_rename(self):
        self.write("without-id.md", "# Same title\nSame text")
        before = self.node(self.vault.build(), "without-id.md")
        (self.root / "without-id.md").rename(self.root / "different.md")
        after = self.node(self.vault.build(), "different.md")
        self.assertNotEqual(before["stableId"], after["stableId"])
        self.assertNotEqual(before["slot"], after["slot"])

    def test_simultaneous_move_and_replacement_at_old_path(self):
        original = self.node(self.vault.build())
        (self.root / "alpha.md").rename(self.root / "renamed.md")
        self.write("alpha.md", "---\nid: replacement\n---\n# Replacement")
        result = self.vault.build()
        moved = self.node(result, "renamed.md")
        replacement = self.node(result)
        self.assertEqual(moved["stableId"], original["stableId"])
        self.assertEqual(moved["slot"], original["slot"])
        self.assertNotEqual(replacement["slot"], original["slot"])
        self.assertEqual(result["cityState"]["missingSources"], [])

    def test_changed_explicit_identity_keeps_old_memory_separate(self):
        original = self.node(self.vault.build())
        self.write("alpha.md", "---\nid: different-identity\n---\n# A different source")
        result = self.vault.build()
        replacement = self.node(result)
        ghost = result["cityState"]["missingSources"][0]
        self.assertNotEqual(replacement["stableId"], original["stableId"])
        self.assertNotEqual(replacement["id"], ghost["id"])
        self.assertEqual(ghost["sourcePath"], replacement["id"])
        self.assertIsNone(ghost["uri"])

    def test_restore_and_missing(self):
        before = self.vault.build()
        original = self.node(before)
        file = self.root / "alpha.md"
        file.unlink()
        missing = self.vault.build()
        self.assertEqual(missing["population"], 0)
        self.assertEqual(missing["nodes"], [])
        ghost = missing["cityState"]["missingSources"][0]
        self.assertFalse(ghost["available"])
        self.assertIsNone(ghost["uri"])
        self.assertEqual(ghost["slot"], original["slot"])
        self.write("new.md", "# Neighbour")
        neighbour = self.node(self.vault.build(), "new.md")
        self.assertNotEqual(neighbour["slot"], original["slot"])
        self.write("returned.md", "---\nid: alpha\nstatus: archived\n---\n# Alpha archived")
        restored = self.vault.build()
        node = self.node(restored, "returned.md")
        self.assertEqual(node["stableId"], original["stableId"])
        self.assertEqual(node["slot"], original["slot"])
        self.assertTrue(node["archived"])
        self.assertTrue(node["available"])
        self.assertEqual(restored["cityState"]["missingSources"], [])
        self.assertIn("sourceRestored", [e["type"] for e in restored["cityState"]["events"]])

    def test_history_and_idempotence(self):
        first = self.vault.build()
        self.assertIsNone(self.node(first)["history"]["builtAt"])
        for _ in range(3):
            self.assertIs(self.vault.build(), first)
        os.utime(self.root / "alpha.md", (1, 1))
        touched = self.vault.build()
        self.assertEqual(touched["cityState"], first["cityState"])
        self.write("alpha.md", "---\nid: alpha\n---\n# Alpha\nA real content update.")
        with ThreadPoolExecutor(max_workers=6) as pool:
            snapshots = list(pool.map(lambda _: self.vault.build(), range(12)))
        result = snapshots[0]
        self.assertTrue(all(s is result for s in snapshots))
        events = result["cityState"]["events"]
        self.assertEqual(sum(e["type"] == "sourceUpdated" for e in events), 1)
        self.assertEqual([e["id"] for e in events], list(range(1, len(events) + 1)))
        self.assertIsNotNone(self.node(result)["history"]["renovatedAt"])
        self.assertEqual(Vault(self.root, self.state_dir).build()["cityState"], result["cityState"])

    def test_classification_does_not_relocate(self):
        self.write("projects/p.md", "---\nid: project\ntype: hub\nclass: old-class\n---\n# P")
        before = self.node(self.vault.build(), "projects/p.md")
        self.write("projects/p.md", "---\nid: project\ntype: note\nclass: new-class\n---\n# P changed")
        after = self.node(self.vault.build(), "projects/p.md")
        for field in ("stableId", "district", "slot", "appearance"):
            self.assertEqual(before[field], after[field])
        self.assertEqual(after["sourceClass"], "new-class")

    def test_vault_unchanged(self):
        self.write(".obsidian/private.json", '{"unchanged":true}')
        marker = "private-full-body-marker-never-persist-this"
        self.write("beta.md", "# Beta\n" + marker)
        def digest():
            return {p.relative_to(self.root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                    for p in self.root.rglob("*") if p.is_file()}
        before = digest()
        self.vault.build()
        self.assertEqual(before, digest())
        self.assertNotIn(marker, self.vault.state_file.read_text())
        with self.assertRaises(ValueError):
            Vault(self.root, self.root / "generated-state")

    def test_unknown_or_corrupt_schema_preserved(self):
        self.state_dir.mkdir()
        for content in ('{"schemaVersion": 900, "districts":{}, "notes":{}}', '{bad-json'):
            self.vault.state_file.write_text(content)
            with self.assertRaises(ValueError):
                Vault(self.root, self.state_dir)
            self.assertEqual(self.vault.state_file.read_text(), content)

    def test_hundred_sources_and_repeated_snapshots(self):
        initial = self.node(self.vault.build())
        for i in range(100):
            self.write(f"new/{i}.md", f"---\nid: added-{i}\n---\n# Added {i}")
        city = self.vault.build()
        self.assertEqual(city["population"], 101)
        self.assertEqual(self.node(city)["stableId"], initial["stableId"])
        self.assertEqual(self.node(city)["slot"], initial["slot"])
        self.assertEqual(len({n["slot"] for n in city["nodes"]}), 101)
        self.assertEqual(sum(e["type"] == "sourceAdded" for e in city["cityState"]["events"]), 100)
        self.assertEqual(Vault(self.root, self.state_dir).build()["cityState"], city["cityState"])

    def test_internal_symlinks_are_not_source_routes(self):
        (self.root / "alias.md").symlink_to(self.root / "alpha.md")
        with self.assertRaises(ValueError):
            self.vault.read_note("alias.md")


if __name__ == "__main__":
    unittest.main()
