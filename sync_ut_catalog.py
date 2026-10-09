#!/usr/bin/env python3
"""Import one approved UT 11 export of public retail prices + saleable inventory.

No 1C network access. No GitHub network access. CSV is created by a controlled
1C UT 11 export for exactly one shop, one approved price type and whitelisted SKU.
"""
from __future__ import annotations
import argparse
import csv
import datetime as dt
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FIELDS = ('store_key', 'sku_code', 'price_type', 'retail_price', 'price_unit',
          'available_quantity', 'stock_unit', 'captured_at')
STOP_VALUES = {'', 'STORE_KEY_FROM_1C', 'YOUR_STORE_KEY', 'PRICE_TYPE_FROM_UT', 'YOUR_PRICE_TYPE'}


def timestamp(raw: str, now: dt.datetime, max_age_minutes: int) -> dt.datetime:
    try:
        t = dt.datetime.fromisoformat(raw.strip())
    except (ValueError, AttributeError) as e:
        raise ValueError('captured_at: ISO 8601 with timezone is required') from e
    if t.tzinfo is None or t.utcoffset() is None:
        raise ValueError('captured_at: timezone offset is mandatory')
    utc = t.astimezone(dt.timezone.utc)
    age = (now - utc).total_seconds() / 60
    if age < -2:
        raise ValueError('captured_at: future timestamp')
    if age > max_age_minutes:
        raise ValueError(f'captured_at: export too old ({age:.1f} > {max_age_minutes} minutes)')
    return utc


def numeric(value: str, field: str, positive: bool) -> float:
    try:
        v = float(value.strip().replace('\u00a0', '').replace(' ', '').replace(',', '.'))
    except (AttributeError, TypeError, ValueError) as e:
        raise ValueError(f'{field}: invalid number') from e
    if not math.isfinite(v) or v < 0 or (positive and v <= 0):
        raise ValueError(f'{field}: finite {"positive" if positive else "non-negative"} number required')
    return v


def convert(source: Path, catalog_path: Path, store_key: str, price_type: str,
            dry_run: bool = False, max_age_minutes: int = 20,
            now: dt.datetime | None = None) -> dict:
    if store_key.strip() in STOP_VALUES or price_type.strip() in STOP_VALUES:
        raise ValueError('Explicit approved --store-key and --price-type are required')
    if max_age_minutes <= 0:
        raise ValueError('max-age-minutes must be positive')
    if now is None:
        now = dt.datetime.now(dt.timezone.utc)
    elif now.tzinfo is None or now.utcoffset() is None:
        raise ValueError('now must be timezone aware')
    now = now.astimezone(dt.timezone.utc)
    catalog = json.loads(catalog_path.read_text(encoding='utf-8'))
    selected = [p for p in catalog['products'] if p.get('sku_code')]
    by_code = {str(p['sku_code']).strip(): p for p in selected}
    if len(selected) != len(by_code) or not selected:
        raise ValueError('Mapped product whitelist must be non-empty with unique sku_code')
    codes = set(by_code)
    rows = {}
    if not source.is_file():
        raise ValueError('Approved UT CSV missing')
    with source.open('r', encoding='utf-8-sig', newline='') as file:
        reader = csv.DictReader(file, delimiter=';')
        if reader.fieldnames != list(FIELDS):
            raise ValueError(f'CSV headers must match exactly in order: {";".join(FIELDS)}')
        for number, row in enumerate(reader, start=2):
            if None in row or any(v is None for v in row.values()):
                raise ValueError(f'CSV row {number}: malformed/extra fields')
            sku = row['sku_code'].strip()
            if sku not in codes:
                raise ValueError(f'CSV row {number}: SKU outside approved public whitelist: {sku!r}')
            if sku in rows:
                raise ValueError(f'CSV row {number}: duplicate SKU: {sku!r}')
            if row['store_key'].strip() != store_key:
                raise ValueError(f'{sku}: store_key mismatch')
            if row['price_type'].strip() != price_type:
                raise ValueError(f'{sku}: price_type mismatch')
            product = by_code[sku]
            pack = product['pricing_mode'] == 'by_pack'
            expected = 'pack' if pack else product['unit']
            if row['price_unit'].strip() != expected or row['stock_unit'].strip() != expected:
                raise ValueError(f'{sku}: price/stock units mismatch, expected {expected!r}')
            price = numeric(row['retail_price'], f'{sku} retail_price', True)
            if not math.isclose(price, round(price, 2), abs_tol=1e-7):
                raise ValueError(f'{sku}: retail price has more than 2 decimal digits')
            qty = numeric(row['available_quantity'], f'{sku} available_quantity', False)
            if pack and not qty.is_integer():
                raise ValueError(f'{sku}: package stock must be integer')
            moment = timestamp(row['captured_at'], now, max_age_minutes)
            rows[sku] = (round(price, 2), qty, moment)
    missing = codes - set(rows)
    if missing:
        raise ValueError(f'Incomplete UT export: missing {len(missing)} SKU: {sorted(missing)[:20]}')
    # Mutate only after validating every row, including the timestamp and price type.
    for sku, (price, qty, moment) in rows.items():
        product = by_code[sku]
        t = moment.isoformat(timespec='seconds')
        product.update(price=price, price_as_of=t, price_source='current_retail',
                       price_source_system='1C_UT_11', price_type=price_type,
                       stock_quantity=qty,
                       availability='in_stock' if qty > 0 else 'out_of_stock',
                       availability_checked_at=t, stock_source_system='1C_UT_11')
    catalog['data_status'] = 'ut11_approved_prices_saleable_stock_csv'
    catalog['sync_source_store_key'] = store_key
    catalog['sync_source_price_type'] = price_type
    catalog['price_snapshot_at'] = max(x[2] for x in rows.values()).isoformat(timespec='seconds')
    catalog['stock_snapshot_at'] = catalog['price_snapshot_at']
    payload = json.dumps(catalog, ensure_ascii=False, indent=2) + '\n'
    if not dry_run and catalog_path.read_text(encoding='utf-8') != payload:
        temp = catalog_path.with_suffix('.json.tmp')
        temp.write_text(payload, encoding='utf-8')
        temp.replace(catalog_path)
    return {'mapped_skus': len(codes),
            'unmapped_skus': len(catalog['products']) - len(codes),
            'dry_run': dry_run,
            'snapshot_utc': catalog['price_snapshot_at']}


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--csv', type=Path, required=True)
    p.add_argument('--catalog', type=Path, default=ROOT / 'products.json')
    p.add_argument('--store-key', required=True)
    p.add_argument('--price-type', required=True)
    p.add_argument('--max-age-minutes', type=int, default=20)
    p.add_argument('--dry-run', action='store_true')
    a = p.parse_args()
    result = convert(a.csv, a.catalog, a.store_key, a.price_type,
                     a.dry_run, a.max_age_minutes)
    print(('PASS DRY-RUN ' if a.dry_run else 'PASS ') + json.dumps(result, ensure_ascii=False))

if __name__ == '__main__':
    main()