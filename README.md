# Dconx Agent — prototype

A Cline-style coding agent for VS Code that talks only to a **local Ollama** server and
cannot write a single byte to disk without an explicit human approval of the diff.

## Run it

```bash
npm install
npm run build          # or: npm run watch
npm run check          # typecheck + tests
```

> Run `npm install` on the machine you build on. `node_modules` is platform-specific:
> a tree installed under Linux/WSL has no `tsc.cmd` shims and no Windows esbuild binary,
> so Windows fails with `'tsc' is not recognized`. If that happens, delete `node_modules`
> and reinstall. `package-lock.json` is portable and should be kept.

1. Start Ollama and pull a tool-calling model:
   `ollama pull qwen2.5-coder:7b` (`llama3.1`, `qwen3`, `mistral-nemo` also work).
2. Open this folder in VS Code and press **F5** — a second window opens with the extension loaded.
3. In that window, open the folder you want the agent to work on.
4. Click the **Dconx Agent** icon in the activity bar, click `model: …` to pick a model, and type a task.

## Layout

```
src/core/     pure logic — agent loop, guardrails, diff, tools. Never imports vscode.
src/vscode/   VS Code adapters — settings, webview, commands, approval plumbing.
src/protocol.ts   typed messages shared with the webview.
media/        webview assets (chat.css, chat.js).
test/         plain-Node suites; no VS Code, no framework.
```

**[ARCHITECTURE.md](ARCHITECTURE.md) has the map, the control flow, and step-by-step
recipes for adding a tool, a setting, or a webview message.** Start there.

## How it works

```
webview chat  ──►  Agent loop  ──►  Ollama /api/chat (tools, stream:false)
                        │
                        ├─ read-only tools run immediately
                        └─ edit tools ──► guard ──► diff ──► human Approve/Reject ──► fs.writeFile
```

## The limits on modification

The model is told about these, but they are **enforced in code**, not by prompting:

| Limit | Where | Setting |
|---|---|---|
| No write without human approval | `core/tools/editGate.ts` | — (not overridable) |
| Confined to workspace root; `..` and outside-absolute paths rejected | `core/guard.ts` | — |
| Deny globs (`.git`, `node_modules`, `.env`, keys, lockfiles, build output) | `core/guard.ts` | `dconx.guard.denyGlobs` |
| Optional strict allowlist (deny still wins) | `core/guard.ts` | `dconx.guard.allowGlobs` |
| Max lines changed per edit | `core/guard.ts` | `dconx.guard.maxEditLines` (400) |
| Max file size read or written | `core/guard.ts` | `dconx.guard.maxFileBytes` (256 KB) |
| File creation on/off | `core/tools/editGate.ts` | `dconx.guard.allowCreate` |
| Tool rounds per task | `core/agent.ts` | `dconx.agent.maxIterations` (12) |
| **No shell, no terminal, no network** | there is no such tool | — |

A blocked call returns a `GUARD: …` message to the model as a normal tool result, so it
self-corrects instead of crashing. A rejected diff tells the model not to retry.

Two structural invariants back this up, and both are asserted by `npm test`:
`src/core` never imports `vscode`, and `editGate.ts` is the only module in core that
calls `fs.writeFile`.

## Tools the model gets

`list_files`, `read_file`, `search_files`, `replace_in_file`, `write_file`, `attempt_completion`.

`replace_in_file` requires an exact, **uniquely matching** search block — a block that
appears twice returns `AMBIGUOUS` rather than guessing.

## Deliberately not in this prototype

- No shell/terminal tool. This is the single biggest lever if you later want it: add one
  tool file, route it through the same approval gate, and add a command allowlist.
- No streaming (Ollama does not emit tool calls incrementally, so a streamed response
  would have to be buffered before dispatch anyway).
- No checkpoints/undo — VS Code's local history covers the prototype; git-based snapshots
  come next.
- No MCP, no browser, no image input.
- No auto-approve mode. Every edit is a click, on purpose.
