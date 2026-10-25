"""Demand-backed outdoor places, physical seats and clear pedestrian access."""

import math

from .profile import VALUES, convex_overlap, stable_hash, polygon_segment_distance, aabb


PLACES = {
    "sports": [("training","Майданчик розминки"),("discussion","Площа вболівальників"),("reading","Тераса спортивного клубу")],
    "science": [("reading","Читальний сад кампусу"),("discussion","Університетський семінар"),("experiment","Наукова експозиція")],
    "technology": [("experiment","Двір винахідників"),("discussion","Технологічний форум"),("reading","Відкрита медіатека")],
    "energy": [("discussion","Тераса енергетиків"),("maintenance","Демонстраційний енергодвір"),("experiment","Лабораторія енергії просто неба")],
    "media": [("filming","Знімальний дворик"),("discussion","Редакційна тераса"),("reading","Медіабібліотека")],
    "games": [("play","Двір настільних ігор"),("rehearsal","Мала відкрита сцена"),("discussion","Клуб творчості")],
    "civic": [("reading","Міський читальний куточок"),("meeting","Місце зустрічей на площі"),("discussion","Відкрита громадська тераса")],
}


def frame(footprint):
    """Match the renderer's folded architectural frame in logical metres."""
    angle = footprint["angle"]
    turns = math.floor(angle/(math.pi/2)+.5)
    angle -= turns*math.pi/2
    w,d = footprint["fw"],footprint["fd"]
    if turns%2:
        w,d = d,w
    def point(u,v):
        x,y = (u-.5)*w,(v-.5)*d
        return (footprint["cx"]+x*math.cos(angle)-y*math.sin(angle),footprint["cy"]+x*math.sin(angle)+y*math.cos(angle))
    return point,w,d


def clear(model, segments, parent):
    """Keep new walks out of source buildings and join existing paths only at nodes."""
    world = model.world
    bodies = [b["footprint"]["polygon"] for b in model.state["buildings"].values()]
    bodies += [s["footprint"]["polygon"] for s in world.state["services"].values() if s.get("footprint") and s["id"]!=parent["id"]]
    if parent.get("function")=="campus" and parent.get("siteVersion"):
        point,_,_ = frame(parent["footprint"])
        for u,v,w,d in [(5,5,105,17),(5,22,18,65),(88,22,22,46),(71,73,39,17),(32,76,16,14),(57,76,16,14)]:
            bodies.append([list(point(x/115,y/95)) for x,y in [(u,v),(u+w,v),(u+w,v+d),(u,v+d)]])
    nodes = world.walk.state["nodes"]
    for a,b in segments:
        if math.dist(a,b)<.01:
            continue
        if any(convex_overlap(p,[list(a),list(b)]) for p in bodies):
            return False
        for river in world.rivers():
            if any(polygon_segment_distance([list(a),list(b)],c,d)<river["width"]/2 for c,d in zip(river["points"],river["points"][1:])):
                return False
        for e in world.walk.state["edges"].values():
            c,d = nodes[e["a"]],nodes[e["b"]]
            dx,dy,ex,ey = b[0]-a[0],b[1]-a[1],d["x"]-c["x"],d["y"]-c["y"]
            det = dx*ey-dy*ex
            if abs(det)<1e-7:
                continue
            rx,ry = c["x"]-a[0],c["y"]-a[1]
            t,u = (rx*ey-ry*ex)/det,(rx*dy-ry*dx)/det
            if -1e-6<=t<=1+1e-6 and 1e-6<u<1-1e-6:
                return False
    return True


def campus_plan(model, parent):
    """Reach the university quad through the gap between its gate pavilions."""
    world = model.world
    point,w,d = frame(parent["footprint"])
    gate = next((t for t,_,e in world.walk.adjacency().get(parent["entrance"],[]) if e["kind"]=="entrance-path"),parent["entrance"])
    start = world.walk.state["nodes"][gate]
    # The existing approach meets the outer estate boundary; walk around its perimeter to the front gate.
    corners = [point(-8/w,-8/d),point(1+8/w,-8/d),point(1+8/w,1+8/d),point(-8/w,1+8/d)]
    start_point = (start["x"],start["y"])
    front = point(.46,1+8/d)
    alternatives = []
    for i in range(4):
        for direction in (-1,1):
            route = [start_point]+[corners[(i+direction*k)%4] for k in range(4)]+[front,point(.46,.8),point(.46,.69),point(.46,.60)]
            for count in range(5):
                path = [start_point]+route[1:1+count]+route[-4:]
                segments = list(zip(path,path[1:]))
                if clear(model,segments,parent):
                    alternatives.append((sum(math.dist(a,b) for a,b in segments),path))
    if not alternatives:
        return None
    path = min(alternatives,key=lambda p:p[0])[1]
    targets = [(point(.35,.60),point(.46,.60)),(point(.62,.60),point(.46,.60)),(point(.35,.69),point(.46,.69))]
    return path,targets


def plan(model, topic, parent):
    """Place small commons on the forecourt or the district's protected public garden."""
    world = model.world
    entrance = world.walk.state["nodes"][parent["entrance"]]
    origin = (entrance["x"],entrance["y"])
    if topic=="science" and parent.get("siteVersion"):
        return campus_plan(model,parent)
    if (parent.get("footprint") or {}).get("angle") is not None:
        f = parent["footprint"]
        gate = next((t for t,_,e in world.walk.adjacency().get(parent["entrance"],[]) if e["kind"]=="entrance-path"),parent["entrance"])
        entry = world.walk.state["nodes"][gate]
        origin = (entry["x"],entry["y"])
        length = math.hypot(origin[0]-f["cx"],origin[1]-f["cy"]) or 1
        out = ((origin[0]-f["cx"])/length,(origin[1]-f["cy"])/length)
        along = (-out[1],out[0])
        spread = min(6,f["fw"]*.15)
        targets = []
        for offset in (-spread,0,spread):
            anchor = (origin[0]+out[0]*2,origin[1]+out[1]*2)
            target = (anchor[0]+along[0]*offset+out[0]*2,anchor[1]+along[1]*offset+out[1]*2)
            targets.append((target,anchor))
        return [origin,targets[0][1]],targets
    # Small thematic districts use the existing park instead of blocking a tiny service plot.
    seed = stable_hash(topic)
    targets = []
    for i in range(3):
        a=(seed%31/31+i*2*math.pi/3)
        targets.append(((origin[0]+math.cos(a)*3.8,origin[1]+math.sin(a)*3.8),origin))
    return [origin],targets


def planning_key(model):
    """Only feasibility inputs invalidate attempts; time, text and visitor claims do not."""
    world = model.world
    demand = {}
    for source in model.state['sources'].values():
        if source['available']:
            topic = source['class']
            demand[topic] = demand.get(topic,0)+1
    return {'version':1,'walk':world.walk.state['revision'],'street':world.street.state['revision'],
            'parcels':len(world.state['parcels']),'protected':len(world.state['protected']),
            'services':len(world.state['services']),'buildings':len(model.state['buildings']),
            'budget':model.state['budget']['available'],'demand':demand}


def sync(model):
    """Add each themed commons once, keeping seats, source counts and later geometry stable."""
    world = model.world
    key = planning_key(model)
    if world.state.get('precinctPlanning') == key:
        return
    for topic,definitions in PLACES.items():
        if all("place:"+topic+":"+str(i) in world.state["services"] for i in range(3)):
            continue
        parent = world.state["services"].get("facility:"+topic)
        if topic=="civic":
            parent=next((s for s in world.state["services"].values() if s.get("source") in model.state["sources"] and model.state["sources"][s["source"]].get("cityRole")=="town-hall"),None)
            if parent:
                parent={**parent,"footprint":model.state["buildings"][parent["source"]]["footprint"]}
        elif topic in ("technology","media","games") and parent:
            parent=world.state["services"].get(parent["block"]+":park",parent)
        if not parent or not any(s["available"] and s["class"]==topic for s in model.state["sources"].values()):
            continue
        result = plan(model,topic,parent)
        if result is None:
            continue
        path,targets = result
        base = list(zip(path,path[1:]))
        if not clear(model,base,parent):
            continue
        accepted=[]
        for i,((activity,title),(target,anchor)) in enumerate(zip(definitions,targets)):
            key="place:"+topic+":"+str(i)
            if key in world.state["services"] or model.state["budget"]["available"]<VALUES["precinct_cost"]*(len(accepted)+1):
                continue
            seats=[(target[0]+math.cos(k*math.pi*2/VALUES["precinct_capacity"]+.2)*.85,target[1]+math.sin(k*math.pi*2/VALUES["precinct_capacity"]+.2)*.85) for k in range(VALUES["precinct_capacity"])]
            branches=[(anchor,target)]+[(target,p) for p in seats]
            if not clear(model,branches,parent):
                continue
            accepted.append((i,key,activity,title,target,anchor,seats))
        if not accepted:
            continue
        for a,b in base:
            world.walk.edge(world.walk.node(*a),world.walk.node(*b),kind="entrance-path",width=2)
        # All station junctions exist before adding their short seat approaches.
        for _,_,_,_,target,anchor,seats in accepted:
            world.walk.edge(world.walk.node(*anchor),world.walk.node(*target),kind="entrance-path",width=2)
            for seat in seats:
                world.walk.node(*seat)
        for i,key,activity,title,target,anchor,seats in accepted:
            centre=world.walk.node(*target)
            seat_ids=[world.walk.node(*seat) for seat in seats]
            for seat in seat_ids:
                world.walk.edge(centre,seat,kind="entrance-path",width=1)
            world.state["services"][key]={"id":key,"derived":True,"source":None,"owner":parent["owner"],"district":topic,"block":parent["block"],
                "function":"commons","activity":activity,"title":title,"entrance":centre,"seats":seat_ids,"place":True,"footprint":None,
                "capacity":len(seats),"hours":[6,22],"enabled":True,"occupants":[],"reservations":[],"queue":[],"state":"open",
                "paths":[[list(a),list(b)] for a,b in base+[(anchor,target)]],"reason":"Outdoor commons backed by existing district sources and real pedestrian seats"}
            # Protect the new public walks from later growth. Existing clear garden strips remain easements.
            for j,(a,b) in enumerate(base+[(anchor,target)]+[(target,p) for p in seats]):
                dx,dy=b[0]-a[0],b[1]-a[1]
                length=math.hypot(dx,dy)
                if length<.01:
                    continue
                nx,ny=-dy/length*.25,dx/length*.25
                poly=[[a[0]+nx,a[1]+ny],[b[0]+nx,b[1]+ny],[b[0]-nx,b[1]-ny],[a[0]-nx,a[1]-ny]]
                existing=[p for p in world.state["parcels"].values() if p["id"]!=parent.get("parcel") and convex_overlap(poly,p["polygon"])]
                for p in existing:
                    if p['source'] is None and convex_overlap(poly,p['footprint']['polygon']):
                        p.update(protected=True,state="commons-access")
                        world.vacant.get(world.state['blocks'][p['block']]['district'],set()).discard(p['id'])
                if any(convex_overlap(poly,p["footprint"]["polygon"]) for p in existing):
                    continue
                world.state["protected"].append({"id":key+":walk:"+str(j),"parcel":parent.get("parcel"),"polygon":poly,"box":aabb(poly),
                    "easements":[p["id"] for p in existing],"reason":"Keep outdoor visitor access during district growth"})
            model.state["budget"]["available"]-=VALUES["precinct_cost"]
            model.state["budget"]["spent"]+=VALUES["precinct_cost"]
            model.emit("districtCommonsFounded",place=key,activity=activity,reason="Themed place and real seats; no extra inhabitants or source files")
    # Store the resulting revisions, including paths/places created by this pass.
    world.state['precinctPlanning'] = planning_key(model)
