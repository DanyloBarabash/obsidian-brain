#!/usr/bin/env python3
"""Quick performance baseline without a profiler: planning, ticks and the render contract."""

import argparse
import json
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent/"tests"))
from simulation import Simulation  # noqa: E402
from test_simulation import snapshot  # noqa: E402


def measure(count, warm=300, ticks=100):
    """Return timings for one synthetic city of `count` sources."""
    model = Simulation()
    data = snapshot(count, 6)
    started = time.perf_counter()
    model.sync(data)
    build = time.perf_counter()-started
    model.advance(warm)
    started = time.perf_counter()
    model.advance(ticks)
    tick = (time.perf_counter()-started)/ticks
    started = time.perf_counter()
    world = model.presentation()
    present = time.perf_counter()-started
    started = time.perf_counter()
    live = json.dumps(model.live_presentation())
    live_ms = time.perf_counter()-started
    static = json.dumps(model.static_presentation())
    return {"sources": count, "buildSeconds": round(build, 3), "tickMs": round(tick*1000, 2),
            "presentationMs": round(present*1000, 1), "liveMs": round(live_ms*1000, 1),
            "staticBytes": len(static), "liveBytes": len(live)}, data, world


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("counts", nargs="*", type=int, default=[1000, 3000])
    parser.add_argument("--dump", help="Directory to write the last city/world JSON for the render bench")
    args = parser.parse_args()
    for count in args.counts:
        result, data, world = measure(count)
        print(json.dumps(result), flush=True)
    if args.dump:
        out = Path(args.dump)
        out.mkdir(parents=True, exist_ok=True)
        (out/"city.json").write_text(json.dumps(data))
        (out/"world.json").write_text(json.dumps(world))


if __name__ == "__main__":
    main()
