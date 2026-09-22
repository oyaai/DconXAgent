/**
 * Bundles the vscode-free core modules and runs every *.test.js beside this file.
 *
 * Uses esbuild's Node API rather than spawning `npx`: spawning a .cmd shim from
 * Node on Windows fails with EINVAL, and going through the API is faster anyway.
 * Suites are run with process.execPath (node itself), never a shell.
 */

const { execFileSync } = require("child_process");
const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const tmp = path.join(root, ".tmp");

/** Entry points bundled for the suites. Add one when a new core module needs testing. */
const ENTRIES = [
  "src/core/diff.ts",
  "src/core/glob.ts",
  "src/core/guard.ts",
  "src/core/commandGuard.ts",
  "src/core/config.ts",
  "src/core/prompt.ts",
  "src/core/ollama.ts",
  "src/core/agent.ts",
  "src/core/tools/index.ts",
];

// Best-effort clean. A stale .tmp is harmless (esbuild overwrites), and on some
// mounted/locked filesystems removing the directory itself fails with EPERM —
// which must not take the test run down with it.
try {
  fs.rmSync(tmp, { recursive: true, force: true });
} catch {
  /* fall through: the bundle step overwrites whatever is there */
}
fs.mkdirSync(tmp, { recursive: true });

esbuild.buildSync({
  entryPoints: ENTRIES.map((e) => path.join(root, e)),
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node18",
  outbase: path.join(root, "src", "core"),
  outdir: tmp,
  outExtension: { ".js": ".cjs" },
  logLevel: "error",
});

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
