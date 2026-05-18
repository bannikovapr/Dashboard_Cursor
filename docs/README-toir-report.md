# Отчёт по ТОиР (вкладка «Отчёт ТОиР»)

Описание формирования отчёта, API, хранения и ограничений.

## Назначение

**Отчёт ТОиР** — это структурированный документ из **секций** (Markdown-текст, факт-буллеты, ссылки на типы доказательств). Он строится из того же агрегата **`data/toir.json`**, что и дашборд, с учётом выбранных **фильтров** (период, класс оборудования).

Первая версия отчёта создаётся **шаблонами** по **fact pack** (без генерации всего текста нейросетью). Правки текста и структуры возможны **вручную** в UI и **по инструкции** ассистента (план операций через модель или эвристику).

## Предварительные условия

1. Файл **`data/toir.json`** должен существовать (сборка: **`npm run build:dashboard:json`**, см. [README.md](../README.md)).
2. Запущен **backend** (`npm run start:api` или `npm run desktop`), чтобы UI мог вызывать HTTP API.
3. Во фронте задан базовый URL API: **`window.TOIR_API_URL`** в [index.html](../index.html) (по умолчанию `http://localhost:8787/api/chat` — отчёты используют тот же origin для `/api/reports`).

## Каталог секций и обязательные блоки

Список секций и флаги «обязательная» заданы в [`server/reports/config.js`](../server/reports/config.js) (`REPORT_SECTION_CATALOG`).

**Обязательные** секции (должны остаться в документе): например **`passport`** (паспорт отчёта и срез) и **`data_limitations`** (ограничения данных). Остальные секции можно менять или удалять в рамках правил валидации.

## Жизненный цикл документа (API)

Базовый префикс: **`/api/reports`** (роутер [`server/reports/router.js`](../server/reports/router.js)).

| Метод | Назначение |
|--------|------------|
| `GET /api/reports` | Список отчётов, каталог секций, список обязательных id. |
| `POST /api/reports` | Создать отчёт: тело `{ title?, filters? }`, фильтры — как у дашборда (`period`, `class`). |
| `GET /api/reports/:id` | Полный документ. |
| `PUT /api/reports/:id` | Сохранить ручную правку (`title`, `sections`). |
| `POST /api/reports/:id/drafts` | Запрос **инструкции** для AI-плана правок (текст проверяется **DLP**; лимит запросов отдельный, см. `.env.example`). |
| `POST /api/reports/:id/drafts/:draftId/apply` | Применить черновик (операции над секциями). |
| `POST /api/reports/:id/undo` | Откат последней ревизии. |
| `POST /api/reports/:id/refresh_snapshot` | Пересчитать `snapshot` и `fact_pack` из текущего `toir.json` (текст секций не перегенерируется автоматически — в UI показывается предупреждение). |
| `GET /api/reports/:id/export/docx` | Выгрузка DOCX. |
| `GET /api/reports/:id/export/pdf` | Выгрузка PDF. |
| `DELETE /api/reports/:id` | Удалить отчёт. |

События безопасности по правкам отчёта пишутся в **security audit** (см. `REPORT_AI_*`, `report_edit_*` в `.env.example`).

## Как формируется содержимое

1. **Загрузка данных** — чтение `data/toir.json` на сервере ([`server/reports/service.js`](../server/reports/service.js)).
2. **Снимок и факты** — `facts.buildSnapshot` / `facts.buildFactPack` с фильтрами ([`server/reports/facts.js`](../server/reports/facts.js)); в пакет попадают KPI, сводки диагностик, персонал, топы объектов и т.д.
3. **Секции** — начальная генерация через **`section-templates.js`** (`buildFallbackSections`): шаблонный Markdown по fact pack.
4. **Валидация** — обязательные секции, непустой `body_markdown`, уникальные `section_id`.
5. **Сохранение** — каталог по умолчанию **`.reports`** в корне репозитория (`REPORTS_STORAGE_DIR` в `config.js`).

Первичное создание **без LLM**; JSON-план операций для черновиков — через OpenRouter при наличии ключа и включённой настройке (см. `.env.example`: `REPORT_AI_EDIT_ENABLED`, `OPENROUTER_*`).

## Аудит и сопутствующие события

- Инструкции к **`POST /api/reports/:id/drafts`** проходят ту же линию **DLP**, что и поле `question` в чате (политика проекта).
- Открытие/закрытие дашборда в контексте API может логироваться отдельным событием **`dashboard_lifecycle`** ([`server/index.js`](../server/index.js)) — см. основной README.

## Локальная проверка

- Smoke по отчётам: **`npm run smoke:reports`** ([`scripts/smoke-reports.js`](../scripts/smoke-reports.js)).

## См. также

- Диагностики (гипотезы, используемые в сводках и шаблонах): [README-diagnostics.md](README-diagnostics.md)
- Общая документация проекта: [README.md](../README.md)
