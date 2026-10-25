"""Finite local utility throughput and conserved model-unit ledgers."""

from .profile import VALUES


RESOURCES = ("energy", "water", "waste", "maintenance")


class Economy:
    """Account for supplies, demand, unserved load and construction credits."""

    def __init__(self, state, world):
        self.state, self.world = state, world
        self._connected = {}
        self.loads = {}
        state.setdefault("plants", {})
        state.setdefault("lastDay", -1)

    def provision(self, block):
        """Create finite local capacity only when source demand creates a block."""
        plants = self.state["plants"].setdefault(block, {})
        for resource in RESOURCES:
            plants.setdefault(resource, {"enabled": True, "capacity": VALUES["utility_capacity"],
                "initial": 0, "produced": 0, "consumed": 0, "stock": 0, "overflow": 0,
                "unserved": 0, "lastDemand": 0, "unit": f"model {resource} units/activity day"})

    def reachable(self, parcel, resource):
        """Require an enabled plant and a real route in the resource's own graph."""
        plant = self.state["plants"][parcel["block"]][resource]
        if not plant["enabled"] or plant["capacity"] <= 0:
            return False
        block = self.world.state["blocks"][parcel["block"]]
        net = self.world.networks[f"U-{resource}"]
        return self.connected(net, block["utilityNodes"][resource], parcel["utilityNodes"][resource], resource)

    def connected(self, net, start, end, mode):
        """Route existence; a found route stays valid until some edge is closed, since growth only adds edges."""
        key = (net.kind, start, end, mode)
        if self._connected.get(key) == net.closures:
            return True
        found = net.route(start, end, mode) is not None
        if found:
            self._connected[key] = net.closures
        return found

    def can_open(self, parcel, buildings):
        """Reserve a bounded service envelope for both open and pending homes."""
        count = sum(buildings[key]["serviceLoad"] for key, _ in self.block_units(parcel["block"], buildings))
        for resource in RESOURCES:
            if not self.reachable(parcel, resource):
                return False, f"{resource}: unavailable connection"
            if count > self.state["plants"][parcel["block"]][resource]["capacity"]:
                return False, f"{resource}: local capacity full"
        return True, None

    def can_allocate(self, parcel, buildings, requested_load):
        """Reject an apparently vacant plot if its actual services cannot support it."""
        block = self.world.state["blocks"][parcel["block"]]
        # Loads do not change during one allocation; the engine resets `loads` before each one.
        load = self.loads.get(parcel["block"])
        if load is None:
            load = self.loads[parcel["block"]] = sum(buildings[key]["serviceLoad"] for key, _ in self.block_units(parcel["block"], buildings))
        if not self.connected(self.world.walk, parcel["entrance"], block["publicNode"], "walk"):
            return False
        return all(load+requested_load <= self.state["plants"][parcel["block"]][r]["capacity"] and self.reachable(parcel,r) for r in RESOURCES)

    def settle_day(self, day, buildings):
        """Conserve supply, consumption and backlog once per model activity day."""
        if day <= self.state["lastDay"]:
            return
        for block_id, plants in self.state["plants"].items():
            block = self.world.state["blocks"][block_id]
            homes = [dict(p, source=key) for key, p in self.block_units(block_id, buildings, open_only=True)]
            for resource, plant in plants.items():
                demand = sum(buildings[p["source"]]["serviceLoad"] for p in homes)*VALUES[f"{resource}_per_home"]
                reachable = sum(buildings[p["source"]]["serviceLoad"] for p in homes if self.reachable(p,resource))*VALUES[f"{resource}_per_home"]
                capacity = plant["capacity"] if plant["enabled"] else 0
                plant["lastDemand"] = demand
                if resource == "waste":
                    backlog = plant.setdefault("backlog",{})
                    for p in homes:
                        backlog[p["source"]] = backlog.get(p["source"],0)+buildings[p["source"]]["serviceLoad"]*VALUES["waste_per_home"]
                    plant["produced"] += demand
                    remaining = capacity
                    for source in sorted(backlog):
                        parcel = self.world.state["parcels"][buildings[source]["parcel"]]
                        if self.reachable(parcel,resource):
                            processed = min(backlog[source],remaining)
                            backlog[source] -= processed
                            remaining -= processed
                            plant["consumed"] += processed
                    plant["stock"] = sum(backlog.values())
                    plant["unserved"] = plant["stock"]
                else:
                    plant["produced"] += capacity
                    plant["stock"] += capacity
                    consumed = min(plant["stock"], demand, reachable)
                    plant["stock"] -= consumed
                    plant["consumed"] += consumed
                    plant["unserved"] = demand-consumed
                    overflow = max(0, plant["stock"]-2*VALUES["utility_capacity"])
                    plant["stock"] -= overflow
                    plant["overflow"] += overflow
        self.state["lastDay"] = day

    def block_units(self, block_id, buildings, open_only=False):
        """Enumerate real source units, including every occupied apartment once."""
        for parcel_id in self.world.state["blocks"][block_id]["parcels"]:
            parcel = self.world.state["parcels"][parcel_id]
            for key in parcel.get("sources", [parcel["source"]]):
                if key in buildings and buildings[key]["available"] and (not open_only or buildings[key]["lifecycle"] == "open"):
                    yield key, parcel

    def audit(self):
        """Check each resource independently; no negative queues or hidden money."""
        errors = []
        for block, plants in self.state["plants"].items():
            for resource, p in plants.items():
                if p["initial"]+p["produced"] != p["consumed"]+p["stock"]+p["overflow"]:
                    errors.append(f"{block}/{resource}: nonconserved ledger")
                if any(p[k] < 0 for k in ("capacity", "produced", "consumed", "stock", "overflow", "unserved")):
                    errors.append(f"{block}/{resource}: negative ledger")
        return errors
