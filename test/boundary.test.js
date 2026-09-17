/**
 * Architecture guard: src/core must stay free of the VS Code API.
 *
 * This is what keeps the logic testable without an editor. If this fails, the
 * fix is to move the VS Code call into src/vscode and pass the value in.
 */

const fs = require("fs");
const path = require("path");
const { createRunner } = require("./harness");

const t = createRunner("boundary");
const coreDir = path.join(__dirname, "..", "src", "core");

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith(".ts")) acc.push(p);
  }
  return acc;
}

const files = walk(coreDir);
t.ok(files.length > 0, "found core modules to check");

for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const rel = path.relative(path.join(__dirname, ".."), file).split(path.sep).join("/");
  t.ok(!/from\s+["']vscode["']/.test(src), `${rel} does not import vscode`);
  t.ok(!/require\(["']vscode["']\)/.test(src), `${rel} does not require vscode`);
}

// The approval chokepoint: only editGate.ts may write files.
const writers = files.filter(
  (f) => /fs\.writeFile\b/.test(fs.readFileSync(f, "utf8")) && !f.endsWith("editGate.ts")
);
t.equal(writers.length, 0, "editGate.ts is the only module in core that writes files");

process.exit(t.finish() ? 1 : 0);
