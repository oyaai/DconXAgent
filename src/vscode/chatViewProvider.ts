/**
 * The adapter between the VS Code webview and the pure Agent loop.
 *
 * Its only real work is translating: loose AgentEvents become typed HostMessages
 * going out, and ViewMessages become method calls coming in. Keep logic out of
 * here — if something is worth testing, it belongs in src/core.
 */

import * as vscode from "vscode";
import { Agent, type AgentEvent } from "../core/agent";
import type { PendingCommand, PendingEdit } from "../core/tools";
import type { HostMessage, ViewMessage } from "../protocol";
import { ApprovalBroker } from "./approvals";
import { readConfig, requireWorkspaceRoot } from "./config";
import { VsCodeEditorPort } from "./editorPort";
import { ProposalProvider } from "./proposalProvider";
import { NodeShellPort } from "../node/shellPort";
import { UndoRegistry } from "../node/undoRegistry";
import { renderChatHtml } from "./webviewHtml";

export const CHAT_VIEW_ID = "dconx.chat";

export class ChatViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private readonly agent: Agent;
  private readonly approvals: ApprovalBroker;
  /** Closes the file's editor tab before deleting, so VS Code cannot restore it. */
  private readonly undoRegistry = new UndoRegistry(async (file) => {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.input instanceof vscode.TabInputText && tab.input.uri.fsPath === file.absPath) {
          await vscode.window.tabGroups.close(tab, true);
        }
      }
    }
  });

  constructor(
    private readonly extensionUri: vscode.Uri,
    proposals: ProposalProvider
  ) {
    this.approvals = new ApprovalBroker(proposals, {
      announceEdit: (edit) => this.announceEdit(edit),
      announceCommand: (command) => this.announceCommand(command),
    });

    this.agent = new Agent({
      getConfig: readConfig,
      getWorkspaceRoot: requireWorkspaceRoot,
      approve: this.approvals,
      editor: new VsCodeEditorPort(requireWorkspaceRoot),
      shell: new NodeShellPort(),
      onEvent: (e) => this.forward(e),
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
    this.undoRegistry.clear();
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
      case "undo": {
        const outcome = await this.undoRegistry.undo(msg.id);
        this.post({ type: "undoResult", id: msg.id, ok: outcome.ok, reason: outcome.reason });
        break;
      }
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

  private announceEdit(edit: PendingEdit): void {
    this.view?.show?.(true);
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
    this.view?.show?.(true);
    this.post({
      type: "commandApproval",
      id: command.id,
      command: command.command,
      cwd: command.cwd,
      rule: command.matchedRule,
    });
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
        this.view?.show?.(true);
        this.post({
          type: "question",
          question: String(e.question ?? ""),
          options: Array.isArray(e.options) ? (e.options as string[]) : [],
        });
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
      // "applied", "rejected", "commandStarted" and "toolResult" are already
      // reflected in the UI; they exist for logging and future transcripts.
    }
  }

  private post(msg: HostMessage): void {
    void this.view?.webview.postMessage(msg);
  }
}

function describeArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  const detail = a.path ?? a.dir ?? a.pattern ?? a.command ?? "";
  return typeof detail === "string" ? detail : "";
}
