"""Outdoor visits retain source truth and have exclusive reachable physical seats."""

from copy import deepcopy
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from simulation import Simulation
from simulation.precincts import clear, PLACES
from simulation.precincts import sync as sync_places
from test_simulation import snapshot, commission


class PrecinctTests(unittest.TestCase):
    def test_failed_placement_retries_only_when_feasibility_changes(self):
        model=self.model()
        with patch('simulation.precincts.plan',return_value=None) as planner:
            sync_places(model)
            self.assertEqual(planner.call_count,0)
            model.clock['tick']+=1
            model.state['sources'][next(iter(model.state['sources']))]['title']='Edited title'
            sync_places(model)
            self.assertEqual(planner.call_count,0)
            model.state['budget']['available']+=1
            sync_places(model)
            self.assertGreater(planner.call_count,0)
            previous=planner.call_count
            sync_places(model)
            self.assertEqual(planner.call_count,previous)
            model.world.walk.state['revision']+=1
            sync_places(model)
            self.assertGreater(planner.call_count,previous)
        with patch('simulation.precincts.plan',return_value=None) as planner:
            Simulation(model.state)
            self.assertEqual(planner.call_count,0,'failed attempts survive save/load')

    def model(self):
        data=snapshot(42,3)
        topics=list(PLACES)
        for i,node in enumerate(data['nodes']):
            topic=topics[i%len(topics)]
            node.update(district=topic,cityTopic=topic,project='projects/'+topic+'.md',topicAnchor=i<len(topics))
        model=Simulation()
        model.sync(data)
        commission(model)
        return model

    def test_places_are_reachable_truthful_and_persistent(self):
        model=self.model()
        sources=deepcopy(model.state['sources'])
        buildings=deepcopy(model.state['buildings'])
        places=[s for s in model.world.state['services'].values() if s.get('place')]
        self.assertTrue(any(s['district']=='science' for s in places))
        self.assertTrue(any(s['activity']=='training' for s in places))
        self.assertEqual(model.audit(),[])
        again=Simulation(model.state)
        self.assertEqual(again.state,model.state)
        self.assertEqual(again.state['sources'],sources)
        self.assertEqual(again.state['buildings'],buildings)
        self.assertEqual(len(model.static_presentation()['places']),len(places))
        campus=model.world.state['services']['facility:science']
        for service in places:
            if service['district']=='science':
                self.assertTrue(clear(model,service['paths'],campus),'quad access avoids actual university wings and rivers')

    def test_visitors_reserve_distinct_seats_arrive_and_release(self):
        model=self.model()
        place=next(s for s in model.world.state['services'].values() if s.get('place') and s['district']=='sports')
        people=[k for k,s in model.state['sources'].items() if s['class']=='sports'][:4]
        for key in people[:3]:
            self.assertTrue(model.activities.request(key,place['id'],allow_transit=False))
        self.assertFalse(model.activities.request(people[3],place['id'],allow_transit=False))
        seats=[model.state['residents'][k]['visitNode'] for k in people[:3]]
        self.assertEqual(len(set(seats)),3)
        for key in people[:3]:
            agent=model.state['residents'][key]
            self.assertEqual(agent['route']['nodes'][-1],agent['visitNode'])
            for _ in range(10000):
                model.activities._walk_step(agent)
                if agent['state']=='visiting':
                    break
            self.assertEqual(agent['state'],'visiting')
            self.assertEqual(agent['node'],agent['visitNode'])
        live={r['id']:r for r in model.live_presentation()['residents']}
        for key in people[:3]:
            self.assertEqual(live[key]['activity'],place['activity'])
        self.assertEqual(model.audit(),[])
        model.activities._return_home(model.state['residents'][people[0]])
        self.assertNotIn('visitNode',model.state['residents'][people[0]])
        self.assertTrue(model.activities.request(people[3],place['id'],allow_transit=False))
        self.assertEqual(model.audit(),[])

