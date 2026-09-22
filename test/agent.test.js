/**
 * The context-budget guard exists because a long task accumulates full file
 * contents in tool-call history (every write_file argument stays in the
 * conversation forever), and once that gets close to numCtx a small local model
 * can take minutes to prefill and still miss dconx.ollama.requestTimeoutMs — which
 * looks exactly like a hang. These assertions pin the arithmetic that turns that
 * into an immediate message instead of a silent multi-minute timeout.
 */

const { core, createRunner } = require("./harness");
const { estimateMessageChars, estimateContextBudgetChars } = core("agent");

const t = createRunner("agent");

// --- budget scales with numCtx and leaves headroom, it does not spend the whole window
t.ok(estimateContextBudgetChars(16384) > 0, "budget is positive for a real numCtx");
t.ok(
  estimateContextBudgetChars(16384) < 16384 * 4,
  "budget stays under a generous chars-per-token upper bound"
);
t.ok(
  estimateContextBudgetChars(32768) > estimateContextBudgetChars(16384),
  "a larger numCtx yields a larger budget"
);

// --- plain content is counted
t.equal(
  estimateMessageChars([
    { role: "system", content: "abcde" },
    { role: "user", content: "12345" },
  ]),
  10,
  "content length is summed across messages"
);

// --- this is the actual bug this guard exists for: a created file's full text
// lives in tool_calls, not in the short tool-result text, so it must be counted too
const fileContent = "x".repeat(5000);
const withToolCall = [
  { role: "assistant", content: "", tool_calls: [{ function: { name: "write_file", arguments: { path: "a.js", content: fileContent } } }] },
  { role: "tool", tool_name: "write_file", content: "CREATED a.js (1 lines)." },
];
t.ok(
  estimateMessageChars(withToolCall) > fileContent.length,
  "a write_file call's full argument content counts toward the total, not just the short tool result"
);

// --- string-encoded arguments (the fallback-tool-call shape) are measured too, not JSON.stringify'd again
const stringArgsMsg = [
  { role: "assistant", content: "", tool_calls: [{ function: { name: "list_files", arguments: '{"dir":"."}' } }] },
];
t.equal(estimateMessageChars(stringArgsMsg), '{"dir":"."}'.length, "string-form arguments are measured directly");

// --- a realistic small task stays under budget, a long one with several full-file
// tool calls at a small numCtx trips it — this is the actual failure mode reported
const smallHistory = [
  { role: "system", content: "short system prompt" },
  { role: "user", content: "hello" },
];
t.ok(
  estimateMessageChars(smallHistory) < estimateContextBudgetChars(16384),
  "a short conversation stays comfortably under budget"
);

const heavyHistory = [];
for (let i = 0; i < 10; i++) {
  heavyHistory.push({
    role: "assistant",
    content: "",
    tool_calls: [{ function: { name: "write_file", arguments: { path: `f${i}.js`, content: "y".repeat(2000) } } }],
  });
  heavyHistory.push({ role: "tool", tool_name: "write_file", content: `CREATED f${i}.js.` });
}
t.ok(
  estimateMessageChars(heavyHistory) > estimateContextBudgetChars(4096),
  "ten small-context-sized file creations in history exceed a small numCtx budget, as reported"
);

process.exit(t.finish() ? 1 : 0);
