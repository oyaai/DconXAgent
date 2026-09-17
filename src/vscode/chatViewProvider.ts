/**
 * The adapter between the VS Code webview and the pure Agent loop.
 *
 * Its only real work is translating: loose AgentEvents become typed HostMessages
 * going out, and ViewMessages become method calls coming in. Keep logic out of
 * here — if something is worth testing, it belongs in src/core.
 */

import * as vscode from "vscode";
import { Agent, type AgentEvent } from "../core/agent";
import type { PendingEdit } from "../core/tools";
import type { HostMessage, ViewMessage } from "../protocol";
import { ApprovalBroker } from "./approvals";
import { readConfig, requireWorkspaceRoot } from "./config";
import { ProposalProvider } from "./proposalProvider";
import { renderChatHtml } from "./webviewHtml";

export const CHAT_VIEW_ID = "dconx.chat";

export class ChatViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private readonly agent: Agent;
  private readonly approvals: ApprovalBroker;

  constructor(
    private readonly extensionUri: vscode.Uri,
    proposals: ProposalProvider
  ) {
    this.approvals = new ApprovalBroker(proposals);
    this.agent = new Agent({
      getConfig: readConfig,
      getWorkspaceRoot: requireWorkspaceRoot,
      onEvent: (e) => this.forward(e),
      requestApproval: (edit) => this.requestApproval(edit),
    });
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    view.webview.html = renderChatHtml(view.webview, this.extensionUri);
    view.webview.onDidReceiveMessage((m: ViewMessage) => void this.handle(m));
  }

  newTask(): void {
    this.agent.reset();
    this.approvals.rejectAll();
    this.post({ type: "clear" });
  }

  notifyModelChanged(): void {
    this.post({ type: "config", model: readConfig().ollama.model });
  }

  private async handle(msg: ViewMessage): Promise<void> {
    switch (msg.type) {
      case "ready":
        this.notifyModelChanged();
        break;
      case "send":
        await this.agent.send(msg.text);
        break;
      case "cancel":
        this.agent.cancel();
        break;
      case "pickModel":
        await vscode.commands.executeCommand("dconx.pickModel");
        break;
      case "approve":
      case "reject": {
        const approved = msg.type === "approve";
        if (this.approvals.resolve(msg.id, approved)) {
          this.post({ type: "approvalResolved", id: msg.id, approved });
        }
        break;
      }
    }
  }

  private requestApproval(edit: PendingEdit): Promise<boolean> {
    this.view?.show?.(true);
    return this.approvals.request(edit, (e) =>
      this.post({
        type: "approval",
        id: e.id,
        kind: e.kind,
        relPath: e.relPath,
        diff: e.diff,
        added: e.added,
        removed: e.removed,
      })
    );
  }

  /** Translates an AgentEvent into the typed message the webview understands. */
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
      // "applied", "rejected" and "toolResult" are already reflected in the UI
      // by the approval card; they exist for logging and future transcripts.
    }
  }

  private post(msg: HostMessage): void {
    void this.view?.webview.postMessage(msg);
  }
}

function describeArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  const detail = a.path ?? a.dir ?? a.pattern ?? "";
  return typeof detail === "string" ? detail : "";
}
