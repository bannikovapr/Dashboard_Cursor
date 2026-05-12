(function (root) {
  "use strict";

  const STATE = {
    apiBase: null,
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
    if (STATE.apiBase) return STATE.apiBase;
    const chatUrl = root.TOIR_API_URL || "";
    if (chatUrl) {
      try {
        const u = new URL(chatUrl);
        STATE.apiBase = `${u.origin}/api/reports`;
        return STATE.apiBase;
      } catch (e) {
        // fallthrough
      }
    }
    STATE.apiBase = "http://localhost:8787/api/reports";
    return STATE.apiBase;
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

  function periodLabelRu(period) {
    if (period === "h1") return "1-е полугодие 2025";
    if (period === "h2") return "2-е полугодие 2025";
    return "Последние 12 мес.";
  }

  function classLabelRu(cls) {
    if (!cls || cls === "__all__") return "Все классы";
    return String(cls);
  }

  function describeLastReportLine() {
    const arr = (STATE.reports || []).slice();
    if (!arr.length) return "Пока нет сохранённых отчётов.";
    arr.sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
    const r = arr[0];
    const cls = r.snapshot && r.snapshot.class_filter && r.snapshot.class_filter !== "__all__"
      ? r.snapshot.class_filter
      : "все классы";
    const per = (r.snapshot && r.snapshot.period_label) || "—";
    return `«${r.title || r.report_id}» · ${per} · ${cls} · ${fmtDate(r.updated_at)} · ред. ${r.revision_count || 0}`;
  }

  function updateWelcomeSlice() {
    const periodEl = document.getElementById("reportSlicePeriod");
    if (!periodEl) return;
    const f = typeof STATE.getCurrentFilters === "function" ? STATE.getCurrentFilters() : {};
    periodEl.textContent = periodLabelRu(f.period);
    const classEl = document.getElementById("reportSliceClass");
    if (classEl) classEl.textContent = classLabelRu(f.class);
    const countEl = document.getElementById("reportSliceCount");
    if (countEl) countEl.textContent = String((STATE.reports || []).length);
    const last = document.getElementById("reportLastLine");
    if (last) last.textContent = describeLastReportLine();
  }

  function syncSliceFromDashboard() {
    const panel = document.getElementById("reportView");
    if (!panel || !panel.classList.contains("report-main--empty")) return;
    updateWelcomeSlice();
  }

  function renderEmpty(panel) {
    if (!panel) return;
    panel.classList.add("report-main--empty");
    panel.innerHTML = `
      <div class="report-welcome">
        <h3 class="report-welcome-title">Отчёт ТОиР</h3>
        <p class="report-welcome-lead">
          Создайте новый отчёт по текущему срезу дашборда (период и класс — как в шапке) или откройте сохранённый слева.
          В снимок входят показатели, автодиагностики <strong>R/K</strong> и текст секций; выгрузка в <strong>HTML</strong>, <strong>DOCX</strong> и <strong>PDF</strong> с оформлением как в редакторе.
          Хранение локально: <code>.reports/</code>.
        </p>
        <div class="report-welcome-grid">
          <div class="report-welcome-actions">
            <div class="report-welcome-buttons">
              <button type="button" id="reportWelcomeCreate" class="btn-primary report-welcome-create">+ Создать отчёт</button>
              <button type="button" id="reportWelcomeRefresh" class="report-welcome-refresh">Обновить список</button>
            </div>
            <ol class="report-welcome-steps">
              <li>Проверьте в шапке дашборда период и класс — отчёт создаётся для этого среза и дальнейших выгрузок.</li>
              <li>Нажмите «Создать» здесь или в боковой панели — при необходимости отредактируйте заголовок.</li>
              <li>Откройте отчёт из списка: правьте секции и уверенность, при необходимости обновите снимок или откатите ревизию; выгрузите документ.</li>
            </ol>
          </div>
          <div class="report-welcome-status">
            <div class="report-slice-cards">
              <div class="report-slice-card">
                <div class="report-slice-label">Текущий период</div>
                <div class="report-slice-value" id="reportSlicePeriod">—</div>
              </div>
              <div class="report-slice-card">
                <div class="report-slice-label">Класс оборудования</div>
                <div class="report-slice-value" id="reportSliceClass">—</div>
              </div>
              <div class="report-slice-card">
                <div class="report-slice-label">Сохранённых отчётов</div>
                <div class="report-slice-value" id="reportSliceCount">0</div>
              </div>
            </div>
            <p class="report-welcome-foot" id="reportLastHint">
              Последний отчёт: <span id="reportLastLine">—</span>
            </p>
          </div>
        </div>
      </div>
    `;
    updateWelcomeSlice();
  }

  async function loadList() {
    try {
      const data = await api("/");
      STATE.reports = data.reports || [];
      STATE.catalog = data.catalog || [];
      STATE.mandatory = data.mandatory || [];
      renderList();
      updateWelcomeSlice();
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
    view.innerHTML = "";

    const head = document.createElement("header");
    head.className = "report-doc-head";
    const snap = document_.snapshot || {};
    const cls = snap.class_filter && snap.class_filter !== "__all__" ? snap.class_filter : "все классы";
    head.innerHTML = `
      <div class="report-doc-titles">
        <h2 id="reportDocTitle">${escapeHtml(document_.title || "")}</h2>
        <div class="report-doc-meta">
          <span>${escapeHtml(snap.period_label || "—")}</span>
          <span>·</span>
          <span>${escapeHtml(cls)}</span>
          <span>·</span>
          <span>обновлён ${fmtDate(document_.updated_at)}</span>
          <span>·</span>
          <span>ревизий: ${(document_.revisions || []).length}</span>
        </div>
      </div>
      <div class="report-doc-head-right">
        <div class="report-doc-actions">
          <button type="button" id="reportEditTitle" title="Изменить заголовок">Заголовок</button>
          <button type="button" id="reportRefresh" title="Обновить снимок по новым данным">Обновить снимок</button>
          <button type="button" id="reportUndo" ${(document_.revisions || []).length < 2 ? "disabled" : ""}>↶ Откатить</button>
        </div>
        <div class="report-export-toolbar" role="group" aria-label="Выгрузка отчёта">
          <span class="report-export-title">Выгрузка</span>
          <button type="button" id="reportExportHtml" class="btn-export">HTML</button>
          <button type="button" id="reportExportDocx" class="btn-export btn-export--primary">DOCX</button>
          <button type="button" id="reportExportPdf" class="btn-export btn-export--primary">PDF</button>
          <button type="button" id="reportPrint" class="btn-export">Печать…</button>
        </div>
      </div>
    `;
    view.appendChild(head);

    const sectionsWrap = document.createElement("section");
    sectionsWrap.className = "report-doc-sections";
    const sections = document_.sections || [];
    sections.forEach((s, idx) => {
      const card = renderSectionCard(s, { idx, isLast: idx === sections.length - 1, controls: true });
      sectionsWrap.appendChild(card);
    });
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
    try {
      const res = await fetch("assets/report-brand-logo.png", { cache: "force-cache" });
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

  function bindExportControls(doc_) {
    const HtmlNs = globalThis.__ReportExportHtml;
    const base = getApiBase().replace(/\/?$/, "");
    const rid = encodeURIComponent(doc_.report_id);

    const htmlBtn = document.getElementById("reportExportHtml");
    if (htmlBtn) {
      htmlBtn.addEventListener("click", async () => {
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
      });
    }

    const printBtn = document.getElementById("reportPrint");
    if (printBtn) {
      printBtn.addEventListener("click", async () => {
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
      });
    }

    async function downloadFromApi(url, filename) {
      const response = await fetch(url, { credentials: "same-origin" });
      if (!response.ok) {
        let msg = `HTTP ${response.status}`;
        try {
          const j = await response.json();
          if (j && j.message) msg = j.message;
        } catch (e) {
          /* ignore */
        }
        throw new Error(msg);
      }
      const blob = await response.blob();
      triggerDownload(blob, filename);
    }

    const docxBtn = document.getElementById("reportExportDocx");
    if (docxBtn) {
      docxBtn.addEventListener("click", async () => {
        setStatus("Загрузка DOCX…", "info");
        try {
          const stamp = new Date().toISOString().slice(0, 10);
          const safe = String(doc_.title || "toir-report").replace(/[<>:"/\\|?*]+/g, "").replace(/\s+/g, "-").slice(0, 72) || "toir-report";
          await downloadFromApi(`${base}/${rid}/export/docx`, `${safe}-${stamp}.docx`);
          setStatus("DOCX сохранён.", "info");
        } catch (e) {
          setStatus(`DOCX: ${e.message}`, "error");
        }
      });
    }

    const pdfBtn = document.getElementById("reportExportPdf");
    if (pdfBtn) {
      pdfBtn.addEventListener("click", async () => {
        setStatus("Загрузка PDF…", "info");
        try {
          const stamp = new Date().toISOString().slice(0, 10);
          const safe = String(doc_.title || "toir-report").replace(/[<>:"/\\|?*]+/g, "").replace(/\s+/g, "-").slice(0, 72) || "toir-report";
          await downloadFromApi(`${base}/${rid}/export/pdf`, `${safe}-${stamp}.pdf`);
          setStatus("PDF сохранён.", "info");
        } catch (e) {
          setStatus(`PDF: ${e.message}`, "error");
        }
      });
    }
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
        if (!confirm("Обновить снимок по текущим данным toir.json? Тексты секций сохранятся, обновятся только подтверждающие факты и появятся пометки в секциях.")) return;
        try {
          const res = await api(`/${encodeURIComponent(doc_.report_id)}/refresh_snapshot`, { method: "POST" });
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
    const filters = (typeof STATE.getCurrentFilters === "function")
      ? STATE.getCurrentFilters()
      : { period: "all", class: "__all__" };
    const defaultTitle = `Отчёт ТОиР: ${filters && filters.period === "h1" ? "1-е полугодие 2025" : filters && filters.period === "h2" ? "2-е полугодие 2025" : "12 мес."}` +
      (filters && filters.class && filters.class !== "__all__" ? ` · ${filters.class}` : "");
    const title = prompt("Заголовок отчёта (можно оставить по умолчанию):", defaultTitle);
    if (title === null) return;
    setStatus("Создание отчёта…", "info");
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
      if (ev.target.closest("#reportWelcomeCreate")) {
        ev.preventDefault();
        createNewReport();
        return;
      }
      if (ev.target.closest("#reportWelcomeRefresh")) {
        ev.preventDefault();
        loadList();
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
