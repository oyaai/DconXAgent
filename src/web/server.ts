/**
 * The local web UI: the same agent, the same guardrails, in a browser.
 *
 *   npm run web -- C:\path\to\project
 *
 * This exists because the whole of src/core is free of VS Code, so a second
 * frontend is a transport plus an ApprovalPort — not a second agent. The chat
 * page is media/chat.body.html + media/chat.js, shared verbatim with the
 * extension via media/web-bridge.js.
 *
 * Transport: SSE for host -> browser, POST for browser -> host. No websocket
 * library, no framework, no dependencies.
 *
 * It binds to loopback only and rejects requests whose Host header is not
 * localhost, so a page on the open internet cannot drive it via DNS rebinding.
 */

import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { Agent, type AgentEvent } from "../core/agent";
import { listModels } from "../core/ollama";
import type { ApprovalPort, PendingCommand, PendingEdit } from "../core/tools";
import type { HostMessage, ViewMessage } from "../protocol";
import { loadConfig, writeSampleConfig } from "../node/fileConfig";
import { NodeShellPort } from "../node/shellPort";
import { UndoRegistry } from "../node/undoRegistry";
import { NoEditorPort } from "./editorPort";

const DEFAULT_PORT = 3939;
const MEDIA_DIR = path.join(__dirname, "..", "media");

interface Args {
  root: string;
  port: number;
}

function parseArgs(argv: readonly string[]): Args {
  const rest = [...argv];
  let port = DEFAULT_PORT;

  const portIndex = rest.findIndex((a) => a === "--port" || a === "-p");
  if (portIndex !== -1) {
    port = Number(rest[portIndex + 1]) || DEFAULT_PORT;
    rest.splice(portIndex, 2);
  }

  const root = path.resolve(rest[0] ?? process.cwd());
  return { root, port };
}

/** Browser -> host arrives as JSON; treat anything else as a malformed request. */
async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new Error("Request body too large.");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function isLocalHost(header: string | undefined): boolean {
  if (!header) return false;
  const host = header.replace(/:\d+$/, "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

class WebServer {
  private readonly clients = new Set<http.ServerResponse>();
  private readonly pendingApprovals = new Map<string, (approved: boolean) => void>();
  private readonly undoRegistry = new UndoRegistry();
  private readonly agent: Agent;

  /** Set while the user is choosing a model, so the next click is not sent as a prompt. */
  private modelChoices: string[] = [];

  constructor(private readonly args: Args) {
    const approvals: ApprovalPort = {
      requestEdit: (edit) => this.requestApproval(edit.id, () => this.announceEdit(edit)),
      requestCommand: (command) =>
        this.requestApproval(command.id, () => this.announceCommand(command)),
    };

    this.agent = new Agent({
      getConfig: () => loadConfig(this.args.root).config,
      getWorkspaceRoot: () => this.args.root,
      approve: approvals,
      editor: new NoEditorPort(),
      shell: new NodeShellPort(),
      onEvent: (e) => this.forward(e),
    });
  }

  listen(): void {
    const server = http.createServer((req, res) => {
      if (!isLocalHost(req.headers.host)) {
        res.writeHead(403).end("Dconx Agent only accepts requests from localhost.");
        return;
      }
      this.route(req, res).catch((e: Error) => {
        if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(e.message);
      });
    });

    server.listen(this.args.port, "127.0.0.1", () => {
      const { config, notes } = loadConfig(this.args.root);
      const configPath = writeSampleConfig(this.args.root);
      console.log("");
      console.log(`  Dconx Agent  →  http://127.0.0.1:${this.args.port}`);
      console.log(`  workspace    ${this.args.root}`);
      console.log(`  ollama       ${config.ollama.baseUrl}  (${config.ollama.model})`);
      console.log(`  auth         ${config.ollama.apiKey ? "API key set" : "none"}`);
      console.log(`  settings     ${configPath}`);
      for (const note of notes) console.log(`  ${note}`);
      console.log("");
      console.log("  Ctrl+C to stop.");
      console.log("");
    });

    server.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "EADDRINUSE") {
        console.error(
          `Port ${this.args.port} is already in use. Start it on another port:\n` +
            `  npm run web -- "${this.args.root}" --port ${this.args.port + 1}`
        );
        process.exit(1);
      }
      throw e;
    });
  }

  private async route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(this.renderPage());
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/events") {
      this.openEventStream(res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/message") {
      const body = (await readJson(req)) as ViewMessage;
      res.writeHead(204).end();
      await this.handle(body);
      return;
    }

    const asset = ASSETS[url.pathname];
    if (req.method === "GET" && asset) {
      const file = path.join(MEDIA_DIR, asset.file);
      if (fs.existsSync(file)) {
        res.writeHead(200, { "Content-Type": asset.type, "Cache-Control": "no-store" });
        res.end(fs.readFileSync(file));
        return;
      }
    }

    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  }

  private renderPage(): string {
    const body = fs.readFileSync(path.join(MEDIA_DIR, "chat.body.html"), "utf8");
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Dconx Agent — ${escapeHtml(path.basename(this.args.root))}</title>
  <link rel="stylesheet" href="/chat.css" />
  <link rel="stylesheet" href="/web-theme.css" />
</head>
<body>
${body}
  <script src="/web-bridge.js"></script>
  <script src="/chat.js"></script>
</body>
</html>`;
  }

  private openEventStream(res: http.ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("\n");
    this.clients.add(res);

    // Proxies and browsers drop an idle stream; a comment every 20s keeps it open.
    const keepAlive = setInterval(() => res.write(": ping\n\n"), 20000);
    res.on("close", () => {
      clearInterval(keepAlive);
      this.clients.delete(res);
    });

    const { config } = loadConfig(this.args.root);
    this.post({ type: "config", model: config.ollama.model });
  }

  private async handle(msg: ViewMessage): Promise<void> {
    switch (msg.type) {
      case "ready":
        this.post({ type: "config", model: loadConfig(this.args.root).config.ollama.model });
        break;

      case "send": {
        // A click on a model option is a model change, not a prompt.
        if (this.modelChoices.includes(msg.text)) {
          this.applyModelChoice(msg.text);
          return;
        }
        this.modelChoices = [];
        await this.agent.send(msg.text);
        break;
      }

      case "cancel":
        this.agent.cancel();
        break;

      case "pickModel":
        await this.offerModels();
        break;

      case "undo": {
        const outcome = await this.undoRegistry.undo(msg.id);
        this.post({ type: "undoResult", id: msg.id, ok: outcome.ok, reason: outcome.reason });
        break;
      }

      case "approve":
      case "reject": {
        const resolve = this.pendingApprovals.get(msg.id);
        if (resolve) {
          this.pendingApprovals.delete(msg.id);
          const approved = msg.type === "approve";
          resolve(approved);
          this.post({ type: "approvalResolved", id: msg.id, approved });
        }
        break;
      }
    }
  }

  private async offerModels(): Promise<void> {
    const { config } = loadConfig(this.args.root);
    let models: string[];
    try {
      models = await listModels(config.ollama);
    } catch (e) {
      this.post({ type: "error", message: (e as Error).message });
      return;
    }
    if (models.length === 0) {
      this.post({
        type: "error",
        message: `No models available at ${config.ollama.baseUrl}. Try: ollama pull qwen2.5-coder:7b`,
      });
      return;
    }
    this.modelChoices = models.slice(0, 5);
    this.post({
      type: "question",
      question: `Which model? (currently ${config.ollama.model})`,
      options: this.modelChoices,
    });
  }

  /**
   * Persists the choice, because unlike the extension there is no settings UI
   * behind the web page — dconx.config.json is the only place it can live.
   */
  private applyModelChoice(model: string): void {
    this.modelChoices = [];
    const filePath = path.join(this.args.root, "dconx.config.json");
    let current: Record<string, Record<string, unknown>> = {};
    try {
      current = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      current = {};
    }
    current.ollama = { ...(current.ollama ?? {}), model };
    fs.writeFileSync(filePath, JSON.stringify(current, null, 2) + "\n", "utf8");
    this.post({ type: "config", model });
    this.post({ type: "guard", text: `Model set to ${model} (saved to dconx.config.json).` });
  }

  private requestApproval(id: string, announce: () => void): Promise<boolean> {
    announce();
    return new Promise<boolean>((resolve) => this.pendingApprovals.set(id, resolve));
  }

  private announceEdit(edit: PendingEdit): void {
    this.post({
      type: "approval",
      id: edit.id,
      kind: edit.kind,
      relPath: edit.relPath,
      diff: edit.diff,
      added: edit.added,
      removed: edit.removed,
    });
  }

  private announceCommand(command: PendingCommand): void {
    this.post({
      type: "commandApproval",
      id: command.id,
      command: command.command,
      cwd: command.cwd,
      rule: command.matchedRule,
    });
  }

  private forward(e: AgentEvent): void {
    switch (e.type) {
      case "assistant":
        this.post({ type: "assistant", text: String(e.text ?? "") });
        break;
      case "error":
        this.post({ type: "error", message: String(e.message ?? "Unknown error") });
        break;
      case "status":
        this.post({ type: "status", state: e.state as "thinking" | "idle" | "cancelled" });
        break;
      case "tool":
        this.post({ type: "tool", name: String(e.name), detail: describeArgs(e.args) });
        break;
      case "blocked":
        this.post({ type: "guard", text: `GUARD: ${String(e.reason ?? "")}` });
        break;
      case "commandFinished":
        this.post({
          type: "commandResult",
          command: String(e.command ?? ""),
          exitCode: (e.exitCode as number | null) ?? null,
        });
        break;
      case "autoCreated": {
        const id = String(e.id ?? "");
        this.undoRegistry.record(id, {
          relPath: String(e.relPath ?? ""),
          absPath: String(e.absPath ?? ""),
          content: String(e.content ?? ""),
        });
        this.post({
          type: "created",
          id,
          relPath: String(e.relPath ?? ""),
          added: Number(e.added ?? 0),
        });
        break;
      }
      case "question":
        this.post({
          type: "question",
          question: String(e.question ?? ""),
          options: Array.isArray(e.options) ? (e.options as string[]) : [],
        });
        break;
    }
  }

  private post(msg: HostMessage): void {
    const payload = `data: ${JSON.stringify(msg)}\n\n`;
    for (const client of this.clients) client.write(payload);
  }
}

const ASSETS: Record<string, { file: string; type: string }> = {
  "/chat.css": { file: "chat.css", type: "text/css; charset=utf-8" },
  "/web-theme.css": { file: "web-theme.css", type: "text/css; charset=utf-8" },
  "/chat.js": { file: "chat.js", type: "text/javascript; charset=utf-8" },
  "/web-bridge.js": { file: "web-bridge.js", type: "text/javascript; charset=utf-8" },
};

function describeArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  const detail = a.path ?? a.dir ?? a.pattern ?? a.command ?? "";
  return typeof detail === "string" ? detail : "";
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.root) || !fs.statSync(args.root).isDirectory()) {
    console.error(`Not a folder: ${args.root}`);
    console.error(`Usage: npm run web -- <project-folder> [--port ${DEFAULT_PORT}]`);
    process.exit(1);
  }
  new WebServer(args).listen();
}

main();
