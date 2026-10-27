"""European radial-concentric world: a square, curved perimeter blocks, a boulevard ring and a river loop."""

import bisect
import functools
import math

from .network import Network
from .profile import VALUES, STREET_PROFILES, aabb, convex_overlap, overlaps, polygon_segment_distance, rect, stable_hash

TICKS = 6*2**20
_RADII = [0.0]
_BOUNDARIES = {}


def radius(j):
    """Radius of ring circle j; circle 1 bounds the central square."""
    while len(_RADII) <= j:
        if len(_RADII) == 1:
            _RADII.append(float(VALUES["plaza_radius"]))
            continue
        ring = len(_RADII)-1
        depths = VALUES["ring_depths"]
        _RADII.append(_RADII[ring]+depths[min(ring-1, len(depths)-1)])
    return _RADII[j]


def neighbourhood(project):
    """Top-level project of a source: nested project hubs belong to their parent's neighbourhood."""
    parts = (project or "").removesuffix(".md").split("/")
    return "/".join(parts[:2]) if len(parts) >= 2 else ""


def own_neighbourhood(source):
    """Neighbourhood that gets its own blocks; small projects share the class's mixed blocks."""
    if source.get("quarter"):
        return source["quarter"]
    name = neighbourhood(source.get("project"))
    return name if name and source.get("neighbourhoodSize", 0) >= VALUES["neighbourhood_min_sources"] else ""


def wedge_offset(tick, wedge):
    """Ticks from `tick` to the circular range [start, end); zero inside it."""
    start, end = wedge
    tick, span = tick % TICKS, (end-start) % TICKS or TICKS
    if (tick-start) % TICKS < span:
        return 0
    return min((start-tick) % TICKS, (tick-end) % TICKS)


def range_offset(a, b, wedge):
    """Ticks between the cell range [a, b) and a wedge; zero when they overlap."""
    if (b-a) >= TICKS or wedge_offset(a, wedge) == 0 or wedge_offset(b-1, wedge) == 0 or wedge_offset(wedge[0], (a % TICKS, b % TICKS)) == 0:
        return 0
    return min(wedge_offset(a, wedge), wedge_offset(b, wedge))


def historic():
    """Ticks of the historic radials; only these run through every ring."""
    return list(_historic(VALUES["first_ring_sectors"], VALUES["historic_swing"]))


@functools.lru_cache(maxsize=8)
def _historic(count, swing):
    """Pure in its parameters, so computed once instead of hashing on every geometry query."""
    unit = TICKS//count
    # Old roads leave the square at uneven angles; the first stays at tick 0 so every ring starts there.
    return tuple([0]+[k*unit+int(unit*swing*((stable_hash(f"historic:{k}") % 1000)/500-1)) for k in range(1, count)])


def boundaries(i):
    """Sector boundaries of ring i: historic radials plus ring-specific, uneven divisions between them."""
    if i not in _BOUNDARIES:
        result = []
        main = historic()
        old_town = i < VALUES["wall_ring"]
        low = VALUES["min_block_arc"]
        high = (VALUES["min_block_arc"]+VALUES["max_block_arc"])/2 if old_town else VALUES["max_block_arc"]
        for k, start in enumerate(main):
            end = main[k+1] if k+1 < len(main) else TICKS
            result.append(start)
            if i == 1:
                continue
            span = end-start
            inner = 2*math.pi*radius(i)*span/TICKS
            middle = 2*math.pi*(radius(i)+radius(i+1))/2*span/TICKS
            target = low+(high-low)*(stable_hash(f"target:{i}:{k}") % 1000)/1000
            count = max(1, round(middle/target))
            while True:
                jitter = VALUES["sector_jitter"]
                weights = [1+jitter*((stable_hash(f"cut:{i}:{k}:{count}:{n}") % 1000)/500-1) for n in range(count)]
                if count == 1 or min(weights)/sum(weights)*inner >= low*(1-jitter):
                    break
                count -= 1
            total, running = sum(weights), 0.0
            previous = boundaries(i-1) if i > 1 else []
            for weight in weights[:-1]:
                running += weight
                tick = start+int(span*running/total)
                # A cut that nearly meets an inner street continues it instead of making a tiny jog.
                close = [b for b in previous if abs(b-tick)*2*math.pi*radius(i)/TICKS < VALUES["street_continuation"]]
                # Radial river reaches keep a corridor wide enough for meanders, buffer and promenade.
                marks = [main[index] for index in VALUES["river_angles"].values()]+[TICKS]
                corridor = VALUES["river_meander"][0]+max(VALUES["river_widths"].values())/2+VALUES["riparian_buffer"]+VALUES["promenade_offset"]+5
                if i > VALUES["river_ring"] and any(abs(m-tick)*2*math.pi*radius(i)/TICKS < corridor for m in marks):
                    continue
                result.append(close[0] if close else tick)
        # No sliver blocks: drop cuts that leave less than the minimum arc on either side.
        shortest = VALUES["min_block_arc"]*(1-VALUES["sector_jitter"])
        kept = []
        for index, tick in enumerate(result):
            following = result[index+1] if index+1 < len(result) else TICKS
            historic_cut = tick in main
            if kept and not historic_cut and ((tick-kept[-1])*2*math.pi*radius(i)/TICKS < shortest or (following-tick)*2*math.pi*radius(i)/TICKS < shortest):
                continue
            kept.append(tick)
        result = kept
        _BOUNDARIES[i] = result
    return _BOUNDARIES[i]


def sectors(i):
    """Number of sectors in ring i."""
    return len(boundaries(i))


def angle(tick):
    """Plan angle of a tick; ticks are exact integers so shared nodes coincide."""
    return 2*math.pi*(tick % TICKS)/TICKS+math.radians(VALUES["sector_phase"])


@functools.lru_cache(maxsize=1 << 18)
def warp(r, tick):
    """Map plan polar coordinates to world metres with bounded organic irregularity."""
    theta = angle(tick)
    wavelength = VALUES["sway_wavelength"]
    rr = r*(1+sum(amount*math.sin(lobes*theta+phase+r/length) for lobes, amount, phase, length in VALUES["ring_wobbles"]))
    tt = theta+VALUES["radial_sway"]*wavelength/(wavelength+r)*math.sin(r/wavelength+2*theta)
    return (rr*math.cos(tt), rr*math.sin(tt))


def ticks_for(metres, r):
    """Convert a tangential distance at plan radius r into ticks."""
    return metres/max(r, 1e-9)/(2*math.pi)*TICKS


def tangential_scale(r, tick):
    """World metres per plan metre along a ring at (r, tick)."""
    dt = ticks_for(0.5, r)
    a, b = warp(r, tick+dt), warp(r, tick-dt)
    return math.hypot(a[0]-b[0], a[1]-b[1])


def side_ticks(r, tick, metres):
    """Ticks covering `metres` of world distance along a ring near (r, tick)."""
    return ticks_for(metres/tangential_scale(r, tick), r)


def frame(r, tick):
    """Unit world vectors along increasing radius and increasing angle."""
    dt = ticks_for(0.5, r)
    a, b = warp(r+0.5, tick), warp(r-0.5, tick)
    c, d = warp(r, tick+dt), warp(r, tick-dt)
    er, et = (a[0]-b[0], a[1]-b[1]), (c[0]-d[0], c[1]-d[1])
    lr, lt = math.hypot(*er), math.hypot(*et)
    return (er[0]/lr, er[1]/lr), (et[0]/lt, et[1]/lt)


def oriented_rect(centre, along, inward, length, depth):
    """Rectangle with `length` along `along` and `depth` along the perpendicular toward `inward`."""
    u = along
    v = (-u[1], u[0])
    if v[0]*inward[0]+v[1]*inward[1] < 0:
        v = (u[1], -u[0])
    x, y = centre
    corners = [(x-u[0]*length/2-v[0]*depth/2, y-u[1]*length/2-v[1]*depth/2),
               (x+u[0]*length/2-v[0]*depth/2, y+u[1]*length/2-v[1]*depth/2),
               (x+u[0]*length/2+v[0]*depth/2, y+u[1]*length/2+v[1]*depth/2),
               (x-u[0]*length/2+v[0]*depth/2, y-u[1]*length/2+v[1]*depth/2)]
    return [list(p) for p in corners], v


class World:
    """Grow compact rings of curved blocks around a square without moving earlier geometry."""

    def __init__(self, state, emit):
        self.state = state
        self.emit = emit
        for name in ("blocks", "parcels", "centres", "services", "vegetation"):
            state.setdefault(name, {})
        state.setdefault("protected", [])
        state.setdefault("land", None)
        state.setdefault("region", {"id":"knowledge-region","satellites":[],"links":[]})
        state.setdefault("networks", {})
        self.networks = {}
        for key in ("S", "P", "U-energy", "U-water", "U-waste", "U-maintenance"):
            self.networks[key] = Network(key, state["networks"].setdefault(key, {"nodes": {}, "edges": {}, "revision": 0}))
        self.street, self.walk = self.networks["S"], self.networks["P"]
        self.frontier = set() if state["blocks"] else {(1, s) for s in range(sectors(1))}
        self.vacant = {}
        self.retired_river_cells = set(state.get('retiredRiverCells',[]))
        self._cluster_neighbours_cache = {}
        for block in state["blocks"].values():
            self._extend_frontier(tuple(block["cell"]))
        for parcel in state["parcels"].values():
            if parcel["source"] is None and not parcel.get("protected"):
                self.vacant.setdefault(parcel["district"], set()).add(parcel["id"])

    @staticmethod
    def cell_ticks(i, s):
        """Integer tick range of a sector; every ring has a boundary at tick 0."""
        values = boundaries(i)
        return values[s], values[s+1] if s+1 < len(values) else TICKS

    @staticmethod
    def cell_of(i, tick):
        """Sector of ring i containing a tick."""
        return bisect.bisect_right(boundaries(i), tick % TICKS)-1

    def overlapping(self, i, a, b):
        """Sectors of ring i sharing part of the tick range (a, b)."""
        values = boundaries(i)
        return [(i, s) for s in range(bisect.bisect_right(values, a)-1, bisect.bisect_left(values, b))]

    def neighbours(self, i, s):
        """Adjacent cells: along the ring, and every overlapping sector inward and outward."""
        count = sectors(i)
        t0, t1 = self.cell_ticks(i, s)
        return {"previous": [(i, (s-1) % count)], "next": [(i, (s+1) % count)],
                "inner": self.overlapping(i-1, t0, t1) if i > 1 else [],
                "outer": self.overlapping(i+1, t0, t1)}

    def min_cell_arc(self, i, radial_water=False):
        """Shortest inner arc among the sectors of ring i, optionally only radial river cells."""
        cells = [s for s in range(sectors(i)) if not radial_water or (self.water(i, s) or {}).get("flow") == "radial"]
        return min((2*math.pi*radius(i)*(b-a)/TICKS for a, b in (self.cell_ticks(i, s) for s in cells)), default=math.inf)

    def cluster_neighbours(self, cell):
        """Land neighbours, including the two banks of a permitted radial bridge."""
        if cell in self._cluster_neighbours_cache:
            return self._cluster_neighbours_cache[cell]
        low, high = self.cell_ticks(*cell)
        marks = set(self.river_marks().values()) | {historic()[index] for index in VALUES['river_angles'].values()}
        result = set()
        for ring in (cell[0]-1, cell[0]+1):
            if ring < 1:
                continue
            result.update((ring, sector) for sector in range(sectors(ring)) if not self.water(ring, sector)
                          and (self.cell_ticks(ring, sector)[0] == high or self.cell_ticks(ring, sector)[1] == low))
        for direction, cells in self.neighbours(*cell).items():
            for candidate in cells:
                reach = self.water(*candidate)
                if reach is None and candidate[0]==VALUES['river_ring'] and f'{candidate[0]}:{candidate[1]}' in self.retired_river_cells:
                    reach = {'flow':'ring'}  # Existing road crossings still connect the two sides of a greenway.
                if not reach:
                    result.add(candidate)
                elif reach["flow"] == "ring" and direction in ("inner", "outer"):
                    a, b = self.cell_ticks(*candidate)
                    crossings = {t for t in (a, b) if t % TICKS not in marks and low <= t <= high}
                    result.update(c for c in self.neighbours(*candidate)[direction] if not self.water(*c)
                                  and any(self.cell_ticks(*c)[0] <= t <= self.cell_ticks(*c)[1] for t in crossings))
        result = frozenset(result)
        self._cluster_neighbours_cache[cell] = result
        return result

    def cell_centre(self, i, s):
        """World centre of a sector."""
        t0, t1 = self.cell_ticks(i, s)
        return warp((radius(i)+radius(i+1))/2, (t0+t1)/2)

    def cell_polygon(self, i, s, steps=8):
        """World outline of a sector up to street centrelines."""
        t0, t1 = self.cell_ticks(i, s)
        r0, r1 = radius(i), radius(i+1)
        inner = [warp(r0, t0+(t1-t0)*k/steps) for k in range(steps+1)]
        outer = [warp(r1, t1-(t1-t0)*k/steps) for k in range(steps+1)]
        return inner+outer

    @staticmethod
    def river_marks():
        """Entry and exit of an open river valley; never a belt around the city."""
        return {name: historic()[index] for name, index in VALUES["river_route"].items()}

    @staticmethod
    def water(i, s):
        """Reserve the entry/exit corridors and their connecting open bend."""
        ring = VALUES["river_ring"]
        if i < ring:
            return None
        t0,t1 = World.cell_ticks(i,s)
        marks = World.river_marks()
        touching = [name for name,tick in sorted(marks.items(),key=lambda item:item[1]) if tick in (t0,t1%TICKS)]
        if i==ring:
            if touching or marks['inflow']<=t0<t1<=marks['outflow']:
                return {'reach':'urban-bend','flow':'ring','order':1,'confluence':bool(touching),'marks':touching}
        elif touching:
            return {'reach':touching[0],'flow':'radial','order':1,'confluence':False,'marks':touching}
        return None

    def _profile(self, piece):
        """Street role of a boundary piece: boulevard on the wall line, historic radials, old-town lanes."""
        kind, ring_or_circle, tick = piece[0], piece[1], piece[2]
        if kind == "arc":
            return "boulevard" if ring_or_circle == VALUES["wall_ring"] else "shared-local"
        if tick in historic():
            return "district" if ring_or_circle >= VALUES["wall_ring"] else "shared-local"
        if ring_or_circle < VALUES["wall_ring"] and stable_hash(str(piece)) % 3 == 0:
            return "pedestrian"
        return "shared-local"

    def _inset(self, piece):
        """Half street corridor a parcel must keep clear of."""
        profile = STREET_PROFILES[self._profile(piece)]
        # Plan metres stretch slightly under the organic warp; keep a margin so world corridors stay clear.
        return max(VALUES["carriage_width"]/2+VALUES["sidewalk_width"], profile["width"]/2+profile["sidewalk"])*VALUES["corridor_margin"]

    def _walk_offset(self, piece):
        """Sidewalk centreline distance from the street centreline."""
        return self._inset(piece)-VALUES["sidewalk_width"]/2

    def pieces(self, i, s):
        """Boundary pieces of a sector with the cell across each one."""
        t0, t1 = self.cell_ticks(i, s)
        near = self.neighbours(i, s)
        result = [] if near["inner"] else [{"piece": ("arc", i, t0, t1), "side": "inner", "across": "plaza"}]
        for cell in near["inner"]:
            a, b = self.cell_ticks(*cell)
            result.append({"piece": ("arc", i, max(a, t0), min(b, t1)), "side": "inner", "across": cell})
        for cell in near["outer"]:
            a, b = self.cell_ticks(*cell)
            result.append({"piece": ("arc", i+1, max(a, t0), min(b, t1)), "side": "outer", "across": cell})
        result.append({"piece": ("radial", i, t0 % TICKS), "side": "start", "across": near["previous"][0]})
        result.append({"piece": ("radial", i, t1 % TICKS), "side": "end", "across": near["next"][0]})
        return result

    @staticmethod
    def piece_points(piece):
        """Plan points (radius, tick) along a piece, finely enough to show its curve."""
        if piece[0] == "arc":
            _, j, a, b = piece
            r = radius(j)
            parts = max(1, math.ceil(2*math.pi*r*(b-a)/TICKS/VALUES["arc_segment"]))
            return [(r, a+(b-a)*k//parts) for k in range(parts+1)]
        _, i, tick = piece
        r0, r1 = radius(i), radius(i+1)
        parts = max(1, math.ceil((r1-r0)/VALUES["arc_segment"]))
        return [(r0+(r1-r0)*k/parts if 0 < k < parts else (r0 if k == 0 else r1), tick) for k in range(parts+1)]

    @staticmethod
    def _cell_key(cell):
        return cell if isinstance(cell, str) else f"{cell[0]}:{cell[1]}"

    def _street_piece(self, piece, between, kind=None):
        """Lay a curved street piece as welded straight edges; return its node ids."""
        name = kind or self._profile(piece)
        profile = STREET_PROFILES["district" if name == "bridge" else name]
        modes = list(dict.fromkeys(profile["modes"]+["walk"]+(["transit"] if name == "shared-local" else [])))
        nodes = [self.street.node(*warp(r, t)) for r, t in self.piece_points(piece)]
        nodes = [n for index, n in enumerate(nodes) if index == 0 or n != nodes[index-1]]
        labels = sorted(self._cell_key(c) for c in between)
        for a, b in zip(nodes, nodes[1:]):
            key = self.street.edge(a, b, modes=modes, width=profile["width"], kind=name)
            self.street.state["edges"][key].setdefault("between", labels)
        return nodes

    def _extend_frontier(self, cell):
        """Keep a compact boundary; land across water is reached by a bridge."""
        self.frontier.discard(cell)
        low, high = self.cell_ticks(*cell)
        marks = set(self.river_marks().values()) | {historic()[index] for index in VALUES['river_angles'].values()}
        for direction, cells in self.neighbours(*cell).items():
            for candidate in cells:
                reach = self.water(*candidate)
                if reach is None and candidate[0]==VALUES['river_ring'] and f'{candidate[0]}:{candidate[1]}' in self.retired_river_cells:
                    reach = {'flow':'ring'}
                if reach:
                    # Only the loop is crossed, radially, at a tick where a bridge can join both banks.
                    if reach["flow"] != "ring" or direction not in ("inner", "outer"):
                        continue
                    a, b = self.cell_ticks(*candidate)
                    crossings = {t for t in (a, b) if t % TICKS not in marks and low <= t <= high}
                    beyond = [c for c in self.neighbours(*candidate)[direction] if not self.water(*c)
                              and any(self.cell_ticks(*c)[0] <= t <= self.cell_ticks(*c)[1] for t in crossings)]
                else:
                    beyond = [candidate]
                for target in beyond:
                    if f"block:{target[0]}:{target[1]}" not in self.state["blocks"]:
                        self.frontier.add(target)

    def reserve_land(self, box, reason):
        """Protect a terrain envelope before allocation, never silently evicting lots."""
        if any(overlaps(box, block["envelope"]) for block in self.state["blocks"].values()):
            raise ValueError("Protected land conflicts with an established block")
        self.state["protected"].append({"id": f"protected:{len(self.state['protected'])}", "box": box, "reason": reason})

    def rivers(self, margin=240):
        """An open, directed, stable valley course with rounded bends and unequal banks."""
        if self.state['land'] is None:
            return []
        land=self.state['land']
        far=max(math.hypot(x,y) for x in (land['x'],land['x']+land['w']) for y in (land['y'],land['y']+land['h']))+margin
        ring=VALUES['river_ring']
        middle=(radius(ring)+radius(ring+1))/2
        marks=self.river_marks()
        step=VALUES['arc_segment']/4
        turn=VALUES['river_turn_radius']
        amplitude,wavelength=VALUES['river_meander']
        def radial(tick,inward):
            distances=[middle+turn+k*step for k in range(int((far-middle-turn)/step)+1)]
            points=[warp(r,tick+side_ticks(r,tick,amplitude*min(1,(r-middle-turn)/wavelength)*math.sin(2*math.pi*(r-middle-turn)/wavelength+tick%7))) for r in distances]
            return [list(p) for p in (points[::-1] if inward else points)]
        start,end=marks['inflow'],marks['outflow']
        delta=turn/middle*TICKS/(2*math.pi)
        a,b=start+delta,end-delta
        cuts=boundaries(ring)
        def bend_point(t):
            sector=self.cell_of(ring,t)
            low,high=self.cell_ticks(ring,sector)
            phase=(t-low)/(high-low)
            # Bridges meet at sector boundaries: offset and its derivative are zero there.
            offset=VALUES['river_bend_relief']*math.sin(math.pi*phase)**2*math.sin(2.3*t/TICKS*2*math.pi+.7)
            fade=min(1,max(0,(t-a)/(delta or 1)),max(0,(b-t)/(delta or 1)))
            return list(warp(middle+offset*fade,t))
        count=max(2,int(2*math.pi*middle*(b-a)/TICKS/step))
        ticks=sorted(set([a+(b-a)*k/count for k in range(count+1)]+[t for t in cuts if a<t<b]))
        curve=[bend_point(t) for t in ticks]
        upstream=radial(start,True)
        downstream=radial(end,False)
        def fillet(p,q,r):
            return [[(1-t)**2*p[j]+2*(1-t)*t*q[j]+t*t*r[j] for j in (0,1)] for t in [k/12 for k in range(13)]]
        bend=fillet(upstream[-1],warp(middle,start),curve[0])+curve[1:-1]+fillet(curve[-1],warp(middle,end),downstream[0])
        reaches=[('inflow',upstream,'river:urban-bend'),('urban-bend',bend,'river:outflow'),('outflow',downstream,None)]
        return [{'id':'river:'+name,'derived':True,'order':1,'width':VALUES['river_widths']['1'],
                 'points':points,'downstream':target,'courseVersion':2} for name,points,target in reaches]

    def _plaza(self, source, tick, block):
        """Found the enclosed square with a town hall near its edge."""
        r = radius(1)
        centre = self.walk.node(0.0, 0.0)
        outline = [list(warp(r-VALUES["carriage_width"]/2, k*TICKS/24)) for k in range(24)]
        self.state["protected"].append({"id": "plaza", "polygon": outline, "box": aabb(outline), "reason": "Central square"})
        unit = TICKS//VALUES["first_ring_sectors"]
        position = warp(r*0.55, unit/2)
        er, et = frame(r*0.55, unit/2)
        footprint, _ = oriented_rect(position, et, (-er[0], -er[1]), 16, 10)
        self.state["services"]["plaza:town-hall"] = {"id": "plaza:town-hall", "derived": True, "source": None,
            "owner": source["stableId"], "district": source.get("sourceClass", source["district"]), "block": block,
            "function": "civic-pavilion" if source.get("cityRole") == "town-hall" else "town-hall", "footprint": {**aabb(footprint), "polygon": footprint}, "entrance": centre,
            "capacity": VALUES["service_capacity"], "hours": list(VALUES["activity_hours"]["work"]), "enabled": True,
            "occupants": [], "reservations": [], "queue": [], "state": "open", "createdAt": tick}
        # The whole ring street around the square comes with it, so every quarter around it is connected.
        for s in range(sectors(1)):
            t0, t1 = self.cell_ticks(1, s)
            self._street_piece(("arc", 1, t0, t1), ["plaza", (1, s)])
        self.emit("plazaFounded", reason="Civic square and town hall at the origin of the radial roads")

    def _new_block(self, source, tick, connected=True, bounded=True):
        """Choose feasible serviced boundary land, lay its streets, then parcels and courtyard."""
        district = source.get("sourceClass", source["district"])
        centre = self.state["centres"].get(district)
        zones = [zone for zone in self.state["protected"] if not zone["id"].startswith("park:") and zone["id"] != "plaza"]
        wedge = self.state.get("wedges", {}).get(district)
        sub_wedge = self.state.get("subWedges", {}).get(district, {}).get(own_neighbourhood(source))
        quarter_cells = {tuple(b["cell"]) for b in self.state["blocks"].values() if b["district"] == district and b.get("neighbourhood", "") == own_neighbourhood(source)} if own_neighbourhood(source) else set()
        candidates = []
        landmark = self.state["services"].get("facility:"+district, {})
        complex_boxes = [p["box"] for p in self.state["parcels"].values()
                         if landmark.get("siteVersion") == 1 and (p["id"] == landmark.get("parcel") or p.get("annexOf") == landmark.get("id"))]
        frontier = self.frontier | ({(i, s) for i in (1, 2) for s in range(sectors(i)) if f"block:{i}:{s}" not in self.state["blocks"]} if centre is None else set())
        for cell in frontier:
            if f'{cell[0]}:{cell[1]}' in self.retired_river_cells:
                continue
            envelope = aabb(self.cell_polygon(*cell, steps=4))
            if self.water(*cell) or any(overlaps(envelope, zone["box"]) for zone in zones):
                continue
            if connected and centre and not any(self.state["blocks"].get(f"block:{c[0]}:{c[1]}", {}).get("district") == district for c in self.cluster_neighbours(cell)):
                continue
            if quarter_cells and not (self.cluster_neighbours(cell) & quarter_cells):
                continue
            x, y = self.cell_centre(*cell)
            # Radial growth from the square inside the class's wedge (and the project's sub-wedge).
            score = math.hypot(x, y)*VALUES["distance_weight"]
            a, b = self.cell_ticks(*cell)
            middle = (a+b)/2
            if bounded and wedge and wedge_offset(middle, wedge):
                continue
            if bounded and source.get("quarter") and sub_wedge and wedge_offset(middle, sub_wedge):
                continue
            span = 2*math.pi*math.hypot(x, y)/TICKS
            if wedge:
                score += range_offset(a, b, wedge)*span*VALUES["wedge_weight"]
                if range_offset(a, b, wedge):
                    score += VALUES["class_boundary_penalty"]
            if sub_wedge:
                score += range_offset(a, b, sub_wedge)*span*VALUES["sub_wedge_weight"]
                if wedge_offset(middle, sub_wedge):
                    score += VALUES["project_boundary_penalty"]
                if range_offset(a, b, sub_wedge):
                    score += VALUES["project_boundary_penalty"]
            if centre:
                # A quarter grows next to its own blocks and avoids wrapping around other quarters.
                near = [self.state["blocks"].get(f"block:{c[0]}:{c[1]}") for cells in self.neighbours(*cell).values() for c in cells]
                quarter = own_neighbourhood(source)
                for other in filter(None, near):
                    score += VALUES["cohesion_weight"]*(-1 if other["district"] == district else 1)
                    # Within the class, a project's blocks stay together as a sub-quarter.
                    if other["district"] == district and quarter and other.get("neighbourhood") == quarter:
                        score -= VALUES["neighbourhood_weight"]
            else:
                # It starts on land beside the town, not alone across the river.
                if self.state["blocks"] and not any(f"block:{c[0]}:{c[1]}" in self.state["blocks"] for cells in self.neighbours(*cell).values() for c in cells):
                    score += 2*VALUES["cohesion_weight"]
            # Feasibility and ownership are hard constraints above; fill one band around the complex at a time.
            gap = min((math.hypot(max(box["x"]-envelope["x"]-envelope["w"], 0, envelope["x"]-box["x"]-box["w"]),
                                  max(box["y"]-envelope["y"]-envelope["h"], 0, envelope["y"]-box["y"]-box["h"]))
                       for box in complex_boxes), default=0)
            band = int(gap // VALUES["landmark_growth_band"])
            candidates.append((band, score, stable_hash(f"{district}:{cell[0]}:{cell[1]}"), cell))
        if not candidates:
            # An enclosed class first takes free land of its own wedge, then crosses its wedge boundary beside
            # its own blocks, then any free land; boundary penalties in the score keep the nearest choice.
            if connected:
                return self._new_block(source, tick, connected=False, bounded=bounded)
            if bounded:
                return self._new_block(source, tick, connected=True, bounded=False)
            raise ValueError("No connected feasible land; protected land was preserved")
        candidates.sort()
        i, s = candidates[0][3]
        key = f"block:{i}:{s}"
        if not self.state["blocks"]:
            self._plaza(source, tick, key)
        cx, cy = self.cell_centre(i, s)
        block = {"id": key, "cell": [i, s], "x": cx, "y": cy, "district": district, "neighbourhood": own_neighbourhood(source),
                 "envelope": aabb(self.cell_polygon(i, s)), "createdAt": tick,
                 "growth": {"complex": landmark.get("id") if complex_boxes else None, "band": candidates[0][0],
                            "score": candidates[0][1], "feasibleCandidates": len(candidates)}}
        self.state["blocks"][key] = block
        self._extend_frontier((i, s))
        if centre is None:
            distance = math.hypot(cx, cy)
            centre = {"id": f"centre:{district}", "x": cx, "y": cy, "block": key, "source": source["stableId"],
                      "kind": "satellite-city" if distance > VALUES["regional_distance"] else "district",
                      "reason": "Topic hub on the city edge next to existing streets" if len(self.state["blocks"]) > 1 else "First knowledge source beside the civic square"}
            self.state["centres"][district] = centre
            centre["region"] = self.state["region"]["id"]
            if centre["kind"] == "satellite-city":
                centre["cityReason"] = "Remote thematic demand beyond the scenario regional distance; independent local services, finite utilities and two regional approaches"
                self.state["region"]["satellites"].append(centre["id"])
            self.emit("centreFounded", source=source["stableId"], centre=centre["id"], reason=centre["reason"])
        t0, t1 = self.cell_ticks(i, s)
        r0, r1 = radius(i), radius(i+1)
        pieces = self.pieces(i, s)
        # Full street corridors first, shared with any neighbour that already laid them.
        block["corridors"] = []
        for item in pieces:
            nodes = self._street_piece(item["piece"], [(i, s), item["across"]])
            block["corridors"].append({"points": [[self.street.state["nodes"][n]["x"], self.street.state["nodes"][n]["y"]] for n in nodes],
                                       "half": self._inset(item["piece"])})
        block["streetCorners"] = [self.street.node(*warp(r0, t0)), self.street.node(*warp(r0, t1)),
                                  self.street.node(*warp(r1, t1)), self.street.node(*warp(r1, t0))]
        outer = [p["piece"] for p in pieces if p["side"] == "outer"]
        inner = [p["piece"] for p in pieces if p["side"] == "inner"]
        inset = {"inner": max(self._inset(p) for p in inner), "outer": max(self._inset(p) for p in outer),
                 "start": self._inset(pieces[-2]["piece"]), "end": self._inset(pieces[-1]["piece"])}
        offset = {"inner": max(self._walk_offset(p) for p in inner), "outer": max(self._walk_offset(p) for p in outer),
                  "start": self._walk_offset(pieces[-2]["piece"]), "end": self._walk_offset(pieces[-1]["piece"])}
        rm, tm = (r0+r1)/2, (t0+t1)/2
        ri, ro = r0+offset["inner"], r1-offset["outer"]

        def side_tick(side, r):
            return t0+side_ticks(r, t0, offset["start"]) if side == "start" else t1-side_ticks(r, t1, offset["end"])

        def arc_line(r, a, b):
            parts = max(1, math.ceil(2*math.pi*r*abs(b-a)/TICKS/VALUES["arc_segment"]))
            return [(r, a)]+[(r, a+(b-a)*k/parts) for k in range(1, parts)]+[(r, b)]

        def radial_line(side, a, b):
            parts = max(1, math.ceil(abs(b-a)/VALUES["arc_segment"]))
            radii = [a]+[a+(b-a)*k/parts for k in range(1, parts)]+[b]
            return [(r, side_tick(side, r)) for r in radii]

        # Sidewalk loop with explicit face midpoints where courtyard passages start.
        faces = {"inner": arc_line(ri, side_tick("start", ri), tm)+arc_line(ri, tm, side_tick("end", ri))[1:],
                 "end": radial_line("end", ri, rm)+radial_line("end", rm, ro)[1:],
                 "outer": arc_line(ro, side_tick("end", ro), tm)+arc_line(ro, tm, side_tick("start", ro))[1:],
                 "start": radial_line("start", ro, rm)+radial_line("start", rm, ri)[1:]}
        block["faces"] = {}
        for name, points in faces.items():
            ids = [self.walk.node(*warp(r, t)) for r, t in points]
            for a, b in zip(ids, ids[1:]):
                self.walk.edge(a, b, kind="sidewalk", width=VALUES["sidewalk_width"])
            block["faces"][name] = ids
        block["walkCorners"] = [block["faces"]["inner"][0], block["faces"]["inner"][-1], block["faces"]["outer"][0], block["faces"]["outer"][-1]]
        corner_points = [warp(r0, t0), warp(r0, t1), warp(r1, t1), warp(r1, t0)]
        for walk_corner, point in zip(block["walkCorners"], corner_points):
            self.walk.edge(walk_corner, self.walk.node(*point), crossing=True, kind="signal-crossing")
        # T-junctions on this block's streets get a crossing to its sidewalk, so pedestrians pass
        # between blocks whose corners do not coincide.
        corner_junctions = {self.walk.node(*point) for point in corner_points}
        for item in pieces:
            points = self.piece_points(item["piece"])
            for r, end_tick in (points[0], points[-1]):
                junction = self.walk.node(*warp(r, end_tick))
                if junction in corner_junctions:
                    continue
                here = self.walk.state["nodes"][junction]
                nearest = min((n for face in block["faces"].values() for n in face),
                              key=lambda n: math.hypot(self.walk.state["nodes"][n]["x"]-here["x"], self.walk.state["nodes"][n]["y"]-here["y"]))
                self.walk.edge(junction, nearest, crossing=True, kind="signal-crossing")
        if i == 1:
            for point in corner_points[:2]:
                self.walk.edge(self.walk.node(*point), self.walk.node(0.0, 0.0), kind="plaza-path", width=4)
        for direction in ("previous", "next", "inner", "outer"):
            for other in self.neighbours(i, s)[direction]:
                neighbour = self.state["blocks"].get(f"block:{other[0]}:{other[1]}")
                if not neighbour or centre["kind"] != "satellite-city" or neighbour["district"] == district:
                    continue
                shared = sorted([self._cell_key((i, s)), self._cell_key(other)])
                for link, edge in sorted(self.street.state["edges"].items()):
                    if edge.get("between") == shared:
                        edge["role"] = "regional"
                        if link not in self.state["region"]["links"]:
                            self.state["region"]["links"].append(link)
        # Perimeter plots of uneven widths (quarter-unit steps); old-town facades are almost continuous.
        old_town = i < VALUES["wall_ring"]
        depth = VALUES["parcel_depth"]
        unit = VALUES["old_town_frontage"] if old_town else VALUES["frontage"]
        clear = VALUES["old_town_gap"] if old_town else VALUES["parcel_clearance"]
        passage = VALUES["passage_width"]/2+VALUES["parcel_clearance"]
        steps = VALUES["plot_width_steps"]

        def march(length, label):
            """(centre offset, width) of plots filling `length` metres from one end."""
            plots, position, index = [], 0.0, 0
            while True:
                width = unit*steps[stable_hash(f"{key}:{label}:{index}") % len(steps)]
                if position+width > length+1e-9:
                    width = unit*min(steps)
                    if position+width > length+1e-9:
                        return plots
                plots.append((position+width/2, width))
                position += width+clear
                index += 1

        inner_back, outer_back = r0+inset["inner"]+depth, r1-inset["outer"]-depth
        lots, side_parcels = [], {"start": 0, "end": 0}
        def along(tick, metres, sign, r_a, r_b):
            """Tick reached after `metres` of world distance along a face, measured on its tighter edge r_a."""
            done = 0.0
            while done < metres-1e-9:
                step = min(1.0, metres-done)
                scale = tangential_scale(r_a, tick)
                tick += sign*ticks_for(step/scale, r_a)
                done += step
            return tick

        # Spacing is measured on the converging edge of the houses themselves, set back inside the plots.
        setback = (depth-VALUES["footprint_depth"])/2
        for face, r_line, r_tight in (("inner", r0+inset["inner"]+depth/2, r0+inset["inner"]+setback), ("outer", r1-inset["outer"]-depth/2, outer_back+setback)):
            start = t0+side_ticks(r_tight, t0, inset["start"]+VALUES["parcel_clearance"])
            end = t1-side_ticks(r_tight, t1, inset["end"]+VALUES["parcel_clearance"])
            # The inner face is one continuous row; the outer face leaves the courtyard passage.
            if face == "outer":
                halves = ((start, along(tm, passage, -1, r_tight, r_line), 1), (end, along(tm, passage, 1, r_tight, r_line), -1))
            else:
                halves = ((start, end, 1),)
            for origin, limit, sign in halves:
                # Plots are stepped by real ground distance, so rows stay tight on every stretch of the curve.
                position, index = origin, 0
                while True:
                    width = unit*steps[stable_hash(f"{key}:{face}:{sign}:{index}") % len(steps)]
                    finish = along(position, width, sign, r_tight, r_line)
                    if (finish-limit)*sign > 0:
                        width = unit*min(steps)
                        finish = along(position, width, sign, r_tight, r_line)
                        if (finish-limit)*sign > 0:
                            break
                    lots.append((face, r_line, along(position, width/2, sign, r_tight, r_line), width))
                    position = along(finish, clear, sign, r_tight, r_line)
                    index += 1
        for side in ("start", "end"):
            # Side lots keep a double gap from the corner lots of the arc faces.
            for low, high, forward in ((inner_back+2*VALUES["parcel_clearance"], rm-passage, True), (rm+passage, outer_back-2*VALUES["parcel_clearance"], False)):
                for centre, width in march(high-low, f"{side}:{forward}") if high > low else []:
                    r = low+centre if forward else high-centre
                    # Side rows only where the block is wide enough for both of them.
                    if 2*math.pi*r*(t1-t0)/TICKS*tangential_scale(r, tm) < inset["start"]+inset["end"]+2*depth+passage:
                        continue
                    lot_tick = t0+side_ticks(r, t0, inset["start"]+depth/2) if side == "start" else t1-side_ticks(r, t1, inset["end"]+depth/2)
                    lots.append((side, r, lot_tick, width))
                    side_parcels[side] += 1
        public = self.walk.node(*warp(rm, tm))
        block["publicNode"] = public
        radial_path = [(rm, tm), (outer_back, tm), (ro, tm)]
        ids = [self.walk.node(*warp(r, t)) for r, t in radial_path]
        for a, b in zip(ids, ids[1:]):
            self.walk.edge(a, b, kind="public-path", width=4)
        court_scale = min(tangential_scale(rm, t0+(t1-t0)*k/8) for k in range(9))
        court_tangential = math.pi*rm*(t1-t0)/TICKS*court_scale-max(inset["start"]+(depth if side_parcels["start"] else clear),
                                                       inset["end"]+(depth if side_parcels["end"] else clear))
        court_radial = (outer_back-inner_back)/2
        service_offset = max(4.0, min(VALUES["service_offset"], court_tangential-4))
        market, library = (rm, tm-side_ticks(rm, tm, service_offset)), (rm, tm+side_ticks(rm, tm, service_offset))
        chain = [(rm, side_tick("start", rm)), market, (rm, tm), library, (rm, side_tick("end", rm))]
        ids = [self.walk.node(*warp(r, t)) for r, t in chain]
        for a, b in zip(ids, ids[1:]):
            self.walk.edge(a, b, kind="public-path", width=4)
        er, et = frame(rm, tm)
        core_length = min(court_tangential*0.8, math.sqrt(rm*court_radial))
        core, _ = oriented_rect(warp(rm, tm), et, er, max(2.0, core_length), max(2.0, court_radial*0.5))
        self.state["protected"].append({"id": f"park:{key}", "polygon": core, "box": aabb(core), "reason": "Permanent permeable public courtyard"})
        for function, point in (("library", library), ("market", market), ("park", (rm, tm))):
            service_id = f"{key}:{function}"
            entrance_point = warp(*point)
            footprint = None
            if function != "park":
                polygon, _ = oriented_rect((entrance_point[0]+er[0]*5.5, entrance_point[1]+er[1]*5.5), et, er, 6, 6)
                footprint = {**aabb(polygon), "polygon": polygon}
            self.state["services"][service_id] = {"id": service_id, "derived": True, "source": None,
                "owner": source["stableId"], "district": district, "block": key, "function": function,
                "footprint": footprint, "entrance": self.walk.node(*entrance_point),
                "capacity": VALUES["service_capacity"], "hours": list(VALUES["activity_hours"][function]), "enabled": True,
                "occupants": [], "reservations": [], "queue": [], "state": "open"}
        tree_t = min(VALUES["courtyard_tree_offset"], court_tangential-2)
        tree_r = min(VALUES["courtyard_tree_offset"], court_radial-2)
        if tree_t >= 3.5 and tree_r >= 3.5:
            for index, (a, b) in enumerate(((-1, -1), (1, -1), (-1, 1), (1, 1))):
                x, y = warp(rm+b*tree_r, tm+a*side_ticks(rm, tm, tree_t))
                tree_id = f"{key}:tree:{index}"
                self.state["vegetation"][tree_id] = {"id": tree_id, "derived": True, "x": x, "y": y,
                    "owner": source["stableId"], "plantedAt": tick, "species": "broadleaf" if stable_hash(district) % 2 else "conifer",
                    "role": "courtyard-shade", "protected": True}
        # The boulevard on the former wall line carries an allee on its median.
        planted = {v["id"].split(":tree:")[1] for v in self.state["vegetation"].values() if ":tree:allee-" in v["id"]}
        for item in pieces:
            if self._profile(item["piece"]) != "boulevard":
                continue
            _, circle, a, b = item["piece"]
            r = radius(circle)
            length = 2*math.pi*r*(b-a)/TICKS
            for index in range(int(length//VALUES["boulevard_tree_spacing"])):
                name = f"allee-{circle}-{a}-{index}"
                if name in planted:
                    continue
                tree_id = f"{key}:tree:{name}"
                x, y = warp(r, a+(b-a)*(index+0.5)*VALUES["boulevard_tree_spacing"]/length)
                self.state["vegetation"][tree_id] = {"id": tree_id, "derived": True, "x": x, "y": y,
                    "owner": source["stableId"], "plantedAt": tick, "species": "broadleaf", "role": "boulevard-allee", "protected": True}
        block["parcels"] = []
        for index, (face, r, tick_value, width) in enumerate(lots):
            er, et = frame(r, tick_value)
            centre_point = warp(r, tick_value)
            if face in ("inner", "outer"):
                along, inward = et, (er if face == "inner" else (-er[0], -er[1]))
            else:
                along, inward = er, (et if face == "start" else (-et[0], -et[1]))
            house = width if old_town else width-2*VALUES["house_margin"]
            house_depth = VALUES["footprint_depth"]+stable_hash(f"{key}:depth:{index}") % 3
            polygon, v = oriented_rect(centre_point, along, inward, width, depth)
            # Tight old-town rows on sharp curves: a plot that would touch an accepted neighbour is left as garden.
            if convex_overlap(polygon, core) or any(convex_overlap(polygon, self.state["parcels"][other]["polygon"]) for other in block["parcels"]):
                continue
            footprint, _ = oriented_rect(centre_point, along, inward, house, house_depth)
            # Under strong curvature a front corner may touch the corridor; step the house back within its plot.
            # Only segments whose bounding box comes within the corridor half-width can push the house back.
            box = aabb(footprint)
            deficit = max([item["half"]-polygon_segment_distance(footprint, a, b) for item in block["corridors"]
                           for a, b in zip(item["points"], item["points"][1:])
                           if min(a[0], b[0])-item["half"] < box["x"]+box["w"] and max(a[0], b[0])+item["half"] > box["x"]
                           and min(a[1], b[1])-item["half"] < box["y"]+box["h"] and max(a[1], b[1])+item["half"] > box["y"]], default=-1)
            if deficit > 0:
                centre_point = (centre_point[0]+v[0]*(deficit+0.05), centre_point[1]+v[1]*(deficit+0.05))
                footprint, _ = oriented_rect(centre_point, along, inward, house, house_depth)
            door = (centre_point[0]-v[0]*house_depth/2, centre_point[1]-v[1]*house_depth/2)
            entrance = self.walk.node(*door)
            self.walk.edge(entrance, self._gate(block["faces"][face], door), kind="entrance-path")
            parcel_id = f"{key}:lot:{index}"
            parcel = {"id": parcel_id, "block": key, "district": district, "box": aabb(polygon), "polygon": polygon,
                      "footprint": {**aabb(footprint), "polygon": footprint, "cx": centre_point[0], "cy": centre_point[1],
                                    "fw": house, "fd": house_depth, "angle": math.atan2(along[1], along[0])},
                      "entrance": entrance, "frontage": width, "face": face, "source": None, "state": "vacant", "protected": False,
                      "createdAt": tick, "project": None}
            self.state["parcels"][parcel_id] = parcel
            block["parcels"].append(parcel_id)
            self.vacant.setdefault(district, set()).add(parcel_id)
        self._utility_connections(block)
        self._riverside(block)
        quarter = self.state["centres"][district]
        if quarter["kind"] == "satellite-city" and quarter["block"] == key:
            # Regional approaches: every street leaving the satellite's first block, including bridges.
            own = {n for corridor in block["corridors"] for n in (self.street.node(*p) for p in corridor["points"])}
            for link, edge in sorted(self.street.state["edges"].items()):
                if (edge["a"] in own) != (edge["b"] in own) and link not in self.state["region"]["links"]:
                    edge["role"] = "regional"
                    self.state["region"]["links"].append(link)
        envelope = block["envelope"]
        old = self.state["land"]
        if old is None:
            self.state["land"] = rect(envelope["x"]-30,envelope["y"]-30,envelope["w"]+60,envelope["h"]+60)
        else:
            left, top = min(old["x"],envelope["x"]-30), min(old["y"],envelope["y"]-30)
            right, bottom = max(old["x"]+old["w"],envelope["x"]+envelope["w"]+30), max(old["y"]+old["h"],envelope["y"]+envelope["h"]+30)
            self.state["land"] = rect(left,top,right-left,bottom-top)
        self.emit("streetConnected", block=key, growth=block["growth"], reason="Ring and radial streets shared with neighbours; full corridors reserved before parcels")
        return block

    def _gate(self, face, door):
        """Join an entrance path to the closest point of its sidewalk; the sidewalk is split there."""
        best = None
        for a, b in zip(face, face[1:]):
            p, q = self.walk.state["nodes"][a], self.walk.state["nodes"][b]
            dx, dy = q["x"]-p["x"], q["y"]-p["y"]
            t = max(0.0, min(1.0, ((door[0]-p["x"])*dx+(door[1]-p["y"])*dy)/(dx*dx+dy*dy or 1)))
            point = (p["x"]+t*dx, p["y"]+t*dy)
            distance = math.hypot(point[0]-door[0], point[1]-door[1])
            if best is None or distance < best[0]:
                best = (distance, a if t == 0 else b if t == 1 else None, point)
        return best[1] or self.walk.node(*best[2])

    def _utility_connections(self, block):
        """Lay separate underground networks under the block's streets and to each entrance."""
        corridor_points = [tuple(p) for corridor in block["corridors"] for p in corridor["points"]]
        for resource in ("energy", "water", "waste", "maintenance"):
            net = self.networks[f"U-{resource}"]
            for corridor in block["corridors"]:
                ids = [net.node(x, y, -1) for x, y in corridor["points"]]
                for a, b in zip(ids, ids[1:]):
                    net.edge(a, b, modes=(resource,), kind="utility")
            corner = self.street.state["nodes"][block["streetCorners"][0]]
            block.setdefault("utilityNodes", {})[resource] = net.node(corner["x"], corner["y"], -1)
            for parcel_id in block["parcels"]:
                parcel = self.state["parcels"][parcel_id]
                p = self.walk.state["nodes"][parcel["entrance"]]
                nearest = min(corridor_points, key=lambda q: math.hypot(q[0]-p["x"], q[1]-p["y"]))
                entry = net.node(p["x"], p["y"], -1)
                net.edge(net.node(*nearest, -1), entry, modes=(resource,), kind="utility-connection")
                parcel.setdefault("utilityNodes", {})[resource] = entry

    def _bridge_piece(self, item, reach, other):
        """Bridges cross the loop radially between two loop cells, never along an inflow, tributary or outflow."""
        if other is None or reach["flow"] != "ring" or other["flow"] != "ring" or item["piece"][0] != "radial":
            return False
        return item["piece"][2] not in set(self.river_marks().values())

    def _riverside(self, block):
        """Promenades along this block's banks; bridges wherever both banks are now settled."""
        i, s = block["cell"]
        offset = VALUES["promenade_offset"]
        for item in self.pieces(i, s):
            water_cell = item["across"]
            if isinstance(water_cell, str) or not self.water(*water_cell):
                continue
            piece = item["piece"]
            points = self.piece_points(piece)
            if piece[0] == "arc":
                sign = 1 if item["side"] == "outer" else -1
                bank = [(r+sign*offset, t) for r, t in points]
            else:
                sign = -1 if item["side"] == "start" else 1
                bank = [(r, t+sign*side_ticks(r, t, offset)) for r, t in points]
            ids = [self.walk.node(*warp(r, t)) for r, t in bank]
            for a, b in zip(ids, ids[1:]):
                self._promenade(a, b)
            for end, (r, t) in ((ids[0], points[0]), (ids[-1], points[-1])):
                self._promenade(end, self.walk.node(*warp(r, t)))
            reach = self.water(*water_cell)
            for other_item in self.pieces(*water_cell):
                other_cell = other_item["across"]
                other = None if isinstance(other_cell, str) else self.water(*other_cell)
                if not self._bridge_piece(other_item, reach, other):
                    continue
                points = self.piece_points(other_item["piece"])
                ends = [warp(*points[0]), warp(*points[-1])]
                if not all(f"S:{x:.4f}:{y:.4f}:0" in self.street.state["nodes"] for x, y in ends):
                    continue
                first = "|".join(sorted((self.street.node(*ends[0]), self.street.node(*warp(*points[1])))))
                if first in self.street.state["edges"]:
                    continue
                nodes = self._street_piece(other_item["piece"], [water_cell, other_cell], kind="bridge")
                er, et = frame(*points[len(points)//2])
                flow = et if reach["flow"] == "ring" else er
                for a, b in zip(nodes, nodes[1:]):
                    edge = self.street.state["edges"]["|".join(sorted((a, b)))]
                    edge["crossesWater"] = reach["reach"]
                    edge["crossingTick"] = other_item["piece"][2]
                    edge["flowBearing"] = math.atan2(flow[1], flow[0])
                # Bridge sidewalks pass through each promenade crossing point.
                if other_item["piece"][0] == "radial":
                    r0, r1 = points[0][0], points[-1][0]
                    walk_points = [(r, points[0][1]) for r in sorted({r for r, _ in points} | {r0+offset, r1-offset})]
                else:
                    r, a, b = points[0][0], points[0][1], points[-1][1]
                    walk_points = [(r, t) for t in sorted({t for _, t in points} | {a+side_ticks(r, a, offset), b-side_ticks(r, b, offset)})]
                ids = [self.walk.node(*warp(r, t)) for r, t in walk_points]
                for a, b in zip(ids, ids[1:]):
                    self.walk.edge(a, b, kind="bridge-sidewalk", width=VALUES["sidewalk_width"])
                self.emit("bridgeBuilt", block=block["id"], reach=reach["reach"], reason="Both banks settled; crossing square to the flow away from turns")

    def _promenade(self, a, b):
        """Riverside paths that meet on the same level join at a shared node instead of crossing."""
        nodes = self.walk.state["nodes"]
        p, q = nodes[a], nodes[b]
        self.walk._index()
        cells = self.walk._cells(p, q)
        found = set()
        for cell in cells:
            for key in self.walk._edge_cells.get(cell, ()):
                edge = self.walk.state["edges"].get(key)
                if not edge or edge["kind"] != "promenade" or {edge["a"], edge["b"]} & {a, b}:
                    continue
                r, s = nodes[edge["a"]], nodes[edge["b"]]
                d = (q["x"]-p["x"])*(s["y"]-r["y"])-(q["y"]-p["y"])*(s["x"]-r["x"])
                if abs(d) < 1e-9:
                    continue
                u = ((r["x"]-p["x"])*(s["y"]-r["y"])-(r["y"]-p["y"])*(s["x"]-r["x"]))/d
                v = ((r["x"]-p["x"])*(q["y"]-p["y"])-(r["y"]-p["y"])*(q["x"]-p["x"]))/d
                if 1e-6 < u < 1-1e-6 and 1e-6 < v < 1-1e-6:
                    found.add((p["x"]+u*(q["x"]-p["x"]), p["y"]+u*(q["y"]-p["y"]), key))
        # Route through the meeting points in order, even where a point snapped to a nearby node.
        ordered = sorted(found, key=lambda point: math.hypot(point[0]-p["x"], point[1]-p["y"]))
        chain = [a]
        for x, y, key in ordered:
            meeting = self.walk.node(x, y)
            edge = self.walk.state["edges"].get(key)
            if edge and meeting not in (edge["a"], edge["b"]):
                # The meeting point snapped to a nearby node: bend the crossed path through it.
                self.walk._split(key, meeting)
            chain.append(meeting)
        chain.append(b)
        chain = [n for index, n in enumerate(chain) if index == 0 or n != chain[index-1]]
        for first, second in zip(chain, chain[1:]):
            self.walk.edge(first, second, kind="promenade", width=4)

    def plan_wedges(self, class_sizes, project_sizes):
        """Split the circle into class wedges sized by sources, and each wedge into project sub-wedges.

        Order keeps established classes in the order they were founded; widths follow size**0.75
        with a minimum share, so large classes take broad wedges and small ones narrow slices.
        """
        known = [c for c in self.state.get("wedges", {}) if c in class_sizes]
        order = known+sorted((c for c in class_sizes if c not in known), key=lambda c: (c != "civic", -class_sizes[c], c))

        def split(start, total, names, sizes):
            mean = sum(sizes[m]**0.75 for m in names)/len(names)
            weights = {n: max(VALUES["wedge_min_share"]*mean, sizes[n]**0.75) for n in names}
            result, position = {}, start
            whole = sum(weights.values())
            for index, name in enumerate(names):
                width = start+total-position if index == len(names)-1 else int(total*weights[name]/whole)
                result[name] = [position % TICKS, (position+width) % TICKS]
                position += width
            return result

        if self.state.get("wedges") and self.state["blocks"]:
            from .partitions import extend
            wedges = extend(self, class_sizes)
        else:
            wedges = split(0, TICKS, order, class_sizes) if order else {}
        subs = {}
        for name, (start, end) in wedges.items():
            projects = project_sizes.get(name, {})
            names = sorted(projects, key=lambda n: (-projects[n], n))
            previous = self.state.get("subWedges", {}).get(name, {})
            subs[name] = previous if self.state["blocks"] else split(start, (end-start) % TICKS or TICKS, names, projects) if names else {}
        self.state["wedges"], self.state["subWedges"] = wedges, subs

    def allocate(self, source, tick, feasible=None, provision=None):
        """Score feasible infill first; record why adaptation or edge is needed."""
        district = source.get("sourceClass", source["district"])
        candidates = []
        rejected = 0
        quarter = own_neighbourhood(source)
        for key in self.vacant.get(district, set()):
            parcel = self.state["parcels"][key]
            block = self.state["blocks"][parcel["block"]]
            # A large project fills only its own blocks; small ones use the shared blocks of the class.
            if block.get("neighbourhood", "") != quarter:
                continue
            if feasible is not None and not feasible(parcel):
                rejected += 1
                continue
            semantic = sum(self.state["parcels"][p]["source"] is not None and self.state["parcels"][p]["project"] == source.get("project") for p in block["parcels"])
            # Important sources (classes, hubs, well-linked notes) take the plots nearest the square.
            importance = (2 if source.get("kind") in ("class", "hub", "org") else 0)+min(source.get("degree", 0), 20)/10
            score = semantic*VALUES["semantic_weight"]-math.hypot(block["x"], block["y"])*VALUES["distance_weight"]*(1+importance*VALUES["importance_weight"])
            candidates.append((-score, stable_hash(source["stableId"]+key), key))
        phases = [{"phase": "infill", "feasible": len(candidates), "rejectedByAccessOrCapacity":rejected}]
        new_block = False
        if not candidates:
            phases.append({"phase": "adaptation", "feasible": 0, "reason": "Occupied, missing-source and protected parcels cannot be converted; no unused shell"})
            phase = "edge" if district in self.state["centres"] else "new-centre"
            if phase == "new-centre":
                phases.append({"phase":"edge","feasible":0,"reason":"This class has no established centre yet"})
            block = self._new_block(source, tick)
            if provision is not None:
                provision(block["id"])
            phases.append({"phase": phase, "feasible": 1, "block": block["id"]})
            new_block = True
            candidates = [(math.hypot(self.state["parcels"][key]["footprint"]["cx"], self.state["parcels"][key]["footprint"]["cy"]) if source.get("cityRole") in ("town-hall", "district-hall") else 0, stable_hash(source["stableId"]+key), key) for key in self.vacant[district]
                          if self.state["blocks"][self.state["parcels"][key]["block"]].get("neighbourhood", "") == quarter
                          and (feasible is None or feasible(self.state["parcels"][key]))]
            if not candidates:
                raise ValueError("New block cannot provide the requested access and capacity")
        else:
            phase = "infill"
        candidates.sort()
        key = candidates[0][2]
        parcel = self.state["parcels"][key]
        parcel.update(source=source["stableId"], project=source.get("project"), state="reserved", reservedAt=tick)
        self.vacant[district].remove(key)
        self.emit("parcelReserved", source=source["stableId"], parcel=key, strategy=phase,
                  candidates=[{"parcel": c[2], "score": -c[0]} for c in candidates[:VALUES["candidate_limit"]]],
                  considered=phases, reason="Feasible access and protected land checked before stable semantic/compactness scoring")
        return parcel, new_block
