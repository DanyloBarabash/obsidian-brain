"""Dedicated landmark estates without displacing existing source buildings."""

from copy import deepcopy
import math

from .profile import VALUES, aabb, convex_overlap, polygon_segment_distance, rect
from .world import TICKS, neighbourhood, oriented_rect


def estate(model, topic, owner, size=None, quarter=""):
    """Find dry district-edge land and a clear link to its existing pedestrian network."""
    world = model.world
    width, depth = size or VALUES["landmark_sites"][topic]
    margin = VALUES["landmark_site_margin"]
    blocks = [b for b in world.state["blocks"].values() if b["district"] == topic and (not quarter or b.get("neighbourhood") == quarter)]
    if not blocks:
        return None
    low, high = world.state["wedges"][topic]
    if high <= low:
        high += TICKS
    outer = max(math.hypot(b["x"], b["y"])+math.hypot(b["envelope"]["w"], b["envelope"]["h"])/2 for b in blocks)
    forbidden = [p["polygon"] for p in world.state["parcels"].values()]
    for block in world.state["blocks"].values():
        b = block["envelope"]
        forbidden.append([[b["x"]-8,b["y"]-8],[b["x"]+b["w"]+8,b["y"]-8],[b["x"]+b["w"]+8,b["y"]+b["h"]+8],[b["x"]-8,b["y"]+b["h"]+8]])
    forbidden += [z.get("polygon") or [[z["box"]["x"],z["box"]["y"]],[z["box"]["x"]+z["box"]["w"],z["box"]["y"]],
                    [z["box"]["x"]+z["box"]["w"],z["box"]["y"]+z["box"]["h"]],[z["box"]["x"],z["box"]["y"]+z["box"]["h"]]] for z in world.state["protected"]]
    footprints = [b["footprint"]["polygon"] for b in model.state["buildings"].values()]
    footprints += [s["footprint"]["polygon"] for s in world.state["services"].values() if s.get("footprint")]
    rivers = world.rivers(margin=1200)
    river_segments = [(a,b,r["width"]/2+margin) for r in rivers for a,b in zip(r["points"],r["points"][1:])]
    def crosses_water(poly):
        box = aabb(poly)
        return any(polygon_segment_distance(poly,a,b)<clear for a,b,clear in river_segments
                   if max(a[0],b[0])+clear>=box["x"] and min(a[0],b[0])-clear<=box["x"]+box["w"]
                   and max(a[1],b[1])+clear>=box["y"] and min(a[1],b[1])-clear<=box["y"]+box["h"])
    block_ids = {b["id"] for b in blocks}
    entrances = {p["entrance"] for p in world.state["parcels"].values() if p["block"] in block_ids}
    boundary = set()
    for edge in world.walk.state["edges"].values():
        if edge["kind"] == "entrance-path" and (edge["a"] in entrances or edge["b"] in entrances):
            boundary.add(edge["b"] if edge["a"] in entrances else edge["a"])
    nodes = world.walk.state["nodes"]
    boundary.update(k for k,p in nodes.items() if any(abs(p["x"]-b["x"])<b["envelope"]["w"]/2+30 and abs(p["y"]-b["y"])<b["envelope"]["h"]/2+30 for b in blocks))
    def crosses_paths(a,b,target):
        for edge in world.walk.state["edges"].values():
            if target in (edge["a"],edge["b"]):
                continue
            r,s = nodes[edge["a"]],nodes[edge["b"]]
            dx,dy = b[0]-a[0],b[1]-a[1]
            ex,ey = s["x"]-r["x"],s["y"]-r["y"]
            det = dx*ey-dy*ex
            if abs(det)<1e-8:
                continue
            rx,ry = r["x"]-a[0],r["y"]-a[1]
            t,u = (rx*ey-ry*ex)/det,(rx*dy-ry*dx)/det
            if 1e-6<t<1-1e-6 and 1e-6<u<1-1e-6:
                return True
        return False
    for extra in range(0,401,40):
        for fraction in (.5,.4,.6,.3,.7,.2,.8):
            angle = (low+(high-low)*fraction)*2*math.pi/TICKS
            radial = (math.cos(angle),math.sin(angle))
            along = (-radial[1],radial[0])
            distance = outer+depth/2+margin*3+extra
            centre = (radial[0]*distance,radial[1]*distance)
            polygon,_ = oriented_rect(centre,along,radial,width+margin*2,depth+margin*2)
            ticks = [(math.atan2(y,x)%(2*math.pi))*TICKS/(2*math.pi) for x,y in polygon]
            ticks = [t+TICKS if t<low else t for t in ticks]
            if any(not low <= t <= high for t in ticks) or any(convex_overlap(polygon,p) for p in forbidden):
                continue
            if crosses_water(polygon):
                continue
            door = (centre[0]-radial[0]*(depth/2+margin),centre[1]-radial[1]*(depth/2+margin))
            nearest = sorted(boundary,key=lambda k:math.hypot(nodes[k]["x"]-door[0],nodes[k]["y"]-door[1]))[:64]
            for target in nearest:
                p = (nodes[target]["x"],nodes[target]["y"])
                length = math.hypot(p[0]-door[0],p[1]-door[1])
                if length<1:
                    continue
                along_path = ((p[0]-door[0])/length,(p[1]-door[1])/length)
                access,_ = oriented_rect(((p[0]+door[0])/2,(p[1]+door[1])/2),along_path,(-along_path[1],along_path[0]),length,4)
                if any(convex_overlap(access,q["polygon"]) for q in world.state["parcels"].values()):
                    continue
                if any(polygon_segment_distance(f,door,p)<1 for f in footprints):
                    continue
                if crosses_paths(door,p,target):
                    continue
                path = [list(door),list(p)]
                if crosses_water(path):
                    continue
                footprint,_ = oriented_rect(centre,along,radial,width,depth)
                block = min(blocks,key=lambda b:math.hypot(b["x"]-p[0],b["y"]-p[1]))
                return {"polygon":polygon,"footprint":{**aabb(footprint),"polygon":footprint,"cx":centre[0],"cy":centre[1],
                        "fw":width,"fd":depth,"angle":math.atan2(along[1],along[0])},"door":door,"target":target,"block":block["id"],"access":access}
    return None


def annex(model, parent, identity, size, project=None):
    """Reserve a bay of a cluster landmark complex for a project: same front line, joined to the landmark's gate.

    Bays alternate right and left of the estate and step outwards until one is dry and clear; the complex grows with
    every bay. Returns the new parcel or None when no bay fits within `annex_reach`.
    """
    world = model.world
    f = world.state["parcels"][parent["parcel"]]["footprint"]
    margin, gap = VALUES["landmark_site_margin"], VALUES["annex_gap"]
    along = (math.cos(f["angle"]), math.sin(f["angle"]))
    radial = (along[1], -along[0])
    width, depth = size
    centre = (f["cx"], f["cy"])
    gate_point = (centre[0]-radial[0]*(f["fd"]/2+margin), centre[1]-radial[1]*(f["fd"]/2+margin))
    own = {parent["parcel"]}|{p["id"] for p in world.state["parcels"].values() if p.get("annexOf") == parent["id"]}
    forbidden = [p["polygon"] for p in world.state["parcels"].values()]
    for block in world.state["blocks"].values():
        b = block["envelope"]
        forbidden.append([[b["x"]-8,b["y"]-8],[b["x"]+b["w"]+8,b["y"]-8],[b["x"]+b["w"]+8,b["y"]+b["h"]+8],[b["x"]-8,b["y"]+b["h"]+8]])
    forbidden += [z["polygon"] for z in world.state["protected"] if z.get("polygon") and z.get("parcel") not in own]
    footprints = [b["footprint"]["polygon"] for b in model.state["buildings"].values()]
    footprints += [p["polygon"] for p in world.state["parcels"].values() if p["id"] not in own]
    rivers = world.rivers(margin=1200)
    segments = [(a,b,r["width"]/2+margin) for r in rivers for a,b in zip(r["points"],r["points"][1:])]
    wet = lambda poly: any(polygon_segment_distance(poly,a,b)<clear for a,b,clear in segments)
    for step in range(0, VALUES["annex_reach"]+1, VALUES["annex_step"]):
        for side in (1, -1):
            offset = side*(f["fw"]/2+margin*2+gap+step+width/2)
            middle = (centre[0]+along[0]*offset+radial[0]*(depth-f["fd"])/2, centre[1]+along[1]*offset+radial[1]*(depth-f["fd"])/2)
            polygon,_ = oriented_rect(middle,along,radial,width+margin*2,depth+margin*2)
            if any(convex_overlap(polygon,q) for q in forbidden) or wet(polygon):
                continue
            door = (middle[0]-radial[0]*(depth/2+margin), middle[1]-radial[1]*(depth/2+margin))
            if any(polygon_segment_distance(q,door,gate_point)<1 for q in footprints) or wet([list(door),list(gate_point)]):
                continue
            footprint,_ = oriented_rect(middle,along,radial,width,depth)
            gate = world.walk.node(*gate_point)
            entry = world.walk.node(*door)
            world.walk.edge(entry,gate,kind="public-path",width=4)
            length = math.hypot(middle[0]-door[0],middle[1]-door[1])
            entrance = world.walk.node(*(door[i]+(middle[i]-door[i])*margin/length for i in (0,1)))
            world.walk.edge(entry,entrance,kind="entrance-path",width=4)
            key = "annex:"+identity
            parcel = {"id":key,"block":parent["block"],"district":parent["district"],"box":aabb(polygon),"polygon":polygon,
                      "footprint":{**aabb(footprint),"polygon":footprint,"cx":middle[0],"cy":middle[1],"fw":width,"fd":depth,"angle":f["angle"]},
                      "entrance":entrance,"frontage":width,"face":"annex","source":None,"state":"facility","protected":True,
                      "facility":identity,"annexOf":parent["id"],"createdAt":model.clock["tick"],"project":project}
            world.state["parcels"][key] = parcel
            world.state["blocks"][parent["block"]]["parcels"].append(key)
            world.state["protected"].append({"id":key,"parcel":key,"box":parcel["box"],"polygon":polygon,"reason":"Project bay of a landmark complex"})
            land = world.state["land"]
            box = parcel["box"]
            x,y = min(land["x"],box["x"]-30),min(land["y"],box["y"]-30)
            world.state["land"] = rect(x,y,max(land["x"]+land["w"],box["x"]+box["w"]+30)-x,max(land["y"]+land["h"],box["y"]+box["h"]+30)-y)
            return parcel
    return None


def protect_access(model, service):
    """Retain existing public approaches, including clear garden-strip easements."""
    world = model.world
    key = service["parcel"]+":access"
    if any(z["id"] == key for z in world.state["protected"]):
        return
    edges,nodes = world.walk.state["edges"],world.walk.state["nodes"]
    gate = next((e["b"] if e["a"]==service["entrance"] else e["a"] for e in edges.values()
                 if e["kind"]=="entrance-path" and service["entrance"] in (e["a"],e["b"])),None)
    if gate is None:
        return
    for edge in edges.values():
        if edge["kind"]!="public-path" or gate not in (edge["a"],edge["b"]):
            continue
        a,b = nodes[edge["a"]],nodes[edge["b"]]
        length = math.hypot(b["x"]-a["x"],b["y"]-a["y"])
        along = ((b["x"]-a["x"])/length,(b["y"]-a["y"])/length)
        poly,_ = oriented_rect(((a["x"]+b["x"])/2,(a["y"]+b["y"])/2),along,(-along[1],along[0]),length,4)
        easements = [p["id"] for p in world.state["parcels"].values() if p["id"]!=service["parcel"] and convex_overlap(poly,p["polygon"]) and not convex_overlap(poly,p["footprint"]["polygon"])]
        world.state["protected"].append({"id":key,"parcel":service["parcel"],"box":aabb(poly),"polygon":poly,"easements":easements,"reason":"Preserve the existing public approach; buildings retain their envelopes"})
        model.emit("landmarkApproachProtected",facility=service["id"],reason="Public approach reserved before further district growth")
        return


def upgrade(model, service):
    """Replace a miniature amenity with an idempotent, protected full-size estate."""
    topic = service["district"]
    if service.get("siteVersion") == 1:
        protect_access(model,service)
        return False
    if topic not in VALUES["landmark_sites"] and not service.get("siteSize"):
        return False
    if service.get("estateAttemptedSources") == len(model.state["sources"]):
        return False
    cost = VALUES["landmark_site_cost"]
    if model.state["budget"]["available"] < cost:
        return False
    service["estateAttemptedSources"] = len(model.state["sources"])
    site = estate(model,topic,service["owner"],service.get("siteSize"),service.get("quarter", ""))
    owner = model.state["sources"][service["owner"]]
    for _ in range(6):
        if site is not None or model.state["budget"]["available"] < cost+VALUES["block_cost"]:
            break
        group = neighbourhood(owner.get("project"))
        count = sum(s["available"] and s["class"] == topic and neighbourhood(s.get("project")) == group for s in model.state["sources"].values())
        source = {**owner,"district":topic,"sourceClass":topic,"stableId":owner["id"],"neighbourhoodSize":count}
        try:
            block = model.world._new_block(source,model.clock["tick"])
        except ValueError:
            break
        model.economy.provision(block["id"])
        model.state["budget"]["available"] -= VALUES["block_cost"]
        model.state["budget"]["spent"] += VALUES["block_cost"]
        model.emit("landmarkApproachExtended",facility=service["id"],block=block["id"],reason="Demand for a full-size estate needs a connected district approach, including protected river crossings")
        site = estate(model,topic,service["owner"],service.get("siteSize"),service.get("quarter", ""))
    if site is None:
        return False
    world = model.world
    old = world.state["parcels"][service["parcel"]]
    old.update(protected=False,state="vacant")
    old.pop("facility",None)
    world.vacant.setdefault(topic,set()).add(old["id"])
    key = "estate:"+(service["id"] if service.get("project") else topic)
    gate = world.walk.node(*site["door"])
    world.walk.edge(gate,site["target"],kind="public-path",width=4)
    f = site["footprint"]
    centre = (f["cx"],f["cy"])
    length = math.hypot(centre[0]-site["door"][0],centre[1]-site["door"][1])
    entrance = world.walk.node(*(site["door"][i]+(centre[i]-site["door"][i])*VALUES["landmark_site_margin"]/length for i in (0,1)))
    world.walk.edge(gate,entrance,kind="entrance-path",width=4)
    parcel = {"id":key,"block":site["block"],"district":topic,"box":aabb(site["polygon"]),"polygon":site["polygon"],
              "footprint":site["footprint"],"entrance":entrance,"frontage":site["footprint"]["fw"],"face":"estate",
              "source":None,"state":"facility","protected":True,"facility":service["id"],"createdAt":model.clock["tick"],"project":service.get("project")}
    world.state["parcels"][key] = parcel
    world.state["blocks"][site["block"]]["parcels"].append(key)
    world.state["protected"].append({"id":key,"parcel":key,"box":parcel["box"],"polygon":parcel["polygon"],"reason":"Dedicated thematic estate and approach"})
    world.state["protected"].append({"id":key+":access","parcel":key,"box":aabb(site["access"]),"polygon":site["access"],"reason":"Preserve the public approach when adjacent quarters grow"})
    box = parcel["box"]
    land = world.state["land"]
    x,y = min(land["x"],box["x"]-30),min(land["y"],box["y"]-30)
    world.state["land"] = rect(x,y,max(land["x"]+land["w"],box["x"]+box["w"]+30)-x,max(land["y"]+land["h"],box["y"]+box["h"]+30)-y)
    service.update(parcel=key,block=site["block"],footprint=deepcopy(site["footprint"]),entrance=entrance,siteVersion=1,
                   reason="Dedicated full-size landmark estate, clear pedestrian approach, no source displacement")
    for agent in model.state["residents"].values():
        if agent.get("goal") != service["id"]:
            continue
        route = agent.get("route")
        if route and agent["state"] in ("walking","waiting-route") and route["nodes"][-1] != entrance:
            tail = world.walk.route(route["nodes"][-1],entrance)
            if tail and not (agent.get("journey") or {}).get("leg") == "to-stop":
                agent["route"] = {**route,"nodes":route["nodes"]+tail["nodes"][1:],"edges":route["edges"]+tail["edges"],"length":route["length"]+tail["length"]}
        elif agent["state"] == "visiting":
            service["occupants"].remove(agent["id"])
            service["reservations"].append(agent["id"])
            model.activities._walk_to(agent,entrance)
    model.state["budget"]["available"] -= cost
    model.state["budget"]["spent"] += cost
    model.emit("landmarkEstateFounded",facility=service["id"],parcel=key,reason=service["reason"])
    return True


def town_hall(model):
    """Give the genuine global source a civic-square hall, retaining all other homes."""
    world = model.world
    pavilion = world.state["services"].get("plaza:town-hall")
    source = next((s for s in model.state["sources"].values() if s.get("cityRole")=="town-hall" and s["available"]),None)
    if not source or not pavilion or not pavilion.get("footprint"):
        return
    building = model.state["buildings"][source["id"]]
    if building.get("landmarkVersion") == 1 or model.state["budget"]["available"]<VALUES["landmark_site_cost"]:
        return
    width,depth = VALUES["civic_hall_size"]
    nodes = world.walk.state["nodes"]
    approaches = [e for e in world.walk.state["edges"].values() if e["kind"]=="plaza-path" and pavilion["entrance"] in (e["a"],e["b"])]
    angles = sorted(math.atan2(nodes[e["b"] if e["a"]==pavilion["entrance"] else e["a"]]["y"],nodes[e["b"] if e["a"]==pavilion["entrance"] else e["a"]]["x"])%(2*math.pi) for e in approaches)
    plaza = next(z for z in world.state["protected"] if z["id"]=="plaza")
    path_segments = [[[nodes[e["a"]]["x"],nodes[e["a"]]["y"]],[nodes[e["b"]]["x"],nodes[e["b"]]["y"]]] for e in world.walk.state["edges"].values()]
    found = None
    gaps = [(a,angles[(i+1)%len(angles)]+(2*math.pi if i==len(angles)-1 else 0)) for i,a in enumerate(angles)]
    candidates = [((a+b)/2,f) for a,b in sorted(gaps,key=lambda p:p[0]-p[1]) for f in (.64,.60,.68,.72)]
    for angle,fraction in candidates:
        inward = (-math.cos(angle),-math.sin(angle))
        along = (-inward[1],inward[0])
        centre = (-inward[0]*VALUES["plaza_radius"]*fraction,-inward[1]*VALUES["plaza_radius"]*fraction)
        polygon,_ = oriented_rect(centre,along,inward,width,depth)
        if any(convex_overlap(polygon,p) for p in path_segments):
            continue
        if any(polygon_segment_distance(polygon,a,b)<c["half"] for block in world.state["blocks"].values() for c in block["corridors"] for a,b in zip(c["points"],c["points"][1:])):
            continue
        if any(convex_overlap(polygon,v["footprint"]["polygon"]) for v in model.state["buildings"].values() if v["id"]!=building["id"]):
            continue
        found = centre,along,inward,polygon
        break
    if found is None:
        return
    centre,along,inward,polygon = found
    footprint = {**aabb(polygon),"polygon":polygon,"cx":centre[0],"cy":centre[1],"fw":width,"fd":depth,"angle":math.atan2(along[1],along[0])}
    key = "estate:town-hall"
    old = world.state["parcels"][building["parcel"]]
    old_entry = building["entrance"]
    entrance = world.walk.node(*(centre[i]+inward[i]*depth/2 for i in (0,1)))
    world.walk.edge(pavilion["entrance"],entrance,kind="entrance-path",width=5)
    from .migrations import pedestrian_junctions
    pedestrian_junctions(model.state,world.walk)
    parcel = {**deepcopy(old),"id":key,"polygon":polygon,"box":aabb(polygon),"footprint":footprint,"entrance":entrance,
              "protected":True,"state":"used","sources":[source["id"]],"facility":"town-hall"}
    old.update(source=None,sources=[],state="vacant",project=None)
    world.vacant.setdefault(old["district"],set()).add(old["id"])
    world.state["parcels"][key] = parcel
    world.state["blocks"][old["block"]]["parcels"].append(key)
    plaza.setdefault("civicParcels",[]).append(key)
    building.update(parcel=key,footprint=deepcopy(footprint),entrance=entrance,landmarkVersion=1)
    service = world.state["services"][building["id"]]
    service["entrance"] = entrance
    pavilion.update(footprint=None,function="civic-square")
    for agent in model.state["residents"].values():
        route = agent.get("route")
        if route and route["nodes"][-1] == old_entry:
            tail = world.walk.route(old_entry,entrance)
            agent["route"] = {**route,"nodes":route["nodes"]+tail["nodes"][1:],"edges":route["edges"]+tail["edges"],"length":route["length"]+tail["length"]}
        elif agent["node"]==old_entry and agent["state"]=="home" and agent["id"]==source["id"]:
            model.activities._walk_to(agent,entrance,returning=True)
        elif agent["node"]==old_entry and agent["state"]=="visiting" and agent.get("goal")==building["id"]:
            service["occupants"].remove(agent["id"])
            service["reservations"].append(agent["id"])
            model.activities._walk_to(agent,entrance)
    model.state["budget"]["available"] -= VALUES["landmark_site_cost"]
    model.state["budget"]["spent"] += VALUES["landmark_site_cost"]
    model.emit("civicHallRebuilt",source=source["id"],reason="Genuine global source moved to a dedicated hall on the civic square; ordinary homes preserved")


MARKET_SITE_VERSION = 3


def market_hall(model):
    """Open the covered article market on the civic square: the largest hall that fits a free gap between its paths.

    A market from an earlier, smaller rule is rebuilt in place of the new size once; its old entrance stays a stub.
    """
    world = model.world
    pavilion = world.state["services"].get("plaza:town-hall")
    existing = world.state["services"].get("plaza:market")
    if not pavilion or (existing and existing.get("siteVersion") == MARKET_SITE_VERSION):
        return None
    if not existing and model.state["budget"]["available"] < VALUES["landmark_site_cost"]:
        return None
    nodes = world.walk.state["nodes"]
    hub = pavilion["entrance"]
    approaches = [e for e in world.walk.state["edges"].values() if e["kind"]=="plaza-path" and hub in (e["a"],e["b"])]
    angles = sorted(math.atan2(nodes[e["b"] if e["a"]==hub else e["a"]]["y"],nodes[e["b"] if e["a"]==hub else e["a"]]["x"])%(2*math.pi) for e in approaches)
    if not angles:
        return None
    own = existing["entrance"] if existing else None
    path_segments = [[[nodes[e["a"]]["x"],nodes[e["a"]]["y"]],[nodes[e["b"]]["x"],nodes[e["b"]]["y"]]] for e in world.walk.state["edges"].values() if own not in (e["a"],e["b"])]
    bodies = [v["footprint"]["polygon"] for v in model.state["buildings"].values()]
    bodies += [s["footprint"]["polygon"] for k,s in world.state["services"].items() if s.get("footprint") and k != "plaza:market"]
    gaps = [(a,angles[(i+1)%len(angles)]+(2*math.pi if i==len(angles)-1 else 0)) for i,a in enumerate(angles)]
    sites = [((a+b)/2,f,size) for size in VALUES["market_hall_sizes"] for a,b in sorted(gaps,key=lambda p:p[0]-p[1]) for f in (.6,.64,.68,.72,.56,.52)]
    for angle,fraction,(width,depth) in sites:
        inward = (-math.cos(angle),-math.sin(angle))
        along = (-inward[1],inward[0])
        centre = (-inward[0]*VALUES["plaza_radius"]*fraction,-inward[1]*VALUES["plaza_radius"]*fraction)
        polygon,_ = oriented_rect(centre,along,inward,width,depth)
        if any(math.hypot(x,y) > VALUES["plaza_radius"] for x,y in polygon):
            continue
        if any(convex_overlap(polygon,p) for p in path_segments) or any(convex_overlap(polygon,p) for p in bodies):
            continue
        if any(polygon_segment_distance(polygon,a,b)<c["half"] for block in world.state["blocks"].values() for c in block["corridors"] for a,b in zip(c["points"],c["points"][1:])):
            continue
        entrance = world.walk.node(*(centre[i]+inward[i]*depth/2 for i in (0,1)))
        world.walk.edge(hub,entrance,kind="entrance-path",width=5)
        from .migrations import pedestrian_junctions
        pedestrian_junctions(model.state,world.walk)
        footprint = {**aabb(polygon),"polygon":polygon,"cx":centre[0],"cy":centre[1],"fw":width,"fd":depth,"angle":math.atan2(along[1],along[0])}
        service = {"id":"plaza:market","derived":True,"source":None,"owner":pavilion["owner"],"district":pavilion["district"],"block":pavilion["block"],
                   "function":"article-market","title":"Ринок статей","landmark":True,"publicMarket":True,"footprint":footprint,"entrance":entrance,
                   "capacity":VALUES["service_capacity"],"hours":list(VALUES["activity_hours"]["work"]),"enabled":True,
                   "occupants":[],"reservations":[],"queue":[],"state":"open","createdAt":model.clock["tick"],"siteVersion":MARKET_SITE_VERSION,
                   "reason":"The article market opens on the civic square; every quarter can visit it"}
        if existing:
            # Visitors keep their claims; anyone walking to the old door continues to the new one.
            for field in ("occupants","reservations","queue"):
                service[field] = existing[field]
            service["createdAt"] = existing["createdAt"]
            for agent in model.state["residents"].values():
                if agent.get("goal") == "plaza:market" and agent["state"] == "walking":
                    model.activities._walk_to(agent,entrance)
        else:
            model.state["budget"]["available"] -= VALUES["landmark_site_cost"]
            model.state["budget"]["spent"] += VALUES["landmark_site_cost"]
        world.state["services"]["plaza:market"] = service
        model.emit("marketHallOpened" if not existing else "marketHallEnlarged",facility="plaza:market",size=[width,depth],reason=service["reason"])
        return service
    return None
