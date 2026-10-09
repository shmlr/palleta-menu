import copy
import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path
from sync_ut_catalog import convert

T = dt.datetime(2026, 10, 9, 18, 0, tzinfo=dt.timezone.utc)
S='2026-10-09T20:58:00+03:00'
HEAD='store_key;sku_code;price_type;retail_price;price_unit;available_quantity;stock_unit;captured_at\n'
A='P1;AA;RETAIL;53,90;кг;15;кг;'+S+'\n'
B='P1;BB;RETAIL;109,90;pack;3;pack;'+S+'\n'
DATA={'products':[
 {'id':'a','sku_code':'AA','unit':'кг','pricing_mode':'by_weight','price':None,'stock_quantity':None},
 {'id':'b','sku_code':'BB','unit':'кг','pricing_mode':'by_pack','price':None,'stock_quantity':None},
 {'id':'c','sku_code':None,'unit':'л','pricing_mode':'by_pack','price':None,'stock_quantity':None},
]}
class TestUT(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  self.f=Path(self.tmp.name)/'ut.csv';self.j=Path(self.tmp.name)/'products.json'
  self.j.write_text(json.dumps(DATA,ensure_ascii=False),encoding='utf-8')
  self.f.write_text(HEAD+A+B,encoding='utf-8')
 def conv(self,dry=True):return convert(self.f,self.j,'P1','RETAIL',dry_run=dry,now=T,max_age_minutes=20)
 def assert_bad(self,new):
  before=self.j.read_bytes();self.f.write_text(new,encoding='utf-8')
  with self.assertRaises(ValueError):self.conv(False)
  self.assertEqual(before,self.j.read_bytes())
 def test_good(self):
  r=self.conv(False);p=json.loads(self.j.read_text())['products']
  self.assertEqual(r['mapped_skus'],2);self.assertEqual(p[0]['price_source_system'],'1C_UT_11');self.assertEqual(p[1]['stock_quantity'],3)
  self.assertEqual(p[2]['price'],None)
 def test_dry_run(self):
  before=self.j.read_bytes();self.conv();self.assertEqual(before,self.j.read_bytes())
 def test_missing(self):self.assert_bad(HEAD+A)
 def test_extra(self):self.assert_bad(HEAD+A+B+'P1;CC;RETAIL;12;pack;3;pack;'+S+'\n')
 def test_duplicate(self):self.assert_bad(HEAD+A+B+A)
 def test_shop(self):self.assert_bad(HEAD+A+B.replace('P1;BB','P2;BB'))
 def test_type(self):self.assert_bad(HEAD+A+B.replace(';RETAIL;',';WHOLESALE;'))
 def test_unit(self):self.assert_bad(HEAD+A+B.replace(';pack;3;pack;',';кг;3;pack;'))
 def test_fractional_stock(self):self.assert_bad(HEAD+A+B.replace(';pack;3;pack;',';pack;1,5;pack;'))
 def test_zero_stock_valid(self):
  self.f.write_text(HEAD+A+B.replace(';pack;3;pack;',';pack;0;pack;'),encoding='utf-8')
  self.conv(False);self.assertEqual(json.loads(self.j.read_text())['products'][1]['availability'],'out_of_stock')
 def test_zero_price(self):self.assert_bad(HEAD+A+B.replace(';109,90;',';0;'))
 def test_negative(self):self.assert_bad(HEAD+A+B.replace(';pack;3;pack;',';pack;-2;pack;'))
 def test_stale(self):self.assert_bad((HEAD+A+B).replace(S,'2026-10-09T20:00:00+03:00'))
 def test_future(self):self.assert_bad((HEAD+A+B).replace(S,'2026-10-09T21:10:00+03:00'))
 def test_no_timezone(self):self.assert_bad((HEAD+A+B).replace(S,'2026-10-09T20:58:00'))
 def test_header_additional(self):self.assert_bad((HEAD+A+B).replace('retail_price;','retail_price;purchase_price;'))
 def test_overprecision(self):self.assert_bad(HEAD+A+B.replace('109,90','109,999'))
 def test_placeholder(self):
  with self.assertRaises(ValueError):convert(self.f,self.j,'STORE_KEY_FROM_1C','RETAIL',now=T)
if __name__=='__main__':unittest.main(verbosity=2)