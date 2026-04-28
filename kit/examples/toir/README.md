# Пример: ТОиР-дашборд (reference)

Это живой reference-проект, по которому проверялся весь кит. Он не копируется
в ваш проект и не предлагается как стартовая точка — это доказательство, что
контракт работает на реальной задаче с 7 разнородными источниками.

## Домен

Техническое обслуживание и ремонт (ТОиР) промышленного оборудования. Пользователь —
руководитель службы эксплуатации.

## Источники (7 файлов)

- `Анализ отказов.xlsx`
- `КТГ.xlsx`
- `Наработка на отказ.xlsx`
- `Простой.xlsx`
- `Процент износа.xlsx`
- `Список оборудования.xlsx`
- `Фактические затраты по ОР.xlsx`

## Как ложится на кит

| Кит                            | Файл в этом проекте                                       |
|--------------------------------|-----------------------------------------------------------|
| `source-manifest.yaml`         | см. `source-manifest.yaml` рядом                           |
| `metric-catalog.yaml`          | см. `metric-catalog.yaml` рядом                            |
| `brand.config.yaml`            | см. `brand.config.yaml` рядом                              |
| `ui-layout.yaml`               | см. `ui-layout.yaml` рядом                                 |
| data-mapper (skill)            | [scripts/analyze_toir.py](../../../scripts/analyze_toir.py) |
| dashboard-builder (skill)      | [index.html](../../../index.html), [js/toir-app.js](../../../js/toir-app.js), [js/toir-charts.js](../../../js/toir-charts.js), [css/toir.css](../../../css/toir.css) |
| dashboard-assistant (skill)    | [server/index.js](../../../server/index.js), [server/openrouter-client.js](../../../server/openrouter-client.js) |
| agent-tools (skill)            | [server/agent/tools.js](../../../server/agent/tools.js), [server/agent/prompts.js](../../../server/agent/prompts.js), [server/agent/agent-controller.js](../../../server/agent/agent-controller.js), [server/agent/data-store.js](../../../server/agent/data-store.js) |
| forecast                       | [scripts/forecast_series.py](../../../scripts/forecast_series.py), [scripts/smoke-forecast.js](../../../scripts/smoke-forecast.js) |
| acceptance-checklist           | [RESPONSIVE_ACCEPTANCE.md](../../../RESPONSIVE_ACCEPTANCE.md), [FORECAST_ACCEPTANCE.md](../../../FORECAST_ACCEPTANCE.md) |
| dashboard.json                 | [data/toir.json](../../../data/toir.json)                  |

## Что доказывает этот пример

- Кит работает на 7 разнородных Excel-источниках.
- Контракт `dashboard.json` выдерживает и KPI (8 карточек), и 10+ графиков, и
  таблицы по оборудованию, и изображение (износ).
- Агент с 7 инструментами (`get_kpis`, `query_data`, `compute`, `build_table`,
  `build_chart`, `search_equipment`, `forecast_metric`) отвечает по тем же
  правилам, что описаны в `skills/dashboard-assistant`.
- Прогноз на ETS/SARIMAX с fallback работает на месячных рядах.

## Что НЕ нужно копировать

- Доменную терминологию (СННО/СВВ/КТГ). У вас будет своя.
- Жёсткий список из 7 файлов. У вас может быть 1 или 30.
- Конкретные цвета, логотип, шрифт. У вас будет свой бренд.
- Русский язык интерфейса. У вас может быть любая локаль.

## Что можно скопировать

- Подход к структуре `dashboard.json` (пример заполненного файла).
- Паттерн инструментов агента.
- Чек-листы приёмки (ADAPT них под себя).
