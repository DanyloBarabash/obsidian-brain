"""Explicit fictional scenario parameters, in new logical metres and ticks."""

import hashlib


def parameter(value, unit, reason):
    """Describe a tunable assumption without claiming a real-world standard."""
    return {"value": value, "unit": unit, "status": "scenario-assumption",
            "origin": "Brain City calm-knowledge-city-v1", "reason": reason}


PARAMETERS = {
    "library_collection_capacity": parameter(48, "source records/library wing", "Bounded shared catalogue; new wings also require supplied parcels"),
    "library_floors": parameter(4, "storeys/library wing", "Recognisable maintained reading hall without unbounded height"),
    "precinct_capacity": parameter(3, "resident seats/place", "Small groups at themed outdoor places, without inventing inhabitants"),
    "precinct_cost": parameter(3, "model development credits/place", "Outdoor furniture and access have a finite cost"),
    "landmark_sites": parameter({"sports":[165,125],"science":[115,95],"energy":[85,65]}, "[length, width] logical metres", "Dedicated scenario estates; sports site contains a 105 by 68 metre field plus stands and concourse"),
    "landmark_site_cost": parameter(20, "model development credits/estate", "Finite cost for dedicated land and pedestrian access"),
    "project_landmark_sites": parameter({"swimming-pool":[44,34],"football-centre":[125,88],"velodrome":[80,50],"medical-centre":[50,40],"concert-hall":[48,36]}, "[length, width] logical metres", "Scenario project estates: pool includes a 25 metre basin and decks; other sites reserve distinct thematic forms"),
    "landmark_site_margin": parameter(8, "logical metres", "Reserve approach and circulation outside each landmark envelope"),
    "annex_site": parameter([40,30], "[length, width] logical metres", "Scenario project bay built into its cluster landmark complex, unless the subject names its own site"),
    "annex_gap": parameter(4, "logical metres", "Service gap between neighbouring bays of one landmark complex"),
    "annex_step": parameter(10, "logical metres", "Search step for the next free bay along the complex front"),
    "annex_reach": parameter(360, "logical metres", "Furthest bay from the landmark edge before the complex stops growing"),
    "landmark_pull": parameter(2.0, "score units", "District blocks prefer land around their landmark complex, so the quarter grows around it"),
    "landmark_pull_reach": parameter(320, "logical metres", "Cells within this distance of the complex edge feel its pull"),
    "market_hall_sizes": parameter([[34,22],[32,20],[30,18],[28,17],[26,16],[24,15],[20,12]], "[length, width] logical metres, largest first", "Covered article market on the civic square: the largest hall that fits between the square's paths"),
    "civic_hall_size": parameter([26,14], "[length, width] logical metres", "A dedicated European-inspired civic hall that fits between existing square approaches"),
    "apartments_per_house": parameter(8, "source apartments/house", "Bound historical session density within one exact project"),
    "apartment_floors": parameter(6, "storeys", "A shared session tower, independent of text length"),
    "apartment_unit_cost": parameter(2, "model development credits/apartment", "An additional source uses the existing building envelope"),
    "tick_ms": parameter(200, "logical milliseconds/tick", "Five fixed updates per second, independent of rendering"),
    "day_seconds": parameter(600, "logical seconds/activity day", "Compressed fictional day, not a calendar forecast"),
    "carriage_width": parameter(8, "logical metres", "Calm shared local street; not a construction code"),
    "sidewalk_width": parameter(3, "logical metres/side", "Reserved walking and crossing space"),
    "frontage": parameter(14, "logical metres", "Suburban plot unit along the street"),
    "old_town_frontage": parameter(8, "logical metres", "Plot unit inside the wall line; medieval plots about 6-7 m"),
    "old_town_gap": parameter(0.3, "logical metres", "Near-continuous street facades in the old town"),
    "plot_width_steps": parameter([0.75,1,1.25,1.5], "multiples of the plot unit", "Plot widths differ by quarter units"),
    "house_margin": parameter(1.5, "logical metres per side", "Suburban houses stand free inside their plots"),
    "corridor_margin": parameter(1.06, "factor", "Plan-to-world stretch allowance on street corridors"),
    "historic_swing": parameter(0.15, "fraction of the mean angle between historic radials", "Historic roads leave the square at uneven angles"),
    "street_continuation": parameter(15, "logical metres", "A new cut this close to an inner street continues it"),
    "sector_jitter": parameter(0.3, "fraction of mean sector width", "Uneven block widths within a ring"),
    "cohesion_weight": parameter(1.0, "score units per neighbouring block", "Quarters of one class stay together"),
    "wedge_weight": parameter(0.03, "score units per metre outside the class wedge", "Classes grow as radial wedges from the square"),
    "class_boundary_penalty": parameter(1000000, "score units/outside class wedge", "Prefer any feasible connected block inside the fixed class boundary"),
    "project_boundary_penalty": parameter(10000, "score units/outside project wedge", "Prefer a connected project's sub-wedge after the class boundary"),
    "sub_wedge_weight": parameter(0.012, "score units per metre outside the project sub-wedge", "Projects grow as narrower wedges inside their class"),
    "wedge_min_share": parameter(0.5, "fraction of the mean weight", "Small classes retain a plot-bearing slice beside the core"),
    "importance_weight": parameter(0.5, "factor per importance point", "Important sources prefer plots near the square"),
    "neighbourhood_min_sources": parameter(8, "sources", "A project this large gets its own sub-quarter of blocks"),
    "neighbourhood_weight": parameter(1.5, "score units per neighbouring block of the same project", "Sub-quarters of one project stay together"),
    "river_meander": parameter([15,160], "[amplitude m, wavelength m]", "Sinuous radial reaches inside their protected corridor"),
    "parcel_depth": parameter(16, "logical metres", "Room for a bounded footprint and entrance"),
    "footprint_depth": parameter(12, "logical metres", "Preserve room for approach and greenery"),
    "candidate_limit": parameter(128, "feasible block candidates/decision", "Bound deterministic planning effort"),
    "max_floors": parameter(6, "storeys", "Bounded ordinary envelope; no unlimited word-count towers"),
    "floor_word_octaves": parameter(5, "word-count doublings/additional storey", "Bound text-driven visual density"),
    "floor_degree_links": parameter(12, "links/additional storey", "Bound connection-driven visual density"),
    "additional_floor_load": parameter(0.25, "model resource units/activity day/additional storey", "Higher envelopes need a local service allowance"),
    "renovation_cost": parameter(4, "model development credits/additional storey", "Adaptation consumes finite credits"),
    "era_days": parameter(50, "activity days/architectural era", "Persistent visual cohorts, not file modification dates"),
    "floor_height": parameter(3, "logical metres/storey", "Fictional scene height"),
    "level_height": parameter(5, "logical metres/network level", "Explicit bridge and ramp separation"),
    "construction_ticks": parameter(25, "ticks/stage", "Visible reserved, connected, construction, open phases"),
    "credit_per_source": parameter(100, "model development credits/source", "Finite demand-backed construction budget"),
    "building_cost": parameter(10, "model development credits/building", "A building has a tracked cost"),
    "block_cost": parameter(30, "model development credits/block", "Roads, common services and local utility provision"),
    "service_capacity": parameter(8, "simultaneous visits/service", "Finite shared amenities per block"),
    "visit_seconds": parameter(20, "logical seconds/visit", "Meaningful dwell rather than immediate ping-pong"),
    "retry_seconds": parameter(8, "logical seconds", "Explainable waits for capacity, opening or access"),
    "walk_min": parameter(0.9, "logical metres/second", "Fictional resident pace, not inferred personal data"),
    "walk_max": parameter(1.6, "logical metres/second", "Deterministic variation between knowledge residents"),
    "energy_per_home": parameter(1, "model energy units/activity day", "Separate electricity balance"),
    "water_per_home": parameter(1, "model water units/activity day", "Separate water balance"),
    "waste_per_home": parameter(1, "model waste units/activity day", "Separate waste generation and collection"),
    "maintenance_per_home": parameter(1, "model maintenance units/activity day", "Explicit maintenance budget"),
    "utility_capacity": parameter(12, "model units/activity day/block/resource", "Finite local service envelope for eight homes"),
    "transit_threshold": parameter(180, "logical metres/walk", "Consider transit for longer trips"),
    "transit_demand": parameter(3, "distinct requesting residents", "Do not create a decorative bus without demand"),
    "transit_capacity": parameter(6, "seats/vehicle", "Boarding cannot exceed seats"),
    "transit_speed": parameter(8, "logical metres/second", "Fictional calm service speed"),
    "transit_headway": parameter(30, "logical seconds", "A real schedule with boarding waits"),
    "transit_residents_per_bus": parameter(40, "residents of a district/vehicle", "One shuttle per forty residents: a calm service, not a bus on every block pair"),
    "transit_review": parameter(60, "logical seconds", "How often lines are matched to the district allowance"),
    "tree_maturity_days": parameter(30, "activity days", "Preserved plantedAt gives gradual growth"),
    "live_route_nodes": parameter(8, "route nodes per visible resident", "Enough path for the client to animate until the next refresh"),
    "visible_agents": parameter(300, "maximum rendered residents", "Rendering budget does not change simulated population"),
    "regional_distance": parameter(1200, "logical metres", "Remote centres can form a connected satellite city"),
    "semantic_weight": parameter(4, "score units/shared-project neighbour", "Prefer related sources without claiming an urban law"),
    "distance_weight": parameter(0.01, "score units/logical metre", "Compactness and connection cost"),
    "weather_rain": parameter(0, "model rain units/tick", "Controlled scenario input, no automatic disasters"),
    "weather_heat": parameter(20, "model thermal units", "Stylised coverage comparison, not a real temperature forecast"),
    "weld_tolerance": parameter(0.5, "logical metres", "Same-level nodes closer than this must be one shared node"),
    "stroke_angle": parameter(45, "degrees", "Segments continue one visible street when deflection is at most this; research range 15-60"),
    "min_junction_angle": parameter(75, "degrees", "Street junctions close to right angles"),
    "bridge_skew": parameter(15, "degrees from perpendicular", "Bridges cross the channel square to the flow"),
    "river_widths": parameter({"1":10,"2":18}, "logical metres by Strahler order", "Wider channel downstream of the confluence"),
    "promenade_offset": parameter(12, "logical metres from the street line", "Riverside path inside the protected corridor"),
    "riparian_buffer": parameter(15, "logical metres", "Minimum clear land between channel bank and promenade"),
    "plaza_radius": parameter(50, "logical metres", "Enclosed central square inside the first ring street"),
    "ring_depths": parameter([70,75,80,90,100,110], "logical metres per ring, last value repeats", "Old-town blocks shallower than suburbs"),
    "first_ring_sectors": parameter(6, "historic radials", "Radial roads from the square that run through every ring"),
    "max_block_arc": parameter(140, "logical metres", "A sector halves when its outer arc would exceed this; research block range 60-140"),
    "min_block_arc": parameter(60, "logical metres", "Sectors halve only if the halves keep at least this inner arc"),
    "sector_phase": parameter(15, "degrees", "Rotation of the radial pattern; no street on the screen axes"),
    "wall_ring": parameter(3, "ring circle index", "Boulevard on the former wall line between ring 2 and ring 3"),
    "river_ring": parameter(3, "ring index", "Reserved valley band beside the old town; the river uses only an open bend"),
    "river_route": parameter({"inflow":0,"outflow":2}, "historic radial indices", "Open valley course through one side of town; independent of the legacy reserved terrain radials"),
    "river_bend_relief": parameter(8, "logical metres", "Asymmetric channel variation within the existing 80 m protected valley; zero slope at bridge crossings"),
    "river_turn_radius": parameter(20, "logical metres", "Round the valley entry and exit inside the protected bend cells"),
    "river_angles": parameter({"inflow":0,"tributary":2,"outflow":4}, "first-ring boundary indices", "Legacy terrain subdivisions retained for stable streets and homes; active channel endpoints use river_route"),
    "arc_segment": parameter(24, "logical metres", "Maximum straight piece of a curved street"),
    "ring_wobbles": parameter([[3,0.02,1.3,900],[5,0.01,0.4,600],[7,0.005,2.1,400]], "[lobes, fraction of radius, phase rad, radial wavelength m]", "Multi-scale irregular rings; summed slope keeps junctions above 75 degrees"),
    "radial_sway": parameter(0.1, "radians", "Bounded bend of radial streets; keeps junctions near right angles"),
    "sway_wavelength": parameter(260, "logical metres", "Length scale of radial bends"),
    "parcel_clearance": parameter(1.5, "logical metres", "Gap between neighbouring parcels"),
    "passage_width": parameter(6, "logical metres", "Courtyard passage left free in the middle of each block face"),
    "courtyard_tree_offset": parameter(7, "logical metres", "Courtyard trees clear of the cross paths"),
    "service_offset": parameter(13, "logical metres", "Courtyard market and library either side of the centre"),
    "boulevard_tree_spacing": parameter(24, "logical metres", "Allee on the boulevard median"),
    "orientation_min_blocks": parameter(12, "blocks", "Orientation order is measured once the town has a full ring of blocks"),
    "orientation_order_max": parameter(0.2, "Boeing orientation-order", "Far from a single grid (grid = 1)"),
    "day_start_hour": parameter(8, "hour of the compressed day at tick 0", "A new city opens in the morning, not at midnight"),
    "activity_hours": parameter({"library":[8,20],"market":[6,22],"park":[0,24],"work":[8,20]}, "hours of compressed 24-hour activity cycle", "Fictional daily service availability"),
}
VALUES = {key: record["value"] for key, record in PARAMETERS.items()}
STREET_PROFILES = {
    "pedestrian": {"width": 4, "sidewalk": 0, "modes": ["walk"], "level": 0},
    "shared-local": {"width": 8, "sidewalk": 3, "modes": ["walk", "cycle", "service"], "level": 0},
    "district": {"width": 10, "sidewalk": 3, "modes": ["cycle", "service", "transit"], "level": 0},
    "boulevard": {"width": 14, "sidewalk": 4, "modes": ["cycle", "service", "transit"], "level": 0},
}


def stable_hash(value):
    """Return the same integer across Python processes, seeds and save/load."""
    return int(hashlib.sha256(str(value).encode()).hexdigest()[:16], 16)


def rect(x, y, width, height):
    """Create an axis-aligned world-space rectangle."""
    return {"x": x, "y": y, "w": width, "h": height}


def overlaps(a, b, margin=0):
    """Test occupied area, allowing shared boundaries with zero margin."""
    return a["x"] < b["x"] + b["w"] + margin and a["x"] + a["w"] + margin > b["x"] and a["y"] < b["y"] + b["h"] + margin and a["y"] + a["h"] + margin > b["y"]


def segment_hits(a, b, box, padding=0):
    """Clip a segment against a rectangle, optionally expanding its envelope."""
    low, high = 0, 1
    for p, q in [(-(b[0]-a[0]), a[0]-box["x"]+padding),
                 (b[0]-a[0], box["x"]+box["w"]+padding-a[0]),
                 (-(b[1]-a[1]), a[1]-box["y"]+padding),
                 (b[1]-a[1], box["y"]+box["h"]+padding-a[1])]:
        if abs(p) < 1e-9:
            if q < 0:
                return False
            continue
        t = q/p
        if p < 0:
            low = max(low, t)
        else:
            high = min(high, t)
        if low > high:
            return False
    return True


def aabb(points):
    """Axis-aligned bounding rectangle of a polygon."""
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    return rect(min(xs), min(ys), max(xs)-min(xs), max(ys)-min(ys))


def _project(points, axis):
    values = [p[0]*axis[0]+p[1]*axis[1] for p in points]
    return min(values), max(values)


def _axes(points):
    count = len(points)
    for i in range(count):
        a, b = points[i], points[(i+1) % count]
        if a != b:
            yield (a[1]-b[1], b[0]-a[0])


def convex_overlap(first, second, margin=0):
    """Separating-axis test for convex polygons or segments; touching edges do not overlap."""
    for axis in list(_axes(first))+list(_axes(second)):
        length = (axis[0]**2+axis[1]**2)**0.5
        axis = (axis[0]/length, axis[1]/length)
        a, b = _project(first, axis), _project(second, axis)
        if a[1] <= b[0]-margin+1e-9 or b[1] <= a[0]-margin+1e-9:
            return False
    return True


def segment_distance(p, a, b):
    """Distance from point p to segment a-b."""
    dx, dy = b[0]-a[0], b[1]-a[1]
    t = max(0, min(1, ((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy or 1)))
    return ((a[0]+t*dx-p[0])**2+(a[1]+t*dy-p[1])**2)**0.5


def polygon_segment_distance(polygon, a, b):
    """Zero when the segment enters the convex polygon, else the closest gap."""
    if convex_overlap(polygon, [a, b]):
        return 0.0
    edges = list(zip(polygon, polygon[1:]+polygon[:1]))
    return min([segment_distance(a, p, q) for p, q in edges]+[segment_distance(b, p, q) for p, q in edges]+
               [segment_distance(p, a, b) for p in polygon])
