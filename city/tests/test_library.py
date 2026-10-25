"""Project-free library ownership, shared collections and actual public access."""

from copy import deepcopy
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server import Vault
from simulation import Simulation
from classification import classify
from simulation.profile import VALUES
from test_simulation import snapshot, commission


class LibraryTests(unittest.TestCase):
    def test_library_facets_do_not_steal_project_documents_or_rules(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/'vault'
            for folder in ('_global/library/articles','_global/notes','projects/a/documents'):
                (root/folder).mkdir(parents=True)
            (root/'global.md').write_text('---\ntype: hub\n---\n# Global')
            (root/'_global/library.md').write_text('---\ntype: hub\nknowledge_scope: library\n---\n# Library')
            (root/'_global/library/articles/meanders.md').write_text('---\nid: library/meanders\ntype: article\nknowledge_scope: library\ndomain: science\nsource_url: https://example.org/river\nrelated:\n  - "[[_global/library]]"\n---\n# Meanders')
            (root/'_global/notes/agent-working-rules.md').write_text('# Rules')
            (root/'projects/a.md').write_text('---\ntype: hub\nclass: systems-and-agents\ncity_topic: technology\n---\n# A')
            (root/'projects/a/documents/own.md').write_text('---\ntype: document\nknowledge_scope: library\ncity_role: library-item\n---\n# Own document')
            data=Vault(root,Path(directory)/'state').build()
            by_id={n['id']:n for n in data['nodes']}
            item=by_id['_global/library/articles/meanders.md']
            self.assertEqual(item['knowledgeScope'],'library')
            self.assertEqual(item['project'],'')
            self.assertEqual(item['cityRole'],'library-item')
            self.assertEqual(item['libraryCategory'],'science')
            self.assertEqual(item['librarySource'],'https://example.org/river')
            self.assertEqual(item['district'],'civic')
            self.assertEqual(by_id['_global/notes/agent-working-rules.md']['cityRole'],'council')
            self.assertEqual(by_id['projects/a/documents/own.md']['project'],'projects/a.md')
            self.assertEqual(by_id['projects/a/documents/own.md']['district'],'technology')
            self.assertEqual(by_id['projects/a/documents/own.md']['knowledgeScope'],'project')
            model=Simulation();model.sync(data)
            hub=by_id['_global/library.md']['stableId']
            building=model.state['buildings'][item['stableId']]
            self.assertEqual(building['physicalId'],model.state['buildings'][hub]['physicalId'])
            self.assertEqual(building['model'],'grand-library')
            self.assertNotEqual(item['uri'],by_id['_global/library.md']['uri'])
            self.assertEqual(model.audit(),[])
            commission(model)
            self.assertIn('building:'+hub,model.activities._landmarks('technology'))
            self.assertTrue(model.activities.request(by_id['projects/a.md']['stableId'],'building:'+hub,allow_transit=False))
        malicious=classify('_global/library/articles/x.md',{'type':'article','source_url':'javascript:alert(1)'},'','commons')
        self.assertEqual(malicious['librarySource'],'')

    def test_collection_growth_preserves_individual_records_and_bounded_wings(self):
        data=snapshot(52,1)
        for i,node in enumerate(data['nodes']):
            node.update(district='civic',cityDistrict='civic',project='',kind='hub' if i==0 else 'article',
                        cityRole='knowledge-library' if i==0 else 'library-item',cityImportance=3 if i==0 else 2)
        model=Simulation();model.sync(data)
        self.assertLess(model.snapshot()['primaryBuildings'],10)
        self.assertEqual(model.snapshot()['knowledgePopulation'],52)
        self.assertTrue(all(h['capacity']==VALUES['library_collection_capacity'] and len(h['sources'])<=h['capacity'] for h in model.state['housing'].values()))
        addresses={k:(b['physicalId'],b['unit'],deepcopy(b['footprint'])) for k,b in model.state['buildings'].items()}
        missing=deepcopy(data);missing['nodes'].pop(2);model.sync(missing)
        missing['nodes'].append({**data['nodes'][3],'id':'extra.md','stableId':'extra-library-item'})
        model.sync(missing)
        self.assertTrue(all((model.state['buildings'][k]['physicalId'],model.state['buildings'][k]['unit'],model.state['buildings'][k]['footprint'])==address for k,address in addresses.items()))
        self.assertEqual(model.audit(),[])
        self.assertEqual(Simulation(model.state).state,model.state)

