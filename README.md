# Dconx Agent — prototype

A Cline-style coding agent for VS Code that talks only to a **local Ollama** server and
cannot write a single byte to disk without an explicit human approval of the diff.

**ภาษาไทย: อ่าน [instruction.md](instruction.md) สำหรับวิธีติดตั้งและใช้งานแบบละเอียด**

## Install it (no rebuild per session)

```bash
npm install
npm run package      # runs typecheck + tests, then builds dconx-agent.vsix
code --install-extension dconx-agent.vsix
```

Or in VS Code: Extensions → `...` → **Install from VSIX…**. Open the panel from the
activity bar, with `Ctrl+Alt+D`, or via `Dconx Agent: Open Chat` in the command palette. After that it is a normal
installed extension — no F5, no build, works in every project you open.

## Or run it as a local web app (no VS Code)

```bash
npm install
npm run web -- /path/to/your-project     # then open http://127.0.0.1:3939
```

Same agent, same guardrails, same chat UI — `src/core` is shared verbatim and the
page is the same `media/chat.body.html` + `media/chat.js` the extension uses, via a
small bridge that maps `postMessage` onto SSE + POST. Binds to loopback only and
rejects non-localhost `Host` headers.

What the browser cannot do: there is no editor, so `get_editor_context` and
`get_diagnostics` report their own absence and the agent falls back to paths and
`run_command`.

Config comes from `dconx.config.json` in the project folder, overridden by
`OLLAMA_BASE_URL`, `OLLAMA_API_KEY` and `DCONX_MODEL`.

## Remote Ollama

`dconx.ollama.baseUrl` takes any http(s) host — a VPS, a LAN box, a hosted endpoint.
Set `dconx.ollama.apiKey` (or, better, the `OLLAMA_API_KEY` environment variable, which
wins over the setting and keeps the token out of `settings.json`) and
`dconx.ollama.headers` for a gateway that needs its own. Use the server root, without
`/api` or `/v1`. Failures name what to check: a server started without
`OLLAMA_HOST=0.0.0.0`, a missing key (401/403), a wrong base URL (404), or a stall
(`requestTimeoutMs`).

## Develop it

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
src/node/     adapters both frontends share — shell execution, undo registry, file config.
src/vscode/   VS Code adapters — settings, webview, commands, approval plumbing.
src/web/      the local web server frontend.
src/protocol.ts   typed messages shared with the chat UI.
media/        chat UI shared by both frontends (chat.body.html, chat.css, chat.js).
test/         plain-Node suites; no VS Code, no framework.
```

**[ARCHITECTURE.md](ARCHITECTURE.md) has the map, the control flow, and step-by-step
recipes for adding a tool, a setting, or a webview message.** Start there.

## How it works

```
webview chat  ──►  Agent loop  ──►  Ollama /api/chat (tools, stream:false)
                        │
                        ├─ read-only tools run immediately
                        └─ edit tools ──► guard ──► diff ──┬─ new file ──► written now, Undo offered
                                                           └─ existing ──► human Approve/Reject ──► write
```

## The limits on modification

The model is told about these, but they are **enforced in code**, not by prompting:

| Limit | Where | Setting |
|---|---|---|
| No **overwrite** of an existing file without human approval | `core/tools/editGate.ts` | — (not overridable) |
| New files written automatically, each with Undo | `core/tools/editGate.ts` | `dconx.guard.autoApproveCreate` |
| Confined to workspace root; `..` and outside-absolute paths rejected | `core/guard.ts` | — |
| Deny globs (`.git`, `node_modules`, `.env`, keys, lockfiles, build output) | `core/guard.ts` | `dconx.guard.denyGlobs` |
| Optional strict allowlist (deny still wins) | `core/guard.ts` | `dconx.guard.allowGlobs` |
| Max lines changed per edit | `core/guard.ts` | `dconx.guard.maxEditLines` (400) |
| Max file size read or written | `core/guard.ts` | `dconx.guard.maxFileBytes` (256 KB) |
| File creation on/off | `core/tools/editGate.ts` | `dconx.guard.allowCreate` |
| Tool rounds per task | `core/agent.ts` | `dconx.agent.maxIterations` (12) |
| Commands restricted to an allowlist, approved each run | `core/commandGuard.ts` | `dconx.guard.commandAllowlist` |
| Shell metacharacters (`;` `&&` `\|` `>` `` ` `` `$()`) always rejected | `core/commandGuard.ts` | — (not overridable) |
| Command execution on/off | `core/commandGuard.ts` | `dconx.guard.allowCommands` |
| Command timeout / output cap | `core/tools/runCommand.ts` | `dconx.guard.commandTimeoutMs`, `commandOutputLimit` |
| **No network, no file deletion, no free-form shell** | there is no such tool | — |

A blocked call returns a `GUARD: …` message to the model as a normal tool result, so it
self-corrects instead of crashing. A rejected diff tells the model not to retry.

Three structural invariants back this up, all asserted by `npm test`: `src/core` never
imports `vscode` or `child_process`; `editGate.ts` is the only module in core that calls
`fs.writeFile`; and `runCommand.ts` is the only one that calls `shell.run`.

## Tools the model gets

| Tool | Purpose | Needs approval |
|---|---|---|
| `get_editor_context` | which file is open, what is selected, other tabs | no |
| `list_files` | directory listing | no |
| `read_file` | file contents, line-numbered | no |
| `search_files` | regex search across the workspace | no |
| `get_diagnostics` | the real errors/warnings from the Problems panel | no |
| `replace_in_file` | targeted edit via an exact search block | **yes** |
| `write_file` | full file contents / create | only when overwriting |
| `run_command` | one allowlisted command, e.g. `npm test` | **yes** |
| `ask_user` | ask a question, rendered as clickable options | no |
| `attempt_completion` | end the turn with a summary | no |

`replace_in_file` requires an exact, **uniquely matching** search block — a block that
appears twice returns `AMBIGUOUS` rather than guessing.

`ask_user` exists because small local models habitually print a numbered menu and wait for
a reply the chat protocol cannot deliver. The prompt forbids that pattern by name and
points them here; `test/prompt.test.js` pins those rules.

`get_editor_context` is what makes "fix this file" work without a path. `get_diagnostics`
is what makes the agent fix the error your compiler actually reports rather than one it
imagined.

## Deliberately not in this prototype

- No free-form shell. `run_command` runs one allowlisted command at a time with no shell
  metacharacters — enough to run tests and typechecks, not enough to be a terminal.
- No file deletion. The agent can create and modify, never remove.
- No streaming (Ollama does not emit tool calls incrementally, so a streamed response
  would have to be buffered before dispatch anyway).
- No checkpoints/undo — VS Code's local history covers the prototype; git-based snapshots
  come next.
- No MCP, no browser, no image input.
- No auto-approve mode. Every edit is a click, on purpose.
