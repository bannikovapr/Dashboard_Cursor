# AI Агент ТОИР

Подробная документация по агентному режиму дашборда ТОИР: архитектура, инструменты, формат API, артефакты, ограничения и диагностика.

## Назначение

Агентный режим нужен для сценариев, где обычного чат-ответа недостаточно:

- получить данные из нужного среза;
- выполнить вычисления по метрикам;
- сформировать таблицу или график;
- выдать итог в формате `fact -> conclusion -> action`.

В проекте сохраняются оба режима:

- `Быстрый ответ` (`POST /api/chat`) — классический чат без инструментов;
- `Агент` (`POST /api/agent`) — оркестрация LLM + tool calling.

## Архитектура

Ключевые файлы:

- `server/agent/data-store.js` — загрузка `data/toir.json`, нормализация в датасеты, API выборок и подготовка временных рядов для прогноза.
- `server/agent/tools.js` — описание и исполнение инструментов.
- `server/agent/prompts.js` — system prompt, формат обмена с моделью.
- `server/agent/agent-controller.js` — ReAct-цикл с лимитами шагов и таймаутами.
- `server/index.js` — endpoint `POST /api/agent`.
- `js/toir-app.js` — режимы `agent/chat`, рендер ответа и артефактов.
- `js/toir-charts.js` — `renderAgentChart()` для динамических графиков (включая прогнозные серии и интервалы).
- `index.html` + `css/toir.css` — UI контейнеров артефактов и workspace.

Логика запроса:

1. Пользователь отправляет вопрос из боковой панели AI.
2. UI вызывает `POST /api/agent`.
3. `agent-controller` запускает цикл: модель -> tool_calls -> результаты tools -> модель.
4. После финального ответа backend возвращает:
   - `answer` (`fact`, `conclusion`, `action`);
   - `artifacts` (`table` и/или `chart`);
   - `trace` (шаги, использованные инструменты, модель, метаданные прогноза при наличии).
5. UI показывает ответ и артефакты в sidebar; по кнопке развертывает в main workspace.

## Датасеты агента

Источник всех данных: `data/toir.json`.

Нормализованные наборы в `data-store.js`:

- `costs_monthly`: `month`, `total`
- `failure_causes`: `cause`, `count`
- `material_labor`: `month`, `material_h`, `labor_h`
- `mtbf`: `equipment`, `mtbf_h`
- `mttr`: `equipment`, `mttr_h`
- `equipment_costs`: `name`, `class`, `total`, `months`
- `ktg`: `name`, `class`, `avg_ktg`, `total_downtime_h`, `monthly_ktg`
- `defects`: `name`, `class`, `count`
- `analysis_leaders`: `equipment`, `total_rub`
- `analysis_causes`: `cause`, `count`

Классификация оборудования выполняется серверно функцией `classifyClass()`, чтобы ответы агента и UI использовали одну и ту же логику классов.

## Инструменты агента

Инструменты описаны в `TOOL_DEFINITIONS` и вызываются через `executeTool()`.

### `get_kpis`

Возвращает агрегаты:

- `kpis.total_cost`
- `kpis.total_defects`
- `kpis.equipment_count`
- `meta` и список доступных датасетов

### `query_data`

Запрос по датасету:

- обязательный параметр: `dataset`;
- фильтрация: `where` (`eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `contains`);
- выбор полей: `select`;
- сортировка: `orderBy` (`field` + `dir`);
- ограничение: `limit` (до 1000).

### `compute`

Операции:

- `sum`, `avg`, `min`, `max`, `count`
- `delta` (разница и процент изменения)
- `percent` (часть от целого)
- `rank` (топ по полю)
- `group_by` (группировка + sum/count/avg)

### `build_table`

Формирует артефакт:

- `type: "table"`
- `title`
- `columns` (не более 20)
- `rows` (не более 200)

### `build_chart`

Формирует артефакт:

- `type: "chart"`
- `chartType`: `bar | line | pie | donut | area`
- `title`
- `categories` (до 50)
- `series[].data` (до 50)

### `search_equipment`

Поиск по названию оборудования с возвратом:

- `name`
- `class`
- `found_in`

### `forecast_metric`

Инструмент on-demand прогноза временных рядов.

Поддерживаемые метрики:

- `costs_monthly`
- `material_h`
- `labor_h`
- `class_costs`

Параметры:

- `metric` — обязательный идентификатор ряда;
- `horizon` — горизонт `1..12` (если не указан в вопросе, агент использует 3);
- `method` — `auto | ets | arima`;
- `filters` — текущий срез UI (`period`, `class`);
- `with_confidence` — включение доверительных интервалов.

Как работает:

1. `data-store` формирует нормализованный ряд `{ ts, value }` с учетом фильтров.
2. `tools.js` вызывает Python-движок `scripts/forecast_series.py`.
3. Скрипт пробует ETS/SARIMAX (в `auto`) и при проблемах отдает fallback-прогноз.
4. Инструмент возвращает:
   - `series_history`;
   - `series_forecast` (при `with_confidence` с `lower/upper`);
   - `model_info`;
   - `quality` (`MAE`, `RMSE`, `MAPE`);
   - артефакты графика и таблицы для UI.

## ReAct цикл в backend

Файл: `server/agent/agent-controller.js`.

Параметры цикла:

- `MAX_STEPS = 5`
- `AGENT_TIMEOUT_MS = 90000`
- `STEP_TIMEOUT_MS = 45000`

Поведение:

1. Проверяется наличие `OPENROUTER_API_KEY`.
2. Формируется `system` + `user` контекст.
3. Модель может вернуть:
   - `tool_calls` -> выполняем инструменты и продолжаем цикл;
   - финальный `answer` -> завершаем.
4. Артефакты объединяются:
   - автоматически собранные из `build_table/build_chart`;
   - массивы артефактов из tool-результатов (например, `forecast_metric`);
   - явно присланные моделью в `parsed.artifacts`.
5. Если валидный финал не получен — возвращается fallback-ответ.

## API контракты

## `POST /api/agent`

Запрос:

```json
{
  "question": "Спрогнозируй затраты ТОИР на 3 месяца и покажи график",
  "filters": {
    "period": "all",
    "class": "__all__"
  }
}
```

Ответ:

```json
{
  "ok": true,
  "requestId": "uuid",
  "answer": {
    "fact": "Факты по данным...",
    "conclusion": "Вывод...",
    "action": "Рекомендация..."
  },
  "artifacts": [
    {
      "type": "chart",
      "title": "Топ-5 по затратам",
      "chartType": "bar",
      "categories": ["..."],
      "series": [{ "name": "Затраты", "data": [1, 2, 3] }]
    }
  ],
  "trace": {
    "steps": 3,
    "toolsUsed": ["forecast_metric"],
    "model": "...",
    "forecastModel": "ets_damped",
    "horizon": 3,
    "forecastMetric": "costs_monthly",
    "forecastLatencyMs": 420
  }
}
```

Ошибки:

- `provider_not_configured` — отсутствует API-ключ на сервере;
- `agent_error` — внутренняя ошибка агентного цикла.

## UI и рендер артефактов

Элементы интерфейса:

- `#aiModeToggle` — переключатель `Агент / Быстрый ответ`;
- `#aiArtifacts` — компактный рендер артефактов в sidebar;
- `#agentWorkspace` — расширенный рендер в основной зоне.

Рендер:

- таблицы -> `renderArtifactTable()`;
- графики -> `renderArtifactChart()` + `ToirCharts.renderAgentChart()`;
- кнопка `Развернуть` -> `expandArtifact()`.

Для прогнозных артефактов UI добавляет:

- бейдж `Прогноз` на карточках;
- различение серий `Факт`, `Прогноз`, `Нижний/Верхний интервал`;
- компактное форматирование чисел на оси значений (тыс/млн/млрд).

## Конфигурация

Используются стандартные переменные проекта:

- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`
- `OPENROUTER_FALLBACK_MODEL`
- `OPENROUTER_TIMEOUT_MS`
- `OPENROUTER_HTTP_REFERER`
- `OPENROUTER_APP_TITLE`
- `API_PORT`
- `ALLOWED_ORIGINS`

Минимально для агента обязательно:

- backend запущен;
- доступен `data/toir.json`;
- задан `OPENROUTER_API_KEY`.

## Ограничения и guardrails

- агент не имеет прямого доступа к файловой системе через tools;
- выборка из `query_data` ограничена 1000 строк;
- `build_table`/`build_chart` ограничивают размер артефактов;
- `forecast_metric` ограничивает `horizon` до 12;
- максимальная длина шага и всего цикла ограничена таймаутами;
- при ошибках агента UI переключается на fallback-режим.

## Быстрый smoke test

1. Запустить backend (`npm run start:api`).
2. Открыть дашборд и выбрать режим `Агент`.
3. Задать вопросы:
   - `Какие общие затраты ТОИР?`
   - `Покажи топ-5 объектов по затратам в виде графика`
   - `Сравни май и июнь по затратам и покажи дельту`
   - `Спрогнозируй затраты ТОИР на 3 месяца`
4. Проверить:
   - есть `trace.toolsUsed`;
   - для запросов визуализации приходят `artifacts`;
   - для прогноза в `trace` есть `forecastModel`, `horizon`, `forecastLatencyMs`;
   - кнопка `Развернуть` открывает workspace-карточку.

## Диагностика проблем

Если агент не отвечает:

1. Проверить `GET /health`.
2. Проверить `.env` и наличие `OPENROUTER_API_KEY`.
3. Проверить логи backend (`node server/index.js`).
4. Проверить корректность `data/toir.json`.
5. Переключить на `Быстрый ответ` и убедиться, что базовый путь работает.

Если агент отвечает без артефактов:

1. Убедиться, что вопрос явно просит таблицу или график.
2. Проверить `trace.toolsUsed` — вызываются ли `build_table/build_chart`.
3. Проверить рендер в UI (`#aiArtifacts`, `renderAgentChart`).

## Рекомендации по развитию

- добавить кэширование результатов инструментов внутри одного `requestId`;
- добавить в `trace` длительность каждого шага и каждого инструмента;
- расширить `compute` (rolling average, trend slope, contribution analysis);
- добавить whitelisting полей в `query_data` для более строгого контроля;
- добавить contract-tests для `POST /api/agent` и snapshot-тесты артефактов.

