/**
 * Bridges the agent's approval requests to the user's click.
 *
 * Owns exactly one job: hold the pending promises and resolve each one once.
 * Keeping this separate from the view provider makes the "nothing irreversible
 * happens without a human" invariant easy to read — and easy to keep true if the
 * UI changes.
 */

import * as vscode from "vscode";
import type { ApprovalPort, PendingCommand, PendingEdit } from "../core/tools";
import { ProposalProvider } from "./proposalProvider";

type Resolver = (approved: boolean) => void;

interface PendingEntry {
  resolve: Resolver;
  /** Set for edits only: the proposed-content uri to release afterwards. */
  uri?: vscode.Uri;
}

export interface ApprovalAnnouncer {
  announceEdit(edit: PendingEdit): void;
  announceCommand(command: PendingCommand): void;
}

export class ApprovalBroker implements ApprovalPort {
  private readonly pending = new Map<string, PendingEntry>();

  constructor(
    private readonly proposals: ProposalProvider,
    private readonly announcer: ApprovalAnnouncer
  ) {}

  /** Opens the native diff, shows the card, then waits for a click. */
  async requestEdit(edit: PendingEdit): Promise<boolean> {
    const uri = this.proposals.set(edit.id, edit.relPath, edit.newText);
    await this.showDiff(edit, uri);
    this.announcer.announceEdit(edit);
    return new Promise<boolean>((resolve) => this.pending.set(edit.id, { resolve, uri }));
  }

  async requestCommand(command: PendingCommand): Promise<boolean> {
    this.announcer.announceCommand(command);
    return new Promise<boolean>((resolve) => this.pending.set(command.id, { resolve }));
  }

  /** Returns false if the id was unknown or already resolved. */
  resolve(id: string, approved: boolean): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    this.pending.delete(id);
    if (entry.uri) this.proposals.release(entry.uri);
    entry.resolve(approved);
    return true;
  }

  /** Rejects everything outstanding — used when the user starts a new task. */
  rejectAll(): void {
    for (const id of [...this.pending.keys()]) {
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
