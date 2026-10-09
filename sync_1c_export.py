#!/usr/bin/env python3
"""Import an approved PUBLIC retail price + stock CSV from 1C into products.json.

Does not connect to 1C or GitHub itself, unless explicitly invoked with --push.
Does not export buying prices, margins, supplier/customer data.
"""
import argparse
import csv
import datetime as dt
import json
import math
import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parent


def parse_iso(text):
    d=dt.datetime.fromisoformat(text.strip())
    if d.tzinfo is None or d.utcoffset() is None:
        raise ValueError('captured_at must include timezone, e.g. 2026-10-09T18:00:00+03:00')
    if d.astimezone(dt.timezone.utc)>dt.datetime.now(dt.timezone.utc)+dt.timedelta(minutes=5):
        raise ValueError('captured_at cannot be in the future')
    return d


def number(raw,label):
    try:v=float(str(raw).replace(' ', '').replace(',','.'))
    except (ValueError,TypeError):raise ValueError(f'{label}: invalid numeric value')
    if not math.isfinite(v) or v<0:raise ValueError(f'{label}: must be finite and non-negative')
    return v


def convert(csv_path,json_path,dry_run=False,require_all_codes=False,max_age_minutes=None):
    catalog=json.loads(json_path.read_text('utf-8'))
    by_code={p['sku_code']:p for p in catalog['products'] if p.get('sku_code')}
    if len(by_code)!=len([p for p in catalog['products'] if p.get('sku_code')]):
        raise ValueError('Duplicate sku_code in products.json')
    rows=[]; seen=set()
    with csv_path.open('r',encoding='utf-8-sig',newline='') as inp:
        data=csv.DictReader(inp,delimiter=';')
        required={'sku_code','retail_price','stock_quantity','captured_at','unit','stock_unit'}
        if not required.issubset(data.fieldnames or []):
            raise ValueError('Missing CSV fields: '+', '.join(sorted(required-set(data.fieldnames or []))))
        for n,row in enumerate(data,start=2):
            code=row['sku_code'].strip()
            if not code:raise ValueError(f'Row {n}: empty sku_code')
            if code in seen:raise ValueError(f'Row {n}: duplicate sku_code {code}')
            seen.add(code)
            if code not in by_code:continue
            p=by_code[code]
            unit=row['unit'].strip()
            expect_unit=p['unit']
            if unit!=expect_unit:raise ValueError(f'Row {n}: unit mismatch for {code}: {unit} != {expect_unit}')
            expect_stock_unit='pack' if p['pricing_mode']=='by_pack' else expect_unit
            if row['stock_unit'].strip()!=expect_stock_unit:raise ValueError(f'Row {n}: stock_unit mismatch for {code}, expect {expect_stock_unit}')
            price=number(row['retail_price'],f'Row {n} retail_price')
            if price<=0:raise ValueError(f'Row {n}: retail price must be positive, not zero')
            qty=number(row['stock_quantity'],f'Row {n} stock_quantity')
            if p['pricing_mode']=='by_pack' and not qty.is_integer():raise ValueError(f'Row {n}: stock_quantity for packs must be integer')
            stamp=parse_iso(row['captured_at'])
            if max_age_minutes is not None:
                age=(dt.datetime.now(dt.timezone.utc)-stamp.astimezone(dt.timezone.utc)).total_seconds()/60
                if age>max_age_minutes:raise ValueError(f'Row {n}: captured_at too old ({age:.1f} minutes, limit {max_age_minutes})')
            rows.append((p,price,qty,stamp.isoformat(timespec='seconds')))
    if not rows:raise ValueError('No CSV sku_code matches current catalog. No updates applied.')
    if require_all_codes and len(rows)!=len(by_code):
        missing=sorted(set(by_code)-seen)
        raise ValueError(f'Incomplete approved export: missing {len(missing)} mapped SKU codes: {missing[:15]}')
    for p,price,qty,stamp in rows:
        p.update(price=price,price_as_of=stamp,price_source='current_retail',
                 stock_quantity=qty,availability='in_stock' if qty>0 else 'out_of_stock',
                 availability_checked_at=stamp)
    catalog['data_status']='csv_imported_no_direct_1c_connection'
    catalog['last_csv_imported_at']=dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
    if not dry_run:json_path.write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n','utf-8')
    return len(rows),len(by_code)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--csv',required=True,type=Path)
    p.add_argument('--catalog',default=ROOT/'products.json',type=Path)
    p.add_argument('--dry-run',action='store_true')
    p.add_argument('--push',action='store_true',help='Only with explicit approval, commits products.json to this repository and pushes main')
    p.add_argument('--require-all-codes',action='store_true',help='Fail closed unless every mapped product is present in the export')
    p.add_argument('--max-age-minutes',type=int,default=None,help='Fail if any row was captured more than N minutes ago')
    args=p.parse_args()
    if args.push and args.dry_run:raise SystemExit('--push cannot be combined with --dry-run')
    n,total=convert(args.csv,args.catalog,args.dry_run,require_all_codes=args.require_all_codes,max_age_minutes=args.max_age_minutes)
    print(f'Matched and validated {n} of {total} catalog SKU codes. '+('DRY RUN' if args.dry_run else 'products.json updated locally'))
    if args.push:
        subprocess.run(['git','add','products.json'],cwd=ROOT,check=True)
        subprocess.run(['git','commit','-m','Update public Palleta retail prices and stock from approved 1C export'],cwd=ROOT,check=True)
        subprocess.run(['git','push','origin','main'],cwd=ROOT,check=True)
        print('Changes pushed; GitHub Pages rebuild is triggered.')

if __name__=='__main__':main()