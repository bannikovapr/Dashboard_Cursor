---
name: security-builder
description: Use this skill when adding the security pipeline to a dashboard backend (DLP, secret-policy, key provider, rate-limit, audit logging, fail-closed gate). Stack-agnostic (Node/Python/Go). Triggers "настрой безопасность дашборда", "добавь DLP", "защити чат от утечек ключей и PII", "fail-closed для AI".
---

# Security Builder — универсальный паттерн безопасности

Эта инструкция описывает, как встроить в дашборд слой безопасности поверх
контракта `dashboard.json` и API-агента (`/api/chat`, `/api/agent`). Реализация
независима от языка и фреймворка бэкенда — важен набор компонентов, контракт
событий и правила, а не код.

Если кратко, задачи слоя безопасности:

1. Не дать секретам и персональным данным утечь во внешний LLM/в логи.
2. Ограничить злоупотребление API частотой запросов.
3. Сделать инцидент воспроизводимым через структурированные логи.
4. Сохранить работоспособность API при сбоях отдельных механизмов
   (best-effort logging, fail-mode, fallback на быстрый чат).

## Архитектура

```
                 ┌──────────────────────────────────────┐
 UI (chat) ───▶  │  /api/chat  /api/agent               │
                 │                                      │
                 │  1. CORS + body limit + validation   │
                 │  2. rate-limit (per route, per IP)   │
                 │  3. DLP.protectPayload(...)          │  ◀── detector(text)
                 │     ├── secrets  → block (or token.) │       ├── ML NER
                 │     └── PII      → tokenize          │       └── regex backstop
                 │  4. forward to LLM (only tokens)     │
                 │  5. DLP.restorePayload(answer)       │
                 │  6. audit + filter-trace + flow log  │
                 └──────────────────────────────────────┘
                          ▲                ▲
                          │                │
                  token vault (TTL)   crypto (AES-256-GCM)
                          ▲
                  key provider (env|vault|kms)
```

## Компоненты (стек-независимо)

### 1. DLP-сессия

Создаётся на каждый запрос: `createSession({ requestId })`. Имеет два метода:

- `protectPayload(payload)` — рекурсивно проходит по строкам payload, прогоняет
  их через детектор, и для каждого матча решает: `block` или `tokenize`.
- `restorePayload(payload)` — после ответа модели подставляет оригинальные
  значения вместо токенов вида `[[DLP_<TYPE>_<NNNN>]]`.

Контракт ответа `protectPayload`:

```json
{
  "ok": true | false,
  "blockedBy": "regex_secret_*|ml_unavailable|null",
  "blockedClassification": "secret|pii|ml_unavailable|null",
  "payload": "<санитизированный payload>",
  "summary": {
    "enabled": true,
    "policy": { "version": "...", "mode": "strict|monitor|off" },
    "totalDetections": 0,
    "tokensCreated": 0,
    "byType": { "<ruleId>": <count> },
    "byClassification": { "secret": 0, "pii": 0 },
    "bySource": { "ml": 0, "regex": 0 }
  }
}
```

### 2. Detector (ML-first + regex-backstop)

Источники матчей объединяются в одном фасаде `detector.detect(text, ctx)`:

- **ML-движок (рекомендуется)** — token-classification из локальной NER-модели.
  Базовый выбор — `Xenova/bert-base-multilingual-cased-ner-hrl` (через
  `@xenova/transformers` для Node) либо локальный ONNX-runtime / Python
  `transformers` / spaCy для других стеков. Производит классы `PER/ORG/LOC`,
  которые маппятся в `ml_person`, `ml_org`, `ml_location`.
- **Regex backstop** — детерминированное покрытие, которое всегда работает,
  даже если ML отвалилась. Минимальный набор:
  - `regex_secret_openrouter_api_key`
  - `regex_secret_generic_api_key`
  - `regex_secret_bearer_token`
  - `regex_secret_pem`
  - `regex_secret_aws_access_key`
  - `regex_secret_jwt`
  - `regex_email`
  - `regex_phone` (с context-guard: positive/negative ключевые слова)
  - `regex_equipment_code` (или другой структурный код домена)

Детектор объединяет спаны и разрешает пересечения по приоритетам:

- секреты (block): 270–300;
- ML PII (`ml_person`/`ml_org`/`ml_location`): 166–170;
- regex PII (`regex_email`/`regex_phone`/`regex_equipment_code`): 120–165.

При желании можно добавить guard-словари для подавления ложноположительных
срабатываний (например, общие названия оборудования, которые могут быть
перепутаны с ФИО).

### 3. Secret policy

Один файл с режимами:

- `strict` — секреты блокируются (default action `block`).
- `monitor` — секреты детектируются, но «понижаются» до tokenize (rollout-режим).
- `off` — fallback-action как есть (для отладки).

Каждое правило имеет:

```yaml
classification: "secret | pii | unknown"
defaultAction:  "block | tokenize"
severity:       "low | medium | high | critical"
```

### 4. Crypto + key provider

- AES-256-GCM, `iv 12 bytes`, `tag 16 bytes`, `aad = "<requestId>:<token>"`.
- Источники ключа: `env`, `vault`, `kms`, `auto` (поиск по порядку).
- Управляющие флаги:
  - `DLP_KEY_PROVIDER`,
  - `DLP_REQUIRE_CONFIGURED_KEY` — если `true`, без сконфигурированного ключа
    сервис обязан fail-closed на старте;
  - `DLP_ALLOW_EPHEMERAL_KEY` — переходный флаг (только для dev/canary).
- Ephemeral-ключ должен сопровождаться warn-event `dlp_ephemeral_key_enabled`.

### 5. Token vault

In-memory key/value `requestId+token → encrypted+dataType+expiresAt`.

- TTL по умолчанию 15 мин (`DLP_TOKEN_TTL_SEC`).
- `dispose()` (или `clearRequest`) обязательно вызывается в `finally` после
  `restorePayload`.
- Для multi-instance окружений переноси в Redis с тем же контрактом ключей.

### 6. Rate limit

- Раздельные лимиты по маршрутам: `chat`, `agent`.
- Окно времени (`windowMs`) + лимит (`max`).
- `RATE_LIMIT_BYPASS_LOCALHOST=true` допустим только для dev.
- IP не пишется в логи в открытом виде — используй digest.

### 7. Fail-closed gate

Когда детектор требует ML, но ML не загружена:

- `DLP_ML_FAIL_MODE=closed` → `protectPayload` возвращает
  `ok=false, blockedBy="ml_unavailable"`, маршруты отвечают **`503`** с
  `errorCode="ml_unavailable"`.
- `DLP_ML_FAIL_MODE=monitor` → запрос пропускается (regex-backstop остаётся),
  но в audit-log пишется warn-event.
- `/health` отдаёт поле `mlReady` и в `closed`-режиме при `mlReady=false`
  возвращает `503`.

### 8. Безопасное логирование

Три канала, у каждого свой жанр:

- `filter-trace.log` — транспорт по запросу (`*_request_received`,
  `*_dlp_protect_result`, `*_model_request`, `*_model_response`,
  `*_dlp_restore_result`, `*_response_to_dashboard`).
- `dlp-agent-flow.log` (только для агента) — этапы цикла: `front_to_back`,
  `back_to_model`, `model_to_back`, `back_to_front`.
- `security-audit.log` — события эксплуатации (приём, блокировки,
  provider-ошибки, успешные ответы) с digest-полями.

Перед записью обязательна `sanitize`:

- редакт по типам в строках: email, api-key, Bearer, JWT, phone, card (Luhn);
- редакт по чувствительным ключам: `password`, `api_key`, `token`, `secret`, …;
- ограничение глубины, длины, числа элементов;
- ротация: daily + size cap; max-files лимитируется.

## Что должно появиться в результате

Минимум, по которому security-слой считается «развёрнутым»:

1. Модули в `server/security/`:
   - `dlp-service.js` (или эквивалент): `createSession({ requestId })`.
   - `secret-policy.js`: режим, политика по правилам.
   - `crypto.js`: AES-256-GCM + key provider.
   - `token-vault.js`: in-memory store (или Redis).
   - `rate-limit.js`: per-route + per-IP лимитер.
   - `log-utils.js`: sanitize/redact + ротация.
   - `audit-log.js`, `filter-trace-log.js`, `agent-chat-flow-log.js`.
   - `detector/` с подмодулями `regex-backstop`, `ner-engine`, `index.js`.
2. В API-роутах:
   - `/health` отдаёт `mlReady` + сводку hardening.
   - `/api/chat` и `/api/agent` интегрируют DLP и rate-limit (см. порядок
     в `playbook/05a-security.md`).
3. Декларативная политика — в проекте лежит файл `security-policy.yaml`
   (см. `kit/templates/security-policy.example.yaml`).
4. CI-проверка (smoke-набор):
   - `smoke:agent-dlp` — токенизация/restore + guard-негативы.
   - `smoke:hardening` — key providers, DLP negative cases, rate-limit, fail-closed
     гейт детектора при недоступной ML.
   - `smoke:filter-trace` — наличие всех событий + контроль отсутствия raw PII
     в `chat_model_request`.
   - `smoke:security-suite` — расширенный набор (crypto/vault/regex/detector/policy/dlp/rate-limit/log-utils + perf-guards).
   - `smoke:failclosed-api` — e2e: API возвращает `503 ml_unavailable` при
     недоступном ML.

## Конфигурация политики (декларативно)

Контракт описан в `kit/templates/security-policy.example.yaml`. Главное:

```yaml
mode: "strict"          # strict | monitor | off
fail_mode: "monitor"    # closed | monitor | open
key_provider:
  preferred: "auto"     # auto | env | vault | kms
  require_configured: false
  allow_ephemeral: true
detector:
  ml:
    enabled: true
    model: "Xenova/bert-base-multilingual-cased-ner-hrl"
    thresholds: { ml_person: 0.6, ml_org: 0.7, ml_location: 0.7 }
  regex_backstop:
    enabled: true
rate_limit:
  enabled: true
  bypass_localhost: false
  routes:
    chat:  { max: 60,  window_ms: 60000 }
    agent: { max: 30,  window_ms: 60000 }
logging:
  filter_trace:    { enabled: true, redact: true }
  agent_flow:      { enabled: true, redact: true, model_io_verbose: false }
  audit:           { enabled: true }
  rotate:
    max_bytes: 5242880    # 5 MB
    max_files: 14
    daily: true
```

Агент по этому файлу проставляет соответствующие `.env`-переменные и
прошивает значения в код security-модулей.

## Поведение при типовых входах

| Вход                                            | Срабатывает                | Действие  |
| ----------------------------------------------- | -------------------------- | --------- |
| `Иванов Иван Иванович`                          | `ml_person`                | tokenize  |
| `ООО Гефест`                                    | `ml_org`                   | tokenize  |
| `petrov.service@corp.ru`                        | `regex_email`              | tokenize  |
| `+7 999 123 45 67` (рядом «телефон/контакт»)    | `regex_phone`              | tokenize  |
| `Номер детали 1234567890` (negative context)    | —                          | пропуск   |
| `INK_SIB_003_COMP_005`                          | `regex_equipment_code`     | tokenize  |
| `sk-or-v1-XXXXXXXXXXXXXXXXX`                    | `regex_secret_openrouter_api_key` | **block** |
| `BEGIN PRIVATE KEY … END PRIVATE KEY`           | `regex_secret_pem`         | **block** |
| `Bearer eyJ…`                                   | `regex_secret_bearer_token` или `regex_secret_jwt` | **block** |
| Любой существующий `[[DLP_*_NNNN]]`             | guard                      | не трогается |

## Definition of Done

- Все 8 компонентов реализованы (или явно отключены в политике с обоснованием).
- На запрос с PII: в логе `chat_model_request` (или `back_to_model`) **нет**
  raw email/phone/ФИО — только токены.
- На запрос с секретом: маршрут отвечает `400 dlp_blocked` (в `strict`) или
  токенизирует (в `monitor`); событие `*_dlp_blocked` есть в audit-log.
- При недоступной ML и `fail_mode=closed` — `/api/chat` и `/api/agent` отвечают
  `503 ml_unavailable`; `/health` тоже `503`.
- Smoke-набор проходит:
  `smoke:agent-dlp`, `smoke:hardening`, `smoke:filter-trace`,
  `smoke:security-suite`, `smoke:failclosed-api`.
- Логи структурированы (NDJSON), ротируются и не содержат raw secrets.

## Anti-patterns (НЕ делаем)

- Логировать сырые payload без `sanitize` («поле просто скопировали в audit»).
- Хранить ключ в коде/конфиге, а не в `env`/`vault`/`kms`.
- Делать ephemeral-ключ постоянным («на это сейчас нет времени»).
- Использовать только regex без ML-PII (бизнес-имена не покрываются).
- Использовать только ML без regex-backstop (секреты обязательно регэкспом,
  чтобы не зависеть от модели).
- Скрывать детальные строки **от пользователя** при срабатывании DLP — DLP
  должен скрывать данные **только от модели**, на дашборде они видны
  через `restorePayload`.
- Делать единый общий лимит для `chat` и `agent` — у них разные стоимости.
