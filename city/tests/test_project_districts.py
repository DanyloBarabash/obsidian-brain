"""Project identity, thematic grouping and safe growth across successive imports."""

from copy import deepcopy
import math
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from classification import SUBJECTS
from server import Vault
from simulation import Simulation
from simulation.clusters import audit_clusters
from simulation.profile import VALUES, convex_overlap, polygon_segment_distance
from simulation.world import TICKS, World, wedge_offset


class ProjectDistrictTests(unittest.TestCase):
    def hub(self,root,path,title,fields=""):
        file=root/path
        file.parent.mkdir(parents=True,exist_ok=True)
        file.write_text(f"---\nid: {path}\ntype: hub\nclass: education-and-research\n{fields}---\n# {title}\n")

    def test_growth_classifies_projects_without_merging_owners_or_addresses(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/"vault";root.mkdir()
            self.hub(root,"projects/sports.md","Спортивний центр","city_topic: sports\n")
            vault=Vault(root,Path(directory)/"state")
            model=Simulation();model.sync(vault.build())
            homes=deepcopy(model.state["buildings"])
            self.hub(root,"projects/swimming.md","Плавання")
            (root/"projects/swimming/notes").mkdir(parents=True)
            (root/"projects/swimming/notes/technique.md").write_text("# Техніка плавання")
            data=vault.build();model.sync(data)
            swim=next(n for n in data["nodes"] if n["id"]=="projects/swimming.md")
            self.assertEqual((swim["cityTopic"],swim["citySubject"],swim["cityLandmark"]),("sports","swimming","swimming-pool"))
            for source in model.state["sources"].values():
                if source["project"]=="projects/swimming.md":
                    block=model.world.state["blocks"][model.world.state["parcels"][model.state["buildings"][source["id"]]["parcel"]]["block"]]
                    self.assertEqual((block["district"],block["neighbourhood"]),("sports","projects/swimming"))
            pool=model.world.state["services"]["project-facility:"+swim["stableId"]]
            self.assertEqual(pool["project"],"projects/swimming.md")
            self.assertEqual(pool["siteVersion"],1)
            self.assertEqual((pool["footprint"]["fw"],pool["footprint"]["fd"]),(44,34))
            self.assertTrue(all(not convex_overlap(pool["footprint"]["polygon"],b["footprint"]["polygon"]) for b in model.state["buildings"].values()))
            self.hub(root,"projects/clinic.md","Медичні дослідження")
            data=vault.build();model.sync(data)
            clinic=next(n for n in data["nodes"] if n["id"]=="projects/clinic.md")
            self.assertEqual((clinic["cityTopic"],clinic["cityLandmark"]),("health","medical-centre"))
            self.assertIn("facility:health",model.world.state["services"])
            self.assertEqual(model.audit(),[])
            self.assertTrue(audit_clusters(model)["passed"],audit_clusters(model))
            for key,old in homes.items():
                self.assertEqual((old["parcel"],old["footprint"]),(model.state["buildings"][key]["parcel"],model.state["buildings"][key]["footprint"]))
            state=deepcopy(model.state)
            self.assertFalse(model.sync(Vault(root,Path(directory)/"state").build()))
            self.assertEqual(state,model.state)
            self.assertEqual(Simulation(state).state,state)

    def test_each_subject_project_owns_a_unique_landmark(self):
        functions = [function for _, function, _, _ in SUBJECTS.values()]
        self.assertEqual(len(functions),len(set(functions)))
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/"vault";root.mkdir()
            for path,title,domain in (("projects/memory.md","Memory","knowledge-management"),("projects/lab.md","Lab","lab-operations"),
                                      ("projects/club/plans.md","Plans","sports-ai"),("projects/club/vision.md","Vision","sports-computer-vision")):
                self.hub(root,path,title,f"city_topic: {'sports' if 'club' in path else 'technology'}\ndomain: {domain}\n")
            nodes={n["id"]:n for n in Vault(root,Path(directory)/"state").build()["nodes"]}
            self.assertEqual([nodes[p]["cityLandmark"] for p in ("projects/memory.md","projects/lab.md","projects/club/plans.md","projects/club/vision.md")],
                             ["memory-vault","lab-depot","practice-centre","motion-lab"])

    def test_city_quarter_groups_a_nested_hub_into_another_quarter(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/"vault";root.mkdir()
            self.hub(root,"projects/club/vision.md","Vision")
            self.hub(root,"projects/club/vision/assets.md","Assets","city_quarter: projects/club/vision\ncity_landmark: none\n")
            nodes={n["id"]:n for n in Vault(root,Path(directory)/"state").build()["nodes"]}
            self.assertEqual(nodes["projects/club/vision/assets.md"]["cityQuarter"],"projects/club/vision")
            self.assertEqual(nodes["projects/club/vision/assets.md"]["cityLandmark"],"")

    def test_project_building_is_a_bay_of_its_cluster_complex(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/"vault";root.mkdir()
            self.hub(root,"projects/sports.md","Спортивний центр","city_topic: sports\n")
            self.hub(root,"projects/team.md","Команда","city_topic: sports\ndomain: sports-technology\n")
            (root/"projects/team/notes").mkdir(parents=True)
            (root/"projects/team/notes/plan.md").write_text("# План тренувань")
            vault=Vault(root,Path(directory)/"state")
            data=vault.build();model=Simulation();model.sync(data);model.advance(200)
            team=next(n for n in data["nodes"] if n["id"]=="projects/team.md")
            self.assertEqual((team["citySubject"],team["cityLandmark"]),("sports-science","sports-lab"))
            world=model.world;services=world.state["services"]
            lab=services["project-facility:"+team["stableId"]];stadium=services["facility:sports"]
            self.assertEqual(lab["annexOf"],"facility:sports")
            bay,estate=world.state["parcels"][lab["parcel"]],world.state["parcels"][stadium["parcel"]]
            self.assertTrue(bay["id"].startswith("annex:"))
            self.assertFalse(convex_overlap(bay["polygon"],estate["polygon"]))
            gap=min(abs(a-b) for a in (bay["box"]["x"],bay["box"]["x"]+bay["box"]["w"]) for b in (estate["box"]["x"],estate["box"]["x"]+estate["box"]["w"]))
            self.assertLess(gap,VALUES["annex_reach"]+VALUES["annex_gap"]+1,"the bay stands beside its complex")
            self.assertTrue(all(not convex_overlap(lab["footprint"]["polygon"],b["footprint"]["polygon"]) for b in model.state["buildings"].values()))
            self.assertIsNotNone(world.walk.route(lab["entrance"],stadium["entrance"]),"the bay is reachable from the complex on foot")
            self.assertIn("projectAnnexFounded",[e["type"] for e in model.state["events"]])
            self.assertEqual(model.audit(),[])
            state=deepcopy(model.state);self.assertEqual(Simulation(state).state,state)

    def test_technology_complex_migrates_project_estates_without_moving_homes(self):
        from simulation.migrations import migrate
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/"vault";root.mkdir()
            for name in ("claude-brain","lab-track"):
                self.hub(root,f"projects/{name}.md",name,"city_topic: technology\n")
            sites={k:v for k,v in VALUES["landmark_sites"].items() if k!="technology"}
            with patch.dict(VALUES,{"landmark_sites":sites}):
                model=Simulation();model.sync(Vault(root,Path(directory)/"state").build());model.advance(100)
            homes=deepcopy(model.state["buildings"])
            model.state["layoutVersion"]=11
            self.assertTrue(migrate(model.state))
            model=Simulation(model.state)
            park=model.world.state["services"]["facility:technology"]
            self.assertEqual(park["siteVersion"],1)
            self.assertEqual([park["footprint"]["fw"],park["footprint"]["fd"]],[105,85])
            bays=[s for s in model.world.state["services"].values() if s.get("annexOf")==park["id"]]
            self.assertEqual({b["project"] for b in bays},{"projects/claude-brain.md","projects/lab-track.md"})
            for bay in bays:
                self.assertIsNotNone(model.world.walk.route(park["entrance"],bay["entrance"]))
            self.assertEqual(model.state["buildings"],homes)
            self.assertEqual(model.audit(),[])
            state=deepcopy(model.state)
            self.assertEqual(Simulation(state).state,state)

    def test_growth_fills_the_nearest_feasible_complex_band_before_cheaper_land(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/"vault";root.mkdir()
            self.hub(root,"projects/a.md","Технології","city_topic: technology\n")
            model=Simulation();model.sync(Vault(root,Path(directory)/"state").build())
            source=next(iter(model.state["sources"].values()))
            source={**source,"sourceClass":"technology","district":"technology","stableId":source["id"]}
            near=World(deepcopy(model.world.state),lambda *a,**kw:None)._new_block(source,0)
            with patch.dict(VALUES,{"landmark_growth_band":1e9}):
                cheap=World(deepcopy(model.world.state),lambda *a,**kw:None)._new_block(source,0)
            self.assertNotEqual(near["cell"],cheap["cell"],"the complex changes the actual growth decision")
            self.assertGreater(near["growth"]["score"],cheap["growth"]["score"],"nearby land wins even over a lower compactness score")
            box=model.world.state["parcels"][model.world.state["services"]["facility:technology"]["parcel"]]["box"]
            def distance(block):
                b=block["envelope"]
                return math.hypot(max(box["x"]-b["x"]-b["w"],0,b["x"]-box["x"]-box["w"]),max(box["y"]-b["y"]-b["h"],0,b["y"]-box["y"]-box["h"]))
            self.assertLess(distance(near),distance(cheap))
            homes=deepcopy(model.state["buildings"])
            model.world._new_block(source,0)
            self.assertEqual(model.state["buildings"],homes)
            self.assertEqual(model.audit(),[])
            self.assertTrue(audit_clusters(model)["passed"])

    def test_enclosed_class_grows_on_free_land_of_its_own_sector(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/"vault";root.mkdir()
            self.hub(root,"projects/sports.md","Спорт","city_topic: sports\n")
            self.hub(root,"projects/tech.md","Технології","city_topic: technology\n")
            model=Simulation();model.sync(Vault(root,Path(directory)/"state").build())
            source=next(s for s in model.state["sources"].values() if s["class"]=="sports")
            source={**source,"sourceClass":"sports","district":"sports","stableId":source["id"],"quarter":"","neighbourhoodSize":0}
            world=World(deepcopy(model.world.state),lambda *a,**kw:None)
            # No free cell touches a sports block, as when other districts surround the class.
            world.cluster_neighbours=lambda cell:set()
            passes=[];strict=world._new_block
            world._new_block=lambda src,tick,connected=True,bounded=True:(passes.append((connected,bounded)),strict(src,tick,connected,bounded))[1]
            block=world._new_block(source,0)
            self.assertEqual(passes,[(True,True),(False,True)],"the strict pass finds nothing, the sector pass places the quarter")
            self.assertEqual(block["district"],"sports")
            a,b=world.cell_ticks(*block["cell"])
            self.assertEqual(wedge_offset((a+b)/2,world.state["wedges"]["sports"]),0,"the quarter stays inside its own sector")
            # With no free cell left in the sector, the quarter crosses the boundary beside its own blocks.
            crowded=World(deepcopy(model.world.state),lambda *a,**kw:None)
            start=crowded.state["wedges"]["sports"][0];crowded.state["wedges"]["sports"]=[start,start+1]
            passes=[];strict=crowded._new_block
            crowded._new_block=lambda src,tick,connected=True,bounded=True:(passes.append((connected,bounded)),strict(src,tick,connected,bounded))[1]
            block=crowded._new_block(source,0)
            self.assertEqual(passes[:3],[(True,True),(False,True),(True,False)])
            self.assertEqual(block["district"],"sports")
            self.assertTrue(any(crowded.state["blocks"].get(f"block:{c[0]}:{c[1]}",{}).get("district")=="sports" for c in crowded.cluster_neighbours(tuple(block["cell"]))),"it stays beside its own class")

    def test_article_market_opens_on_the_civic_square(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/"vault";root.mkdir()
            self.hub(root,"projects/sports.md","Спортивний центр","city_topic: sports\n")
            model=Simulation();model.sync(Vault(root,Path(directory)/"state").build());model.advance(100)
            world=model.world;market=world.state["services"]["plaza:market"]
            self.assertEqual((market["function"],market["title"]),("article-market","Ринок статей"))
            self.assertTrue(all(math.hypot(x,y)<VALUES["plaza_radius"] for x,y in market["footprint"]["polygon"]),"the market stands on the square")
            others=[b["footprint"]["polygon"] for b in model.state["buildings"].values()]+[s["footprint"]["polygon"] for k,s in world.state["services"].items() if k!="plaza:market" and s.get("footprint")]
            self.assertTrue(all(not convex_overlap(market["footprint"]["polygon"],o) for o in others))
            self.assertIsNotNone(world.walk.route(world.state["services"]["plaza:town-hall"]["entrance"],market["entrance"]))
            self.assertIn("plaza:market",model.activities._landmarks("anything"),"every quarter can visit the market")
            self.assertEqual(model.audit(),[])

    def test_knowledge_library_reads_on_the_civic_square(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/"vault";root.mkdir()
            self.hub(root,"projects/sports.md","Спортивний центр","city_topic: sports\n")
            (root/"_global").mkdir()
            (root/"_global/library.md").write_text("---\ntype: hub\nknowledge_scope: library\ncity_role: knowledge-library\n---\n# Бібліотека знань\n",encoding="utf-8")
            model=Simulation();model.sync(Vault(root,Path(directory)/"state").build());model.advance(100)
            world=model.world;hall=world.state["services"]["plaza:library"]
            owner=next(k for k,s in model.state["sources"].items() if s.get("cityRole")=="knowledge-library")
            self.assertEqual((hall["function"],hall["owner"]),("knowledge-library",owner))
            self.assertTrue(all(math.hypot(x,y)<VALUES["plaza_radius"] for x,y in hall["footprint"]["polygon"]),"the library stands on the square")
            others=[b["footprint"]["polygon"] for b in model.state["buildings"].values()]+[s["footprint"]["polygon"] for k,s in world.state["services"].items() if k!="plaza:library" and s.get("footprint")]
            self.assertTrue(all(not convex_overlap(hall["footprint"]["polygon"],o) for o in others))
            self.assertIsNotNone(world.walk.route(world.state["services"]["plaza:town-hall"]["entrance"],hall["entrance"]))
            self.assertEqual(model.state["buildings"][owner]["model"],"archive","the first library building stays on as the stacks")
            self.assertIn("plaza:library",model.activities._landmarks("anything"))
            self.assertEqual(model.audit(),[])

    def test_reference_data_documents_farm_fields(self):
        from classification import reference_data
        doc = "projects/team/sdk/assets/documents/sprint.md"
        self.assertTrue(reference_data(doc, {"type":"document"}, "10m Sprint", 9), "a catalogue of parallel entries")
        self.assertTrue(reference_data("projects/team/documents/a.md", {"tags":"[sprint, kpi]"}, "Sprint", 1), "KPI reference data")
        self.assertTrue(reference_data("projects/team/documents/b.md", {}, "Payload — API Input Contract", 1), "a contract")
        self.assertFalse(reference_data("projects/team/documents/current-state.md", {"tags":"[kpi]"}, "Current state", 9), "current state is not data")
        self.assertFalse(reference_data("projects/team/documents/c.md", {}, "Architecture notes", 1), "an ordinary document")
        self.assertFalse(reference_data("projects/team/documents/d.md", {"tags":"[reference]"}, "Rules", 1, "council"), "civic documents keep their role")
        self.assertTrue(reference_data("projects/team/documents/c.md", {"city_field":"true"}, "Architecture notes", 1), "explicit opt-in")
        self.assertFalse(reference_data(doc, {"city_field":"false"}, "10m Sprint", 9), "explicit opt-out")
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/"vault";root.mkdir()
            self.hub(root,"projects/team.md","Команда","city_topic: sports\n")
            (root/"projects/team/documents").mkdir(parents=True)
            (root/"projects/team/documents/flags.md").write_text("---\ntype: document\ntags: [flags, kpi]\n---\n# Flags\n")
            (root/"projects/team/documents/overview.md").write_text("---\ntype: document\n---\n# Notes\n")
            nodes={n["id"]:n for n in Vault(root,Path(directory)/"state").build()["nodes"]}
            self.assertTrue(nodes["projects/team/documents/flags.md"]["cityField"])
            self.assertFalse(nodes["projects/team/documents/overview.md"]["cityField"])

    def test_project_hub_can_opt_out_of_its_landmark(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/"vault";root.mkdir()
            self.hub(root,"projects/sports.md","Спортивний центр","city_topic: sports\n")
            self.hub(root,"projects/team.md","Команда","city_topic: sports\n")
            (root/"projects/team/notes").mkdir(parents=True)
            (root/"projects/team/notes/plan.md").write_text("# План тренувань")
            vault=Vault(root,Path(directory)/"state")
            model=Simulation();model.sync(vault.build());model.advance(200)
            team=next(s for s in model.state["sources"].values() if s["path"]=="projects/team.md")
            identity="project-facility:"+team["id"]
            self.assertIn(identity,model.world.state["services"])
            site=model.world.state["services"][identity]["parcel"]
            homes=deepcopy(model.state["buildings"])
            self.hub(root,"projects/team.md","Команда","city_topic: sports\ncity_landmark: none\n")
            model.sync(vault.build());model.advance(50)
            self.assertNotIn(identity,model.world.state["services"])
            self.assertTrue(all(z.get("parcel")!=site for z in model.world.state["protected"]) or site not in model.world.state["parcels"])
            self.assertTrue(all(a.get("goal")!=identity for a in model.state["residents"].values()))
            self.assertEqual({k:(v["parcel"],v["footprint"]) for k,v in homes.items()},{k:(model.state["buildings"][k]["parcel"],model.state["buildings"][k]["footprint"]) for k in homes})
            self.assertIn("projectLandmarkRemoved",[e["type"] for e in model.state["events"]])
            self.assertEqual(model.audit(),[])
            state=deepcopy(model.state);self.assertEqual(Simulation(state).state,state)

    def test_nested_projects_keep_exact_quarters_and_custom_topics(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/"vault";root.mkdir()
            self.hub(root,"projects/team.md","Спорт","city_topic: sports\n")
            self.hub(root,"projects/team/pool.md","Плавання")
            self.hub(root,"projects/team/cycling.md","Велоспорт")
            self.hub(root,"projects/history.md","Археологія","city_topic: archaeology\ncity_topic_title: Археологія\ncity_landmark: district-hall\n")
            data=Vault(root,Path(directory)/"state").build()
            model=Simulation();model.sync(data)
            quarters={b["neighbourhood"] for b in model.world.state["blocks"].values()}
            self.assertTrue({"projects/team","projects/team/pool","projects/team/cycling","projects/history"}<=quarters)
            self.assertEqual(next(d for d in data["districts"] if d["id"]=="archaeology")["title"],"Археологія")
            self.assertTrue(audit_clusters(model)["passed"],audit_clusters(model))
            self.assertEqual(model.audit(),[])
            self.assertEqual(sum((b-a)%TICKS or TICKS for a,b in model.world.state["wedges"].values()),TICKS)

    def test_sub_project_buildings_are_wings_of_their_project_building(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/"vault";root.mkdir()
            self.hub(root,"projects/club.md","Клуб","city_topic: sports\n")
            self.hub(root,"projects/club/plans.md","Plans","city_topic: sports\ndomain: sports-ai\n")
            self.hub(root,"projects/club/vision.md","Vision","city_topic: sports\ndomain: sports-computer-vision\n")
            model=Simulation();model.sync(Vault(root,Path(directory)/"state").build())
            services=model.world.state["services"]
            parent=next(s for s in services.values() if s.get("landmark") and s.get("project")=="projects/club.md")
            wings=[s for s in services.values() if s.get("wingOf")==parent["id"]]
            self.assertEqual(sorted(w["function"] for w in wings),["motion-lab","practice-centre"])
            members=[parent]+wings
            for wing in wings:
                poly=wing["footprint"]["polygon"]
                gap=min(polygon_segment_distance(poly,a,b) for other in members if other is not wing
                        for a,b in zip(other["footprint"]["polygon"],other["footprint"]["polygon"][1:]+other["footprint"]["polygon"][:1]))
                # Side and back wings touch the compound at the wing gap; forecourt flanks stand across the gate line.
                self.assertLessEqual(gap,VALUES["landmark_site_margin"]+VALUES["wing_gap"]+1e-6)
            self.assertEqual(model.audit(),[])

    def test_wings_surround_the_project_building_like_a_campus(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/"vault";root.mkdir()
            self.hub(root,"projects/club.md","Клуб","city_topic: sports\n")
            for name,domain in (("plans","sports-ai"),("vision","sports-computer-vision"),("pool","swimming"),("cycle","cycling"),("medic","medicine")):
                self.hub(root,f"projects/club/{name}.md",name,f"city_topic: sports\ndomain: {domain}\ncity_subject: {'' if name in ('plans','vision') else domain if domain!='medicine' else 'medicine'}\n")
            model=Simulation();model.sync(Vault(root,Path(directory)/"state").build())
            parcels=model.world.state["parcels"]
            wings=[p for p in parcels.values() if p.get("wingFrame")]
            self.assertGreaterEqual(len(wings),4)
            self.assertGreaterEqual(len({p["wingFrame"].rstrip("+-") for p in wings}),2)
            self.assertEqual(model.world.walk.topology_errors(),[])
            self.assertEqual(model.audit(),[])

    def test_legacy_addresses_wait_for_explicit_rebuild(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/"vault";root.mkdir()
            self.hub(root,"projects/a.md","Спорт","city_topic: sports\n")
            vault=Vault(root,Path(directory)/"state")
            data=vault.build()
            for node in data["nodes"]:
                node.pop("cityQuarter",None)
            model=Simulation();model.sync(data)
            blocks=deepcopy(model.world.state["blocks"])
            data=Vault(root,Path(directory)/"state").build();model.sync(data)
            self.assertEqual(model.world.state["blocks"],blocks)
            source=next(iter(model.state["sources"].values()))
            self.assertEqual(source["plannedQuarter"],"projects/a")
            self.assertEqual(source["quarter"],"")
            self.assertTrue(audit_clusters(model)["passed"])
            rebuilt=Simulation();rebuilt.sync(data)
            self.assertEqual(next(iter(rebuilt.world.state["blocks"].values()))["neighbourhood"],"projects/a")
