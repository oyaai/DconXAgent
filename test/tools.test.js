/**
 * End-to-end tool tests against a real temp workspace.
 * These are the ones that actually prove "no write without approval".
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { core, createRunner } = require("./harness");
const { runTool, TOOLS, TOOL_SCHEMAS, resetEditSequence } = core("tools/index");
const { DEFAULT_CONFIG } = core("config");

const t = createRunner("tools");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "dconx-test-"));
fs.mkdirSync(path.join(root, "src"), { recursive: true });
fs.writeFileSync(path.join(root, "src", "app.ts"), "const port = 3000;\nexport { port };\n");
fs.writeFileSync(path.join(root, ".env"), "SECRET=hunter2\n");

/** @param {boolean|null} approval null = assert approval is never requested */
function makeCtx(approval) {
  const state = { approvalRequests: 0, events: [] };
  return {
    state,
    ctx: {
      root,
      cfg: DEFAULT_CONFIG.guard,
      requestApproval: async (edit) => {
        state.approvalRequests++;
        state.lastEdit = edit;
        if (approval === null) throw new Error("approval should not have been requested");
        return approval;
      },
      onEvent: (e) => state.events.push(e),
    },
  };
}

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

(async () => {
  resetEditSequence();

  // --- registry invariants
  t.equal(TOOL_SCHEMAS.length, TOOLS.length, "every tool contributes a schema");
  t.ok(
    TOOLS.every((tool) => tool.schema.function.name === tool.name),
    "schema name matches tool name"
  );
  t.ok(
    new Set(TOOLS.map((x) => x.name)).size === TOOLS.length,
    "tool names are unique"
  );
  t.ok(
    TOOLS.every((tool) =>
      (tool.schema.function.parameters.required ?? []).every(
        (k) => k in tool.schema.function.parameters.properties
      )
    ),
    "every required argument is declared in properties"
  );

  // --- read-only tools
  let h = makeCtx(null);
  let out = await runTool("list_files", { dir: ".", recursive: true }, h.ctx);
  t.ok(out.text.includes("src/app.ts"), "list_files finds a nested file");
  t.ok(!out.text.includes(".env"), "list_files hides dotfiles");

  out = await runTool("read_file", { path: "src/app.ts" }, h.ctx);
  t.ok(out.text.includes("const port = 3000;"), "read_file returns content");
  t.ok(out.text.includes("   1 |"), "read_file numbers lines");

  out = await runTool("read_file", { path: ".env" }, h.ctx);
  t.ok(out.text.startsWith("GUARD:"), "read_file refuses a denied path");
  t.ok(out.text.includes("deny pattern"), "guard message names the reason");

  out = await runTool("search_files", { pattern: "port", extensions: "ts" }, h.ctx);
  t.ok(out.text.includes("src/app.ts:1"), "search_files reports path:line");

  out = await runTool("search_files", { pattern: "hunter2" }, h.ctx);
  t.equal(out.text, "No matches.", "search_files never reads denied files");

  // --- unknown tool and bad args degrade into model-readable text
  out = await runTool("rm_rf", {}, h.ctx);
  t.ok(out.text.startsWith('Unknown tool "rm_rf"'), "unknown tool is reported, not thrown");
  out = await runTool("read_file", {}, h.ctx);
  t.ok(out.text.startsWith("GUARD:"), "missing argument becomes a guard message");
  t.equal(h.state.approvalRequests, 0, "no read-only call asked for approval");

  // --- rejection must not touch the disk
  const before = read("src/app.ts");
  h = makeCtx(false);
  out = await runTool(
    "replace_in_file",
    { path: "src/app.ts", search: "3000", replace: "8080" },
    h.ctx
  );
  t.equal(h.state.approvalRequests, 1, "edit asked for approval exactly once");
  t.ok(out.text.startsWith("REJECTED"), "rejection is reported to the model");
  t.ok(out.text.includes("Do not retry"), "rejection tells the model not to retry");
  t.equal(read("src/app.ts"), before, "file is byte-identical after rejection");

  // --- approval writes
  h = makeCtx(true);
  out = await runTool(
    "replace_in_file",
    { path: "src/app.ts", search: "3000", replace: "8080" },
    h.ctx
  );
  t.ok(out.text.startsWith("APPROVED"), "approval is reported to the model");
  t.ok(read("src/app.ts").includes("8080"), "file is written after approval");
  t.ok(
    h.state.events.some((e) => e.type === "applied"),
    "an 'applied' event is emitted"
  );
  t.equal(h.state.lastEdit.kind, "modify", "edit is classified as a modification");

  // --- replace_in_file safety rails
  h = makeCtx(null);
  out = await runTool(
    "replace_in_file",
    { path: "src/app.ts", search: "nowhere", replace: "x" },
    h.ctx
  );
  t.ok(out.text.startsWith("NOT FOUND"), "missing search block is reported, not guessed");

  fs.writeFileSync(path.join(root, "dup.ts"), "a();\na();\n");
  out = await runTool("replace_in_file", { path: "dup.ts", search: "a();", replace: "b();" }, h.ctx);
  t.ok(out.text.startsWith("AMBIGUOUS"), "duplicate search block is refused");
  t.equal(read("dup.ts"), "a();\na();\n", "ambiguous match leaves the file alone");

  // --- create, and the no-op case
  h = makeCtx(true);
  out = await runTool("write_file", { path: "src/new.ts", content: "export const x = 1;\n" }, h.ctx);
  t.ok(out.text.startsWith("APPROVED"), "new file is created after approval");
  t.equal(h.state.lastEdit.kind, "create", "edit is classified as a creation");
  t.equal(read("src/new.ts"), "export const x = 1;\n", "new file has the right content");

  h = makeCtx(null);
  out = await runTool("write_file", { path: "src/new.ts", content: "export const x = 1;\n" }, h.ctx);
  t.ok(out.text.startsWith("GUARD: No change"), "identical content is refused before approval");

  // --- guard applies to writes too
  out = await runTool("write_file", { path: "../escape.ts", content: "x" }, h.ctx);
  t.ok(out.text.startsWith("GUARD:"), "write outside the root is blocked");
  out = await runTool("write_file", { path: ".env", content: "x" }, h.ctx);
  t.ok(out.text.startsWith("GUARD:"), "write to a denied path is blocked");
  t.ok(!fs.existsSync(path.join(root, "..", "escape.ts")), "nothing was written outside the root");

  // --- caps
  const bigCfg = { ...DEFAULT_CONFIG.guard, maxEditLines: 3 };
  out = await runTool(
    "write_file",
    { path: "big.ts", content: "a\nb\nc\nd\ne\n" },
    { ...h.ctx, cfg: bigCfg }
  );
  t.ok(out.text.includes("over the limit"), "oversized edit is blocked by the line cap");

  const noCreate = { ...DEFAULT_CONFIG.guard, allowCreate: false };
  out = await runTool(
    "write_file",
    { path: "nope.ts", content: "x\n" },
    { ...h.ctx, cfg: noCreate }
  );
  t.ok(out.text.includes("creating new files is disabled"), "allowCreate=false blocks creation");

  // --- completion
  out = await runTool("attempt_completion", { summary: "all done" }, h.ctx);
  t.equal(out.done, true, "attempt_completion ends the turn");
  t.equal(out.text, "all done", "summary is passed through");

  fs.rmSync(root, { recursive: true, force: true });
  process.exit(t.finish() ? 1 : 0);
})();
