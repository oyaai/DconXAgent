/**
 * Activation only — this file wires the pieces together and nothing else.
 *
 * Layout:
 *   src/core/**    pure logic, no vscode import (enforced by test/boundary.test.js)
 *   src/vscode/**  VS Code adapters
 *   src/protocol.ts  typed messages shared with media/chat.js
 *   media/**       webview assets
 */

import * as vscode from "vscode";
import { CHAT_VIEW_ID, ChatViewProvider } from "./vscode/chatViewProvider";
import { registerCommands } from "./vscode/commands";
import { PROPOSAL_SCHEME, ProposalProvider } from "./vscode/proposalProvider";

export function activate(context: vscode.ExtensionContext): void {
  const proposals = new ProposalProvider();
  const provider = new ChatViewProvider(context.extensionUri, proposals);

  context.subscriptions.push(
    proposals,
    vscode.workspace.registerTextDocumentContentProvider(PROPOSAL_SCHEME, proposals),
    vscode.window.registerWebviewViewProvider(CHAT_VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("dconx.ollama.model")) provider.notifyModelChanged();
    })
  );

  registerCommands(context, provider);
}

export function deactivate(): void {
  /* subscriptions handle cleanup */
}
