"""Versioned, source-driven city history; no text or writes inside the vault."""

from collections import Counter, defaultdict
from copy import deepcopy
import json
import time


SCHEMA_VERSION = 2
# Architectural eras: scenario parameters sized to a Brain that grows over months, not a building norm.
ERA_DAYS = 60
ERA_COUNT = 4
DAY_SECONDS = 86400
# Stage-0 evidence only; the server replaces it with the live registry from simulation.rules.
CAPABILITIES = [
    {"rule": f"BC-{i:02}", "status": "planned"} for i in range(1, 39)
]
for number, scope, test in [
    (1, "Read-only vault; state and migration backup outside vault", "test_vault_unchanged"),
    (2, "One available source, building and knowledge resident", "test_restore_and_missing"),
    (5, "Versioned migration; unique frontmatter ID or path fallback", "test_rename_and_conflicting_ids"),
    (12, "firstSeen and revision history; imported construction age unknown", "test_history_and_idempotence"),
    (28, "Separate archived and sourceMissing states; reserved addresses", "test_restore_and_missing"),
    (35, "Ordered events; repeated snapshots and restart are idempotent", "test_history_and_idempotence"),
]:
    CAPABILITIES[number - 1].update(status="verified", scope=scope, evidence=f"city/tests/test_state.py::{test}")
CAPABILITIES[3]["scope"] = "Stable addresses, seed and building family implemented; persistent terrain and vegetation still planned"
CAPABILITIES[37].update(status="implemented", scope="Per-rule status with evidence and explicit remaining scope")


class CityState:
    """Reconcile snapshots by identity, retaining missing sources and addresses."""

    def __init__(self, path):
        self.path = path
        if path.exists():
            try:
                state = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError) as error:
                raise ValueError(f"City state cannot be read; preserved at {path}") from error
        else:
            state = {"districts": {}, "notes": {}}
        version = state.get("schemaVersion", 1)
        if version not in (1, SCHEMA_VERSION):
            raise ValueError(f"Unsupported city schema {version}; state preserved at {path}")
        if not isinstance(state.get("districts"), dict) or not isinstance(state.get("notes"), dict):
            raise ValueError(f"Invalid city state; preserved at {path}")
        self.migrating = version == 1 and path.exists()
        self.initializing = version == 1
        self.layout = state
        self.layout.setdefault("schemaVersion", SCHEMA_VERSION)
        self.layout.setdefault("sources", {})
        self.layout.setdefault("events", [])
        self.layout.setdefault("revision", 0)
        self.layout.setdefault("nextSource", 1)

    def reconcile(self, nodes):
        """Apply one complete source snapshot as an atomic, deterministic batch."""
        state = deepcopy(self.layout)
        records = state["sources"]
        incoming = {node["id"]: node for node in nodes}
        counts = Counter(node.get("sourceId") for node in nodes if node.get("sourceId"))
        by_path = {record["path"]: key for key, record in sorted(records.items(), key=lambda pair: pair[1]["available"])}
        by_declared = defaultdict(list)
        for key, record in records.items():
            if record.get("declaredId"):
                by_declared[record["declaredId"]].append(key)
        now = time.time()
        pending = []
        active = set()

        def emit(kind, key=None, **details):
            pending.append({"type": kind, "source": key, "observedAt": now, **details})

        if self.initializing:
            emit("stateMigrated" if self.migrating else "cityFounded", reason="Preserve existing addresses" if self.migrating else "First vault observation")
        # The founding date is frozen once, so later or older notes never shift existing eras.
        state.setdefault("foundedAt", min((node.get("born", now) for node in nodes), default=now))
        occupied = defaultdict(set)
        for district, slot in state["notes"].values():
            occupied[district].add(slot)
        for record in records.values():
            occupied[record["address"][0]].add(record["address"][1])

        for node in sorted(nodes, key=lambda n: (n["kind"] not in ("class", "hub", "org"), n["id"])):
            path, declared = node["id"], node.get("sourceId") or None
            key = by_path.get(path)
            if key is not None and declared and records[key].get("declaredId") and records[key]["declaredId"] != declared:
                key = None
            # A duplicate ID never joins sources. Only a unique, absent old path
            # can be renamed; content similarity and titles are not identity.
            if key is None and declared and counts[declared] == 1:
                candidates = by_declared[declared]
                if len(candidates) == 1:
                    candidate = records[candidates[0]]
                    old_path_source = incoming.get(candidate["path"])
                    if old_path_source is None or (old_path_source.get("sourceId") and old_path_source["sourceId"] != declared):
                        key = candidates[0]
            if key in active:
                key = None
            created = key is None
            if created:
                key = f"source-{state['nextSource']:08d}"
                state["nextSource"] += 1
                district = node["district"]
                address = state["notes"].get(path) if self.initializing else None
                if address is None:
                    used = occupied[district]
                    slot = next(i for i in range(len(used) + 1) if i not in used)
                    address = [district, slot]
                    used.add(slot)
                records[key] = {"path": path, "declaredId": declared, "address": list(address),
                                "firstSeen": now, "builtAt": None, "renovatedAt": None,
                                "appearance": {"seedKey": path, "kind": node["kind"]},
                                "available": True, "revision": node["contentRevision"],
                                "sourceClass": node["district"], "archived": node.get("archived", False)}
                emit("sourceImported" if self.initializing else "sourceAdded", key, path=path, title=node["title"], reason="Existing source; construction age unknown" if self.initializing else "New source in Brain")
            record = records[key]
            if "era" not in record["appearance"]:
                born = node.get("born", now)
                record["appearance"].update(bornAt=born, era=max(0, min(ERA_COUNT - 1, int((born - state["foundedAt"]) // (ERA_DAYS * DAY_SECONDS)))))
            if not created:
                if record["path"] != path:
                    emit("sourceMoved", key, path=path, previousPath=record["path"], title=node["title"])
                    if state["notes"].get(record["path"]) == record["address"]:
                        state["notes"].pop(record["path"], None)
                if not record["available"]:
                    emit("sourceRestored", key, path=path, title=node["title"])
                if record["sourceClass"] != node["district"]:
                    emit("sourceClassChanged", key, path=path, title=node["title"], previousClass=record["sourceClass"], sourceClass=node["district"], reason="Address preserved; source classification updated")
                if record["revision"] != node["contentRevision"]:
                    record["renovatedAt"] = now
                    emit("sourceUpdated", key, path=path, title=node["title"])
                if record.get("archived", False) != node.get("archived", False):
                    emit("sourceArchived" if node.get("archived") else "sourceActivated", key, path=path, title=node["title"])
            record.update(path=path, declaredId=declared, available=True, revision=node["contentRevision"],
                          sourceClass=node["district"], archived=node.get("archived", False),
                          title=node["title"], kind=node["kind"], project=node["project"])
            record.update({field: node[field] for field in ("cityDistrict", "cityRole", "cityRoleTitle", "knowledgeScope", "ownerProject", "cityTopic", "cityImportance", "importanceTitle", "topicAnchor", "libraryCategory", "librarySource", "cityQuarter", "citySubject", "cityLandmark", "cityLandmarkTitle") if field in node})
            record.pop("missingSince", None)
            active.add(key)
            state["notes"][path] = record["address"]
            node.update(stableId=key, sourceClass=node["district"], district=record["address"][0], slot=record["address"][1],
                        appearance=record["appearance"], available=True,
                        history={k: record[k] for k in ("firstSeen", "builtAt", "renovatedAt")})
        for key, record in records.items():
            if key not in active and record["available"]:
                record.update(available=False, missingSince=now)
                emit("sourceMissing", key, path=record["path"], title=record.get("title", record["path"]), reason="Source unavailable; address reserved")
        if pending:
            state["revision"] += 1
            for event in pending:
                event.update(id=len(state["events"]) + 1, revision=state["revision"], schemaVersion=SCHEMA_VERSION)
                state["events"].append(event)
        state["conflicts"] = sorted(key for key, count in counts.items() if count > 1)
        self.layout = state
        return nodes

    def save(self):
        """Atomically save, backing up an existing unversioned state once."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if self.migrating:
            backup = self.path.with_suffix(".schema-1.bak")
            if not backup.exists():
                with backup.open("xb") as handle:
                    handle.write(self.path.read_bytes())
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(self.layout, ensure_ascii=False), encoding="utf-8")
        temporary.replace(self.path)
        self.initializing = self.migrating = False

    def public(self):
        """Expose history and unavailable sources without storing note contents."""
        missing = []
        for key, record in self.layout["sources"].items():
            if not record["available"]:
                missing.append({"id": f"missing:{key}", "sourcePath": record["path"], "stableId": key, "title": record.get("title", record["path"]),
                                **{field: record[field] for field in ("sourceClass", "project", "cityDistrict", "cityRole", "cityRoleTitle", "knowledgeScope", "ownerProject", "cityTopic", "cityImportance", "importanceTitle", "topicAnchor", "libraryCategory", "librarySource", "cityQuarter", "citySubject", "cityLandmark", "cityLandmarkTitle") if field in record},
                                "district": record["address"][0], "slot": record["address"][1],
                                "kind": record.get("kind", "note"), "appearance": record["appearance"],
                                "words": 0, "degree": 0, "available": False, "uri": None,
                                "missingSince": record["missingSince"],
                                "history": {k: record[k] for k in ("firstSeen", "builtAt", "renovatedAt")}})
        return {"schemaVersion": SCHEMA_VERSION, "revision": self.layout["revision"],
                "events": self.layout["events"][-200:], "eventCount": len(self.layout["events"]),
                "missingSources": missing, "identityConflicts": self.layout["conflicts"],
                "capabilities": CAPABILITIES}
