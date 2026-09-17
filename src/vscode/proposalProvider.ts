/**
 * Serves the proposed version of a file to VS Code's native diff editor under
 * the `dconx-proposed:` scheme, so the user reviews edits in real editor UI
 * rather than in a webview approximation.
 */

import * as vscode from "vscode";

export const PROPOSAL_SCHEME = "dconx-proposed";

export class ProposalProvider implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;

  /** Registers `text` as the proposed content and returns the uri that serves it. */
  set(id: string, relPath: string, text: string): vscode.Uri {
    const uri = vscode.Uri.parse(`${PROPOSAL_SCHEME}:${relPath}?${encodeURIComponent(id)}`);
    this.contents.set(uri.toString(), text);
    this.emitter.fire(uri);
    return uri;
  }

  /** Called once an edit is resolved, so the map does not grow for the session. */
  release(uri: vscode.Uri): void {
    this.contents.delete(uri.toString());
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? "";
  }

  dispose(): void {
    this.contents.clear();
    this.emitter.dispose();
  }
}
