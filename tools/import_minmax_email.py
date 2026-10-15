#!/usr/bin/env python3
"""Fail-closed importer for dated club prices in emailed min-max XLS (BIFF8).

Input must be obtained from the trusted Gmail message by an authorized operator.
Only independently REVIEWED paired-code SKU identities may receive dated price updates.
Never imports or publishes free/physical stock, costs, markup, customer or supplier data.
Requires xlrd==2.0.2; never runs macros, creates orders, or contacts 1C.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import json
import math
import os
from pathlib import Path
import re
import tempfile

import xlrd

REPORT_NAME = re.compile(r"^Отчет_Паллета 1С - Меню_(\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2})\.xls$")
INTERNAL = re.compile(r"^[А-ЯA-Z]{2}-\d{8}$")
CLUB = "Оптовая, RUB"
MSK = timezone(timedelta(hours=3))
EXPECTED_HEADERS = {
    (0, 1): "Код",
    (0, 2): "Артикул",
    (0, 3): "Наименование",
    (0, 4): "Доп. инфо",
    (0, 5): "Доп. цены",
    (0, 6): "Текущие остатки",
    (1, 4): "Реквизиты",
    (1, 5): "Цена Оптовая",
    (1, 6): "Дней запаса",
    (1, 7): "Свободный остаток",
    (1, 8): "Сумма излишков",
    (1, 9): "В пути",
    (2, 4): "<<ЕдиницаИзмерения>>",
}
MAX_BYTES = 25_000_000
MAX_ROWS = 40_000


def fail(message: str):
    raise ValueError("STOP: " + message)


def normal(value):
    return " ".join(str(value).strip().replace("ё", "е").lower().split())


def timestamp(value, label):
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        fail(label + " must be ISO-8601 date with timezone")
    if dt.tzinfo is None:
        fail(label + " must specify a timezone")
    return dt.astimezone(MSK)


def read_report(path):
    path = Path(path)
    match = REPORT_NAME.fullmatch(path.name)
    if not match:
        fail("unexpected XLS filename; expected dated Palleta menu report")
    if not path.is_file() or not 0 < path.stat().st_size <= MAX_BYTES:
        fail("XLS size or existence invalid")
    captured = datetime.strptime(match.group(1), "%Y-%m-%d %H-%M-%S").replace(tzinfo=MSK)
    try:
        book = xlrd.open_workbook(str(path), on_demand=True, formatting_info=False)
        if book.nsheets != 1 or book.sheet_names() != ["Лист_1"]:
            fail("expected precisely one Лист_1 XLS sheet")
        sheet = book.sheet_by_index(0)
        if not 4 < sheet.nrows <= MAX_ROWS:
            fail("unexpected number of XLS rows")
        for (r, c), expected in EXPECTED_HEADERS.items():
            if normal(sheet.cell_value(r, c)) != normal(expected):
                fail(f"XLS header changed at ({r},{c}); want {expected}")
        rows = {}
        for n in range(4, sheet.nrows):
            code = sheet.cell_value(n, 1)
            if code is None or code == "":
                continue  # Group and totals rows have empty codes.
            if not isinstance(code, str) or not INTERNAL.fullmatch(code.strip()):
                fail(f"unexpected nonempty internal code on XLS row {n + 1}")
            code = code.strip()
            if code in rows:
                fail("duplicate internal code in XLS: " + code)
            name = sheet.cell_value(n, 3)
            unit = sheet.cell_value(n, 4)
            price = sheet.cell_value(n, 5)
            if not isinstance(name, str) or not name.strip():
                fail("product name missing for " + code)
            if not isinstance(unit, str) or not unit.strip():
                unit = None  # Unrelated SKUs may have no unit; allowlist rows must.
            # The expanded XLS includes 14K+ products and some have blank club prices.
            # Do not reject the entire report for unrelated unpriced items.
            # The approved subset is validated strictly in run() below.
            rounded = None
            if isinstance(price, (int, float)) and not isinstance(price, bool) and math.isfinite(price):
                if 0 < price <= 50_000:
                    try:
                        dec = Decimal(str(price))
                        cents = dec.quantize(Decimal(".01"), rounding=ROUND_HALF_UP)
                        if cents == dec:
                            rounded = cents
                    except (InvalidOperation, ValueError):
                        pass
            rows[code] = {"name": name.strip(), "unit": unit, "price": rounded}
        footer = sheet.cell_value(sheet.nrows - 1, 3)
        total = re.fullmatch(r"Итого различных товаров:\s*([0-9 ]+)", str(footer).strip())
        if not total or int(total.group(1).replace(" ", "")) != len(rows):
            fail("XLS product count does not match the report footer")
        return captured, rows
    finally:
        if "book" in locals():
            book.release_resources()


def run(report_path, catalog_path, allowlist_path, *, sender, subject, email_sent_at, now=None, identity_path=None):
    if sender.strip().lower() != "palleta.store@yandex.ru":
        fail("sender does not match approved Palleta email")
    if subject.strip() != "Паллета 1С - Меню":
        fail("email subject does not match approved report")
    sent = timestamp(email_sent_at, "email_sent_at")
    now = (now or datetime.now(timezone.utc)).astimezone(MSK)
    if now.tzinfo is None:
        fail("current timestamp must be timezone-aware")
    captured, rows = read_report(report_path)
    if abs((sent - captured).total_seconds()) > 120:
        fail("email timestamp and report filename timestamp disagree")
    if captured > now + timedelta(minutes=2):
        fail("report time is in the future")
    if now - captured > timedelta(hours=8):
        fail("XLS is too old for an evening price import")
    manifest = json.loads(Path(allowlist_path).read_text(encoding="utf-8"))
    catalog = json.loads(Path(catalog_path).read_text(encoding="utf-8"))
    registry_path = Path(identity_path) if identity_path else Path(__file__).with_name("sku_identity_review.json")
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    reviews = registry.get("products", [])
    if not isinstance(reviews, list) or len({r.get("product_id") for r in reviews}) != len(reviews):
        fail("identity registry invalid or duplicates product IDs")
    reviewed = {r["product_id"]: r for r in reviews}
    if manifest.get("schema_version") != 3:
        fail("manifest schema_version requires reviewed paired identity")
    if manifest.get("mode") != "dated_club_price_only" or manifest.get("price_type") != CLUB:
        fail("allowlist policy mismatch")
    if catalog.get("price_policy",{}).get("price_type") != CLUB:
        fail("catalog price policy is not club-card price")
    approved = manifest.get("approved", [])
    if not approved or len({a["id"] for a in approved}) != len(approved):
        fail("approved manifest is empty or duplicates IDs")
    if len({a["internal_code"] for a in approved}) != len(approved):
        fail("approved manifest duplicates internal codes")
    if len({str(a.get("search_code")) for a in approved}) != len(approved):
        fail("approved manifest duplicates search codes")
    products = {p["id"]: p for p in catalog["products"]}
    changes = []
    for spec in approved:
        code, pid = spec["internal_code"], spec["id"]
        if spec.get("ut_unit") != "кг" or spec.get("pricing_mode") != "by_weight":
            fail(pid + ": only pre-approved kilogram products may be imported")
        p = products.get(pid)
        if not p or p.get("sold_in_palleta") is not True:
            fail(pid + ": target product not sold in Palleta")
        if p.get("pricing_mode") != "by_weight" or p.get("unit") != "кг":
            fail(pid + ": unit or pricing mode differs from approved kilogram")
        if (p.get("internal_code") or p.get("price_matching_internal_code")) != code:
            fail(pid + ": catalog internal code does not match allowlist")
        search = str(spec.get("search_code") or "")
        if not search or str(p.get("sku_code") or "") != search:
            fail(pid + ": search code is not approved in catalog")
        if p.get("sku_code_status") != "verified_report" or p.get("identity_key") != code + "|" + search:
            fail(pid + ": verified internal/search code pair missing in catalog")
        approval = reviewed.get(pid)
        if (not approval or approval.get("review_status") != "REVIEWED"
                or approval.get("unit_conversion_approved") is not True):
            fail(pid + ": independent identity review not approved")
        if (approval.get("internal_code") != code
                or str(approval.get("search_code") or "") != search
                or normal(approval.get("ut_name")) != normal(spec.get("ut_name"))
                or normal(approval.get("ut_unit")) != "кг"
                or normal(approval.get("target_unit")) != "кг"):
            fail(pid + ": identity review code, name or units mismatch")
        step = spec.get("target_purchase_step_kg")
        if (not isinstance(step, (int, float)) or isinstance(step, bool) or step <= 0
                or str(p.get("pack_size")) != str(step)):
            fail(pid + ": pack size or purchase increment not approved")
        source = rows.get(code)
        if not source:
            fail(pid + ": required internal code is missing in XLS")
        if normal(source["name"]) != normal(spec["ut_name"]):
            fail(pid + ": source item name changed: manual review required")
        if normal(source["unit"]) != normal(spec["ut_unit"]):
            fail(pid + ": source unit differs from approved UT unit")
        if source["price"] is None:
            fail(pid + ": approved club price missing or invalid in XLS")
        old = p.get("price")
        if isinstance(old, (int, float)) and old > 0:
            prior = Decimal(str(old))
            if abs(source["price"] - prior) > prior * Decimal(".50"):
                fail(pid + ": club price changed by more than 50%; needs manual review")
        old_time = p.get("price_snapshot_time")
        if old_time and captured <= timestamp(old_time, pid + ".price_snapshot_time"):
            fail(pid + ": report is not newer than imported price snapshot")
        if p.get("price_as_of") and captured.date() < datetime.strptime(p["price_as_of"], "%Y-%m-%d").date():
            fail(pid + ": report date older than product price")
        changes.append((p, source["price"]))
    if not changes:
        fail("nothing matched")
    as_of = captured.date().isoformat()
    iso = captured.isoformat(timespec="seconds")
    for p, price in changes:
        p["price"] = float(price)
        p["price_source"] = "manual_club_snapshot"
        p["price_as_of"] = as_of
        p["price_snapshot_time"] = iso
        p["price_source_system"] = "1C_UT_11_minmax_email_verified"
        p["price_type"] = CLUB
        p["price_audience"] = "club_card"
        p["availability"] = "unknown"
        p["stock_quantity"] = None
        p["availability_checked_at"] = None
    catalog["last_reference_import"] = {
        "source": "minmax_verified_email",
        "as_of": iso,
        "mode": "dated_club_price_only",
        "updated_prices": len(changes),
        "online_stock_confirmed": False
    }
    catalog.setdefault("source_notes", []).append(
        f"{iso}: контрольный импорт {len(changes)} клубных цен из XLS min-max; "
        "только датированные справочные цены. Остатки, закупочные цены, маржа и сырой файл не публиковались."
    )
    public = [(p["id"], p["price"]) for p, _ in changes]
    return catalog, {"result": "PASS_DATED_REFERENCE_ONLY", "capture": iso,
                     "source_rows": len(rows), "updated_prices": len(changes),
                     "products": public, "stock_published": False}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--xls", type=Path, required=True)
    ap.add_argument("--catalog", type=Path, default=Path("products.json"))
    ap.add_argument("--allowlist", type=Path, default=Path("tools/club_price_allowlist.json"))
    ap.add_argument("--identity-review", type=Path, default=Path("tools/sku_identity_review.json"))
    ap.add_argument("--sender", required=True)
    ap.add_argument("--subject", required=True)
    ap.add_argument("--email-sent-at", required=True)
    ap.add_argument("--write", action="store_true", help="Explicitly allow atomic catalog update")
    args = ap.parse_args()
    try:
        result, audit = run(
            args.xls, args.catalog, args.allowlist,
            sender=args.sender, subject=args.subject, email_sent_at=args.email_sent_at,
            identity_path=args.identity_review)
        if args.write:
            target = args.catalog.resolve()
            target.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile("w", dir=target.parent, encoding="utf-8",
                                              delete=False, prefix=".palleta-validated-") as temp:
                temp.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
                staged = Path(temp.name)
            os.replace(staged, target)
        audit["mode"] = "CATALOG_UPDATED" if args.write else "DRY_RUN_NO_WRITES"
        print(json.dumps(audit, ensure_ascii=False, indent=2))
    except (ValueError, xlrd.XLRDError, OSError, KeyError, TypeError) as exc:
        print("FAIL_CLOSED: " + str(exc))
        raise SystemExit(2)


if __name__ == "__main__":
    main()
