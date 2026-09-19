/**
 * The prompt is code: it is what stops a 7B model from printing "respond with a
 * number" and waiting forever. These assertions pin the rules that fixed real
 * observed failures, so a future tidy-up cannot quietly drop them.
 */

const { core, createRunner } = require("./harness");
const { buildSystemPrompt } = core("prompt");
const { DEFAULT_CONFIG } = core("config");

const t = createRunner("prompt");

const TOOLS = ["get_editor_context", "list_files", "ask_user", "write_file", "attempt_completion"];
const prompt = buildSystemPrompt(DEFAULT_CONFIG, "/home/aeh/project", TOOLS);

// --- context the model needs
t.ok(prompt.includes("/home/aeh/project"), "workspace root is stated");
for (const name of TOOLS) {
  t.ok(prompt.includes(name), `prompt lists the ${name} tool`);
}

// --- the failure this fixed: a numbered menu the chat cannot answer
t.ok(/respond with a number/i.test(prompt), "the numbered-menu failure is named explicitly");
t.ok(prompt.includes("ask_user instead"), "the model is pointed at ask_user");
t.ok(/choose between your own tools/i.test(prompt), "asking the user to pick a tool is forbidden");
t.ok(/Guessing is not an option you may offer/i.test(prompt), "offering to guess is forbidden");

// --- new project flow
t.ok(/STARTING A NEW PROJECT/.test(prompt), "the new-project branch exists");
t.ok(
  /do NOT ask the user which file to work on/i.test(prompt),
  "the model is told there is no existing file to pick for a new project"
);
t.ok(
  prompt.includes(DEFAULT_CONFIG.agent.scratchFolder),
  "the scratch folder is offered by name"
);
t.ok(/npm install/.test(prompt), "the model is told to hand back run instructions");
t.ok(
  /cannot install packages/i.test(prompt),
  "the model is told to admit it cannot install dependencies"
);

// --- auto-create wording tracks the setting
t.ok(/no approval needed/i.test(prompt), "auto-create is explained when it is on");
t.ok(/do not stop to ask between them/i.test(prompt), "the model is told not to pause between creates");
t.ok(
  /ALREADY EXISTS is shown as a diff/i.test(prompt),
  "modifying an existing file is still described as gated"
);

const manual = {
  ...DEFAULT_CONFIG,
  guard: { ...DEFAULT_CONFIG.guard, autoApproveCreate: false },
};
const gated = buildSystemPrompt(manual, "/x", TOOLS);
t.ok(/Every edit is shown to the user as a diff/i.test(gated), "auto-create off is stated plainly");
t.ok(!/no approval needed/i.test(gated), "auto-create wording is absent when it is off");

// --- every turn must end in a tool call
t.ok(
  /Never end on an open question in plain text/i.test(prompt),
  "ending on an unanswerable question is forbidden"
);

// --- guardrails are described, and follow the config
t.ok(prompt.includes(DEFAULT_CONFIG.guard.denyGlobs[0]), "deny globs are listed");
t.ok(prompt.includes(String(DEFAULT_CONFIG.guard.maxEditLines)), "the line cap is stated");
t.ok(prompt.includes("npm test"), "the command allowlist is listed when commands are on");

const noCommands = {
  ...DEFAULT_CONFIG,
  guard: { ...DEFAULT_CONFIG.guard, allowCommands: false },
};
const quiet = buildSystemPrompt(noCommands, "/x", TOOLS);
t.ok(/no shell and cannot run anything/i.test(quiet), "commands off is stated plainly");
t.ok(!quiet.includes("run_command executes"), "the allowlist is not advertised when commands are off");

const restricted = {
  ...DEFAULT_CONFIG,
  guard: { ...DEFAULT_CONFIG.guard, allowGlobs: ["src/**"], allowCreate: false },
};
const locked = buildSystemPrompt(restricted, "/x", TOOLS);
t.ok(locked.includes("ONLY touch files matching: src/**"), "allow list is surfaced to the model");
t.ok(locked.includes("Creating new files is disabled"), "allowCreate=false is surfaced");
t.ok(!prompt.includes("Creating new files is disabled"), "that line is absent when creation is on");

process.exit(t.finish() ? 1 : 0);
