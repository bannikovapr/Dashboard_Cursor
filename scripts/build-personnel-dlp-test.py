# -*- coding: utf-8 -*-
"""
Builds a personnel utilization dataset from:
  data/РСЃРїРѕР»СЊР·РѕРІР°РЅРёРµ РїРµСЂСЃРѕРЅР°Р»Р°.xlsx

Output:
  data/personnel_dlp_test.json
"""
from __future__ import annotations

import json
import re
import csv
from pathlib import Path

import openpyxl


DATA_DIR = Path(__file__).resolve().parent.parent / "data"
SRC_XLSX = DATA_DIR / "РСЃРїРѕР»СЊР·РѕРІР°РЅРёРµ РїРµСЂСЃРѕРЅР°Р»Р°.xlsx"
OUT_JSON = DATA_DIR / "personnel_dlp_test.json"
OUT_CSV = DATA_DIR / "personnel_dlp_test_table.csv"

FIO_RE = re.compile(
    r"^[Рђ-РЇРЃ][Р°-СЏС‘]+(?:-[Рђ-РЇРЃ][Р°-СЏС‘]+)?\s+[Рђ-РЇРЃ][Р°-СЏС‘]+(?:-[Рђ-РЇРЃ][Р°-СЏС‘]+)?\s+[Рђ-РЇРЃ][Р°-СЏС‘]+(?:-[Рђ-РЇРЃ][Р°-СЏС‘]+)?$"
)

HOURS_RE = re.compile(
    r"^\s*(?:(?P<h>\d+)\s*С‡\.\s*)?(?:(?P<m>\d+)\s*РјРёРЅ\.\s*)?(?:(?P<s>\d+)\s*СЃ\.)?\s*$",
    re.IGNORECASE,
)


def clean(v):
    if v is None:
        return None
    if isinstance(v, str):
        s = v.strip()
        return s if s else None
    return v


def parse_hours(v) -> float:
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace("\xa0", " ")
    m = HOURS_RE.match(s)
    if m:
        h = int(m.group("h") or 0)
        mm = int(m.group("m") or 0)
        ss = int(m.group("s") or 0)
        return h + (mm / 60.0) + (ss / 3600.0)
    try:
        return float(s.replace(",", "."))
    except ValueError:
        return 0.0


def is_fio(text: str) -> bool:
    return bool(FIO_RE.match(text or ""))


def find_columns(rows):
    header_main_idx = None
    for i, row in enumerate(rows):
        if clean(row[0]) == "РЎРѕС‚СЂСѓРґРЅРёРє":
            header_main_idx = i
            break

    if header_main_idx is None:
        raise RuntimeError("Header row with 'РЎРѕС‚СЂСѓРґРЅРёРє' not found")

    header_main = rows[header_main_idx]
    header_kinds = rows[header_main_idx + 2] if header_main_idx + 2 < len(rows) else []

    total_start = None
    for j, v in enumerate(header_main):
        cv = clean(v)
        if isinstance(cv, str) and "РС‚РѕРіРѕ" in cv:
            total_start = j
            break
    if total_start is None:
        total_start = max(0, len(header_main) - 2)

    fact_col = None
    plan_col = None
    for j in range(total_start, len(header_kinds)):
        cv = clean(header_kinds[j])
        if cv == "Р¤Р°РєС‚" and fact_col is None:
            fact_col = j
        elif cv == "РџР»Р°РЅ" and plan_col is None:
            plan_col = j

    if fact_col is None:
        fact_col = total_start
    if plan_col is None:
        plan_col = min(total_start + 1, max(0, len(header_main) - 1))

    return header_main_idx + 3, fact_col, plan_col


def build():
    if not SRC_XLSX.exists():
        raise FileNotFoundError(f"Source report not found: {SRC_XLSX}")

    wb = openpyxl.load_workbook(SRC_XLSX, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    rows = list(ws.iter_rows(values_only=True))

    data_start, fact_col, plan_col = find_columns(rows)

    agg = {}
    for row in rows[data_start:]:
        if not row:
            continue
        fio = clean(row[0]) if len(row) > 0 else None
        if not isinstance(fio, str) or not is_fio(fio):
            continue

        fact_h = parse_hours(row[fact_col] if fact_col < len(row) else None)
        plan_h = parse_hours(row[plan_col] if plan_col < len(row) else None)

        cur = agg.get(fio)
        if cur is None:
            agg[fio] = {"employee": fio, "fact_h": fact_h, "plan_h": plan_h}
        else:
            cur["fact_h"] += fact_h
            cur["plan_h"] += plan_h

    wb.close()

    rows_out = []
    for v in agg.values():
        plan_h = v["plan_h"]
        util = (v["fact_h"] / plan_h * 100.0) if plan_h > 0 else None
        rows_out.append(
            {
                "employee": v["employee"],
                "fact_h": round(v["fact_h"], 2),
                "plan_h": round(v["plan_h"], 2),
                "utilization_pct": round(util, 2) if util is not None else None,
            }
        )

    rows_out.sort(key=lambda x: x["fact_h"], reverse=True)
    top = rows_out[:10]

    payload = {
        "meta": {
            "source": SRC_XLSX.name,
            "sheet": ws.title,
            "purpose": "Personnel utilization dataset for dashboard assistant",
            "employees_count": len(rows_out),
        },
        "table": {
            "title": "Ремонтные работы сотрудников за год (итого)",
            "columns": [
                {"key": "employee", "label": "РЎРѕС‚СЂСѓРґРЅРёРє"},
                {"key": "fact_h", "label": "Р¤Р°РєС‚, С‡"},
                {"key": "plan_h", "label": "РџР»Р°РЅ, С‡"},
                {"key": "utilization_pct", "label": "Р’С‹РїРѕР»РЅРµРЅРёРµ, %"},
            ],
            "rows": rows_out,
        },
        "chart": {
            "type": "chart",
            "title": "Топ-10 сотрудников по выполненным ремонтным работам (факт, ч)",
            "chartType": "bar",
            "categories": [x["employee"] for x in top],
            "series": [
                {"name": "Р¤Р°РєС‚, С‡", "data": [x["fact_h"] for x in top]},
                {"name": "РџР»Р°РЅ, С‡", "data": [x["plan_h"] for x in top]},
            ],
        },
    }

    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    with OUT_CSV.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f, delimiter=";")
        writer.writerow(["РЎРѕС‚СЂСѓРґРЅРёРє", "Р¤Р°РєС‚, С‡", "РџР»Р°РЅ, С‡", "Р’С‹РїРѕР»РЅРµРЅРёРµ, %"])
        for row in rows_out:
            writer.writerow(
                [
                    row["employee"],
                    row["fact_h"],
                    row["plan_h"],
                    row["utilization_pct"] if row["utilization_pct"] is not None else "",
                ]
            )
    print(f"Saved: {OUT_JSON}")
    print(f"Saved: {OUT_CSV}")
    print(f"Employees parsed: {len(rows_out)}")


if __name__ == "__main__":
    build()
