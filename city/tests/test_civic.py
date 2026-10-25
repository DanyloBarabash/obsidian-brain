"""Regression coverage for civic facets and each individual spatial cluster."""

from copy import deepcopy
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from classification import classify
from server import Vault
from simulation import Simulation
from simulation.clusters import audit_clusters
from simulation.world import TICKS


def civic_fixture(root):
    """Create a public synthetic vault with uneven classes and nested project ownership."""
    def write(path, text):
        file = root/path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(text)
    write('global.md', '---\nid: global\ntype: hub\n---\n# Brain\n[[classes/client-products]]')
    write('AGENTS.md', '# Rules\n[[global]]')
    for index in range(6):
        write(f'_global/templates/template-{index}.md', '# Template')
    for name in ('agent-working-rules', 'agent-writing-protocol', 'project-map-conventions'):
        write(f'_global/notes/{name}.md', '# Shared policy')
    for index in range(4):
        write(f'_global/sessions/history-{index}.md', '# History')
    for name in ('client-products', 'systems-and-agents', 'education-and-research', 'personal-tools', 'games'):
        write(f'classes/{name}.md', f'---\ntype: class\nclass: {name}\n---\n# {name}')
    for name, cls, count in [('alpha','client-products',45),('beta','client-products',33),
                              ('brain','systems-and-agents',14),('lab','education-and-research',12),
                              ('course','education-and-research',2),('tool','personal-tools',10),('game','games',1)]:
        write(f'projects/{name}.md', f'---\ntype: hub\nclass: {cls}\n---\n# {name}')
        for index in range(count):
            write(f'projects/{name}/notes/note-{index}.md', f'# {name} {index}\n[[projects/{name}]]')
    write('projects/alpha/child.md','---\ntype: hub\n---\n# Child\n[[projects/alpha]]')
    write('projects/alpha/child/notes/rules.md','# Local rules\n[[projects/alpha/child]]')
    return write


class CivicTests(unittest.TestCase):
    def test_global_and_project_rules_keep_different_owners(self):
        shared = classify('_global/notes/agent-working-rules.md', {}, '', 'commons')
        local = classify('projects/a/notes/working-agreements.md', {}, 'projects/a.md', 'client-products')
        planner = classify('projects/claude-brain/documents/brain-city-simulation-rules.md', {}, 'projects/claude-brain.md', 'systems-and-agents')
        self.assertEqual(shared['cityDistrict'], 'civic')
        self.assertEqual(local['cityDistrict'], 'client-products')
        self.assertEqual(local['ownerProject'], 'projects/a.md')
        self.assertEqual(planner['cityDistrict'], 'civic')
        self.assertEqual(planner['ownerProject'], 'projects/claude-brain.md')
        self.assertEqual(planner['knowledgeScope'], 'project')
        self.assertEqual(classify('renamed.md', {'city_role':'council'}, '', 'commons')['cityRole'], 'council')

    def test_each_district_and_project_passes_live_criteria(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)/'vault'
            root.mkdir()
            civic_fixture(root)
            city = Vault(root, Path(directory)/'state').build()
            model = Simulation()
            model.sync(city)
            report = audit_clusters(model)
            self.assertTrue(report['passed'], report)
            for row in report['districts']:
                self.assertEqual(row['centresInsideWedge'], row['blocks'])
                self.assertEqual(len(row['components']), 1)
                self.assertLessEqual(row['innermostRing'], 2)
                if any(n['kind']=='class' and n['cityDistrict']==row['id'] for n in city['nodes']):
                    self.assertEqual(row['anchorKind'], 'class')
                elif row['id'] != 'civic':
                    self.assertIn(row['anchorKind'], ('hub','org'))
            self.assertTrue(all(len(row['components']) == 1 for row in report['projects']))
            centre = model.world.state['centres']['civic']
            self.assertEqual(model.state['sources'][centre['source']]['path'], 'global.md')
            town_halls = [b for b in model.state['buildings'].values() if b['model'] == 'town-hall']
            self.assertEqual(len(town_halls), 1)
            self.assertTrue(model.inspect(town_halls[0]['source'])['uri'])
            self.assertFalse(any(s['function'] == 'town-hall' for s in model.world.state['services'].values() if s['derived']))
            self.assertEqual(model.audit(), [])
            before = deepcopy(model.state)
            updated = deepcopy(city)
            for node in updated['nodes']:
                node['contentRevision'] = 'new-text'
                node['degree'] += 50
            model.sync(updated)
            for name in ('wedges', 'subWedges', 'centres'):
                self.assertEqual(model.world.state[name], before['world'][name])
            self.assertEqual({k:b['footprint'] for k,b in model.state['buildings'].items()}, {k:b['footprint'] for k,b in before['buildings'].items()})
            self.assertEqual(sum((b-a) % TICKS or TICKS for a,b in model.world.state['wedges'].values()), TICKS)

    def test_civic_identity_and_facets_survive_missing_and_restore(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)/'vault'
            root.mkdir()
            file = root/'rule.md'
            text = '---\nid: policy\ncity_role: council\nknowledge_scope: global\n---\n# Policy'
            file.write_text(text)
            vault = Vault(root, Path(directory)/'state')
            first = vault.build()['nodes'][0]
            file.unlink()
            missing = vault.build()['cityState']['missingSources'][0]
            for name in ('stableId', 'cityRole', 'cityDistrict', 'knowledgeScope', 'project'):
                self.assertEqual(first[name], missing[name])
            file.write_text(text)
            self.assertEqual(vault.build()['nodes'][0]['stableId'], first['stableId'])

    def test_per_class_audit_detects_a_hidden_local_failure(self):
        from test_simulation import snapshot
        model = Simulation()
        model.sync(snapshot(80, 2))
        name = next(iter(model.world.state['wedges']))
        model.world.state['wedges'][name] = [TICKS//3, TICKS//3+1]
        report = audit_clusters(model)
        self.assertFalse(report['passed'])
        self.assertTrue(any(name in e and 'BC-64' in e for e in report['errors']))


if __name__ == '__main__':
    unittest.main()
