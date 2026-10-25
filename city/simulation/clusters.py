"""Per-district evidence, separate from aggregate synthetic acceptance scores."""

from collections import Counter

from .profile import VALUES
from .world import TICKS, neighbourhood, range_offset, wedge_offset


def components(world, blocks):
    """Count connected land components, allowing bridge/greenway road crossings across the valley."""
    remaining = {tuple(b["cell"]) for b in blocks}
    groups = []
    while remaining:
        todo = [remaining.pop()]
        found = []
        while todo:
            cell = todo.pop()
            found.append(f"block:{cell[0]}:{cell[1]}")
            for other in world.cluster_neighbours(cell):
                if other in remaining:
                    remaining.remove(other)
                    todo.append(other)
        groups.append(sorted(found))
    return sorted(groups)


def audit_clusters(model):
    """Check every district/project and disclose retained historical assignments."""
    world = model.world
    sources = model.state["sources"]
    blocks = world.state["blocks"]
    errors, historical, districts, projects = [], [], [], []
    sizes = Counter((s["class"], s.get("quarter") or neighbourhood(s["project"])) for s in sources.values() if s["available"])
    for key, source in sources.items():
        parcel = world.state["parcels"][model.state["buildings"][key]["parcel"]]
        block = blocks[parcel["block"]]
        if key not in parcel.get("sources", [parcel["source"]]) or parcel["district"] != block["district"]:
            errors.append(f"Source/parcel/block mismatch: {source['path']}")
        project = source.get("quarter") or neighbourhood(source["project"])
        expected = project if project and (source.get("quarter") or sizes[source["class"], project] >= VALUES["neighbourhood_min_sources"]) else ""
        if source["class"] != block["district"] or expected != block.get("neighbourhood", ""):
            historical.append({"path": source["path"], "sourceClass": source["class"], "parcelClass": block["district"],
                               "expectedQuarter": expected, "parcelQuarter": block.get("neighbourhood", ""),
                               "reason": "Existing address retained; explicit migration required to change its district or quarter"})
    for name in sorted({b["district"] for b in blocks.values()}):
        own = [b for b in blocks.values() if b["district"] == name]
        wedge = world.state.get("wedges", {}).get(name)
        groups = components(world, own)
        inside = sum(range_offset(*world.cell_ticks(*b["cell"]), wedge) == 0 for b in own) if wedge else 0
        centred = sum(wedge_offset(sum(world.cell_ticks(*b["cell"]))/2, wedge) == 0 for b in own) if wedge else 0
        centre = world.state["centres"].get(name, {})
        anchor = sources.get(centre.get("source"), {})
        row = {"id": name, "blocks": len(own), "insideWedge": inside, "centresInsideWedge": centred,
               "components": groups, "anchor": anchor.get("path"), "anchorKind": anchor.get("kind"),
               "innermostRing": min(b["cell"][0] for b in own)}
        districts.append(row)
        if len(groups) != 1:
            errors.append(f"Disconnected district: {name}")
        if inside/len(own) < .7:
            errors.append(f"BC-64 below 70%: {name} ({inside}/{len(own)})")
        class_hubs = [s for s in sources.values() if s["available"] and s["class"] == name and s["kind"] == "class" and s.get("cityRole") != "registry"]
        if class_hubs and anchor.get("kind") != "class":
            errors.append(f"District anchor is not its class hub: {name}")
        if any(s.get("topicAnchor") and s["class"] == name for s in sources.values()) and not anchor.get("topicAnchor"):
            errors.append(f"District anchor is not its thematic hub: {name}")
        for quarter, sub in world.state.get("subWedges", {}).get(name, {}).items():
            members = [b for b in own if b.get("neighbourhood", "") == quarter]
            if not members:
                continue
            count = sum(range_offset(*world.cell_ticks(*b["cell"]), sub) == 0 for b in members)
            groups = components(world, members)
            projects.append({"district": name, "id": quarter, "blocks": len(members), "insideWedge": count, "components": groups})
            if count/len(members) < .6:
                errors.append(f"BC-66 below 60%: {name}/{quarter or 'shared'} ({count}/{len(members)})")
            if len(groups) != 1:
                errors.append(f"Disconnected project quarter: {name}/{quarter or 'shared'}")
        for quarter in sorted({b.get("neighbourhood", "") for b in own}-set(world.state.get("subWedges", {}).get(name, {}))-{ "" }):
            members = [b for b in own if b.get("neighbourhood") == quarter]
            groups = components(world,members)
            projects.append({"district":name,"id":quarter,"blocks":len(members),"insideWedge":None,"components":groups})
            if len(groups) != 1:
                errors.append(f"Disconnected project quarter: {name}/{quarter}")
    wedges = world.state.get("wedges", {})
    if wedges and sum((end-start) % TICKS or TICKS for start, end in wedges.values()) != TICKS:
        errors.append("Class wedges do not cover the complete circle")
    return {"passed": not errors and not historical, "errors": errors, "historicalAssignments": historical,
            "districts": districts, "projects": projects,
            "adjacency": "Shared land boundary or a permitted river/legacy-greenway road crossing; paths through another district do not connect a cluster"}
