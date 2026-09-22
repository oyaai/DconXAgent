/**
 * End-to-end tool tests against a real temp workspace.
 * These are the ones that actually prove "no write without approval".
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { core, createRunner } = require("./harness");
const { runTool, TOOLS, TOOL_SCHEMAS, resetEditSequence, resetCommandSequence } = core("tools/index");
const { DEFAULT_CONFIG } = core("config");

const t = createRunner("tools");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "dconx-test-"));
fs.mkdirSync(path.join(root, "src"), { recursive: true });
fs.writeFileSync(path.join(root, "src", "app.ts"), "const port = 3000;\nexport { port };\n");
fs.writeFileSync(path.join(root, ".env"), "SECRET=hunter2\n");

/**
 * @param {boolean|null} approval what the user "clicks"; null asserts nothing is ever asked
 * @param {object} [ports] optional editor/shell stubs
 */
function makeCtx(approval, ports = {}) {
  const state = { approvalRequests: 0, commandRequests: 0, events: [], ran: [] };
  const answer = (what) => {
    if (approval === null) throw new Error(`approval should not have been requested for ${what}`);
    return approval;
  };
  return {
    state,
    ctx: {
      root,
      cfg: DEFAULT_CONFIG.guard,
      approve: {
        requestEdit: async (edit) => {
          state.approvalRequests++;
          state.lastEdit = edit;
          return answer("an edit");
        },
        requestCommand: async (command) => {
          state.commandRequests++;
          state.lastCommand = command;
          return answer("a command");
        },
      },
      editor: {
        getActiveEditor: () => ports.activeEditor,
        getOpenFiles: () => ports.openFiles ?? [],
        getDiagnostics: (rel) =>
          (ports.diagnostics ?? []).filter((d) => !rel || d.relPath === rel),
      },
      shell: {
        run: async (executable, args) => {
          state.ran.push([executable, ...args].join(" "));
          return ports.result ?? { exitCode: 0, stdout: "ok", stderr: "", timedOut: false };
        },
      },
      onEvent: (e) => state.events.push(e),
    },
  };
}

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

(async () => {
  resetEditSequence();
  resetCommandSequence();

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

  // --- creating a new file is auto-approved (default), modifying is not
  h = makeCtx(null); // null asserts the user is never asked
  out = await runTool("write_file", { path: "src/new.ts", content: "export const x = 1;\n" }, h.ctx);
  t.ok(out.text.startsWith("CREATED"), "a new file is written without approval");
  t.equal(h.state.approvalRequests, 0, "creating a file does not interrupt the user");
  t.equal(read("src/new.ts"), "export const x = 1;\n", "new file has the right content");

  const autoEvent = h.state.events.find((e) => e.type === "autoCreated");
  t.ok(autoEvent !== undefined, "an autoCreated event is emitted so the UI can offer Undo");
  t.equal(autoEvent.relPath, "src/new.ts", "the event names the file");
  t.equal(autoEvent.content, "export const x = 1;\n", "the event carries the exact bytes written");

  // Auto-approval must never leak into overwriting existing work.
  const guardedContent = read("src/app.ts");
  h = makeCtx(false);
  out = await runTool("write_file", { path: "src/app.ts", content: "wiped\n" }, h.ctx);
  t.equal(h.state.approvalRequests, 1, "modifying an existing file still asks");
  t.ok(out.text.startsWith("REJECTED"), "the modification was refusable");
  t.equal(read("src/app.ts"), guardedContent, "the existing file is untouched after rejection");

  // Nested directories are created along the way.
  h = makeCtx(null);
  out = await runTool(
    "write_file",
    { path: "deep/nested/dir/file.ts", content: "export {};\n" },
    h.ctx
  );
  t.ok(out.text.startsWith("CREATED"), "a file in a new directory tree is created");
  t.equal(read("deep/nested/dir/file.ts"), "export {};\n", "nested file has the right content");

  // With auto-create off, a new file goes back through approval.
  const manualCfg = { ...DEFAULT_CONFIG.guard, autoApproveCreate: false };
  h = makeCtx(true);
  out = await runTool(
    "write_file",
    { path: "manual.ts", content: "export const y = 2;\n" },
    { ...h.ctx, cfg: manualCfg }
  );
  t.ok(out.text.startsWith("APPROVED"), "autoApproveCreate=false restores the approval step");
  t.equal(h.state.approvalRequests, 1, "the user was asked once");
  t.equal(h.state.lastEdit.kind, "create", "edit is still classified as a creation");

  h = makeCtx(false);
  out = await runTool(
    "write_file",
    { path: "refused.ts", content: "nope\n" },
    { ...h.ctx, cfg: manualCfg }
  );
  t.ok(out.text.startsWith("REJECTED"), "a refused creation is reported");
  t.ok(!fs.existsSync(path.join(root, "refused.ts")), "a refused creation writes nothing");

  h = makeCtx(null);
  out = await runTool("write_file", { path: "src/new.ts", content: "export const x = 1;\n" }, h.ctx);
  t.ok(out.text.startsWith("GUARD: No change"), "rewriting identical content is refused");

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

  // --- editor context
  h = makeCtx(null, {
    activeEditor: {
      relPath: "src/app.ts",
      languageId: "typescript",
      lineCount: 2,
      dirty: true,
      selection: { startLine: 1, endLine: 1, text: "const port = 8080;" },
    },
    openFiles: ["src/app.ts", "src/new.ts"],
  });
  out = await runTool("get_editor_context", {}, h.ctx);
  t.ok(out.text.includes("Active file: src/app.ts"), "editor context reports the active file");
  t.ok(out.text.includes("lines 1-1"), "editor context reports the selection range");
  t.ok(out.text.includes("const port = 8080;"), "editor context includes the selected text");
  t.ok(out.text.includes("unsaved changes"), "editor context flags a dirty buffer");
  t.ok(out.text.includes("src/new.ts"), "editor context lists other open tabs");

  h = makeCtx(null, { openFiles: [] });
  out = await runTool("get_editor_context", {}, h.ctx);
  t.ok(out.text.includes("No editor is open"), "no active editor is reported honestly");

  // --- diagnostics
  h = makeCtx(null, {
    diagnostics: [
      { relPath: "src/app.ts", line: 2, severity: "warning", message: "unused", source: "eslint" },
      { relPath: "src/app.ts", line: 1, severity: "error", message: "Type error", source: "ts", code: "2322" },
      { relPath: "other.ts", line: 9, severity: "error", message: "Elsewhere" },
      { relPath: "src/app.ts", line: 4, severity: "hint", message: "noise" },
    ],
  });
  out = await runTool("get_diagnostics", {}, h.ctx);
  t.ok(out.text.startsWith("3 problem(s)"), "hints are excluded by default");
  t.ok(out.text.indexOf("Type error") < out.text.indexOf("unused"), "errors are listed before warnings");
  t.ok(out.text.includes("[2322]"), "diagnostic code is included");

  out = await runTool("get_diagnostics", { path: "src/app.ts" }, h.ctx);
  t.ok(!out.text.includes("Elsewhere"), "path filter excludes other files");
  out = await runTool("get_diagnostics", { severity: "error" }, h.ctx);
  t.ok(!out.text.includes("unused"), "severity filter excludes warnings");

  h = makeCtx(null, { diagnostics: [] });
  out = await runTool("get_diagnostics", {}, h.ctx);
  t.ok(out.text.includes("No errors or warnings"), "clean workspace is reported");
  t.ok(out.text.includes("not proof the project builds"), "clean result is honestly qualified");

  // --- run_command
  h = makeCtx(null);
  out = await runTool("run_command", { command: "rm -rf ." }, h.ctx);
  t.ok(out.text.startsWith("GUARD:"), "disallowed command is blocked before approval");
  t.equal(h.state.commandRequests, 0, "blocked command never reaches the user");
  out = await runTool("run_command", { command: "npm test && rm -rf ." }, h.ctx);
  t.ok(out.text.startsWith("GUARD:"), "chained command is blocked before approval");
  t.equal(h.state.ran.length, 0, "nothing was executed");

  h = makeCtx(false);
  out = await runTool("run_command", { command: "npm test" }, h.ctx);
  t.equal(h.state.commandRequests, 1, "allowed command asks for approval");
  t.ok(out.text.startsWith("REJECTED"), "rejection is reported to the model");
  t.equal(h.state.ran.length, 0, "rejected command is not executed");

  h = makeCtx(true, { result: { exitCode: 1, stdout: "2 failing", stderr: "", timedOut: false } });
  out = await runTool("run_command", { command: "npm test" }, h.ctx);
  t.equal(h.state.ran[0], "npm test", "approved command is executed as parsed");
  t.ok(out.text.includes("exit code 1"), "exit code is reported");
  t.ok(out.text.includes("2 failing"), "output is handed back to the model");
  t.equal(h.state.lastCommand.matchedRule, "npm test", "the matching rule is shown to the user");

  h = makeCtx(true, { result: { exitCode: null, stdout: "partial", stderr: "", timedOut: true } });
  out = await runTool("run_command", { command: "npm test" }, h.ctx);
  t.ok(out.text.startsWith("TIMED OUT"), "timeout is reported distinctly");

  h = makeCtx(true, {
    result: { exitCode: 0, stdout: "", stderr: "", timedOut: false },
  });
  out = await runTool("run_command", { command: "npm test" }, h.ctx);
  t.ok(out.text.includes("(no output)"), "silent success is still legible");

  const noCommands = { ...DEFAULT_CONFIG.guard, allowCommands: false };
  h = makeCtx(null);
  out = await runTool("run_command", { command: "npm test" }, { ...h.ctx, cfg: noCommands });
  t.ok(out.text.includes("disabled"), "allowCommands=false disables the tool");

  // --- ask_user
  h = makeCtx(null);
  out = await runTool(
    "ask_user",
    { question: "Where should the app go?", options: ["Here", "dconx-scratch/", "New folder"] },
    h.ctx
  );
  t.equal(out.done, true, "ask_user ends the turn so the user can answer");
  const asked = h.state.events.find((e) => e.type === "question");
  t.ok(asked !== undefined, "ask_user emits a question event for the UI");
  t.equal(asked.question, "Where should the app go?", "the question text is passed through");
  t.equal(asked.options.length, 3, "options reach the UI");
  t.ok(out.text.includes("Waiting for their answer"), "the model is told to stop and wait");

  h = makeCtx(null);
  out = await runTool("ask_user", { question: "What should I name it?" }, h.ctx);
  t.equal(h.state.events.find((e) => e.type === "question").options.length, 0, "options are optional");

  h = makeCtx(null);
  await runTool(
    "ask_user",
    { question: "Pick", options: ["a", "b", "c", "d", "e", "f", "g"] },
    h.ctx
  );
  t.equal(
    h.state.events.find((e) => e.type === "question").options.length,
    5,
    "option list is capped at 5"
  );

  h = makeCtx(null);
  await runTool("ask_user", { question: "Pick", options: ["a", "", "  ", "b"] }, h.ctx);
  t.equal(
    h.state.events.find((e) => e.type === "question").options.length,
    2,
    "blank options are dropped"
  );

  h = makeCtx(null);
  out = await runTool("ask_user", {}, h.ctx);
  t.ok(out.text.startsWith("GUARD:"), "a question with no text is rejected");

  // --- pick_folder_name: the fix for "agent should be able to start a new
  // project even when a previously-generated one is already sitting there"
  h = makeCtx(null); // read-only — never asks for approval
  out = await runTool("pick_folder_name", { base: "react-demo" }, h.ctx);
  t.ok(out.text.includes('"react-demo" is free'), "a name with no collision is returned as-is");

  fs.mkdirSync(path.join(root, "react-demo"));
  fs.writeFileSync(path.join(root, "react-demo", "package.json"), "{}\n");
  out = await runTool("pick_folder_name", { base: "react-demo" }, h.ctx);
  t.ok(out.text.includes("already exists"), "an existing folder is reported as taken");
  t.ok(out.text.includes('"react-demo-2"'), "a free sibling name is offered instead");
  t.equal(h.state.approvalRequests, 0, "checking for a free name never interrupts the user");

  fs.mkdirSync(path.join(root, "react-demo-2"));
  out = await runTool("pick_folder_name", { base: "react-demo" }, h.ctx);
  t.ok(out.text.includes('"react-demo-3"'), "the next free suffix is found when -2 is also taken");

  // A plain file at the candidate path counts as taken too, not just a directory.
  fs.writeFileSync(path.join(root, "single-file"), "x\n");
  out = await runTool("pick_folder_name", { base: "single-file" }, h.ctx);
  t.ok(out.text.includes('"single-file-2"'), "a colliding file, not just a folder, is detected");

  out = await runTool("pick_folder_name", { base: "../escape" }, h.ctx);
  t.ok(out.text.startsWith("GUARD:"), "pick_folder_name is still subject to the path guard");

  out = await runTool("pick_folder_name", {}, h.ctx);
  t.ok(out.text.startsWith("GUARD:"), "a missing base argument is rejected, not guessed");

  fs.rmSync(root, { recursive: true, force: true });
  process.exit(t.finish() ? 1 : 0);
})();
