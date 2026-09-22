/**
 * extractFallbackToolCall exists because small local models sometimes print a tool
 * call as JSON text instead of using Ollama's tool-calling channel, which used to
 * show up in the chat as a wall of raw JSON with no button and the turn silently
 * ending. These assertions pin the real failure shapes that produced that report.
 */

const { core, createRunner } = require("./harness");
const { extractFallbackToolCall, parseToolArgs } = core("ollama");

const t = createRunner("ollama");

const TOOL_NAMES = ["ask_user", "list_files", "write_file", "attempt_completion"];

// --- the exact shape reported: bare JSON, no fence, no surrounding prose
const bare = JSON.stringify({
  name: "ask_user",
  arguments: {
    question: "Where should I create the React app?",
    options: ["Create in a new folder here", "Create in dconx-scratch/ (throwaway)", "Create in the current folder"],
  },
});
const bareCall = extractFallbackToolCall(bare, TOOL_NAMES);
t.ok(bareCall !== undefined, "bare JSON tool call is recovered");
t.equal(bareCall && bareCall.function.name, "ask_user", "recovered call has the right tool name");

// --- fenced with ```json
const fenced = "```json\n" + bare + "\n```";
const fencedCall = extractFallbackToolCall(fenced, TOOL_NAMES);
t.ok(fencedCall !== undefined, "fenced JSON tool call is recovered");

// --- fenced with a plain ``` (no language tag)
const fencedPlain = "```\n" + bare + "\n```";
t.ok(extractFallbackToolCall(fencedPlain, TOOL_NAMES) !== undefined, "fence without a language tag still works");

// --- a sentence before the JSON
const withPreamble = "Sure, let me ask that:\n" + bare;
t.ok(extractFallbackToolCall(withPreamble, TOOL_NAMES) !== undefined, "leading prose before the JSON still works");

// --- arguments given as a JSON string rather than an object (also seen from real models)
const stringArgs = JSON.stringify({ name: "list_files", arguments: JSON.stringify({ dir: "." }) });
const stringArgsCall = extractFallbackToolCall(stringArgs, TOOL_NAMES);
t.ok(stringArgsCall !== undefined, "string-encoded arguments are still recognized as a call");
t.ok(
  typeof (stringArgsCall && stringArgsCall.function.arguments) === "string",
  "the raw string form is preserved for parseToolArgs to decode"
);
if (stringArgsCall) {
  const decoded = parseToolArgs(stringArgsCall);
  t.equal(decoded.dir, ".", "parseToolArgs decodes the JSON-string arguments afterwards");
}

// --- must not fire on ordinary text, even text that happens to contain braces
t.ok(
  extractFallbackToolCall("I'll use a config object like { foo: 1 } for this.", TOOL_NAMES) === undefined,
  "ordinary prose with stray braces is not mistaken for a call"
);
t.ok(extractFallbackToolCall("", TOOL_NAMES) === undefined, "empty content yields no fallback call");
t.ok(
  extractFallbackToolCall(JSON.stringify({ name: "delete_everything", arguments: {} }), TOOL_NAMES) === undefined,
  "a name that is not one of the agent's real tools is rejected, not guessed at"
);
t.ok(
  extractFallbackToolCall(JSON.stringify({ foo: "bar" }), TOOL_NAMES) === undefined,
  "JSON without a name/arguments shape is rejected"
);

process.exit(t.finish() ? 1 : 0);
