---
name: agent-tools
description: Use this skill when designing the ReAct-agent tool layer for the dashboard backend (data-store + tools + system prompt + orchestration). Stack-agnostic (Node/Python/Go). Triggers: "настрой AI-агента дашборда", "добавь инструменты агенту", "сделай tool calling".
---

# Agent Tools — универсальный паттерн

Эта инструкция описывает, как встроить в дашборд агентный режим (LLM +
инструменты) поверх контракта `dashboard.json`. Реализация независима от языка
и фреймворка бэкенда — важен контракт инструментов, а не код.

## Архитектура

```
┌─────────────┐      ┌────────────────┐      ┌──────────────┐
│  UI (chat)  │ ───▶ │  /api/agent    │ ───▶ │  LLM (cloud) │
└─────────────┘      │  (ReAct loop)  │      └──────────────┘
                     │       │        │              │
                     │       ▼        │              ▼
                     │   tools.*()    │ ◀── tool_calls / results
                     │       │        │
                     │       ▼        │
                     │  data-store    │ ◀── dashboard.json
                     └────────────────┘
```

## Минимальный набор инструментов

Все инструменты принимают/возвращают JSON. Имена стандартные — переиспользуй их,
чтобы промты кита работали без переписывания.

### `get_kpis`

- Возвращает `kpis` из `dashboard.json` как словарь `id -> value`.
- Плюс `meta` и список доступных датасетов.

### `query_data`

Параметры:

```json
{
  "dataset": "string (обязателен)",
  "where":   { "field": "value | {op: eq|ne|gt|gte|lt|lte|contains, value: ...}" },
  "select":  ["field1", "field2"],
  "orderBy": { "field": "name", "dir": "asc|desc" },
  "limit":   1000
}
```

Источник — `dashboard.json -> datasets.<id>`. Лимит — 1000 строк максимум.

### `compute`

Операции: `sum | avg | min | max | count | delta | percent | rank | group_by`.

Параметры:

```json
{
  "operation": "sum",
  "dataset":   "orders",
  "field":     "amount",
  "where":     {},
  "group_by":  null,
  "top_n":     null
}
```

### `build_table`

Формирует артефакт для UI:

```json
{
  "type": "table",
  "title": "Топ-10 клиентов",
  "columns": ["Клиент", "Выручка"],
  "rows": [["Acme", 12500], ["Globex", 9800]]
}
```

Ограничения: ≤ 20 колонок, ≤ 200 строк.

### `build_chart`

```json
{
  "type": "chart",
  "chartType": "bar | line | pie | donut | area",
  "title": "Выручка по месяцам",
  "categories": ["янв", "фев", "мар"],
  "series": [{ "name": "Выручка", "data": [100, 120, 115] }]
}
```

Ограничения: ≤ 50 категорий, ≤ 50 точек на серию.

### `search_entity`

Полнотекстовый поиск по ключевым полям датасетов (напр. `name`, `title`).
Возвращает: `id`, `name`, `kind`, `found_in: [dataset ids]`.

### `forecast_metric`

On-demand прогноз временных рядов.

Параметры:

```json
{
  "metric":  "id серии из metric-catalog.yaml -> series (forecastable: true)",
  "horizon": 1..12,
  "method":  "auto | ets | arima",
  "filters": { "period": "all", "segment": "__all__" },
  "with_confidence": true
}
```

Возврат: `series_history`, `series_forecast` (+ lower/upper), `model_info`,
`quality` (`MAE`, `RMSE`, `MAPE`), плюс готовые артефакты `table` и `chart`
для UI.

## ReAct-оркестратор

### Параметры по умолчанию

- `MAX_STEPS = 5`
- `STEP_TIMEOUT_MS = 45000`
- `AGENT_TIMEOUT_MS = 90000`

### Формат обмена с LLM

Формат 1 (вызов инструментов):

```json
{
  "thinking": "кратко, что я хочу узнать",
  "tool_calls": [
    { "tool": "query_data", "params": { "dataset": "orders", "limit": 50 } }
  ]
}
```

Формат 2 (финальный ответ):

```json
{
  "answer": { "fact": "...", "conclusion": "...", "action": "..." },
  "artifacts": []
}
```

`artifacts` заполняется ТОЛЬКО если были вызваны `build_table`/`build_chart` или
инструмент сам вернул массив `artifacts` (например, `forecast_metric`).

### Стратегия ответов

- Простой факт → `get_kpis` → финальный ответ.
- Топ/сравнение → `query_data` → `compute` → `build_chart`/`build_table` → ответ.
- Тренд/причины → несколько `query_data` + `compute` → `build_chart` → ответ.
- Прогноз → `forecast_metric` (+ при нужде `build_chart`) → ответ с маркировкой неопределённости.

### Детерминированный intent-router (жёсткие правила)

LLM не всегда стабильно выбирает правильный инструмент — поэтому часть
маршрутизации делается ПРЕ-ПРОЦЕССОРОМ на стороне сервера (до вызова LLM
или как guard после первого ответа LLM). Это снижает количество ответов
без артефактов.

Правило 1. Обязательная визуализация (`visualize_required = true`), если в
вопросе встречается любой из маркеров:

- «график», «диаграмм», «chart», «plot», «визуал»;
- «таблиц», «table», «список», «перечень»;
- «топ», «top-«, «top ».

Если `visualize_required = true`, финальный ответ ОБЯЗАН содержать хотя бы
один артефакт (`build_table` или `build_chart`). Если LLM вернул финал без
артефактов — сервер откатывает шаг и форсирует следующую подсказку:
«Верни JSON с tool_calls, включающим build_chart/build_table».

Правило 2. `top_n`:

- триггер: регэксп `/топ[-\s]?(\d+)|top[-\s]?(\d+)/i`;
- извлечь N из вопроса;
- план: `query_data` с нужным датасетом → `compute.rank` с `top_n=N` →
  `build_chart` (или `build_table`, если явно просили таблицу) → ответ.
- Если LLM вернул меньше N значений при достаточных данных — сервер
  форсирует повторный вызов с явным `limit=N`.

Правило 3. `forecast`:

- триггер: «прогноз», «forecast», «спрогнозируй», «на N месяцев», «что будет».
- план: обязательно `forecast_metric` с валидным `metric` и `horizon`
  (если N не указан — 3);
- `build_chart`/`build_table` не обязательны: артефакты уже приходят из
  `forecast_metric`.

Правило 4. `compare_periods`:

- триггер: «сравни», «vs», «против», пара периодов/месяцев.
- план: `query_data` дважды (или один `query_data` + `compute.delta`) →
  `build_chart` (bar c двумя сериями) или `build_table`.

Правило 5. `dashboard_overview`:

- триггер: «покажи общее», «обзор», «summary», «коротко».
- план: `get_kpis` → финальный ответ без артефактов (или `build_table`
  с 4–6 ключевыми KPI).

Регистрация роутера:

- пре-процессор навешивает метки `intent`, `visualize_required`, `top_n`,
  `forecast_horizon` в `params` системного промта;
- системный промт обязывает LLM учитывать эти метки;
- пост-процессор валидирует финал: если `visualize_required` и нет
  артефактов — это retry, не ответ пользователю.

## Системный промт агента (шаблон)

```
Ты — AI-аналитик дашборда <brand.app.title>.
Доступные данные и инструменты описаны ниже.

Правила:
1. Сначала получай данные через инструменты, потом делай выводы.
2. Не выдумывай числа. Все цифры — только из результатов инструментов.
3. Если вопрос требует визуализации — вызывай build_chart или build_table.
4. Для расчётов — compute. Для прогноза — forecast_metric.
5. Максимум 5 вызовов за ответ.
6. Язык ответа: <brand.assistant.response_language>.
7. Запрещено упоминать пути файлов, ключи JSON, имя провайдера LLM.
8. Формат финального ответа — <brand.assistant.answer_format>.

Доступные датасеты: <перечень из dashboard.json -> datasets>
Доступные инструменты: <перечень выше с JSON-schema параметров>
```

## Guardrails

- Инструменты НЕ имеют доступа к файловой системе, сети, shell.
- `query_data.limit ≤ 1000`.
- `build_*` ограничивают размер артефактов.
- `forecast_metric.horizon ≤ 12`.
- Таймауты шага и всего цикла обязательны.
- При ошибке агента — автоматический fallback в классический чат (`/api/chat`).

## Контракт API

`POST /api/agent`:

```json
{ "question": "...", "filters": { "period": "all", "segment": "__all__" } }
```

Ответ:

```json
{
  "ok": true,
  "answer":    { "fact": "...", "conclusion": "...", "action": "..." },
  "artifacts": [ ... ],
  "trace":     { "steps": 3, "toolsUsed": ["query_data", "build_chart"] }
}
```

## Definition of Done

- Все 7 стандартных инструментов реализованы или отключены осознанно (с
  документированной причиной).
- Системный промт собирается из `brand.config.yaml` + `metric-catalog.yaml`.
- Агент проходит acceptance-вопросы для каждого интента из
  `skills/dashboard-assistant`.
- Есть smoke-тест end-to-end (`question -> answer + artifacts`).
- При нехватке ключа модели API возвращает понятную ошибку, UI переключается
  на fallback.
