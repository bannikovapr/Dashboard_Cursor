/**
 * Общая доменная логика дашборда: классы оборудования и порядок месяцев из данных (без дублирования эвристик по файлам).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ToirDomain = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** Если в выгрузке нет costsByMonth (тесты/пустой сырой объект). */
  const FALLBACK_MONTH_KEYS = [
    "Январь 2025", "Февраль 2025", "Март 2025", "Апрель 2025",
    "Май 2025", "Июнь 2025", "Июль 2025", "Август 2025",
    "Сентябрь 2025", "Октябрь 2025", "Ноябрь 2025", "Декабрь 2025",
  ];

  function classifyClass(name) {
    if (!name) return "Прочее";
    const s = String(name);
    if (/станок|токарн|фрезер|сверлил|шлиф|пресс|долб|заточ|расточ|протяж|электроэрозион|ленточнопиль|форматно|кромкооблицов|рейсмус|фуговальн|зубофрезерн|токарно-карусельн|продольно-фрезерн|листогибочн|гильотин/i.test(s))
      return "Станки и металлообработка";
    if (/насос/i.test(s)) return "Насосы";
    if (/компрессор/i.test(s)) return "Компрессоры";
    if (/кран|тельфер|\bталь\b/i.test(s)) return "Крановое оборудование";
    if (/погрузчик|экскаватор|самосвал|бульдозер|тягач/i.test(s)) return "Самоходная техника";
    if (/трансформатор|электродвигатель|генератор|вентилятор/i.test(s)) return "Электрооборудование";
    if (/робот|сварочн/i.test(s)) return "Сварка и роботы";
    if (/конвейер|грохот|дробилк|мельниц|центрифуг|котёл|холодильн|гидропресс/i.test(s)) return "Прочее промышленное";
    return "Прочее";
  }

  function equipmentClassFromRaw(raw, name) {
    if (!name) return "Прочее";
    const nm = String(name);
    if (nm === "Итого") return classifyClass(nm);
    const map = raw && raw.tables && raw.tables.equipmentClassByName;
    if (map && typeof map === "object" && Object.prototype.hasOwnProperty.call(map, nm)) {
      const v = map[nm];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return classifyClass(nm);
  }

  function orderedMonthLabelsFromRaw(raw) {
    const rows = (raw && raw.charts && raw.charts.costsByMonth) || [];
    const keys = rows.map((r) => r && r.month).filter(Boolean);
    return keys.length ? keys : FALLBACK_MONTH_KEYS.slice();
  }

  function monthSetForPeriod(period, orderedMonthLabels) {
    const all = orderedMonthLabels || [];
    if (!period || period === "all") return new Set(all);
    if (period === "h1") return new Set(all.slice(0, 6));
    if (period === "h2") return new Set(all.slice(6, 12));
    return new Set(all);
  }

  function yearFromMonthLabel(label) {
    const parts = String(label || "").trim().split(/\s+/);
    const last = parts[parts.length - 1];
    return /^\d{4}$/.test(last) ? last : null;
  }

  /** Подпись пресета периода для чипов шапки и фильтров (год из фактических меток месяцев). */
  function periodPresetLabel(period, orderedMonthLabels) {
    const labels = orderedMonthLabels || [];
    const n = labels.length;
    if (!period || period === "all") {
      return n ? `Последние ${n} мес.` : "Весь период";
    }
    if (period === "h1") {
      const y = yearFromMonthLabel(labels[0]) || yearFromMonthLabel(labels[5]);
      return y ? `1-е полугодие ${y}` : "1-е полугодие";
    }
    if (period === "h2") {
      const y = yearFromMonthLabel(labels[6]) || yearFromMonthLabel(labels[labels.length - 1]);
      return y ? `2-е полугодие ${y}` : "2-е полугодие";
}

    return n ? `Последние ${n} мес.` : "Весь период";
  }

  /** Короткая подпись для сводок отчёта (другое wording, чем UI «последние N мес.»). */
  function periodReportLabel(period, orderedMonthLabels) {
    const labels = orderedMonthLabels || [];
    const n = labels.length;
    if (!period || period === "all") {
      return n ? `${n} мес.` : "Период не задан";
    }
    if (period === "h1") {
      const y = yearFromMonthLabel(labels[0]) || yearFromMonthLabel(labels[5]);
      return y ? `1-е полугодие ${y}` : "1-е полугодие";
    }
    if (period === "h2") {
      const y = yearFromMonthLabel(labels[6]) || yearFromMonthLabel(labels[labels.length - 1]);
      return y ? `2-е полугодие ${y}` : "2-е полугодие";
    }
    return n ? `${n} мес.` : "Период не задан";
  }

  return {
    classifyClass,
    equipmentClassFromRaw,
    orderedMonthLabelsFromRaw,
    monthSetForPeriod,
    periodPresetLabel,
    periodReportLabel,
    yearFromMonthLabel,
    FALLBACK_MONTH_KEYS,
  };
});
