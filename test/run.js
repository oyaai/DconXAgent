/**
 * Bundles the vscode-free core modules and runs every *.test.js beside this file.
 *
 * `npm test` needs no VS Code and no test framework, which is what makes the
 * guardrail suites cheap enough to run on every change.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const tmp = path.join(root, ".tmp");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

const ENTRIES = [
  "src/core/diff.ts",
  "src/core/glob.ts",
  "src/core/guard.ts",
  "src/core/config.ts",
  "src/core/tools/index.ts",
];

fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });

execFileSync(
  npx,
  [
    "esbuild",
    ...ENTRIES,
    "--bundle",
    "--format=cjs",
    "--platform=node",
    "--outbase=src/core",
    `--outdir=${tmp}`,
    "--out-extension:.js=.cjs",
    "--log-level=error",
  ],
  { stdio: "inherit", cwd: root }
);

const suites = fs
  .readdirSync(__dirname)
  .filter((f) => f.endsWith(".test.js"))
  .sort();

let failed = 0;
for (const suite of suites) {
  console.log(`\n${suite}`);
  try {
    execFileSync(process.execPath, [path.join(__dirname, suite)], { stdio: "inherit" });
  } catch {
    failed++;
  }
}

console.log(failed === 0 ? "\nAll suites passed." : `\n${failed} suite(s) failed.`);
process.exit(failed ? 1 : 0);
