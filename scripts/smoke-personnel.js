"use strict";

const fs = require("fs");
const path = require("path");

const SMOKE_PREFIX = "[SMOKE][personnel]";

function fail(message, extra) {
  console.error(`${SMOKE_PREFIX} FAIL: ${message}`);
  if (extra != null) {
    if (typeof extra === "string") console.error(extra);
    else console.error(JSON.stringify(extra, null, 2));
  }
  process.exit(1);
}

function readText(relPath) {
  const abs = path.resolve(__dirname, "..", relPath);
  try {
    return fs.readFileSync(abs, "utf-8");
  } catch (e) {
    fail(`cannot read ${relPath}`, String(e && e.message ? e.message : e));
  }
}

function readJson(relPath) {
  const text = readText(relPath);
  try {
    return JSON.parse(text);
  } catch (e) {
    fail(`invalid JSON in ${relPath}`, String(e && e.message ? e.message : e));
  }
}

function extractFunction(source, functionName) {
  const marker = `function ${functionName}(`;
  const start = source.indexOf(marker);
  if (start < 0) {
    throw new Error(`function not found: ${functionName}`);
  }

  const bodyStart = source.indexOf("{", start);
  if (bodyStart < 0) {
    throw new Error(`function body start not found: ${functionName}`);
  }

  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`function body end not found: ${functionName}`);
}

function loadAppFunctions() {
  const source = readText("js/toir-app.js");
  const fnNames = [
    "classifyClass",
    "detectIntentFromQuestion",
    "topEquipmentCosts",
    "classCostSummary",
    "aiAnswer",
  ];
  const loaded = {};
  for (const name of fnNames) {
    const fnText = extractFunction(source, name);
    loaded[name] = eval(`(${fnText})`);
  }
  return loaded;
}

function assertIntentCases(detectIntentFromQuestion) {
  const intentCases = [
    {
      question: "\u0421\u043a\u043e\u043b\u044c\u043a\u043e \u0440\u0435\u043c\u043e\u043d\u0442\u043e\u0432 \u0441\u0434\u0435\u043b\u0430\u043b\u0438 \u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u0438 \u0437\u0430 \u0433\u043e\u0434?",
      expected: "personnel_repair_workload",
    },
    {
      question: "\u041f\u043e\u043a\u0430\u0436\u0438 \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u043d\u044b\u0435 \u0440\u0430\u0431\u043e\u0442\u044b \u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u043e\u0432",
      expected: "personnel_repair_workload",
    },
    {
      question: "\u041a\u0430\u043a\u0430\u044f \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u043f\u0435\u0440\u0441\u043e\u043d\u0430\u043b\u0430 \u043f\u043e \u0440\u0435\u043c\u043e\u043d\u0442\u0430\u043c?",
      expected: "personnel_repair_workload",
    },
    {
      question: "\u0421\u0442\u0440\u0443\u043a\u0442\u0443\u0440\u0430 \u0440\u0430\u0431\u043e\u0442 \u043f\u043e \u043c\u0435\u0441\u044f\u0446\u0430\u043c",
      expected: "material_labor_structure",
    },
    {
      question: "\u0420\u0435\u043c\u043e\u043d\u0442\u044b \u043f\u043e \u043c\u0435\u0441\u044f\u0446\u0430\u043c",
      expected: "material_labor_structure",
    },
    {
      question: "\u041f\u043e\u043a\u0430\u0436\u0438 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0443 \u043f\u0435\u0440\u0441\u043e\u043d\u0430\u043b\u0430 \u043f\u043e \u043e\u0440\u0433\u0430\u043d\u0438\u0437\u0430\u0446\u0438\u044f\u043c",
      expected: "personnel_org_breakdown",
    },
    {
      question: "\u041a\u0430\u043a\u043e\u0435 \u043f\u043e\u0434\u0440\u0430\u0437\u0434\u0435\u043b\u0435\u043d\u0438\u0435 \u043b\u0438\u0434\u0438\u0440\u0443\u0435\u0442 \u043f\u043e \u0444\u0430\u043a\u0442\u0443 \u0440\u0430\u0431\u043e\u0442?",
      expected: "personnel_org_breakdown",
    },
  ];

  const results = [];
  for (const testCase of intentCases) {
    const actual = detectIntentFromQuestion(testCase.question);
    results.push({
      question: testCase.question,
      expected: testCase.expected,
      actual,
      ok: actual === testCase.expected,
    });
    if (actual !== testCase.expected) {
      fail("intent mismatch", {
        question: testCase.question,
        expected: testCase.expected,
        actual,
      });
    }
  }
  return results;
}

function assertNoDlpTitles(personnelData) {
  const banned = /\u041f\u0440\u043e\u0432\u0435\u0440\u043a\u0430\s+DLP/i;
  const titles = [personnelData?.table?.title, personnelData?.chart?.title].map((x) => String(x || ""));
  const bad = titles.find((t) => banned.test(t));
  if (bad) {
    fail("found banned title token", { title: bad });
  }
  return titles;
}

function assertPersonnelAnswer(aiAnswer, toirData, personnelData) {
  const data = { ...toirData, personnel: personnelData };
  const question = "\u0421\u043a\u043e\u043b\u044c\u043a\u043e \u0440\u0435\u043c\u043e\u043d\u0442\u043e\u0432 \u0432\u044b\u043f\u043e\u043b\u043d\u0438\u043b\u0438 \u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u0438 \u0437\u0430 \u0433\u043e\u0434?";
  const answer = aiAnswer(question, data);
  if (!answer || typeof answer !== "object") {
    fail("aiAnswer returned invalid value", answer);
  }
  const requiredFields = ["fact", "conclusion", "action"];
  for (const field of requiredFields) {
    if (!answer[field] || !String(answer[field]).trim()) {
      fail("aiAnswer missed required field", { field, answer });
    }
  }

  const relationRegex =
    /\u0441\u0442\u0440\u0443\u043a\u0442\u0443\u0440[\u0430-\u044f]*\s+\u0440\u0430\u0431\u043e\u0442\s+\u043f\u043e\s+\u043c\u0435\u0441\u044f\u0446/i;
  const joined = `${answer.fact} ${answer.action}`;
  if (!relationRegex.test(joined)) {
    fail("answer does not link personnel slice with monthly work structure", answer);
  }

  return answer;
}

function assertPersonnelOrgAnswer(aiAnswer, toirData, personnelOrgData) {
  const data = { ...toirData, personnelByOrganization: personnelOrgData };
  const question = "\u041a\u0430\u043a\u0430\u044f \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u043f\u0435\u0440\u0441\u043e\u043d\u0430\u043b\u0430 \u043f\u043e \u043e\u0440\u0433\u0430\u043d\u0438\u0437\u0430\u0446\u0438\u044f\u043c \u0438 \u043f\u043e\u0434\u0440\u0430\u0437\u0434\u0435\u043b\u0435\u043d\u0438\u044f\u043c?";
  const answer = aiAnswer(question, data);
  if (!answer || typeof answer !== "object") {
    fail("aiAnswer (org breakdown) returned invalid value", answer);
  }
  const requiredFields = ["fact", "conclusion", "action"];
  for (const field of requiredFields) {
    if (!answer[field] || !String(answer[field]).trim()) {
      fail("aiAnswer (org breakdown) missed required field", { field, answer });
    }
  }

  const joined = `${answer.fact} ${answer.conclusion}`.toLowerCase();
  if (!/организац|подраздел/.test(joined)) {
    fail("org breakdown answer does not mention organization/department slice", answer);
  }

  return answer;
}

function run() {
  const appFns = loadAppFunctions();

  global.detectIntentFromQuestion = appFns.detectIntentFromQuestion;
  global.topEquipmentCosts = appFns.topEquipmentCosts;
  global.classifyClass = appFns.classifyClass;
  global.classCostSummary = appFns.classCostSummary;
  global.U = {
    formatCount: (v) => String(v),
    formatMoneyMln: (v) => String(v),
  };

  const toirData = readJson("data/toir.json");
  const personnelData = readJson("data/personnel_dlp_test.json");
  const personnelOrgData = readJson("data/personnel_org_usage.json");

  const intentResults = assertIntentCases(appFns.detectIntentFromQuestion);
  const titles = assertNoDlpTitles(personnelData);
  const answer = assertPersonnelAnswer(appFns.aiAnswer, toirData, personnelData);
  const orgAnswer = assertPersonnelOrgAnswer(appFns.aiAnswer, toirData, personnelOrgData);

  console.log(`${SMOKE_PREFIX} OK`);
  console.log(
    JSON.stringify(
      {
        intentChecks: intentResults,
        titlesChecked: titles,
        answerPreview: {
          fact: String(answer.fact || "").slice(0, 220),
          conclusion: String(answer.conclusion || "").slice(0, 160),
          action: String(answer.action || "").slice(0, 160),
        },
        orgAnswerPreview: {
          fact: String(orgAnswer.fact || "").slice(0, 220),
          conclusion: String(orgAnswer.conclusion || "").slice(0, 160),
          action: String(orgAnswer.action || "").slice(0, 160),
        },
      },
      null,
      2
    )
  );
}

run();
