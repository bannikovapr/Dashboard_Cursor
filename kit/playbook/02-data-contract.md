# 02. Data Contract — каноничная структура данных

## Зачем этот шаг

Главный секрет кита: дашборд и ассистент ничего не знают про ваши источники.
Они читают только один файл — `dashboard.json`, построенный по каноничной
схеме [templates/dashboard.schema.json](../templates/dashboard.schema.json).

Это развязывает UI, источники и метрики: вы можете поменять что угодно, и
остальное продолжит работать.

## Структура `dashboard.json`

```
meta        — когда и из чего собрано, локаль, валюта, период
kpis        — словарь id -> скаляр/объект с value+status+hint
charts      — словарь id -> серия точек или {categories, series}
tables      — словарь id -> массив строк-объектов
analysis    — производные срезы (топы, лидеры, выбросы) — опционально
datasets    — плоские нормализованные наборы для AI-агента — опционально
```

### Пример минимального `dashboard.json`

```json
{
  "meta": {
    "generated_at": "2026-04-17T10:00:00+03:00",
    "source": "Excel: 1 файл",
    "period": { "from": "2025-04-01", "to": "2026-03-31", "granularity": "month" },
    "locale": "ru-RU",
    "currency": "USD",
    "version": "1.0"
  },
  "kpis": {
    "total_revenue":    { "value": 1240500, "unit": "USD", "status": "target" },
    "active_customers": { "value": 432, "status": "standard" },
    "avg_order_value":  { "value": 2870, "unit": "USD" },
    "refund_rate":      { "value": 0.031, "unit": "%", "status": "standard" }
  },
  "charts": {
    "revenue_monthly":   [ { "month": "2025-10", "total": 95000 }, { "month": "2025-11", "total": 110500 } ],
    "orders_by_channel": [ { "channel": "Direct", "count": 220 }, { "channel": "Partner", "count": 95 } ]
  },
  "tables": {
    "top_customers": [
      { "customer": "Acme", "orders": 24, "revenue": 83000 },
      { "customer": "Globex", "orders": 18, "revenue": 69500 }
    ]
  }
}
```

## Правила

1. Все `id` в `kpis`, `charts`, `tables` должны совпадать с тем, что вы
   пропишете позже в [metric-catalog.yaml](../templates/metric-catalog.example.yaml)
   и [ui-layout.yaml](../templates/ui-layout.example.yaml).
2. Пустой блок — это пустая коллекция (`[]` или `{}`), а не отсутствующий ключ.
3. Числовой ноль — это ноль. Если данных нет, ставьте `null`, а не `0`.
4. Валюта и локаль задаются ровно один раз в `meta`.
5. Контракт расширяемый: можно добавить свои ключи внутрь `analysis` или
   собственный верхний раздел — валидация это допускает.

## Как пользоваться контрактом

- Вы сами **не пишете** этот JSON руками — его сгенерирует агент на шаге 03
  из ваших источников.
- Но вы должны **понимать структуру** — это поможет на acceptance-этапе
  проверить, что дашборд соответствует ожиданиям.

## Критерий готовности

- Вы открыли [dashboard.schema.json](../templates/dashboard.schema.json) и
  хотя бы бегло понимаете назначение полей `meta/kpis/charts/tables`.
- У вас в голове (или на салфетке) есть список id'ов будущих KPI, графиков и
  таблиц. 8–20 коротких имён — нормально.

## Следующий шаг

Переходите к [03-source-mapping.md](03-source-mapping.md) — опишем ваши
реальные источники и правила преобразования.
