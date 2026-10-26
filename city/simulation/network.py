"""Mode- and level-aware networks with explicit junctions and closures."""

import heapq
import math
from .profile import VALUES

CELL = 40
ROUTE_CACHE = 20000
EPSILON = 1e-6


def _on_segment(p, a, b):
    """Return true when p lies strictly inside segment a-b."""
    dx, dy = b["x"]-a["x"], b["y"]-a["y"]
    length = dx*dx+dy*dy
    if length == 0:
        return False
    t = ((p["x"]-a["x"])*dx+(p["y"]-a["y"])*dy)/length
    if t <= EPSILON or t >= 1-EPSILON:
        return False
    return math.hypot(a["x"]+t*dx-p["x"], a["y"]+t*dy-p["y"]) < EPSILON


class Network:
    """Keep topology distinct from geometric line crossings and knowledge links."""

    def __init__(self, kind, state=None):
        self.kind = kind
        self.state = state if state is not None else {"nodes": {}, "edges": {}, "revision": 0}
        self._adjacency = None
        self._cached_revision = -1
        self._routes = {}
        self._edge_cells = None
        self._node_cells = None
        self.closures = 0

    def _cells(self, a, b):
        """List index cells covered by a segment's bounding box."""
        return [(x, y) for x in range(math.floor(min(a["x"], b["x"])/CELL), math.floor(max(a["x"], b["x"])/CELL)+1)
                for y in range(math.floor(min(a["y"], b["y"])/CELL), math.floor(max(a["y"], b["y"])/CELL)+1)]

    def _index(self):
        """Build the spatial index lazily; it is derived and never persisted."""
        if self._edge_cells is None:
            self._edge_cells, self._node_cells = {}, {}
            for key, value in self.state["nodes"].items():
                self._node_cells.setdefault((math.floor(value["x"]/CELL), math.floor(value["y"]/CELL)), set()).add(key)
            for key, edge in self.state["edges"].items():
                for cell in self._cells(self.state["nodes"][edge["a"]], self.state["nodes"][edge["b"]]):
                    self._edge_cells.setdefault(cell, set()).add(key)

    def _split(self, key, through):
        """Replace an edge by two pieces sharing a node that lies on it."""
        edge = self.state["edges"].pop(key)
        for cell in self._cells(self.state["nodes"][edge["a"]], self.state["nodes"][edge["b"]]):
            self._edge_cells.get(cell, set()).discard(key)
        attributes = {k: v for k, v in edge.items() if k not in ("a", "b", "length")}
        current = self._cached_revision == self.state["revision"]
        pieces = [self._insert(a, b, attributes) for a, b in ((edge["a"], through), (through, edge["b"]))]
        self.state["revision"] += 1
        if current:
            for end in (edge["a"], edge["b"]):
                self._adjacency[end] = [item for item in self._adjacency[end] if item[1] != key]
            for piece in pieces:
                value = self.state["edges"][piece]
                for a, b in ((value["a"], value["b"]), (value["b"], value["a"])):
                    if all(item[1] != piece for item in self._adjacency[a]):
                        self._adjacency[a].append((b, piece, value))
            self._cached_revision = self.state["revision"]
            self._routes = {}

    def _insert(self, a, b, attributes):
        """Store one edge and its index entries."""
        first, second = self.state["nodes"][a], self.state["nodes"][b]
        key = "|".join(sorted((a, b)))
        if key in self.state["edges"]:
            return key
        self.state["edges"][key] = {"a": a, "b": b, **attributes,
            "length": math.sqrt((first["x"]-second["x"])**2+(first["y"]-second["y"])**2+((first["level"]-second["level"])*VALUES["level_height"])**2)}
        for cell in self._cells(first, second):
            self._edge_cells.setdefault(cell, set()).add(key)
        return key

    def node(self, x, y, level=0, identity=None, snap=True):
        """Reuse only an explicitly shared coordinate on the same level."""
        key = identity or f"{self.kind}:{x:.4f}:{y:.4f}:{level}"
        value = {"x": x, "y": y, "level": level}
        if key in self.state["nodes"]:
            known = self.state["nodes"][key]
            # Float noise below the key precision is the same node; a real move is an error.
            if known["level"] != level or abs(known["x"]-x) > 1e-6 or abs(known["y"]-y) > 1e-6:
                raise ValueError("A network node cannot move")
            return key
        if key not in self.state["nodes"]:
            self._index()
            # Snap to an existing same-level node within the weld tolerance (one junction, not two).
            cx, cy = math.floor(x/CELL), math.floor(y/CELL)
            for dx in ((-1, 0, 1) if snap else ()):
                for dy in (-1, 0, 1):
                    # Same choice as scanning the cell in sorted order, without sorting on every call.
                    close = [other for other in self._node_cells.get((cx+dx, cy+dy), ())
                             if self.state["nodes"][other]["level"] == level
                             and math.hypot(self.state["nodes"][other]["x"]-x, self.state["nodes"][other]["y"]-y) < VALUES["weld_tolerance"]]
                    if close:
                        return min(close)
            incremental = self._cached_revision == self.state["revision"]
            self.state["nodes"][key] = value
            self.state["revision"] += 1
            self._node_cells.setdefault((math.floor(x/CELL), math.floor(y/CELL)), set()).add(key)
            if incremental:
                self._adjacency[key] = []
                self._cached_revision = self.state["revision"]
            # Same-level contact is a shared node: a node on an edge splits it.
            for edge_key in sorted(self._edge_cells.get((math.floor(x/CELL), math.floor(y/CELL)), ())):
                edge = self.state["edges"].get(edge_key)
                if edge and self.state["nodes"][edge["a"]]["level"] == level and _on_segment(value, self.state["nodes"][edge["a"]], self.state["nodes"][edge["b"]]):
                    self._split(edge_key, key)
                    break
        return key

    def edge(self, a, b, *, modes=("walk",), width=3, crossing=False, kind="path", identity=None):
        """Add an explicit permitted connection; intersections alone add nothing."""
        if a == b:
            raise ValueError("Zero-length network edge")
        first, second = self.state["nodes"][a], self.state["nodes"][b]
        if first["level"] != second["level"] and kind not in ("ramp", "stairs"):
            raise ValueError("Different levels require an explicit ramp or stairs")
        self._index()
        attributes = {"modes": list(modes), "width": width, "crossing": crossing, "kind": kind, "enabled": True}
        # Existing same-level nodes inside the new segment become shared junctions.
        inside = sorted({n for cell in self._cells(first, second) for n in self._node_cells.get(cell, ())
                         if self.state["nodes"][n]["level"] == first["level"] == second["level"]
                         and _on_segment(self.state["nodes"][n], first, second)},
                        key=lambda n: math.hypot(self.state["nodes"][n]["x"]-first["x"], self.state["nodes"][n]["y"]-first["y"]))
        if inside:
            chain = [a, *inside, b]
            keys = [self.edge(p, q, modes=modes, width=width, crossing=crossing, kind=kind) for p, q in zip(chain, chain[1:])]
            return keys[0]
        key = identity or "|".join(sorted((a, b)))
        if key not in self.state["edges"]:
            incremental = self._cached_revision == self.state["revision"]
            self.state["edges"][key] = {"a": a, "b": b, **attributes,
                "length": math.sqrt((first["x"]-second["x"])**2+(first["y"]-second["y"])**2+((first["level"]-second["level"])*VALUES["level_height"])**2)}
            for cell in self._cells(first, second):
                self._edge_cells.setdefault(cell, set()).add(key)
            self.state["revision"] += 1
            if incremental:
                edge = self.state["edges"][key]
                self._adjacency[a].append((b,key,edge))
                self._adjacency[b].append((a,key,edge))
                self._cached_revision = self.state["revision"]
                self._routes = {}
        return key

    def prune(self, starts, keep=(), kinds=("public-path", "entrance-path")):
        """Remove dead-end chains of `kinds` edges up to the first junction or kept node.

        Returns {removed node: surviving node where its chain ended, or None when nothing survived}.
        """
        moved = {}
        for node in starts:
            chain = []
            while node in self.state["nodes"] and node not in keep:
                touching = [k for k,e in self.state["edges"].items() if node in (e["a"], e["b"])]
                if len(touching) > 1 or (touching and self.state["edges"][touching[0]]["kind"] not in kinds):
                    break
                if touching:
                    edge = self.state["edges"].pop(touching[0])
                    following = edge["b"] if edge["a"] == node else edge["a"]
                else:
                    following = None
                del self.state["nodes"][node]
                chain.append(node)
                node = following
            for gone in chain:
                moved[gone] = node if node in self.state["nodes"] else None
        if moved:
            self.state["revision"] += 1
            self._edge_cells = None
        return moved

    def close(self, edge, closed=True):
        """Change access and invalidate route caches without deleting geometry."""
        value = not closed
        self.closures += 1
        if self.state["edges"][edge]["enabled"] != value:
            self.state["edges"][edge]["enabled"] = value
            self.state["revision"] += 1

    def join_crossings(self):
        """Explicitly join same-level walking paths, retaining all existing coordinates."""
        while True:
            self._index()
            pairs = {tuple(sorted((a,b))) for keys in self._edge_cells.values() for a in keys for b in keys if a<b}
            joined = False
            for first, second in sorted(pairs):
                e1,e2 = self.state["edges"][first],self.state["edges"][second]
                if {e1["a"],e1["b"]} & {e2["a"],e2["b"]} or "walk" not in e1["modes"] or "walk" not in e2["modes"]:
                    continue
                p,q,r,s = [self.state["nodes"][k] for k in (e1["a"],e1["b"],e2["a"],e2["b"])]
                if not p["level"] == q["level"] == r["level"] == s["level"]:
                    continue
                dx,dy,ex,ey = q["x"]-p["x"],q["y"]-p["y"],s["x"]-r["x"],s["y"]-r["y"]
                det = dx*ey-dy*ex
                if abs(det)<EPSILON:
                    continue
                t,u = ((r["x"]-p["x"])*ey-(r["y"]-p["y"])*ex)/det,((r["x"]-p["x"])*dy-(r["y"]-p["y"])*dx)/det
                if not EPSILON<t<1-EPSILON or not EPSILON<u<1-EPSILON:
                    continue
                node = self.node(p["x"]+t*dx,p["y"]+t*dy,p["level"],snap=False)
                self.state["nodes"][node]["exactJunction"] = True
                for key in (first,second):
                    if key in self.state["edges"]:
                        self._split(key,node)
                joined = True
                break
            if not joined:
                return

    def adjacency(self):
        """Build mode-filterable adjacency only after topology or access changes."""
        if self._cached_revision != self.state["revision"]:
            self._adjacency = {key: [] for key in self.state["nodes"]}
            for key, edge in sorted(self.state["edges"].items()):
                if edge["enabled"]:
                    self._adjacency[edge["a"]].append((edge["b"], key, edge))
                    self._adjacency[edge["b"]].append((edge["a"], key, edge))
            self._cached_revision = self.state["revision"]
            self._routes = {}
        return self._adjacency

    def route(self, start, end, mode="walk"):
        """Find a deterministic shortest permitted route (A*), or explain isolation."""
        adjacency = self.adjacency()
        cache_key = (start, end, mode)
        if cache_key in self._routes:
            return self._routes[cache_key]
        if start not in adjacency or end not in adjacency:
            return None
        # A*: straight-line distance is a consistent lower bound, since no edge is shorter than its chord.
        points = self.state["nodes"]
        tx, ty = points[end]["x"], points[end]["y"]
        estimate = lambda key: math.hypot(points[key]["x"]-tx, points[key]["y"]-ty)
        distances, previous = {start: 0}, {}
        queue = [(estimate(start), 0, start)]
        while queue:
            _, cost, node = heapq.heappop(queue)
            if cost != distances[node]:
                continue
            if node == end:
                nodes, edges = [end], []
                while nodes[-1] != start:
                    parent, edge_id = previous[nodes[-1]]
                    edges.append(edge_id)
                    nodes.append(parent)
                route = {"nodes": nodes[::-1], "edges": edges[::-1], "length": cost}
                if len(self._routes) >= ROUTE_CACHE:
                    self._routes = {}
                self._routes[cache_key] = route
                return route
            for target, edge_id, edge in adjacency[node]:
                if mode not in edge["modes"]:
                    continue
                new_cost = cost + edge["length"]
                if new_cost < distances.get(target, float("inf")) - 1e-9:
                    distances[target] = new_cost
                    previous[target] = (node, edge_id)
                    heapq.heappush(queue, (new_cost+estimate(target), new_cost, target))
        self._routes[cache_key] = None
        return None

    def position(self, route, edge_index, distance):
        """Interpolate world coordinates without consulting camera or frame rate."""
        a = self.state["nodes"][route["nodes"][edge_index]]
        if edge_index >= len(route["edges"]):
            return {"x": a["x"], "y": a["y"]}
        b = self.state["nodes"][route["nodes"][edge_index+1]]
        length = self.state["edges"][route["edges"][edge_index]]["length"]
        t = min(1, max(0, distance/(length or 1)))
        return {"x": a["x"]+(b["x"]-a["x"])*t, "y": a["y"]+(b["y"]-a["y"])*t}

    def reachable(self, start, mode="walk"):
        """Traverse once for bulk entrance reachability checks."""
        adjacency = self.adjacency()
        if start not in adjacency:
            return set()
        seen, pending = {start}, [start]
        while pending:
            for target, _, edge in adjacency[pending.pop()]:
                if mode in edge["modes"] and target not in seen:
                    seen.add(target)
                    pending.append(target)
        return seen

    def bridges(self, mode="walk"):
        """Find single-edge vulnerabilities iteratively, including very large cities."""
        adjacency = self.adjacency()
        discovery, low, parent, bridges = {}, {}, {}, []
        sequence = 0
        for start in adjacency:
            if start in discovery:
                continue
            sequence += 1
            discovery[start] = low[start] = sequence
            stack = [(start,iter(adjacency[start]))]
            while stack:
                node, iterator = stack[-1]
                item = next(iterator,None)
                if item is None:
                    stack.pop()
                    if node in parent:
                        ancestor, edge_id = parent[node]
                        low[ancestor] = min(low[ancestor],low[node])
                        if low[node] > discovery[ancestor]:
                            bridges.append(edge_id)
                    continue
                target, edge_id, edge = item
                if mode not in edge["modes"] or parent.get(node,(None,None))[1] == edge_id:
                    continue
                if target not in discovery:
                    parent[target] = (node,edge_id)
                    sequence += 1
                    discovery[target] = low[target] = sequence
                    stack.append((target,iter(adjacency[target])))
                else:
                    low[node] = min(low[node],discovery[target])
        return sorted(bridges)

    def ways(self, angle=None):
        """Merge edges into continuous polylines where kind matches and deflection is small."""
        limit = VALUES["stroke_angle"] if angle is None else angle
        nodes, edges = self.state["nodes"], self.state["edges"]
        incident = {}
        for key, edge in sorted(edges.items()):
            incident.setdefault(edge["a"], []).append(key)
            incident.setdefault(edge["b"], []).append(key)

        def heading(node, key):
            edge = edges[key]
            other = nodes[edge["b"] if edge["a"] == node else edge["a"]]
            return math.atan2(other["y"]-nodes[node]["y"], other["x"]-nodes[node]["x"])

        partner = {}
        for node, keys in sorted(incident.items()):
            pairs = []
            for i, first in enumerate(keys):
                for second in keys[i+1:]:
                    if edges[first]["kind"] != edges[second]["kind"]:
                        continue
                    turn = abs(math.degrees(heading(node, first)-heading(node, second))) % 360
                    deflection = abs(180-(turn if turn <= 180 else 360-turn))
                    if deflection <= limit:
                        pairs.append((deflection, first, second))
            used = set()
            for _, first, second in sorted(pairs):
                if first not in used and second not in used:
                    used.update((first, second))
                    partner[(node, first)], partner[(node, second)] = second, first
        seen, result = set(), []

        def walk(start_node, key):
            points, node = [], start_node
            while True:
                seen.add(key)
                edge = edges[key]
                node = edge["b"] if edge["a"] == node else edge["a"]
                points.append(node)
                key = partner.get((node, key))
                if key is None or key in seen:
                    return points

        for key, edge in sorted(edges.items()):
            if key in seen:
                continue
            forward = walk(edge["a"], key)
            backward = []
            previous = partner.get((edge["a"], key))
            if previous is not None and previous not in seen:
                backward = walk(edge["a"], previous)
            chain = list(reversed(backward))+[edge["a"]]+forward
            result.append({"kind": edge["kind"], "width": edge["width"], "level": nodes[edge["a"]]["level"],
                           "nodes": chain, "points": [[nodes[n]["x"], nodes[n]["y"]] for n in chain]})
        return result

    def topology_errors(self):
        """Report same-level contacts that are not shared nodes."""
        self._index()
        nodes, edges, errors = self.state["nodes"], self.state["edges"], []
        tolerance = VALUES["weld_tolerance"]
        for key, value in nodes.items():
            cx, cy = math.floor(value["x"]/CELL), math.floor(value["y"]/CELL)
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for other in self._node_cells.get((cx+dx, cy+dy), ()):
                        o = nodes[other]
                        if (value.get("exactJunction") or o.get("exactJunction")) and "|".join(sorted((key,other))) in edges:
                            continue
                        if other > key and o["level"] == value["level"] and math.hypot(o["x"]-value["x"], o["y"]-value["y"]) < tolerance:
                            errors.append(f"{self.kind}: unwelded nodes {key} {other}")
            for edge_key in self._edge_cells.get((cx, cy), ()):
                edge = edges[edge_key]
                if key not in (edge["a"], edge["b"]) and nodes[edge["a"]]["level"] == value["level"] and _on_segment(value, nodes[edge["a"]], nodes[edge["b"]]):
                    errors.append(f"{self.kind}: node inside edge {key} {edge_key}")
        checked = set()
        for cell_edges in self._edge_cells.values():
            ordered = sorted(cell_edges)
            for i, first in enumerate(ordered):
                e1 = edges[first]
                for second in ordered[i+1:]:
                    if (first, second) in checked:
                        continue
                    checked.add((first, second))
                    e2 = edges[second]
                    if {e1["a"], e1["b"]} & {e2["a"], e2["b"]}:
                        continue
                    p, q, r, s = nodes[e1["a"]], nodes[e1["b"]], nodes[e2["a"]], nodes[e2["b"]]
                    if not (p["level"] == q["level"] == r["level"] == s["level"]):
                        continue
                    d = (q["x"]-p["x"])*(s["y"]-r["y"])-(q["y"]-p["y"])*(s["x"]-r["x"])
                    if abs(d) < EPSILON:
                        continue
                    t = ((r["x"]-p["x"])*(s["y"]-r["y"])-(r["y"]-p["y"])*(s["x"]-r["x"]))/d
                    u = ((r["x"]-p["x"])*(q["y"]-p["y"])-(r["y"]-p["y"])*(q["x"]-p["x"]))/d
                    if EPSILON < t < 1-EPSILON and EPSILON < u < 1-EPSILON:
                        errors.append(f"{self.kind}: crossing without junction {first} {second}")
        return errors

    def metrics(self, mode=None):
        """Connectivity indices: dead ends, connected node ratio, link-node ratio, sharp junctions."""
        nodes, adjacency = self.state["nodes"], self.adjacency()
        degree = {k: sum(1 for _, _, e in v if mode is None or mode in e["modes"]) for k, v in adjacency.items()}
        dead = [k for k, d in degree.items() if d == 1]
        junctions = [k for k, d in degree.items() if d >= 3]
        sharp = []
        for key in junctions:
            here = nodes[key]
            angles = sorted(math.atan2(nodes[t]["y"]-here["y"], nodes[t]["x"]-here["x"]) for t, _, e in adjacency[key]
                            if nodes[t]["level"] == here["level"] and (mode is None or mode in e["modes"]))
            gaps = [b-a for a, b in zip(angles, angles[1:])]+[2*math.pi-angles[-1]+angles[0]]
            if min(gaps) < math.radians(VALUES["min_junction_angle"])-EPSILON:
                sharp.append(key)
        links = sum(1 for e in self.state["edges"].values() if mode is None or mode in e["modes"])
        ends = len(dead)+len(junctions)
        return {"deadEnds": len(dead), "junctions": len(junctions), "sharpJunctions": sharp,
                "connectedNodeRatio": len(junctions)/ends if ends else 1.0,
                "linkNodeRatio": links/ends if ends else 0.0}
