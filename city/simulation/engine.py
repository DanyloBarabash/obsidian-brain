"""Integrated staged city model; source data, world state and rendering stay separate."""

from collections import Counter
from copy import deepcopy
import hashlib
import json
import math
from pathlib import Path

from .activities import Activities
from .economy import Economy
from .profile import PARAMETERS, STREET_PROFILES, VALUES, convex_overlap, polygon_segment_distance, stable_hash
from .transit import Transit
from .world import World, neighbourhood, radius, warp
from . import housing
from .facilities import sync_facilities


LAYOUT_VERSION = 12
# Per-tick movement is visible in live agent state; it is not persisted as history.
TRANSIENT_EVENTS = frozenset({"tripStarted", "tripArrived", "transitDeparted", "transitArrived"})
# Saved parts grouped by change rate; an unchanged part keeps its content-addressed file.
# "parent.child" moves a per-tick sub-key (service queues) out of a static parent.
SAVE_PARTS = {"world": ("world", "sources", "buildings", "knowledge", "budget"),
              "live": ("clock", "residents", "transit", "economy", "weather", "world.services"), "events": ("events",)}


class Simulation:
    """Compose all rule mechanisms without activating the replacement renderer."""

    def __init__(self, state=None):
        self.state = deepcopy(state) if state is not None else {
            "schemaVersion": 1, "activation": "staged", "seed": "calm-knowledge-city-v1",
            "clock": {"tick": 0, "accumulatorMs": 0, "paused": False, "reducedMotion": False},
            "world": {}, "sources": {}, "buildings": {}, "residents": {}, "events": [],
            "knowledge": [], "budget": {"issued": 0, "spent": 0, "available": 0},
            "economy": {}, "transit": {}, "weather": {"rain": VALUES["weather_rain"], "heat": VALUES["weather_heat"]},
            "snapshotVersion": None, "layoutVersion": LAYOUT_VERSION,
        }
        if self.state.get("schemaVersion") != 1 or self.state.get("activation") != "staged":
            raise ValueError("Unknown simulation schema or activation; preserve the file")
        self.clock = self.state["clock"]
        self.world = World(self.state["world"],self.emit)
        self.economy = Economy(self.state["economy"],self.world)
        self.transit = Transit(self.state["transit"],self.world,self.emit,self._residents_in)
        self.activities = Activities(self.state["residents"],self.state["buildings"],self.world,self.economy,self.transit,self.clock,self.emit)
        self._knowledge_index()
        self._pending = {key for key,b in self.state["buildings"].items() if b["lifecycle"] in ("reserved","connected","construction")}
        if self.state["sources"]:
            sync_facilities(self)

    def emit(self, event_type, **details):
        """Append ordered logical events; wall-clock and FPS never enter the model."""
        if event_type in TRANSIENT_EVENTS:
            return
        events = self.state["events"]
        events.append({"id": events[-1]["id"]+1 if events else 1, "type": event_type, "tick": self.state["clock"]["tick"],
                       "schemaVersion": 1, **details})

    def _knowledge_index(self):
        """Index semantic links independently of street, walk and utility topology."""
        index = {}
        for a,b in self.state["knowledge"]:
            index.setdefault(a,[]).append(b)
            index.setdefault(b,[]).append(a)
        for linked in index.values():
            linked.sort()
        self.activities.knowledge = index

    def _floors(self, source):
        """Fit a bounded ordinary envelope instead of extruding unlimited text."""
        if housing.library(source):
            return VALUES['library_floors']
        if housing.apartment(source):
            return VALUES["apartment_floors"]
        return min(VALUES["max_floors"],2+max(0,int(math.log2(max(1,source.get("words",0)))/VALUES["floor_word_octaves"]))+source.get("degree",0)//VALUES["floor_degree_links"])

    def _source(self, node):
        """Retain only source metadata, never a text body or inferred personal role."""
        return {"id": node.get("stableId",node["id"]), "path": node["id"], "title": node.get("title",node["id"]),
                "class": node.get("cityDistrict",node.get("sourceClass",node["district"])), "project": node.get("project", ""),
                "knowledgeClass": node.get("sourceClass",node["district"]), "cityRole": node.get("cityRole", ""),
                "topic": node.get("cityTopic", ""), "importance": node.get("cityImportance"), "topicAnchor": node.get("topicAnchor", False),
                "quarter": node.get("cityQuarter", ""), "plannedQuarter": node.get("cityQuarter", ""),
                "subject": node.get("citySubject", ""), "landmark": node.get("cityLandmark", ""), "landmarkTitle": node.get("cityLandmarkTitle", ""),
                "kind": node.get("kind","note"), "revision": node.get("contentRevision",""),
                "archived": node.get("archived",False), "uri": node.get("uri"), "available": node.get("available",True),
                "words": node.get("words",0), "degree": node.get("degree",0)}

    def sync(self, snapshot):
        """Apply one source snapshot idempotently, preserving all existing world geometry."""
        signature,sources,knowledge = self._normalize(snapshot)
        if signature == self.state["snapshotVersion"]:
            return False
        before = deepcopy(self.state)
        try:
            return self._apply(sources,knowledge,signature)
        except Exception:
            self.__init__(before)
            raise

    def _normalize(self, snapshot):
        """Validate identities and derive an order-independent source revision."""
        nodes = snapshot["nodes"]
        by_path = {n["id"]:n.get("stableId",n["id"]) for n in nodes}
        retained = [{**n,"id":n.get("sourcePath",n["id"])} for n in snapshot.get("cityState",{}).get("missingSources",[])]
        sources = [self._source(n) for n in nodes+retained]
        established = {}
        for key, old in self.state["sources"].items():
            block = self.world.state["blocks"][self.world.state["parcels"][self.state["buildings"][key]["parcel"]]["block"]]
            established.setdefault((old["class"], old["project"]), block.get("neighbourhood", ""))
        for source in sources:
            if source["quarter"] and (source["class"], source["project"]) in established:
                source["quarter"] = established[source["class"], source["project"]]
        if len({s["id"] for s in sources}) != len(sources):
            raise ValueError("Duplicate stable source identity in simulation input")
        knowledge = sorted(set(tuple(sorted((by_path[a],by_path[b]))) for a,b in snapshot.get("edges",[]) if a in by_path and b in by_path and a != b))
        signature = hashlib.sha256(json.dumps([sorted(sources,key=lambda n:n["id"]),knowledge],sort_keys=True).encode()).hexdigest()
        return signature,sources,knowledge

    def _apply(self, sources, knowledge, signature):
        """Commit a feasible source batch or let the caller restore its prior state."""
        incoming = set()
        sizes = Counter((s["class"],s["quarter"] or neighbourhood(s["project"])) for s in sources if s["available"])
        forced = {(s["class"],s["quarter"]) for s in sources if s["available"] and s["quarter"]}
        classes = Counter(s["class"] for s in sources if s["available"])
        projects = {}
        for (name,quarter),count in sizes.items():
            if quarter and (name,quarter) not in forced and count >= VALUES["neighbourhood_min_sources"]:
                projects.setdefault(name,{})[quarter] = count
        for name in classes:
            shared = sum(count for (other,quarter),count in sizes.items() if other == name and quarter not in projects.get(name,{}))
            if projects.get(name) and shared:
                projects[name][""] = shared
        self.world.plan_wedges(classes,projects)
        # The most important sources settle first, so they take the plots nearest the square.
        for source in sorted(sources,key=lambda s:(min(housing.priority(s)[0],3),
                -sizes[(s["class"],s["quarter"] or neighbourhood(s["project"]))],s["class"],
                s["quarter"] or neighbourhood(s["project"]),housing.priority(s)) if forced else housing.priority(s)):
            key = source["id"]
            if source["available"]:
                incoming.add(key)
            old = self.state["sources"].get(key)
            if old is not None and not source["available"]:
                continue
            if old is None:
                self.state["budget"]["issued"] += VALUES["credit_per_source"]
                self.state["budget"]["available"] += VALUES["credit_per_source"]
                node = {**source,"stableId":key,"sourceClass":source["class"],"district":source["class"],
                        "neighbourhoodSize":sizes[(source["class"],source["quarter"] or neighbourhood(source["project"]))]}
                requested_load = 1 if housing.apartment(source) or housing.library(source) else 1+(self._floors(source)-2)*VALUES["additional_floor_load"]
                self.economy.loads = {}
                parcel = housing.existing(self, source, requested_load)
                shared, new_block = parcel is not None, False
                if parcel is None:
                    parcel, new_block = self.world.allocate(node,self.clock["tick"],
                        feasible=lambda p:self.economy.can_allocate(p,self.state["buildings"],requested_load) and (source.get("importance") not in (2,3) or source["kind"] != "document" or p["footprint"]["fw"] >= 9),
                        provision=self.economy.provision)
                physical, unit = housing.assign(self, source, parcel)
                cost = (VALUES["apartment_unit_cost"] if shared else VALUES["building_cost"])+(VALUES["block_cost"] if new_block else 0)
                self.state["budget"]["spent"] += cost
                self.state["budget"]["available"] -= cost
                self.economy.provision(parcel["block"])
                kind = source["kind"]
                function = "archive" if source["archived"] else "library" if kind in ("document","class") or housing.library(source) else "workshop" if kind == "session" else "work"
                family = {"systems-and-agents":"observatory","education-and-research":"academy","games":"studio","personal-tools":"garden","commons":"library","civic":"civic","sports":"sports","science":"academy","technology":"observatory","energy":"garden","media":"studio"}.get(source["class"],"workspace")
                models = {"observatory":["laboratory","observatory","data-tower"],"academy":["college","library-wing","laboratory"],
                          "studio":["theatre","atelier","timber-house"],"garden":["cottage","greenhouse","maker-house"],
                          "library":["archive","merchant-house","clock-house"],"civic":["registry","city-archive","planning-office"],"sports":["training-hall","sports-institute"],"workspace":["office","workshop","townhouse","terrace"]}[family]
                building = {"id":"building:"+key,"source":key,"derived":False,"available":True,
                    "parcel":parcel["id"],"physicalId":physical,"unit":unit,"footprint":deepcopy(parcel["footprint"]),"entrance":parcel["entrance"],
                    "functions":["home",function],"floors":self._floors(source),"maxFloors":VALUES["max_floors"],
                    "family":family,"model":models[stable_hash(key+function+str(self.day()//VALUES["era_days"]))%len(models)],"era":self.day()//VALUES["era_days"],
                    "serviceLoad":requested_load,
                    "lifecycle":"reserved","nextStage":self.clock["tick"]+VALUES["construction_ticks"],
                    "firstSeen":self.clock["tick"],"builtAt":None,"materialInstalledAt":self.clock["tick"],"renovatedAt":None,
                    "uri":source["uri"],"reason":"New available Brain source; finite development credit and serviced parcel"}
                if source.get("cityRole") in ("town-hall", "council", "registry", "city-archive", "planning-office", "infrastructure-office", "district-hall", "project-council"):
                    building["model"] = source["cityRole"]
                if housing.library(source):
                    building['model'] = 'grand-library'
                elif housing.apartment(source):
                    building["model"] = "apartment-tower"
                elif source["kind"] == "document" and source.get("importance") in (2,3) and source.get("cityRole") not in ("council", "registry", "planning-office"):
                    building["model"] = "sports-institute" if source.get("topic") == "sports" else "research-institute" if source.get("topic") == "science" else "manor"
                self.state["buildings"][key] = building
                self._pending.add(key)
                self.world.state["services"][building["id"]] = {"id":building["id"],"source":key,"derived":False,"block":parcel["block"],
                    "owner":key,"district":parcel["district"],"function":function,"entrance":parcel["entrance"],
                    "capacity":VALUES["service_capacity"],"hours":list(VALUES["activity_hours"].get(function,VALUES["activity_hours"]["work"])),"enabled":True,"occupants":[],"reservations":[],"queue":[],"state":"construction"}
                if source.get('cityRole') == 'knowledge-library':
                    self.world.state['services'][building['id']]['publicLibrary'] = True
                fraction = (stable_hash(key)%10000)/10000
                self.state["residents"][key] = {"id":key,"source":key,"home":building["id"],"active":True,"state":"awaiting-home",
                    "node":parcel["entrance"],"goal":None,"route":None,"edge":0,"progress":0,"journey":None,
                    "speed":VALUES["walk_min"]+fraction*(VALUES["walk_max"]-VALUES["walk_min"]),"trips":0,
                    "nextDecision":self.clock["tick"]+1,"reason":"waiting for home access and construction"}
                self.emit("sourceAdded" if source["available"] else "sourceImportedMissing",source=key,path=source["path"],reason=building["reason"] if source["available"] else "Retain a historical source reservation from the current city")
            else:
                building = self.state["buildings"][key]
                if old["path"] != source["path"]:
                    self.emit("sourceMoved",source=key,previousPath=old["path"],path=source["path"],reason="Stable identity; world geometry unchanged")
                if not old["available"]:
                    building["lifecycle"] = building.pop("priorLifecycle","open")
                    if building["lifecycle"] != "open":
                        self._pending.add(key)
                    agent = self.state["residents"][key]
                    agent.update(active=True,state="awaiting-home",node=building["entrance"],route=None,journey=None,goal=None,edge=0,progress=0)
                    self.emit("sourceRestored",source=key)
                if old["revision"] != source["revision"]:
                    candidate = self._floors(source)
                    if candidate > building["floors"]:
                        cost = (candidate-building["floors"])*VALUES["renovation_cost"]
                        prior_load = building["serviceLoad"]
                        building["serviceLoad"] = 1+(candidate-2)*VALUES["additional_floor_load"]
                        parcel = self.world.state["parcels"][building["parcel"]]
                        supplied,reason = self.economy.can_open(parcel,self.state["buildings"])
                        if supplied and self.state["budget"]["available"] >= cost:
                            building["floors"] = candidate
                            self.state["budget"]["spent"] += cost
                            self.state["budget"]["available"] -= cost
                            building.pop("renovationPending",None)
                            self.emit("buildingAdapted",source=key,cost=cost,unit="model development credits",reason="Bounded envelope and local service capacity available")
                        else:
                            building["serviceLoad"] = prior_load
                            building["renovationPending"] = reason or "insufficient model development credits"
                    building["renovatedAt"] = self.clock["tick"]
                    self.emit("sourceUpdated",source=key,reason="Content updated within the reserved envelope")
                if old["class"] != source["class"]:
                    self.emit("sourceClassChanged",source=key,reason="Classification updated; historical parcel retained")
                if old["archived"] != source["archived"]:
                    self.emit("sourceArchived" if source["archived"] else "sourceActivated",source=key)
                building.update(available=True,uri=source["uri"])
            self.state["sources"][key] = source
            if not source["available"]:
                # The common missing-source transition below also reserves imported ghosts.
                self.state["sources"][key] = {**source,"available":True}
        for key, source in self.state["sources"].items():
            if key not in incoming and source["available"]:
                source.update(available=False,uri=None)
                building = self.state["buildings"][key]
                building.update(available=False,uri=None,priorLifecycle=building["lifecycle"],lifecycle="sourceMissing")
                self._pending.discard(key)
                self.activities.deactivate(self.state["residents"][key])
                self.emit("sourceMissing",source=key,reason="Retain source memory and parcel; do not demolish neighbours")
        self.state["knowledge"] = [list(edge) for edge in knowledge]
        sync_facilities(self)
        self._knowledge_index()
        self.state["snapshotVersion"] = signature
        return True

    def day(self):
        """Read the compressed activity day, separate from real calendar time."""
        return self.clock["tick"]*VALUES["tick_ms"]//(VALUES["day_seconds"]*1000)

    def _construction(self):
        """Progress only accessible, supplied buildings through explicit stages."""
        for key in sorted(self._pending):
            building = self.state["buildings"][key]
            if self.clock["tick"] < building["nextStage"]:
                continue
            parcel = self.world.state["parcels"][building["parcel"]]
            block = self.world.state["blocks"][parcel["block"]]
            accessible = self.world.walk.route(parcel["entrance"],block["publicNode"]) is not None
            supplied, reason = self.economy.can_open(parcel,self.state["buildings"])
            if not accessible or not supplied:
                building["waitingReason"] = reason or "no pedestrian access"
                continue
            building.pop("waitingReason",None)
            lifecycle = {"reserved":"connected","connected":"construction","construction":"open"}[building["lifecycle"]]
            building.update(lifecycle=lifecycle,nextStage=self.clock["tick"]+VALUES["construction_ticks"])
            event = {"connected":"buildingConnected","construction":"constructionStarted","open":"buildingOpened"}[lifecycle]
            self.emit(event,source=key,parcel=parcel["id"])
            if lifecycle == "open":
                building["builtAt"] = self.clock["tick"]
                parcel["state"] = "used"
                self._pending.discard(key)

    def advance(self, ticks=1):
        """Advance a fixed number of ticks; pause and reduced motion freeze all processes."""
        if not isinstance(ticks,int) or ticks < 0:
            raise ValueError("Ticks must be a nonnegative integer")
        if self.clock["paused"] or self.clock["reducedMotion"]:
            return
        for _ in range(ticks):
            self.clock["tick"] += 1
            if self._pending:
                self._construction()
            self.economy.settle_day(self.day(),self.state["buildings"])
            self.activities.step()

    def advance_elapsed(self, milliseconds):
        """Accept explicit integer elapsed input, independent of how frames group it."""
        if not isinstance(milliseconds,int) or milliseconds < 0:
            raise ValueError("Elapsed time must be integer logical milliseconds")
        if self.clock["paused"] or self.clock["reducedMotion"]:
            return
        total = self.clock["accumulatorMs"]+milliseconds
        ticks,self.clock["accumulatorMs"] = divmod(total,VALUES["tick_ms"])
        self.advance(ticks)

    def ecology(self):
        """Compute age, shade and stylised rain partition from preserved geometry."""
        land = self.world.state["land"]
        area = land["w"]*land["h"] if land else 1
        buildings = sum(b["footprint"]["fw"]*b["footprint"]["fd"] for b in {b["parcel"]:b for b in self.state["buildings"].values()}.values())
        roads = sum(e["length"]*e["width"] for e in self.world.street.state["edges"].values())
        pervious = max(0,min(1,1-(buildings+roads)/area))
        canopy = 0
        for tree in self.world.state["vegetation"].values():
            age = (self.clock["tick"]-tree["plantedAt"])*VALUES["tick_ms"]/1000/VALUES["day_seconds"]
            canopy += min(1,age/VALUES["tree_maturity_days"])
        # Coverage indices are explicitly stylised rather than weather forecasts.
        runoff = self.state["weather"]["rain"]*(1-pervious)
        return {"status":"scenario-index","perviousFraction":pervious,"matureTreeEquivalent":canopy,
                "rainInput":self.state["weather"]["rain"],"runoff":runoff,"infiltration":self.state["weather"]["rain"]-runoff,
                "thermalIndex":self.state["weather"]["heat"]-canopy/max(1,len(self.world.state["vegetation"]))}

    def snapshot(self, full=False):
        """Expose a read-only presentation contract without advancing model time."""
        available = sum(s["available"] for s in self.state["sources"].values())
        states = dict(Counter(a["state"] for a in self.state["residents"].values() if a["active"]))
        outside = sorted(key for key,a in self.state["residents"].items() if a["active"] and a["state"] not in ("home","awaiting-home"))
        result = {"activation":"staged","currentMapChanged":False,"schemaVersion":1,"units":"new logical metres; no conversion of the legacy map",
            "tick":self.clock["tick"],"day":self.day(),"knowledgePopulation":available,"primaryBuildings":len({b.get("physicalId", b["id"]) for b in self.state["buildings"].values() if b["available"]}),"addressUnits":available,
            "missingBuildings":len(self.state["sources"])-available,"derivedServices":sum(s["derived"] for s in self.world.state["services"].values()),
            "districts":len(self.world.state["centres"]),"blocks":len(self.world.state["blocks"]),"trees":len(self.world.state["vegetation"]),
            "residentStates":states,"renderedAgentBudget":VALUES["visible_agents"],"visibleResidents":outside[:VALUES["visible_agents"]],
            "hiddenByBudget":max(0,len(outside)-VALUES["visible_agents"]),"ecology":self.ecology(),
            "parameters":deepcopy(PARAMETERS),"streetProfiles":deepcopy(STREET_PROFILES),"budget":deepcopy(self.state["budget"]),
            "eventCount":len(self.state["events"]),"sourceRevision":self.state["snapshotVersion"]}
        if full:
            result["state"] = deepcopy(self.state)
            result["positions"] = {key:self.activities.position(agent) for key,agent in self.state["residents"].items() if agent["active"]}
            result["vegetationPresentation"] = {key:{"ageDays":(self.clock["tick"]-t["plantedAt"])*VALUES["tick_ms"]/1000/VALUES["day_seconds"],
                "growthStage":"mature" if (self.clock["tick"]-t["plantedAt"])*VALUES["tick_ms"] >= VALUES["tree_maturity_days"]*VALUES["day_seconds"]*1000 else "young"}
                for key,t in self.world.state["vegetation"].items()}
            result["buildingPresentation"] = {key:{"height":b["floors"]*VALUES["floor_height"],
                "materialAgeDays":(self.clock["tick"]-b["materialInstalledAt"])*VALUES["tick_ms"]/1000/VALUES["day_seconds"]}
                for key,b in self.state["buildings"].items()}
        return result

    def orientation_order(self):
        """Boeing orientation-order of street bearings: 1 for one grid, 0 for uniform directions."""
        nodes, bins = self.world.street.state["nodes"], [0.0]*36
        for edge in self.world.street.state["edges"].values():
            a, b = nodes[edge["a"]], nodes[edge["b"]]
            bearing = math.degrees(math.atan2(b["y"]-a["y"], b["x"]-a["x"])) % 360
            for value in (bearing, (bearing+180) % 360):
                bins[int(((value+5) % 360)//10)] += edge["length"]
        total = sum(bins)
        if not total:
            return 1.0
        entropy = -sum(v/total*math.log(v/total) for v in bins if v)
        low, high = math.log(4), math.log(36)
        return 1-((entropy-low)/(high-low))**2 if entropy > low else 1.0

    def presentation(self):
        """Compact render contract in logical metres: streets as continuous ways, paths, rivers, buildings, residents."""
        return {**self.static_presentation(), **self.live_presentation()}

    def static_revision(self):
        """Revision of everything the static render layer shows; agents and service states are excluded.

        It changes with network topology, blocks, buildings (lifecycle, availability, size), services (function, title,
        footprint) and once per
        model day for tree growth, so clients can skip unchanged geometry (HTTP 304).
        """
        world = self.world
        parts = [self.state['layoutVersion'], world.street.state["revision"], world.walk.state["revision"], len(world.state["blocks"]), len(world.state["parcels"]),
                 len(world.state["services"]), len(world.state["vegetation"]), self.day(),
                 [(key, b["lifecycle"], b["available"], b["floors"], b["model"]) for key, b in sorted(self.state["buildings"].items())],
                 [(key, s["function"], s.get("title"), s.get("footprint") and s["footprint"]["polygon"]) for key, s in sorted(world.state["services"].items())]]
        return hashlib.sha1(json.dumps(parts).encode()).hexdigest()[:16]

    def _residents_in(self, district):
        """Active residents whose home source belongs to a district, counted once per tick."""
        if getattr(self, "_district_counts", (None,))[0] != self.clock["tick"]:
            counts = {}
            for key, agent in self.state["residents"].items():
                source = self.state["sources"].get(key)
                if agent["active"] and source:
                    counts[source["class"]] = counts.get(source["class"], 0)+1
            self._district_counts = (self.clock["tick"], counts)
        return self._district_counts[1].get(district, 0)

    def live_presentation(self):
        """Per-tick part of the render contract: visible residents and vehicles; service states stay in the inspector."""
        walk = self.world.walk
        nodes = walk.state["nodes"]
        point = lambda key: [nodes[key]["x"], nodes[key]["y"]]
        residents = []
        for key, agent in sorted(self.state["residents"].items()):
            if not agent["active"] or agent["state"] in ("home", "awaiting-home"):
                continue
            here = self.activities.position(agent)
            item = {"id": key, "state": agent["state"], "x": round(here["x"], 2), "y": round(here["y"], 2), "speed": round(agent["speed"], 3), "points": []}
            if agent["state"] == "visiting":
                service = self.world.state["services"].get(agent.get("goal"), {})
                if service.get("place"):
                    item["activity"] = service["activity"]
            route = agent.get("route")
            if agent["state"] in ("walking", "returning") and route:
                # Between two refreshes a resident covers only a few nodes; the rest of the route stays on the server.
                item["points"] = [[round(c, 2) for c in point(n)] for n in route["nodes"][agent["edge"]+1:agent["edge"]+1+VALUES["live_route_nodes"]]]
            residents.append(item)
            if len(residents) >= VALUES["visible_agents"]:
                break
        return {"tick": self.clock["tick"], "tickMs": VALUES["tick_ms"], "staticRevision": self.static_revision(), "residents": residents,
                "vehicles": [{"id": line["vehicle"]["id"], **self.transit.position(key), **self.transit.motion(key), "state": line["vehicle"]["state"],
                              "passengers": len(line["vehicle"]["passengers"]), "capacity": line["capacity"]}
                             for key, line in sorted(self.transit.state["lines"].items()) if line["enabled"]],
                "hiddenResidents": sum(a["active"] and a["state"] not in ("home", "awaiting-home") for a in self.state["residents"].values())-len(residents)}

    def static_presentation(self):
        """Geometry part of the render contract; unchanged between ticks unless `static_revision` changes."""
        world, walk = self.world, self.world.walk
        nodes, adjacency = walk.state["nodes"], walk.adjacency()
        point = lambda key: [nodes[key]["x"], nodes[key]["y"]]
        buildings = {}
        for key, building in self.state["buildings"].items():
            entrance = building["entrance"]
            gate = next((t for t, _, e in adjacency.get(entrance, []) if e["kind"] == "entrance-path"), entrance)
            parcel = world.state["parcels"][building["parcel"]]
            buildings[key] = {"footprint": building["footprint"], "floors": building["floors"], "model": building["model"],
                              "physicalId":building.get("physicalId",building["id"]),"unit":building.get("unit"),
                              "family": building["family"], "lifecycle": building["lifecycle"], "block": parcel["block"],
                              "door": point(entrance), "gate": point(gate)}
        return {"units": "logical metres",
                "land": world.state["land"],
                "streetWidth": VALUES["carriage_width"], "sidewalkWidth": VALUES["sidewalk_width"],
                "blocks": [self._block_shape(b) for b in world.state["blocks"].values()],
                "plaza": next((z["polygon"] for z in world.state["protected"] if z["id"] == "plaza"), None),
                "centres": [{"id": c["id"], "district": d, "x": c["x"], "y": c["y"], "kind": c["kind"]} for d, c in world.state["centres"].items()],
                "ways": [{"kind": w["kind"], "width": w["width"], "points": w["points"]} for w in world.street.ways()],
                "paths": [{"kind": w["kind"], "width": w["width"], "points": w["points"]} for w in walk.ways()
                          if w["kind"] in ("promenade", "bridge-sidewalk", "public-path")],
                "rivers": world.rivers(), "buildings": buildings,
                "services": [{"id": s["id"], "function": s["function"], "footprint": s["footprint"], "door": point(s["entrance"])}
                             | {k:s[k] for k in ("title", "owner", "landmark", "district", "capacity", "hours", "project", "subject", "annexOf") if k in s}
                             for s in world.state["services"].values() if s["derived"] and s.get("footprint")],
                "places": [{**{k:s[k] for k in ("id","title","activity","district","owner","capacity","hours","paths")},
                            "position":point(s["entrance"])} for s in world.state["services"].values() if s.get("place")],
                "trees": [{"id": k, "x": v["x"], "y": v["y"], "species": v["species"], "role": v["role"],
                           "ageDays": (self.clock["tick"]-v["plantedAt"])*VALUES["tick_ms"]/1000/VALUES["day_seconds"]}
                          for k, v in world.state["vegetation"].items()],
                "maturityDays": VALUES["tree_maturity_days"],
                "metrics": {**{key: value for key, value in world.street.metrics().items() if key != "sharpJunctions"},
                            "orientationOrder": self.orientation_order()}}

    def _block_shape(self, block):
        """Paved pad up to the carriageway and the courtyard core of a curved block, in world metres."""
        i, s = block["cell"]
        t0, t1 = self.world.cell_ticks(i, s)
        edge = VALUES["carriage_width"]/2
        r0, r1 = radius(i)+edge, radius(i+1)-edge
        steps = 8
        pad = [list(warp(r0, t0+(t1-t0)*k/steps)) for k in range(steps+1)]+[list(warp(r1, t1-(t1-t0)*k/steps)) for k in range(steps+1)]
        park = next((z["polygon"] for z in self.world.state["protected"] if z["id"] == f"park:{block['id']}"), None)
        return {"id": block["id"], "x": block["x"], "y": block["y"], "district": block["district"], "neighbourhood": block.get("neighbourhood", ""),
                "ring": i, "pad": pad, "court": park}

    def inspect(self, identity):
        """Resolve any model object to a truthful source or labelled derived function."""
        source_key = identity.removeprefix("building:").removeprefix("resident:")
        source = self.state["sources"].get(source_key)
        if source:
            return {"id":identity,"derived":False,"source":source_key,"available":source["available"],
                    "uri":source["uri"] if source["available"] else None,
                    "title":source["title"],"path":source["path"],"building":deepcopy(self.state["buildings"][source_key])}
        for group in ("services","vegetation","parcels","centres"):
            item = self.world.state[group].get(identity)
            if item:
                if item.get("source") in self.state["sources"] and group == "parcels":
                    return self.inspect(item["source"])
                owner = self.state["sources"].get(item.get("owner",item.get("source")))
                details = deepcopy(item)
                if group == "services":
                    details["state"] = self.activities.service_state(item)
                return {"id":identity,"derived":True,"source":None,"uri":None,
                        "function":item.get("function",item.get("role",group)),"details":details,
                        "ownerUri":owner["uri"] if owner and owner["available"] else None}
        for network in self.world.networks.values():
            if identity in network.state["edges"]:
                return {"id":identity,"derived":True,"source":None,"uri":None,"function":network.kind,
                        "details":deepcopy(network.state["edges"][identity])}
        for line in self.transit.state["lines"].values():
            if identity in (line["id"],line["vehicle"]["id"]):
                return {"id":identity,"derived":True,"source":None,"uri":None,"function":"transit",
                        "details":deepcopy(line)}
        raise KeyError(identity)

    def save(self, path):
        """Atomically persist the staged world independently of legacy addresses."""
        path = Path(path)
        path.parent.mkdir(parents=True,exist_ok=True)
        manifest = {key:value for key,value in self.state.items() if not any(key in keys for keys in SAVE_PARTS.values())}
        manifest["parts"] = {}
        for name,keys in SAVE_PARTS.items():
            present = [key for key in keys if key.partition(".")[2] in self.state[key.partition(".")[0]] or "." not in key]
            body = json.dumps({key:self._part_value(key) for key in present},ensure_ascii=False).encode()
            part = path.with_name(f"{path.stem}.{name}-{hashlib.sha1(body).hexdigest()[:12]}.json")
            if not part.exists():
                temporary = part.with_suffix(".tmp")
                temporary.write_bytes(body)
                temporary.replace(part)
            manifest["parts"][name] = part.name
        # The manifest switches to the new parts atomically; only then are older parts removed.
        temporary = path.with_suffix(path.suffix+".tmp")
        temporary.write_text(json.dumps(manifest,ensure_ascii=False),encoding="utf-8")
        temporary.replace(path)
        for name in SAVE_PARTS:
            for stale in path.parent.glob(f"{path.stem}.{name}-*.json"):
                if stale.name != manifest["parts"][name]:
                    stale.unlink()

    def _part_value(self, key):
        """State value saved under a SAVE_PARTS key, without sub-keys saved in other parts."""
        parent,_,child = key.partition(".")
        if child:
            return self.state[parent][child]
        moved = {k.partition(".")[2] for keys in SAVE_PARTS.values() for k in keys if k.startswith(parent+".")}
        value = self.state[parent]
        return {k:v for k,v in value.items() if k not in moved} if moved else value

    @staticmethod
    def read_state(path):
        """Assemble a saved state from its manifest and parts; a single-file save is read as is."""
        path = Path(path)
        state = json.loads(path.read_text(encoding="utf-8"))
        loaded = [json.loads((path.parent/part).read_text(encoding="utf-8")) for part in state.pop("parts",{}).values()]
        for values in loaded:
            state.update({key:value for key,value in values.items() if "." not in key})
        for values in loaded:
            for key,value in values.items():
                if "." in key:
                    parent,_,child = key.partition(".")
                    state[parent][child] = value
        return state

    @classmethod
    def load(cls, path):
        """Restore exact model state; never infer elapsed offline time."""
        from .migrations import migrate
        state = cls.read_state(path)
        if not migrate(state):
            raise ValueError('No safe layout migration; preserve the saved world')
        return cls(state)

    def audit(self):
        """Check source truth, geometry, reachability, capacities and conservation."""
        errors = self.economy.audit()
        sources, buildings, residents = self.state["sources"],self.state["buildings"],self.state["residents"]
        if set(sources) != set(buildings) or set(sources) != set(residents):
            errors.append("Source/building/resident identity sets differ")
        for house in self.state.get("housing", {}).values():
            if len(house["sources"]) > house["capacity"] or len(set(house["sources"])) != len(house["sources"]):
                errors.append(f"Apartment capacity violated: {house['id']}")
            for number, key in enumerate(house["sources"], 1):
                if buildings[key]["parcel"] != house["parcel"] or buildings[key].get("unit") != number:
                    errors.append(f"Incorrect apartment address: {key}")
        budget = self.state["budget"]
        if budget["issued"] != budget["spent"]+budget["available"] or budget["available"] < 0:
            errors.append("Nonconserved development credits")
        walk_nodes = self.world.walk.state["nodes"]
        reachable = self.world.walk.reachable(next(iter(walk_nodes),None))
        for block in self.world.state["blocks"].values():
            parcels = [self.world.state["parcels"][k] for k in block["parcels"]]
            for index,p in enumerate(parcels):
                for other in parcels[index+1:]:
                    if convex_overlap(p["polygon"],other["polygon"]):
                        errors.append(f"Parcel overlap: {p['id']}")
                for corridor in block["corridors"]:
                    for a,b in zip(corridor["points"],corridor["points"][1:]):
                        if polygon_segment_distance(p["footprint"]["polygon"],a,b) < corridor["half"]-1e-6:
                            errors.append(f"Footprint occupies full road corridor: {p['id']}")
                if p["entrance"] not in walk_nodes:
                    errors.append(f"Missing entrance: {p['id']}")
                elif p["entrance"] not in reachable:
                    errors.append(f"Isolated entrance: {p['id']}")
                for protected in self.world.state["protected"]:
                    if protected.get("parcel") == p["id"] or p["id"] in protected.get("civicParcels",[]):
                        continue
                    box = protected["box"]
                    zone = protected.get("polygon") or [[box["x"],box["y"]],[box["x"]+box["w"],box["y"]],[box["x"]+box["w"],box["y"]+box["h"]],[box["x"],box["y"]+box["h"]]]
                    if p["id"] in protected.get("easements",[]) and not convex_overlap(p["footprint"]["polygon"],zone):
                        continue
                    if convex_overlap(p["polygon"],zone):
                        errors.append(f"Protected land occupied: {p['id']}")
        for key,building in buildings.items():
            if building["floors"] > building["maxFloors"]:
                errors.append(f"Unbounded height: {key}")
            if bool(building["uri"]) and not sources[key]["available"]:
                errors.append(f"Missing source has URI: {key}")
            if residents[key]["active"] != sources[key]["available"]:
                errors.append(f"Incorrect population: {key}")
        for service in self.world.state["services"].values():
            claims = service["occupants"]+service["reservations"]
            if len(claims) != len(set(claims)) or len(claims) > service["capacity"]:
                errors.append(f"Service capacity violated: {service['id']}")
            if service.get("place"):
                seats = [residents[key].get("visitNode") for key in claims]
                if len(seats)!=len(set(seats)) or any(seat not in service["seats"] for seat in seats):
                    errors.append(f"Invalid outdoor seat claims: {service['id']}")
                if any(seat not in reachable for seat in service["seats"]):
                    errors.append(f"Isolated outdoor seat: {service['id']}")
            if len(service["queue"]) != len(set(service["queue"])):
                errors.append(f"Duplicate service queue: {service['id']}")
            if service["derived"] and service.get("uri"):
                errors.append(f"Derived service has fake source: {service['id']}")
        for line in self.transit.state["lines"].values():
            if len(line["vehicle"]["passengers"]) > line["capacity"]:
                errors.append(f"Transit capacity violated: {line['id']}")
        errors.extend(self.network_errors())
        return errors

    def network_errors(self):
        """Check welded topology, street continuity, river corridors and bridges (BC-39...46)."""
        world, errors = self.world, []
        for net in (world.street, world.walk):
            errors.extend(net.topology_errors())
        if world.state["blocks"]:
            metrics = world.street.metrics()
            if metrics["deadEnds"]:
                errors.append(f"Street dead ends: {metrics['deadEnds']}")
            for key in metrics["sharpJunctions"]:
                errors.append(f"Sharp street junction: {key}")
        for block in world.state["blocks"].values():
            if world.water(*block["cell"]):
                errors.append(f"Block in river corridor: {block['id']}")
        nodes = world.street.state["nodes"]
        for key, edge in world.street.state["edges"].items():
            cells = [tuple(int(v) for v in label.split(":")) for label in edge.get("between", []) if label != "plaza"]
            reaches = [world.water(*cell) for cell in cells]
            over_water = len(cells) == 2 and all(reaches)
            if over_water != (edge["kind"] == "bridge"):
                errors.append(f"Street over water must be a bridge: {key}")
            if edge["kind"] == "bridge":
                if any(r["flow"] != "ring" for r in reaches if r) or edge.get("crossingTick") in world.river_marks().values():
                    errors.append(f"Bridge along a river reach or at a confluence: {key}")
                a, b = nodes[edge["a"]], nodes[edge["b"]]
                bearing = math.atan2(b["y"]-a["y"], b["x"]-a["x"])
                crossing = abs(math.degrees(bearing-edge["flowBearing"])) % 180
                if abs(90-crossing) > VALUES["bridge_skew"]:
                    errors.append(f"Skewed bridge: {key}")
        widest = max(VALUES["river_widths"].values())
        ring = VALUES["river_ring"]
        clearances = [(radius(ring+1)-radius(ring))/2]
        outermost = max([b["cell"][0] for b in world.state["blocks"].values()]+[ring])
        clearances += [world.min_cell_arc(i, radial_water=True)-VALUES["river_meander"][0] for i in range(ring+1, outermost+2)]
        if min(clearances)-VALUES["promenade_offset"]-widest/2 < VALUES["riparian_buffer"]:
            errors.append("Riparian buffer narrower than the scenario minimum")
        # Orientation statistics describe a town, not its first few blocks.
        if len(world.state["blocks"]) >= VALUES["orientation_min_blocks"]:
            order = self.orientation_order()
            if order > VALUES["orientation_order_max"]:
                errors.append(f"Street grid too regular: orientation-order {order:.2f}")
        degree = Counter()
        for edge in world.walk.state["edges"].values():
            degree[edge["a"]] += 1
            degree[edge["b"]] += 1
        for edge in world.walk.state["edges"].values():
            if edge["kind"] in ("promenade", "bridge-sidewalk", "public-path", "sidewalk") and min(degree[edge["a"]], degree[edge["b"]]) < 2:
                errors.append(f"Path ends nowhere: {edge['a']}|{edge['b']}")
        return errors
