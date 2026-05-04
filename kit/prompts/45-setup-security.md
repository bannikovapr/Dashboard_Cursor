# 45 — Настройка security-пайплайна (DLP + rate-limit + audit)

Обязательный шаг для production. Опциональный для черновика, но крайне
рекомендован, если включён AI-ассистент.

---

```
Режим: security-builder. Действуй по
kit/skills/security-builder/SKILL.md и kit/playbook/05a-security.md.

Цель: добавить в дашборд слой безопасности — DLP (детектор + блокировка +
токенизация + restore), rate-limit, fail-closed gate, безопасное логирование
и smoke-набор. Реализация — на текущем стеке (Node/Express, Python/FastAPI
или Go/Gin — определи по существующему коду).

Шаги:

1. Подтверди со мной декларативную политику:
   - проверь, что в корне моего проекта есть security-policy.yaml; если нет —
     скопируй kit/templates/security-policy.example.yaml и помести как
     security-policy.yaml. Покажи мне дифф значений по умолчанию и спроси,
     что менять. Минимум обсудить:
       * mode (strict / monitor / off),
       * fail_mode (closed / monitor / open),
       * key_provider (auto / env / vault / kms; require_configured;
         allow_ephemeral),
       * detector.ml.enabled и detector.ml.model,
       * rate_limit.routes и bypass_localhost,
       * logging.* (rotate / redact).

2. Сгенерируй модули security в каталоге server/security/ (или эквиваленте
   в Python/Go), все стек-нейтральные:
     - dlp-service        — protectPayload / restorePayload / createSession;
     - secret-policy      — режимы strict|monitor|off, классификация правил;
     - crypto             — AES-256-GCM, AAD = "<requestId>:<token>", провайдеры
                            ключа env|vault|kms|auto;
     - token-vault        — in-memory TTL store с dispose() / clearRequest();
     - rate-limit         — per-route, per-IP, окно времени;
     - log-utils          — sanitize/redact + ротация (daily + size cap);
     - audit-log          — события эксплуатации;
     - filter-trace-log   — транспортные этапы запроса;
     - agent-chat-flow-log — этапы агентного цикла (если включён);
     - detector/
         ner-engine       — ML-движок (по умолчанию transformers);
         regex-backstop   — секреты + email/phone/equipment_code;
         index            — фасад с дедупликацией спанов по приоритетам.

3. Интегрируй security в API-маршруты в строгом порядке:
   /api/chat и /api/agent:
     1) валидация запроса,
     2) hardening (rate-limit; при превышении — 429 rate_limited),
     3) DLP.protectPayload(...) ;
        - если ok=false и blockedBy=ml_unavailable -> 503 ml_unavailable,
        - если ok=false иначе -> 400 dlp_blocked,
     4) вызов LLM (только токены),
     5) DLP.restorePayload(answer),
     6) audit + filter-trace + (для агента) agent-flow,
     7) ответ фронту.
   /health: добавь поля mlReady, dlpKey (provider/source/configured),
   rateLimit summary; при closed+notReady отвечать 503.

4. Настрой fail-closed гейт:
   - protectPayload возвращает blockedBy="ml_unavailable", если
     fail_mode=closed и ML не готова;
   - в API на этой ошибке — 503 (а не 400);
   - в monitor-режиме запрос пропускается, но в audit пишется warn-event.

5. Настрой логи:
   - filter-trace.log с событиями
       *_request_received, *_dlp_protect_result, *_model_request,
       *_model_response, *_dlp_restore_result, *_response_to_dashboard;
       плюс терминальные *_rate_limited, *_dlp_blocked, *_exception;
   - dlp-agent-flow.log (только агент): front_to_back, back_to_model,
       model_to_back, back_to_front;
   - security-audit.log: приём, блокировки, provider-ошибки, успешный ответ,
       summary по DLP-детекциям и restore (digest, не сырые значения);
   - sanitize: редакт по типам (email, api-key, Bearer, JWT, phone, card-Luhn)
       и по чувствительным ключам (password, token, secret, api_key, ...);
   - ротация: daily + size cap (rotate.max_bytes), max-files (rotate.max_files);
   - все три файла кладутся в logs/ относительно корня проекта.

6. Поправь .env / .env.example / .gitignore:
   - .env.example БЕЗ значений (плейсхолдеры);
   - .gitignore содержит:
       .env
       .env.*
       !.env.example
       node_modules/
       __pycache__/
       *.log
       data/dashboard.json (если данные чувствительные)
       logs/
   - убедись, что .env не в git: `git check-ignore -v .env` -> .env;
     если был закоммичен — `git rm --cached .env` и попроси меня ротировать
     ключи.

7. Добавь smoke-набор и подключи к ci:hygiene:
   - smoke:agent-dlp        — токенизация/restore + guard-негативы;
   - smoke:hardening        — провайдеры ключа, DLP-негативы, rate-limit,
                              fail-closed гейт детектора;
   - smoke:filter-trace     — наличие всех событий + ассерт, что в
                              chat_model_request НЕТ raw PII (только токены);
   - smoke:security-suite   — расширенный (crypto/vault/regex/detector/
                              policy/dlp/rate-limit/log-utils + perf-guards);
   - smoke:failclosed-api   — e2e: API возвращает 503 ml_unavailable
                              при недоступной ML-модели.

8. Документация в репо:
   - SECURITY_README.md (по структуре нашего текущего файла);
   - в README.md добавь раздел Скрипты с новыми smoke-командами;
   - в acceptance-checklist (если уже скопирован в корень) добавь раздел
     §15 "Security pipeline".

9. Проверь сам себя:
   - запусти smoke:security-suite, smoke:filter-trace, smoke:failclosed-api;
   - в `chat_model_request` для запроса с email/phone — только токены;
   - запрос с sk-or-v1-... -> 400 dlp_blocked (strict) либо tokenize (monitor);
   - при DLP_ML_FAIL_MODE=closed и недоступной ML -> 503 ml_unavailable.

10. В финале сообщи:
    - какие модули созданы / обновлены;
    - какие новые .env-переменные нужны (без значений);
    - какие smoke-команды доступны;
    - secrets_check: OK или список найденных проблем;
    - предложи следующий промт: kit/prompts/90-acceptance.md.
```

---

Если security-policy.yaml ещё не создан — агент должен создать его из
`kit/templates/security-policy.example.yaml` и поднять обсуждение по дефолтам.

Если в проекте уже есть `server/security/`, агент должен НЕ переписывать
рабочие модули, а проверить контракт и обновить недостающее. Любые правки
бизнес-логики проходят через политику в `security-policy.yaml`, а не через
точечные хардкоды.
