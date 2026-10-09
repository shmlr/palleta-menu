import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path
from sync_1c_dual import merge

class DualSourceTests(unittest.TestCase):
  def setUp(self):
    self.ctx=tempfile.TemporaryDirectory()
    self.addCleanup(self.ctx.cleanup)
    root=Path(self.ctx.name)
    self.now=dt.datetime(2026,10,9,18,40,tzinfo=dt.timezone.utc)
    self.fresh=self.now.isoformat()
    self.older=(self.now-dt.timedelta(minutes=19)).isoformat()
    self.cat=root/'products.json';self.p=root/'retail.csv';self.s=root/'ut.csv'
    data={'schema_version':2,'products':[
      {'id':'p1','sku_code':'1','pricing_mode':'by_weight','unit':'кг','pack_size':.1,'price':None,'availability':'unknown'},
      {'id':'p2','sku_code':'2','pricing_mode':'by_pack','unit':'шт','pack_size':10,'price':None,'availability':'unknown'},
      {'id':'unmapped','sku_code':None,'pricing_mode':'by_pack','unit':'л','pack_size':1,'price':None,'availability':'unknown'}]}
    self.cat.write_text(json.dumps(data,ensure_ascii=False),encoding='utf-8')
    self.write_csv()
  def write_csv(self,qty='15',price='54,90',stockstamp=None,pricestamp=None,p_extra='',s_extra='',p_store='main',s_store='main'):
    ps=pricestamp or self.fresh;ss=stockstamp or self.fresh
    self.p.write_text('store_key;sku_code;retail_price;price_unit;captured_at\n'+
      f'{p_store};1;{price};кг;{ps}\n'+f'{p_store};2;199,90;pack;{ps}\n'+p_extra,encoding='utf-8')
    self.s.write_text('store_key;sku_code;available_quantity;stock_unit;captured_at\n'+
      f'{s_store};1;{qty};кг;{ss}\n'+f'{s_store};2;0;pack;{ss}\n'+s_extra,encoding='utf-8')
  def call(self,**kwargs):return merge(self.p,self.s,self.cat,'main',now=self.now,**kwargs)
  def test_good_merges_price_stock_and_zero(self):
    r=self.call();self.assertEqual(r['mapped_skus'],2);self.assertEqual(r['unmapped_skus'],1)
    data=json.loads(self.cat.read_text(encoding='utf-8'))
    self.assertEqual(data['products'][0]['price'],54.9)
    self.assertEqual(data['products'][0]['stock_quantity'],15)
    self.assertEqual(data['products'][0]['price_source_system'],'1C_Retail')
    self.assertEqual(data['products'][0]['stock_source_system'],'1C_UT')
    self.assertEqual(data['products'][1]['availability'],'out_of_stock')
    self.assertIsNone(data['products'][2]['price'])
  def test_dry_run_keeps_bytes_untouched(self):
    before=self.cat.read_bytes();self.call(dry_run=True);self.assertEqual(self.cat.read_bytes(),before)
  def test_stale_export_fails_closed(self):
    self.write_csv(stockstamp=(self.now-dt.timedelta(minutes=21)).isoformat())
    before=self.cat.read_bytes()
    with self.assertRaisesRegex(ValueError,'stale export'):self.call()
    self.assertEqual(self.cat.read_bytes(),before)
  def test_mismatched_snapshot_fails_closed(self):
    self.write_csv(stockstamp=self.older)
    with self.assertRaisesRegex(ValueError,'snapshot mismatch'):self.call()
  def test_unexpected_sku_rejected(self):
    self.write_csv(p_extra=f'main;99;15,00;кг;{self.fresh}\n')
    with self.assertRaisesRegex(ValueError,'NOT in approved public whitelist'):self.call()
  def test_missing_retail_sku_rejected(self):
    self.p.write_text('store_key;sku_code;retail_price;price_unit;captured_at\n'+
      f'main;1;54,90;кг;{self.fresh}\n',encoding='utf-8')
    with self.assertRaisesRegex(ValueError,'missing 1 mapped'):self.call()
  def test_store_mismatch_rejected(self):
    self.write_csv(s_store='other')
    with self.assertRaisesRegex(ValueError,'store_key mismatch'):self.call()
  def test_negative_stock_rejected(self):
    self.write_csv(qty='-1')
    with self.assertRaisesRegex(ValueError,'non-negative'):self.call()
  def test_non_integer_pack_rejected(self):
    self.s.write_text('store_key;sku_code;available_quantity;stock_unit;captured_at\n'+
      f'main;1;15;кг;{self.fresh}\nmain;2;1,5;pack;{self.fresh}\n',encoding='utf-8')
    with self.assertRaisesRegex(ValueError,'packs must be an integer'):self.call()
  def test_no_double_merge_partial_write_on_failure(self):
    orig=self.cat.read_bytes();self.write_csv(price='abc')
    with self.assertRaises(ValueError):self.call()
    self.assertEqual(self.cat.read_bytes(),orig)
  def test_extra_public_csv_column_rejected(self):
    self.p.write_text(self.p.read_text('utf-8').replace('captured_at\n','captured_at;cost_price\n'),encoding='utf-8')
    with self.assertRaisesRegex(ValueError,'EXACT headers'):self.call()
  def test_price_unit_mismatch_rejected(self):
    self.p.write_text(self.p.read_text('utf-8').replace(';199,90;pack;', ';199,90;шт;'),encoding='utf-8')
    with self.assertRaisesRegex(ValueError,'price_unit must be'):self.call()
  def test_zero_prices_rejected(self):
    self.write_csv(price='0')
    with self.assertRaisesRegex(ValueError,'positive'):self.call()
  def test_no_change_is_idempotent(self):
    self.call();first=self.cat.read_bytes();self.call();self.assertEqual(first,self.cat.read_bytes())

if __name__=='__main__':unittest.main(verbosity=2)