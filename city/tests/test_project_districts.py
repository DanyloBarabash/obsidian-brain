"""Project identity, thematic grouping and safe growth across successive imports."""

from copy import deepcopy
import math
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server import Vault
from simulation import Simulation
from simulation.clusters import audit_clusters
from simulation.profile import VALUES, convex_overlap
from simulation.world import TICKS, wedge_offset


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
