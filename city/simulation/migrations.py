"""Upgrade saved worlds in place so rule changes keep existing streets and buildings."""

from .engine import LAYOUT_VERSION, TRANSIENT_EVENTS

# Layout version N -> function upgrading a saved state from N to N+1 without moving anything built.
def open_river_valley(state):
    """Retire the long artificial belt without moving homes, nodes or live routes."""
    from .world import World, historic, sectors, TICKS
    from .profile import VALUES
    world = World(state['world'],lambda *args,**kwargs:None)
    marks={name:historic()[index] for name,index in VALUES['river_angles'].items()}
    retired=[]
    for i in range(VALUES['river_ring'],max([b['cell'][0] for b in world.state['blocks'].values()]+[VALUES['river_ring']])+2):
        for s in range(sectors(i)):
            a,b=world.cell_ticks(i,s)
            touching=any(t in (a,b%TICKS) for t in marks.values())
            was_water=touching or (i==VALUES['river_ring'] and marks['inflow']<=a<b<=marks['outflow'])
            if was_water and not world.water(i,s):
                retired.append(f'{i}:{s}')
    world.state['retiredRiverCells']=retired
    changed = False
    for edge in world.street.state['edges'].values():
        if edge['kind']!='bridge':
            continue
        cells=[tuple(map(int,label.split(':'))) for label in edge.get('between',[]) if label!='plaza']
        if len(cells)!=2 or not all(world.water(*cell) for cell in cells):
            edge['kind']='district'
            for field in ('crossesWater','crossingTick','flowBearing'):
                edge.pop(field,None)
            changed=True
        else:
            edge['crossesWater']='urban-bend'
    if changed:
        world.street.state['revision']+=1
    # Old bank walks remain useful greenway paths, with exactly the same topology.
    state['world']['riverCourseVersion']=2
    state['world'].pop('precinctPlanning',None)


def landmark_complexes(state):
    """Project buildings move into their cluster complexes on the next sync; nothing built moves here."""


def pedestrian_junctions(state, walk=None):
    """Split walking crossings and carry each traveller's distance onto the same physical path."""
    from .network import Network, _on_segment
    import math
    walk = walk if walk is not None else Network('P',state['world']['networks']['P'])
    before = dict(walk.state['edges'])
    walk.join_crossings()
    nodes,edges = walk.state['nodes'],walk.state['edges']
    changed = {}
    for key,edge in before.items():
        if key in edges:
            continue
        a,b = edge['a'],edge['b']
        inside = sorted((n for n,p in nodes.items() if p['level']==nodes[a]['level'] and _on_segment(p,nodes[a],nodes[b])),
                        key=lambda n:math.hypot(nodes[n]['x']-nodes[a]['x'],nodes[n]['y']-nodes[a]['y']))
        changed[key] = [a,*inside,b]
    for agent in state['residents'].values():
        route = agent.get('route')
        if not route or not any(k in changed for k in route['edges']):
            continue
        distance = sum(before[k]['length'] for k in route['edges'][:agent['edge']])+agent['progress']
        chain = [route['nodes'][0]]
        for i,key in enumerate(route['edges']):
            part = changed.get(key,route['nodes'][i:i+2])
            chain.extend(part[1:] if part[0]==chain[-1] else list(reversed(part))[1:])
        keys = ['|'.join(sorted((a,b))) for a,b in zip(chain,chain[1:])]
        index = 0
        while index<len(keys) and distance>=edges[keys[index]]['length']-1e-9:
            distance = max(0,distance-edges[keys[index]]['length'])
            index += 1
        agent.update(route={**route,'nodes':chain,'edges':keys},edge=index,progress=distance,node=chain[index])


MIGRATIONS = {8:open_river_valley, 9:landmark_complexes, 10:pedestrian_junctions}


def migrate(state):
    """Upgrade a saved state to LAYOUT_VERSION in place; False when a step is missing and the world must be rebuilt."""
    state["events"] = [event for event in state.get("events", []) if event["type"] not in TRANSIENT_EVENTS]
    version = state.get("layoutVersion", 1)
    while version < LAYOUT_VERSION and version in MIGRATIONS:
        MIGRATIONS[version](state)
        version += 1
        state["layoutVersion"] = version
    return version == LAYOUT_VERSION
