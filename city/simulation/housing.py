"""Real shared parcels with stable source apartments and bounded occupancy."""

from .profile import VALUES


def apartment(source):
    """Low-priority session sources share a house within their exact project."""
    return source["kind"] == "session" and (source.get("importance") or 0) < 2


def library(source):
    """Project-free library sources share bounded collection buildings."""
    return source.get('cityRole') in ('knowledge-library','library-item') and not source.get('project')


def ideas(source):
    """Ideas live together inside the Mountain of Ideas instead of separate houses."""
    return source.get('cityRole') in ('idea-mountain', 'idea')


def priority(source):
    """Settle anchors and maintained references before ordinary notes and history."""
    rank = 0 if source.get("cityRole") == "town-hall" else 1 if source.get("topicAnchor") else 2 if source["kind"] == "class" else 3 if source["kind"] in ("hub", "org") else 4+(3-(source.get("importance") if source.get("importance") is not None else 1))
    return rank, -source.get("degree", 0), source["id"]


def group_key(source):
    """Keep distinct project owners and themes out of each other's apartments."""
    return source["class"]+"|"+('library' if library(source) else 'ideas' if ideas(source) else source.get("project") or "global")


def existing(model, source, load):
    """Find a supplied tower with an unused, non-recycled apartment slot."""
    if not (apartment(source) or library(source) or ideas(source)):
        return None
    for house in model.state.setdefault("housing", {}).values():
        parcel = model.world.state["parcels"][house["parcel"]]
        if house["group"] == group_key(source) and len(house["sources"]) < house["capacity"] and model.economy.can_allocate(parcel, model.state["buildings"], load):
            return parcel
    return None


def assign(model, source, parcel):
    """Reserve one apartment, retaining the physical house and all historical units."""
    key = source["id"]
    parcel.setdefault("sources", [parcel["source"]] if parcel["source"] else [])
    if key not in parcel["sources"]:
        parcel["sources"].append(key)
    if not (apartment(source) or library(source) or ideas(source)):
        return "building:"+key, None
    physical = ('collection:' if library(source) else 'ideas:' if ideas(source) else 'residence:')+parcel["id"]
    house = model.state.setdefault("housing", {}).setdefault(physical, {"id": physical, "parcel": parcel["id"], "group": group_key(source), "sources": [], "capacity": VALUES['library_collection_capacity'] if library(source) else VALUES['idea_mountain_capacity'] if ideas(source) else VALUES["apartments_per_house"]})
    if key not in house["sources"]:
        house["sources"].append(key)
    return physical, house["sources"].index(key)+1
