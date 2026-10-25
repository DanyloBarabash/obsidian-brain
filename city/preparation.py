"""Stage the replacement model and its evidence without activating a new map."""

import json
from pathlib import Path
import threading
import time

from simulation import Simulation
from simulation.migrations import migrate
from simulation.clusters import audit_clusters
from simulation.rules import readiness

MAX_CATCH_UP_MS = 10000
SAVE_INTERVAL_SECONDS = 30


class Preparation:
    """Own an independent generated world and a read-only preparation interface."""

    def __init__(self, legacy_state_file, report_path=None):
        legacy = Path(legacy_state_file)
        self.path = legacy.with_name(legacy.stem+".simulation-v1.json")
        self.report_path = Path(report_path) if report_path else Path(__file__).parent/"build"/"verification"/"simulation.json"
        self.lock = threading.Lock()
        self.model = None
        self.static_cache = None
        self.clock = None
        self.saved = 0

    def _load(self):
        """Load the persisted world; an older street layout is backed up and rebuilt once."""
        if self.model is not None:
            return
        if self.path.exists():
            # Check the layout before building a world from it: an older layout is not valid input.
            saved = Simulation.read_state(self.path)
            version = saved.get("layoutVersion",1)
            if migrate(saved):
                self.model = Simulation(saved)
                return
            self._backup(saved,f"layout-{version}")
        self.model = Simulation()

    def _backup(self, state, label):
        """Keep a self-contained copy of a world before it is replaced."""
        self.path.with_name(self.path.stem+f".{label}.bak").write_text(json.dumps(state,ensure_ascii=False),encoding="utf-8")

    def rebuild(self):
        """Explicitly replace the saved world with a fresh one, keeping a backup."""
        with self.lock:
            if self.path.exists():
                self._backup(Simulation.read_state(self.path),f"rebuild-{int(time.time())}")
                self.path.unlink()
            self.model = None
            self.static_cache = None

    def capabilities(self):
        """Current per-rule status from the latest source-matched verification report."""
        try:
            report = json.loads(self.report_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            report = None
        return readiness(report)["rules"]

    def _advance(self, snapshot, now):
        """Sync sources and advance logical time by bounded elapsed milliseconds; caller holds the lock."""
        self._load()
        now = time.monotonic() if now is None else now
        if self.clock is not None:
            self.model.advance_elapsed(min(MAX_CATCH_UP_MS, int((now-self.clock)*1000)))
        # Closed-window time belongs only to the city that already existed. A newly
        # discovered file must begin at reservation when this live view opens.
        changed = self.model.sync(snapshot)
        self.clock = now
        if changed or now-self.saved > SAVE_INTERVAL_SECONDS:
            self.model.save(self.path)
            self.saved = now

    def live(self, snapshot, now=None):
        """Full render contract after advancing time (static geometry and live agents together)."""
        with self.lock:
            self._advance(snapshot, now)
            return self.model.presentation()

    def live_state(self, snapshot, now=None):
        """Advance time and return only the per-tick part; geometry is fetched separately by revision."""
        with self.lock:
            self._advance(snapshot, now)
            return self.model.live_presentation()

    def static_world(self, snapshot):
        """Static geometry as (revision, JSON bytes), rebuilt only when the revision changes."""
        with self.lock:
            self._load()
            self.model.sync(snapshot)
            revision = self.model.static_revision()
            if self.static_cache is None or self.static_cache[0] != revision:
                body = json.dumps({**self.model.static_presentation(), "staticRevision": revision}, ensure_ascii=False).encode()
                self.static_cache = (revision, body)
            return self.static_cache

    def read(self, snapshot, full=False, entity=None):
        """Reconcile current sources; do not advance time, move or rewrite the legacy map."""
        with self.lock:
            self._load()
            if self.model.sync(snapshot):
                self.model.save(self.path)
            if entity is not None:
                return self.model.inspect(entity)
            try:
                report = json.loads(self.report_path.read_text(encoding="utf-8"))
            except (OSError,ValueError):
                report = None
            result = readiness(report)
            errors = self.model.audit()
            result.update(model=self.model.snapshot(full),liveDataAudit={"passed":not errors,"errors":errors},
                          clusterAudit=audit_clusters(self.model),
                          testsRun=report.get("testsRun",0) if result["evidenceCurrent"] else 0,
                          benchmarks=report.get("benchmarks",[]) if result["evidenceCurrent"] else [],
                          sourceMapping="Stable source IDs are retained; new geometry is staged separately")
            result["safeToRebuild"] = result["safeToRebuild"] and not errors and result["clusterAudit"]["passed"]
            return result
