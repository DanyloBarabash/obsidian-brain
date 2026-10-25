"""An open river course and a live, non-destructive migration from the old belt."""

from copy import deepcopy
import math
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from simulation import Simulation
from simulation.migrations import migrate
from simulation.clusters import audit_clusters
from simulation.profile import VALUES, polygon_segment_distance
from simulation.world import World, TICKS, historic, radius
from test_simulation import snapshot, commission


def legacy_marks():
    return {name:historic()[index] for name,index in VALUES['river_angles'].items()}


def legacy_water(i,s):
    ring=VALUES['river_ring']
    if i<ring:
        return None
    a,b=World.cell_ticks(i,s)
    marks=legacy_marks()
    touching=[name for name,t in sorted(marks.items(),key=lambda item:item[1]) if t in (a,b%TICKS)]
    if i==ring and (touching or marks['inflow']<=a<b<=marks['outflow']):
        upper=b<=marks['tributary'] and touching!=['outflow']
        return {'reach':'ring-upper' if upper else 'ring-lower','flow':'ring','order':1 if upper else 2,'confluence':bool(touching),'marks':touching}
    if touching:
        return {'reach':touching[0],'flow':'radial','order':2 if touching[0]=='outflow' else 1,'confluence':False,'marks':touching}


class RiverCourseTests(unittest.TestCase):
    def test_river_migration_invalidates_cached_geometry_without_bridges(self):
        model=Simulation()
        model.sync(snapshot(1,1))
        model.state['layoutVersion']=8
        before=model.static_revision()
        self.assertTrue(migrate(model.state))
        self.assertNotEqual(before,Simulation(model.state).static_revision())

    def test_open_course_has_one_direction_and_no_belt(self):
        model=Simulation()
        model.sync(snapshot(180,6))
        rivers=model.world.rivers()
        self.assertEqual(len(rivers),3)
        self.assertEqual(rivers[0]['points'][-1],rivers[1]['points'][0])
        self.assertEqual(rivers[1]['points'][-1],rivers[2]['points'][0])
        self.assertIsNone(rivers[-1]['downstream'])
        marks=model.world.river_marks()
        self.assertLess(marks['outflow']-marks['inflow'],TICKS/2,'no near-circular channel around the core')
        ring=VALUES['river_ring']
        points=rivers[1]['points'][14:-14]
        radii=[math.hypot(*p) for p in points]
        self.assertGreater(max(radii)-min(radii),8,'the bend is not a circular arc')
        self.assertGreater(math.dist(rivers[0]['points'][0],rivers[-1]['points'][-1]),radius(ring)*3)
        for river in rivers:
            for house in model.state['buildings'].values():
                for a,b in zip(river['points'],river['points'][1:]):
                    self.assertGreaterEqual(polygon_segment_distance(house['footprint']['polygon'],a,b),river['width']/2)
        self.assertEqual(model.audit(),[])

    def test_v8_migration_preserves_homes_nodes_routes_and_greenways(self):
        with patch.object(World,'water',staticmethod(legacy_water)),patch.object(World,'river_marks',staticmethod(legacy_marks)):
            old=Simulation()
            old.sync(snapshot(400,6))
            commission(old)
        saved=deepcopy(old.state)
        saved['layoutVersion']=8
        before=deepcopy(saved)
        self.assertTrue(migrate(saved))
        current=Simulation(saved)
        self.assertEqual(current.state['buildings'],before['buildings'])
        self.assertEqual(current.state['residents'],before['residents'])
        for key in ('S','P'):
            self.assertEqual(current.world.networks[key].state['nodes'],before['world']['networks'][key]['nodes'])
            self.assertEqual(set(current.world.networks[key].state['edges']),set(before['world']['networks'][key]['edges']))
        self.assertTrue(current.world.state['retiredRiverCells'])
        self.assertTrue(any(e['kind']=='bridge' and current.world.street.state['edges'][key]['kind']=='district' for key,e in before['world']['networks']['S']['edges'].items()))
        self.assertEqual(current.audit(),[])
        self.assertTrue(audit_clusters(current)['passed'],'greenway road crossings retain district/project continuity')
        self.assertEqual(Simulation(current.state).state,current.state)
        again=deepcopy(current.state)
        self.assertTrue(migrate(again))
        self.assertEqual(again,current.state)
        current.sync(snapshot(450,6))
        self.assertTrue(all(f"{b['cell'][0]}:{b['cell'][1]}" not in current.world.retired_river_cells for b in current.world.state['blocks'].values()))
        self.assertEqual(current.audit(),[])

