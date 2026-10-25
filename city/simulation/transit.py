"""Demand-backed transit with stops, timetable, finite seats and real routes."""

import math

from .profile import VALUES, stable_hash


class Transit:
    """Run simple two-stop shuttles as real legs of resident journeys."""

    def __init__(self, state, world, emit, residents_in=lambda district: 0):
        self.state, self.world, self.emit = state, world, emit
        self.residents_in = residents_in
        state.setdefault("requests", {})
        state.setdefault("lines", {})
        state.setdefault("enabled", True)

    def allowance(self, district):
        """Vehicles a district may run: one per `transit_residents_per_bus` residents, rounded."""
        return round(self.residents_in(district)/VALUES["transit_residents_per_bus"])

    def district(self, line):
        """A line belongs to the district of the block where its first demand came from."""
        return line.get("district") or self.world.state["blocks"][line["blocks"][0]]["district"]

    def review(self):
        """Keep each district's best-used lines up to its allowance; others finish their trip and stop.

        A retired line is kept (hidden) so journeys that mention it stay valid; it may return when demand grows.
        """
        demand = {}
        for request in self.state["requests"].values():
            demand[request["line"]] = demand.get(request["line"], 0)+1
        by_district = {}
        for key, line in sorted(self.state["lines"].items()):
            by_district.setdefault(self.district(line), []).append(key)
        for district, keys in by_district.items():
            keep = set(sorted(keys, key=lambda k:(-demand.get(k, 0), k))[:self.allowance(district)])
            for key in keys:
                line = self.state["lines"][key]
                if key in keep:
                    line.pop("retire", None)
                    if not line["enabled"] and line.get("retired"):
                        line.update(enabled=True)
                        line.pop("retired", None)
                        self.emit("transitResumed", line=key, reason="District allowance grew")
                elif line["enabled"]:
                    line["retire"] = True

    def consider(self, resident, origin, destination, length, tick):
        """Create a line only after distinct long-trip requests justify it."""
        if origin == destination or length < VALUES["transit_threshold"] or not self.state["enabled"]:
            return None
        pair = sorted((origin,destination))
        key = "shuttle:"+str(stable_hash("|".join(pair)))
        self.state["requests"][resident] = {"line": key, "blocks": pair}
        if key not in self.state["lines"]:
            demand = sum(r["line"] == key for r in self.state["requests"].values())
            if demand < VALUES["transit_demand"]:
                return None
            district = self.world.state["blocks"][origin]["district"]
            running = sum(line["enabled"] and not line.get("retire") and self.district(line) == district for line in self.state["lines"].values())
            if running >= self.allowance(district):
                return None
            blocks = [self.world.state["blocks"][b] for b in pair]
            street_stops = [b["streetCorners"][0] for b in blocks]
            route = self.world.street.route(*street_stops, "transit")
            if route is None:
                return None
            walk_stops = []
            for block, street_stop in zip(blocks,street_stops):
                p = self.world.street.state["nodes"][street_stop]
                stop = self.world.walk.node(p["x"],p["y"])
                self.world.walk.edge(block["walkCorners"][0],stop,crossing=True,kind="signal-crossing")
                walk_stops.append(stop)
            self.state["lines"][key] = {"id": key, "derived": True, "enabled": True, "blocks": pair, "district": district,
                "stops": walk_stops, "streetStops": street_stops, "queues": [[],[]],
                "reason": f"{demand} distinct long-trip requests", "capacity": VALUES["transit_capacity"],
                "headwayTicks": round(VALUES["transit_headway"]*1000/VALUES["tick_ms"]),
                "vehicle": {"id":key+":vehicle","derived":True,"source":None,"stop": 0, "nextDeparture": tick+round(VALUES["transit_headway"]*1000/VALUES["tick_ms"]),
                            "state": "waiting", "passengers": [], "route": route, "edge": 0, "progress": 0}}
            self.emit("transitOpened", line=key, reason=self.state["lines"][key]["reason"])
        line = self.state["lines"][key]
        if not line["enabled"] or line.get("retire"):
            return None
        start = line["blocks"].index(origin)
        return {"line": key, "fromStop": start, "toStop": 1-start, "leg": "to-stop"}

    def remove(self, resident):
        """Remove only an unavailable resident's own seat and queue entries."""
        for line in self.state["lines"].values():
            for queue in line["queues"]:
                if resident in queue:
                    queue.remove(resident)
            if resident in line["vehicle"]["passengers"]:
                line["vehicle"]["passengers"].remove(resident)

    def motion(self, line_id):
        """Route ahead and heading of a vehicle, so clients can move it smoothly between refreshes."""
        line = self.state["lines"][line_id]
        bus, nodes = line["vehicle"], self.world.street.state["nodes"]
        route = bus["route"]
        here = self.position(line_id)
        edge = min(bus["edge"], len(route["edges"])-1) if route["edges"] else 0
        a, b = nodes[route["nodes"][edge]], nodes[route["nodes"][min(edge+1, len(route["nodes"])-1)]]
        heading = math.atan2(b["y"]-a["y"], b["x"]-a["x"]) if (a["x"], a["y"]) != (b["x"], b["y"]) else 0.0
        if bus["state"] != "moving":
            return {"speed": 0, "points": [], "heading": round(heading, 3)}
        ahead = route["nodes"][bus["edge"]+1:bus["edge"]+1+VALUES["live_route_nodes"]]
        return {"speed": VALUES["transit_speed"], "points": [[round(nodes[n]["x"], 2), round(nodes[n]["y"], 2)] for n in ahead],
                "heading": round(heading, 3), **{k: round(v, 2) for k, v in here.items()}}

    def position(self, line_id):
        """Expose the actual vehicle position for onboard residents."""
        line = self.state["lines"][line_id]
        bus = line["vehicle"]
        if bus["state"] == "waiting":
            p = self.world.street.state["nodes"][line["streetStops"][bus["stop"]]]
            return {"x":p["x"],"y":p["y"]}
        return self.world.street.position(bus["route"],bus["edge"],bus["progress"])

    def step(self, tick, residents, alight):
        """Board on schedule, travel along permitted street edges and alight at stops."""
        if tick % max(1, round(VALUES["transit_review"]*1000/VALUES["tick_ms"])) == 0:
            self.review()
        for line in self.state["lines"].values():
            bus = line["vehicle"]
            if not self.state["enabled"] or not line["enabled"]:
                if not line.get("retired"):
                    bus["reason"] = "transit suspended; onboard residents remain at the vehicle"
                continue
            bus.pop("reason",None)
            if bus["state"] == "waiting":
                if line.get("retire") and not bus["passengers"]:
                    # Over the district allowance: stop at this stop; queued residents walk instead.
                    line.update(enabled=False,retired=True)
                    line.pop("retire",None)
                    self.emit("transitRetired",line=line["id"],reason="One vehicle per district allowance of residents")
                    continue
                if tick < bus["nextDeparture"]:
                    continue
                queue = line["queues"][bus["stop"]]
                while queue and len(bus["passengers"]) < line["capacity"]:
                    resident_id = queue.pop(0)
                    agent = residents.get(resident_id)
                    if agent and agent["active"] and agent["state"] == "waiting-transit":
                        bus["passengers"].append(resident_id)
                        agent["state"] = "riding"
                        agent["reason"] = None
                route = self.world.street.route(line["streetStops"][bus["stop"]],line["streetStops"][1-bus["stop"]],"transit")
                if route is None:
                    bus["reason"] = "no permitted street route"
                    continue
                bus.update(state="moving",route=route,edge=0,progress=0)
                self.emit("transitDeparted",line=line["id"],passengers=len(bus["passengers"]))
            distance = VALUES["transit_speed"]*VALUES["tick_ms"]/1000
            while distance > 1e-9 and bus["edge"] < len(bus["route"]["edges"]):
                edge = self.world.street.state["edges"][bus["route"]["edges"][bus["edge"]]]
                if not edge["enabled"] or "transit" not in edge["modes"]:
                    bus["reason"] = "closed street; wait without teleporting"
                    if bus["progress"] == 0:
                        route = self.world.street.route(bus["route"]["nodes"][bus["edge"]],line["streetStops"][1-bus["stop"]],"transit")
                        if route:
                            bus.update(route=route,edge=0,progress=0)
                    break
                movement = min(distance,edge["length"]-bus["progress"])
                bus["progress"] += movement
                distance -= movement
                if bus["progress"] >= edge["length"]-1e-9:
                    bus["edge"] += 1
                    bus["progress"] = 0
            if bus["edge"] == len(bus["route"]["edges"]):
                bus["stop"] = 1-bus["stop"]
                bus.update(state="waiting",nextDeparture=tick+line["headwayTicks"])
                for resident in bus["passengers"]:
                    alight(resident,line["stops"][bus["stop"]])
                self.emit("transitArrived",line=line["id"],passengers=len(bus["passengers"]))
                bus["passengers"] = []
