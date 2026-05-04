# Система Безопасности TOIR API

Этот документ описывает текущую реализацию безопасности в проекте TOIR Dashboard (backend `server/`), включая гибридный DLP-детектор (Sprint 5) и staged-hardening ключа DLP.

## 1. Цели системы

Слой безопасности решает четыре задачи:

1. Не допустить утечку секретов и персональных данных в модель и во внешние каналы.
2. Ограничить злоупотребление API по частоте запросов.
3. Сделать расследование инцидентов воспроизводимым через структурированные логи.
4. Сохранить работоспособность API при сбоях отдельных механизмов (best-effort logging, fallback-пути).

## 2. Карта модулей

Ключевые файлы безопасности:

- `server/index.js` - оркестрация security-пайплайна в `/api/chat` и `/api/agent`.
- `server/security/dlp-service.js` - DLP-движок: детекция, блокировка, токенизация, восстановление.
- `server/security/secret-policy.js` - политика режимов `strict | monitor | off`.
- `server/security/crypto.js` - шифрование токенов AES-256-GCM + выбор key provider.
- `server/security/token-vault.js` - временное in-memory хранилище шифротокенов.
- `server/security/rate-limit.js` - лимитирование запросов по окнам времени.
- `server/security/log-utils.js` - санитаризация, редактирование, ротация логов.
- `server/security/filter-trace-log.js` - подробный технический трейс пайплайна запроса.
- `server/security/agent-chat-flow-log.js` - трейс этапов агентного цикла.
- `server/security/audit-log.js` - аудит-события и digest-поля.
- `server/security/detector/` - гибридный детектор (`dictionary-index.js`, `morph-fio.js`, `structural.js`, `ner-engine.js`, `index.js`).

## 3. Периметр входа запроса

До запуска бизнес-логики запрос проходит базовый периметр:

1. CORS whitelist: допускаются только разрешенные origin.
2. Ограничение JSON body: `50mb`.
3. Валидация `question`:
   - строка,
   - не пустая,
   - длина не более 4000 символов.

Если валидация не проходит, запрос завершается кодом `400 invalid_request`.
## 4. Hardening-слой (текущая версия)

На текущий момент hardening включает rate limit (canary-слой удален).

Что делает rate limit:

1. Поддерживает отдельные лимиты для `chat` и `agent` маршрутов.
2. Работает по окну времени (`windowMs`) и лимиту (`max requests`).
3. Может обходиться для localhost (`RATE_LIMIT_BYPASS_LOCALHOST=true`) в dev-сценариях.
4. Не хранит открытый IP в логах: для ключа используется digest.

При превышении лимита API возвращает `429 rate_limited` и завершает запрос до DLP/LLM.

## 5. DLP: детекция, блокировка, токенизация

### 5.1. Общий принцип

Для каждого запроса создается отдельная DLP-сессия (`createSession({ requestId })`).

Входной payload проходит `protectPayload(...)`:

- секреты классификации `secret` могут блокировать запрос,
- PII классификации `pii` токенизируется,
- структура payload сохраняется (замены происходят только в строковых фрагментах).

### 5.2. Источники матчей (Sprint 6: ml-all)

Архитектура детектора — **ML-first с regex-backstop**:

- ML-движок (`server/security/detector/ner-engine.js`) на базе `@xenova/transformers` (token-classification) — единственный источник семантических PII (`ml_person`, `ml_org`, `ml_location`).
- Regex-backstop (`server/security/detector/regex-backstop.js`) — детерминированное покрытие секретов и структурных PII:
  - Секреты (block): `regex_secret_openrouter_api_key`, `regex_secret_generic_api_key`, `regex_secret_bearer_token`, `regex_secret_pem`, `regex_secret_aws_access_key`, `regex_secret_jwt`.
  - PII (tokenize): `regex_email`, `regex_phone` (с positive/negative context guard), `regex_equipment_code` (с path/structure guard).

Спаны от ML и regex объединяются в `detector/index.js` через дедупликацию по приоритетам:

- секреты (block): 270-300,
- ML PII (`ml_person`/`ml_org`/`ml_location`): 166-170,
- regex PII (`regex_email`/`regex_phone`/`regex_equipment_code`): 120-165,
- (зарезервировано) `ml_email`/`ml_phone`/`ml_equipment_code`/`ml_secret`: 125-270, на случай перехода на zero-shot модель (GLiNER) в Phase 2.

Управляющие флаги (`.env`):

- `DLP_ML_ENABLED` (по умолчанию `true`) — главный kill-switch ML-слоя.
- `DLP_ML_BACKEND` — `transformers` (текущий) или `gliner` (Phase 2, требует ONNX-экспорт, см. `models/README.md`).
- `DLP_ML_MODEL` — id модели на HuggingFace; по умолчанию `Xenova/bert-base-multilingual-cased-ner-hrl`.
- `DLP_ML_FAIL_MODE` — `monitor` (Phase 1, не блокировать при недоступной ML) или `closed` (Phase 2, блокировать PII-маршруты).
- `DLP_ML_THRESHOLDS` — JSON с порогами по `ruleId` (например `{"ml_person":0.6,"ml_org":0.7}`).
- `DLP_ML_THRESHOLD` — общий fallback-порог.
- `DLP_ML_WARMUP_TIMEOUT_MS`, `DLP_ML_TIMEOUT_MS`, `DLP_ML_MAX_CHARS` — управление загрузкой/инференсом.
- `DLP_REGEX_BACKSTOP_ENABLED` (по умолчанию `true`) — отключать только для ML-only экспериментов.

Жёсткие списки (`FIO_NON_PERSON_WORDS`, `GENERIC_EQUIPMENT_WORDS`, `GENERIC_INSTALLATION_TAIL_WORDS`, `INSTALLATION_INTENT_WORDS`, `PHONE_CONTEXT_*`) сохранены **только** как guard-фильтры false positives ML и больше не используются как источник матчей.

Источники Sprint 5 (`dictionary_*`, `morph_fio`, `structural_*`, `ner_*`) перенесены в `server/security/detector/legacy/` и больше не подключаются. `secret-policy.js` сохраняет их IDs как backward-compat алиасы для чтения старых логов и токенов.

Примеры ожидаемого поведения:

- `Иванов Иван Иванович` -> токенизируется как `ml_person`.
- `ООО Гефест` -> `ml_org` (или `ml_location` для географических объектов).
- `petrov.service@corp.ru` -> `regex_email` -> tokenize.
- `+7 999 123 45 67` -> `regex_phone` -> tokenize.
- `INK_SIB_003_COMP_005` -> `regex_equipment_code` -> tokenize.
- `sk-or-v1-EXAMPLE` (полный ключ длиной 16+ символов) -> `regex_secret_openrouter_api_key` -> **block**.
- блок `BEGIN PRIVATE KEY` ... `END PRIVATE KEY` (PEM) -> `regex_secret_pem` -> **block**.
- `Bearer eyJhbGciOi…` (полный JWT) -> `regex_secret_bearer_token` или `regex_secret_jwt` -> **block**.
- существующие DLP-токены вида `[[DLP_*_0001]]` не пересчитываются повторно.

### 5.2.1. Fail-closed гейт

Если `DLP_ML_FAIL_MODE=closed` и ML-движок не загрузился (`mlReady=false`), `protectPayload` возвращает `blockedBy="ml_unavailable"`, а маршруты `/api/agent` и `/api/chat` отвечают `503` с `errorCode="ml_unavailable"`. В режиме `monitor` запрос пропускается с предупреждением в audit-log; покрытие гарантируется regex-backstop'ом.

`/health` возвращает поле `mlReady` и подробности (`ml.loadMs`, `ml.lastInferenceMs`, `failMode`) в `hardening.detector`. При `failMode=closed` и `mlReady=false` `/health` отвечает `503`.

### 5.3. Политика режимов

`secret-policy.js` поддерживает режимы:

1. `strict` - секреты блокируются.
2. `monitor` - секреты детектируются, но переводятся в tokenize-поведение.
3. `off` - применяется fallback-логика без policy-override.

## 6. Криптослой и хранилище токенов

### 6.1. Как работает токенизация

При токенизации PII:

1. Фрагмент заменяется на токен вида `[[DLP_TYPE_0001]]`.
2. Оригинал шифруется (`encryptText`) с AAD `requestId:token`.
3. Шифротекст кладется во `vault` с TTL.

После ответа модели выполняется `restorePayload(...)`:

- токены ищутся регулярным выражением,
- для каждого токена выполняется decrypt,
- результат подставляется обратно в ответ.

`restorePayload(...)` поддерживает не только каноническую форму `[[DLP_*]]`, но и варианты ссылок (`DLP_*`, escaped underscore и разные регистры), выполняя несколько проходов восстановления (по умолчанию до `DLP_RESTORE_MAX_PASSES=3`).

Важно для UI:

- в LLM передаются токены, а не оригинальные PII;
- во фронтенд (`response_to_dashboard`) уходит уже восстановленный payload, поэтому данные в дашборде отображаются в исходном виде;
- в логах значения могут выглядеть редактированными (`[redacted_*]`) из-за sanitize/redaction-слоя, это нормальное поведение.

### 6.2. Источники ключей

`crypto.js` поддерживает провайдеры:

- `env`,
- `vault`,
- `kms`,
- `auto` (поиск по порядку).

Если настроенных ключей нет, возможен ephemeral-ключ (если это не запрещено флагами).

Ключевые флаги:

- `DLP_REQUIRE_CONFIGURED_KEY`,
- `DLP_ALLOW_EPHEMERAL_KEY`,
- `DLP_KEY_PROVIDER`.

### 6.1. Staged hardening DLP ключа

Рекомендуемый rollout:

1. Release N (переходный):
   - `DLP_REQUIRE_CONFIGURED_KEY=false`
   - `DLP_ALLOW_EPHEMERAL_KEY=true`
   - аудит/алертинг по событию `dlp_ephemeral_key_active`.
2. Release N+1 (боевой):
   - `DLP_REQUIRE_CONFIGURED_KEY=true`
   - `DLP_ALLOW_EPHEMERAL_KEY=false`
   - при отсутствии configured key сервис должен fail-closed на старте.

## 7. Безопасное логирование

Все security-логи пишутся в папку `logs/`.

Основные файлы:

- `logs/filter-trace.log` (или путь из `FILTER_TRACE_LOG_PATH`) - подробный трейс чат/агент пайплайна,
- `logs/dlp-agent-flow.log` - этапы агентного цикла,
- `logs/security-audit.log` - audit-события.

### 7.1. Sanitizer и redaction

Перед записью запись проходит sanitize-процедуру:

1. Редактируются чувствительные значения в тексте (email, api key, bearer, jwt, phone, card).
2. По ключам (`password`, `token`, `secret` и т.п.) значение заменяется на `[redacted]`/`[redacted:digest]`.
3. Ограничиваются глубина, длина строк, число элементов массивов и число ключей.

### 7.2. Ротация

Ротация выполняется на каждую запись:

1. Daily rotation: если день изменился - файл переносится в архив.
2. Size rotation: если новая запись превысит лимит размера - файл переносится в архив.
3. Prune: количество архивов ограничивается `*_ROTATE_MAX_FILES`.

Архивы получают timestamp-суффиксы и остаются рядом с базовым файлом.

## 8. Что логируется в каждом канале

### 8.1. Filter trace

Содержит транспортные этапы запроса:

- `*_request_received`,
- `*_dlp_protect_result`,
- `*_model_request`,
- `*_model_response`,
- `*_dlp_restore_result`,
- `*_response_to_dashboard`,
- плюс terminal-ошибки (`*_rate_limited`, `*_dlp_blocked`, `*_exception`).

### 8.2. Agent flow

Содержит этапы сквозного агентного обмена:

- `front_to_back`,
- `back_to_model`,
- `model_to_back`,
- `back_to_front`.

Если `DLP_AGENT_FLOW_MODEL_IO_VERBOSE=false`, модельный IO логируется в compact-режиме (digest + preview), а не полным телом.

### 8.3. Audit

Содержит события уровня эксплуатации:

- прием запроса,
- блокировки,
- provider-ошибки,
- успешный ответ,
- summary по DLP-детекциям/restore.

Audit intentionally хранит digest/сводки и не дублирует полный payload как в trace-каналах.

## 9. Runtime-пайплайн безопасности

### 9.1. `/api/chat`

Порядок:

1. Валидация запроса.
2. Hardening (rate limit).
3. DLP protect входа.
4. Отправка в модель.
5. DLP restore ответа.
6. Запись audit + filter-trace.
7. Возврат на фронт.

### 9.2. `/api/agent`

Порядок:

1. Валидация запроса.
2. Hardening (rate limit).
3. DLP protect входа.
4. Запуск agent loop (`runAgent`).
5. DLP protect результатов инструментов перед обратной отправкой в LLM.
6. DLP restore финального output.
7. Запись audit + filter-trace + agent-flow.
8. Возврат на фронт.

## 10. Проверки и эксплуатационные скрипты

Доступные команды:

- `npm run smoke:agent-dlp` - DLP smoke: токенизация/restore + guard-негативы.
- `npm run logs:check` - проверка консистентности логов (schema/event/stage).
- `npm run logs:migrate` - миграция legacy-записей в архив.
- `npm run smoke:hardening` - smoke-проверка key providers, DLP negative cases, rate limit и graceful fallback гибридного детектора при выключенном NER.
- `npm run smoke:filter-trace` - smoke-проверка полноты filter-trace событий + контроль отсутствия raw PII в `chat_model_request`.
- `npm run smoke:security-suite` - расширенный security-suite (crypto/vault/detector/policy/dlp/rate-limit/log-utils + perf-guards).
- `npm run smoke:failclosed-api` - e2e-проверка fail-closed ответа `503 ml_unavailable` при недоступной ML-модели.
- `npm run smoke:personnel` - smoke-сценарии по данным персонала (интенты и связанный AI-slice).

Рекомендуемый минимальный CI-пайплайн:

1. `npm run smoke:agent-dlp`
2. `npm run smoke:hardening`
3. `npm run smoke:filter-trace`
4. `npm run smoke:security-suite`
5. `npm run smoke:failclosed-api`
6. `npm run logs:check`

## 11. Рекомендации для production

1. Отключить localhost bypass:
   - `RATE_LIMIT_BYPASS_LOCALHOST=false`.
2. Ужесточить ключевую политику:
   - `DLP_REQUIRE_CONFIGURED_KEY=true`,
   - `DLP_ALLOW_EPHEMERAL_KEY=false`.
3. Включить `SECRET_POLICY_MODE=strict`.
4. Синхронизировать retention логов с регламентом ИБ.
5. Ограничить доступ к папке `logs/` на уровне ОС/контейнера.
6. Централизовать сбор логов (SIEM/ELK/Loki) поверх JSONL.
7. Для multi-instance лимитера перейти на shared-store (например Redis).

## 12. Ограничения текущей реализации

1. Rate limit и token-vault in-memory (state теряется при перезапуске).
2. Лимитер не распределенный (каждый инстанс считает отдельно).
3. DLP rule set регулярный и требует регулярной калибровки под домен.
4. Полные payload в trace-логах могут быть объемными (хотя и с sanitize).
5. Гибридный детектор требует периодической переиндексации словаря после изменений в `data/`.
6. ML-движок (`DLP_ML_ENABLED=true`) требует загрузки модели на старте, потребляет дополнительную память (~500-900 МБ для текущей модели). На холодном старте выполняется `warmup()` с таймаутом `DLP_ML_WARMUP_TIMEOUT_MS` (по умолчанию 25 с). Минимальные требования к процессу: ≥2 ГБ RAM.

## 13. Быстрый чек-лист инцидента

1. Проверить filter trace по requestId и terminal event.
2. Сверить агентные этапы в `logs/dlp-agent-flow.log`.
3. Проверить `logs/security-audit.log` на `errorCode`, `failureReason`, `providerStatus`.
4. Убедиться, что restore не имеет `missingTokens`/`decryptErrors`.
5. Проверить `/health` на статус hardening и key provider.

Удобные PowerShell-команды:

```powershell
Get-Content .\logs\filter-trace.log | Select-String '"requestId":"<REQUEST_ID>"'
Get-Content .\logs\dlp-agent-flow.log | Select-String '"requestId":"<REQUEST_ID>"'
Get-Content .\logs\security-audit.log | Select-String '"requestId":"<REQUEST_ID>"'
```

## 14. Актуальные переменные окружения (ключевые)

- DLP runtime: `DLP_ENABLED`, `DLP_BLOCK_ON_SECRETS`, `DLP_TOKEN_TTL_SEC`, `DLP_RESTORE_MAX_PASSES`.
- ML detector: `DLP_ML_ENABLED`, `DLP_ML_BACKEND`, `DLP_ML_MODEL`, `DLP_ML_MODEL_DIR`, `DLP_ML_FAIL_MODE`, `DLP_ML_THRESHOLDS`, `DLP_ML_THRESHOLD`, `DLP_ML_WARMUP_TIMEOUT_MS`, `DLP_ML_TIMEOUT_MS`, `DLP_ML_MAX_CHARS`.
- Regex backstop: `DLP_REGEX_BACKSTOP_ENABLED`.
- Key provider: `DLP_KEY_PROVIDER`, `DLP_REQUIRE_CONFIGURED_KEY`, `DLP_ALLOW_EPHEMERAL_KEY`, `DLP_MASTER_KEY_B64|HEX`, `DLP_MASTER_KEY_FILE`, `DLP_VAULT_KEY_*`, `DLP_KMS_KEY_*`.
- Secret policy: `SECRET_POLICY_MODE`.
- Rate limit: `RATE_LIMIT_*`, включая route-specific `RATE_LIMIT_CHAT_*` и `RATE_LIMIT_AGENT_*`.
- Logs:
  - `FILTER_TRACE_LOG_*` (+ `FILTER_TRACE_MAX_STRING`),
  - `DLP_AGENT_FLOW_LOG_*`, `DLP_AGENT_FLOW_MODEL_IO_VERBOSE`, `DLP_AGENT_FLOW_MODEL_PREVIEW_MAX`,
  - `AUDIT_LOG_*` (+ `AUDIT_LOG_UTF8_BOM`).

---

Если нужно, следующий шаг - добавить диаграмму sequence-прохода (front -> back -> DLP -> model -> restore -> logs) и runbook для on-call с готовыми командами фильтрации по `requestId`.
