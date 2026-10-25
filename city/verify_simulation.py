#!/usr/bin/env python3
"""Run acceptance tests and measured 100/1,000/10,000-source preparation checks."""

import argparse
import gc
import io
import json
from pathlib import Path
import resource
import sys
import tempfile
import time
import unittest

from simulation import Simulation
from simulation.rules import fingerprint, readiness


class EvidenceResult(unittest.TextTestResult):
    """Record successful test identities rather than hardcoding verified labels."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args,**kwargs)
        self.successes = []

    def addSuccess(self, test):
        super().addSuccess(test)
        self.successes.append(test.id())


def benchmark(count):
    """Measure staged geometry, persistence, memory and a logic tick without claiming FPS."""
    sys.path.insert(0,str(Path(__file__).parent/"tests"))
    from test_simulation import snapshot
    started = time.perf_counter()
    model = Simulation()
    model.sync(snapshot(count,6))
    sync_seconds = time.perf_counter()-started
    started = time.perf_counter()
    errors = model.audit()
    audit_seconds = time.perf_counter()-started
    started = time.perf_counter()
    model.advance(350)
    warmup_seconds = time.perf_counter()-started
    started = time.perf_counter()
    model.advance(20)
    tick_seconds = (time.perf_counter()-started)/20
    errors.extend(model.audit())
    with tempfile.TemporaryDirectory(prefix="brain-city-benchmark-") as directory:
        path = Path(directory)/"world.json"
        started = time.perf_counter()
        model.save(path)
        save_seconds = time.perf_counter()-started
        size = path.stat().st_size
        started = time.perf_counter()
        restored = Simulation.load(path)
        reload_seconds = time.perf_counter()-started
        if restored.state != model.state:
            errors.append("Save/load changed model state")
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    if sys.platform != "darwin":
        peak *= 1024
    result = {"sources":count,"syncSeconds":sync_seconds,"auditSeconds":audit_seconds,"oneTickSeconds":tick_seconds,
              "saveSeconds":save_seconds,"reloadSeconds":reload_seconds,"stateBytes":size,"peakProcessRssBytes":peak,"warmupSeconds":warmup_seconds,
              "blocks":len(model.world.state["blocks"]),"auditErrors":errors,"rendererFps":None,
              "rendererScope":"Not measured: current map intentionally not rebuilt"}
    del model,restored
    gc.collect()
    return result


def main():
    """Write evidence only after executing the checks against the present source fingerprint."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report",default=str(Path(__file__).parent/"build"/"verification"/"simulation.json"))
    parser.add_argument("--skip-benchmarks",action="store_true")
    args = parser.parse_args()
    tested_fingerprint = fingerprint()
    log = io.StringIO()
    suite = unittest.defaultTestLoader.discover(str(Path(__file__).parent/"tests"))
    result = unittest.TextTestRunner(stream=log,verbosity=1,resultclass=EvidenceResult).run(suite)
    print(f"Acceptance tests: {result.testsRun} run, {len(result.failures)} failures, {len(result.errors)} errors",flush=True)
    measurements = []
    if result.wasSuccessful() and not args.skip_benchmarks:
        for count in (100,1000,10000):
            item = benchmark(count)
            measurements.append(item)
            print(f"{count} sources: plan {item['syncSeconds']:.3f}s, tick {item['oneTickSeconds']:.4f}s, audit errors {len(item['auditErrors'])}",flush=True)
    report = {"sourceFingerprint":tested_fingerprint,"passed":result.wasSuccessful() and all(not b["auditErrors"] for b in measurements) and tested_fingerprint == fingerprint(),
              "testsRun":result.testsRun,"successfulTests":result.successes,"benchmarks":measurements,
              "failures":[(t.id(),trace) for t,trace in result.failures+result.errors],
              "scope":"Staged model integration; no visual rebuild or activation"}
    report["readiness"] = readiness(report)
    path = Path(args.report)
    path.parent.mkdir(parents=True,exist_ok=True)
    temporary = path.with_suffix(path.suffix+".tmp")
    temporary.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    temporary.replace(path)
    print(f"Rules verified in staged engine: {report['readiness']['verifiedRules']}/{report['readiness']['totalRules']}",flush=True)
    print(f"Report: {path}",flush=True)
    if not result.wasSuccessful():
        print(log.getvalue())
    return 0 if report["passed"] and (args.skip_benchmarks or report["readiness"]["safeToRebuild"]) else 1


if __name__ == "__main__":
    raise SystemExit(main())
