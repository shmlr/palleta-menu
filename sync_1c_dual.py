#!/usr/bin/env python3
"""Fail-closed merge of TWO approved public 1C exports for Palleta GitHub Pages.

Retail CSV: cashier/customer-facing retail prices. UT CSV: saleable-to-order
quantities, *not* raw warehouse accounting balances. No direct 1C/GitHub access.
"""
import argparse
import csv
import datetime as dt
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PRICE_FIELDS = {'store_key', 'sku_code', 'retail_price', 'price_unit', 'captured_at'}
STOCK_FIELDS = {'store_key', 'sku_code', 'available_quantity', 'stock_unit', 'captured_at'}


def stamp(value, label, now, max_age_minutes):
    try:
        t = dt.datetime.fromisoformat(value.strip())
    except (ValueError, AttributeError) as exc:
        raise ValueError(f'{label}: invalid captured_at ISO 8601') from exc
    if t.tzinfo is None or t.utcoffset() is None:
        raise ValueError(f'{label}: captured_at must include time zone offset')
    diff = (now - t.astimezone(dt.timezone.utc)).total_seconds() / 60
    if diff < -2:
        raise ValueError(f'{label}: timestamp from the future ({-diff:.1f} min)')
    if diff > max_age_minutes:
        raise ValueError(f'{label}: stale export ({diff:.1f} min > {max_age_minutes})')
    return t.astimezone(dt.timezone.utc)


def decimal_value(value, label, positive=False):
    try:
        number = float(str(value).strip().replace('\u00a0', '').replace(' ', '').replace(',', '.'))
    except (ValueError, TypeError) as exc:
        raise ValueError(f'{label}: invalid number') from exc
    if not math.isfinite(number) or number < 0 or (positive and number == 0):
        raise ValueError(f'{label}: expected {"positive" if positive else "non-negative"} finite number')
    return number


def read_approved_csv(path, fields, known_codes, store_key, now, max_age_minutes):
    if not path.is_file():
        raise ValueError(f'Approved CSV not found: {path}')
    result = {}
    with path.open('r', encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f, delimiter=';')
        present = reader.fieldnames or []
        if len(present) != len(set(present)) or set(present) != fields:
            raise ValueError(f'{path.name}: expected EXACT headers {sorted(fields)}, got {present}')
        for line, row in enumerate(reader, 2):
            if None in row or any(v is None for v in row.values()):
                raise ValueError(f'{path.name}, row {line}: malformed CSV')
            key = (row['store_key'] or '').strip()
            code = (row['sku_code'] or '').strip()
            if key != store_key:
                raise ValueError(f'{path.name}, row {line}: store_key mismatch: {key!r}')
            if code not in known_codes:
                raise ValueError(f'{path.name}, row {line}: SKU {code!r} is NOT in approved public whitelist')
            if code in result:
                raise ValueError(f'{path.name}, row {line}: duplicate SKU {code!r}')
            result[code] = (row, stamp(row['captured_at'], f'{path.name} row {line}', now, max_age_minutes))
    missing = known_codes - set(result)
    if missing:
        raise ValueError(f'{path.name}: missing {len(missing)} mapped SKUs: {sorted(missing)[:20]}')
    if not result:
        raise ValueError(f'{path.name}: approved catalog has zero mapped SKUs')
    return result


def merge(prices_csv, stock_csv, catalog_path, store_key, dry_run=False,
          max_age_minutes=20, max_skew_minutes=15, now=None):
    if not store_key or store_key in {'YOUR_STORE_KEY', 'STORE_KEY_FROM_1C'}:
        raise ValueError('Explicit approved --store-key is required (same for Retail and UT)')
    if prices_csv.resolve() == stock_csv.resolve():
        raise ValueError('Price and stock files MUST come from separate 1C exports')
    now = now or dt.datetime.now(dt.timezone.utc)
    catalog = json.loads(catalog_path.read_text('utf-8'))
    selected = [p for p in catalog['products'] if p.get('sku_code')]
    by_code = {p['sku_code']: p for p in selected}
    if len(by_code) != len(selected):
        raise ValueError('Duplicate sku_code in approved public catalog')
    known = set(by_code)
    price_rows = read_approved_csv(prices_csv, PRICE_FIELDS, known, store_key, now, max_age_minutes)
    stock_rows = read_approved_csv(stock_csv, STOCK_FIELDS, known, store_key, now, max_age_minutes)
    results = []
    for code in sorted(known):
        product = by_code[code]
        p, pt = price_rows[code]
        s, st = stock_rows[code]
        minutes = abs((pt - st).total_seconds()) / 60
        if minutes > max_skew_minutes:
            raise ValueError(f'{code}: Retail/UT snapshot mismatch {minutes:.1f} min > {max_skew_minutes}')
        mode = product['pricing_mode']
        expected = 'pack' if mode == 'by_pack' else product['unit']
        if p['price_unit'].strip() != expected:
            raise ValueError(f'{code}: Retail price_unit must be {expected!r}')
        if s['stock_unit'].strip() != expected:
            raise ValueError(f'{code}: UT stock_unit must be {expected!r}')
        price = decimal_value(p['retail_price'], code + ' retail_price', positive=True)
        quantity = decimal_value(s['available_quantity'], code + ' available_quantity')
        if mode == 'by_pack' and not quantity.is_integer():
            raise ValueError(f'{code}: saleable packs must be an integer')
        if not math.isclose(round(price, 2), price, abs_tol=1e-7):
            raise ValueError(f'{code}: cashier price has >2 fractional ruble digits')
        results.append((product, round(price, 2), quantity, pt, st))
    # No partial mutation before ALL independent validations have succeeded.
    for product, price, quantity, pt, st in results:
        product.update(price=price, price_as_of=pt.isoformat(timespec='seconds'),
                       price_source='current_retail', price_source_system='1C_Retail',
                       stock_quantity=quantity,
                       availability='in_stock' if quantity > 0 else 'out_of_stock',
                       availability_checked_at=st.isoformat(timespec='seconds'),
                       stock_source_system='1C_UT')
    catalog['data_status'] = 'retail_prices_ut_saleable_stock_verified_csv'
    catalog['sync_source_store_key'] = store_key
    catalog['price_snapshot_at'] = max(x[3] for x in results).isoformat(timespec='seconds')
    catalog['stock_snapshot_at'] = max(x[4] for x in results).isoformat(timespec='seconds')
    payload = json.dumps(catalog, ensure_ascii=False, indent=2) + '\n'
    if not dry_run and payload != catalog_path.read_text('utf-8'):
        temp = catalog_path.with_suffix('.json.tmp')
        temp.write_text(payload, encoding='utf-8')
        temp.replace(catalog_path)
    return {'mapped_skus':len(known), 'unmapped_skus':len(catalog['products'])-len(known),
            'dry_run':dry_run, 'price_snapshot':catalog['price_snapshot_at'],
            'stock_snapshot':catalog['stock_snapshot_at']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prices', required=True, type=Path)
    parser.add_argument('--stock', required=True, type=Path)
    parser.add_argument('--catalog', type=Path, default=ROOT / 'products.json')
    parser.add_argument('--store-key', required=True)
    parser.add_argument('--max-age-minutes', type=int, default=20)
    parser.add_argument('--max-skew-minutes', type=int, default=15)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    if args.max_age_minutes<=0 or args.max_skew_minutes<0:
        parser.error('Invalid maximum age/skew')
    result = merge(args.prices, args.stock, args.catalog, args.store_key, args.dry_run,
                   args.max_age_minutes, args.max_skew_minutes)
    print('PASS' if not args.dry_run else 'PASS DRY-RUN',json.dumps(result,ensure_ascii=False))

if __name__ == '__main__':
    main()