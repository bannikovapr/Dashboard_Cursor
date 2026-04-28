# 40 — Настройка AI-ассистента и агента

Опционально. Отправьте, если в `brand.config.yaml -> assistant.enabled: true`.

---

```
Режим: agent-tools + dashboard-assistant. Действуй по
kit/skills/agent-tools/SKILL.md, kit/skills/dashboard-assistant/SKILL.md и
kit/playbook/05-ai-assistant.md.

Цель: добавить в дашборд два API-endpoint'а — быстрый чат и ReAct-агент,
и клиентскую панель чата, которая рендерит артефакты (таблицы и графики).

Шаги:

1. Подтверди со мной провайдера LLM:
   - OpenRouter / OpenAI / Anthropic / локальная модель через OpenAI-compat API.
   Спроси про ключ. Зафиксируй переменные .env:
     <PROVIDER>_API_KEY, <PROVIDER>_MODEL, <PROVIDER>_TIMEOUT_MS,
     API_PORT, ALLOWED_ORIGINS.

2. Сгенерируй бэкенд (Node+Express или Python+FastAPI — по стеку) с:
   - GET  /health
   - POST /api/chat    (быстрый чат, возвращает { fact, conclusion, action })
   - POST /api/agent   (ReAct-цикл с инструментами)

3. Реализуй слой данных data-store:
   - загрузка data/dashboard.json;
   - плоские датасеты (из dashboard.json -> datasets);
   - функция classify/аггрегации при необходимости.

4. Реализуй инструменты (все 7 из kit/skills/agent-tools/SKILL.md):
   get_kpis, query_data, compute, build_table, build_chart, search_entity,
   forecast_metric. Последний — только если prompts/50-forecast.md уже запускался
   или я явно прошу включить сейчас.

5. Сгенерируй системный промт агента по шаблону из SKILL.md с подстановкой:
   - brand.app.title,
   - brand.assistant.response_language,
   - brand.assistant.answer_format,
   - глоссарий из metric-catalog.yaml,
   - перечень датасетов.

6. Настрой ReAct-оркестратор:
   - MAX_STEPS = 5, STEP_TIMEOUT_MS = 45000, AGENT_TIMEOUT_MS = 90000;
   - автоматический fallback в /api/chat при ошибке агента;
   - локальный fallback (без LLM), если ключ отсутствует.
   - ДЕТЕРМИНИРОВАННЫЙ intent-router (см.
     kit/skills/agent-tools/SKILL.md -> «Детерминированный intent-router»):
       * пре-процессор на regexp извлекает intent, visualize_required, top_n,
         forecast_horizon и подкладывает их в системный промт;
       * пост-процессор проверяет: если visualize_required = true, а в
         финале артефактов нет — делается автоматический retry с
         принудительной подсказкой «верни tool_calls с build_chart/build_table»;
       * для top_n с извлечённым N сервер гарантирует, что итоговая
         таблица/график содержит ровно N строк (или все, если данных меньше).

7. Обнови фронт:
   - панель AI справа (если brand.layout.mode = main_plus_sidebar);
   - переключатель режимов «Агент / Быстрый ответ»;
   - рендер артефактов (таблиц и графиков) в panel и по кнопке «Развернуть»
     в рабочей области.

8. Smoke-проверка:
   - GET /health -> 200;
   - POST /api/chat с простым вопросом -> валидный ответ;
   - POST /api/agent с "Покажи топ-5 по <главная метрика> графиком" -> есть
     artifacts, trace.toolsUsed содержит build_chart, в chart ровно 5
     категорий (или все доступные, если их меньше 5).
   - POST /api/agent с "Спрогнозируй <главная метрика> на 3 месяца" ->
     artifacts с прогнозным графиком, trace.toolsUsed содержит forecast_metric.
   - Регрессионная проверка: 10 раз подряд прогнать «Покажи топ-5 … графиком».
     Artifacts должны быть во всех 10 ответах (intent-router гарантирует).

9. Guardrails:
   - query_data.limit <= 1000;
   - build_table <= 20 колонок и <= 200 строк;
   - build_chart <= 50 категорий / 50 точек;
   - LLM-ключ не утекает в браузер;
   - CORS ограничен ALLOWED_ORIGINS.

10. Гигиена секретов (обязательно ПЕРЕД и ПОСЛЕ smoke):

    10.1. Перед smoke:
          - создай/обнови .gitignore в корне проекта. Обязательно внутри:
              .env
              .env.*
              !.env.example
              node_modules/
              __pycache__/
              *.log
              data/dashboard.json (если данные чувствительные)
          - создай .env.example БЕЗ реальных значений, с плейсхолдерами;
          - убедись, что .env НЕ в git: `git check-ignore -v .env` -> .env.
          Если .env уже был закоммичен — выполни:
              git rm --cached .env
              и попроси пользователя ротировать ключ.

    10.2. После smoke:
          - повторно убедись, что .env не в индексе: `git status` НЕ должен
            показывать .env ни в staged, ни в untracked-to-commit;
          - просканируй все новые файлы скрипта/конфига на наличие
            подстрок `sk-`, `Bearer `, `OPENAI_API_KEY=`, `OPENROUTER_API_KEY=`
            с реальными значениями. Если что-то нашлось — удали и попроси
            ротировать ключ.

    10.3. Не предлагай пользователю «закоммить всё», пока не пройдены
          пункты 10.1 и 10.2. В финальном отчёте явно напиши:
          `secrets_check: OK` или перечисли найденные проблемы.

В конце сообщи список endpoint'ов, как запускать, как проверить. Предложи
следующий промт: kit/prompts/50-forecast.md (если нужен прогноз) или
kit/prompts/90-acceptance.md.
```
