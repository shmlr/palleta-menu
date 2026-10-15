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
CAP="2026-10-14 20-52-52"
SENT="2026-10-14T20:52:56+03:00"
NOW=datetime(2026,10,14,21,5,0,tzinfo=MSK)


class MinMaxEveningTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root=Path(self.temp.name)
        base=Path(__file__).resolve().parent
        self.cat=root/"products.json"
        self.allow=root/"allowlist.json"
        self.identity=root/"sku_identity_review.json"
        self.cat.write_text((base/"products.json").read_text(encoding="utf-8"),encoding="utf-8")
        self.allow.write_text((base/"tools/club_price_allowlist.json").read_text(encoding="utf-8"),encoding="utf-8")
        self.identity.write_text((base/"tools/sku_identity_review.json").read_text(encoding="utf-8"),encoding="utf-8")
        self.xls=root/("Отчет_Паллета 1С - Меню_"+CAP+".xls")
        self.mapping=json.loads(self.allow.read_text(encoding="utf-8"))["approved"]
        self.source_catalog=json.loads(self.cat.read_text(encoding="utf-8"))
        # The public catalog now has the 20:52 dated price snapshot. Tests
        # simulate the preceding 15:20 revision to validate a NEW email.
        ids={a["id"] for a in self.mapping}
        for product in self.source_catalog["products"]:
            if product["id"] in ids:
                product["price_snapshot_time"]="2026-10-14T15:20:11+03:00"
                product["price_as_of"]="2026-10-14"
        self.cat.write_text(json.dumps(self.source_catalog,ensure_ascii=False),encoding="utf-8")
        self.synthetic()

    def synthetic(self,overrides=None,omit=None,extra_rows=0):
        overrides=overrides or {}
        book=xlwt.Workbook(encoding="utf-8")
        sheet=book.add_sheet("Лист_1")
        headers={(0,1):"Код",(0,2):"Артикул",(0,3):"Наименование",(0,4):"Доп. инфо",
                 (0,5):"Доп. цены",(0,6):"Текущие остатки",
                 (1,4):"Реквизиты",(1,5):"Цена Оптовая",(1,6):"Дней запаса",
                 (1,7):"Свободный остаток",(1,8):"Сумма излишков",
                 (1,9):"В пути",(2,4):"<<ЕдиницаИзмерения>>"}
        headers.update(overrides.get("headers",{}))
        for (r,c),v in headers.items():sheet.write(r,c,v)
        sheet.write(3,3,"РД (7)")
        for n,p in enumerate(self.mapping,start=4):
            if p["id"]==omit:continue
            sheet.write(n,1,p["internal_code"])
            sheet.write(n,3,overrides.get(p["id"]+"_name",p["ut_name"]))
            sheet.write(n,4,overrides.get(p["id"]+"_unit",p["ut_unit"]))
            sheet.write(n,5,overrides.get(p["id"]+"_club",next(x["price"] for x in self.source_catalog["products"] if x["id"]==p["id"])))
            sheet.write(n,6,overrides.get(p["id"]+"_days_stock",11))  # Not a price.
            sheet.write(n,7,overrides.get(p["id"]+"_stock",999.123))  # Must not leak.
        for j in range(extra_rows):
            n=len(self.mapping)+4+j
            sheet.write(n,1,overrides.get("extra_code","УТ-"+str(50000000+j).zfill(8)) if j==0 else "УТ-"+str(50000000+j).zfill(8))
            sheet.write(n,3,"Unrelated synthetic category item "+str(j))
            sheet.write(n,4,"шт")
            if j%3:sheet.write(n,5,10)
            # Some unrelated rows have blank club price, which should not fail the allowlist.
            if j%20==0:sheet.write(n,7,0)
        expected=len(self.mapping)-(1 if omit else 0)+extra_rows
        sheet.write(4+len(self.mapping)+extra_rows,3,"Итого различных товаров: "+str(overrides.get("footer_count",expected)))
        book.save(str(self.xls))

    def evaluate(self,**k):
        return run(self.xls,self.cat,self.allow,
                   sender=k.get("sender","palleta.store@yandex.ru"),
                   subject=k.get("subject","Паллета 1С - Меню"),
                   email_sent_at=k.get("sent",SENT),
                   now=k.get("now",NOW), identity_path=self.identity)

    def test_valid_updated_prices_not_stock(self):
        outcome,audit=self.evaluate()
        self.assertEqual(audit["result"],"PASS_DATED_REFERENCE_ONLY")
        self.assertEqual(audit["updated_prices"],1)
        self.assertEqual(audit["capture"],"2026-10-14T20:52:52+03:00")
        for p in outcome["products"]:
            if p["id"] in {x["id"] for x in self.mapping}:
                self.assertEqual(p["price"],next(x["price"] for x in self.source_catalog["products"] if x["id"]==p["id"]))
                self.assertEqual(p["price_source"],"manual_club_snapshot")
                self.assertEqual(p["price_snapshot_time"],"2026-10-14T20:52:52+03:00")
                self.assertEqual(p["availability"],"unknown")
                self.assertIsNone(p["stock_quantity"])
                self.assertNotEqual(p["price"],1000.0)
            if not p["sold_in_palleta"]:
                self.assertIsNone(p["price"])
        self.assertNotIn("999.123",json.dumps(outcome))


    def test_wrong_unit_stops(self):
        self.synthetic({"potato_unit":"шт"})
        with self.assertRaisesRegex(ValueError,"unit differs"):self.evaluate()

    def test_missing_approved_price_stops(self):
        self.synthetic({"potato_club":"нет"})
        with self.assertRaisesRegex(ValueError,"club price missing"):self.evaluate()

    def test_large_expanded_14577_sku_report(self):
        self.synthetic(extra_rows=14577-len(self.mapping))
        updated,audit=self.evaluate()
        self.assertEqual(audit["source_rows"],14577)
        self.assertEqual(audit["updated_prices"],1)
        self.assertFalse(audit["stock_published"])

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
        with self.assertRaisesRegex(ValueError,"search code|not sold|identity review|pack size"):self.evaluate()

    def test_unknown_date_metadata_stops(self):
        with self.assertRaisesRegex(ValueError,"timezone"):self.evaluate(sent="2026-10-14T19:00:13")


    def test_wrong_search_code_stops(self):
        manifest=json.loads(self.allow.read_text(encoding="utf-8"))
        manifest["approved"][0]["search_code"]="9999"
        self.allow.write_text(json.dumps(manifest,ensure_ascii=False),encoding="utf-8")
        with self.assertRaisesRegex(ValueError,"search code"):self.evaluate()

    def test_pending_review_stops(self):
        registry=json.loads(self.identity.read_text(encoding="utf-8"))
        for entry in registry["products"]:
            if entry["product_id"]=="potato":entry["review_status"]="REVIEW_PENDING"
        self.identity.write_text(json.dumps(registry,ensure_ascii=False),encoding="utf-8")
        with self.assertRaisesRegex(ValueError,"identity review"):self.evaluate()

    def test_purchase_step_changed_stops(self):
        manifest=json.loads(self.allow.read_text(encoding="utf-8"))
        manifest["approved"][0]["target_purchase_step_kg"]=0.2
        self.allow.write_text(json.dumps(manifest,ensure_ascii=False),encoding="utf-8")
        with self.assertRaisesRegex(ValueError,"pack size"):self.evaluate()

    def test_unrelated_numeric_code_is_allowed_but_not_imported(self):
        # Real expanded XLS has 24 legacy numeric-only codes outside allowlist.
        self.synthetic({"extra_code":"69331106821"}, extra_rows=1)
        catalog, audit = self.evaluate()
        self.assertEqual(audit["updated_prices"], 1)
        self.assertEqual(audit["source_rows"], len(self.mapping) + 1)
        self.assertTrue(all(p["id"] != "69331106821" for p in catalog["products"]))
        self.assertFalse(audit["stock_published"])

    def test_numeric_internal_code_cannot_be_approved(self):
        manifest=json.loads(self.allow.read_text(encoding="utf-8"))
        manifest["approved"][0]["internal_code"]="69331106821"
        self.allow.write_text(json.dumps(manifest,ensure_ascii=False),encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "approved internal code"):
            self.evaluate()

    def test_duplicate_approved_code_in_unrelated_row_stops(self):
        self.synthetic({"extra_code":self.mapping[0]["internal_code"]}, extra_rows=1)
        with self.assertRaisesRegex(ValueError, "duplicate internal code"):
            self.evaluate()

    def test_unexpected_internal_code_stops(self):
        self.synthetic({"extra_code":"BAD-CODE"},extra_rows=1)
        with self.assertRaisesRegex(ValueError,"unexpected nonempty internal code"):self.evaluate()

    def test_report_footer_count_stops(self):
        self.synthetic({"footer_count":777})
        with self.assertRaisesRegex(ValueError,"product count"):self.evaluate()

    def test_legacy_allowlist_stops(self):
        manifest=json.loads(self.allow.read_text(encoding="utf-8"))
        manifest["schema_version"]=2
        self.allow.write_text(json.dumps(manifest,ensure_ascii=False),encoding="utf-8")
        with self.assertRaisesRegex(ValueError,"schema_version"):self.evaluate()


if __name__=="__main__":unittest.main()
