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
media/            webview assets (css, js) — the only browser-side code
  chat.css        styling, VS Code theme variables only
  chat.js         behaviour; type-checked against src/protocol.ts via JSDoc
  globals.d.ts    ambient acquireVsCodeApi()

src/protocol.ts   the typed message union shared by both sides of the webview

src/vscode/       VS Code adapters — every vscode import lives under here
  config.ts             the ONLY reader of workspace settings
  chatViewProvider.ts   translates AgentEvent <-> protocol messages
  approvals.ts          holds pending approval promises, resolves them once
  proposalProvider.ts   serves proposed content to the native diff editor
  commands.ts           command registrations
  webviewHtml.ts        the html shell

src/core/         pure logic, no vscode
  config.ts       config shapes + DEFAULT_CONFIG
  errors.ts       GuardError, OllamaError
  agent.ts        the loop; talks to the outside through AgentHost
  prompt.ts       the system prompt
  ollama.ts       HTTP transport
  guard.ts        path containment, allow/deny lists, size caps
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

Two chokepoints are worth protecting:

- **`src/core/guard.ts`** — every model-supplied path goes through `resolveSafePath`.
- **`src/core/tools/editGate.ts`** — the only `fs.writeFile` in `src/core`, and it
  runs only after `requestApproval` resolves `true`. A boundary test asserts this.

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
| `tools` | registry invariants, and that a rejected edit leaves the file byte-identical |

`npm run check` = typecheck + tests. Run it before opening a PR.

## Deliberate omissions

No shell tool, no streaming, no auto-approve, no MCP, no checkpoints. See the
README for why, and for where a shell tool would plug in.
