# 50 — Подключение прогноза временных рядов

Опционально. Отправьте, если в `metric-catalog.yaml -> series` есть ряды с
`forecastable: true`.

---

```
Режим: agent-tools (раздел forecast_metric). Действуй по
kit/skills/agent-tools/SKILL.md и kit/playbook/06-forecast.md.

Цель: добавить в бэкенд инструмент forecast_metric с поддержкой ETS и SARIMAX,
интегрировать его в агента и UI, подготовить smoke-тест.

Шаги:

1. Проверь, что в metric-catalog.yaml есть series с forecastable: true и что
   соответствующие истории в data/dashboard.json имеют >= 12 точек. Если нет —
   перечисли проблемные ряды и остановись.

2. Подготовь прогнозный движок:
   - Если стек Python — используй statsmodels (ETS/SARIMAX) + fallback на
     скользящее среднее.
   - Если стек Node — вызывай Python-движок через child_process (как отдельный
     скрипт scripts/forecast_series.py), входы/выходы — JSON через stdin/stdout.
   - Если Python недоступен — собери JS-fallback (линейная регрессия + сезонный
     компонент) и отметь в документации ограниченную точность.

3. Реализуй инструмент forecast_metric:
   - параметры: metric, horizon (1..12), method (auto|ets|arima), filters,
     with_confidence;
   - возвращает series_history, series_forecast (+ lower/upper), model_info,
     quality (MAE, RMSE, MAPE);
   - формирует артефакты chart и table для UI (три серии: Факт, Прогноз,
     интервал).

4. Интегрируй в ReAct:
   - модель должна выбирать forecast_metric при словах «прогноз/forecast/на N
     месяцев/сколько будет»;
   - если пользователь не указал horizon — использовать 3 и явно писать это в
     fact;
   - результаты подмешивать в финальный artifacts.

5. Дополни UI:
   - рендер прогнозного графика с визуальным различием факт/прогноз/интервал;
   - бейдж «Прогноз» на карточке артефакта;
   - компактное форматирование чисел на оси значений (тыс/млн).

6. Smoke-тест:
   - добавь scripts/smoke-forecast.{js|py}, который строит прогноз для одного
     ряда и печатает OK + JSON с model и quality;
   - команда npm-скрипта: "smoke:forecast".

7. Graceful degradation:
   - при недоступности Python/движка возвращается fallback-результат с флагом
     model_info.fallback: true;
   - /api/agent не падает в 500.

В конце сообщи: какие ряды поддерживают прогноз, как запустить smoke, какие
вопросы уже проверены. Предложи следующий промт: kit/prompts/90-acceptance.md.
```
