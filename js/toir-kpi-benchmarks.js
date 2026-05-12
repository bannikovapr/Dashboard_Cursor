/** Пороги KPI и бенчмарки, вынесенные из разрозненных литералов в дашборде. При смене методики править здесь. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ToirKpiBenchmarks = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  return {
    KTG_PERCENT: { target: 95, standard: 90 },
    MTBF_HOURS: { target: 5000, standard: 2000 },
    /** Минимальные «полы» для доли топ-3 в затратах (ниже — зелёная зона относительно бейзлайна). */
    TOP3_SHARE_FLOORS: { target: 35, standard: 50 },
    /** Множители к бейзлайну для относительных KPI (ниже затрат лучше). */
    RELATIVE_TO_BASELINE: { target: 0.9, standard: 1.1 },
    /** Целевой множитель для топ-3 относительно бейзлайна (чуть строже, чем 0.9). */
    TOP3_TARGET_VS_BASE: 0.95,
  };
});
