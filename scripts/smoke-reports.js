"use strict";

const path = require("path");
const fs = require("fs");

const SMOKE_PREFIX = "[SMOKE][reports]";

function fail(message, extra) {
  console.error(`${SMOKE_PREFIX} FAIL: ${message}`);
  if (extra != null) {
    if (typeof extra === "string") console.error(extra);
    else console.error(JSON.stringify(extra, null, 2));
  }
  process.exit(1);
}

function pass(message) {
  console.log(`${SMOKE_PREFIX} OK: ${message}`);
}

function assert(condition, message, extra) {
  if (!condition) fail(message, extra);
}

const service = require("../server/reports/service");
const config = require("../server/reports/config");
const storage = require("../server/reports/storage");
const schemas = require("../server/reports/schemas");
const facts = require("../server/reports/facts");

(async () => {
  const createdIds = [];

  try {
    // 1) Module exports
    assert(typeof service.createReport === "function", "service.createReport must be async function");
    assert(typeof service.planEdit === "function", "service.planEdit must be a function");
    assert(typeof service.applyEditDraft === "function", "service.applyEditDraft must be a function");
    assert(typeof service.undoLastRevision === "function", "service.undoLastRevision must be a function");
    assert(typeof service.refreshSnapshot === "function", "service.refreshSnapshot must be a function");
    pass("service exports all expected functions");

    // 2) Catalog and mandatory
    assert(Array.isArray(config.REPORT_SECTION_CATALOG) && config.REPORT_SECTION_CATALOG.length === 9,
      `expected 9 sections in catalog, got ${(config.REPORT_SECTION_CATALOG || []).length}`);
    assert(config.REPORT_MANDATORY_SECTION_IDS.includes("passport"), "passport must be mandatory");
    assert(config.REPORT_MANDATORY_SECTION_IDS.includes("data_limitations"), "data_limitations must be mandatory");
    pass("config catalog and mandatory ids are valid");

    // 3) Build fact pack
    const rawData = service.loadRawData();
    const factPack = facts.buildFactPack(rawData, { period: "all", class: "__all__" });
    assert(factPack && factPack.kpis && Number.isFinite(Number(factPack.kpis.total_cost)),
      "fact pack must include kpis.total_cost");
    assert(factPack.diagnostics_summary && factPack.diagnostics_summary.summary,
      "fact pack must include diagnostics_summary.summary");
    pass(`fact pack: total_cost=${factPack.kpis.total_cost}, diagnostics triggered=${factPack.diagnostics_summary.summary.triggered}`);

    // 4) Create report (fallback mode — no LLM)
    const created = await service.createReport({ filters: { period: "all", class: "__all__" } });
    createdIds.push(created.report_id);
    assert(created.report_id && /^rpt_/.test(created.report_id), "report_id must start with rpt_");
    assert(Array.isArray(created.sections) && created.sections.length === 9,
      `expected 9 sections, got ${(created.sections || []).length}`);
    const sectionIds = new Set(created.sections.map((s) => s.section_id));
    for (const mand of config.REPORT_MANDATORY_SECTION_IDS) {
      assert(sectionIds.has(mand), `mandatory section ${mand} missing from created report`);
    }
    assert(created.revisions.length === 1 && created.revisions[0].author_type === "system",
      "first revision must have author_type=system");
    pass(`created report ${created.report_id}: 9 sections, 1 revision`);

    // 5) List and load
    const list = service.listReports();
    assert(Array.isArray(list) && list.find((r) => r.report_id === created.report_id),
      "listReports must include the new report");
    const loaded = service.loadReport(created.report_id);
    assert(loaded.report_id === created.report_id, "load mismatch");
    pass("list and load work");

    // 6) Manual edit (PUT)
    const updatedSections = loaded.sections.map((s) => {
      if (s.section_id !== "executive_summary") return s;
      return Object.assign({}, s, {
        body_markdown: s.body_markdown + "\n\nДополнительный комментарий пользователя.",
      });
    });
    const manualEdited = service.saveManualEdit(created.report_id, { sections: updatedSections });
    assert(manualEdited.revisions.length === 2, `expected 2 revisions after manual edit, got ${manualEdited.revisions.length}`);
    assert(manualEdited.revisions[1].author_type === "manual", "manual revision must have author_type=manual");
    pass(`manual edit added revision (total=${manualEdited.revisions.length})`);

    // 7) Validation rejects deleting mandatory section
    let rejected = false;
    try {
      service.saveManualEdit(created.report_id, {
        sections: manualEdited.sections.filter((s) => s.section_id !== "passport"),
      });
    } catch (e) {
      rejected = true;
    }
    assert(rejected, "validateSections must reject removal of mandatory section passport");
    pass("validateSections correctly rejects removal of mandatory section");

    // 8) plan_edit fallback (without LLM)
    const draft = await service.planEdit(created.report_id, "Убери раздел про персонал");
    assert(draft && Array.isArray(draft.operations) && draft.operations.length >= 1,
      "draft must contain at least one operation");
    assert(draft.used_fallback === true || typeof draft.used_fallback === "boolean",
      "draft must have used_fallback flag");
    assert(Array.isArray(draft.preview_sections) && draft.preview_sections.length >= 1,
      "draft must contain preview_sections");
    pass(`draft built: ${draft.operations.length} ops, used_fallback=${draft.used_fallback}`);

    // 9) Apply draft
    const afterApply = service.applyEditDraft(created.report_id, draft.draft_id);
    assert(afterApply.revisions.length >= 3, "after apply must have at least 3 revisions");
    assert(afterApply.revisions[afterApply.revisions.length - 1].author_type === "ai",
      "last revision after apply must have author_type=ai");
    assert((afterApply.pending_drafts || []).length === 0, "applied draft must be removed from pending");
    const personnelStillThere = afterApply.sections.find((s) => s.section_id === "personnel");
    if (draft.operations.some((op) => op.operation_type === "delete_section" && op.section_id === "personnel")) {
      assert(!personnelStillThere, "personnel section must be removed after apply");
      pass("draft applied: personnel section removed");
    } else {
      pass("draft applied with non-delete operation");
    }

    // 10) Apply draft cannot delete mandatory section
    let mandatoryRejected = false;
    try {
      service.applyOperations(afterApply.title, afterApply.sections, [
        { operation_type: "delete_section", section_id: "passport" },
      ]);
    } catch (e) {
      mandatoryRejected = true;
    }
    assert(mandatoryRejected, "applyOperations must reject delete of mandatory section");
    pass("applyOperations rejects delete of mandatory section");

    // 11) Undo
    const beforeUndo = service.loadReport(created.report_id);
    const undone = service.undoLastRevision(created.report_id);
    assert(undone.revisions.length === beforeUndo.revisions.length - 1,
      `undo must remove last revision (was ${beforeUndo.revisions.length}, became ${undone.revisions.length})`);
    pass(`undo: revisions ${beforeUndo.revisions.length} -> ${undone.revisions.length}`);

    // 12) Refresh snapshot
    const refreshed = service.refreshSnapshot(created.report_id);
    assert(refreshed.revisions[refreshed.revisions.length - 1].author_type === "system",
      "refresh must add system revision");
    const nonPassportSection = refreshed.sections.find(
      (s) => s.section_id !== "passport" && s.section_id !== "data_limitations"
    );
    assert(
      nonPassportSection && (nonPassportSection.warnings || []).some((w) => w.includes("Снимок обновлён")),
      "refresh must add warning to non-passport sections"
    );
    pass("refresh_snapshot adds warning to non-passport sections");

    // 13) Delete
    const deleted = service.deleteReport(created.report_id);
    assert(deleted, "deleteReport must return true for existing report");
    let notFoundRejected = false;
    try {
      service.loadReport(created.report_id);
    } catch (e) {
      notFoundRejected = e.code === "REPORT_NOT_FOUND";
    }
    assert(notFoundRejected, "loaded after delete must throw REPORT_NOT_FOUND");
    createdIds.length = 0;
    pass("delete works and load throws REPORT_NOT_FOUND");

    // 14) Filter snapshot reflects period
    const h1 = await service.createReport({ filters: { period: "h1", class: "__all__" } });
    createdIds.push(h1.report_id);
    assert(h1.snapshot.period === "h1", `h1 snapshot.period must be 'h1', got '${h1.snapshot.period}'`);
    assert(h1.fact_pack.snapshot_summary.months_count === 6,
      `h1 must have 6 months, got ${h1.fact_pack.snapshot_summary.months_count}`);
    service.deleteReport(h1.report_id);
    createdIds.length = 0;
    pass("filter h1 reflects in snapshot.period and months_count");

    // 15) replace_section: модель может передать русский заголовок вместо section_id
    const titleMatchReport = await service.createReport({ filters: { period: "all", class: "__all__" } });
    createdIds.push(titleMatchReport.report_id);
    const tplTitle = "Затраты ТОиР: масштаб и динамика";
    const sectionsClone = schemas.cloneSections(titleMatchReport.sections);
    service.applyOperations(titleMatchReport.title, sectionsClone, [
      {
        operation_type: "replace_section",
        section_id: tplTitle,
        title: `Тест ${tplTitle}`,
      },
    ]);
    const costAfter = sectionsClone.find((s) => s.section_id === "costs_and_trend");
    assert(
      costAfter && String(costAfter.title || "").startsWith("Тест "),
      "replace_section must resolve human-readable title to section_id"
    );
    service.deleteReport(titleMatchReport.report_id);
    createdIds.length = 0;
    pass("applyOperations resolves section_id from current section title");

    // 16) Path traversal protection in storage
    let pathRejected = false;
    try {
      storage.loadDocument("../etc/passwd");
    } catch (e) {
      pathRejected = true;
    }
    assert(pathRejected, "storage must reject path traversal in report_id");
    pass("storage rejects path traversal");

    console.log(`${SMOKE_PREFIX} ALL OK`);
    process.exit(0);
  } catch (e) {
    // cleanup any leaked reports
    for (const id of createdIds) {
      try {
        service.deleteReport(id);
      } catch (_) {}
    }
    fail(`unexpected: ${e.message}`, e.stack);
  }
})();
