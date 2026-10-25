"""Demand-backed thematic landmarks on actual reserved and reachable parcels."""

from copy import deepcopy

from .profile import VALUES
from .landmarks import annex, market_hall, town_hall, upgrade
from .precincts import sync as sync_precincts


FACILITIES = {
    "sports": ("stadium", "Стадіон і тренувальний центр"),
    "science": ("campus", "Науковий кампус"),
    "technology": ("innovation-centre", "Технопарк і центр винахідництва"),
    "energy": ("solar-centre", "Енергетичний центр"),
    "media": ("media-centre", "Медіацентр"),
    "games": ("arts-centre", "Творчий центр"),
    "health": ("medical-centre", "Медичний центр"),
    "culture": ("concert-hall", "Центр культури"),
}


def sync_facilities(model):
    """Reserve at most one non-source landmark for each explicitly themed district."""
    town_hall(model)
    market_hall(model)
    themes = dict(FACILITIES)
    for source in model.state["sources"].values():
        if source.get("topic") and source["class"] == source["topic"] and source["available"]:
            themes.setdefault(source["topic"], (source.get("landmark") or "district-hall", source.get("landmarkTitle") or source["title"]))
    for topic, (function, title) in themes.items():
        candidates = [s for s in model.state["sources"].values() if s["available"] and s.get("topic") == topic and s["class"] == topic]
        identity = "facility:"+topic
        if identity in model.world.state["services"]:
            upgrade(model,model.world.state["services"][identity])
        if not candidates or identity in model.world.state["services"]:
            continue
        vacant = [model.world.state["parcels"][key] for key in model.world.vacant.get(topic, set())]
        if not vacant or model.state["budget"]["available"] < VALUES["building_cost"]:
            continue
        parcel = min(vacant, key=lambda p:(-p["footprint"]["fw"], p["id"]))
        owner = min(candidates, key=lambda s:(not s.get("topicAnchor"), s["kind"] not in ("hub", "org"), s["id"]))
        parcel.update(protected=True, state="facility", facility=identity)
        model.world.vacant[topic].remove(parcel["id"])
        model.state["budget"]["available"] -= VALUES["building_cost"]
        model.state["budget"]["spent"] += VALUES["building_cost"]
        model.world.state["services"][identity] = {"id":identity,"derived":True,"source":None,"owner":owner["id"],
            "district":topic,"block":parcel["block"],"parcel":parcel["id"],"function":function,"title":title,"landmark":True,
            **({"siteSize":VALUES["project_landmark_sites"][function]} if topic not in VALUES["landmark_sites"] and function in VALUES["project_landmark_sites"] else {}),
            "footprint":deepcopy(parcel["footprint"]),"entrance":parcel["entrance"],"capacity":VALUES["service_capacity"],
            "hours":[6,22],"enabled":True,"occupants":[],"reservations":[],"queue":[],"state":"open",
            "reason":"Explicit project topic and available district demand; a reserved parcel with a real pedestrian entrance"}
        model.emit("thematicFacilityFounded",facility=identity,owner=owner["id"],reason="Shared thematic infrastructure on a reserved source-free parcel")
        upgrade(model,model.world.state["services"][identity])
    sync_projects(model)
    sync_precincts(model)


def sync_projects(model):
    """Give each project quarter a reachable landmark without inventing a source.

    Where the topic has a landmark complex (stadium, campus, energy centre), the project's building is a bay of that
    complex; older stand-alone project estates move into it once the complex exists. Other topics keep own sites.
    """
    world = model.world
    for owner in model.state["sources"].values():
        quarter = owner.get("quarter")
        if not (owner["available"] and quarter and owner.get("plannedQuarter") == quarter
                and owner["kind"] in ("hub", "org") and owner["path"] == owner["project"]):
            continue
        identity = "project-facility:"+owner["id"]
        existing = world.state["services"].get(identity)
        if existing and not owner.get("landmark"):
            remove_project_facility(model,identity)
            continue
        parent = world.state["services"].get("facility:"+owner["class"])
        clustered = owner["class"] in VALUES["landmark_sites"]
        ready = parent is not None and parent.get("siteVersion") == 1
        if existing and clustered and ready and not existing.get("annexOf"):
            remove_project_facility(model,identity,"The project building moves into its cluster landmark complex")
            existing = None
        if existing and existing.get("annexOf") and (existing["function"],existing["title"]) != (owner["landmark"],annex_title(owner)):
            # The bay keeps its place; a changed subject only changes what is built there.
            existing.update(function=owner["landmark"],title=annex_title(owner))
            model.emit("projectAnnexChanged",facility=identity,owner=owner["id"],function=owner["landmark"],reason="The project's subject changed")
        if existing:
            upgrade(model,existing)
            continue
        if not owner.get("landmark"):
            continue
        if clustered:
            if ready and model.state["budget"]["available"] >= VALUES["building_cost"]:
                found_annex(model,owner,identity,parent)
            continue
        vacant = [world.state["parcels"][key] for key in world.vacant.get(owner["class"], set())
                  if world.state["blocks"][world.state["parcels"][key]["block"]].get("neighbourhood") == quarter]
        if not vacant or model.state["budget"]["available"] < VALUES["building_cost"]:
            continue
        parcel = min(vacant,key=lambda p:(-p["footprint"]["fw"],p["id"]))
        parcel.update(protected=True,state="facility",facility=identity,project=owner["project"])
        world.vacant[owner["class"]].remove(parcel["id"])
        model.state["budget"]["available"] -= VALUES["building_cost"]
        model.state["budget"]["spent"] += VALUES["building_cost"]
        world.state["services"][identity] = {"id":identity,"derived":True,"source":None,"owner":owner["id"],
            "district":owner["class"],"project":owner["project"],"quarter":quarter,"subject":owner.get("subject", ""),
            "block":parcel["block"],"parcel":parcel["id"],"function":owner["landmark"],"title":owner["landmarkTitle"],"landmark":True,
            "footprint":deepcopy(parcel["footprint"]),"entrance":parcel["entrance"],"capacity":VALUES["service_capacity"],
            "hours":[6,22],"enabled":True,"occupants":[],"reservations":[],"queue":[],"state":"open",
            **({"siteSize":VALUES["project_landmark_sites"][owner["landmark"]]} if owner["landmark"] in VALUES["project_landmark_sites"] else {}),
            "reason":"A distinct project quarter owns this themed amenity and its real pedestrian entrance"}
        model.emit("projectLandmarkFounded",facility=identity,owner=owner["id"],project=owner["project"],reason="One landmark per exact project hub; district membership does not merge project ownership")
        upgrade(model,world.state["services"][identity])


def annex_title(owner):
    """Name a bay by its function and, when that differs, by its project."""
    return owner["landmarkTitle"] if owner["landmarkTitle"] == owner["title"] else f'{owner["landmarkTitle"]} · {owner["title"]}'


def found_annex(model, owner, identity, parent):
    """Build a project's own bay into its cluster landmark complex."""
    world = model.world
    size = VALUES["project_landmark_sites"].get(owner["landmark"], VALUES["annex_site"])
    parcel = annex(model,parent,identity,size,owner["project"])
    if parcel is None:
        return None
    model.state["budget"]["available"] -= VALUES["building_cost"]
    model.state["budget"]["spent"] += VALUES["building_cost"]
    service = {"id":identity,"derived":True,"source":None,"owner":owner["id"],"district":owner["class"],"project":owner["project"],
               "quarter":owner.get("quarter"),"subject":owner.get("subject", ""),"block":parcel["block"],"parcel":parcel["id"],
               "function":owner["landmark"],"landmark":True,"annexOf":parent["id"],"siteVersion":1,
               "title":annex_title(owner),
               "footprint":deepcopy(parcel["footprint"]),"entrance":parcel["entrance"],"capacity":VALUES["service_capacity"],
               "hours":[6,22],"enabled":True,"occupants":[],"reservations":[],"queue":[],"state":"open",
               "reason":"A project bay of its cluster landmark complex, on the complex's own front path"}
    world.state["services"][identity] = service
    model.emit("projectAnnexFounded",facility=identity,owner=owner["id"],project=owner["project"],complex=parent["id"],reason=service["reason"])
    upgrade(model,service)
    return service


def remove_project_facility(model, identity, reason="The project hub opted out with city_landmark: none"):
    """Retire a project landmark its hub opted out of: visitors go home, the site is freed, sources stay."""
    world = model.world
    service = world.state["services"][identity]
    for agent in model.state["residents"].values():
        if agent.get("goal") == identity:
            if agent.get("journey"):
                model.transit.remove(agent["id"])
            model.activities._return_home(agent)
    parcel = world.state["parcels"].get(service["parcel"])
    if parcel and parcel.get("facility") == identity:
        if parcel["id"].startswith(("estate:", "annex:")):
            # A dedicated estate exists only for its landmark; drop it with its protected approach.
            world.state["parcels"].pop(parcel["id"])
            block = world.state["blocks"].get(parcel["block"])
            if block and parcel["id"] in block["parcels"]:
                block["parcels"].remove(parcel["id"])
            world.state["protected"] = [z for z in world.state["protected"] if z.get("parcel") != parcel["id"]]
        else:
            parcel.update(protected=False,state="vacant")
            parcel.pop("facility",None)
            parcel.pop("project",None)
            world.vacant.setdefault(parcel["district"],set()).add(parcel["id"])
    del world.state["services"][identity]
    model.emit("projectLandmarkRemoved",facility=identity,owner=service["owner"],project=service.get("project"),reason=reason)
