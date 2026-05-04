# Legacy DLP detector layers

These files are kept as a rollback reference for the hybrid detector that was
replaced by the ML-first pipeline in `sprint6-ml-all` (see `secret-policy.js`).
They are **not imported** by `detector/index.js` anymore and have no runtime
effect.

- `dictionary-index.js` — Aho-Corasick / Trie lookup over project data
  (employees, organizations, departments, installations).
- `morph-fio.js` — Morphological FIO detector with sliding window.
- `structural.js` — Capitalization + contextual hints heuristics.

If you need to revive any of these layers temporarily (for an A/B comparison),
import them directly from this folder and wire them into `detector/index.js`
behind a dedicated env flag. Long-term they should be deleted once the new
pipeline is stable.
