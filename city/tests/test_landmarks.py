"""Full-size thematic estates, preserved source homes and safe live upgrades."""

from copy import deepcopy
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from simulation import Simulation
from simulation.migrations import migrate
from simulation.network import Network
from simulation.profile import VALUES, convex_overlap, polygon_segment_distance
from test_simulation import snapshot, commission


class LandmarkTests(unittest.TestCase):
    def test_crossing_migration_keeps_homes_seats_and_travellers_in_place(self):
        model = Simulation()
        model.sync(snapshot(4,1))
        walk = model.world.walk
        a,b,c,d = [walk.node(x,y,snap=False) for x,y in ((996,1000),(1004,1000),(1000,999.6),(1000,1000.45))]
        walk.edge(a,b,kind='entrance-path',width=5)
        short = walk.edge(c,d,kind='entrance-path',width=1)
        walk.close(short)
        travellers = list(model.state['residents'])[:4]
        for key,(start,end,progress) in zip(travellers,((a,b,3.8),(b,a,3.8),(c,d,.2),(d,c,.2))):
            route = walk.route(start,end) if start in (a,b) else {'nodes':[start,end],'edges':[short],'length':.85}
            model.state['residents'][key].update(node=start,route=route,edge=0,progress=progress)
        positions = {k:walk.position(v['route'],v['edge'],v['progress']) for k,v in model.state['residents'].items()}
        before = deepcopy(model.state)
        model.state['layoutVersion'] = 10
        self.assertTrue(migrate(model.state))
        upgraded = Network('P',model.state['world']['networks']['P'])
        self.assertEqual(upgraded.topology_errors(),[])
        self.assertEqual(model.state['buildings'],before['buildings'])
        self.assertEqual(model.state['world']['services'],before['world']['services'])
        for key,value in before['world']['networks']['P']['nodes'].items():
            self.assertEqual(upgraded.state['nodes'][key],value)
        for key,position in positions.items():
            agent = model.state['residents'][key]
            current = upgraded.position(agent['route'],agent['edge'],agent['progress'])
            self.assertAlmostEqual(current['x'],position['x'])
            self.assertAlmostEqual(current['y'],position['y'])
        pieces = [e for e in upgraded.state['edges'].values() if e['a'] in (c,d) or e['b'] in (c,d)]
        self.assertEqual(len(pieces),2)
        self.assertTrue(all(not e['enabled'] for e in pieces))
        again = deepcopy(model.state)
        self.assertTrue(migrate(model.state))
        self.assertEqual(again,model.state)
        upgraded.node(1000.1,1000.1,snap=False)
        self.assertTrue(any('unwelded nodes' in error for error in upgraded.topology_errors()))

    def test_global_town_hall_occupies_the_square_without_blocking_paths(self):
        data = snapshot(12,1)
        for node in data['nodes']:
            node.update(district='civic',cityDistrict='civic')
        data['nodes'][0].update(cityRole='town-hall',kind='hub',cityImportance=3)
        model = Simulation()
        model.sync(data)
        key = data['nodes'][0]['stableId']
        hall = model.state['buildings'][key]
        self.assertEqual(hall.get('landmarkVersion'),1)
        self.assertEqual([hall['footprint']['fw'],hall['footprint']['fd']],VALUES['civic_hall_size'])
        self.assertEqual(model.state['sources'][key]['uri'],data['nodes'][0]['uri'])
        self.assertEqual(model.snapshot()['knowledgePopulation'],12)
        nodes = model.world.walk.state['nodes']
        for edge in model.world.walk.state['edges'].values():
            a,b = nodes[edge['a']],nodes[edge['b']]
            self.assertFalse(convex_overlap(hall['footprint']['polygon'],[[a['x'],a['y']],[b['x'],b['y']]]))
        self.assertIsNone(model.world.state['services']['plaza:town-hall']['footprint'])
        self.assertEqual(model.audit(),[])
        self.assertEqual(Simulation(model.state).state,model.state)

    def test_estates_migrate_without_moving_sources_or_teleporting_visitors(self):
        data = snapshot(36,3)
        topics = ['sports','science','energy']
        for i,node in enumerate(data['nodes']):
            topic = topics[i%3]
            node.update(district=topic,cityTopic=topic,project='projects/'+topic+'.md',kind='hub' if i<3 else 'note',topicAnchor=i<3)
        with patch('simulation.facilities.upgrade',return_value=False):
            old = Simulation()
            old.sync(data)
            commission(old)
            source = next(k for k,s in old.state['sources'].items() if s['class']=='sports')
            old.activities.release(old.state['residents'][source])
            agent = old.state['residents'][source]
            agent.update(state='home',route=None,journey=None)
            self.assertTrue(old.activities.request(source,'facility:sports',allow_transit=False))
            old.advance(3)
            position = old.activities.position(agent)
        before = deepcopy(old.state)
        upgraded = Simulation(before)
        self.assertEqual(upgraded.activities.position(upgraded.state['residents'][source]),position)
        self.assertEqual(upgraded.state['sources'],before['sources'])
        self.assertEqual(upgraded.state['knowledge'],before['knowledge'])
        self.assertEqual(upgraded.state['buildings'],before['buildings'])
        self.assertEqual(upgraded.audit(),[])
        for topic in topics:
            service = upgraded.world.state['services']['facility:'+topic]
            self.assertEqual(service['siteVersion'],1)
            self.assertEqual([service['footprint']['fw'],service['footprint']['fd']],VALUES['landmark_sites'][topic])
            parcel = upgraded.world.state['parcels'][service['parcel']]
            self.assertTrue(parcel['protected'])
            self.assertIsNotNone(upgraded.world.walk.route(agent['node'],service['entrance']))
            for b in upgraded.state['buildings'].values():
                self.assertFalse(convex_overlap(service['footprint']['polygon'],b['footprint']['polygon']))
            for river in upgraded.world.rivers():
                for a,b in zip(river['points'],river['points'][1:]):
                    self.assertGreaterEqual(polygon_segment_distance(parcel['polygon'],a,b),river['width']/2)
        self.assertEqual(Simulation(upgraded.state).state,upgraded.state)
        again = deepcopy(data)
        extra = {**again['nodes'][4],'id':'extra.md','stableId':'extra-landmark-neighbour'}
        again['nodes'].append(extra)
        upgraded.sync(again)
        self.assertEqual(upgraded.audit(),[])
        for key,b in before['buildings'].items():
            self.assertEqual(upgraded.state['buildings'][key]['footprint'],b['footprint'])
