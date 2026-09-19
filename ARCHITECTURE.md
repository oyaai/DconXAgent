# Architecture

Read this before changing anything. It is short on purpose.

## The one rule

**`src/core` never imports `vscode`.** `test/boundary.test.js` fails the build if it does.

That single constraint is what makes the agent loop, the guardrails and the diff
engine testable in plain Node, with no editor and no mocking framework. When you
need an editor API inside core logic, don't import it — take it as an argument
and let `src/vscode` supply it.

## Layers

```
media/            the chat UI — shared verbatim by BOTH frontends
  chat.body.html  the markup
  chat.css        styling, VS Code theme variables only
  chat.js         behaviour; type-checked against src/protocol.ts via JSDoc
  web-bridge.js   maps acquireVsCodeApi() onto SSE + POST so chat.js runs in a browser
  web-theme.css   supplies the --vscode-* variables outside VS Code
  globals.d.ts    ambient acquireVsCodeApi()

src/protocol.ts   the typed message union shared by both sides of the webview

src/node/         adapters shared by both frontends — no vscode import
  shellPort.ts    process execution
  undoRegistry.ts undo for auto-created files
  fileConfig.ts   dconx.config.json + env, for the web UI

src/web/          the local web server frontend
  server.ts       http + SSE, wires the same Agent
  editorPort.ts   NoEditorPort — reports honestly that there is no editor

src/vscode/       VS Code adapters — every vscode import lives under here
  config.ts             the ONLY reader of workspace settings
  chatViewProvider.ts   translates AgentEvent <-> protocol messages
  approvals.ts          holds pending approval promises, resolves them once
  editorPort.ts         active file, selection, open tabs, Problems panel
  shellPort.ts          spawns approved commands (the only spawn in the codebase)
  undoRegistry.ts       remembers auto-created files so Undo can delete them safely
  proposalProvider.ts   serves proposed content to the native diff editor
  commands.ts           command registrations
  webviewHtml.ts        the html shell

src/core/         pure logic, no vscode, no child_process
  config.ts       config shapes + DEFAULT_CONFIG
  errors.ts       GuardError, OllamaError
  ports.ts        EditorPort / ShellPort — what core needs FROM the environment
  agent.ts        the loop; talks to the outside through AgentHost
  prompt.ts       the system prompt — treat it as code; it has its own test suite
  ollama.ts       HTTP transport
  guard.ts        path containment, allow/deny lists, size caps
  commandGuard.ts command allowlist + metacharacter rejection
  glob.ts         the glob matcher the guard uses
  diff.ts         LCS unified diff
  tools/          one file per tool + the registry

src/extension.ts  activation wiring only
```

## Control flow

```
user types
  └─ media/chat.js ──ViewMessage──► ChatViewProvider
        └─ Agent.send()
             └─ loop: ollama.chat() ──► tool calls
                  ├─ read-only tool ──► guard ──► fs ──► result text
                  └─ edit tool ──► guard ──► diff ──► editGate.proposeEdit()
                                                        └─ ApprovalBroker
                                                             ├─ native diff editor
                                                             └─ HostMessage ──► approval card
                                                                  └─ user clicks
                                                                       └─ fs.writeFile (only here)
```

Three chokepoints are worth protecting, each asserted by `test/boundary.test.js`:

- **`src/core/guard.ts`** — every model-supplied path goes through `resolveSafePath`.
- **`src/core/tools/editGate.ts`** — the only `fs.writeFile` in `src/core`. An edit to an
  existing file runs only after `approve.requestEdit` resolves `true`. A *creation* may be
  auto-approved (`autoApproveCreate`), because it cannot overwrite anything and the UI
  offers Undo; `undoRegistry.ts` deletes such a file only while its bytes are unchanged.
- **`src/core/tools/runCommand.ts`** — the only caller of `shell.run`, and only after
  `commandGuard.parseCommand` accepted the command AND `approve.requestCommand` resolved
  `true`.

## Ports

Core never imports `vscode` or `child_process`. When it needs the environment, it declares
an interface in `src/core/ports.ts` and `src/vscode` implements it:

| Port | Implemented by | Gives the agent |
|---|---|---|
| `EditorPort` | `vscode/editorPort.ts` | active file, selection, open tabs, diagnostics |
| `ShellPort` | `vscode/shellPort.ts` | process execution for already-approved commands |
| `ApprovalPort` | `vscode/approvals.ts` | the human gate for edits and commands |

Adding a capability that needs an editor or OS API means adding a port, not an import.

## Recipes

### Add a tool

1. Create `src/core/tools/myTool.ts`:

   ```ts
   import { defineTool, requireString } from "./types";

   export const myTool = defineTool(
     "my_tool",
     "One sentence the model reads to decide when to call this.",
     { properties: { path: { type: "string", description: "..." } }, required: ["path"] },
     async (args, ctx) => ({ text: `did something with ${requireString(args, "path")}` })
   );
   ```

2. Add it to `TOOLS` in `src/core/tools/index.ts`.

That is the whole change — the schema sent to the model, the dispatcher, the
prompt's tool list and the registry tests all read from that array.

If the tool changes files, call `proposeEdit` from `./editGate` instead of
writing to disk. Throw `GuardError` for anything the user's settings forbid; the
dispatcher turns it into a `GUARD: …` result the model can recover from.

### Add a setting

1. Field + default in `src/core/config.ts`.
2. Read it in `src/vscode/config.ts`.
3. Declare it in `package.json` → `contributes.configuration.properties`.

`test/config.test.js` fails if these three disagree, including on default values.

### Add a webview message

1. Add the variant to `HostMessage` or `ViewMessage` in `src/protocol.ts`.
2. Handle it in `media/chat.js` or `src/vscode/chatViewProvider.ts`.

`npm run typecheck` covers both sides — `media/chat.js` is checked against the
same union via `// @ts-check`.

### Add a frontend

There are two already — `src/vscode` and `src/web` — and they share everything below
the transport. A third would supply the same three things: an `ApprovalPort`, an
`EditorPort`, and a way to move `HostMessage`/`ViewMessage` between the agent and the
UI. If you reuse `media/chat.js`, copy what `media/web-bridge.js` does.

### Target a different local runtime

Rewrite `src/core/ollama.ts` to speak the other API and keep `chat()` and
`listModels()` as they are. Nothing else imports the transport.

## Tests

`npm test` bundles the core modules with esbuild and runs every `test/*.test.js`
in plain Node — no VS Code, no framework.

| Suite | Protects |
|---|---|
| `boundary` | core stays vscode-free; only editGate writes files |
| `config` | package.json settings match `DEFAULT_CONFIG` |
| `guard` | containment, deny/allow lists, size caps |
| `glob` | the matcher behind the deny list |
| `diff` | hunk splitting, CRLF, creation/deletion counts |
| `commandGuard` | allowlist token matching, and that every chaining attempt is refused |
| `prompt` | the anti-patterns and new-project flow that fixed observed model failures |
| `tools` | registry invariants; that a rejected edit leaves the file byte-identical; that a blocked command never reaches the user or the shell |
| `web` | the web frontend end-to-end against a fake Ollama: a real file is created, streamed to the browser, and undone — plus the remote auth header |
| `webview` | the chat layout contract (the flex `min-height: 0` scroll bug), the activity-bar icon, and that both frontends render the same shared markup |

`npm run check` = typecheck + tests. Run it before opening a PR.

## Packaging

`npm run package` runs `check`, builds the bundle and produces `dconx-agent.vsix` via
vsce. `.vscodeignore` keeps `src/`, `test/` and `node_modules/` out of it — the shipped
extension is `dist/extension.js` plus `media/`.

## Deliberate omissions

No free-form shell, no streaming, no auto-approve, no MCP, no checkpoints, no deletion.
See the README for why.
