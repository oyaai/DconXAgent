/**
 * Bridges the agent's `requestApproval` promise to the user's click.
 *
 * Owns exactly one job: hold the pending promises and resolve them once. Keeping
 * this separate from the view provider makes the "every edit awaits a human"
 * invariant easy to read — and easy to keep true if the UI changes.
 */

import * as vscode from "vscode";
import type { PendingEdit } from "../core/tools";
import { ProposalProvider } from "./proposalProvider";

type Resolver = (approved: boolean) => void;

export class ApprovalBroker {
  private readonly pending = new Map<string, { resolve: Resolver; uri: vscode.Uri }>();

  constructor(private readonly proposals: ProposalProvider) {}

  /** Opens the native diff, then waits for resolve(). */
  async request(edit: PendingEdit, announce: (edit: PendingEdit) => void): Promise<boolean> {
    const uri = this.proposals.set(edit.id, edit.relPath, edit.newText);
    await this.showDiff(edit, uri);
    announce(edit);

    return new Promise<boolean>((resolve) => {
      this.pending.set(edit.id, { resolve, uri });
    });
  }

  /** Returns false if the id was unknown or already resolved. */
  resolve(id: string, approved: boolean): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    this.pending.delete(id);
    this.proposals.release(entry.uri);
    entry.resolve(approved);
    return true;
  }

  /** Rejects everything outstanding — used when the user starts a new task. */
  rejectAll(): void {
    for (const [id] of [...this.pending]) {
      this.resolve(id, false);
    }
  }

  private async showDiff(edit: PendingEdit, proposed: vscode.Uri): Promise<void> {
    const opts = { preview: true, preserveFocus: true };
    try {
      if (edit.kind === "modify") {
        await vscode.commands.executeCommand(
          "vscode.diff",
          vscode.Uri.file(edit.absPath),
          proposed,
          `${edit.relPath} — proposed (+${edit.added}/-${edit.removed})`,
          opts
        );
      } else {
        await vscode.commands.executeCommand("vscode.open", proposed, opts);
      }
    } catch {
      // The diff editor is a convenience; the webview card is the real gate.
    }
  }
}
