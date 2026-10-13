#!/usr/bin/env python3
"""READ-ONLY import audit for two *dated* standard UT/min-max Excel exports.

No writing to 1C, no git command, no credentials, no current-price assertions.
The only output is a LOCAL QA JSON report that must never be used directly
as a published live inventory snapshot.  The source XLSX includes buying
prices and margin fields, which are deliberately never copied to output.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import re
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path
from zipfile import ZipFile

XML='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
FIELD_REF=re.compile(r'^[A-Z]+')
INTERNAL_RE=re.compile(r'^[А-ЯA-Z]{2}-\d{8}$')


def xlsx_rows(path):
    """Stream XLSX sheet1 without installing Office or spreadsheet add-ons."""
    with ZipFile(path) as z:
        if 'xl/worksheets/sheet1.xml' not in z.namelist():
            raise ValueError(f'{path}: missing first worksheet')
        if 'xl/sharedStrings.xml' in z.namelist():
            root=ET.fromstring(z.read('xl/sharedStrings.xml'))
            strings=[''.join((n.text or '') for n in si.iter(XML+'t')) for si in root.findall(XML+'si')]
        else:
            strings=[]
        with z.open('xl/worksheets/sheet1.xml') as fh:
            for _, node in ET.iterparse(fh, events=('end',)):
                if node.tag != XML+'row':
                    continue
                values={}
                for cell in node.findall(XML+'c'):
                    key=FIELD_REF.match(cell.attrib.get('r',''))
                    if not key:
                        continue
                    val=cell.find(XML+'v')
                    if cell.get('t')=='inlineStr':
                        inside=cell.find(XML+'is')
                        out=''.join((i.text or '') for i in inside.iter(XML+'t')) if inside is not None else ''
                    elif val is None:
                        continue
                    elif cell.get('t')=='s':
                        ix=int(val.text)
                        if ix>=len(strings):raise ValueError('Bad XLSX string index')
                        out=strings[ix]
                    else:
                        out=val.text
                        if cell.get('t') not in ('str','e'):
                            try:out=float(out)
                            except (ValueError,TypeError):pass
                    values[key.group()]=out
                if values: yield int(node.attrib['r']),values
                node.clear()


def norm(s):
    return ' '.join(str(s or '').lower().replace('ё','е').split())


def valid_num(x, allow_zero):
    if isinstance(x,bool) or not isinstance(x,(int,float)) or not math.isfinite(x):return False
    return x>=0 if allow_zero else x>0


def load_stock(path, asof):
    rows=xlsx_rows(path)
    header={}
    items={}
    short=defaultdict(set)
    for n,row in rows:
        if n<=13: header[n]=row;continue
        code=row.get('J')
        if not isinstance(code,str) or not INTERNAL_RE.fullmatch(code):continue
        if code in items:raise ValueError('Duplicate internal code in UT report '+code)
        search=str(row.get('I') or '').strip()
        # Blank search codes in unrelated UT rows are tolerated; any mapped SKU must match whitelist exactly.
        name=str(row.get('B') or '').strip()
        if not name:raise ValueError('UT row missing name for '+code)
        unit=str(row.get('H') or '').strip()
        # Unrelated UT rows may lack units. Mapped SKU validation below remains strict.
        qty=row.get('R')
        items[code]={'search_code':search,'internal_code':code,'name':name,'unit':unit,
                     'closing_qty':qty if isinstance(qty,(int,float)) else None,
                     'article':str(row.get('A') or '').strip(), 'source_row':n}
        if search:short[search].add(code)
    expected={'I':'Номенклатура.Код для поиска','J':'Номенклатура.Код','H':'Ед. изм.','R':'Количество'}
    for col,title in expected.items():
        row=header[12] if col in ('I','J','H') else header[12]
        if norm(row.get(col))!=norm(title):raise ValueError(f'UT report: unexpected header {col}, expected {title!r}, got {row.get(col)!r}')
    if 'Паллета Петра 1' not in str(header.get(13,{}).get('A','')):
        raise ValueError('UT report was not scoped to Palleta Petra 1 warehouse')
    if asof not in str(header.get(4,{}).get('C','')):
        raise ValueError('UT report period does not match --as-of')
    return items,short


def load_minmax(path):
    rows=xlsx_rows(path)
    header={}; items={}
    for n,row in rows:
        if n<=2:header[n]=row;continue
        code=row.get('B')
        if not isinstance(code,str) or not INTERNAL_RE.fullmatch(code):continue
        if code in items:raise ValueError('Duplicate internal code in min-max export '+code)
        price=row.get('I'); free=row.get('R')
        items[code]={'name':str(row.get('D') or '').strip(),
                     'article':str(row.get('C') or '').strip(),
                     'club_price':price if valid_num(price,False) else None,
                     'qty_free':free if valid_num(free,True) else None,
                     'source_row':n}
    for col,val,row in [('B','Код',1),('D','Наименование',1),('I','Цена Оптовая',2),('R','Свободный остаток',2)]:
        if norm(header.get(row,{}).get(col))!=norm(val):
            raise ValueError(f'min-max export: unexpected header {col}: {header.get(row,{}).get(col)!r}')
    return items


def build_report(ut_path,mm_path,manifest_path,asof):
    dt.datetime.strptime(asof,'%d.%m.%Y')
    inventory,short=load_stock(ut_path,asof)
    minmax=load_minmax(mm_path)
    manifest=json.loads(Path(manifest_path).read_text(encoding='utf-8'))
    mappings=manifest['products']
    if len({x['product_id'] for x in mappings})!=len(mappings):raise ValueError('Duplicate product_id in manifest')
    if len({x['internal_code'] for x in mappings if x.get('internal_code')})!=len([x for x in mappings if x.get('internal_code')]):
        raise ValueError('Duplicate internal_code across product mappings')
    lines=[]
    for a in mappings:
        internal=a.get('internal_code');pid=a['product_id'];status=a['review_status']
        if not internal:
            lines.append({'id':pid,'status':'UNMAPPED','reason':a.get('review_note','No exact SKU')});continue
        stock=inventory.get(internal)
        if stock is None:
            lines.append({'id':pid,'internal_code':internal,'status':'STOP','reason':'Internal code missing in UT report'});continue
        if str(stock['search_code'])!=str(a.get('search_code')):
            lines.append({'id':pid,'internal_code':internal,'status':'STOP','reason':'Composite identity mismatch: UT search code differs from whitelist'});continue
        if norm(a.get('ut_name'))!=norm(stock['name']):
            lines.append({'id':pid,'internal_code':internal,'status':'STOP','reason':'UT name differs from frozen whitelist'});continue
        if a.get('ut_unit')!=stock['unit']:
            lines.append({'id':pid,'internal_code':internal,'status':'STOP','reason':'UT unit differs from whitelist'});continue
        mm=minmax.get(internal)
        if mm is not None and norm(mm['name'])!=norm(stock['name']):
            lines.append({'id':pid,'internal_code':internal,'status':'STOP','reason':'UT/min-max names differ for same internal code'});continue
        checks=[]
        if len(short[stock['search_code']])>1: checks.append('search_code_collides')
        if not mm:checks.append('absent_from_minmax')
        if mm and mm['club_price'] is None:checks.append('no_valid_club_price')
        if mm and mm['qty_free'] is None:checks.append('free_qty_unknown_not_zero')
        if mm and mm['qty_free'] is not None and stock['closing_qty'] is not None and not math.isclose(mm['qty_free'],stock['closing_qty'],abs_tol=.00001):checks.append('qty_sources_disagree')
        if status!='REVIEWED':checks.append('mapping_not_approved')
        if not a.get('unit_conversion_approved'):checks.append('unit_conversion_not_approved')
        line={'id':pid,'internal_code':internal,'search_code':stock['search_code'],
              'article':stock['article'],'ut_name':stock['name'],'ut_unit':stock['unit'],
              'unit_target':a.get('target_unit'),'review_status':status,
              'club_price_snapshot':mm['club_price'] if mm else None,
              'ut_closing_qty_snapshot':stock['closing_qty'],
              'minmax_free_qty_snapshot':mm['qty_free'] if mm else None,
              'checks':checks,'ut_source_row':stock['source_row'],
              'minmax_source_row':mm['source_row'] if mm else None}
        # A dated export is never a live/available inventory feed, regardless of checks.
        line['publishable_live']=False
        line['status']='MATCH_REVIEW_NEEDED' if checks else 'MATCH_DATED_ONLY'
        lines.append(line)
    summary=Counter(x['status'] for x in lines)
    return {'kind':'READ_ONLY_DATED_QA','asof':asof,
            'source_files':{'stock':Path(ut_path).name,'minmax':Path(mm_path).name},
            'warehouse':'Паллета Петра 1',
            'minmax_snapshot_timestamp_status':'UNVERIFIED_FILE_HAS_NO_TRUSTED_CAPTURED_AT',
            'stock_rows':len(inventory),'minmax_rows':len(minmax),
            'search_codes_with_collisions':sum(len(x)>1 for x in short.values()),
            'mapping_rows':len(lines),'summary':dict(summary),
            'unsafe_to_publish_as_live':True,
            'privacy':'No buying prices, margin, customers or supplier data included',
            'rows':lines}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--stock',type=Path,required=True)
    p.add_argument('--minmax',type=Path,required=True)
    p.add_argument('--manifest',type=Path,default=Path(__file__).with_name('sku_identity_review.json'))
    p.add_argument('--as-of',required=True,help='DD.MM.YYYY from UT report, explicit')
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args()
    report=build_report(a.stock,a.minmax,a.manifest,a.as_of)
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k!='rows'},ensure_ascii=False,indent=2))

if __name__=='__main__':main()