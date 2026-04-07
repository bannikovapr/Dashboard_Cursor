# -*- coding: utf-8 -*-
"""
Инвентаризация Cursor_test2.xlsx: листы, строка заголовков, колонки, образцы строк.

Выход: data/cursor_test2_excel_inventory.json (UTF-8).
Путь к книге по умолчанию — родительская папка проекта: ../03_Отчёты_ТОИР/Cursor_test2.xlsx
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import openpyxl


DEFAULT_REL = Path("../03_Отчёты_ТОИР/Cursor_test2.xlsx")
OUT_REL = Path("data/cursor_test2_excel_inventory.json")
MAX_SCAN_ROWS = 80
HEADER_SAMPLE_ROWS = 3


def cell_str(v) -> str | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return v
    s = str(v).strip()
    return s if s else None


def score_header_row(values: tuple) -> float:
    """Heuristic: many short-ish non-empty strings, few merged-title sentences."""
    texts = [cell_str(v) for v in values]
    non_empty = [t for t in texts if t is not None and isinstance(t, str)]
    if len(non_empty) < 3:
        return 0.0
    long_lines = sum(1 for t in non_empty if len(t) > 48 or t.count(" ") > 6)
    if long_lines > len(non_empty) // 2:
        return 0.0
    return float(len(non_empty))


def norm_sample_cell(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return v
    return str(v).strip()


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    xlsx = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else (root / DEFAULT_REL).resolve()
    if not xlsx.exists():
        print(f"File not found: {xlsx}", file=sys.stderr)
        return 1

    wb = openpyxl.load_workbook(xlsx, read_only=True, data_only=True)
    out: dict = {
        "source_file": str(xlsx),
        "sheets": [],
    }

    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        rows: list[tuple] = []
        it = ws.iter_rows(values_only=True)
        for _ in range(MAX_SCAN_ROWS):
            try:
                rows.append(next(it))
            except StopIteration:
                break

        best_i = 0
        best_score = 0.0
        for i, r in enumerate(rows):
            s = score_header_row(r)
            if s > best_score:
                best_score = s
                best_i = i

        header_row = rows[best_i] if rows else tuple()
        headers = []
        for v in header_row:
            c = cell_str(v)
            headers.append("" if c is None else (str(c) if not isinstance(c, str) else c))

        # Trim trailing empty header names for readability
        while headers and headers[-1] == "":
            headers.pop()

        distinct_columns: list[str] = []
        for h in headers:
            if h and h not in distinct_columns:
                distinct_columns.append(h)

        data_start = best_i + 1
        samples = []
        for j in range(data_start, min(data_start + HEADER_SAMPLE_ROWS, len(rows))):
            samples.append([norm_sample_cell(v) for v in rows[j][: len(headers) + 5]])

        # Preview of first 6 rows (raw) for layout debugging
        preview = []
        for j in range(min(6, len(rows))):
            preview.append([norm_sample_cell(cell) for cell in rows[j][:25]])

        out["sheets"].append(
            {
                "sheet": sheet_name,
                "header_row_index_1based": best_i + 1,
                "header_non_empty_count": int(best_score),
                "columns": headers,
                "distinct_column_labels": distinct_columns,
                "sample_data_rows": samples,
                "preview_first_rows_first_25_cols": preview,
            }
        )

    wb.close()

    out_path = root / OUT_REL
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(str(out_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
