# Локальные ML-модели для DLP-детектора

Эта папка предназначена для локальных ONNX-весов NER/PII моделей, используемых
DLP-детектором в `server/security/detector/ner-engine.js`. Веса намеренно
**не коммитятся** в репозиторий (`.gitignore` исключает `models/**` за вычетом
этого README), чтобы не раздувать историю и не публиковать большие бинарники.

## Стандартный путь запуска (рекомендуется)

По умолчанию `@xenova/transformers` сам подтянет модель из HuggingFace при первом
вызове `pipeline(...)` и положит её в свой кэш (`~/.cache/huggingface/...` или
рядом с проектом, в зависимости от ОС). Никаких ручных шагов экспорта
для дефолтной модели не требуется.

Дефолтная модель:
`Xenova/bert-base-multilingual-cased-ner-hrl`
(token-classification, классы `PER`, `ORG`, `LOC`).

## Альтернатива: zero-shot GLiNER (опционально, Phase 2)

Если нужно покрыть `email`, `phone`, `equipment_code`, `secrets` одной ML-моделью,
можно использовать GLiNER (zero-shot NER) — `urchade/gliner_multi_pii-v1` или
`urchade/gliner_multi-v2.1`. Для запуска в Node.js потребуется одноразовый
ONNX-экспорт модели с помощью HuggingFace Optimum:

```bash
pip install --upgrade "optimum[exporters]" transformers onnxruntime
optimum-cli export onnx \
  --model urchade/gliner_multi_pii-v1 \
  --task token-classification \
  models/gliner_multi_pii-v1
```

После экспорта в этой папке появится подкаталог `models/gliner_multi_pii-v1/`
с файлами `model.onnx`, `tokenizer.json`, `config.json` и пр. Включается через
`.env`:

```
DLP_ML_BACKEND=gliner
DLP_ML_MODEL=urchade/gliner_multi_pii-v1
DLP_ML_MODEL_DIR=models/gliner_multi_pii-v1
```

Текущая реализация `ner-engine.js` ожидает интерфейс token-classification.
Адаптер под GLiNER bi-encoder остаётся к реализации в Phase 2 и сейчас
выводит предупреждение в лог при выборе `DLP_ML_BACKEND=gliner`.

## Структура подкаталогов

```
models/
  README.md                       # этот файл (под git)
  gliner_multi_pii-v1/             # ONNX-веса (НЕ под git)
    config.json
    model.onnx
    tokenizer.json
    special_tokens_map.json
```

## Проверка

После первого запуска сервера эндпоинт `/health` должен вернуть
`hardening.detector.ner.loaded === true` и значение `loadMs`.
