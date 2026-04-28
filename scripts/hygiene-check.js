"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const args = new Set(process.argv.slice(2));
const stagedOnly = args.has("--staged");

const TEXT_EXTENSIONS = new Set([
  ".js", ".cjs", ".mjs",
  ".json", ".md", ".txt",
  ".yml", ".yaml",
  ".env", ".example",
  ".ps1", ".cmd", ".sh",
  ".html", ".css", ".py",
]);

const IGNORE_PATHS = new Set([
  ".env",
]);

const IGNORE_PREFIXES = [
  "node_modules/",
  ".git/",
  "tmp/",
  "logs/",
  "kit/",
  "scripts/__pycache__/",
];

const RULES = [
  {
    id: "merge_conflict_markers",
    description: "Unresolved merge conflict markers",
    regex: /^(<<<<<<<|=======|>>>>>>>)( .+)?$/m,
    appliesTo: () => true,
  },
  {
    id: "openrouter_api_key",
    description: "Possible OpenRouter API key",
    regex: /\bsk-or-v1-[A-Za-z0-9_-]{16,}\b/g,
    appliesTo: () => true,
  },
  {
    id: "bearer_token",
    description: "Possible bearer token",
    regex: /\bBearer\s+[A-Za-z0-9\-._~+/]{16,}=*\b/gi,
    appliesTo: () => true,
  },
  {
    id: "private_key_block",
    description: "Private key block detected",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/g,
    appliesTo: (filePath) => !filePath.endsWith(".js"),
  },
  {
    id: "hardcoded_openrouter_env",
    description: "Hardcoded OPENROUTER_API_KEY value",
    regex: /^OPENROUTER_API_KEY=(.+)$/gm,
    appliesTo: (filePath) => filePath.endsWith(".env") || filePath.endsWith(".env.example"),
    ignoreMatch: (match) => {
      const val = String(match[1] || "").trim();
      return !val || /^your_openrouter_key_here$/i.test(val) || /^\$\{.+\}$/.test(val);
    },
  },
  {
    id: "hardcoded_dlp_master_key",
    description: "Hardcoded DLP master key value",
    regex: /^DLP_MASTER_KEY(?:_B64|_HEX)?=(.+)$/gm,
    appliesTo: (filePath) => filePath.endsWith(".env") || filePath.endsWith(".env.example"),
    ignoreMatch: (match) => {
      const val = String(match[1] || "").trim();
      return !val || /^\$\{.+\}$/.test(val);
    },
  },
];

function run(cmd) {
  const parts = String(cmd || "").trim().split(/\s+/);
  const exe = parts[0];
  const args = parts.slice(1);
  const out = spawnSync(exe, args, {
    encoding: "utf8",
    windowsHide: true,
  });
  if (out.error) throw out.error;
  if (out.status !== 0) {
    throw new Error((out.stderr || out.stdout || `command failed: ${cmd}`).slice(0, 300));
  }
  return out.stdout || "";
}

function listCandidateFiles() {
  try {
    if (stagedOnly) {
      const out = run("git diff --cached --name-only --diff-filter=ACMR");
      return out.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    }
    const out = run("git ls-files");
    return out.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  } catch (e) {
    const reason = String(e && e.message ? e.message : e);
    console.warn(`[HYGIENE] git file listing unavailable, fallback to filesystem scan: ${reason}`);
    return walkFilesystem(process.cwd()).map((abs) => path.relative(process.cwd(), abs).replace(/\\/g, "/"));
  }
}

function walkFilesystem(rootDir) {
  const out = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      const rel = path.relative(rootDir, abs).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        if (!shouldIgnoreFile(`${rel}/`)) stack.push(abs);
        continue;
      }
      out.push(abs);
    }
  }
  return out;
}

function shouldIgnoreFile(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  if (IGNORE_PATHS.has(normalized)) return true;
  return IGNORE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function isLikelyText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  const base = path.basename(filePath).toLowerCase();
  if (base === ".env" || base === ".env.example") return true;
  return false;
}

function readTextSafe(absPath) {
  try {
    const buf = fs.readFileSync(absPath);
    if (buf.includes(0)) return null;
    return buf.toString("utf8");
  } catch {
    return null;
  }
}

function lineNumberAt(text, index) {
  if (index <= 0) return 1;
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function collectIssues(files) {
  const issues = [];
  for (const relPath of files) {
    const normalized = relPath.replace(/\\/g, "/");
    if (shouldIgnoreFile(normalized)) continue;
    if (!isLikelyText(normalized)) continue;

    const absPath = path.resolve(process.cwd(), relPath);
    const text = readTextSafe(absPath);
    if (text == null) continue;

    for (const rule of RULES) {
      if (!rule.appliesTo(normalized)) continue;
      rule.regex.lastIndex = 0;
      let match = rule.regex.exec(text);
      while (match) {
        if (!rule.ignoreMatch || !rule.ignoreMatch(match, normalized)) {
          const idx = typeof match.index === "number" ? match.index : 0;
          const line = lineNumberAt(text, idx);
          issues.push({
            file: normalized,
            line,
            rule: rule.id,
            description: rule.description,
            sample: String(match[0] || "").slice(0, 120),
          });
        }
        if (!rule.regex.global) break;
        match = rule.regex.exec(text);
      }
    }
  }
  return issues;
}

function printIssues(issues) {
  console.error("[HYGIENE] Secret policy violations found:");
  for (const issue of issues) {
    console.error(`- ${issue.file}:${issue.line} [${issue.rule}] ${issue.description}`);
    if (issue.sample) console.error(`  sample: ${issue.sample}`);
  }
}

function main() {
  let files;
  try {
    files = listCandidateFiles();
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    console.error(`[HYGIENE] Failed to list files: ${msg}`);
    process.exit(2);
  }

  const issues = collectIssues(files);
  if (issues.length > 0) {
    printIssues(issues);
    process.exit(1);
  }

  console.log(
    `[HYGIENE] OK (${stagedOnly ? "staged" : "tracked"} files scanned: ${files.length})`
  );
}

main();
