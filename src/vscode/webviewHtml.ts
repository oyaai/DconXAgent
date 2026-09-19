/**
 * The webview shell.
 *
 * The markup lives in media/chat.body.html and the behaviour in media/chat.js —
 * both shared verbatim with the local web UI, so a change to the chat panel
 * lands in both frontends at once. This file only adds the VS Code-specific
 * wrapper: the CSP, the nonce, and webview-resolved asset URIs.
 */

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export function renderChatHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = makeNonce();
  const asset = (...parts: string[]) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...parts));

  const styleUri = asset("media", "chat.css");
  const scriptUri = asset("media", "chat.js");
  const body = fs.readFileSync(
    path.join(extensionUri.fsPath, "media", "chat.body.html"),
    "utf8"
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <link rel="stylesheet" href="${styleUri}" />
</head>
<body>
${body}
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
