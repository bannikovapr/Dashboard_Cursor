# 90 — Приёмка дашборда

Финальный промт. Отправьте, когда всё собрано и вы готовы зафиксировать версию.

---

```
Режим: приёмка. Действуй по kit/playbook/07-acceptance.md и
kit/templates/acceptance-checklist.md.

Цель: пройти чек-лист приёмки и подготовить финальный отчёт.

Шаги:

1. Скопируй kit/templates/acceptance-checklist.md в корень моего проекта как
   ACCEPTANCE.md (если его ещё нет).

2. Автоматически закрой всё, что можно проверить скриптами:
   - Валидация data/dashboard.json по kit/templates/dashboard.schema.json.
   - Наличие всех обязательных датасетов и полей
     (source-manifest.yaml -> validation).
   - Совпадение id KPI в metric-catalog.yaml и ключей в dashboard.json -> kpis.
   - ВАЖНО: НЕ сверяй widget.id из ui-layout.yaml с ключами dashboard.json —
     widget.id относится только к UI. Сверяй ИМЕННО bind:
       * для каждой записи tabs[].charts[].bind = "charts.<key>" проверь,
         что dashboard.json.charts[<key>] существует и не пустой;
       * то же для tabs[].tables[].bind = "tables.<key>";
       * то же для любых kind: image с атрибутом src/path.
     Отчёт выводи матрицей: widget.id | bind | присутствует в JSON | не пустой.
     Любое «нет ключа» или «пустой» = FAIL.
   - Для каждой series с forecastable: true проверь, что в
     dashboard.json.charts есть ряд *_forecast со структурой
     { month, actual, forecast, lower, upper } и не пустой forecast-хвост.
   - Для каждого kind: image из ui-layout.yaml и для каждого пути assets/*
     и data/assets/* из dashboard.json проверь существование файла на
     диске. Битая картинка -> FAIL.
   - Smoke-тест прогноза (если включён): npm run smoke:forecast или аналог.
   - Smoke-тест AI (если включён):
       * GET /health -> 200;
       * POST /api/chat с простым вопросом -> валидный ответ;
       * POST /api/agent с «топ-5 … графиком» -> artifacts есть,
         trace.toolsUsed содержит build_chart.
   - Security pipeline (если security-policy.yaml включён, чек-лист §14):
       * GET /health отдаёт mlReady, hardening.dlpKey, hardening.rateLimit,
         hardening.detector; при fail_mode=closed + mlReady=false -> 503;
       * запрос с email/phone -> в chat_model_request только токены
         [[DLP_*_NNNN]], raw PII отсутствует; в ответе фронту значения
         восстановлены;
       * запрос с sk-or-v1-… -> 400 dlp_blocked (strict) или tokenize (monitor);
       * при DLP_ML_FAIL_MODE=closed и недоступной ML -> 503 ml_unavailable;
       * smoke:agent-dlp, smoke:hardening, smoke:filter-trace,
         smoke:security-suite, smoke:failclosed-api — все PASS;
       * логи logs/filter-trace.log, logs/dlp-agent-flow.log,
         logs/security-audit.log — NDJSON, без raw secrets; работает ротация;
       * rate-limit отсекает превышения и имеет разные лимиты для chat и
         agent; bypass_localhost=false для production.
   - UI smoke (headless или вручную по чек-листу §11):
       * dashboard.json грузится с cache: "no-store";
       * прогнозная вкладка отрисовывает все прогнозные графики
         (нет «пустых» карточек);
       * изображение износа/логотипа загружено (naturalWidth > 0);
       * смена фильтра не приводит к одновременному исчезновению всех
         графиков/таблиц на вкладке;
       * консоль браузера чистая при переключении вкладок и фильтров.
   - Гигиена секретов (чек-лист §10):
       * `.gitignore` содержит `.env`, `.env.*`, `!.env.example`;
       * `git check-ignore -v .env` возвращает `.env`;
       * `git status` не показывает `.env`;
       * в исходниках нет реальных значений ключей (sk-…, Bearer …).
       Любое нарушение -> FAIL.
   - Кодировки и кириллица (чек-лист §13):
       * dashboard.json — UTF-8 без BOM, кириллица читается «как есть»;
       * в логе сборки есть строка «Кодировки источников: …»;
       * подписи UI не содержат «?»-символов вместо кириллицы.
   - Детерминированный роутинг агента (чек-лист §12):
       * 10-кратный прогон «топ-5 … графиком» -> во всех 10 ответах
         есть artifacts и build_chart в trace.toolsUsed;
       * ответ на «спрогнозируй … на 3 месяца» содержит artifacts +
         forecast_metric в trace.toolsUsed.
   - Windows-runtime (если запуск на Windows, чек-лист §14):
       * стартовый скрипт не падает на execution policy;
       * перед стартом проверяется/освобождается порт;
       * лог в PowerShell — UTF-8 (chcp 65001).

3. Для пунктов, которые нельзя проверить автоматически, подготовь для меня
   ручной план:
   - адаптивные брейкпоинты (6 точек);
   - визуальная согласованность контролов;
   - правильный язык подписей;
   - 10 приёмочных вопросов ассистенту по интентам из kit/skills/dashboard-assistant
     (kpi_fact, compare_periods, top_n, trend, structure, detail, why_changed,
     forecast, recommendation, unsupported).
   - безопасность (нет секретов в репо, чистая консоль).

4. Обнови ACCEPTANCE.md: отметь автоматически прошедшие пункты, выведи список
   ручных и уточни, что требует внимания.

5. Напиши короткий итоговый отчёт:
   - общее резюме (готов / нужны доработки);
   - список красных пунктов, если есть;
   - рекомендованные дальнейшие действия.

Запрещено:

- Отмечать пункты «ок», если они не были реально проверены.
- Скрывать расхождения чисел между источником и dashboard.json.
- Править код в обход конфигов для прохождения чек-листа.

Если есть доработки — подсказывай мне отправить kit/prompts/99-fix.md с
конкретным описанием проблемы.
```
