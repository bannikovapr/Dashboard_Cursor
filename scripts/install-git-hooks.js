"use strict";

const { execSync } = require("child_process");

function main() {
  execSync("git config core.hooksPath .githooks", { stdio: "inherit" });
  console.log("[HOOKS] core.hooksPath set to .githooks");
}

main();

