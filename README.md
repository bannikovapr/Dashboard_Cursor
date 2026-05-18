# Стратегический дашборд ТОИР

Веб-дашборд для мониторинга и анализа показателей ТОИР на основе девяти обязательных Excel-отчётов (семь по ТОиР и два по персоналу).

Текущая целевая логика проекта:
1. В `data/` лежат семь исходных отчётов Excel по ТОиР и два отчёта по персоналу (см. `scripts/personnel_reports.py`).
2. `scripts/analyze_toir.py` агрегирует их в единый `data/toir.json`.
3. Фронтенд (`index.html` + `js/*`) строит KPI, графики и таблицы.
4. Пользователь задает вопрос в AI-чате.
5. Фронтенд отправляет вопрос + контекст на backend `POST /api/chat`.
6. Backend вызывает OpenRouter LLM и возвращает структурированный ответ: `fact`, `conclusion`, `action`.

## Возможности дашборда

- KPI-блок с ключевыми метриками: затраты, доли, отказы, КТГ, СННО и др.
- Графики по вкладкам:
  - `Сводка`: динамика затрат, структура парка, причины отказов.
  - `Затраты`: динамика, структура работ (труд/материалы), топ объектов, доли по классам.
  - `Надежность`: причины отказов, тренд КТГ, топ СННО (MTBF), топ СВР (MTTR).
  - `Оборудование`: структура парка, износ (изображение), затраты по классам.
- Таблицы:
  - агрегаты по классам оборудования;
  - топ проблемных объектов.
- AI-ассистент:
  - облачный режим через backend/OpenRouter;
  - безопасный локальный fallback в браузере при недоступности облака.
- Кнопка **«Подгрузить свежие данные»** в шапке: снова читает текущий `data/toir.json` с диска и обновляет графики без перезагрузки страницы. Чтобы сам JSON сформировать из Excel, выполните **`npm run build:dashboard:json`** (см. ниже).

## Требования

- Windows + PowerShell.
- Node.js 18+ (рекомендуется 20+).
- Python 3.10+ (для сборки `toir.json` из Excel).
- Доступ к OpenRouter (если нужен облачный AI-режим).

## Структура проекта

- `data/` — исходные отчеты Excel и итоговый `toir.json`.
- `scripts/` — скрипты сборки данных и запуска.
- `server/` — backend API для AI-чата.
- `desktop/` — оболочка Electron (`npm run desktop`, закрытие окна останавливает API).
- `js/`, `css/`, `index.html` — UI дашборда.
- `assets/` — бренд-ресурсы; эталон иконки ярлыка — **`dashboard-icon-master.png`** (≥ ~180 px по длинной стороне), иначе марка из `desnol-mark.svg`.

Ключевые файлы:
- `Launch-TOIR-Dashboard.vbs` — тихий запуск без окна консоли (вызывает `scripts/start-dashboard-quiet.ps1`).
- `scripts/start-dashboard-quiet.ps1` — обёртка со снятием транскрипта в `%TEMP%\toir-dashboard-launch.log`.
- `scripts/create-dashboard-shortcut.ps1` — создание ярлыка на рабочем столе с иконкой `assets/toir-dashboard.ico`.
- `scripts/analyze_toir.py` — основная агрегация данных из Excel.
- `scripts/build-dashboard-json.js` — обертка запуска Python-агрегатора.
- `scripts/start-dashboard.ps1` — основной сценарий старта.
- `scripts/serve.ps1` — локальная раздача статики.
- `desktop/main.js` — Electron: дочерний процесс `server/index.js` и окно с `index.html`.
- `server/index.js` — API-слой (`/health`, `/api/chat`).
- `server/openrouter-client.js` — клиент OpenRouter + нормализация ответа.
- `js/toir-app.js` — UI-логика, фильтры, чат.
- `js/toir-charts.js` — рендер графиков.

## Источники данных

В `data/` должны быть ровно эти 7 отчетов:

1. `Анализ отказов.xlsx`
2. `КТГ.xlsx`
3. `Наработка на отказ.xlsx`
4. `Простой.xlsx`
5. `Процент износа.xlsx`
6. `Список оборудования.xlsx`
7. `Фактические затраты по ОР.xlsx`

Если хотя бы одного файла не хватает, сборка `toir.json` завершится ошибкой.

## Быстрый запуск

### Вариант 1: запуск для пользователя

- Запустите `START_DASHBOARD.cmd`.

Сценарий автоматически:
- проверит зависимости;
- соберет `data/toir.json` из 7 Excel-отчетов;
- поднимет API на `http://localhost:8787`;
- поднимет статический сервер дашборда (по умолчанию `http://localhost:5173`);
- откроет браузер.

### Вариант 2: запуск через PowerShell

```powershell
.\scripts\start-dashboard.ps1
```

Опции:
- `-Port 5173` — порт статического сервера дашборда.
- `-NoRefresh` — запуск без пересборки `data/toir.json`.

Пример:

```powershell
.\scripts\start-dashboard.ps1 -Port 5180 -NoRefresh
```

### Вариант 3: окно Electron (закрытие окна останавливает API)

Подходит, если не хотите оставлять процесс Node API в памяти после закрытия интерфейса: один раз из корня проекта установите зависимости (`npm install`), затем:

```powershell
npm run desktop
```

Electron откроет `index.html` с диска (без отдельного сервера на 5173), а сервер Express поднимется дочерним процессом **Node** на `http://localhost:8787` (порт задаётся `API_PORT` в `.env`). При закрытии окна дочерний API завершается.

**Замечания:** запускайте через `npm run desktop`, чтобы использовался тот же `node`, что и у npm (`npm_node_execpath`). Если по какой-то причине запускаете `electron` вручную, убедитесь, что `node` доступен в `PATH`. Отдельный статический сервер (`scripts/serve.ps1`) для этого варианта не нужен. Если при старте окна возникают редкие проблемы с песочницей renderer на старой ОС, временная отладка — отключить `sandbox: true` в `desktop/main.js` (не для продакшена).

### Ярлык на рабочем столе (без окна консоли)

Для запуска без видимых окон PowerShell и отдельного окна Node (API):

1. В корне проекта лежит **`Launch-TOIR-Dashboard.vbs`**: он вызывает PowerShell с `-WindowStyle Hidden` и сценарием **`scripts/start-dashboard-quiet.ps1`**.
2. Лог вывода при скрытом запуске дописывается в **`%TEMP%\toir-dashboard-launch.log`** (удобно при сбоях).
3. Иконка — **`assets/toir-dashboard.ico`**: `python scripts/build-toir-dashboard-ico.py`. Из баннера «иконка + надпись» можно сделать только марку: **`assets/desnol-logo-banner.png`** → `python scripts/extract-dashboard-mark-from-banner.py` → **`assets/dashboard-icon-master.png`**. Растр для сборки `.ico` используется, если **длинная сторона ≥ ~180 px**; иначе берётся вектор `desnol-mark.svg`.
4. Создать ярлык на рабочем столе с этой иконкой:

```powershell
.\scripts\create-dashboard-shortcut.ps1
```

Ярлык без пересборки `toir.json` при каждом старте:

```powershell
.\scripts\create-dashboard-shortcut.ps1 -NoRefresh
```

Общий рабочий стол всех пользователей (нужны права администратора):

```powershell
.\scripts\create-dashboard-shortcut.ps1 -Scope Common
```

Тот же общий ярлык, но без пересборки JSON: `-Scope Common -NoRefresh`.

Аргумент **`-NoRefresh`** в ярлыке передаётся в `scripts/start-dashboard-quiet.ps1` через `Launch-TOIR-Dashboard.vbs` (проброс `wscript` → PowerShell).

**Останов:** закройте процесс **Windows PowerShell** (или **pwsh**), в котором крутится `serve.ps1`, через диспетчер задач — либо используйте запуск с видимой консолью (`START_DASHBOARD.cmd`), там останов по `Ctrl+C`.

### Запуск без пересборки JSON

- `START_DASHBOARD_NO_BUILD.cmd`
- или `.\scripts\start-dashboard-no-build.ps1`

## Установка и конфигурация

1. Установите Node.js и Python.
2. В корне проекта выполните:

```powershell
npm install
copy .env.example .env
```

3. Откройте `.env` и заполните:

```env
OPENROUTER_API_KEY=your_openrouter_key_here
OPENROUTER_MODEL=google/gemma-4-31b-it:free
OPENROUTER_TIMEOUT_MS=45000
OPENROUTER_HTTP_REFERER=http://localhost:5173
OPENROUTER_APP_TITLE=TOIR Dashboard Assistant
API_PORT=8787
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:5174
DLP_REQUIRE_CONFIGURED_KEY=false
DLP_ALLOW_EPHEMERAL_KEY=true
```

Если ключ не задан, UI продолжит работать, а AI-чат будет отвечать локальным fallback.

### Вход в дашборд (опционально)

В `.env` можно включить единственного локального пользователя: задайте `DASHBOARD_AUTH_ENABLED=true`, `DASHBOARD_AUTH_USER`, `DASHBOARD_AUTH_PASSWORD` и `DASHBOARD_AUTH_SECRET` (не короче 16 символов — случайная строка для подписи токена). После этого при открытии страницы запрашиваются логин и пароль; в рамках сеанса вкладки сохраняется Bearer-токен в `sessionStorage` (после закрытия вкладки вход нужен снова).

Публичные без токена: `GET /health`, `GET /api/auth/status`, `POST /api/auth/login`. Остальные маршруты `/api/*` требуют заголовок `Authorization: Bearer …`.

**Важно:** файл `data/toir.json` при классической схеме по-прежнему отдаётся **статическим** сервером (порт вроде 5173) и не проходит через эту авторизацию. Закрыть данные полностью можно отдельной доработкой (выдача JSON только через API с тем же Bearer), reverse proxy или отключением публичного доступа к каталогу `data/` на статике.

Проверка модуля без поднятого HTTP: `npm run smoke:dashboard-auth`.

## Скрипты

- `npm run build:dashboard:json` — собрать/обновить `data/toir.json` из Excel-отчётов ТОиР.
  - **Как это устроено:** npm вызывает `node scripts/build-dashboard-json.js`. Тот ищет интерпретатор Python (`py -3` или `python`), из корня проекта запускает `scripts/analyze_toir.py` без аргументов.
  - Скрипт проверяет, что в `data/` лежат все обязательные `.xlsx` (семь отчётов ТОиР из `analyze_toir.py` и файлы по персоналу по правилам `personnel_reports.py`), открывает их через **openpyxl**, собирает KPI, графики и таблицы и **перезаписывает** `data/toir.json`. Блоки `personnelUsage` и `personnelOrgUsage` **всегда** заполняются из отчётов персонала.
  - Если Python не найден, не хватает отчёта или `analyze_toir.py` завершился с ошибкой, Node выведет сообщение и завершится с ненулевым кодом — исправьте окружение и запустите команду снова.
- `npm run start:api` — запустить только backend API.
- `npm run smoke:agent-dlp` — smoke-проверка DLP: токенизация/детокенизация и guard-правила.
- `npm run smoke:hardening` — smoke-проверка key providers, DLP negative-cases и rate limit.
- `npm run smoke:filter-trace` — smoke-проверка полноты событий трассировки фильтра + проверка, что в `chat_model_request` не утекают raw email/phone.
- `npm run smoke:dashboard-auth` — модуль входа в дашборд (пароль, HMAC-токен, без HTTP).
- `npm run smoke:security-suite` — расширенный security-набор (crypto, vault, detector, policy, dlp, rate-limit, log-redaction, perf-guard).
- `npm run smoke:failclosed-api` — e2e-проверка fail-closed: при недоступной ML-модели `/api/chat` возвращает `503 ml_unavailable`.
- `npm run smoke:forecast` — smoke-проверка прогнозного инструмента агента.
- `npm run smoke:personnel` — smoke-проверка сценариев по данным сотрудников.
- `npm run logs:check` — проверка консистентности security-логов.
- `npm run ci:hygiene` — объединенный CI-прогон hygiene + smoke-набора безопасности.

## Формат данных `toir.json`

Основные разделы:
- `meta` — мета-информация по источнику и периоду.
- `kpis` — агрегированные KPI.
- `charts` — серии для графиков (`costsByMonth`, `failureCauses`, `materialLaborByMonth`, `mtbfByEquipment`, `mttrByEquipment`, `wearImage` и др.).
- `tables` — данные для табличных блоков (`equipmentCosts`, `ktg`, `equipmentDefects`).
- `analysis` — производные аналитические срезы (топы, пик месяца и т.д.).
- `personnelUsage`, `personnelOrgUsage` — данные по персоналу из обязательных Excel (см. `scripts/personnel_reports.py`); без них `npm run build:dashboard:json` завершится с ошибкой.

`charts.wearImage` хранит относительный путь к изображению износа (например, `assets/generated/wear-report.png`), которое извлекается из отчета `Процент износа.xlsx`.

## AI-ассистент

Подробная документация по агентному режиму вынесена в отдельный файл: `AGENT_README.md`.

### Два режима работы

В UI доступен переключатель:

- **Агент** (по умолчанию) — AI-агент с инструментами: получает данные точечно, считает, строит таблицы/графики.
- **Быстрый ответ** — классический чат (вопрос → текстовый ответ `fact/conclusion/action`).

### Режим «Быстрый ответ»

- UI отправляет запрос в `POST /api/chat` с полями:
  - `question: string`
  - `context: object` (актуальный контекст дашборда)
- Backend валидирует вопрос, вызывает OpenRouter и возвращает:
  - `fact`
  - `conclusion`
  - `action`

Если модель недоступна, фронтенд переходит на локальный `aiAnswer`.

### Режим «Агент»

- UI отправляет запрос в `POST /api/agent` с полями `question` и `filters`.
- Backend запускает ReAct-цикл (до 5 шагов):
  1. LLM получает вопрос + описание инструментов.
  2. LLM решает, какие инструменты вызвать (запрос данных, вычисление, построение графика/таблицы).
  3. Сервер выполняет инструменты и возвращает результаты LLM.
  4. LLM формирует финальный ответ с артефактами.
- Если агент не справился, фронтенд автоматически переключается на режим быстрого ответа.

Инструменты агента:
- `get_kpis` — ключевые показатели.
- `query_data` — выборка из 10 нормализованных наборов данных.
- `compute` — вычисления: sum, avg, min, max, delta, percent, rank, group_by.
- `build_table` — формирование табличного артефакта.
- `build_chart` — формирование спецификации графика (bar, line, pie, donut, area).
- `search_equipment` — полнотекстовый поиск оборудования.
- `forecast_metric` — on-demand прогноз временных рядов (ETS/SARIMAX + fallback) с графиком/таблицей и метриками качества.

### API endpoints

- `GET /health` — проверка состояния API.
- `POST /api/chat` — быстрый чат с LLM.
- `POST /api/agent` — агентный анализ с инструментами.

Пример ответа `POST /api/chat`:

```json
{
  "ok": true,
  "requestId": "uuid",
  "providerModel": "google/gemma-4-31b-it:free",
  "fact": "Фактическое наблюдение...",
  "conclusion": "Вывод по данным...",
  "action": "Рекомендуемое действие..."
}
```

Пример ответа `POST /api/agent`:

```json
{
  "ok": true,
  "requestId": "uuid",
  "answer": {
    "fact": "Факты и цифры...",
    "conclusion": "Вывод...",
    "action": "Рекомендации..."
  },
  "artifacts": [
    {
      "type": "chart",
      "title": "Топ-5 по затратам",
      "chartType": "bar",
      "categories": ["Объект A", "Объект B"],
      "series": [{ "name": "Затраты", "data": [210, 180] }]
    }
  ],
  "trace": { "steps": 3, "toolsUsed": ["query_data", "compute", "build_chart"] }
}
```

### Артефакты

Артефакты (таблицы и графики) отображаются:
- Компактно — в боковой панели AI-ассистента.
- Развёрнуто — в рабочей области над основными таблицами (кнопка «Развернуть»).

### Файлы агента

- `server/agent/data-store.js` — слой данных: загрузка и нормализация `toir.json` в 10 наборов.
- `server/agent/tools.js` — 6 инструментов с JSON-schema описаниями.
- `server/agent/prompts.js` — системный промпт и формат сообщений.
- `server/agent/agent-controller.js` — ReAct-цикл оркестрации.

## Диагностика и частые проблемы

### 1) Не собирается `toir.json`

Проверьте:
- наличие всех 7 Excel-файлов в `data/`;
- наличие Python в PATH (`py -3 --version` или `python --version`);
- корректность структуры отчетов (имена листов должны совпадать с ожидаемыми).

Ручной запуск:

```powershell
node scripts/build-dashboard-json.js
```

### 2) AI-чат не отвечает через облако

Проверьте:
- заполнен ли `OPENROUTER_API_KEY` в `.env`;
- запущен ли backend (`node server/index.js` или `npm run start:api`);
- нет ли ошибок CORS (`ALLOWED_ORIGINS`);
- доступность OpenRouter и лимиты аккаунта.

### 3) UI не открывается/пустой

Проверьте:
- что `scripts/serve.ps1` запущен без ошибок;
- что доступен `data/toir.json`;
- ошибки в консоли браузера и в терминале API.

## Безопасность

- API-ключ OpenRouter хранится только на сервере (`.env`) и не отправляется в браузер.
- Статический сервер ограничивает выдачу файлами внутри рабочей директории.
- Ответ модели нормализуется до фиксированной структуры `fact/conclusion/action`.
- Для агентного режима действует DLP-пайплайн: вход маскируется/блокируется перед отправкой в модель, а ответ восстанавливается перед выводом в UI.

### DLP-правила (актуально)

Секреты (`block`, regex-backstop):
- `regex_secret_openrouter_api_key`
- `regex_secret_generic_api_key`
- `regex_secret_bearer_token`
- `regex_secret_pem`
- `regex_secret_aws_access_key`
- `regex_secret_jwt`

Персональные/чувствительные данные (`tokenize`):
- ML-семантика: `ml_person`, `ml_org`, `ml_location`
- regex-backstop: `regex_email`, `regex_phone`, `regex_equipment_code`

Доменные guard-правила для снижения ложных срабатываний:
- общие названия оборудования (например, `Компрессор центробежный Siemens`) не токенизируются;
- фразы вида `Номер детали ...`, `серийный ...` не должны ошибочно токенизироваться как телефон;
- составные коды вида `INK_SIB_003_COMP_005` токенизируются как `regex_equipment_code`.

Важно:
- на дашборде данные отображаются в восстановленном виде после `restorePayload(...)`;
- запрос блокируется только при срабатывании секретных правил (`secret`), а не PII-токенизации.
- переход на запрет ephemeral-ключа DLP делается поэтапно:
  - текущий релиз: `DLP_ALLOW_EPHEMERAL_KEY=true`, `DLP_REQUIRE_CONFIGURED_KEY=false` (с аудитом/предупреждением);
  - целевой релиз: `DLP_ALLOW_EPHEMERAL_KEY=false`, `DLP_REQUIRE_CONFIGURED_KEY=true`.

Подробная документация по security-пайплайну: `SECURITY_README.md`.

## Краткий workflow для разработчика

1. Обновить Excel-отчеты в `data/`.
2. Выполнить `npm run build:dashboard:json`.
3. Запустить `.\scripts\start-dashboard.ps1`.
4. Проверить UI и AI-чат.
5. При необходимости смотреть логи backend в окне `node server/index.js`.
