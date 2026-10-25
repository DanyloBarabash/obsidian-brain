"""Integrated acceptance scenarios; evidence is scoped to the staged engine."""

from copy import deepcopy
import json
import math
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from simulation import Simulation
from simulation.engine import TRANSIENT_EVENTS
from simulation.network import Network
from simulation.profile import PARAMETERS, VALUES, convex_overlap, overlaps, polygon_segment_distance, rect
from simulation.world import TICKS, radius, sectors, warp


CLASSES = ["systems-and-agents","client-products","education-and-research","games","personal-tools","commons"]


def snapshot(count=16, classes=2):
    """Produce deterministic public-data-shaped sources without actual note bodies."""
    nodes = [{"id":f"notes/{i}.md","stableId":f"source-{i:05d}","title":f"Knowledge {i}",
        "district":CLASSES[i%classes] if i%classes < len(CLASSES) else f"new-class-{i%classes}",
        "project":f"project-{i%3}","kind":"hub" if i < classes else "document" if i%5 == 0 else "note",
        "words":300,"degree":0,"contentRevision":"revision-1","modified":1,
        "uri":f"obsidian://open?vault=fixture&file=notes%2F{i}.md"} for i in range(count)]
    return {"version":f"fixture-{count}-{classes}","nodes":nodes,"edges":[]}


def commission(model):
    """Finish permitted construction and hold automatic choices for controlled scenarios."""
    model.advance(3*VALUES["construction_ticks"])
    for agent in model.state["residents"].values():
        agent["nextDecision"] = 10**12


def river_band(count=800):
    """Enough demand reaches both banks of the open valley rather than only the dry side."""
    model = Simulation()
    model.sync(snapshot(count,1))
    return model


def inside(point, polygon):
    """Point strictly inside a convex polygon."""
    signs = set()
    for a,b in zip(polygon,polygon[1:]+polygon[:1]):
        cross = (b[0]-a[0])*(point[1]-a[1])-(b[1]-a[1])*(point[0]-a[0])
        if abs(cross) > 1e-9:
            signs.add(cross > 0)
    return len(signs) == 1


class SimulationTests(unittest.TestCase):
    def make(self, count=16, classes=2):
        model = Simulation()
        data = snapshot(count,classes)
        model.sync(data)
        return model,data

    def test_staged_boundary_and_truth(self):
        model,data = self.make()
        original = deepcopy(data)
        summary = model.snapshot()
        self.assertEqual(summary["activation"],"staged")
        self.assertFalse(summary["currentMapChanged"])
        self.assertEqual(summary["knowledgePopulation"],len(data["nodes"]))
        self.assertEqual(summary["primaryBuildings"],len(data["nodes"]))
        self.assertEqual(set(model.state["sources"]),set(model.state["residents"]))
        self.assertEqual(data,original)
        self.assertNotIn("body",json.dumps(model.state))
        self.assertEqual(model.audit(),[])

    def test_inspection_does_not_invent_files(self):
        model,data = self.make(2,1)
        key = data["nodes"][0]["stableId"]
        for identity in (key,"building:"+key,"resident:"+key):
            info = model.inspect(identity)
            self.assertEqual(info["uri"],data["nodes"][0]["uri"])
            self.assertFalse(info["derived"])
        derived = next(s for s in model.world.state["services"].values() if s["derived"])
        info = model.inspect(derived["id"])
        self.assertTrue(info["derived"])
        self.assertIsNone(info["uri"])
        self.assertIsNone(info["source"])
        tree = next(iter(model.world.state["vegetation"]))
        self.assertIsNone(model.inspect(tree)["uri"])

    def test_growth_infill_edge_and_stable_geometry(self):
        model,data = self.make(1,1)
        first = deepcopy(model.state["buildings"])
        vegetation = deepcopy(model.world.state["vegetation"])
        data = snapshot(2,1)
        model.sync(data)
        reservation = [e for e in model.state["events"] if e["type"] == "parcelReserved"][-1]
        self.assertEqual(reservation["strategy"],"infill")
        data = snapshot(102,1)
        model.sync(data)
        self.assertGreater(len(model.world.state["blocks"]),1)
        self.assertTrue(any(e.get("strategy") == "edge" for e in model.state["events"]))
        for key,b in first.items():
            self.assertEqual(model.state["buildings"][key]["footprint"],b["footprint"])
            self.assertEqual(model.state["buildings"][key]["parcel"],b["parcel"])
        for key,tree in vegetation.items():
            self.assertEqual(model.world.state["vegetation"][key],tree)
        self.assertEqual(len(model.state["residents"]),102)
        self.assertEqual(model.audit(),[])

    def test_new_centres_have_reasons_and_connected_access(self):
        model,data = self.make(2,1)
        homes = deepcopy(model.state['buildings'])
        wedges = deepcopy(model.world.state['wedges'])
        for index in range(10):
            node = deepcopy(data["nodes"][0])
            node.update(id=f"new-class-{index}.md",stableId=f"extra-{index}",district=f"extra-class-{index}",kind="class")
            data["nodes"].append(node)
        model.sync(data)
        self.assertEqual(len(model.world.state["centres"]),11)
        coordinates = {(c["x"],c["y"]) for c in model.world.state["centres"].values()}
        self.assertEqual(len(coordinates),11)
        self.assertTrue(all(c["reason"] for c in model.world.state["centres"].values()))
        self.assertEqual(model.world.street.bridges(),[])
        self.assertEqual(model.audit(),[])
        for key,home in homes.items():
            self.assertEqual(model.state['buildings'][key]['footprint'],home['footprint'])
            self.assertEqual(model.state['buildings'][key]['entrance'],home['entrance'])
        self.assertNotEqual(model.world.state['wedges'],wedges)
        stable = deepcopy(model.world.state['wedges'])
        model.sync(data)
        self.assertEqual(model.world.state['wedges'],stable)

    def test_protected_land_and_corridors(self):
        model = Simulation()
        protected = rect(150,-60,120,120)
        model.world.reserve_land(protected,"protected forest")
        model.sync(snapshot(100,1))
        self.assertFalse(any(overlaps(protected,b["envelope"]) for b in model.world.state["blocks"].values()))
        for block in model.world.state["blocks"].values():
            for key in block["parcels"]:
                footprint = model.world.state["parcels"][key]["footprint"]["polygon"]
                for corridor in block["corridors"]:
                    for a,b in zip(corridor["points"],corridor["points"][1:]):
                        self.assertGreaterEqual(polygon_segment_distance(footprint,a,b),corridor["half"]-1e-6)
        self.assertEqual(model.audit(),[])
    def test_all_pedestrian_paths_avoid_building_interiors(self):
        model,_ = self.make(40,3)
        # Spatially index footprints so the same check also scales to large worlds.
        boxes = {}
        size = 60
        for building in model.state["buildings"].values():
            polygon = building["footprint"]["polygon"]
            cell = (round(polygon[0][0]/size),round(polygon[0][1]/size))
            boxes.setdefault(cell,[]).append(polygon)
        nodes = model.world.walk.state["nodes"]
        for edge in model.world.walk.state["edges"].values():
            a,b = nodes[edge["a"]],nodes[edge["b"]]
            midpoint = (round((a["x"]+b["x"])/2/size),round((a["y"]+b["y"])/2/size))
            for dx in (-1,0,1):
                for dy in (-1,0,1):
                    for polygon in boxes.get((midpoint[0]+dx,midpoint[1]+dy),[]):
                        self.assertFalse(convex_overlap(polygon,[[a["x"],a["y"]],[b["x"],b["y"]]]),edge)
    def test_knowledge_links_do_not_build_roads(self):
        model,data = self.make(24,2)
        before = deepcopy(model.world.state["networks"])
        data["edges"] = [(a["id"],b["id"]) for i,a in enumerate(data["nodes"]) for b in data["nodes"][i+1:]][:100]
        model.sync(data)
        self.assertEqual(model.world.state["networks"],before)
        self.assertEqual(len(model.state["knowledge"]),100)
        self.assertTrue(model.activities.knowledge)

    def test_construction_stages_require_services(self):
        model,data = self.make(1,1)
        key = data["nodes"][0]["stableId"]
        building = model.state["buildings"][key]
        self.assertEqual(building["lifecycle"],"reserved")
        self.assertTrue(model.inspect(key)["uri"])
        self.assertIsNone(building["builtAt"])
        block = model.world.state["parcels"][building["parcel"]]["block"]
        model.economy.state["plants"][block]["water"]["enabled"] = False
        model.advance(VALUES["construction_ticks"])
        self.assertEqual(building["lifecycle"],"reserved")
        self.assertIn("water",building["waitingReason"])
        model.economy.state["plants"][block]["water"]["enabled"] = True
        model.advance(1)
        self.assertEqual(building["lifecycle"],"connected")
        model.advance(VALUES["construction_ticks"])
        self.assertEqual(building["lifecycle"],"construction")
        model.advance(VALUES["construction_ticks"])
        self.assertEqual(building["lifecycle"],"open")
        self.assertEqual(building["builtAt"],model.clock["tick"])
        self.assertNotEqual(building["firstSeen"],data["nodes"][0]["modified"])
        self.assertEqual(model.audit(),[])

    def test_height_architecture_and_mixed_functions(self):
        model,data = self.make(120,6)
        original = deepcopy(model.state["buildings"])
        for node in data["nodes"]:
            node.update(words=node["words"]*1000000,degree=1000000,contentRevision="much-more-text")
        model.sync(data)
        for key,b in model.state["buildings"].items():
            self.assertLessEqual(b["floors"],VALUES["max_floors"])
            self.assertEqual(b["footprint"],original[key]["footprint"])
            self.assertEqual((b["family"],b["model"],b["era"]),(original[key]["family"],original[key]["model"],original[key]["era"]))
        self.assertGreaterEqual(len({b["model"] for b in model.state["buildings"].values()}),14)
        for centre in model.world.state["centres"].values():
            functions = {s["function"] for s in model.world.state["services"].values() if s["block"] == centre["block"]}
            self.assertTrue({"market","library","park"}.issubset(functions))

    def test_visit_arrival_dwell_and_return(self):
        model,data = self.make(2,1)
        commission(model)
        key = data["nodes"][0]["stableId"]
        agent = model.state["residents"][key]
        block = model.world.state["parcels"][model.state["buildings"][key]["parcel"]]["block"]
        self.assertTrue(model.activities.request(key,f"{block}:park"))
        for _ in range(2000):
            model.advance()
            if agent["state"] == "visiting":
                break
        self.assertEqual(agent["state"],"visiting")
        self.assertEqual(agent["trips"],1)
        model.advance(2)
        self.assertEqual(agent["state"],"visiting")
        for _ in range(2500):
            model.advance()
            if agent["state"] == "home":
                break
        self.assertEqual(agent["state"],"home")
        self.assertEqual(agent["node"],model.state["buildings"][key]["entrance"])
        self.assertFalse(any(e["type"] in TRANSIENT_EVENTS for e in model.state["events"]))
        self.assertEqual(model.audit(),[])

    def test_capacity_hours_and_fair_queue(self):
        model,data = self.make(3,1)
        commission(model)
        ids = [n["stableId"] for n in data["nodes"]]
        service = next(s for s in model.world.state["services"].values() if s["function"] == "park")
        service["capacity"] = 1
        # A window that excludes the current hour of the compressed day.
        hour = (VALUES["day_start_hour"]+model.clock["tick"]*VALUES["tick_ms"]/1000/VALUES["day_seconds"]*24)%24
        service["hours"] = [(int(hour)+2)%24,(int(hour)+2)%24+1]
        self.assertFalse(model.activities.request(ids[0],service["id"]))
        self.assertEqual(model.state["residents"][ids[0]]["reason"],"destination closed")
        service["hours"] = [0,24]
        self.assertTrue(model.activities.request(ids[0],service["id"]))
        self.assertFalse(model.activities.request(ids[1],service["id"]))
        self.assertFalse(model.activities.request(ids[2],service["id"]))
        for _ in range(6000):
            model.advance()
            self.assertLessEqual(len(service["occupants"])+len(service["reservations"]),1)
            if model.state["residents"][ids[2]]["trips"]:
                break
        self.assertGreater(model.state["residents"][ids[1]]["trips"],0)
        self.assertGreater(model.state["residents"][ids[2]]["trips"],0)
        self.assertEqual(model.audit(),[])

    def test_closure_waits_without_teleporting_and_recovers(self):
        model,data = self.make(2,1)
        commission(model)
        key = data["nodes"][0]["stableId"]
        agent = model.state["residents"][key]
        target = next(s["id"] for s in model.world.state["services"].values() if s["function"] == "park")
        model.activities.request(key,target)
        model.advance()
        before = model.activities.position(agent)
        edge = agent["route"]["edges"][agent["edge"]]
        model.world.walk.close(edge)
        model.advance()
        self.assertEqual(agent["state"],"waiting-route")
        self.assertEqual(model.activities.position(agent),before)
        model.world.walk.close(edge,False)
        for _ in range(2000):
            model.advance()
            if agent["state"] == "visiting":
                break
        self.assertEqual(agent["state"],"visiting")

    def test_redundant_street_network_survives_closure(self):
        model,_ = self.make(80,3)
        self.assertEqual(model.world.street.bridges(),[])
        blocks = list(model.world.state["blocks"].values())
        start,end = blocks[0]["streetCorners"][0],blocks[-1]["streetCorners"][0]
        route = model.world.street.route(start,end)
        self.assertIsNotNone(route)
        model.world.street.close(route["edges"][len(route["edges"])//2])
        self.assertIsNotNone(model.world.street.route(start,end))

    def test_transit_demand_seats_schedule_and_shutdown(self):
        model,data = self.make(64,1)
        commission(model)
        ids = [n["stableId"] for n in data["nodes"][:6]]
        origin = model.world.state["parcels"][model.state["buildings"][ids[0]]["parcel"]]["block"]
        candidates = [s for s in model.world.state["services"].values() if s["function"] == "park" and s["block"] != origin]
        target = max(candidates,key=lambda s:model.world.walk.route(model.state["residents"][ids[0]]["node"],s["entrance"])["length"])
        for key in ids:
            model.activities.request(key,target["id"])
        self.assertTrue(model.transit.state["lines"])
        line = next(iter(model.transit.state["lines"].values()))
        self.assertTrue(line["reason"])
        line["capacity"] = 1
        for _ in range(10000):
            model.advance()
            self.assertLessEqual(len(line["vehicle"]["passengers"]),1)
            if line["vehicle"]["passengers"]:
                break
        self.assertTrue(line["vehicle"]["passengers"])
        onboard = line["vehicle"]["passengers"][0]
        agent = model.state["residents"][onboard]
        before = model.activities.position(agent)
        model.transit.state["enabled"] = False
        model.advance(10)
        self.assertEqual(model.activities.position(agent),before)
        self.assertEqual(agent["state"],"riding")
        model.transit.state["enabled"] = True
        for _ in range(10000):
            model.advance()
            if agent["state"] != "riding":
                break
        self.assertNotEqual(agent["state"],"riding")
        self.assertEqual(model.audit(),[])

    def test_transit_runs_one_vehicle_per_forty_district_residents(self):
        model,data = self.make(64,1)
        commission(model)
        ids = [n["stableId"] for n in data["nodes"]]
        origin = model.world.state["parcels"][model.state["buildings"][ids[0]]["parcel"]]["block"]
        parks = [s for s in model.world.state["services"].values() if s["function"] == "park" and s["block"] != origin]
        target = max(parks,key=lambda s:model.world.walk.route(model.state["residents"][ids[0]]["node"],s["entrance"])["length"])
        for key in ids:
            model.activities.request(key,target["id"])
        self.assertTrue(model.transit.state["lines"])
        district = model.state["sources"][ids[0]]["class"]
        allowance = round(model._residents_in(district)/VALUES["transit_residents_per_bus"])
        self.assertGreaterEqual(allowance,1)
        # Old saves may hold more lines than the allowance: give the district extra ones and let the review retire them.
        for i in range(4):
            line = deepcopy(next(iter(model.transit.state["lines"].values())))
            line.update(id=f"extra:{i}",district=district);line["vehicle"].update(id=f"extra:{i}:vehicle",passengers=[],state="waiting")
            line["queues"] = [[],[]]
            model.transit.state["lines"][line["id"]] = line
        for _ in range(3000):
            model.advance()
        running = [l for l in model.transit.state["lines"].values() if l["enabled"] and model.transit.district(l) == district]
        self.assertLessEqual(len(running),allowance)
        self.assertTrue(any(l.get("retired") for l in model.transit.state["lines"].values()))
        live = model.live_presentation()["vehicles"]
        self.assertEqual(len(live),len(running))
        for v in live:
            self.assertIn("heading",v)
            if v["state"] == "moving":
                self.assertGreater(v["speed"],0);self.assertTrue(v["points"])
        self.assertEqual(model.audit(),[])

    def test_missing_restore_archive_and_rename_keep_history(self):
        model,data = self.make(8,1)
        commission(model)
        original = deepcopy(model.state["buildings"])
        key = data["nodes"][0]["stableId"]
        data["nodes"][0].update(archived=True,contentRevision="archived")
        model.sync(data)
        self.assertEqual(model.state["buildings"][key]["lifecycle"],"open")
        self.assertTrue(model.inspect(key)["uri"])
        missing_node = data["nodes"].pop(0)
        model.sync(data)
        self.assertIsNone(model.inspect(key)["uri"])
        self.assertFalse(model.state["residents"][key]["active"])
        self.assertEqual(model.snapshot()["knowledgePopulation"],7)
        missing_node.update(id="renamed.md",uri="obsidian://open?vault=fixture&file=renamed.md")
        data["nodes"].append(missing_node)
        model.sync(data)
        self.assertEqual(model.state["buildings"][key]["parcel"],original[key]["parcel"])
        self.assertEqual(model.state["buildings"][key]["builtAt"],original[key]["builtAt"])
        self.assertTrue(model.inspect(key)["uri"].endswith("renamed.md"))
        self.assertEqual(model.audit(),[])

    def test_resources_are_finite_conserved_and_separate(self):
        model,_ = self.make(8,1)
        commission(model)
        plants = next(iter(model.economy.state["plants"].values()))
        plants["water"]["enabled"] = False
        model.advance(round(VALUES["day_seconds"]*1000/VALUES["tick_ms"]))
        self.assertGreater(plants["water"]["unserved"],0)
        self.assertEqual(plants["energy"]["unserved"],0)
        self.assertEqual(model.economy.audit(),[])
        plants["water"]["enabled"] = True
        plants["waste"]["capacity"] = 0
        model.advance(round(VALUES["day_seconds"]*1000/VALUES["tick_ms"]))
        self.assertGreater(plants["waste"]["stock"],0)
        self.assertEqual(model.economy.audit(),[])

    def test_persistent_greenery_age_rain_and_materials(self):
        model,data = self.make(8,1)
        tick = model.clock["tick"]
        self.assertTrue(all(t["plantedAt"] <= tick for t in model.world.state["vegetation"].values()))
        self.assertTrue(all(p["createdAt"] <= tick for p in model.world.state["parcels"].values()))
        trees = deepcopy(model.world.state["vegetation"])
        for tree in trees.values():
            block_id = tree["id"].split(":tree:")[0]
            block = model.world.state["blocks"][block_id]
            for parcel_id in block["parcels"]:
                p = model.world.state["parcels"][parcel_id]
                self.assertFalse(inside((tree["x"],tree["y"]),p["footprint"]["polygon"]))
        model.state["weather"]["rain"] = 10
        model.advance(100)
        first = model.snapshot(full=True)
        self.assertTrue(all(t["growthStage"] == "young" for t in first["vegetationPresentation"].values()))
        self.assertEqual(first["ecology"]["rainInput"],first["ecology"]["runoff"]+first["ecology"]["infiltration"])
        model.sync(snapshot(108,1))
        for key,tree in trees.items():
            self.assertEqual(model.world.state["vegetation"][key],tree)
        self.assertTrue(all(b["materialAgeDays"] > 0 for key,b in first["buildingPresentation"].items()))

    def test_pause_reduced_motion_and_frame_independence(self):
        original,_ = self.make(8,1)
        a,b = Simulation(original.state),Simulation(original.state)
        for count,model in ((150,a),(300,b)):
            total = 5000
            chunks = [total//count+(1 if i < total%count else 0) for i in range(count)]
            for elapsed in chunks:
                model.advance_elapsed(elapsed)
        self.assertEqual(a.state,b.state)
        for control in ("paused","reducedMotion"):
            a.clock[control] = True
            before = deepcopy(a.state)
            a.advance(200)
            a.advance_elapsed(10000)
            self.assertEqual(a.state,before)
            a.clock[control] = False
        tick = a.clock["tick"]
        a.advance(1)
        self.assertEqual(a.clock["tick"],tick+1)

    def test_save_load_and_idempotent_events(self):
        model,data = self.make(16,2)
        model.advance(600)
        before = deepcopy(model.state)
        self.assertFalse(model.sync(data))
        self.assertEqual(model.state,before)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/"staged.json"
            model.save(path)
            restored = Simulation.load(path)
            self.assertEqual(restored.state,model.state)
            self.assertEqual(restored.clock["tick"],model.clock["tick"])
            model.advance(300)
            restored.advance(300)
            self.assertEqual(restored.state,model.state)
        self.assertEqual([e["id"] for e in model.state["events"]],list(range(1,len(model.state["events"])+1)))

    def test_hundred_days_no_spontaneous_city_or_punishment(self):
        model,_ = self.make(2,1)
        original = set(model.state["buildings"])
        model.advance(100*round(VALUES["day_seconds"]*1000/VALUES["tick_ms"]))
        self.assertEqual(set(model.state["buildings"]),original)
        self.assertTrue(all(s["available"] for s in model.state["sources"].values()))
        self.assertTrue(all(b["lifecycle"] == "open" for b in model.state["buildings"].values()))
        self.assertGreater(sum(a["trips"] for a in model.state["residents"].values()),0)
        self.assertEqual(model.audit(),[])

    def test_render_budget_does_not_invent_or_remove_agents(self):
        model,data = self.make(320,1)
        commission(model)
        for agent in model.state["residents"].values():
            agent["state"] = "planning"
        report = model.snapshot()
        self.assertEqual(report["knowledgePopulation"],320)
        self.assertEqual(len(report["visibleResidents"]),VALUES["visible_agents"])
        self.assertEqual(report["hiddenByBudget"],320-VALUES["visible_agents"])
        self.assertEqual(sum(report["residentStates"].values()),320)

    def test_parameters_are_declared_assumptions(self):
        for name,p in PARAMETERS.items():
            self.assertTrue(p["unit"],name)
            self.assertTrue(p["origin"],name)
            self.assertTrue(p["reason"],name)
            self.assertEqual(p["status"],"scenario-assumption")
        self.assertIn("new logical metres",self.make(1,1)[0].snapshot()["units"])

    def test_renovation_needs_local_capacity_and_credits(self):
        model,data = self.make(8,1)
        key = data["nodes"][0]["stableId"]
        b = model.state["buildings"][key]
        before = b["floors"]
        block = model.world.state["parcels"][b["parcel"]]["block"]
        water = model.economy.state["plants"][block]["water"]
        water["capacity"] = sum(v["serviceLoad"] for v in model.state["buildings"].values() if model.world.state["parcels"][v["parcel"]]["block"] == block)
        data["nodes"][0].update(words=10**12,degree=1000000,contentRevision="bigger")
        model.sync(data)
        self.assertEqual(b["floors"],before)
        self.assertIn("capacity",b["renovationPending"])
        water["capacity"] = VALUES["utility_capacity"]
        budget = model.state["budget"]
        budget["spent"] += budget["available"]
        budget["available"] = 0
        data["nodes"][0]["contentRevision"] = "bigger-again"
        model.sync(data)
        self.assertEqual(b["floors"],before)
        self.assertIn("credits",b["renovationPending"])
        self.assertEqual(model.audit(),[])

    def test_greenery_is_clear_of_paths(self):
        model,_ = self.make(30,3)
        nodes = model.world.walk.state["nodes"]
        for tree in model.world.state["vegetation"].values():
            for edge in model.world.walk.state["edges"].values():
                a,b = nodes[edge["a"]],nodes[edge["b"]]
                dx,dy = b["x"]-a["x"],b["y"]-a["y"]
                t = max(0,min(1,((tree["x"]-a["x"])*dx+(tree["y"]-a["y"])*dy)/(dx*dx+dy*dy or 1)))
                distance = math.hypot(tree["x"]-a["x"]-t*dx,tree["y"]-a["y"]-t*dy)
                self.assertGreater(distance,edge["width"]/2+1.5)

    def test_import_missing_legacy_source_without_fake_population(self):
        model,data = self.make(2,1)
        fresh = Simulation()
        ghost = deepcopy(data["nodes"].pop())
        ghost.update(sourcePath=ghost["id"],available=False,uri=None)
        data["cityState"] = {"missingSources":[ghost]}
        fresh.sync(data)
        self.assertEqual(fresh.snapshot()["knowledgePopulation"],1)
        self.assertEqual(fresh.snapshot()["missingBuildings"],1)
        self.assertIsNone(fresh.inspect(ghost["stableId"])["uri"])
        self.assertFalse(fresh.sync(data))
        self.assertEqual(fresh.audit(),[])

    def test_growth_rejects_unserviceable_infill(self):
        model = Simulation()
        data = snapshot(8,1)
        for node in data["nodes"]:
            node.update(words=10**12,degree=1000000)
        model.sync(data)
        self.assertEqual(len(model.world.state["blocks"]),2)
        reservations = [e for e in model.state["events"] if e["type"] == "parcelReserved"]
        self.assertTrue(any(e["considered"][0].get("rejectedByAccessOrCapacity",0) > 0 for e in reservations))
        commission(model)
        self.assertTrue(all(b["lifecycle"] == "open" for b in model.state["buildings"].values()))
        self.assertEqual(model.audit(),[])

    def test_reading_model_is_pure(self):
        model,_ = self.make(16,2)
        model.advance(120)
        before = deepcopy(model.state)
        for _ in range(3):
            model.snapshot(full=True)
            model.audit()
        self.assertEqual(model.state,before)

    def test_failed_allocation_is_atomic(self):
        model = Simulation()
        model.world.reserve_land(rect(-1000,-1000,2000,2000),"no developable initial terrain")
        before = deepcopy(model.state)
        with self.assertRaises(ValueError):
            model.sync(snapshot(1,1))
        self.assertEqual(model.state,before)
        self.assertEqual(model.state["budget"]["issued"],0)
        invalid = snapshot(2,1)
        invalid["nodes"][1]["stableId"] = invalid["nodes"][0]["stableId"]
        with self.assertRaises(ValueError):
            model.sync(invalid)
        self.assertEqual(model.state,before)

    def test_remote_city_has_functional_regional_connections(self):
        original = VALUES["regional_distance"]
        VALUES["regional_distance"] = 180
        try:
            model = Simulation()
            data = snapshot(200,1)
            model.sync(data)
            extra = deepcopy(data["nodes"][0])
            extra.update(id="satellite.md",stableId="satellite-source",district="satellite-class",kind="class")
            data["nodes"].append(extra)
            model.sync(data)
        finally:
            VALUES["regional_distance"] = original
        centre = model.world.state["centres"]["satellite-class"]
        self.assertEqual(centre["kind"],"satellite-city")
        self.assertTrue(centre["cityReason"])
        self.assertGreaterEqual(len(model.world.state["region"]["links"]),2)
        self.assertTrue(model.economy.state["plants"][centre["block"]])
        self.assertEqual(model.world.street.bridges(),[])
        self.assertEqual(model.audit(),[])
    def test_neighbour_blocks_share_one_street(self):
        model,_ = self.make(80,3)
        world = model.world
        edges,nodes = world.street.state["edges"],world.street.state["nodes"]
        for block in world.state["blocks"].values():
            for other in world.neighbours(*block["cell"])["next"]:
                neighbour = world.state["blocks"].get(f"block:{other[0]}:{other[1]}")
                if neighbour:
                    shared = set(block["streetCorners"]) & set(neighbour["streetCorners"])
                    self.assertEqual(len(shared),2)
        self.assertTrue(all(len(e["between"]) == 2 for e in edges.values()))
        midpoints = {}
        for key,edge in edges.items():
            a,b = nodes[edge["a"]],nodes[edge["b"]]
            midpoints[key] = ((a["x"]+b["x"])/2,(a["y"]+b["y"])/2)
        keys = sorted(midpoints)
        for index,first in enumerate(keys):
            for second in keys[index+1:]:
                if {edges[first]["a"],edges[first]["b"]} & {edges[second]["a"],edges[second]["b"]}:
                    continue
                self.assertGreater(math.dist(midpoints[first],midpoints[second]),5)
        self.assertEqual(model.audit(),[])
    def test_streets_render_as_continuous_ways(self):
        model,_ = self.make(80,3)
        street = model.world.street
        ways = street.ways()
        self.assertLess(len(ways),len(street.state["edges"])/2)
        self.assertEqual(sum(len(w["nodes"])-1 for w in ways),len(street.state["edges"]))
        nodes = street.state["nodes"]
        for way in ways:
            points = way["points"]
            for a,b,c in zip(points,points[1:],points[2:]):
                first = math.atan2(b[1]-a[1],b[0]-a[0])
                second = math.atan2(c[1]-b[1],c[0]-b[0])
                turn = abs(math.degrees(second-first))%360
                self.assertLessEqual(min(turn,360-turn),VALUES["stroke_angle"]+1e-9)

    def test_street_network_has_no_dead_ends_or_sharp_junctions(self):
        model,_ = self.make(100,4)
        metrics = model.world.street.metrics()
        self.assertEqual(metrics["deadEnds"],0)
        self.assertEqual(metrics["sharpJunctions"],[])
        self.assertEqual(metrics["connectedNodeRatio"],1.0)
        self.assertGreaterEqual(metrics["linkNodeRatio"],1.4)
        self.assertEqual(model.world.street.topology_errors(),[])
        self.assertEqual(model.world.walk.topology_errors(),[])

    def test_paths_and_promenades_join_sidewalks(self):
        model = river_band()
        walk = model.world.walk
        promenades = [e for e in walk.state["edges"].values() if e["kind"] == "promenade"]
        self.assertTrue(promenades)
        entrance = next(iter(model.world.state["parcels"].values()))["entrance"]
        reachable = walk.reachable(entrance)
        for edge in promenades:
            self.assertIn(edge["a"],reachable)
            self.assertIn(edge["b"],reachable)
        self.assertEqual(model.audit(),[])

    def test_river_is_a_persistent_tree(self):
        model = river_band(16)
        before = {r["id"]:r for r in model.world.rivers()}
        model.sync(snapshot(150,1))
        after = {r["id"]:r for r in model.world.rivers()}
        for key,river in before.items():
            overlap = [p for p in river["points"] if p in after[key]["points"]]
            self.assertGreater(len(overlap),len(river["points"])//3)
        downstream = {key:r["downstream"] for key,r in after.items()}
        for key in downstream:
            seen,current = set(),key
            while current:
                self.assertNotIn(current,seen)
                seen.add(current)
                current = downstream[current]
        self.assertEqual(set(after),{'river:inflow','river:urban-bend','river:outflow'})
        for river in after.values():
            self.assertEqual(river['order'],1,'a single channel has no invented confluence')
            if river['downstream']:
                self.assertEqual(river['points'][-1],after[river['downstream']]['points'][0])
    def test_river_corridor_is_protected(self):
        model = river_band()
        world = model.world
        for block in world.state["blocks"].values():
            self.assertIsNone(world.water(*block["cell"]))
        ring = VALUES["river_ring"]
        self.assertTrue(any(b["cell"][0] > ring and world.water(ring,world.cell_of(ring,world.cell_ticks(*b["cell"])[0])) for b in world.state["blocks"].values()))
        self.assertEqual(model.audit(),[])
    def test_bridges_are_square_and_redundant(self):
        model = river_band()
        street = model.world.street
        bridges = [k for k,e in street.state["edges"].items() if e["kind"] == "bridge"]
        self.assertGreaterEqual(len(bridges),2)
        self.assertEqual(street.bridges(),[])
        across = [b for b in model.world.state["blocks"].values() if b["cell"][0] > VALUES["river_ring"]]
        start = next(b for b in model.world.state["blocks"].values() if b["cell"][0] == 1)["streetCorners"][0]
        routes = [street.route(start,b["streetCorners"][2]) for b in across]
        route,end = next((r,b["streetCorners"][2]) for r,b in zip(routes,across) if r and any(k in bridges for k in r["edges"]))
        crossing = next(k for k in route["edges"] if k in bridges)
        street.close(crossing)
        self.assertIsNotNone(street.route(start,end))
        street.close(crossing,False)
        self.assertEqual(model.audit(),[])

    def test_square_and_town_hall_at_the_origin(self):
        model,_ = self.make(60,2)
        world = model.world
        plaza = next(z for z in world.state["protected"] if z["id"] == "plaza")
        hall = world.state["services"]["plaza:town-hall"]
        self.assertTrue(hall["derived"])
        distance = math.hypot(hall["footprint"]["x"]+hall["footprint"]["w"]/2,hall["footprint"]["y"]+hall["footprint"]["h"]/2)
        self.assertTrue(0.3*radius(1) < distance < radius(1))
        centre = world.walk.node(0.0,0.0)
        reachable = world.walk.reachable(centre)
        for block in world.state["blocks"].values():
            for key in block["parcels"]:
                self.assertIn(world.state["parcels"][key]["entrance"],reachable)
        ring_one = [b for b in world.state["blocks"].values() if b["cell"][0] == 1]
        self.assertTrue(ring_one)
        for block in ring_one:
            for corner in block["streetCorners"][:2]:
                node = world.street.state["nodes"][corner]
                self.assertTrue(radius(1)*0.9 < math.hypot(node["x"],node["y"]) < radius(1)*1.1)
        self.assertTrue(plaza["polygon"])
        self.assertEqual(model.audit(),[])

    def test_streets_are_not_a_single_grid(self):
        model,_ = self.make(300,3)
        self.assertLessEqual(model.orientation_order(),VALUES["orientation_order_max"])
        self.assertEqual(model.world.street.metrics()["sharpJunctions"],[])
        self.assertEqual(model.audit(),[])

    def test_blocks_grow_outward_without_slivers(self):
        model,_ = self.make(400,2)
        depths = [radius(i+1)-radius(i) for i in range(1,10)]
        self.assertEqual(depths,sorted(depths))
        world = model.world
        shortest = VALUES["min_block_arc"]*(1-VALUES["sector_jitter"])
        for i in range(2,10):
            for s in range(sectors(i)):
                a,b = world.cell_ticks(i,s)
                self.assertGreaterEqual(2*math.pi*radius(i)*(b-a)/TICKS,shortest-1e-6)
        self.assertEqual(model.audit(),[])
    def test_boulevard_on_the_wall_line(self):
        model,_ = self.make(200,1)
        world = model.world
        edges,nodes = world.street.state["edges"],world.street.state["nodes"]
        wall = radius(VALUES["wall_ring"])
        boulevard = [e for e in edges.values() if e["kind"] == "boulevard"]
        self.assertTrue(boulevard)
        for edge in boulevard:
            for end in (edge["a"],edge["b"]):
                self.assertAlmostEqual(math.hypot(nodes[end]["x"],nodes[end]["y"])/wall,1,delta=sum(w[1] for w in VALUES["ring_wobbles"])*1.5)
        self.assertTrue(any(t["role"] == "boulevard-allee" for t in world.state["vegetation"].values()))
        self.assertTrue(any(e["kind"] == "district" for e in edges.values()))
        self.assertEqual(model.audit(),[])

    def test_perimeter_buildings_face_their_street(self):
        model,_ = self.make(120,2)
        world = model.world
        nodes = world.walk.state["nodes"]
        for building in model.state["buildings"].values():
            parcel = world.state["parcels"][building["parcel"]]
            block = world.state["blocks"][parcel["block"]]
            door = nodes[building["entrance"]]
            centre = (building["footprint"]["cx"],building["footprint"]["cy"])
            own = {"inner":[c for c,p in zip(block["corridors"],world.pieces(*block["cell"])) if p["side"] == "inner"],
                   "outer":[c for c,p in zip(block["corridors"],world.pieces(*block["cell"])) if p["side"] == "outer"],
                   "start":block["corridors"][-2:-1],"end":block["corridors"][-1:]}[parcel["face"]]
            def gap(point):
                return min(polygon_segment_distance([list(point)]*3,a,b) for c in own for a,b in zip(c["points"],c["points"][1:]))
            self.assertLess(gap((door["x"],door["y"])),gap(centre))
            nearest = min(((a,b) for c in own for a,b in zip(c["points"],c["points"][1:])),
                          key=lambda s:polygon_segment_distance([list(centre)]*3,*s))
            street = math.atan2(nearest[1][1]-nearest[0][1],nearest[1][0]-nearest[0][0])
            turn = abs(math.degrees(street-building["footprint"]["angle"])) % 90
            self.assertLess(min(turn,90-turn),VALUES["bridge_skew"])

    def test_old_town_has_lanes_and_smaller_blocks(self):
        model,_ = self.make(300,1)
        wall = VALUES["wall_ring"]
        edges,nodes = model.world.street.state["edges"],model.world.street.state["nodes"]
        lanes = [e for e in edges.values() if e["kind"] == "pedestrian"]
        self.assertTrue(lanes)
        for edge in lanes:
            self.assertLess(math.hypot(nodes[edge["a"]]["x"],nodes[edge["a"]]["y"]),radius(wall)*(1+sum(w[1] for w in VALUES["ring_wobbles"]))+1)
        self.assertLess(max(radius(i+1)-radius(i) for i in range(1,wall)),min(radius(i+1)-radius(i) for i in range(wall,8)))

    def test_class_quarters_share_streets_around_one_core(self):
        model,_ = self.make(160,4)
        world = model.world
        self.assertEqual(len(world.state["centres"]),4)
        district = {f"{b['cell'][0]}:{b['cell'][1]}":b["district"] for b in world.state["blocks"].values()}
        mixed = [e for e in world.street.state["edges"].values() if all(c in district for c in e["between"]) and district[e["between"][0]] != district[e["between"][1]]]
        self.assertTrue(mixed)
        self.assertTrue(all(c["reason"] for c in world.state["centres"].values()))
        self.assertEqual(model.audit(),[])

    def test_quarters_form_clusters(self):
        model,_ = self.make(400,6)
        world = model.world
        blocks = world.state["blocks"]
        shares = []
        for block in blocks.values():
            near = [blocks.get(f"block:{c[0]}:{c[1]}") for cells in world.neighbours(*block["cell"]).values() for c in cells]
            near = [b for b in near if b]
            if near:
                shares.append(sum(b["district"] == block["district"] for b in near)/len(near))
        self.assertGreaterEqual(sum(shares)/len(shares),0.5)
        angles = sorted(math.atan2(c["y"],c["x"]) for c in world.state["centres"].values())
        gaps = [b-a for a,b in zip(angles,angles[1:])]+[2*math.pi-angles[-1]+angles[0]]
        self.assertGreater(min(gaps),math.radians(15))
        self.assertEqual(model.audit(),[])

    def test_quarter_has_one_architectural_family(self):
        model,_ = self.make(300,6)
        families = {}
        for building in model.state["buildings"].values():
            district = model.world.state["parcels"][building["parcel"]]["district"]
            families.setdefault(district,set()).add(building["family"])
        self.assertTrue(all(len(f) == 1 for f in families.values()))

    def test_mostly_t_junctions_and_through_historic_roads(self):
        model,_ = self.make(400,3)
        adjacency = model.world.street.adjacency()
        junctions = [len(v) for v in adjacency.values() if len(v) >= 3]
        self.assertLessEqual(sum(d >= 4 for d in junctions)/len(junctions),0.35)
        self.assertEqual(model.world.street.metrics()["deadEnds"],0)
        self.assertEqual(model.world.street.metrics()["sharpJunctions"],[])
        from simulation.world import historic, boundaries
        for i in range(1,8):
            self.assertTrue(set(historic()) <= set(boundaries(i)))
            if i > 1:
                self.assertGreater(len(set(boundaries(i))-set(historic())),0)

    def test_block_and_plot_widths_vary(self):
        model,_ = self.make(400,3)
        world = model.world
        arcs = [2*math.pi*radius(b["cell"][0])*(lambda r:r[1]-r[0])(world.cell_ticks(*b["cell"]))/TICKS for b in world.state["blocks"].values()]
        plots = [p["frontage"] for p in world.state["parcels"].values()]
        variation = lambda values:(sum((v-sum(values)/len(values))**2 for v in values)/len(values))**0.5/(sum(values)/len(values))
        self.assertGreaterEqual(variation(arcs),0.15)
        self.assertGreaterEqual(variation(plots),0.15)
        units = (VALUES["old_town_frontage"],VALUES["frontage"])
        for value in plots:
            self.assertTrue(any(abs(value/u*4-round(value/u*4)) < 1e-9 for u in units))

    def test_old_town_facades_are_continuous(self):
        model,_ = self.make(200,1)
        world = model.world
        checked = 0
        smallest = VALUES["old_town_frontage"]*min(VALUES["plot_width_steps"])
        for block in world.state["blocks"].values():
            if block["cell"][0] >= VALUES["wall_ring"]:
                continue
            parcels = [world.state["parcels"][k] for k in block["parcels"]]
            # Neighbours in a row: no plot would fit between them, so the facade must be continuous.
            for first,second in zip(parcels,parcels[1:]):
                if first["face"] != second["face"]:
                    continue
                house = first["footprint"]["polygon"]
                gap = min(polygon_segment_distance(second["footprint"]["polygon"],a,b) for a,b in zip(house,house[1:]+house[:1]))
                if gap < smallest:
                    # Curved rows fan slightly; the nominal 0.3 m gap stays within a metre.
                    self.assertLessEqual(gap,1.0)
                    checked += 1
        self.assertGreater(checked,20)
        self.assertEqual(model.audit(),[])

    def test_river_reaches_meander_inside_their_corridor(self):
        model = river_band()
        for river in model.world.rivers():
            if river["id"] in ("river:ring-upper","river:ring-lower"):
                continue
            points = river["points"]
            length = sum(math.dist(a,b) for a,b in zip(points,points[1:]))
            self.assertGreaterEqual(length/math.dist(points[0],points[-1]),1.05)
        self.assertEqual(model.audit(),[])

    def test_rings_wobble_on_several_scales(self):
        model,_ = self.make(300,2)
        for circle in range(2,6):
            radii = [math.hypot(*warp(radius(circle),k*TICKS/720)) for k in range(720)]
            mean = sum(radii)/len(radii)
            self.assertGreaterEqual(max(abs(r-mean) for r in radii)/mean,0.025)
        self.assertEqual(model.world.street.metrics()["sharpJunctions"],[])

    def test_projects_form_sub_quarters(self):
        model = Simulation()
        data = snapshot(160,1)
        for index,node in enumerate(data["nodes"]):
            node["project"] = "projects/tiny.md" if index in (0,10,20) else "projects/alpha/x.md" if index%2 else "projects/beta.md"
        model.sync(data)
        blocks = model.world.state["blocks"]
        quarters = {b["neighbourhood"] for b in blocks.values()}
        self.assertIn("projects/alpha",quarters)
        self.assertIn("projects/beta",quarters)
        self.assertNotIn("projects/tiny",quarters)
        for building in model.state["buildings"].values():
            parcel = model.world.state["parcels"][building["parcel"]]
            source = model.state["sources"][building["source"]]
            if source["project"] != "projects/tiny.md":
                self.assertEqual(blocks[parcel["block"]]["neighbourhood"],source["project"].removesuffix(".md").removesuffix("/x"))
        shares = []
        for block in blocks.values():
            if not block["neighbourhood"]:
                continue
            near = [blocks.get(f"block:{c[0]}:{c[1]}") for cells in model.world.neighbours(*block["cell"]).values() for c in cells]
            near = [b for b in near if b]
            if near:
                shares.append(sum(b["neighbourhood"] == block["neighbourhood"] for b in near)/len(near))
        self.assertGreaterEqual(sum(shares)/len(shares),0.5)
        self.assertEqual(model.audit(),[])

    def test_hundred_notes_of_one_project_grow_in_place(self):
        model = Simulation()
        data = snapshot(120,3)
        model.sync(data)
        commission(model)
        homes = deepcopy(model.state["buildings"])
        trees = deepcopy(model.world.state["vegetation"])
        parks = [deepcopy(z) for z in model.world.state["protected"] if z["id"].startswith("park:")]
        for index in range(100):
            node = deepcopy(data["nodes"][3])
            node.update(id=f"projects/gamma/{index}.md",stableId=f"gamma-{index}",project="projects/gamma.md",district=CLASSES[1],kind="note")
            data["nodes"].append(node)
        model.sync(data)
        blocks,parcels = model.world.state["blocks"],model.world.state["parcels"]
        self.assertGreaterEqual(sum(b["neighbourhood"] == "projects/gamma" for b in blocks.values()),2)
        for key,home in homes.items():
            self.assertEqual(model.state["buildings"][key]["footprint"],home["footprint"])
            self.assertEqual(model.state["buildings"][key]["parcel"],home["parcel"])
            self.assertEqual(model.state["buildings"][key]["entrance"],home["entrance"])
        for key,tree in trees.items():
            self.assertEqual(model.world.state["vegetation"][key],tree)
        for park in parks:
            self.assertIn(park,model.world.state["protected"])
            self.assertFalse(any(convex_overlap(park["polygon"],p["footprint"]["polygon"]) for p in parcels.values()))
        for index in range(100):
            block = blocks[parcels[model.state["buildings"][f"gamma-{index}"]["parcel"]]["block"]]
            self.assertEqual(block["district"],CLASSES[1])
        listed = list(blocks.values())
        for index,block in enumerate(listed):
            for other in listed[index+1:]:
                if block["district"] != other["district"]:
                    self.assertFalse(any(convex_overlap(parcels[a]["polygon"],parcels[b]["polygon"]) for a in block["parcels"] for b in other["parcels"]))
        metrics = model.world.street.metrics()
        self.assertEqual(metrics["deadEnds"],0)
        self.assertEqual(metrics["connectedNodeRatio"],1.0)
        self.assertEqual(model.world.street.topology_errors(),[])
        self.assertEqual(model.world.walk.topology_errors(),[])
        self.assertEqual(len(model.state["residents"]),220)
        self.assertEqual(model.audit(),[])

    def sized_snapshot(self):
        """Three classes of very different size, with two large projects in the biggest."""
        data = snapshot(300,1)
        for index,node in enumerate(data["nodes"]):
            node["district"] = "client-products" if index%10 < 6 else "education-and-research" if index%10 < 9 else "games"
            node["project"] = ("projects/alpha/x.md" if index%2 else "projects/beta.md") if node["district"] == "client-products" else ""
            node["kind"] = "hub" if index < 3 else "note"
            node["degree"] = 25 if index%17 == 0 else 0
        return data

    def test_classes_occupy_radial_wedges_by_size(self):
        from simulation.world import range_offset
        model = Simulation()
        model.sync(self.sized_snapshot())
        world = model.world
        wedges = world.state["wedges"]
        width = lambda w:(w[1]-w[0]) % TICKS
        self.assertGreater(width(wedges["client-products"]),width(wedges["education-and-research"]))
        self.assertGreater(width(wedges["education-and-research"]),width(wedges["games"]))
        inside = [range_offset(*world.cell_ticks(*b["cell"]),wedges[b["district"]]) == 0 for b in world.state["blocks"].values()]
        self.assertGreaterEqual(sum(inside)/len(inside),0.7)
        for district in wedges:
            self.assertTrue(any(b["cell"][0] <= 2 and b["district"] == district for b in world.state["blocks"].values()))
        self.assertEqual(model.audit(),[])

    def test_important_sources_sit_in_the_centre(self):
        model = Simulation()
        model.sync(self.sized_snapshot())
        rings = {True:[],False:[]}
        for building in model.state["buildings"].values():
            source = model.state["sources"][building["source"]]
            ring = model.world.state["blocks"][model.world.state["parcels"][building["parcel"]]["block"]]["cell"][0]
            rings[source["kind"] in ("class","hub","org") or source["degree"] >= 8].append(ring)
        self.assertLess(sum(rings[True])/len(rings[True]),sum(rings[False])/len(rings[False]))

    def test_projects_take_sub_wedges(self):
        from simulation.world import range_offset
        model = Simulation()
        model.sync(self.sized_snapshot())
        world = model.world
        subs = world.state["subWedges"]["client-products"]
        self.assertIn("projects/alpha",subs)
        own = [b for b in world.state["blocks"].values() if b["neighbourhood"] in ("projects/alpha","projects/beta")]
        inside = [range_offset(*world.cell_ticks(*b["cell"]),subs[b["neighbourhood"]]) == 0 for b in own]
        self.assertGreaterEqual(sum(inside)/len(inside),0.6)

class NetworkTests(unittest.TestCase):
    def test_geometric_crossing_is_not_a_junction(self):
        net = Network("P")
        a,b,c,d = [net.node(*p) for p in [(-10,0),(10,0),(0,-10),(0,10)]]
        net.edge(a,b)
        net.edge(c,d)
        self.assertIsNone(net.route(a,c))
        junction = net.node(0,0)
        net.edge(a,junction)
        net.edge(junction,c)
        self.assertIsNotNone(net.route(a,c))

    def test_levels_permissions_and_explicit_ramp(self):
        net = Network("S")
        ground,bridge = net.node(0,0),net.node(0,0,1)
        self.assertNotEqual(ground,bridge)
        with self.assertRaises(ValueError):
            net.edge(ground,bridge)
        net.edge(ground,bridge,kind="ramp",modes=("cycle",))
        self.assertIsNone(net.route(ground,bridge,"walk"))
        route = net.route(ground,bridge,"cycle")
        self.assertEqual(route["length"],VALUES["level_height"])

    def test_touching_edges_share_nodes(self):
        net = Network("P")
        a,b = net.node(0,0),net.node(10,0)
        net.edge(a,b)
        middle = net.node(5,0)
        self.assertEqual(len(net.route(a,b)["edges"]),2)
        top = net.node(5,5)
        net.edge(top,middle)
        left = net.node(2,-5)
        net.edge(left,net.node(2,5))
        self.assertTrue(any("crossing without junction" in e for e in net.topology_errors()))
        upper = Network("P")
        c,d = upper.node(0,0),upper.node(10,0)
        upper.edge(c,d)
        upper.edge(upper.node(5,-5,1),upper.node(5,5,1))
        self.assertEqual(upper.topology_errors(),[])
        through = Network("P")
        e,f = through.node(3,0),through.node(6,0)
        through.edge(through.node(0,0),through.node(10,0))
        self.assertEqual(len(through.state["edges"]),3)
        self.assertEqual(through.topology_errors(),[])


if __name__ == "__main__":
    unittest.main()
