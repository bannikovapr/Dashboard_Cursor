(function (root) {
  "use strict";

  const STATE = {
    catalog: [],
    mandatory: [],
    reports: [],
    activeReportId: null,
    activeDocument: null,
    pendingDraftPreview: null,
    getCurrentFilters: null,
    initialized: false,
    welcomeClickBound: false,
  };

  function getApiBase() {
    const chatUrl = root.TOIR_API_URL || "";
    if (chatUrl) {
      try {
        const u = new URL(chatUrl);
        return `${u.origin}/api/reports`;
      } catch (e) {
        /* fallthrough */
      }
    }
    return "http://localhost:8787/api/reports";
  }

  async function api(path, options) {
    const url = `${getApiBase()}${path || ""}`;
    const opts = options || {};
    const init = {
      method: opts.method || "GET",
      headers: Object.assign(
        { Accept: "application/json" },
        opts.body ? { "Content-Type": "application/json" } : {}
      ),
    };
    if (opts.body) init.body = JSON.stringify(opts.body);
    const response = await fetch(url, init);
    let payload = null;
    try {
      payload = await response.json();
    } catch (e) {
      payload = null;
    }
    if (!response.ok || (payload && payload.ok === false)) {
      const message = (payload && (payload.message || payload.error)) || `HTTP ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload || {};
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderInline(text) {
    let out = escapeHtml(text);
    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
    return out;
  }

  function renderMarkdown(text) {
    if (!text) return "";
    const lines = String(text).split(/\r?\n/);
    const blocks = [];
    let buf = [];
    let listBuf = [];
    let inList = false;
    function flushPara() {
      if (buf.length) {
        blocks.push(`<p>${renderInline(buf.join(" "))}</p>`);
        buf = [];
      }
    }
    function flushList() {
      if (listBuf.length) {
        blocks.push(`<ul>${listBuf.map((it) => `<li>${renderInline(it)}</li>`).join("")}</ul>`);
        listBuf = [];
      }
      inList = false;
    }
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) {
        flushPara();
        flushList();
        continue;
      }
      let m;
      if ((m = line.match(/^###\s+(.+)$/))) {
        flushPara();
        flushList();
        blocks.push(`<h4>${renderInline(m[1])}</h4>`);
        continue;
      }
      if ((m = line.match(/^##\s+(.+)$/))) {
        flushPara();
        flushList();
        blocks.push(`<h3>${renderInline(m[1])}</h3>`);
        continue;
      }
      if ((m = line.match(/^#\s+(.+)$/))) {
        flushPara();
        flushList();
        blocks.push(`<h2>${renderInline(m[1])}</h2>`);
        continue;
      }
      if ((m = line.match(/^[-*]\s+(.+)$/))) {
        flushPara();
        listBuf.push(m[1]);
        inList = true;
        continue;
      }
      if ((m = line.match(/^(\d+)\.\s+(.+)$/))) {
        flushPara();
        flushList();
        blocks.push(`<p><b>${m[1]}.</b> ${renderInline(m[2])}</p>`);
        continue;
      }
      if (inList) flushList();
      buf.push(line);
    }
    flushPara();
    flushList();
    return blocks.join("\n");
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      return d.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (e) {
      return String(iso);
    }
  }

  function statusLabel(status) {
    if (status === "high") return "Высокая";
    if (status === "medium") return "Средняя";
    if (status === "low") return "Низкая";
    return status || "Средняя";
  }

  function setStatus(message, kind) {
    const el = document.getElementById("reportsStatus");
    if (!el) return;
    el.textContent = message || "";
    el.dataset.kind = kind || "";
  }

  function setReportLayoutDocMode(hasDoc) {
    const layout = document.querySelector("#panel-charts-reports .report-layout");
    if (layout) layout.classList.toggle("report-layout--has-doc", !!hasDoc);
  }

  function periodLabelRu(period) {
    if (period === "h1") return "1-е полугодие 2025";
    if (period === "h2") return "2-е полугодие 2025";
    return "Последние 12 мес.";
  }

  function classLabelRu(cls) {
    if (!cls || cls === "__all__") return "Все классы";
    return String(cls);
  }

  /** Срез дашборда для API отчёта: callback из toir-app или прямое чтение селекторов шапки. */
  function collectDashboardFilters() {
    if (typeof STATE.getCurrentFilters === "function") {
      const f = STATE.getCurrentFilters();
      return {
        period: (f && f.period) || "all",
        class: (f && f.class) || "__all__",
      };
    }
    const periodEl = document.getElementById("panelPeriod");
    const classEl = document.getElementById("panelClass");
    return {
      period: (periodEl && periodEl.value) || "all",
      class: (classEl && classEl.value) || "__all__",
    };
  }

  function updateWelcomeSlice() {
    const periodEl = document.getElementById("reportSlicePeriod");
    if (!periodEl) return;
    const f = collectDashboardFilters();
    periodEl.textContent = periodLabelRu(f.period);
    const classEl = document.getElementById("reportSliceClass");
    if (classEl) classEl.textContent = classLabelRu(f.class);
    const countEl = document.getElementById("reportSliceCount");
    if (countEl) countEl.textContent = String((STATE.reports || []).length);
  }

  function syncSliceFromDashboard() {
    updateWelcomeSlice();
  }

  function updateWelcomeExportState() {
    const latest = (STATE.reports && STATE.reports.length) ? STATE.reports[0] : null;
    const has = !!latest;
    const canUndo = has && Number(latest.revision_count || 0) >= 2;

    const editBtn = document.getElementById("reportWelcomeEditTitle");
    if (editBtn) {
      editBtn.disabled = !has;
      editBtn.title = has ? "Изменить заголовок последнего сохранённого отчёта" : "Сначала создайте отчёт";
    }
    const undoBtn = document.getElementById("reportWelcomeUndo");
    if (undoBtn) {
      undoBtn.disabled = !canUndo;
      undoBtn.title = canUndo
        ? "Откатить последний сохранённый отчёт на предыдущую ревизию"
        : has
          ? "Для отката нужно минимум две ревизии"
          : "Сначала создайте отчёт";
    }

    const dd = document.getElementById("reportWelcomeExportDropdown");
    if (dd) {
      dd.classList.toggle("report-export-dropdown--disabled", !has);
      dd.querySelectorAll(".report-export-menu-item").forEach((btn) => {
        btn.disabled = !has;
      });
    }
    ["reportWelcomeExportHtml", "reportWelcomeExportDocx", "reportWelcomeExportPdf", "reportWelcomePrint"].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.disabled = !has;
      el.title = has ? "Выгрузить последний сохранённый отчёт" : "Сначала создайте отчёт";
    });
  }

  function renderEmpty(panel) {
    if (!panel) return;
    const headCell = document.getElementById("reportHeadCell");
    if (headCell) headCell.innerHTML = "";
    setReportLayoutDocMode(false);
    panel.classList.add("report-main--empty");
    panel.innerHTML = `
      <div class="report-welcome">
        <div class="report-welcome-shell card">
          <div class="report-welcome-brand">
            <div class="top-header">
              <div class="brand-band">
                <img
                  class="brand-logo-img"
                  src="assets/desnol-userpic.png"
                  width="64"
                  height="64"
                  alt="Desnol"
                  decoding="async"
                />
                <div class="brand-lockup">
                  <div class="titles">
                    <h1>Отчёт ТОиР</h1>
                  </div>
                </div>
              </div>
            </div>
            <p class="report-welcome-lead">
              Создайте отчёт по текущему срезу дашборда (период и класс задаются в шапке страницы) или откройте сохранённый в списке слева.
              Снимок фиксирует KPI, автодиагностики <strong>R/K</strong> и секции; выгрузка в <strong>HTML</strong>, <strong>DOCX</strong> и <strong>PDF</strong> в стиле дашборда.
              Файлы отчётов хранятся локально в <code>.reports/</code>.
            </p>
          </div>
          <div class="report-welcome-workzone" aria-label="Действия и срез">
            <div class="report-welcome-grid-inner">
              <div class="report-welcome-main-col">
                <ol class="report-welcome-steps">
                  <li>Проверьте в шапке период и класс оборудования — новый отчёт строится для этого среза.</li>
                  <li>Нажмите «+ Создать отчёт по текущему срезу» в списке слева и при необходимости отредактируйте заголовок.</li>
                  <li>Откройте отчёт в списке слева: правьте секции, при необходимости обновите снимок или откатите ревизию.</li>
                  <li>Кнопки справа (заголовок, обновление списка, откат, выгрузка) работают с <strong>последним сохранённым</strong> отчётом, пока ни один не открыт в центральной области.</li>
                </ol>
              </div>
              <div class="report-welcome-aside">
                <div class="report-welcome-compact-panel">
                  <div class="report-toolbar-cluster report-toolbar-cluster--welcome">
                    <div class="report-doc-actions report-doc-actions--welcome" role="toolbar" aria-label="Действия с последним отчётом">
                      <button type="button" id="reportWelcomeEditTitle" class="btn-report-toolbar btn-report-toolbar--pill" title="Изменить заголовок">Заголовок</button>
                      <button type="button" id="reportWelcomeRefreshIcon" class="btn-report-toolbar btn-report-toolbar--icon" title="Обновить список отчётов" aria-label="Обновить список отчётов">↻</button>
                      <button type="button" id="reportWelcomeUndo" class="btn-report-toolbar btn-report-toolbar--pill" disabled>↶ Откатить</button>
                      <details class="report-export-dropdown" id="reportWelcomeExportDropdown">
                        <summary class="report-export-summary" aria-label="Выгрузить отчёт">Выгрузить отчёт <span class="report-export-caret" aria-hidden="true">▼</span></summary>
                        <div class="report-export-menu" id="reportWelcomeExportMenu" role="menu">
                          <button type="button" class="report-export-menu-item" data-export="html" id="reportWelcomeExportHtml">HTML</button>
                          <button type="button" class="report-export-menu-item" data-export="docx" id="reportWelcomeExportDocx">DOCX</button>
                          <button type="button" class="report-export-menu-item" data-export="pdf" id="reportWelcomeExportPdf">PDF</button>
                          <button type="button" class="report-export-menu-item" data-export="print" id="reportWelcomePrint">Печать…</button>
                        </div>
                      </details>
                    </div>
                  </div>
                  <div class="report-welcome-steps report-welcome-steps--slice" aria-label="Текущий срез дашборда">
                    <div class="report-slice-row">
                      <div class="report-slice-label">Текущий период</div>
                      <div class="report-slice-value" id="reportSlicePeriod">—</div>
                    </div>
                    <div class="report-slice-row">
                      <div class="report-slice-label">Класс оборудования</div>
                      <div class="report-slice-value" id="reportSliceClass">—</div>
                    </div>
                    <div class="report-slice-row">
                      <div class="report-slice-label">Сохранённых отчётов</div>
                      <div class="report-slice-value" id="reportSliceCount">0</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    updateWelcomeSlice();
    updateWelcomeExportState();
  }

  async function loadList() {
    try {
      const data = await api("/");
      STATE.reports = data.reports || [];
      STATE.catalog = data.catalog || [];
      STATE.mandatory = data.mandatory || [];
      renderList();
      updateWelcomeSlice();
      updateWelcomeExportState();
    } catch (e) {
      setStatus(`Ошибка загрузки списка отчётов: ${e.message}`, "error");
    }
  }

  function renderList() {
    const list = document.getElementById("reportsList");
    if (!list) return;
    list.innerHTML = "";
    if (!STATE.reports.length) {
      const empty = document.createElement("div");
      empty.className = "reports-list-empty";
      empty.textContent = "Отчётов пока нет.";
      list.appendChild(empty);
      return;
    }
    STATE.reports.forEach((r) => {
      const item = document.createElement("div");
      item.className = "report-list-item";
      if (r.report_id === STATE.activeReportId) item.classList.add("is-active");
      item.dataset.reportId = r.report_id;
      const cls = r.snapshot && r.snapshot.class_filter && r.snapshot.class_filter !== "__all__"
        ? r.snapshot.class_filter
        : "все классы";
      item.innerHTML = `
        <div class="report-list-title">${escapeHtml(r.title || r.report_id)}</div>
        <div class="report-list-meta">
          <span>${escapeHtml((r.snapshot && r.snapshot.period_label) || "—")}</span>
          <span>·</span>
          <span>${escapeHtml(cls)}</span>
        </div>
        <div class="report-list-foot">
          <span>${fmtDate(r.updated_at)}</span>
          <span class="report-list-revs">ред. ${r.revision_count || 0}</span>
        </div>
        <button type="button" class="report-list-delete" data-action="delete" title="Удалить">×</button>
      `;
      item.addEventListener("click", (ev) => {
        if (ev.target && ev.target.dataset && ev.target.dataset.action === "delete") return;
        openReport(r.report_id);
      });
      const delBtn = item.querySelector('[data-action="delete"]');
      if (delBtn) {
        delBtn.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          if (!confirm(`Удалить отчёт «${r.title || r.report_id}»?`)) return;
          try {
            await api(`/${encodeURIComponent(r.report_id)}`, { method: "DELETE" });
            if (STATE.activeReportId === r.report_id) {
              STATE.activeReportId = null;
              STATE.activeDocument = null;
              renderEmpty(document.getElementById("reportView"));
            }
            await loadList();
            setStatus("Отчёт удалён.", "info");
          } catch (e) {
            setStatus(`Не удалось удалить: ${e.message}`, "error");
          }
        });
      }
      list.appendChild(item);
    });
  }

  function renderSectionCard(section, indexInfo) {
    const isMandatory = !!section.mandatory;
    const card = document.createElement("article");
    card.className = `report-section report-section--${section.confidence || "medium"}`;
    if (isMandatory) card.classList.add("report-section--mandatory");
    card.dataset.sectionId = section.section_id;

    const head = document.createElement("header");
    head.className = "report-section-head";
    head.innerHTML = `
      <h3 class="report-section-title">${escapeHtml(section.title || "")}</h3>
      <div class="report-section-meta">
        ${isMandatory ? '<span class="report-section-badge report-section-badge--mandatory">Обязательная</span>' : ""}
        <span class="report-section-badge report-section-badge--confidence-${section.confidence || "medium"}">Уверенность: ${escapeHtml(statusLabel(section.confidence))}</span>
      </div>
    `;
    card.appendChild(head);

    const body = document.createElement("div");
    body.className = "report-section-body";
    body.innerHTML = renderMarkdown(section.body_markdown || "");
    card.appendChild(body);

    if (section.fact_bullets && section.fact_bullets.length) {
      const factsTitle = document.createElement("div");
      factsTitle.className = "report-section-subtitle";
      factsTitle.textContent = "Подтверждающие факты";
      card.appendChild(factsTitle);
      const ul = document.createElement("ul");
      ul.className = "report-section-facts";
      section.fact_bullets.forEach((b) => {
        const li = document.createElement("li");
        li.innerHTML = renderInline(b);
        ul.appendChild(li);
      });
      card.appendChild(ul);
    }

    if (section.evidence_refs && section.evidence_refs.length) {
      const refs = document.createElement("div");
      refs.className = "report-section-refs";
      refs.innerHTML =
        '<span class="report-section-refs-label">Опора на данные:</span> ' +
        section.evidence_refs
          .map((r) => `<span class="report-section-ref">${escapeHtml(r)}</span>`)
          .join("");
      card.appendChild(refs);
    }

    if (section.warnings && section.warnings.length) {
      const warns = document.createElement("div");
      warns.className = "report-section-warnings";
      warns.innerHTML =
        '<div class="report-section-warnings-title">Ограничения секции</div>' +
        section.warnings.map((w) => `<div class="report-section-warning">${escapeHtml(w)}</div>`).join("");
      card.appendChild(warns);
    }

    if (indexInfo && indexInfo.controls) {
      const controls = document.createElement("div");
      controls.className = "report-section-controls";
      controls.innerHTML = `
        <button type="button" data-action="edit">Редактировать</button>
        ${isMandatory ? "" : '<button type="button" data-action="delete">Удалить</button>'}
        <button type="button" data-action="move-up" ${indexInfo.idx === 0 ? "disabled" : ""}>↑</button>
        <button type="button" data-action="move-down" ${indexInfo.isLast ? "disabled" : ""}>↓</button>
      `;
      card.appendChild(controls);
    }

    return card;
  }

  function renderDocument(document_) {
    const view = document.getElementById("reportView");
    if (!view) return;
    if (!document_) {
      renderEmpty(view);
      return;
    }
    STATE.activeDocument = document_;
    view.classList.remove("report-main--empty");
    const headCell = document.getElementById("reportHeadCell");
    if (headCell) headCell.innerHTML = "";
    view.innerHTML = "";

    const head = document.createElement("header");
    head.className = "report-doc-head";
    const snap = document_.snapshot || {};
    const cls = snap.class_filter && snap.class_filter !== "__all__" ? snap.class_filter : "все классы";
    const undoDisabled = (document_.revisions || []).length < 2;
    head.innerHTML = `
      <div class="top-header report-doc-top-header">
        <div class="brand-band">
          <img
            class="brand-logo-img"
            src="assets/desnol-userpic.png"
            width="64"
            height="64"
            alt="Desnol"
            decoding="async"
          />
          <div class="brand-lockup">
            <div class="titles">
              <h1 id="reportDocTitle">${escapeHtml(document_.title || "")}</h1>
            </div>
          </div>
        </div>
      </div>
      <div class="report-doc-toolbar">
        <div class="report-toolbar-cluster">
          <div class="report-doc-actions" role="toolbar" aria-label="Действия с документом">
            <button type="button" id="reportEditTitle" class="btn-report-toolbar btn-report-toolbar--pill" title="Изменить заголовок">Заголовок</button>
            <button type="button" id="reportRefresh" class="btn-report-toolbar btn-report-toolbar--icon" title="Обновить снимок по новым данным" aria-label="Обновить снимок по новым данным">↻</button>
            <button type="button" id="reportUndo" class="btn-report-toolbar btn-report-toolbar--pill" ${undoDisabled ? "disabled" : ""}>↶ Откатить</button>
            <details class="report-export-dropdown" id="reportExportDropdown">
              <summary class="report-export-summary" aria-label="Выгрузить отчёт">Выгрузить отчёт <span class="report-export-caret" aria-hidden="true">▼</span></summary>
              <div class="report-export-menu" id="reportExportMenu" role="menu">
                <button type="button" role="menuitem" id="reportExportHtml" class="report-export-menu-item" data-export="html">HTML</button>
                <button type="button" role="menuitem" id="reportExportDocx" class="report-export-menu-item" data-export="docx">DOCX</button>
                <button type="button" role="menuitem" id="reportExportPdf" class="report-export-menu-item" data-export="pdf">PDF</button>
                <button type="button" role="menuitem" id="reportPrint" class="report-export-menu-item" data-export="print">Печать…</button>
              </div>
            </details>
          </div>
        </div>
      </div>
      <div class="report-doc-hero">
        <p class="report-doc-hero-tagline">Стратегический дашборд ТОиР · экспорт документа</p>
        <div class="report-doc-hero-chips" aria-label="Параметры отчёта">
          <span class="report-doc-chip">Период: ${escapeHtml(snap.period_label || "—")}</span>
          <span class="report-doc-chip">Класс: ${escapeHtml(cls)}</span>
          <span class="report-doc-chip">Обновлён: ${escapeHtml(fmtDate(document_.updated_at))}</span>
          <span class="report-doc-chip">Ревизий: ${(document_.revisions || []).length}</span>
        </div>
      </div>
    `;

    setReportLayoutDocMode(true);

    const sectionsWrap = document.createElement("section");
    sectionsWrap.className = "report-doc-sections";
    const sections = document_.sections || [];
    sections.forEach((s, idx) => {
      const card = renderSectionCard(s, { idx, isLast: idx === sections.length - 1, controls: true });
      sectionsWrap.appendChild(card);
    });
    view.appendChild(head);
    view.appendChild(sectionsWrap);

    const aiPanel = document.createElement("section");
    aiPanel.className = "report-doc-ai";
    aiPanel.innerHTML = `
      <h3>AI-правка отчёта</h3>
      <p class="report-doc-ai-hint">Опишите, что нужно изменить в отчёте — например: «сократи короткий вывод», «добавь раздел по подразделениям», «убери ограничения данных». Перед применением вы увидите превью изменений.</p>
      <textarea id="reportAiInstruction" rows="3" placeholder="Опишите правку…"></textarea>
      <div class="report-doc-ai-actions">
        <button type="button" id="reportAiPlan">Подобрать правку</button>
      </div>
    `;
    view.appendChild(aiPanel);

    const revWrap = document.createElement("details");
    revWrap.className = "report-doc-revisions";
    const revs = (document_.revisions || []).slice().reverse();
    revWrap.innerHTML =
      `<summary>История ревизий (${revs.length})</summary>` +
      revs
        .map(
          (r) =>
            `<div class="report-rev"><span class="report-rev-id">${escapeHtml(r.revision_id)}</span> · <span class="report-rev-author">${escapeHtml(r.author_type)}</span> · <span class="report-rev-date">${fmtDate(r.created_at)}</span><div class="report-rev-summary">${escapeHtml(r.summary || "")}</div></div>`
        )
        .join("");
    view.appendChild(revWrap);

    bindDocControls(document_);
    bindExportControls(document_);
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2500);
  }

  async function loadLogoDataUrl() {
    async function dataUrlFromAsset(assetPath) {
      try {
        const res = await fetch(assetPath, { cache: "force-cache" });
        if (!res.ok) return null;
        const blob = await res.blob();
        return await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result || null);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        });
      } catch (e) {
        return null;
      }
    }
    const userpic = await dataUrlFromAsset("assets/desnol-userpic.png");
    if (userpic) return userpic;
    try {
      const resSvg = await fetch("assets/desnol-logo.svg", { cache: "force-cache" });
      if (resSvg.ok) {
        const svg = await resSvg.text();
        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      }
    } catch (e) {
      /* fallthrough */
    }
    return await dataUrlFromAsset("assets/report-brand-logo.png");
  }

  async function downloadFromApi(url, filename) {
    let response;
    try {
      response = await fetch(url, {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
      });
    } catch (e) {
      const base = "Сеть: запрос к API не выполнен.";
      const hint =
        typeof (e && e.message) === "string" && /fail|network|load/i.test(e.message)
          ? " Убедитесь, что сервер запущен (npm run start:api), порт в .env (API_PORT) совпадает с адресом в TOIR_API_URL. При открытии index.html через file:// включена поддержка CORS для null-origin — обновите сервер."
          : "";
      throw new Error(`${base} ${(e && e.message) || e}.${hint}`);
    }
    if (!response.ok) {
      let msg = `HTTP ${response.status}`;
      const ct = response.headers.get("content-type") || "";
      try {
        if (ct.includes("application/json")) {
          const j = await response.json();
          if (j && j.message) msg = j.message;
        } else {
          const t = await response.text();
          if (t && t.length < 400) msg = `${msg}: ${t.trim().slice(0, 300)}`;
        }
      } catch (e) {
        /* ignore */
      }
      throw new Error(msg);
    }
    const blob = await response.blob();
    triggerDownload(blob, filename);
  }

  async function resolveDocForExport() {
    if (STATE.activeDocument && STATE.activeDocument.report_id) {
      return STATE.activeDocument;
    }
    const arr = (STATE.reports || []).slice().sort(
      (a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
    );
    if (!arr.length) return null;
    const res = await api(`/${encodeURIComponent(arr[0].report_id)}`);
    return res.report || null;
  }

  async function exportDocumentHtmlToFile(doc_) {
    const HtmlNs = globalThis.__ReportExportHtml;
    if (!HtmlNs || typeof HtmlNs.buildReportHtmlDocument !== "function") {
      setStatus("Подключите js/report-export-layout.js и js/report-export-html.js.", "error");
      return;
    }
    setStatus("Сборка HTML…", "info");
    try {
      const logo = await loadLogoDataUrl();
      const html = HtmlNs.buildReportHtmlDocument(doc_, logo, { forPrint: false });
      triggerDownload(new Blob([html], { type: "text/html;charset=utf-8" }), `${(doc_.title || "toir-report").replace(/[<>:"/\\|?*]+/g, "").slice(0, 72) || "toir-report"}.html`);
      setStatus("HTML сохранён.", "info");
    } catch (e) {
      setStatus(`Не удалось собрать HTML: ${e.message}`, "error");
    }
  }

  async function exportDocumentPrint(doc_) {
    const HtmlNs = globalThis.__ReportExportHtml;
    if (!HtmlNs || typeof HtmlNs.buildReportHtmlDocument !== "function") {
      setStatus("Подключите js/report-export-layout.js и js/report-export-html.js.", "error");
      return;
    }
    try {
      const logo = await loadLogoDataUrl();
      const html = HtmlNs.buildReportHtmlDocument(doc_, logo, { forPrint: true });
      const w = window.open("", "_blank", "noopener,noreferrer");
      if (!w) {
        setStatus("Браузер заблокировал окно печати.", "warn");
        return;
      }
      w.document.open();
      w.document.write(html);
      w.document.close();
      w.focus();
      setTimeout(() => {
        try {
          w.print();
        } catch (e2) {
          /* ignore */
        }
      }, 400);
    } catch (e) {
      setStatus(`Печать: ${e.message}`, "error");
    }
  }

  async function exportDocumentDocx(doc_) {
    const base = getApiBase().replace(/\/?$/, "");
    const rid = encodeURIComponent(doc_.report_id);
    setStatus("Загрузка DOCX…", "info");
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const safe = String(doc_.title || "toir-report").replace(/[<>:"/\\|?*]+/g, "").replace(/\s+/g, "-").slice(0, 72) || "toir-report";
      await downloadFromApi(`${base}/${rid}/export/docx`, `${safe}-${stamp}.docx`);
      setStatus("DOCX сохранён.", "info");
    } catch (e) {
      setStatus(`DOCX: ${e.message}`, "error");
    }
  }

  async function exportDocumentPdf(doc_) {
    const base = getApiBase().replace(/\/?$/, "");
    const rid = encodeURIComponent(doc_.report_id);
    setStatus("Загрузка PDF…", "info");
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const safe = String(doc_.title || "toir-report").replace(/[<>:"/\\|?*]+/g, "").replace(/\s+/g, "-").slice(0, 72) || "toir-report";
      await downloadFromApi(`${base}/${rid}/export/pdf`, `${safe}-${stamp}.pdf`);
      setStatus("PDF сохранён.", "info");
    } catch (e) {
      setStatus(`PDF: ${e.message}`, "error");
    }
  }

  function bindExportControls(doc_) {
    const menu = document.getElementById("reportExportMenu");
    const details = document.getElementById("reportExportDropdown");
    if (!menu || !details) return;

    menu.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button[data-export]");
      if (!btn || !menu.contains(btn)) return;
      ev.preventDefault();
      const kind = btn.getAttribute("data-export") || "";

      const run = async () => {
        switch (kind) {
          case "html":
            await exportDocumentHtmlToFile(doc_);
            break;
          case "docx":
            await exportDocumentDocx(doc_);
            break;
          case "pdf":
            await exportDocumentPdf(doc_);
            break;
          case "print":
            await exportDocumentPrint(doc_);
            break;
          default:
            break;
        }
      };

      details.open = false;
      run().catch((e) => setStatus(String((e && e.message) || e), "error"));
    });
  }

  function bindDocControls(doc_) {
    const editTitleBtn = document.getElementById("reportEditTitle");
    if (editTitleBtn) {
      editTitleBtn.addEventListener("click", async () => {
        const next = prompt("Новый заголовок отчёта:", doc_.title || "");
        if (next === null) return;
        const trimmed = String(next).trim();
        if (!trimmed) return;
        try {
          const res = await api(`/${encodeURIComponent(doc_.report_id)}`, {
            method: "PUT",
            body: { title: trimmed },
          });
          STATE.activeDocument = res.report;
          renderDocument(res.report);
          await loadList();
          setStatus("Заголовок обновлён.", "info");
        } catch (e) {
          setStatus(`Не удалось изменить заголовок: ${e.message}`, "error");
        }
      });
    }

    const refreshBtn = document.getElementById("reportRefresh");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", async () => {
        const filters = collectDashboardFilters();
        const sliceHint = `Текущие фильтры дашборда: ${periodLabelRu(filters.period)}, ${classLabelRu(filters.class)}.`;
        if (
          !confirm(
            `${sliceHint}\n\nОбновить снимок по актуальному toir.json и этому срезу? Тексты секций сохранятся, пересчитаются факты; в секциях появятся пометки.`
          )
        )
          return;
        try {
          const res = await api(`/${encodeURIComponent(doc_.report_id)}/refresh_snapshot`, {
            method: "POST",
            body: { filters },
          });
          STATE.activeDocument = res.report;
          renderDocument(res.report);
          await loadList();
          setStatus("Снимок обновлён.", "info");
        } catch (e) {
          setStatus(`Не удалось обновить снимок: ${e.message}`, "error");
        }
      });
    }

    const undoBtn = document.getElementById("reportUndo");
    if (undoBtn) {
      undoBtn.addEventListener("click", async () => {
        if (!confirm("Откатить отчёт на предыдущую ревизию?")) return;
        try {
          const res = await api(`/${encodeURIComponent(doc_.report_id)}/undo`, { method: "POST" });
          STATE.activeDocument = res.report;
          renderDocument(res.report);
          await loadList();
          setStatus("Откат выполнен.", "info");
        } catch (e) {
          setStatus(`Не удалось откатить: ${e.message}`, "error");
        }
      });
    }

    document.querySelectorAll(".report-section-controls button").forEach((btn) => {
      btn.addEventListener("click", async (ev) => {
        const action = btn.dataset.action;
        const card = btn.closest(".report-section");
        if (!card) return;
        const sectionId = card.dataset.sectionId;
        if (action === "edit") return openSectionEditor(doc_, sectionId);
        if (action === "delete") return deleteSection(doc_, sectionId);
        if (action === "move-up") return moveSection(doc_, sectionId, -1);
        if (action === "move-down") return moveSection(doc_, sectionId, 1);
      });
    });

    const aiBtn = document.getElementById("reportAiPlan");
    if (aiBtn) {
      aiBtn.addEventListener("click", async () => {
        const ta = document.getElementById("reportAiInstruction");
        const instruction = (ta && ta.value || "").trim();
        if (!instruction) {
          setStatus("Опишите, что нужно изменить.", "warn");
          return;
        }
        aiBtn.disabled = true;
        setStatus("ИИ строит план правки…", "info");
        try {
          const res = await api(`/${encodeURIComponent(doc_.report_id)}/drafts`, {
            method: "POST",
            body: { instruction },
          });
          openDraftPreview(doc_, res.draft);
        } catch (e) {
          setStatus(`Не удалось получить план правки: ${e.message}`, "error");
        } finally {
          aiBtn.disabled = false;
        }
      });
    }
  }

  function openSectionEditor(doc_, sectionId) {
    const section = (doc_.sections || []).find((s) => s.section_id === sectionId);
    if (!section) return;
    const overlay = createOverlay();
    const dialog = document.createElement("div");
    dialog.className = "report-modal report-modal--editor";
    dialog.innerHTML = `
      <div class="report-modal-head">
        <h3>Редактирование секции «${escapeHtml(section.title || "")}»</h3>
        <button type="button" class="report-modal-close" aria-label="Закрыть">×</button>
      </div>
      <div class="report-modal-body">
        <label>Заголовок секции
          <input type="text" id="editSectionTitle" value="${escapeHtml(section.title || "")}" />
        </label>
        <label>Текст секции (Markdown)
          <textarea id="editSectionBody" rows="12">${escapeHtml(section.body_markdown || "")}</textarea>
        </label>
        <label>Подтверждающие факты (по одному на строку)
          <textarea id="editSectionFacts" rows="4">${escapeHtml((section.fact_bullets || []).join("\n"))}</textarea>
        </label>
        <label>Уверенность
          <select id="editSectionConfidence">
            <option value="high" ${section.confidence === "high" ? "selected" : ""}>Высокая</option>
            <option value="medium" ${section.confidence === "medium" ? "selected" : ""}>Средняя</option>
            <option value="low" ${section.confidence === "low" ? "selected" : ""}>Низкая</option>
          </select>
        </label>
      </div>
      <div class="report-modal-foot">
        <button type="button" class="report-modal-cancel">Отмена</button>
        <button type="button" class="report-modal-save">Сохранить</button>
      </div>
    `;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    dialog.querySelector(".report-modal-close").addEventListener("click", close);
    dialog.querySelector(".report-modal-cancel").addEventListener("click", close);
    dialog.querySelector(".report-modal-save").addEventListener("click", async () => {
      const newTitle = dialog.querySelector("#editSectionTitle").value.trim();
      const newBody = dialog.querySelector("#editSectionBody").value.trim();
      const newFactsRaw = dialog.querySelector("#editSectionFacts").value;
      const newConfidence = dialog.querySelector("#editSectionConfidence").value;
      if (!newTitle || !newBody) {
        setStatus("Заголовок и текст секции не могут быть пустыми.", "warn");
        return;
      }
      const updatedSections = (doc_.sections || []).map((s) => {
        if (s.section_id !== sectionId) return s;
        return Object.assign({}, s, {
          title: newTitle,
          body_markdown: newBody,
          fact_bullets: newFactsRaw.split(/\r?\n/).map((x) => x.trim()).filter(Boolean),
          confidence: newConfidence,
        });
      });
      try {
        const res = await api(`/${encodeURIComponent(doc_.report_id)}`, {
          method: "PUT",
          body: { sections: updatedSections },
        });
        STATE.activeDocument = res.report;
        renderDocument(res.report);
        await loadList();
        close();
        setStatus("Секция обновлена.", "info");
      } catch (e) {
        setStatus(`Не удалось сохранить: ${e.message}`, "error");
      }
    });
  }

  async function deleteSection(doc_, sectionId) {
    if (STATE.mandatory.indexOf(sectionId) !== -1) {
      setStatus("Эта секция обязательная — её нельзя удалить.", "warn");
      return;
    }
    if (!confirm("Удалить эту секцию?")) return;
    const updatedSections = (doc_.sections || []).filter((s) => s.section_id !== sectionId);
    try {
      const res = await api(`/${encodeURIComponent(doc_.report_id)}`, {
        method: "PUT",
        body: { sections: updatedSections },
      });
      STATE.activeDocument = res.report;
      renderDocument(res.report);
      await loadList();
      setStatus("Секция удалена.", "info");
    } catch (e) {
      setStatus(`Не удалось удалить: ${e.message}`, "error");
    }
  }

  async function moveSection(doc_, sectionId, delta) {
    const sections = (doc_.sections || []).slice();
    const idx = sections.findIndex((s) => s.section_id === sectionId);
    if (idx < 0) return;
    const newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= sections.length) return;
    const [item] = sections.splice(idx, 1);
    sections.splice(newIdx, 0, item);
    try {
      const res = await api(`/${encodeURIComponent(doc_.report_id)}`, {
        method: "PUT",
        body: { sections },
      });
      STATE.activeDocument = res.report;
      renderDocument(res.report);
      await loadList();
    } catch (e) {
      setStatus(`Не удалось переместить: ${e.message}`, "error");
    }
  }

  function createOverlay() {
    const overlay = document.createElement("div");
    overlay.className = "report-modal-overlay";
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) overlay.remove();
    });
    return overlay;
  }

  function describeOperation(op, doc_) {
    const sections = (doc_.sections || []);
    const findTitle = (id) => {
      const s = sections.find((x) => x.section_id === id);
      return s ? s.title : id;
    };
    switch (op.operation_type) {
      case "update_title":
        return `Изменить заголовок отчёта на «${op.title || ""}».`;
      case "replace_section":
        return `Переписать секцию «${findTitle(op.section_id)}».`;
      case "insert_section_after":
        return `Добавить новую секцию «${op.title || op.new_section_id}» после «${findTitle(op.after_section_id)}».`;
      case "delete_section":
        return `Удалить секцию «${findTitle(op.section_id)}».`;
      case "move_section":
        return `Переместить секцию «${findTitle(op.section_id)}»${op.after_section_id ? ` после «${findTitle(op.after_section_id)}»` : " в конец"}.`;
      default:
        return op.operation_type;
    }
  }

  function openDraftPreview(doc_, draft) {
    if (!draft) return;
    STATE.pendingDraftPreview = draft;
    const overlay = createOverlay();
    const dialog = document.createElement("div");
    dialog.className = "report-modal report-modal--preview";
    const opsHtml = (draft.operations || [])
      .map((op) => `<li><b>${escapeHtml(op.operation_type)}</b> · ${escapeHtml(describeOperation(op, doc_))}${op.reasoning ? `<div class="report-op-reason">${escapeHtml(op.reasoning)}</div>` : ""}</li>`)
      .join("");
    const previewSectionsHtml = (draft.preview_sections || [])
      .map((s) => `
        <div class="report-preview-section">
          <h4>${escapeHtml(s.title)}</h4>
          <div>${renderMarkdown(s.body_markdown || "")}</div>
          ${s.fact_bullets && s.fact_bullets.length ? `<ul>${s.fact_bullets.map((b) => `<li>${renderInline(b)}</li>`).join("")}</ul>` : ""}
        </div>
      `)
      .join("");
    const warnings = (draft.warnings || []).map((w) => `<div class="report-preview-warning">${escapeHtml(w)}</div>`).join("");
    dialog.innerHTML = `
      <div class="report-modal-head">
        <h3>Превью AI-правки${draft.used_fallback ? " · fallback" : ""}</h3>
        <button type="button" class="report-modal-close" aria-label="Закрыть">×</button>
      </div>
      <div class="report-modal-body">
        <div class="report-preview-instruction"><b>Инструкция:</b> ${escapeHtml(draft.instruction || "")}</div>
        ${warnings ? `<div class="report-preview-warnings">${warnings}</div>` : ""}
        <h4>Что изменится</h4>
        <ul class="report-preview-ops">${opsHtml || "<li>Операций нет.</li>"}</ul>
        <h4>Превью документа</h4>
        <div class="report-preview-sections">${previewSectionsHtml}</div>
      </div>
      <div class="report-modal-foot">
        <button type="button" class="report-modal-cancel">Отклонить</button>
        <button type="button" class="report-modal-save">Применить</button>
      </div>
    `;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    const close = () => {
      STATE.pendingDraftPreview = null;
      overlay.remove();
    };
    dialog.querySelector(".report-modal-close").addEventListener("click", close);
    dialog.querySelector(".report-modal-cancel").addEventListener("click", close);
    dialog.querySelector(".report-modal-save").addEventListener("click", async () => {
      try {
        const res = await api(`/${encodeURIComponent(doc_.report_id)}/drafts/${encodeURIComponent(draft.draft_id)}/apply`, {
          method: "POST",
        });
        STATE.activeDocument = res.report;
        renderDocument(res.report);
        await loadList();
        close();
        setStatus("AI-правка применена.", "info");
      } catch (e) {
        setStatus(`Не удалось применить правку: ${e.message}`, "error");
      }
    });
  }

  async function openReport(reportId) {
    try {
      setStatus("Загрузка отчёта…", "info");
      const res = await api(`/${encodeURIComponent(reportId)}`);
      STATE.activeReportId = reportId;
      STATE.activeDocument = res.report;
      renderDocument(res.report);
      renderList();
      setStatus("", "");
    } catch (e) {
      setStatus(`Не удалось открыть отчёт: ${e.message}`, "error");
    }
  }

  async function createNewReport() {
    const filters = collectDashboardFilters();
    const defaultTitle = `Отчёт ТОиР: ${filters && filters.period === "h1" ? "1-е полугодие 2025" : filters && filters.period === "h2" ? "2-е полугодие 2025" : "12 мес."}` +
      (filters && filters.class && filters.class !== "__all__" ? ` · ${filters.class}` : "");
    const title = prompt("Заголовок отчёта (можно оставить по умолчанию):", defaultTitle);
    if (title === null) return;
    setStatus(
      `Создание отчёта (срез: ${periodLabelRu(filters.period)}, ${classLabelRu(filters.class)})…`,
      "info"
    );
    try {
      const res = await api("/", {
        method: "POST",
        body: { title: title || defaultTitle, filters },
      });
      await loadList();
      await openReport(res.report.report_id);
      setStatus("Отчёт создан.", "info");
    } catch (e) {
      setStatus(`Не удалось создать отчёт: ${e.message}`, "error");
    }
  }

  function ensureWelcomeDelegation() {
    if (STATE.welcomeClickBound) return;
    const reportView = document.getElementById("reportView");
    if (!reportView) return;
    STATE.welcomeClickBound = true;
    reportView.addEventListener("click", (ev) => {
      if (ev.target.closest("#reportWelcomeEditTitle")) {
        ev.preventDefault();
        (async () => {
          try {
            const doc_ = await resolveDocForExport();
            if (!doc_) {
              setStatus("Нет отчёта — сначала создайте отчёт.", "warn");
              return;
            }
            const next = prompt("Новый заголовок отчёта:", doc_.title || "");
            if (next === null) return;
            const trimmed = String(next).trim();
            if (!trimmed) return;
            const res = await api(`/${encodeURIComponent(doc_.report_id)}`, {
              method: "PUT",
              body: { title: trimmed },
            });
            if (STATE.activeReportId === doc_.report_id) {
              STATE.activeDocument = res.report;
              renderDocument(res.report);
            }
            await loadList();
            setStatus("Заголовок обновлён.", "info");
          } catch (e) {
            setStatus(`Не удалось изменить заголовок: ${e.message}`, "error");
          }
        })();
        return;
      }
      if (ev.target.closest("#reportWelcomeRefreshIcon")) {
        ev.preventDefault();
        loadList();
        return;
      }
      if (ev.target.closest("#reportWelcomeUndo")) {
        ev.preventDefault();
        (async () => {
          try {
            const doc_ = await resolveDocForExport();
            if (!doc_) {
              setStatus("Нет отчёта — сначала создайте отчёт.", "warn");
              return;
            }
            if ((doc_.revisions || []).length < 2) {
              setStatus("Нет предыдущей ревизии для отката.", "warn");
              return;
            }
            if (!confirm("Откатить отчёт на предыдущую ревизию?")) return;
            const res = await api(`/${encodeURIComponent(doc_.report_id)}/undo`, { method: "POST" });
            if (STATE.activeReportId === doc_.report_id) {
              STATE.activeDocument = res.report;
              renderDocument(res.report);
            }
            await loadList();
            setStatus("Откат выполнен.", "info");
          } catch (e) {
            setStatus(`Не удалось откатить: ${e.message}`, "error");
          }
        })();
        return;
      }
      const runExport = async (fn) => {
        try {
          const doc_ = await resolveDocForExport();
          if (!doc_) {
            setStatus("Нет отчёта для выгрузки — сначала создайте отчёт.", "warn");
            return;
          }
          await fn(doc_);
        } catch (e) {
          setStatus(String(e.message || e), "error");
        }
      };
      const exportBtn = ev.target.closest("#reportWelcomeExportMenu button[data-export]");
      if (exportBtn) {
        ev.preventDefault();
        const kind = exportBtn.getAttribute("data-export");
        const dd = document.getElementById("reportWelcomeExportDropdown");
        const map = {
          html: exportDocumentHtmlToFile,
          docx: exportDocumentDocx,
          pdf: exportDocumentPdf,
          print: exportDocumentPrint,
        };
        const fn = map[kind];
        if (fn) {
          runExport(fn).then(() => {
            if (dd) dd.open = false;
          });
        }
        return;
      }
    });
  }

  function init(options) {
    if (STATE.initialized) return;
    STATE.initialized = true;
    STATE.getCurrentFilters = (options && options.getCurrentFilters) || null;

    const createBtn = document.getElementById("reportsCreateBtn");
    if (createBtn) createBtn.addEventListener("click", createNewReport);

    const refreshBtn = document.getElementById("reportsRefreshBtn");
    if (refreshBtn) refreshBtn.addEventListener("click", () => loadList());

    ensureWelcomeDelegation();
    loadList().catch(() => {});
    renderEmpty(document.getElementById("reportView"));
  }

  function onTabActivated() {
    loadList()
      .then(() => syncSliceFromDashboard())
      .catch(() => {});
  }

  root.ToirReports = {
    init,
    onTabActivated,
    openReport,
    createNewReport,
    refreshList: loadList,
    syncSliceFromDashboard,
  };
})(typeof window !== "undefined" ? window : globalThis);
