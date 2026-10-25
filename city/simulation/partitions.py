"""Reserve free angular boundary land for new themes without moving built centres."""

from copy import deepcopy

from .profile import overlaps
from .world import TICKS, aabb, sectors, wedge_offset


def extend(world, sizes):
    """Insert themes only between occupied district angles; retain absent districts."""
    wedges = deepcopy(world.state["wedges"])
    reserved = {}
    for name in sorted(set(sizes)-set(wedges), key=lambda n: (-sizes[n], n)):
        ordered = sorted(wedges, key=lambda n: wedges[n][0])
        zones = [z for z in world.state["protected"] if not z["id"].startswith("park:") and z["id"] != "plaza"]
        cells = []
        for cell in world.frontier | {(i, s) for i in (1, 2) for s in range(sectors(i)) if f"block:{i}:{s}" not in world.state["blocks"]}:
            if f"{cell[0]}:{cell[1]}" in world.retired_river_cells or world.water(*cell):
                continue
            if any(overlaps(aabb(world.cell_polygon(*cell, steps=4)), z["box"]) for z in zones):
                continue
            a,b = world.cell_ticks(*cell)
            cells.append(((a+b)/2 % TICKS, cell))
        choices = []
        for index, left in enumerate(ordered):
            right = ordered[(index+1) % len(ordered)]
            boundary = wedges[left][1]
            # A full-circle district can surrender any unbuilt gap.
            angles = sorted([sum(world.cell_ticks(*b["cell"]))/2 % TICKS for b in world.state["blocks"].values() if b["district"] == left]+reserved.get(left, []))
            gaps = [(angles[i], angles[(i+1) % len(angles)]+(TICKS if i == len(angles)-1 else 0)) for i in range(len(angles))] if left == right and angles else []
            if left != right:
                occupied_left = [boundary-((boundary-t) % TICKS) for t in angles]
                occupied_right = [boundary+((sum(world.cell_ticks(*b["cell"]))/2-boundary) % TICKS)
                                  for b in world.state["blocks"].values() if b["district"] == right]
                occupied_right += [boundary+((t-boundary) % TICKS) for t in reserved.get(right, [])]
                gaps = [(max(occupied_left, default=wedges[left][0]), min(occupied_right, default=boundary+((wedges[right][1]-boundary) % TICKS))) ]
            for low,high in gaps:
                for tick,cell in cells:
                    tick = low+((tick-low) % TICKS)
                    if not low < tick < high:
                        continue
                    start,end = (low+tick)/2,(tick+high)/2
                    # Keep the cut within the two donor wedges.
                    if left != right and (wedge_offset(start, wedges[left]) or wedge_offset(end-1, wedges[right])):
                        continue
                    choices.append((high-low, -cell[0], left, right, int(start) % TICKS, int(end) % TICKS, tick % TICKS))
        if not choices:
            raise ValueError(f"No free district boundary for {name}; existing addresses preserved")
        _,_,left,right,start,end,tick = max(choices)
        if left == right:
            wedges[left] = [end,start]
        else:
            wedges[left][1],wedges[right][0] = start,end
        wedges[name] = [start,end]
        reserved[name] = [tick]
    return wedges


