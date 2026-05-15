# -*- coding: utf-8 -*-
"""
Анализ ТОиР-данных из девяти обязательных отчётов Excel: семь отчётов по ТОиР
и два отчёта по персоналу («Использование персонала», «Анализ использования
персонала» / организационный срез — см. personnel_reports).

Извлекает: затраты по объектам, причины отказов, КТГ, простои, загрузку персонала.
Без обоих файлов персонала сборка завершается с ошибкой.

Формирует data/toir.json.
"""
from __future__ import annotations
import json, re, sys, zipfile
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import openpyxl

import personnel_reports

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
OUT = DATA_DIR / "toir.json"
REPORT_SHEETS = [
    "Анализ отказов",
    "КТГ",
    "Наработка на отказ",
    "Простой",
    "Процент износа",
    "Список оборудования",
    "Фактические затраты по ОР",
]
WEAR_REPORT_FILE = DATA_DIR / "Процент износа.xlsx"
WEAR_IMAGE_DIR = Path(__file__).resolve().parent.parent / "assets" / "generated"

MONTHS_ORDER = [
    "Январь 2025", "Февраль 2025", "Март 2025", "Апрель 2025",
    "Май 2025", "Июнь 2025", "Июль 2025", "Август 2025",
    "Сентябрь 2025", "Октябрь 2025", "Ноябрь 2025", "Декабрь 2025",
]

RU_MONTH_NAMES = [
    "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
]


def excel_month_label(dt: datetime) -> str:
    return f"{RU_MONTH_NAMES[dt.month - 1]} {dt.year}"

def cell(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return v
    s = str(v).strip()
    return s if s else None

def parse_hours(s):
    if s is None:
        return 0.0
    s = str(s).strip().replace("\xa0", " ")
    m = re.match(r"([\d\s]+)\s*ч", s)
    if m:
        return float(m.group(1).replace(" ", ""))
    try:
        return float(s)
    except (ValueError, TypeError):
        return 0.0

def parse_number(s):
    if s is None:
        return 0.0
    if isinstance(s, (int, float)):
        return float(s)
    s = str(s).strip().replace("\xa0", "").replace(" ", "").replace(",", ".")
    try:
        return float(s)
    except (ValueError, TypeError):
        return 0.0

def all_rows(ws):
    return list(ws.iter_rows(values_only=True))


# ── Лист "Фактические затраты по ОР" ──
def parse_costs_sheet(wb):
    ws = wb["Фактические затраты по ОР"]
    rows = all_rows(ws)

    header_row_idx = None
    month_cols = {}
    for i, r in enumerate(rows):
        vals = [cell(v) for v in r]
        if vals and vals[0] and "Подразделение" in str(vals[0]):
            header_row_idx = i
            for j, v in enumerate(vals):
                if v and any(m in str(v) for m in MONTHS_ORDER):
                    month_cols[str(v)] = j
            break

    if header_row_idx is None:
        return {}, {}

    sub_row = rows[header_row_idx + 1]
    sum_cols = {}
    for month, start_j in month_cols.items():
        for j in range(start_j, min(start_j + 3, len(sub_row))):
            v = cell(sub_row[j])
            if v and "Сумма" in str(v):
                sum_cols[month] = j
                break

    data_start = header_row_idx + 5
    equip_costs = defaultdict(lambda: defaultdict(float))
    monthly_totals = defaultdict(float)
    current_equip = None

    orgs = set()
    known_orgs_prefixes = ["ООО", "АО", "ЗАО", "ПАО", "ИП"]

    for i in range(data_start, len(rows)):
        r = rows[i]
        first = cell(r[0])
        if first is None:
            continue

        is_org = any(str(first).startswith(p) for p in known_orgs_prefixes)
        if is_org:
            orgs.add(first)
            continue

        is_sub_detail = False
        if first in ("Трудозатраты", "Материальные затраты", "Затраты на запчасти",
                      "Подрядные работы"):
            is_sub_detail = True
        if cell(r[4]) is not None:
            is_sub_detail = True

        if not is_sub_detail:
            has_cost = False
            for month, j in sum_cols.items():
                if j < len(r):
                    val = parse_number(r[j])
                    if val > 0:
                        has_cost = True
            if has_cost or (first and not first.startswith("Ремонт")):
                current_equip = first

        if current_equip and not is_sub_detail:
            for month, j in sum_cols.items():
                if j < len(r):
                    val = parse_number(r[j])
                    if val > 0:
                        equip_costs[current_equip][month] += val
                        monthly_totals[month] += val

    return dict(equip_costs), dict(monthly_totals)


def is_small_int_defect_count(v) -> bool:
    """Кол-во дефектов в шапке объекта (целое, не наработка вроде 68988.88)."""
    if v is None:
        return False
    try:
        x = float(str(v).replace("\xa0", "").replace(",", ".").strip())
        if x != int(x):
            return False
        xi = int(x)
        return 0 < xi < 500
    except (ValueError, TypeError):
        return False


# ── Лист "Наработка на отказ": MTBF (среднее время работы), MTTR по датам ──
def parse_mtbf_mttr(wb):
    ws = wb["Наработка на отказ"]
    rows = all_rows(ws)
    mtbf: dict[str, float] = {}
    mttr_lists: dict[str, list[float]] = defaultdict(list)
    current_equip = None

    for r in rows:
        if len(r) < 12:
            continue
        first = cell(r[0])
        if first is None:
            continue
        if str(first).startswith("Параметры"):
            continue

        if is_small_int_defect_count(r[10]) and r[11] is not None:
            hdr = parse_hours(r[11])
            if hdr > 0:
                mtbf[first] = round(hdr, 1)
                current_equip = first
                continue

        if current_equip and len(r) > 6:
            d0 = r[3] if isinstance(r[3], datetime) else _parse_excel_datetime(r[3])
            d1 = r[6] if isinstance(r[6], datetime) else _parse_excel_datetime(r[6])
            if isinstance(d0, datetime) and isinstance(d1, datetime) and d1 > d0:
                h = (d1 - d0).total_seconds() / 3600.0
                if 0 < h <= 720:
                    mttr_lists[current_equip].append(h)

    mttr = {k: round(sum(v) / len(v), 1) for k, v in mttr_lists.items() if v}
    return mtbf, mttr


def parse_repair_events(wb):
    """Строки ремонта с датами начала/окончания (для гипотез R7/R8/R11/R17)."""
    ws = wb["Наработка на отказ"]
    rows = all_rows(ws)
    events = []
    current_equip = None

    for r in rows:
        if len(r) < 12:
            continue
        first = cell(r[0])
        if first is None:
            continue
        if str(first).startswith("Параметры"):
            continue

        if is_small_int_defect_count(r[10]) and r[11] is not None:
            hdr = parse_hours(r[11])
            if hdr > 0:
                current_equip = first
                continue

        if current_equip and len(r) > 6:
            d0 = r[3] if isinstance(r[3], datetime) else _parse_excel_datetime(r[3])
            d1 = r[6] if isinstance(r[6], datetime) else _parse_excel_datetime(r[6])
            if isinstance(d0, datetime) and isinstance(d1, datetime) and d1 > d0:
                h = (d1 - d0).total_seconds() / 3600.0
                if 0 < h <= 720:
                    events.append({
                        "equipment": current_equip,
                        "start": d0.isoformat(sep="T", timespec="seconds"),
                        "end": d1.isoformat(sep="T", timespec="seconds"),
                        "duration_h": round(h, 2),
                        "month": excel_month_label(d0),
                    })
    return events


def _parse_excel_datetime(val):
    if isinstance(val, datetime):
        return val
    if val is None:
        return None
    s = str(val).strip()
    if not s:
        return None
    for fmt in ("%d.%m.%Y %H:%M:%S", "%d.%m.%Y %H:%M", "%d.%m.%Y"):
        try:
            return datetime.strptime(s[:19], fmt)
        except ValueError:
            continue
    return None


# ── Материальные / трудовые по месяцам (лист «Анализ отказов», руб.) ──
def parse_material_labor_monthly(wb):
    ws = wb["Анализ отказов"]
    rows = all_rows(ws)

    header_idx = None
    month_starts = {}
    for i, r in enumerate(rows):
        vals = [cell(v) for v in r]
        if vals and vals[0] and "Организация" in str(vals[0]):
            header_idx = i
            for j, v in enumerate(vals):
                if v and any(m in str(v) for m in MONTHS_ORDER):
                    month_starts[str(v)] = j
            break

    if header_idx is None:
        return []

    sub = rows[header_idx + 1]
    # Подстрочник: на каждый месяц блок из 7 колонок (кол-во, пусто, длительность, пусто, мат, труд, всего)
    mat_lab_j = {}
    for m, j_head in month_starts.items():
        mat_j = j_head + 4
        lab_j = j_head + 5
        if lab_j < len(sub):
            mat_lab_j[m] = (mat_j, lab_j)

    if not mat_lab_j:
        return [{"month": m, "material": 0.0, "labor": 0.0} for m in MONTHS_ORDER]

    mat = defaultdict(float)
    lab = defaultdict(float)
    data_start = header_idx + 4

    for i in range(data_start, len(rows)):
        r = rows[i]
        first = cell(r[0])
        if first is None:
            continue
        if any(str(first).startswith(p) for p in ["ООО", "АО", "ЗАО", "ПАО"]):
            continue
        for m, (mj, lj) in mat_lab_j.items():
            if mj < len(r):
                mat[m] += parse_hours(r[mj])
            if lj < len(r):
                lab[m] += parse_hours(r[lj])

    # Часы по полям «материальные / трудовые затраты» в смысле длительности работ (лист «Анализ отказов»)
    return [{"month": m, "material_h": mat.get(m, 0.0), "labor_h": lab.get(m, 0.0)} for m in MONTHS_ORDER]


# ── Лист "Наработка на отказ" ──
def parse_failures(wb):
    ws = wb["Наработка на отказ"]
    rows = all_rows(ws)

    causes = defaultdict(int)
    equip_defects = {}
    current_equip = None

    for i, r in enumerate(rows):
        first = cell(r[0])
        if first is None:
            continue

        if i >= 9:
            defect_count = cell(r[10]) if len(r) > 10 else None
            if defect_count is not None:
                try:
                    cnt = int(str(defect_count).replace("\xa0", "").strip())
                    current_equip = first
                    equip_defects[current_equip] = cnt
                    continue
                except (ValueError, TypeError):
                    pass

            if current_equip:
                known_causes = [
                    "Обрыв ремня", "Утечка масла", "Перегрев подшипников",
                    "Механический износ", "Отказ гидросистемы", "Поломка редуктора",
                    "Коррозия", "Замыкание обмотки", "Трещина корпуса",
                    "Загрязнение фильтра", "Износ уплотнений", "Дефект сварного шва",
                    "Засорение трубопровода", "Отказ датчика", "Разрушение подшипника",
                    "Перегрев двигателя", "Ослабление крепежа", "Отказ электроники",
                ]
                if first in known_causes or (
                    not any(first.startswith(p) for p in ["Станок", "Кран", "Экскаватор",
                    "Компрессор", "Насос", "Автосамосвал", "Тягач", "Погрузчик",
                    "Генератор", "Вентилятор", "Гидропресс", "Мельница", "Бульдозер",
                    "Электродвигатель", "Сварочный", "Котёл", "Дробилка", "Таль",
                    "Холодильная", "Протяжной", "Плоскошлифовальный", "Долбёжный",
                    "Фуговальный", "Продольно"]) and
                    len(first) < 40 and not first.startswith("Параметры")
                ):
                    causes[first] += 1

    return dict(causes), equip_defects


# ── Лист "Анализ отказов" ──
def parse_analysis(wb):
    ws = wb["Анализ отказов"]
    rows = all_rows(ws)

    header_idx = None
    month_blocks = {}

    for i, r in enumerate(rows):
        vals = [cell(v) for v in r]
        if vals and vals[0] and "Организация" in str(vals[0]):
            header_idx = i
            for j, v in enumerate(vals):
                if v and any(m in str(v) for m in MONTHS_ORDER):
                    month_blocks[str(v)] = j
            break

    if header_idx is None:
        return {}

    sub = rows[header_idx + 1]
    total_cost_cols = {}
    for month, start_j in month_blocks.items():
        for j in range(start_j, min(start_j + 6, len(sub))):
            v = cell(sub[j])
            if v and "Общие затраты" in str(v):
                total_cost_cols[month] = j
                break

    equip_monthly_costs = defaultdict(lambda: defaultdict(float))
    current_equip = None
    data_start = header_idx + 4

    for i in range(data_start, len(rows)):
        r = rows[i]
        first = cell(r[0])
        if first is None:
            continue

        is_org = any(str(first).startswith(p) for p in ["ООО", "АО", "ЗАО", "ПАО"])
        if is_org:
            continue

        has_total = False
        for month, j in total_cost_cols.items():
            if j < len(r):
                val = parse_hours(r[j])
                if val > 0:
                    has_total = True

        if has_total:
            current_equip = first
            for month, j in total_cost_cols.items():
                if j < len(r):
                    val = parse_hours(r[j])
                    if val > 0:
                        equip_monthly_costs[current_equip][month] += val

    return dict(equip_monthly_costs)


# ── Лист "КТГ" ──
def parse_ktg(wb):
    ws = wb["КТГ"]
    rows = all_rows(ws)

    header_idx = None
    month_blocks = {}
    for i, r in enumerate(rows):
        vals = [cell(v) for v in r]
        if vals and vals[0] and "Организация" in str(vals[0]):
            header_idx = i
            for j, v in enumerate(vals):
                if v and any(m in str(v) for m in MONTHS_ORDER):
                    month_blocks[str(v)] = j
            break

    if header_idx is None:
        return {}

    sub = rows[header_idx + 1]
    ktg_cols = {}
    downtime_cols = {}
    for month, start_j in month_blocks.items():
        for j in range(start_j, min(start_j + 6, len(sub))):
            v = cell(sub[j])
            if v and "КТГ" in str(v):
                ktg_cols[month] = j
            if v and "Простой" in str(v):
                downtime_cols[month] = j

    equip_ktg = {}
    data_start = header_idx + 3

    for i in range(data_start, len(rows)):
        r = rows[i]
        first = cell(r[0])
        if first is None:
            continue
        if any(str(first).startswith(p) for p in ["ООО", "АО", "ЗАО", "ПАО"]):
            continue
        if any(str(first).endswith(w) for w in ["цех", "участок"]):
            continue

        monthly_ktg = {}
        monthly_downtime = {}
        has_ktg = False
        for month, j in ktg_cols.items():
            if j < len(r):
                v = parse_number(r[j])
                if v > 0:
                    monthly_ktg[month] = v
                    has_ktg = True
        for month, j in downtime_cols.items():
            if j < len(r):
                v = parse_hours(r[j])
                if v > 0:
                    monthly_downtime[month] = v

        if has_ktg:
            avg_ktg = sum(monthly_ktg.values()) / len(monthly_ktg)
            total_downtime = sum(monthly_downtime.values())
            equip_ktg[first] = {
                "avg_ktg": round(avg_ktg, 1),
                "total_downtime_h": total_downtime,
                "monthly_ktg": monthly_ktg,
            }

    return equip_ktg


def parse_usage_percentage_value(v):
    """Число из ячейки «Процент использования» (54.37 или «54,37 %»)."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        x = float(v)
        if x != x or x < 0:
            return None
        return x
    s = str(v).strip().replace("\xa0", "").replace("%", "").replace(" ", "").replace(",", ".")
    if not s:
        return None
    try:
        x = float(s)
    except ValueError:
        return None
    if x < 0:
        return None
    return x


def parse_equipment_list_usage_pct(wb) -> dict[str, float]:
    """
    Столбец «Процент использования» на первом листе «Список оборудования».
    Ключ — наименование объекта (первый столбец строки данных).
    """
    ws = wb[wb.sheetnames[0]]
    rows = all_rows(ws)
    pct_col = None
    header_row = None
    for i, row in enumerate(rows[:80]):
        if not row:
            continue
        for j, val in enumerate(row):
            c = cell(val)
            if isinstance(c, str):
                low = c.lower().replace("ё", "е")
                if "процент" in low and "использован" in low:
                    pct_col = j
                    header_row = i
                    break
        if pct_col is not None:
            break
    if pct_col is None or header_row is None:
        return {}

    out: dict[str, float] = {}
    for row in rows[header_row + 1 :]:
        if not row or pct_col >= len(row):
            continue
        nm = cell(row[0])
        if not nm or not isinstance(nm, str):
            continue
        name = nm.strip()
        if len(name) < 2:
            continue
        pct = parse_usage_percentage_value(row[pct_col])
        if pct is None:
            continue
        out[name] = round(pct, 4)
    return out


def _header_text_is_class_column(s: str) -> bool:
    """Заголовок столбца класса/группы/вида оборудования (не «% использования»)."""
    low = s.lower().replace("ё", "е")
    if "процент" in low and "использован" in low:
        return False
    if "класс" in low:
        return True
    if "группа" in low and "оборуд" in low:
        return True
    if "вид" in low and "оборуд" in low:
        return True
    if "тип" in low and "оборуд" in low:
        return True
    return False


def parse_equipment_list_classes(wb) -> dict[str, str]:
    """
    Столбец класса (или группы/вида) на первом листе «Список оборудования».
    Ключ — наименование; значение — строка из отчёта.
    """
    ws = wb[wb.sheetnames[0]]
    rows = all_rows(ws)
    class_col = None
    header_row_idx = None
    for i, row in enumerate(rows[:80]):
        if not row:
            continue
        for j, val in enumerate(row):
            c = cell(val)
            if isinstance(c, str) and _header_text_is_class_column(c):
                class_col = j
                header_row_idx = i
                break
        if class_col is not None:
            break
    if class_col is None or header_row_idx is None:
        return {}

    name_col = 0
    hdr = rows[header_row_idx]
    for j, val in enumerate(hdr):
        vv = cell(val)
        if not isinstance(vv, str):
            continue
        low = vv.lower().replace("ё", "е")
        if "наименован" in low or low.strip() in ("оборудование", "название", "объект", "единица оборудования"):
            name_col = j
            break

    out: dict[str, str] = {}
    for row in rows[header_row_idx + 1 :]:
        if not row:
            continue
        if name_col >= len(row) or class_col >= len(row):
            continue
        nm = cell(row[name_col])
        cl = cell(row[class_col])
        if not nm or not isinstance(nm, str):
            continue
        name = nm.strip()
        if len(name) < 2:
            continue
        if cl is None:
            continue
        if isinstance(cl, str):
            class_str = cl.strip()
        else:
            class_str = str(cl).strip()
        if not class_str:
            continue
        out[name] = class_str
    return out


def extract_wear_report_image() -> str | None:
    """
    Извлекает первую картинку из отчета «Процент износа.xlsx» и сохраняет в assets/generated.
    Возвращает относительный путь для фронта или None.
    """
    if not WEAR_REPORT_FILE.exists():
        return None
    try:
        with zipfile.ZipFile(WEAR_REPORT_FILE, "r") as zf:
            media = [n for n in zf.namelist() if n.startswith("xl/media/")]
            if not media:
                return None
            first = media[0]
            ext = Path(first).suffix.lower() or ".png"
            WEAR_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
            out = WEAR_IMAGE_DIR / f"wear-report{ext}"
            with zf.open(first) as src, out.open("wb") as dst:
                dst.write(src.read())
            return out.relative_to(Path(__file__).resolve().parent.parent).as_posix()
    except Exception:
        return None


def load_source_workbooks():
    """
    Возвращает (sources, source_label).
    - sources: dict[str, Workbook], где ключ = имя листа/отчета
    - source_label: строка для meta.source
    Ожидаются 7 отдельных файлов отчётов ТОиР (персонал подключается отдельно в main()).
    """
    split_paths = {s: DATA_DIR / f"{s}.xlsx" for s in REPORT_SHEETS}
    sources = {}
    missing = [str(p.name) for p in split_paths.values() if not p.exists()]
    if missing:
        raise FileNotFoundError(f"Не найдены обязательные отчеты: {', '.join(missing)}")
    for sheet, p in split_paths.items():
        sources[sheet] = openpyxl.load_workbook(str(p), read_only=True, data_only=True)
    src = "7 файлов отчётов ТОиР (*.xlsx) + обязательные отчёты по персоналу в data/"
    return sources, src


# ── MAIN ──
def main():
    sources, source_label = load_source_workbooks()

    wb_costs = sources["Фактические затраты по ОР"]
    wb_fail = sources["Наработка на отказ"]
    wb_analysis = sources["Анализ отказов"]
    wb_ktg = sources["КТГ"]

    equip_costs, monthly_totals = parse_costs_sheet(wb_costs)
    failure_causes, equip_defects = parse_failures(wb_fail)
    analysis_costs = parse_analysis(wb_analysis)
    ktg_data = parse_ktg(wb_ktg)
    mtbf_h, mttr_h = parse_mtbf_mttr(wb_fail)
    repair_events = parse_repair_events(wb_fail)
    material_labor = parse_material_labor_monthly(wb_analysis)
    wear_image = extract_wear_report_image()
    equipment_usage_pct = parse_equipment_list_usage_pct(sources["Список оборудования"])
    equipment_class_by_name = parse_equipment_list_classes(sources["Список оборудования"])

    for wb in sources.values():
        wb.close()

    total_per_equip = {}
    for eq, months in equip_costs.items():
        total_per_equip[eq] = sum(months.values())
    for eq, months in analysis_costs.items():
        if eq not in total_per_equip:
            total_per_equip[eq] = sum(months.values())

    top_cost = sorted(total_per_equip.items(), key=lambda x: x[1], reverse=True)
    top_failures = sorted(failure_causes.items(), key=lambda x: x[1], reverse=True)

    sorted_monthly = sorted(monthly_totals.items(),
                            key=lambda x: MONTHS_ORDER.index(x[0]) if x[0] in MONTHS_ORDER else 99)
    peak_month = max(monthly_totals.items(), key=lambda x: x[1]) if monthly_totals else (None, 0)

    toir_json = {
        "meta": {
            "source": source_label,
            "period": "01.01.2025 - 31.12.2025",
            "organization": "ООО \"Альфа-Сервис\"",
            "generated": "auto",
        },
        "kpis": {
            "total_cost": sum(total_per_equip.values()),
            "total_defects": sum(equip_defects.values()),
            "equipment_count": len(total_per_equip),
        },
        "charts": {
            "costsByMonth": [
                {"month": m, "total": monthly_totals.get(m, 0)}
                for m in MONTHS_ORDER
            ],
            "failureCauses": [
                {"cause": c, "count": n} for c, n in top_failures
            ],
            "topCostEquipment": [
                {"equipment": eq, "total": cost} for eq, cost in top_cost[:15]
            ],
            "materialLaborByMonth": material_labor,
            "mtbfByEquipment": [
                {"equipment": eq, "mtbf_h": val}
                for eq, val in sorted(mtbf_h.items(), key=lambda x: -x[1])[:30]
            ],
            "mttrByEquipment": [
                {"equipment": eq, "mttr_h": val}
                for eq, val in sorted(mttr_h.items(), key=lambda x: -x[1])[:30]
            ],
            "wearImage": wear_image,
        },
        "tables": {
            "equipmentCosts": {
                eq: {"total": sum(m.values()), "months": dict(m)}
                for eq, m in equip_costs.items()
            },
            "ktg": ktg_data,
            "equipmentDefects": equip_defects,
            "repairEvents": repair_events,
            "equipmentUsagePct": equipment_usage_pct,
            "equipmentClassByName": equipment_class_by_name,
        },
        "analysis": {
            "top3_cost_leaders": [
                {"equipment": eq, "total_rub": cost} for eq, cost in top_cost[:3]
            ],
            "top3_failure_causes": [
                {"cause": c, "count": n} for c, n in top_failures[:3]
            ],
            "peak_cost_month": {
                "month": peak_month[0],
                "total_rub": peak_month[1],
            },
            "monthly_costs_sorted": sorted_monthly,
        },
    }

    pu = None
    po = None
    try:
        pu = personnel_reports.build_personnel_usage_payload(DATA_DIR)
    except Exception as ex:
        print(f"ОШИБКА: personnelUsage не собран: {ex}", file=sys.stderr)
        return 1
    try:
        po = personnel_reports.build_personnel_org_payload(DATA_DIR)
    except Exception as ex:
        print(f"ОШИБКА: personnelOrgUsage не собран: {ex}", file=sys.stderr)
        return 1

    if pu is None:
        print(
            "ОШИБКА: нет обязательного отчёта по персоналу в data/. "
            "Добавьте «Использование персонала.xlsx» или файл .xlsx, в имени которого есть «использован» и «персонал».",
            file=sys.stderr,
        )
        return 1
    if po is None:
        print(
            "ОШИБКА: нет обязательного отчёта «анализ использования персонала» в data/. "
            "Добавьте «Анализ использования персонала организация.xlsx», «Анализ использования персонала.xlsx» "
            "или другой подходящий файл (см. personnel_reports.find_org_personnel_analysis_xlsx).",
            file=sys.stderr,
        )
        return 1

    toir_json["personnelUsage"] = pu
    toir_json["personnelOrgUsage"] = po

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(toir_json, ensure_ascii=False, indent=2), encoding="utf-8")

    print("=== РЕЗУЛЬТАТЫ АНАЛИЗА ТОиР ===\n")
    print(f"Общие затраты за 2025: {toir_json['kpis']['total_cost']:,.0f} руб.")
    print(f"Всего единиц оборудования с затратами: {toir_json['kpis']['equipment_count']}")
    print(f"Всего дефектов (наработка на отказ): {toir_json['kpis']['total_defects']}\n")

    print("--- ТОП-3 ПО ЗАТРАТАМ ---")
    for item in toir_json["analysis"]["top3_cost_leaders"]:
        print(f"  {item['equipment']}: {item['total_rub']:,.0f} руб.")

    print("\n--- ТОП-3 ПРИЧИНЫ ОТКАЗОВ ---")
    for item in toir_json["analysis"]["top3_failure_causes"]:
        print(f"  {item['cause']}: {item['count']} случаев")

    print(f"\n--- ПИК ЗАТРАТ ---")
    pm = toir_json["analysis"]["peak_cost_month"]
    print(f"  {pm['month']}: {pm['total_rub']:,.0f} руб.")

    print("\n--- ЗАТРАТЫ ПО МЕСЯЦАМ ---")
    max_val = max(monthly_totals.values()) if monthly_totals else 1
    for m, v in sorted_monthly:
        bar = "#" * max(1, int(v / max_val * 30)) if v > 0 else ""
        print(f"  {m:20s} {v:>12,.0f} rub.  {bar}")

    print(f"\nSaved: {OUT}")
    print(f"Процент использования (Список оборудования): объектов с показателем — {len(equipment_usage_pct)}")
    if equipment_class_by_name:
        distinct = len(set(equipment_class_by_name.values()))
        print(
            f"Классы по «Список оборудования»: привязок наименование→класс — {len(equipment_class_by_name)}, "
            f"уникальных классов — {distinct}"
        )
    else:
        print("Классы по «Список оборудования»: столбец класса не найден — в JSON используется классификация по имени на фронте")
    print(f"Встроено personnelUsage: сотрудников {pu['meta'].get('employees_count')}, файл {pu['meta'].get('source')}")
    print(
        f"Встроено personnelOrgUsage: орг. {po['meta'].get('organizations_count')}, "
        f"подр. {po['meta'].get('departments_count')}, файл {po['meta'].get('source')}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
