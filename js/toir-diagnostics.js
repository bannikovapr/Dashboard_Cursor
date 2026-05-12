(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ToirDiagnostics = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const STATUS = {
    TRIGGERED: "triggered",
    NOT_TRIGGERED: "not_triggered",
    INSUFFICIENT: "insufficient_data",
  };

  /** Уверенность вывода гипотезы при наличии данных (не путать с уверенностью секций отчёта). */
  const CONFIDENCE = {
    HIGH: "high",
    MEDIUM: "medium",
    LOW: "low",
  };

  const MONTHS_ORDER_2025 = [
    "Январь 2025", "Февраль 2025", "Март 2025", "Апрель 2025",
    "Май 2025", "Июнь 2025", "Июль 2025", "Август 2025",
    "Сентябрь 2025", "Октябрь 2025", "Ноябрь 2025", "Декабрь 2025",
  ];

  const THRESHOLDS = {
    PARETO_SHARE: 0.25,
    DISPROPORTION_FACTOR: 1.7,
    PEAK_SHARE: 0.30,
    PEAK_VS_MEDIAN: 2.5,
    ROOT_CAUSE_TOP2: 0.50,
    UNIQUE_CAUSE_SHARE: 0.40,
    VAGUE_CAUSE_SHARE: 0.15,
    KTG_TARGET: 90,
    KTG_LOW_SHARE: 0.40,
    MTBF_LOW_FACTOR: 0.5,
    MTTR_QUANTILE: 0.9,
    MATERIAL_LABOR_PEAK_FACTOR: 2.0,
    R10_CORR_THRESHOLD: 0.15,
    R18_OVERLAP_MAX: 2,
    R18_CORR_MAX: 0.30,
  };

  const VAGUE_PATTERNS = [
    "проч", "друг", "не указ", "не выяв", "не определ", "не уст", "неизв",
  ];

  /**
   * Развёрнутые пояснения (логика expert-main): входы, расчёт, пороги срабатывания.
   * Показываются в UI под раскрывающимся «Развёрнуто».
   */
  const DIAG_EXPANDED_EXPLAIN = {
    R1: [
      "Берутся объекты с ненулевым простоем в срезе (период, класс), строится кривая Парето по часам простоя.",
      "Считается, какая доля объектов покрывает 80% суммарного простоя (правило «верхушки»).",
      `Гипотеза считается подтверждённой, если на эти 80% приходится не более ${(THRESHOLDS.PARETO_SHARE * 100).toFixed(0)}% объектов с простоями — простой сильно сконцентрирован.`,
      "Минимум для расчёта — 3 объекта с простоями.",
    ],
    R2: [
      "Аналогично R1, но вместо простоев — затраты ТОиР по объектам в выбранном срезе.",
      "Оценивается доля объектов, которые формируют 80% суммарных затрат.",
      `Подтверждение — если таких объектов не больше ${(THRESHOLDS.PARETO_SHARE * 100).toFixed(0)}% от числа объектов с затратами.`,
    ],
    R3: [
      "По каждому классу оборудования суммируются затраты и число отказов; считаются доли в общих затратах и общем числе отказов.",
      "Для каждого класса вычисляется коэффициент диспропорции: доля затрат / доля отказов.",
      `Гипотеза срабатывает для класса-лидера, если коэффициент ≥ ${THRESHOLDS.DISPROPORTION_FACTOR.toFixed(1)} и доля затрат класса ≥ 25%. Недоступно при фильтре одного класса.`,
    ],
    R4: [
      "По данным СВВ (MTTR) объекты группируются в классы; для класса берётся медианное СВВ (минимум 2 объекта в классе).",
      "Сравнивается класс с максимальной медианой и общая медиана СВВ по всем объектам в срезе.",
      "Срабатывание: медиана класса ≥ 1,5× от общей медианы и отрыв не менее 4 ч.",
    ],
    R5: [
      "По помесячным затратам находятся медиана и самый «тяжёлый» месяц.",
      `Гипотеза срабатывает, если пик даёт ≥ ${(THRESHOLDS.PEAK_SHARE * 100).toFixed(0)}% суммарных затрат текущего среза или превышает медиану в ${THRESHOLDS.PEAK_VS_MEDIAN.toFixed(1)}× и более.`,
      "Нужно минимум 4 месяца с данными.",
    ],
    R6: [
      "Правило сравнивает подразделения по ущербу от отказа на одно событие.",
      "В текущей агрегированной выгрузке нет атрибута «подразделение» у инцидентов — автоматическая проверка выключена до появления поля в источнике.",
    ],
    R7: [
      "Используется таблица ремонтов с датами начала (repairEvents) в срезе. Для каждого объекта сортируются даты ремонтов, считаются интервалы между соседними стартами.",
      "Выделяются пары с интервалом 30–60 суток (окно «раннего повтора»).",
      "Срабатывание: не менее 2 таких пар и их доля среди всех пар с интервалом до ~400 суток ≥ 20%. Нужна достаточная история (порядка ≥8 записей ремонта в срезе).",
    ],
    R8: [
      "По repairEvents для каждого объекта первый ремонт в срезе сравнивается по длительности с последующими (повторными).",
      "Считаются медианы длительности «первичных» и «повторных» ремонтов (только ненулевая длительность).",
      "Срабатывание: медиана повторных ≥ 1,18× медианы первичных и отрыв не менее 1 ч.",
    ],
    R9: [
      "Правило оценивает разброс скорости ремонта между дисциплинами/службами.",
      "В выгрузке нет атрибута «дисциплина» или «служба» у работ — проверка помечена как неподдерживаемая до расширения источника.",
    ],
    R10: [
      "Для объектов с ненулевыми затратами и СВВ считается ранговая корреляция Спирмена между затратами и длительностью ремонта.",
      `Проверка рассчитана на совместное поведение «дорого → быстрее чинят». Если корреляция ≤ ${THRESHOLDS.R10_CORR_THRESHOLD.toFixed(2)}, приоритизация по критичности слабо отражена в скорости.`,
      "Минимум 5 пар «затраты — СВВ».",
    ],
    R11: [
      "По всем записям repairEvents с ненулевой длительностью считается доля ремонтов короче 2 ч.",
      "Большая доля очень коротких ремонтов может указывать на заниженную регистрацию отказов или смешение типов событий.",
      `Порог срабатывания — не менее ${(0.18 * 100).toFixed(0)}% таких случаев от всех записей с длительностью.`,
    ],
    R12: [
      "Причины отказа ранжируются по частоте; суммируется доля двух самых частых причин в общем числе отказов.",
      `Гипотеза срабатывает, если топ-2 покрывают не менее ${(THRESHOLDS.ROOT_CAUSE_TOP2 * 100).toFixed(0)}% — корневая причина выглядит узкой.`,
    ],
    R13: [
      "Оценивается «качество справочника»: доля причин с единичной частотой и доля формулировок из «размытых» шаблонов (прочее, не указано, и т.п.).",
      `Срабатывание, если уникальных «единичных» причин ≥ ${(THRESHOLDS.UNIQUE_CAUSE_SHARE * 100).toFixed(0)}% от списка различных причин или размытых формулировок ≥ ${(THRESHOLDS.VAGUE_CAUSE_SHARE * 100).toFixed(0)}% по числу отказов.`,
    ],
    R14: [
      "Требуется сравнение прямых затрат на ремонт и оценки потерь от простоя по инциденту.",
      "В текущем наборе нет раздельных числовых полей для этих двух величин — правило отмечено как неподдерживаемое.",
    ],
    R15: [
      "Правило ищет краевые подразделения, где один класс оборудования даёт разный ущерб.",
      "Нужен атрибут подразделения в данных по отказам/затратам; в агрегате его нет.",
    ],
    R16: [
      "Сопоставляется «дорогизна» отказа и глубина RCA (механизм, корневая причина).",
      "В выгрузке нет полей механизма и корневой причины на уровне инцидента — проверка не запускается.",
    ],
    R17: [
      "По repairEvents для каждого класса считается доля «повторных» записей (все кроме первой по объекту в хронологии) от всех записей класса.",
      "Оставляются классы с не менее 3 событиями; лидер сравнивается с медианой доли повторов по классам.",
      "Срабатывание: доля повторов в лидере ≥ 1,6× медианы и не менее 3 повторных записей в классе.",
    ],
    R18: [
      "Строятся топ-5 объектов по затратам и топ-5 по числу отказов; считается пересечение множеств.",
      "Дополнительно — ранговая корреляция Спирмена между отказами и затратами по объектам.",
      `Срабатывание при малом пересечении (≤ ${THRESHOLDS.R18_OVERLAP_MAX}) и слабой корреляции (≤ ${THRESHOLDS.R18_CORR_MAX.toFixed(2)} или нет данных), то есть крупные потери не совпадают с «самыми частыми» отказами.`,
    ],
    K1: [
      "По объектам с ненулевым КТГ считается доля тех, у кого средний КТГ в срезе ниже целевого уровня.",
      `Целевой уровень: ${THRESHOLDS.KTG_TARGET}%. Срабатывание, если таких объектов ≥ ${(THRESHOLDS.KTG_LOW_SHARE * 100).toFixed(0)}% от объектов с данными КТГ (минимум 3 объекта).`,
    ],
    K2: [
      `По СННО (MTBF) объектов считается медиана в срезе; порог «аномально низко» = ${(THRESHOLDS.MTBF_LOW_FACTOR * 100).toFixed(0)}% медианы.`,
      "Гипотеза срабатывает, если есть хотя бы один объект с положительным СННО не выше этого порога (минимум 5 объектов в выборке).",
    ],
    K3: [
      "По всем значениям СВВ (MTTR) считается 90-й процентиль.",
      "Объекты с СВВ не ниже этого уровня считаются «хвостом» медленных восстановлений; гипотеза срабатывает, если такой хвост непустой (минимум 5 объектов с СВВ).",
    ],
    K4: [
      "По месяцам суммируются часы трудовых и материальных работ; ищется пик и сравнение с медианой по месяцам.",
      `Срабатывание, если пик ≥ ${THRESHOLDS.MATERIAL_LABOR_PEAK_FACTOR.toFixed(1)}× медианы (минимум 4 месяца данных).`,
    ],
  };

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

  function monthsForPeriod(period) {
    if (period === "h1") return new Set(MONTHS_ORDER_2025.slice(0, 6));
    if (period === "h2") return new Set(MONTHS_ORDER_2025.slice(6, 12));
    return new Set(MONTHS_ORDER_2025);
  }

  function monthRuLabelFromDate(d) {
    if (!d || Number.isNaN(d.getTime())) return "";
    const RU = [
      "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
      "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
    ];
    return `${RU[d.getMonth()]} ${d.getFullYear()}`;
  }

  function diagnosticConfidence(d) {
    if (!d || d.status === STATUS.INSUFFICIENT) {
      return CONFIDENCE.LOW;
    }
    const ev = d.evidence;
    if (ev && ev.type === "table" && Array.isArray(ev.rows)) {
      const n = ev.rows.length;
      if (n >= 8) return CONFIDENCE.HIGH;
      if (n >= 3) return CONFIDENCE.MEDIUM;
      return CONFIDENCE.LOW;
    }
    if (ev && ev.type === "chart") {
      const n = (ev.categories || []).length;
      const series = ev.series || [];
      const hasVals = series.some((s) =>
        Array.isArray(s && s.data) && s.data.some((v) => Number.isFinite(Number(v)))
      );
      if (!hasVals || n < 2) return CONFIDENCE.LOW;
      if (n >= 8) return CONFIDENCE.HIGH;
      if (n >= 4) return CONFIDENCE.MEDIUM;
      return CONFIDENCE.LOW;
    }
    if (d.status === STATUS.TRIGGERED) return CONFIDENCE.MEDIUM;
    return CONFIDENCE.MEDIUM;
  }

  function withHypothesisConfidence(d) {
    const base = d && typeof d === "object" ? d : {};
    const confidence = diagnosticConfidence(base);
    const enriched = Object.assign({}, base, { confidence });
    const explanation = DIAG_EXPANDED_EXPLAIN[base.id] || [
      "Развёрнутое описание для этого правила не задано.",
    ];
    return Object.assign({}, enriched, {
      confidence_metrics: buildConfidenceMetrics(enriched),
      explanation,
    });
  }

  /** Короткие пояснения: чего не хватает или почему уверенность не высокая. */
  function buildConfidenceMetrics(d) {
    const lines = [];
    if (!d) return lines;
    if (d.status === STATUS.INSUFFICIENT) {
      const w = String(d.warning || "").trim();
      if (w) {
        lines.push(w.length > 180 ? `${w.slice(0, 177)}…` : w);
      } else {
        lines.push("В наборе не хватает входных рядов или атрибутов для этой гипотезы.");
      }
      return lines.slice(0, 2);
    }
    const ev = d.evidence;
    const conf = d.confidence || diagnosticConfidence(d);
    if (ev && ev.type === "table" && Array.isArray(ev.rows)) {
      const n = ev.rows.length;
      lines.push(`Таблица опоры: ${n} строк.`);
      if (conf === "high") {
        lines.push("Объёма данных достаточно для устойчивого вывода.");
      } else {
        if (n < 8) lines.push("Для высокой уверенности обычно ≥8 строк — сигнал менее устойчив.");
        if (conf === "low" && n < 3) lines.push("Крайне мало строк; возможны случайные доли.");
      }
    } else if (ev && ev.type === "chart") {
      const n = (ev.categories || []).length;
      lines.push(`График опоры: ${n} точек.`);
      if (conf === "high") {
        lines.push("Длины ряда достаточно для устойчивого вывода.");
      } else {
        if (n < 8) lines.push("Для высокой уверенности обычно ≥8 точек — ряд короткий.");
        if (conf === "low" && n < 4) lines.push("Мало периодов для уверенного вывода.");
      }
    } else {
      lines.push("Нет таблицы/графика в доказательствах — опора только на сводный факт.");
      if (conf !== "high") lines.push("Поэтому уверенность не максимальная.");
    }
    return lines.slice(0, 3);
  }

  function safeShare(num, denom) {
    if (!denom) return 0;
    return Number(num) / Number(denom);
  }

  function formatPct(value) {
    const v = Number(value);
    if (!Number.isFinite(v)) return "—";
    return `${(v * 100).toFixed(1)}%`;
  }

  function formatNum(value, digits) {
    const v = Number(value);
    if (!Number.isFinite(v)) return "—";
    return v.toLocaleString("ru-RU", {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits > 0 ? 1 : 0,
    });
  }

  function formatMoney(value) {
    return formatNum(value, 0);
  }

  function formatHours(value) {
    return formatNum(value, 1);
  }

  function median(values) {
    const sorted = (values || [])
      .map(Number)
      .filter((v) => Number.isFinite(v))
      .sort((a, b) => a - b);
    if (!sorted.length) return null;
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2) return sorted[mid];
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function quantile(values, q) {
    const sorted = (values || [])
      .map(Number)
      .filter((v) => Number.isFinite(v))
      .sort((a, b) => a - b);
    if (!sorted.length) return null;
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sorted[base + 1] !== undefined) {
      return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    }
    return sorted[base];
  }

  function spearmanCorrelation(xs, ys) {
    if (!xs || !ys || xs.length !== ys.length || xs.length < 3) return null;
    const ranks = (arr) => {
      const indexed = arr.map((v, i) => ({ v: Number(v) || 0, i }));
      indexed.sort((a, b) => a.v - b.v);
      const r = new Array(arr.length);
      let i = 0;
      while (i < indexed.length) {
        let j = i;
        while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j += 1;
        const avgRank = (i + j) / 2 + 1;
        for (let k = i; k <= j; k += 1) r[indexed[k].i] = avgRank;
        i = j + 1;
      }
      return r;
    };
    const rx = ranks(xs);
    const ry = ranks(ys);
    const n = xs.length;
    const meanX = rx.reduce((a, b) => a + b, 0) / n;
    const meanY = ry.reduce((a, b) => a + b, 0) / n;
    let num = 0;
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < n; i += 1) {
      const a = rx[i] - meanX;
      const b = ry[i] - meanY;
      num += a * b;
      dx += a * a;
      dy += b * b;
    }
    const denom = Math.sqrt(dx * dy);
    if (!denom) return null;
    return num / denom;
  }

  function applyFilters(raw, filters) {
    const period = (filters && filters.period) || "all";
    const classFilter = (filters && filters.class) || "__all__";
    const monthSet = monthsForPeriod(period);
    const classActive = !!(classFilter && classFilter !== "__all__");

    const equipmentCostsMap = (raw && raw.tables && raw.tables.equipmentCosts) || {};
    const ktgMap = (raw && raw.tables && raw.tables.ktg) || {};
    const defectsMap = (raw && raw.tables && raw.tables.equipmentDefects) || {};
    const mtbfArr = (raw && raw.charts && raw.charts.mtbfByEquipment) || [];
    const mttrArr = (raw && raw.charts && raw.charts.mttrByEquipment) || [];
    const causesArr = (raw && raw.charts && raw.charts.failureCauses) || [];
    const costsByMonth = (raw && raw.charts && raw.charts.costsByMonth) || [];
    const materialLaborByMonth = (raw && raw.charts && raw.charts.materialLaborByMonth) || [];

    const inClass = (name) => !classActive || classifyClass(name) === classFilter;
    const periodFraction = monthSet.size / 12;

    const equipmentCosts = [];
    for (const [name, info] of Object.entries(equipmentCostsMap)) {
      if (name === "Итого") continue;
      if (!inClass(name)) continue;
      const months = (info && info.months) || {};
      let total = 0;
      for (const [m, v] of Object.entries(months)) {
        if (monthSet.has(m)) total += Number(v) || 0;
      }
      equipmentCosts.push({ name, class: classifyClass(name), total });
    }

    const ktg = [];
    for (const [name, info] of Object.entries(ktgMap)) {
      if (!inClass(name)) continue;
      const totalDowntimeFull = Number(info && info.total_downtime_h) || 0;
      const monthlyKtg = (info && info.monthly_ktg) || {};
      const ktgValues = [];
      for (const [m, v] of Object.entries(monthlyKtg)) {
        if (monthSet.has(m)) ktgValues.push(Number(v) || 0);
      }
      const avgKtg = ktgValues.length
        ? ktgValues.reduce((a, b) => a + b, 0) / ktgValues.length
        : Number(info && info.avg_ktg) || 0;
      ktg.push({
        name,
        class: classifyClass(name),
        avg_ktg: avgKtg,
        total_downtime_h: totalDowntimeFull * periodFraction,
      });
    }

    const defects = [];
    for (const [name, count] of Object.entries(defectsMap)) {
      if (name === "Итого") continue;
      if (!inClass(name)) continue;
      defects.push({
        name,
        class: classifyClass(name),
        count: (Number(count) || 0) * periodFraction,
      });
    }

    const mtbf = mtbfArr
      .filter((r) => inClass(r && r.equipment))
      .map((r) => ({
        equipment: r.equipment,
        class: classifyClass(r.equipment),
        mtbf_h: Number(r.mtbf_h) || 0,
      }));

    const mttr = mttrArr
      .filter((r) => inClass(r && r.equipment))
      .map((r) => ({
        equipment: r.equipment,
        class: classifyClass(r.equipment),
        mttr_h: Number(r.mttr_h) || 0,
      }));

    const failureCauses = (causesArr || []).map((r) => ({
      cause: r && r.cause,
      count: Number(r && r.count) || 0,
    }));

    let costsMonthly = (costsByMonth || []).filter((r) => monthSet.has(r && r.month));
    if (classActive) {
      costsMonthly = costsMonthly.map((r) => {
        let sum = 0;
        for (const [name, info] of Object.entries(equipmentCostsMap)) {
          if (!inClass(name)) continue;
          const v = info && info.months && info.months[r.month];
          sum += Number(v) || 0;
        }
        return { month: r.month, total: sum };
      });
    } else {
      costsMonthly = costsMonthly.map((r) => ({
        month: r.month,
        total: Number(r.total) || 0,
      }));
    }

    const materialLabor = (materialLaborByMonth || [])
      .filter((r) => monthSet.has(r && r.month))
      .map((r) => ({
        month: r.month,
        material_h: Number(r.material_h || r.material || 0),
        labor_h: Number(r.labor_h || r.labor || 0),
      }));

    const repairEventsRaw = (raw && raw.tables && raw.tables.repairEvents) || [];
    const repairEvents = [];
    for (let i = 0; i < repairEventsRaw.length; i += 1) {
      const e = repairEventsRaw[i];
      if (!e || !e.equipment || !e.start) continue;
      const sd = new Date(e.start);
      if (Number.isNaN(sd.getTime())) continue;
      if (!inClass(e.equipment)) continue;
      const monthKey = monthRuLabelFromDate(sd);
      repairEvents.push({
        equipment: e.equipment,
        start: e.start,
        end: e.end || "",
        duration_h: Number(e.duration_h) || 0,
        month: monthKey,
        class: classifyClass(e.equipment),
      });
    }

    return {
      filters: { period, class: classFilter },
      classActive,
      periodFraction,
      monthsCount: monthSet.size,
      equipmentCosts,
      ktg,
      defects,
      mtbf,
      mttr,
      failureCauses,
      costsMonthly,
      materialLabor,
      repairEvents,
    };
  }

  function paretoBy(items, valueKey) {
    const arr = (items || [])
      .map((r) => Object.assign({}, r))
      .filter((r) => Number(r[valueKey]) > 0)
      .sort((a, b) => Number(b[valueKey]) - Number(a[valueKey]));
    const total = arr.reduce((s, r) => s + (Number(r[valueKey]) || 0), 0);
    if (!arr.length || total <= 0) {
      return { grouped: [], top80: [], share80: 0, total: 0 };
    }
    let cum = 0;
    const grouped = arr.map((r) => {
      cum += Number(r[valueKey]) || 0;
      return Object.assign({}, r, {
        cum_sum: cum,
        cum_perc: cum / total,
        share: Number(r[valueKey]) / total,
      });
    });
    let cutoff = grouped.findIndex((r) => r.cum_perc >= 0.8);
    if (cutoff < 0) cutoff = grouped.length - 1;
    const top80 = grouped.slice(0, cutoff + 1);
    const share80 = top80.length / grouped.length;
    return { grouped, top80, share80, total };
  }

  function makeRecommendation(id, title, status, summary, action, opts) {
    const o = opts || {};
    return {
      id,
      title,
      status,
      summary,
      recommendation: action,
      evidence_notes: o.evidence_notes || [],
      evidence: o.evidence || null,
      warning: o.warning || null,
    };
  }

  function makeInsufficient(id, title, action, warning) {
    return {
      id,
      title,
      status: STATUS.INSUFFICIENT,
      summary: "Недостаточно данных для надёжной проверки гипотезы.",
      recommendation: action,
      evidence_notes: [],
      evidence: null,
      warning: warning || null,
    };
  }

  function makeUnsupported(id, title, action, reason) {
    return makeInsufficient(
      id,
      title,
      action,
      `Не поддерживается на текущих данных: ${reason}.`
    );
  }

  function _analyzeR1(ctx) {
    const title = "Простои концентрируются на небольшом наборе объектов";
    const action =
      "Пересмотреть критичность объектов с максимальным простоем и запустить программу надёжности (RCA, ППР, ЗИП).";
    const items = ctx.ktg.filter((r) => r.total_downtime_h > 0);
    if (items.length < 3) {
      return makeInsufficient("R1", title, action,
        "Нужны данные минимум по 3 объектам с простоями.");
    }
    const p = paretoBy(items, "total_downtime_h");
    if (!p.grouped.length) {
      return makeInsufficient("R1", title, action,
        "Нет ни одного объекта с положительным простоем.");
    }
    const summary = `${formatPct(p.share80)} объектов формируют 80% простоя в текущем срезе ` +
      `(всего объектов с простоем: ${p.grouped.length}).`;
    const evidenceRows = p.top80.slice(0, 10).map((r) => ({
      name: r.name,
      class: r.class,
      total_downtime_h: r.total_downtime_h,
      share: r.share,
    }));
    const top5 = evidenceRows.slice(0, 5).map((r) => r.name).join(", ");
    const status = p.share80 <= THRESHOLDS.PARETO_SHARE ? STATUS.TRIGGERED : STATUS.NOT_TRIGGERED;
    return makeRecommendation("R1", title, status, summary, action, {
      evidence_notes: top5 ? [`Критичные объекты: ${top5}`] : [],
      evidence: {
        type: "table",
        title: "Объекты, формирующие 80% простоя",
        columns: [
          { key: "name", label: "Объект" },
          { key: "class", label: "Класс" },
          { key: "total_downtime_h", label: "Простой, ч", format: "hours" },
          { key: "share", label: "Доля", format: "pct" },
        ],
        rows: evidenceRows,
      },
    });
  }

  function _analyzeR2(ctx) {
    const title = "Экономический ущерб концентрируется на небольшом наборе объектов";
    const action =
      "Пересмотреть критичность объектов с максимальными затратами и сформировать целевую программу для топа.";
    const items = ctx.equipmentCosts.filter((r) => r.total > 0);
    if (items.length < 3) {
      return makeInsufficient("R2", title, action,
        "Нужны данные минимум по 3 объектам с положительными затратами.");
    }
    const p = paretoBy(items, "total");
    const summary = `${formatPct(p.share80)} объектов формируют 80% затрат ТОиР в текущем срезе ` +
      `(всего объектов с затратами: ${p.grouped.length}).`;
    const evidenceRows = p.top80.slice(0, 10).map((r) => ({
      name: r.name,
      class: r.class,
      total: r.total,
      share: r.share,
    }));
    const status = p.share80 <= THRESHOLDS.PARETO_SHARE ? STATUS.TRIGGERED : STATUS.NOT_TRIGGERED;
    const top3Note = evidenceRows
      .slice(0, 3)
      .map((r) => `${r.name} (${formatMoney(r.total)} руб.)`)
      .join(", ");
    return makeRecommendation("R2", title, status, summary, action, {
      evidence_notes: top3Note ? [`Топ-3 по затратам: ${top3Note}.`] : [],
      evidence: {
        type: "table",
        title: "Объекты, формирующие 80% затрат",
        columns: [
          { key: "name", label: "Объект" },
          { key: "class", label: "Класс" },
          { key: "total", label: "Затраты, руб.", format: "money" },
          { key: "share", label: "Доля", format: "pct" },
        ],
        rows: evidenceRows,
      },
    });
  }

  function _analyzeR3(ctx) {
    const title = "Класс оборудования генерирует затраты непропорционально числу отказов";
    const action =
      "Проверить конструкцию, поставщиков и режимы эксплуатации классов с высокой диспропорцией; рассмотреть программу модернизации.";
    if (ctx.classActive) {
      return makeInsufficient("R3", title, action,
        "Диагностика по классам недоступна при включённом фильтре по конкретному классу.");
    }
    const classMap = new Map();
    for (const r of ctx.equipmentCosts) {
      const c = r.class;
      if (!classMap.has(c)) classMap.set(c, { class: c, total_cost: 0, defect_count: 0 });
      classMap.get(c).total_cost += r.total;
    }
    for (const r of ctx.defects) {
      const c = r.class;
      if (!classMap.has(c)) classMap.set(c, { class: c, total_cost: 0, defect_count: 0 });
      classMap.get(c).defect_count += r.count;
    }
    const classes = [...classMap.values()].filter((r) => r.total_cost > 0 && r.defect_count > 0);
    if (classes.length < 3) {
      return makeInsufficient("R3", title, action,
        "Нужны минимум 3 класса оборудования с затратами и отказами.");
    }
    const totalCost = classes.reduce((s, r) => s + r.total_cost, 0);
    const totalDefects = classes.reduce((s, r) => s + r.defect_count, 0);
    classes.forEach((r) => {
      r.cost_share = safeShare(r.total_cost, totalCost);
      r.defect_share = safeShare(r.defect_count, totalDefects);
      r.disproportion = r.defect_share > 0 ? r.cost_share / r.defect_share : null;
    });
    classes.sort((a, b) => (b.disproportion || 0) - (a.disproportion || 0));
    const worst = classes[0];
    const triggered = (worst.disproportion || 0) >= THRESHOLDS.DISPROPORTION_FACTOR
      && worst.cost_share >= 0.25;
    const summary = `Класс «${worst.class}» формирует ${formatPct(worst.cost_share)} затрат ` +
      `при ${formatPct(worst.defect_share)} отказов (коэф. диспропорции ${(worst.disproportion || 0).toFixed(2)}).`;
    return makeRecommendation("R3", title,
      triggered ? STATUS.TRIGGERED : STATUS.NOT_TRIGGERED, summary, action, {
      evidence_notes: [`Самый несбалансированный класс: ${worst.class}.`],
      evidence: {
        type: "table",
        title: "Классы по доле затрат и доле отказов",
        columns: [
          { key: "class", label: "Класс" },
          { key: "total_cost", label: "Затраты, руб.", format: "money" },
          { key: "cost_share", label: "Доля затрат", format: "pct" },
          { key: "defect_count", label: "Отказы (≈)", format: "num1" },
          { key: "defect_share", label: "Доля отказов", format: "pct" },
          { key: "disproportion", label: "Коэф.", format: "ratio" },
        ],
        rows: classes,
      },
    });
  }

  function _analyzeR4(ctx) {
    const title = "В отдельных классах оборудования отказы устраняются существенно дольше";
    const action =
      "Проверить обеспеченность ЗИП и стандарт быстрого восстановления для классов с аномальным временем ремонта.";
    if (!ctx.mttr.length) {
      return makeInsufficient("R4", title, action, "Нет данных по СВВ (MTTR) объектов.");
    }
    const overallMedian = median(ctx.mttr.map((r) => r.mttr_h));
    if (!overallMedian) {
      return makeInsufficient("R4", title, action, "Не удалось рассчитать медианное СВВ.");
    }
    const classMap = new Map();
    for (const r of ctx.mttr) {
      if (!classMap.has(r.class)) classMap.set(r.class, []);
      classMap.get(r.class).push(r.mttr_h);
    }
    const classes = [...classMap.entries()]
      .filter(([, vals]) => vals.length >= 2)
      .map(([cls, vals]) => ({
        class: cls,
        incidents: vals.length,
        median_mttr_h: median(vals),
        avg_mttr_h: vals.reduce((a, b) => a + b, 0) / vals.length,
      }))
      .sort((a, b) => b.median_mttr_h - a.median_mttr_h);
    if (!classes.length) {
      return makeInsufficient("R4", title, action,
        "Нет классов с минимум 2 объектами в данных СВВ.");
    }
    const worst = classes[0];
    const triggered = worst.median_mttr_h >= overallMedian * 1.5
      && worst.median_mttr_h - overallMedian >= 4;
    const summary = `Класс «${worst.class}» имеет медианное СВВ ${formatHours(worst.median_mttr_h)} ч ` +
      `против ${formatHours(overallMedian)} ч по срезу.`;
    return makeRecommendation("R4", title,
      triggered ? STATUS.TRIGGERED : STATUS.NOT_TRIGGERED, summary, action, {
      evidence_notes: [`Общая медиана СВВ по срезу: ${formatHours(overallMedian)} ч.`],
      evidence: {
        type: "table",
        title: "Классы по медианному СВВ",
        columns: [
          { key: "class", label: "Класс" },
          { key: "incidents", label: "Объектов", format: "int" },
          { key: "median_mttr_h", label: "Медиана СВВ, ч", format: "hours" },
          { key: "avg_mttr_h", label: "Среднее СВВ, ч", format: "hours" },
        ],
        rows: classes.slice(0, 10),
      },
    });
  }

  function _analyzeR5(ctx) {
    const title = "Затраты ТОиР распределены неравномерно во времени";
    const action =
      "Разобрать сезонность затрат и пиковые месяцы; синхронизировать ППР, чтобы сглаживать всплески.";
    if (ctx.costsMonthly.length < 4) {
      return makeInsufficient("R5", title, action,
        "Нужны данные минимум за 4 месяца для оценки пиков.");
    }
    const total = ctx.costsMonthly.reduce((s, r) => s + r.total, 0);
    if (total <= 0) {
      return makeInsufficient("R5", title, action,
        "В выбранном срезе суммарные затраты равны 0.");
    }
    const med = median(ctx.costsMonthly.map((r) => r.total));
    const sorted = [...ctx.costsMonthly].sort((a, b) => b.total - a.total);
    const peak = sorted[0];
    const peakShare = safeShare(peak.total, total);
    const ratio = med > 0 ? peak.total / med : null;
    const triggered = peakShare >= THRESHOLDS.PEAK_SHARE
      || (med > 0 && peak.total >= med * THRESHOLDS.PEAK_VS_MEDIAN);
    const summary = `Пиковый месяц «${peak.month}» дал ${formatPct(peakShare)} затрат текущего среза ` +
      `(медиана месяца — ${formatMoney(med)} руб.).`;
    const ratioNote = ratio !== null ? `Пик выше медианы в ${ratio.toFixed(1)}× раз.` : "";
    return makeRecommendation("R5", title,
      triggered ? STATUS.TRIGGERED : STATUS.NOT_TRIGGERED, summary, action, {
      evidence_notes: ratioNote ? [ratioNote] : [],
      evidence: {
        type: "chart",
        chartType: "bar",
        title: "Затраты по месяцам",
        categories: ctx.costsMonthly.map((r) => r.month),
        series: [{ name: "Затраты", data: ctx.costsMonthly.map((r) => r.total) }],
      },
    });
  }

  function _analyzeR10(ctx) {
    const title = "Дорогие объекты не восстанавливаются быстрее";
    const action =
      "Внедрить риск-ориентированную диспетчеризацию: дорогим объектам — приоритет в очереди ремонтов.";
    const costsByName = new Map(ctx.equipmentCosts.map((r) => [r.name, r.total]));
    const pairs = ctx.mttr
      .map((r) => ({
        name: r.equipment,
        mttr_h: r.mttr_h,
        cost: costsByName.get(r.equipment) || 0,
      }))
      .filter((r) => r.mttr_h > 0 && r.cost > 0);
    if (pairs.length < 5) {
      return makeInsufficient("R10", title, action,
        "Нужны минимум 5 объектов с заполненными СВВ и затратами.");
    }
    const corr = spearmanCorrelation(
      pairs.map((p) => p.cost),
      pairs.map((p) => p.mttr_h)
    );
    if (corr === null) {
      return makeInsufficient("R10", title, action,
        "Не удалось рассчитать ранговую корреляцию.");
    }
    const triggered = corr <= THRESHOLDS.R10_CORR_THRESHOLD;
    const summary = `Ранговая корреляция между затратами и СВВ объектов: ${corr.toFixed(2)} ` +
      `(по ${pairs.length} объектам).`;
    return makeRecommendation("R10", title,
      triggered ? STATUS.TRIGGERED : STATUS.NOT_TRIGGERED, summary, action, {
      evidence_notes: ["Если приоритизация работает, дорогие объекты восстанавливаются хотя бы не медленнее остальных."],
      evidence: {
        type: "table",
        title: "Затраты vs СВВ по объектам (топ-10 по затратам)",
        columns: [
          { key: "name", label: "Объект" },
          { key: "cost", label: "Затраты, руб.", format: "money" },
          { key: "mttr_h", label: "СВВ, ч", format: "hours" },
        ],
        rows: [...pairs].sort((a, b) => b.cost - a.cost).slice(0, 10),
      },
    });
  }

  function _analyzeR12(ctx) {
    const title = "Большинство отказов формируют 1–2 коренные причины";
    const action =
      "Сфокусировать программы улучшений на доминирующих причинах, а не распылять ресурсы на весь массив.";
    const causes = ctx.failureCauses.filter((r) => r.cause && r.count > 0)
      .sort((a, b) => b.count - a.count);
    if (causes.length < 2) {
      return makeInsufficient("R12", title, action,
        "Нужны минимум 2 различных причины отказа.");
    }
    const total = causes.reduce((s, r) => s + r.count, 0);
    if (!total) {
      return makeInsufficient("R12", title, action, "Сумма частот причин равна 0.");
    }
    const top2Sum = (causes[0].count || 0) + (causes[1].count || 0);
    const top2Share = safeShare(top2Sum, total);
    const triggered = top2Share >= THRESHOLDS.ROOT_CAUSE_TOP2;
    const summary = `Две топ-причины формируют ${formatPct(top2Share)} отказов ` +
      `(${causes[0].cause}, ${causes[1].cause}).`;
    const evidenceRows = causes.slice(0, 10).map((r) => ({
      cause: r.cause,
      count: r.count,
      share: safeShare(r.count, total),
    }));
    return makeRecommendation("R12", title,
      triggered ? STATUS.TRIGGERED : STATUS.NOT_TRIGGERED, summary, action, {
      evidence_notes: [],
      evidence: {
        type: "table",
        title: "Причины отказов по частоте",
        columns: [
          { key: "cause", label: "Причина" },
          { key: "count", label: "Отказов", format: "int" },
          { key: "share", label: "Доля", format: "pct" },
        ],
        rows: evidenceRows,
      },
    });
  }

  function _analyzeR13(ctx) {
    const title = "Качество классификации причин отказов низкое";
    const action =
      "Стандартизировать справочник причин и регламентировать единый подход к RCA — формулировки должны быть пригодны для анализа.";
    const causes = ctx.failureCauses.filter((r) => r.cause && r.count > 0);
    if (causes.length < 3) {
      return makeInsufficient("R13", title, action,
        "Нужны минимум 3 различных причины отказа для оценки качества.");
    }
    const total = causes.reduce((s, r) => s + r.count, 0);
    if (!total) return makeInsufficient("R13", title, action, "Сумма частот причин равна 0.");
    const isVague = (s) => {
      const v = String(s || "").toLowerCase();
      return VAGUE_PATTERNS.some((p) => v.includes(p));
    };
    const vagueCauses = causes.filter((r) => isVague(r.cause));
    const vagueSum = vagueCauses.reduce((s, r) => s + r.count, 0);
    const vagueShare = safeShare(vagueSum, total);
    const uniqueCauses = causes.filter((r) => r.count === 1);
    const uniqueShare = safeShare(uniqueCauses.length, causes.length);
    const triggered = uniqueShare >= THRESHOLDS.UNIQUE_CAUSE_SHARE
      || vagueShare >= THRESHOLDS.VAGUE_CAUSE_SHARE;
    const summary = `Уникальных причин: ${formatPct(uniqueShare)} от справочника; ` +
      `«размытые» формулировки покрывают ${formatPct(vagueShare)} отказов.`;
    const notes = [];
    if (vagueCauses.length) {
      notes.push(`Размытые формулировки: ${vagueCauses.slice(0, 5).map((r) => r.cause).join(", ")}.`);
    }
    return makeRecommendation("R13", title,
      triggered ? STATUS.TRIGGERED : STATUS.NOT_TRIGGERED, summary, action, {
      evidence_notes: notes,
      evidence: {
        type: "table",
        title: "Причины и частота их использования",
        columns: [
          { key: "cause", label: "Причина" },
          { key: "count", label: "Отказов", format: "int" },
        ],
        rows: causes.slice().sort((a, b) => b.count - a.count).slice(0, 15),
      },
    });
  }

  function _analyzeR18(ctx) {
    const title = "Крупнейшие потери идут от редких, но тяжёлых случаев";
    const action =
      "Сместить фокус ТОиР с частоты отказов на риск и экономический эффект — приоритеты по риску, а не по числу инцидентов.";
    const objects = ctx.equipmentCosts.filter((r) => r.total > 0);
    const defectsMap = new Map(ctx.defects.map((r) => [r.name, r.count]));
    if (objects.length < 5) {
      return makeInsufficient("R18", title, action,
        "Нужны минимум 5 объектов с затратами для сравнения.");
    }
    const enriched = objects.map((r) => ({
      name: r.name,
      class: r.class,
      total: r.total,
      defects: defectsMap.get(r.name) || 0,
    }));
    const top5ByCost = new Set([...enriched].sort((a, b) => b.total - a.total)
      .slice(0, 5).map((r) => r.name));
    const top5ByDefects = new Set([...enriched].filter((r) => r.defects > 0)
      .sort((a, b) => b.defects - a.defects).slice(0, 5).map((r) => r.name));
    let overlap = 0;
    top5ByCost.forEach((n) => {
      if (top5ByDefects.has(n)) overlap += 1;
    });
    const xs = enriched.map((r) => r.defects);
    const ys = enriched.map((r) => r.total);
    const corr = spearmanCorrelation(xs, ys);
    const triggered = overlap <= THRESHOLDS.R18_OVERLAP_MAX
      && (corr === null || corr <= THRESHOLDS.R18_CORR_MAX);
    const corrText = corr === null ? "н/д" : corr.toFixed(2);
    const summary = `Пересечение топ-5 по числу отказов и топ-5 по затратам: ${overlap} объектов; ` +
      `корреляция отказы↔затраты ${corrText}.`;
    const evidenceRows = [...enriched].sort((a, b) => b.total - a.total).slice(0, 10);
    const notes = [
      `Топ-5 по затратам: ${[...top5ByCost].join(", ")}.`,
      `Топ-5 по отказам: ${[...top5ByDefects].join(", ") || "—"}.`,
    ];
    return makeRecommendation("R18", title,
      triggered ? STATUS.TRIGGERED : STATUS.NOT_TRIGGERED, summary, action, {
      evidence_notes: notes,
      evidence: {
        type: "table",
        title: "Затраты и отказы по объектам (топ-10 по затратам)",
        columns: [
          { key: "name", label: "Объект" },
          { key: "class", label: "Класс" },
          { key: "total", label: "Затраты, руб.", format: "money" },
          { key: "defects", label: "Отказов", format: "int" },
        ],
        rows: evidenceRows,
      },
    });
  }

  function _analyzeK1(ctx) {
    const title = "Слишком много объектов с КТГ ниже целевого";
    const action =
      "Запустить программу повышения КТГ: ППР, сокращение длительности простоев, повышение надёжности у проблемных объектов.";
    const items = ctx.ktg.filter((r) => Number.isFinite(r.avg_ktg) && r.avg_ktg > 0);
    if (items.length < 3) {
      return makeInsufficient("K1", title, action,
        "Нужны данные КТГ минимум по 3 объектам.");
    }
    const below = items.filter((r) => r.avg_ktg < THRESHOLDS.KTG_TARGET);
    const share = safeShare(below.length, items.length);
    const triggered = share >= THRESHOLDS.KTG_LOW_SHARE;
    const summary = `${formatPct(share)} объектов имеют КТГ ниже ${THRESHOLDS.KTG_TARGET}% ` +
      `(${below.length} из ${items.length}).`;
    const evidenceRows = below
      .slice()
      .sort((a, b) => a.avg_ktg - b.avg_ktg)
      .slice(0, 10)
      .map((r) => ({
        name: r.name,
        class: r.class,
        avg_ktg: r.avg_ktg,
        total_downtime_h: r.total_downtime_h,
      }));
    return makeRecommendation("K1", title,
      triggered ? STATUS.TRIGGERED : STATUS.NOT_TRIGGERED, summary, action, {
      evidence_notes: [],
      evidence: {
        type: "table",
        title: "Объекты с самым низким КТГ",
        columns: [
          { key: "name", label: "Объект" },
          { key: "class", label: "Класс" },
          { key: "avg_ktg", label: "КТГ, %", format: "num1" },
          { key: "total_downtime_h", label: "Простой, ч", format: "hours" },
        ],
        rows: evidenceRows,
      },
    });
  }

  function _analyzeK2(ctx) {
    const title = "Есть объекты с аномально низким СННО";
    const action =
      "Проверить данные эксплуатации и корневые причины частых отказов; включить такие объекты в приоритетную программу надёжности.";
    if (ctx.mtbf.length < 5) {
      return makeInsufficient("K2", title, action,
        "Нужны данные СННО минимум по 5 объектам.");
    }
    const med = median(ctx.mtbf.map((r) => r.mtbf_h));
    if (!med) {
      return makeInsufficient("K2", title, action, "Не удалось рассчитать медианное СННО.");
    }
    const threshold = med * THRESHOLDS.MTBF_LOW_FACTOR;
    const flagged = ctx.mtbf
      .filter((r) => r.mtbf_h > 0 && r.mtbf_h <= threshold)
      .sort((a, b) => a.mtbf_h - b.mtbf_h);
    const triggered = flagged.length >= 1;
    const summary = `Медианный СННО по срезу: ${formatHours(med)} ч; ` +
      `объектов с СННО ≤ ${formatHours(threshold)} ч (50% медианы): ${flagged.length}.`;
    const notes = flagged.length
      ? [`Самые проблемные по СННО: ${flagged.slice(0, 5).map((r) => r.equipment).join(", ")}.`]
      : [];
    return makeRecommendation("K2", title,
      triggered ? STATUS.TRIGGERED : STATUS.NOT_TRIGGERED, summary, action, {
      evidence_notes: notes,
      evidence: {
        type: "table",
        title: "Объекты с минимальным СННО",
        columns: [
          { key: "equipment", label: "Объект" },
          { key: "class", label: "Класс" },
          { key: "mtbf_h", label: "СННО, ч", format: "hours" },
        ],
        rows: flagged.slice(0, 10),
      },
    });
  }

  function _analyzeK3(ctx) {
    const title = "Есть объекты с аномально высоким СВВ";
    const action =
      "Разобрать длинные ремонты: проверить ЗИП, регламент и квалификацию; внедрить стандарт быстрого восстановления.";
    if (ctx.mttr.length < 5) {
      return makeInsufficient("K3", title, action,
        "Нужны данные СВВ минимум по 5 объектам.");
    }
    const p90 = quantile(ctx.mttr.map((r) => r.mttr_h), THRESHOLDS.MTTR_QUANTILE);
    if (!p90) {
      return makeInsufficient("K3", title, action,
        "Не удалось рассчитать 90-й процентиль СВВ.");
    }
    const flagged = ctx.mttr
      .filter((r) => r.mttr_h >= p90)
      .sort((a, b) => b.mttr_h - a.mttr_h);
    const triggered = flagged.length >= 1;
    const summary = `90-й процентиль СВВ: ${formatHours(p90)} ч; ` +
      `объектов на этом уровне или выше: ${flagged.length}.`;
    const notes = flagged.length
      ? [`Самые медленные ремонты: ${flagged.slice(0, 5).map((r) => r.equipment).join(", ")}.`]
      : [];
    return makeRecommendation("K3", title,
      triggered ? STATUS.TRIGGERED : STATUS.NOT_TRIGGERED, summary, action, {
      evidence_notes: notes,
      evidence: {
        type: "table",
        title: "Объекты с наибольшим СВВ",
        columns: [
          { key: "equipment", label: "Объект" },
          { key: "class", label: "Класс" },
          { key: "mttr_h", label: "СВВ, ч", format: "hours" },
        ],
        rows: flagged.slice(0, 10),
      },
    });
  }

  function _analyzeK4(ctx) {
    const title = "В структуре работ есть пиковая аномалия по часам";
    const action =
      "Сверить отчёты по трудозатратам/материалам в пиковом месяце; убедиться, что нет ошибок ввода или незакрытых нарядов.";
    if (ctx.materialLabor.length < 4) {
      return makeInsufficient("K4", title, action, "Нужны данные минимум за 4 месяца.");
    }
    const totalH = ctx.materialLabor.map((r) => ({
      month: r.month,
      hours: r.material_h + r.labor_h,
    }));
    const totals = totalH.map((r) => r.hours);
    const med = median(totals);
    if (!med) return makeInsufficient("K4", title, action, "Медиана часов = 0.");
    const sorted = [...totalH].sort((a, b) => b.hours - a.hours);
    const peak = sorted[0];
    const ratio = med > 0 ? peak.hours / med : null;
    const triggered = ratio !== null && ratio >= THRESHOLDS.MATERIAL_LABOR_PEAK_FACTOR;
    const summary = `Пиковый месяц «${peak.month}»: ${formatHours(peak.hours)} ч ` +
      `(медиана — ${formatHours(med)} ч; пик в ${(ratio || 0).toFixed(1)}× выше).`;
    return makeRecommendation("K4", title,
      triggered ? STATUS.TRIGGERED : STATUS.NOT_TRIGGERED, summary, action, {
      evidence_notes: [],
      evidence: {
        type: "chart",
        chartType: "bar",
        title: "Часы работ по месяцам (труд + материалы)",
        categories: totalH.map((r) => r.month),
        series: [{ name: "Часы", data: totalH.map((r) => r.hours) }],
      },
    });
  }

  function _analyzeR6() {
    return makeUnsupported("R6",
      "Подразделения несут несоразмерный ущерб на отказ",
      "Сравнить режимы эксплуатации между подразделениями и тиражировать лучшие практики.",
      "нет атрибута «подразделение» в источнике");
  }

  function _analyzeR7(ctx) {
    const title = "Повторные отказы 30–60 дней стали системной проблемой";
    const action =
      "Сделать RCA обязательным для повторных случаев и контролировать качество устранения.";
    const ev = ctx.repairEvents || [];
    if (ev.length < 8) {
      return makeInsufficient("R7", title, action,
        "Нужна история ремонтов с датами начала (минимум ~8 записей в срезе).");
    }
    const byEq = new Map();
    for (let i = 0; i < ev.length; i += 1) {
      const row = ev[i];
      if (!byEq.has(row.equipment)) byEq.set(row.equipment, []);
      byEq.get(row.equipment).push(row);
    }
    const gaps = [];
    const gapsWin = [];
    byEq.forEach((rows) => {
      if (rows.length < 2) return;
      rows.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
      for (let j = 1; j < rows.length; j += 1) {
        const d0 = new Date(rows[j - 1].start).getTime();
        const d1 = new Date(rows[j].start).getTime();
        const days = (d1 - d0) / 86400000;
        if (days > 0 && days < 400) {
          gaps.push(days);
          if (days >= 30 && days <= 60) gapsWin.push({ name: rows[j].equipment, days });
        }
      }
    });
    if (gaps.length < 3) {
      return makeInsufficient("R7", title, action,
        "Мало пар последовательных отказов по одному объекту в срезе.");
    }
    const shareWin = gapsWin.length / gaps.length;
    const triggered = gapsWin.length >= 2 && shareWin >= 0.2;
    const summary = `Интервал 30–60 суток между стартами ремонтов: ${gapsWin.length} из ${gaps.length} пар (${formatPct(shareWin)}).`;
    const evidenceRows = gapsWin.slice(0, 12).map((r) => ({
      name: r.name,
      gap_days: Math.round(r.days * 10) / 10,
    }));
    return makeRecommendation("R7", title,
      triggered ? STATUS.TRIGGERED : STATUS.NOT_TRIGGERED, summary, action, {
      evidence_notes: gapsWin.length ? [`Примеры (объект · суток): ${gapsWin.slice(0, 4).map((g) => `${g.name} · ${g.days.toFixed(0)}`).join("; ")}.`] : [],
      evidence: {
        type: "table",
        title: "Пары отказов в окне 30–60 суток (по старту ремонта)",
        columns: [
          { key: "name", label: "Объект" },
          { key: "gap_days", label: "Интервал, сут.", format: "num1" },
        ],
        rows: evidenceRows,
      },
    });
  }

  function _analyzeR8(ctx) {
    const title = "Повторные отказы длятся дольше первичных";
    const action =
      "Ввести постремонтную верификацию и обязательный разбор повторных случаев.";
    const ev = ctx.repairEvents || [];
    const byEq = new Map();
    for (let i = 0; i < ev.length; i += 1) {
      const row = ev[i];
      if (!byEq.has(row.equipment)) byEq.set(row.equipment, []);
      byEq.get(row.equipment).push(row);
    }
    const firstDurs = [];
    const repeatDurs = [];
    byEq.forEach((rows) => {
      if (rows.length < 2) return;
      rows.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
      firstDurs.push(Number(rows[0].duration_h) || 0);
      for (let j = 1; j < rows.length; j += 1) {
        repeatDurs.push(Number(rows[j].duration_h) || 0);
      }
    });
    if (repeatDurs.length < 3) {
      return makeInsufficient("R8", title, action,
        "Нужно больше повторных ремонтов с длительностью в срезе.");
    }
    const medFirst = median(firstDurs.filter((h) => h > 0));
    const medRep = median(repeatDurs.filter((h) => h > 0));
    if (!medFirst || !medRep) {
      return makeInsufficient("R8", title, action, "Не удалось сравнить длительности первичных и повторных ремонтов.");
    }
    const triggered = medRep >= medFirst * 1.18 && medRep - medFirst >= 1;
    const summary = `Медиана длительности первичного ремонта ${formatHours(medFirst)} ч, повторных ${formatHours(medRep)} ч.`;
    return makeRecommendation("R8", title,
      triggered ? STATUS.TRIGGERED : STATUS.NOT_TRIGGERED, summary, action, {
      evidence_notes: [`Первичных случаев (по объектам): ${firstDurs.length}; записей о повторных: ${repeatDurs.length}.`],
      evidence: {
        type: "table",
        title: "Сводка длительностей",
        columns: [
          { key: "kind", label: "Тип" },
          { key: "median_h", label: "Медиана, ч", format: "hours" },
        ],
        rows: [
          { kind: "Первичный (1-й ремонт на объекте)", median_h: medFirst },
          { kind: "Повторный", median_h: medRep },
        ],
      },
    });
  }
  function _analyzeR9() {
    return makeUnsupported("R9",
      "Дисциплины ремонтируют с разной скоростью",
      "Перенести лучшие практики быстрых команд как стандарт для классов с большим разбросом.",
      "нет атрибута «дисциплина/служба» в источнике");
  }
  function _analyzeR11(ctx) {
    const title = "В массиве много аномально коротких простоев";
    const action =
      "Проверить критерии классификации отказов; исключить косметическую регистрацию.";
    const durs = (ctx.repairEvents || [])
      .map((r) => Number(r.duration_h) || 0)
      .filter((h) => h > 0);
    if (durs.length < 8) {
      return makeInsufficient("R11", title, action,
        "Нужно больше записей ремонта с длительностью в срезе.");
    }
    const SHORT_H = 2;
    const shortN = durs.filter((h) => h < SHORT_H).length;
    const shareShort = safeShare(shortN, durs.length);
    const triggered = shareShort >= 0.18;
    const summary = `Доля ремонтов короче ${SHORT_H} ч: ${formatPct(shareShort)} (${shortN} из ${durs.length}).`;
    const sorted = durs.slice().sort((a, b) => a - b);
    const p50 = median(sorted);
    return makeRecommendation("R11", title,
      triggered ? STATUS.TRIGGERED : STATUS.NOT_TRIGGERED, summary, action, {
      evidence_notes: p50 != null ? [`Медианная длительность ремонта в срезе: ${formatHours(p50)} ч.`] : [],
      evidence: {
        type: "table",
        title: "Распределение длительности ремонта (фрагмент)",
        columns: [
          { key: "bucket", label: "Интервал, ч" },
          { key: "n", label: "Кол-во", format: "int" },
        ],
        rows: [
          { bucket: `< ${SHORT_H}`, n: shortN },
          { bucket: `≥ ${SHORT_H}`, n: durs.length - shortN },
        ],
      },
    });
  }
  function _analyzeR14() {
    return makeUnsupported("R14",
      "Часть ремонтов обходится дороже, чем потери от простоя",
      "Проверить экономическую целесообразность восстановления; рассмотреть замену.",
      "нет раздельных полей «затраты на ремонт» и «стоимость потерь»");
  }
  function _analyzeR15() {
    return makeUnsupported("R15",
      "Один класс даёт разный ущерб по подразделениям",
      "Сравнить режимы эксплуатации и тиражировать практики подразделений с меньшим ущербом.",
      "нет атрибута «подразделение» в источнике");
  }
  function _analyzeR16() {
    return makeUnsupported("R16",
      "Для дорогих отказов RCA не глубже среднего",
      "Сделать углублённый RCA обязательным для дорогих отказов.",
      "нет полей механизма отказа и коренной причины на уровне инцидента");
  }
  function _analyzeR17(ctx) {
    const title = "Повторные отказы концентрируются в отдельных сегментах";
    const action =
      "Точечные программы надёжности для сегментов с высокой повторяемостью.";
    const ev = ctx.repairEvents || [];
    if (ev.length < 12) {
      return makeInsufficient("R17", title, action,
        "Нужна более длинная история ремонтов по классам в срезе.");
    }
    const byEq = new Map();
    for (let i = 0; i < ev.length; i += 1) {
      const row = ev[i];
      if (!byEq.has(row.equipment)) byEq.set(row.equipment, []);
      byEq.get(row.equipment).push(row);
    }
    const classStats = new Map();
    byEq.forEach((rows) => {
      rows.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
      for (let j = 0; j < rows.length; j += 1) {
        const cls = rows[j].class || classifyClass(rows[j].equipment);
        if (!classStats.has(cls)) classStats.set(cls, { events: 0, repeats: 0 });
        const s = classStats.get(cls);
        s.events += 1;
        if (j > 0) s.repeats += 1;
      }
    });
    const rates = [...classStats.entries()]
      .filter(([, st]) => st.events >= 3)
      .map(([cls, st]) => ({
        class: cls,
        rate: st.events ? st.repeats / st.events : 0,
        repeats: st.repeats,
        events: st.events,
      }));
    if (rates.length < 2) {
      return makeInsufficient("R17", title, action,
        "Нужно минимум 2 класса с достаточным числом событий ремонта.");
    }
    rates.sort((a, b) => b.rate - a.rate);
    const worst = rates[0];
    const medRate = median(rates.map((r) => r.rate));
    if (!medRate) {
      return makeInsufficient("R17", title, action, "Не удалось оценить повторяемость по классам.");
    }
    const triggered = worst.rate >= medRate * 1.6 && worst.repeats >= 3;
    const summary = `Класс «${worst.class}»: доля повторных ремонтов ${formatPct(worst.rate)} ` +
      `(${worst.repeats}/${worst.events}), медиана по классам ${formatPct(medRate)}.`;
    return makeRecommendation("R17", title,
      triggered ? STATUS.TRIGGERED : STATUS.NOT_TRIGGERED, summary, action, {
      evidence_notes: [`Лидер по доле повторов: ${worst.class}.`],
      evidence: {
        type: "table",
        title: "Классы по доле повторных ремонтов (от всех записей класса)",
        columns: [
          { key: "class", label: "Класс" },
          { key: "rate", label: "Доля повторов", format: "pct" },
          { key: "repeats", label: "Повторные", format: "int" },
          { key: "events", label: "Всего записей", format: "int" },
        ],
        rows: rates.slice(0, 10),
      },
    });
  }

  function analyzeAll(raw, filters) {
    const ctx = applyFilters(raw || {}, filters || {});
    const out = [
      _analyzeR1(ctx), _analyzeR2(ctx), _analyzeR3(ctx), _analyzeR4(ctx), _analyzeR5(ctx),
      _analyzeR6(), _analyzeR7(ctx), _analyzeR8(ctx), _analyzeR9(), _analyzeR10(ctx),
      _analyzeR11(ctx), _analyzeR12(ctx), _analyzeR13(ctx), _analyzeR14(),
      _analyzeR15(), _analyzeR16(), _analyzeR17(ctx), _analyzeR18(ctx),
      _analyzeK1(ctx), _analyzeK2(ctx), _analyzeK3(ctx), _analyzeK4(ctx),
    ];
    return out.map(withHypothesisConfidence);
  }

  function summarize(results) {
    const arr = Array.isArray(results) ? results : [];
    const triggered = arr.filter((r) => r && r.status === STATUS.TRIGGERED);
    const insufficient = arr.filter((r) => r && r.status === STATUS.INSUFFICIENT);
    const notTriggered = arr.filter((r) => r && r.status === STATUS.NOT_TRIGGERED);
    return {
      total: arr.length,
      triggered: triggered.length,
      not_triggered: notTriggered.length,
      insufficient_data: insufficient.length,
    };
  }

  return {
    STATUS,
    CONFIDENCE,
    THRESHOLDS,
    classifyClass,
    applyFilters,
    analyzeAll,
    summarize,
  };
});
