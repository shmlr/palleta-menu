import copy
import json
import tempfile
import unittest
from pathlib import Path
from stage_minmax_ut import build_report

ROOT=Path(__file__).resolve().parent
STOCK=Path('/mnt/data/12(1).xlsx')
MINMAX=Path('/mnt/data/13.10.2026.xlsx')
MANIFEST=ROOT/'sku_identity_review.json'

@unittest.skipUnless(STOCK.is_file() and MINMAX.is_file(),'Requires owner-supplied historical files')
class RealFileIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source=json.loads(MANIFEST.read_text(encoding='utf8'))
        cls.report=build_report(STOCK,MINMAX,MANIFEST,'13.10.2026')
    def test_identity_row_counts(self):
        self.assertEqual(self.report['mapping_rows'],21)
        self.assertGreater(self.report['search_codes_with_collisions'],1000)
    def test_no_live_publication(self):
        self.assertTrue(self.report['unsafe_to_publish_as_live'])
        self.assertTrue(all(not x.get('publishable_live',False) for x in self.report['rows']))
    def test_club_pricing_known(self):
        d={x['id']:x for x in self.report['rows']}
        self.assertEqual(d['potato']['club_price_snapshot'],49.96)
        self.assertEqual(d['potato']['minmax_free_qty_snapshot'],739.648)
        self.assertEqual(d['eggs_co_10']['club_price_snapshot'],129.97)
    def test_missing_minmax_remains_unknown(self):
        d={x['id']:x for x in self.report['rows']}
        self.assertEqual(d['mistral_rice_900']['club_price_snapshot'],None)
        self.assertEqual(d['mistral_rice_900']['minmax_free_qty_snapshot'],None)
        self.assertIn('absent_from_minmax',d['mistral_rice_900']['checks'])
    def test_collision_is_audit_warning(self):
        d={x['id']:x for x in self.report['rows']}
        self.assertEqual(d['mistral_rice_900']['search_code'],'1079')
        self.assertEqual(d['mistral_rice_900']['internal_code'],'УТ-00001079')
        self.assertIn('search_code_collides',d['mistral_rice_900']['checks'])
    def test_change_search_code_is_hard_stop(self):
        m=copy.deepcopy(self.source)
        m['products'][0]['search_code']='1079'
        with tempfile.TemporaryDirectory() as td:
            t=Path(td)/'mapping.json';t.write_text(json.dumps(m,ensure_ascii=False),encoding='utf8')
            r=build_report(STOCK,MINMAX,t,'13.10.2026')
        self.assertEqual(r['rows'][0]['status'],'STOP')
    def test_change_name_is_hard_stop(self):
        m=copy.deepcopy(self.source)
        m['products'][0]['ut_name']='другой товар'
        with tempfile.TemporaryDirectory() as td:
            t=Path(td)/'mapping.json';t.write_text(json.dumps(m,ensure_ascii=False),encoding='utf8')
            r=build_report(STOCK,MINMAX,t,'13.10.2026')
        self.assertEqual(r['rows'][0]['status'],'STOP')
    def test_date_mismatch_stops(self):
        with self.assertRaises(ValueError):build_report(STOCK,MINMAX,MANIFEST,'12.10.2026')
    def test_duplicate_mapping_stops(self):
        m=copy.deepcopy(self.source)
        m['products'][1]['internal_code']=m['products'][0]['internal_code']
        with tempfile.TemporaryDirectory() as td:
            t=Path(td)/'mapping.json';t.write_text(json.dumps(m,ensure_ascii=False),encoding='utf8')
            with self.assertRaises(ValueError):build_report(STOCK,MINMAX,t,'13.10.2026')

if __name__=='__main__':unittest.main(verbosity=2)