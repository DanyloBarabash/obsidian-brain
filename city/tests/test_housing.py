"""Stable apartments, exact ownership, resource counts and thematic public buildings."""

from copy import deepcopy
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Vault
from simulation import Simulation
from simulation.clusters import audit_clusters
from test_simulation import snapshot, commission


class HousingTests(unittest.TestCase):
    def test_sessions_share_real_parcels_and_keep_individual_addresses(self):
        data = snapshot(10,1)
        for i,node in enumerate(data['nodes']):
            node.update(project='projects/a.md',kind='hub' if i==0 else 'session',cityImportance=3 if i==0 else 0)
        model=Simulation()
        model.sync(data)
        houses=model.state['housing']
        self.assertEqual(sorted(len(h['sources']) for h in houses.values()),[1,8])
        self.assertEqual(model.snapshot()['knowledgePopulation'],10)
        self.assertEqual(model.snapshot()['addressUnits'],10)
        self.assertEqual(model.snapshot()['primaryBuildings'],3)
        addresses={key:(b['physicalId'],b['unit'],deepcopy(b['footprint'])) for key,b in model.state['buildings'].items()}
        key=data['nodes'][2]['stableId']
        changed=deepcopy(data)
        changed['nodes'].pop(2)
        model.sync(changed)
        self.assertFalse(model.inspect(key)['available'])
        extra=deepcopy(data['nodes'][3]);extra.update(id='earlier-new.md',stableId='extra-source')
        changed['nodes'].append(extra)
        model.sync(changed)
        self.assertTrue(all((b['physicalId'],b['unit'],b['footprint'])==addresses[k] for k,b in model.state['buildings'].items() if k in addresses))
        restored=deepcopy(data['nodes'][2]);restored['id']='renamed-session.md';changed['nodes'].append(restored)
        model.sync(changed)
        self.assertTrue(model.inspect(key)['available'])
        self.assertEqual((model.state['buildings'][key]['physicalId'],model.state['buildings'][key]['unit']),addresses[key][:2])
        self.assertEqual(model.inspect(key)['path'],'renamed-session.md')
        self.assertEqual(model.audit(),[])
        self.assertEqual(Simulation(deepcopy(model.state)).state,model.state)
        commission(model)
        self.assertTrue(all(b['lifecycle']=='open' for b in model.state['buildings'].values()))
        model.economy.settle_day(10,model.state['buildings'])
        self.assertAlmostEqual(sum(p['energy']['lastDemand'] for p in model.economy.state['plants'].values()),sum(b['serviceLoad'] for b in model.state['buildings'].values() if b['available']))

    def test_topics_inherit_but_project_ownership_is_retained(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t)/'vault';(root/'projects/a/child/notes').mkdir(parents=True)
            (root/'projects/a.md').write_text('---\ntype: hub\nclass: client-products\ncity_topic: sports\ncity_anchor: true\n---\n# A')
            (root/'projects/a/child.md').write_text('---\ntype: hub\n---\n# Child')
            (root/'projects/a/child/notes/x.md').write_text('# Exercise')
            city=Vault(root,Path(t)/'state').build();node=next(n for n in city['nodes'] if n['id'].endswith('/x.md'))
            self.assertEqual(node['cityTopic'],'sports')
            self.assertEqual(node['sourceClass'],'client-products')
            self.assertEqual(node['project'],'projects/a/child.md')
            self.assertEqual(node['district'],'sports')

    def test_thematic_facilities_have_land_access_and_real_visits(self):
        data=snapshot(40,2)
        for i,n in enumerate(data['nodes']):
            topic='sports' if i%2 else 'science'
            n.update(district=topic,cityTopic=topic,project=f'projects/{topic}.md',topicAnchor=i<2,
                     cityImportance=3 if i<2 else 2 if i%3 else 0,kind='hub' if i<2 else 'document' if i%3 else 'session')
        model=Simulation();model.sync(data)
        self.assertTrue(audit_clusters(model)['passed'])
        for topic in ('sports','science'):
            facility=model.world.state['services']['facility:'+topic]
            parcel=model.world.state['parcels'][facility['parcel']]
            self.assertTrue(parcel['protected'])
            self.assertIsNone(parcel['source'])
            self.assertNotIn(parcel['id'],model.world.vacant[topic])
            restored=Simulation(deepcopy(model.state))
            self.assertNotIn(parcel['id'],restored.world.vacant[topic])
            self.assertIsNone(model.inspect(facility['id'])['uri'])
            self.assertTrue(model.inspect(facility['id'])['ownerUri'])
        commission(model)
        source=next(k for k,s in model.state['sources'].items() if s['class']=='sports')
        self.assertTrue(model.activities.request(source,'facility:sports',allow_transit=False))
        self.assertEqual(model.state['residents'][source]['purpose'],'stadium')
        self.assertEqual(model.audit(),[])
        projects={h['group'] for h in model.state['housing'].values()}
        self.assertEqual(projects,{'sports|projects/sports.md','science|projects/science.md'})


if __name__=='__main__':
    unittest.main()
