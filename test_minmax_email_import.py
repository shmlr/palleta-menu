"""Synthetic XLS gate tests: no real 1C export or raw stock in public GitHub."""
import copy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import tempfile
import unittest

import xlwt

from tools.import_minmax_email import run

MSK=timezone(timedelta(hours=3))
CAP="2026-10-14 19-00-13"
SENT="2026-10-14T19:00:13+03:00"
NOW=datetime(2026,10,14,20,1,0,tzinfo=MSK)


class MinMaxEveningTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root=Path(self.temp.name)
        base=Path(__file__).resolve().parent
        self.cat=root/"products.json"
        self.allow=root/"allowlist.json"
        self.cat.write_text((base/"products.json").read_text(encoding="utf-8"),encoding="utf-8")
        self.allow.write_text((base/"tools/club_price_allowlist.json").read_text(encoding="utf-8"),encoding="utf-8")
        self.xls=root/("Отчет_Паллета 1С - Меню_"+CAP+".xls")
        self.mapping=json.loads(self.allow.read_text(encoding="utf-8"))["approved"]
        self.source_catalog=json.loads(self.cat.read_text(encoding="utf-8"))
        self.synthetic()

    def synthetic(self,overrides=None,omit=None):
        overrides=overrides or {}
        book=xlwt.Workbook(encoding="utf-8")
        sheet=book.add_sheet("Лист_1")
        headers={(0,1):"Код",(0,3):"Наименование",(0,4):"Цена",
                 (0,5):"Доп. цены",(0,7):"Текущие остатки",
                 (1,5):"Цена Оптовая",(1,8):"Свободный остаток"}
        headers.update(overrides.get("headers",{}))
        for (r,c),v in headers.items():sheet.write(r,c,v)
        sheet.write(3,3,"РД (7)")
        for n,p in enumerate(self.mapping,start=4):
            if p["id"]==omit:continue
            sheet.write(n,1,p["internal_code"])
            sheet.write(n,3,overrides.get(p["id"]+"_name",p["ut_name"]))
            sheet.write(n,4,overrides.get(p["id"]+"_retail",1000.00))  # Must not leak.
            sheet.write(n,5,overrides.get(p["id"]+"_club",next(x["price"] for x in self.source_catalog["products"] if x["id"]==p["id"])))
            sheet.write(n,8,overrides.get(p["id"]+"_stock",999.123))  # Must not leak.
        book.save(str(self.xls))

    def evaluate(self,**k):
        return run(self.xls,self.cat,self.allow,
                   sender=k.get("sender","palleta.store@yandex.ru"),
                   subject=k.get("subject","Паллета 1С - Меню"),
                   email_sent_at=k.get("sent",SENT),
                   now=k.get("now",NOW))

    def test_valid_updated_prices_not_stock(self):
        outcome,audit=self.evaluate()
        self.assertEqual(audit["result"],"PASS_DATED_REFERENCE_ONLY")
        self.assertEqual(audit["updated_prices"],7)
        self.assertEqual(audit["capture"],"2026-10-14T19:00:13+03:00")
        for p in outcome["products"]:
            if p["id"] in {x["id"] for x in self.mapping}:
                self.assertEqual(p["price"],next(x["price"] for x in self.source_catalog["products"] if x["id"]==p["id"]))
                self.assertEqual(p["price_source"],"manual_club_snapshot")
                self.assertEqual(p["price_snapshot_time"],"2026-10-14T19:00:13+03:00")
                self.assertEqual(p["availability"],"unknown")
                self.assertIsNone(p["stock_quantity"])
                self.assertNotEqual(p["price"],1000.0)
            if not p["sold_in_palleta"]:
                self.assertIsNone(p["price"])
        self.assertNotIn("999.123",json.dumps(outcome))

    def test_wrong_header_stops(self):
        self.synthetic({"headers":{(1,5):"Цена Закупочная"}})
        with self.assertRaisesRegex(ValueError,"header"):self.evaluate()

    def test_wrong_identity_stops_all(self):
        self.synthetic({"potato_name":"Картофель молодой другая фасовка"})
        with self.assertRaisesRegex(ValueError,"name changed"):self.evaluate()

    def test_missing_required_stops_all(self):
        self.synthetic(omit="potato")
        with self.assertRaisesRegex(ValueError,"missing in XLS"):self.evaluate()

    def test_price_jump_stops_all(self):
        self.synthetic({"potato_club":2.0})
        with self.assertRaisesRegex(ValueError,"more than 50%"):self.evaluate()

    def test_no_sender_spoofing(self):
        with self.assertRaisesRegex(ValueError,"sender"):self.evaluate(sender="attacker@example.org")
        with self.assertRaisesRegex(ValueError,"subject"):self.evaluate(subject="Other report")

    def test_wrong_report_date_stops(self):
        with self.assertRaisesRegex(ValueError,"timestamp"):self.evaluate(sent="2026-10-14T15:20:11+03:00")
        with self.assertRaisesRegex(ValueError,"too old"):self.evaluate(now=NOW+timedelta(days=1))

    def test_bad_unit_manifest_stops(self):
        manifest=json.loads(self.allow.read_text(encoding="utf-8"))
        manifest["approved"][0]["ut_unit"]="шт"
        self.allow.write_text(json.dumps(manifest,ensure_ascii=False),encoding="utf-8")
        with self.assertRaisesRegex(ValueError,"kilogram"):self.evaluate()

    def test_unreviewed_product_cannot_be_published(self):
        manifest=json.loads(self.allow.read_text(encoding="utf-8"))
        manifest["approved"].append({"id":"chicken_offal","internal_code":"УТ-00001113",
                                     "ut_name":"Куриные потроха","ut_unit":"кг","pricing_mode":"by_weight"})
        self.allow.write_text(json.dumps(manifest,ensure_ascii=False),encoding="utf-8")
        with self.assertRaisesRegex(ValueError,"missing in XLS|not sold"):self.evaluate()

    def test_unknown_date_metadata_stops(self):
        with self.assertRaisesRegex(ValueError,"timezone"):self.evaluate(sent="2026-10-14T19:00:13")

if __name__=="__main__":unittest.main()
