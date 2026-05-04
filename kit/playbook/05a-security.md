# 05a. Безопасность — DLP, rate-limit, fail-closed, аудит

Этот шаг — обязательный для production, опциональный для черновика. Даже
если вы НЕ включаете AI-ассистента, нужная вам как минимум часть: rate-limit и
безопасное логирование. Если AI включён — нужен полный набор.

Источник истины: `kit/skills/security-builder/SKILL.md`. Здесь — пошагово.

## Когда выполнять

- Сразу после `05-ai-assistant.md`, до `07-acceptance.md`.
- Если AI выключен и фронт чисто статический — всё ещё нужен периметр входа
  (CORS, rate-limit, аудит).

## Что вам понадобится

- Заполненный `brand.config.yaml` и `metric-catalog.yaml` (язык/локаль,
  `assistant.enabled`).
- Решение, какой ML-движок использовать (для NER) или строго regex-only.
- Решение, какой провайдер ключа использовать (`env`/`vault`/`kms`).
- Понимание целевого режима политики:
  - `strict` (production),
  - `monitor` (canary, никого не блокируем, только наблюдаем),
  - `off` (только для отладки).

## Процедура

### Шаг 1. Заполните `security-policy.yaml`

Скопируйте `kit/templates/security-policy.example.yaml` в корень проекта как
`security-policy.yaml`. Минимум, что нужно решить:

```yaml
mode: "strict"             # production-default
fail_mode: "monitor"       # на старте; через 1-2 релиза перевести в "closed"
key_provider:
  preferred: "auto"
  require_configured: false   # production: true
  allow_ephemeral: true       # production: false
detector:
  ml:
    enabled: true
    model: "Xenova/bert-base-multilingual-cased-ner-hrl"
  regex_backstop:
    enabled: true
rate_limit:
  enabled: true
  bypass_localhost: false
  routes:
    chat:  { max: 60, window_ms: 60000 }
    agent: { max: 30, window_ms: 60000 }
```

### Шаг 2. Отправьте промт `prompts/45-setup-security.md`

Агент читает `kit/skills/security-builder/SKILL.md` и `security-policy.yaml`
и:

1. Создаёт каталог `server/security/` (или эквивалент в Python/Go) со всеми
   модулями: `dlp-service`, `secret-policy`, `crypto`, `token-vault`,
   `rate-limit`, `log-utils`, `audit-log`, `filter-trace-log`,
   `agent-chat-flow-log`, `detector/{ner-engine,regex-backstop,index}`.
2. Интегрирует DLP в маршруты `/api/chat` и `/api/agent` строго в
   правильном порядке:
   - валидация запроса,
   - rate-limit,
   - `protectPayload`,
   - вызов LLM,
   - `restorePayload`,
   - аудит + filter-trace,
   - возврат фронту.
3. Добавляет fail-closed гейт:
   - в `protectPayload` — на основании `mlReady` + `fail_mode`;
   - на `/health` — поле `mlReady`, `503` при `closed+notReady`;
   - в маршрутах: `503 ml_unavailable` вместо `400 dlp_blocked` для
     ML-причины.
4. Добавляет `.env.example` со всеми ключами (без значений) и обновляет
   `.gitignore` (`.env`, `.env.*`, `!.env.example`, `logs/*`).
5. Добавляет smoke-набор:
   - `smoke:agent-dlp`,
   - `smoke:hardening`,
   - `smoke:filter-trace`,
   - `smoke:security-suite`,
   - `smoke:failclosed-api`,
   - объединяет их в `ci:hygiene`.

### Шаг 3. Проверьте «руками» три ключевые точки

- **PII не уходит в модель.** Запрос с email и телефоном →
  `chat_model_request` показывает токены `[[DLP_REGEX_EMAIL_*]]` /
  `[[DLP_REGEX_PHONE_*]]`, а не сами значения.
- **Секрет блокируется.** Запрос с `sk-…` → ответ `400 dlp_blocked` (или
  `tokenize` в `monitor`).
- **Fail-closed.** На `DLP_ML_FAIL_MODE=closed` и недоступной модели → API
  отвечает `503 ml_unavailable`.

### Шаг 4. Подготовьте production-rollout ключа

Stage-1 (canary):

- `DLP_REQUIRE_CONFIGURED_KEY=false`,
- `DLP_ALLOW_EPHEMERAL_KEY=true`,
- алертинг по `dlp_ephemeral_key_active`.

Stage-2 (production):

- `DLP_REQUIRE_CONFIGURED_KEY=true`,
- `DLP_ALLOW_EPHEMERAL_KEY=false`,
- сервис fail-closed на старте, если ключа нет.

## Что должно работать после шага

| Проверка                                    | Что ожидаем                                     |
| ------------------------------------------- | ----------------------------------------------- |
| `GET /health`                               | `200`, поле `mlReady`, сводка hardening         |
| `POST /api/chat` с email/phone              | `200`, в `chat_model_request` только токены     |
| `POST /api/chat` с `sk-or-v1-…`             | `400 dlp_blocked` (strict) / tokenize (monitor) |
| `POST /api/chat` (ML required, ML off)      | `503 ml_unavailable`                            |
| `npm run smoke:security-suite`              | все кейсы PASS                                  |
| `npm run smoke:filter-trace`                | все события + нет raw PII в `chat_model_request`|
| `npm run smoke:failclosed-api`              | `503 ml_unavailable`                            |
| `git status` после `node server/index.js`   | `.env` НЕ в untracked-to-commit                 |

## Частые ошибки

- **Запрос валидируется, но rate-limit стоит ПОСЛЕ DLP.** Должно быть
  наоборот: ratelimit отсекает злоупотребления до дорогостоящего DLP.
- **Логи без `sanitize`.** Любой `console.log(req.body)` — это потенциальный
  слив. Используйте `sanitizeForLog` (или эквивалент) перед записью.
- **Token TTL слишком большой.** 15 минут — нормально, час — слишком много;
  vault-storage растёт.
- **Нет `dispose()` в `finally`.** При исключении токены остаются в памяти
  до сборки мусора.
- **Раздача детальных данных скрывается от пользователя.** Цель DLP —
  скрыть данные **от модели**, не от пользователя. На дашборде после
  `restorePayload` всё снова видно.

## Critical paths для расследования инцидента

1. По `requestId` найти запись в `filter-trace.log` → видим, на каком этапе
   запрос остановился.
2. В `dlp-agent-flow.log` (для агента) сверить `back_to_model` — что именно
   ушло в LLM (только токены).
3. В `security-audit.log` посмотреть `errorCode` / `failureReason`.
4. Проверить `restoredCount` / `missingTokens` / `decryptErrors`.
5. На `/health` подтвердить статус ML и провайдера ключа.

PowerShell-команды:

```powershell
Get-Content .\logs\filter-trace.log    | Select-String '"requestId":"<ID>"'
Get-Content .\logs\dlp-agent-flow.log  | Select-String '"requestId":"<ID>"'
Get-Content .\logs\security-audit.log  | Select-String '"requestId":"<ID>"'
```

## Definition of Done

- `security-policy.yaml` заполнен и закоммичен (без секретов).
- Все компоненты, описанные в `kit/skills/security-builder`, развёрнуты или
  отключены с обоснованием в `security-policy.yaml`.
- В `package.json`/`pyproject.toml` есть smoke-команды и они подключены к
  `ci:hygiene`.
- На `/health` виден `mlReady`.
- 3 ручные проверки (PII / secret / fail-closed) пройдены.
- В репозитории нет `.env`; есть `.env.example`.

## Следующий шаг

`prompts/90-acceptance.md` — приёмка. В ней теперь чек-лист §15 «Security
pipeline» проверяется автоматически.
