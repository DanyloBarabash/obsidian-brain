"""Purposeful knowledge residents, reservations, visits and physical journeys."""

import math

from .profile import VALUES, stable_hash


class Activities:
    """Drive resident state independently of drawing and computer wall time."""

    def __init__(self, residents, buildings, world, economy, transit, clock, emit):
        self.residents, self.buildings, self.world = residents, buildings, world
        self.economy, self.transit, self.clock, self.emit = economy, transit, clock, emit
        self.knowledge = {}

    def is_open(self, service):
        """Respect enabled state, actual building lifecycle, hours and local supplies."""
        if not service["enabled"]:
            return False
        source = service.get("source")
        if source and (not self.buildings[source]["available"] or self.buildings[source]["lifecycle"] != "open"):
            return False
        hour = self._hour()
        if not (service["hours"][0] <= hour < service["hours"][1]):
            return False
        if service["function"] != "park":
            plants = self.economy.state["plants"][service["block"]]
            if not all(plants[r]["enabled"] and plants[r]["capacity"] > 0 for r in ("energy","water")):
                return False
        return True

    def _hour(self):
        """Hour of the compressed day, computed once per tick."""
        tick = self.clock["tick"]
        if getattr(self, "_hour_tick", None) != tick:
            self._hour_tick = tick
            self._hour_value = (VALUES["day_start_hour"]+tick*VALUES["tick_ms"]/1000/VALUES["day_seconds"]*24)%24
        return self._hour_value

    def service_state(self, service):
        """Diagnostic state, derived on request instead of rewritten for every service on every tick."""
        if not self.is_open(service):
            return "closed"
        return "full" if len(service["occupants"])+len(service["reservations"]) >= service["capacity"] else "open"

    def _landmarks(self, district):
        """Landmark services of a district, re-indexed only when the service set grows."""
        services = self.world.state["services"]
        if getattr(self, "_landmark_size", None) != len(services):
            self._landmark_size = len(services)
            self._landmark_index = {}
            for key, service in services.items():
                if service.get("landmark") or service.get("place"):
                    self._landmark_index.setdefault(service.get("district"), []).append(key)
                if service.get('publicLibrary') or service.get('publicMarket'):
                    self._landmark_index.setdefault('*', []).append(key)
        return self._landmark_index.get(district, [])+self._landmark_index.get('*', [])

    def release(self, agent, keep_queue=False):
        """Release this resident's own capacity claim and queue position."""
        agent.pop("visitNode", None)
        service = self.world.state["services"].get(agent.get("goal"))
        if service:
            for field in (("occupants","reservations") if keep_queue else ("occupants","reservations","queue")):
                if agent["id"] in service[field]:
                    service[field].remove(agent["id"])

    def deactivate(self, agent):
        """Suspend only the unavailable source's resident; preserve the home."""
        self.release(agent)
        self.transit.remove(agent["id"])
        agent.update(active=False,state="unavailable",goal=None,reason="source unavailable")

    def _walk_to(self, agent, destination, returning=False):
        """Start a network journey at the current node, never at a fabricated point."""
        route = self.world.walk.route(agent["node"],destination)
        if route is None:
            agent.update(state="waiting",reason="no reachable pedestrian route",nextDecision=self.clock["tick"]+self._retry())
            return False
        agent.update(route=route,edge=0,progress=0,state="returning" if returning else "walking",reason=None)
        self.emit("tripStarted",source=agent["id"],goal=agent.get("goal"),distance=route["length"],unit="logical metres",purpose=agent.get("purpose"))
        return True

    def _retry(self):
        """Convert the scenario wait duration into fixed logical ticks."""
        return round(VALUES["retry_seconds"]*1000/VALUES["tick_ms"])

    def request(self, resident, target, allow_transit=True):
        """Reserve capacity and plan an actual destination-based visit."""
        agent = self.residents[resident]
        if not agent["active"] or agent["state"] in ("walking","returning","riding","waiting-transit"):
            return False
        service = self.world.state["services"][target]
        self.release(agent,keep_queue=agent.get("goal") == target)
        agent.update(goal=target,journey=None,purpose=service["function"])
        if not self.is_open(service):
            reason = "destination closed"
        elif len(service["occupants"])+len(service["reservations"]) >= service["capacity"]:
            reason = "destination full"
        elif service["queue"] and service["queue"][0] != resident:
            reason = "waiting for earlier visitors"
        else:
            reason = None
        if reason:
            if resident not in service["queue"]:
                service["queue"].append(resident)
            agent.update(state="waiting",reason=reason,nextDecision=self.clock["tick"]+self._retry())
            return False
        destination = service["entrance"]
        if service.get("seats"):
            claimed = {self.residents[key].get("visitNode") for key in service["occupants"]+service["reservations"]}
            destination = next((seat for seat in service["seats"] if seat not in claimed), None)
            if destination is None:
                return False
        route = self.world.walk.route(agent["node"],destination)
        if route is None:
            agent.update(state="waiting",reason="no reachable pedestrian route",nextDecision=self.clock["tick"]+self._retry())
            return False
        agent["visitNode"] = destination
        service["reservations"].append(resident)
        if resident in service["queue"]:
            service["queue"].remove(resident)
        if allow_transit:
            home = self.world.state["parcels"][self.buildings[resident]["parcel"]]
            journey = self.transit.consider(resident,home["block"],service["block"],route["length"],self.clock["tick"])
            if journey:
                line = self.transit.state["lines"][journey["line"]]
                # Access to both stops and from the second stop to the target is required.
                if self.world.walk.route(agent["node"],line["stops"][journey["fromStop"]]) and self.world.walk.route(line["stops"][journey["toStop"]],service["entrance"]):
                    agent["journey"] = journey
                    return self._walk_to(agent,line["stops"][journey["fromStop"]])
        return self._walk_to(agent,destination)

    def _choose(self, agent):
        """Use explicit links and fictional activity seeds, never personal profiling."""
        home = self.buildings[agent["id"]]
        block = self.world.state["parcels"][home["parcel"]]["block"]
        services = self.world.state["services"]
        linked = ["building:"+key for key in self.knowledge.get(agent["id"],[]) if "building:"+key in services]
        local = [f"{block}:{kind}" for kind in ("library","market","park")]
        local += self._landmarks(self.world.state["blocks"][block]["district"])
        choices = linked[:4]+local
        # Residents plan only visits that can happen now; otherwise they stay home and decide later.
        choices = [key for key in choices if services[key].get("source") != agent["id"] and self.is_open(services[key])
                   and len(services[key]["occupants"])+len(services[key]["reservations"]) < services[key]["capacity"]]
        if not choices:
            return None
        # Stable differing activity chains; the next visit is not a local oscillation.
        index = (stable_hash(agent["id"])+agent["trips"])%len(choices)
        return choices[index]

    def _return_home(self, agent):
        """Release a visit and physically return through the entrance graph."""
        self.release(agent)
        agent.update(goal=None,journey=None,purpose="home")
        home = self.buildings[agent["id"]]
        return self._walk_to(agent,self.world.state["parcels"][home["parcel"]]["entrance"],returning=True)

    def _arrive(self, agent):
        """Complete a walk leg, board queue, visit or homecoming at a real node."""
        journey = agent.get("journey")
        if journey and journey["leg"] == "to-stop":
            line = self.transit.state["lines"][journey["line"]]
            queue = line["queues"][journey["fromStop"]]
            if agent["id"] not in queue:
                queue.append(agent["id"])
            agent.update(state="waiting-transit",reason="waiting for scheduled departure")
            return
        if agent["state"] == "returning" or agent.get("goal") is None:
            agent.update(state="home",route=None,goal=None,journey=None,reason=None,
                         nextDecision=self.clock["tick"]+self._retry()*(2+stable_hash(agent["id"]+str(agent["trips"]))%4))
            self.emit("tripArrived",source=agent["id"],purpose="home")
            return
        service = self.world.state["services"][agent["goal"]]
        if not self.is_open(service):
            self._return_home(agent)
            return
        if agent["id"] in service["reservations"]:
            service["reservations"].remove(agent["id"])
        if len(service["occupants"]) >= service["capacity"]:
            agent.update(state="waiting",reason="destination full",route=None,nextDecision=self.clock["tick"]+self._retry())
            return
        service["occupants"].append(agent["id"])
        duration = VALUES["visit_seconds"]+stable_hash(agent["id"]+str(agent["trips"]))%int(VALUES["visit_seconds"])
        agent.update(state="visiting",route=None,journey=None,trips=agent["trips"]+1,
                     leaveAt=self.clock["tick"]+round(duration*1000/VALUES["tick_ms"]),reason=None)
        self.emit("tripArrived",source=agent["id"],goal=agent["goal"],purpose=agent["purpose"])

    def alight(self, resident, stop):
        """Continue on foot from the actual arrival stop, retaining the destination."""
        agent = self.residents[resident]
        agent["node"] = stop
        journey = agent.get("journey")
        if journey:
            journey["leg"] = "from-stop"
        target = self.world.state["services"].get(agent.get("goal"))
        if target and self.is_open(target):
            self._walk_to(agent,agent.get("visitNode",target["entrance"]))
        else:
            self._return_home(agent)

    def _walk_step(self, agent):
        """Consume distance along edges, replan at nodes or wait mid-edge safely."""
        route = agent["route"]
        distance = agent["speed"]*VALUES["tick_ms"]/1000
        while distance > 1e-9 and agent["edge"] < len(route["edges"]):
            edge = self.world.walk.state["edges"][route["edges"][agent["edge"]]]
            if not edge["enabled"] or "walk" not in edge["modes"]:
                if agent["progress"] == 0:
                    destination = route["nodes"][-1]
                    alternative = self.world.walk.route(agent["node"],destination)
                    if alternative:
                        agent.update(route=alternative,edge=0,progress=0)
                        route = alternative
                        continue
                agent.update(state="waiting-route",reason="closed path; position preserved")
                return
            move = min(distance,edge["length"]-agent["progress"])
            agent["progress"] += move
            distance -= move
            if agent["progress"] >= edge["length"]-1e-9:
                agent["edge"] += 1
                agent["progress"] = 0
                agent["node"] = route["nodes"][agent["edge"]]
        if agent["edge"] == len(route["edges"]):
            self._arrive(agent)

    def position(self, agent):
        """Return physical state in logical metres, independent of rendering budget."""
        if agent["state"] == "riding":
            return self.transit.position(agent["journey"]["line"])
        if agent.get("route"):
            return self.world.walk.position(agent["route"],agent["edge"],agent["progress"])
        node = self.world.walk.state["nodes"][agent["node"]]
        return {"x":node["x"],"y":node["y"]}

    def step(self):
        """Advance distinct activity chains while preserving reservations and counts."""
        tick = self.clock["tick"]
        self.transit.step(tick,self.residents,self.alight)
        for agent in self.residents.values():
            if not agent["active"]:
                continue
            if self.buildings[agent["id"]]["lifecycle"] != "open":
                agent["state"] = "awaiting-home"
                continue
            if agent["state"] == "awaiting-home":
                agent.update(state="home",reason=None,nextDecision=tick+1+stable_hash(agent["id"])%max(1,round(VALUES["day_seconds"]*1000/VALUES["tick_ms"]/8)))
            if agent["state"] in ("walking","returning"):
                self._walk_step(agent)
            elif agent["state"] == "waiting-route":
                route = agent.get("route")
                edge = self.world.walk.state["edges"][route["edges"][agent["edge"]]]
                if edge["enabled"]:
                    agent["state"] = "returning" if agent.get("goal") is None else "walking"
                elif agent["progress"] == 0:
                    alternative = self.world.walk.route(agent["node"],route["nodes"][-1])
                    if alternative:
                        agent.update(route=alternative,edge=0,progress=0,state="returning" if agent.get("goal") is None else "walking",reason=None)
            elif agent["state"] == "waiting-transit":
                line = self.transit.state["lines"][agent["journey"]["line"]]
                if not self.transit.state["enabled"] or not line["enabled"]:
                    self.transit.remove(agent["id"])
                    agent["journey"] = None
                    target = self.world.state["services"][agent["goal"]]
                    self._walk_to(agent,agent.get("visitNode",target["entrance"]))
            elif agent["state"] == "visiting":
                service = self.world.state["services"][agent["goal"]]
                if tick >= agent["leaveAt"] or not self.is_open(service):
                    self._return_home(agent)
            elif agent["state"] in ("home","waiting") and tick >= agent["nextDecision"]:
                target = agent.get("goal") or self._choose(agent)
                if target:
                    agent.update(state="planning",plannedTarget=target,nextDecision=tick+1)
                else:
                    agent["nextDecision"] = tick+self._retry()
            elif agent["state"] == "planning" and tick >= agent["nextDecision"]:
                target = agent.pop("plannedTarget",None) or self._choose(agent)
                if target:
                    self.request(agent["id"],target)
