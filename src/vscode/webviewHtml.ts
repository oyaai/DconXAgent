/**
 * The webview shell. Styles and behaviour live in media/chat.css and
 * media/chat.js as real files — editable, diffable, and type-checked — instead
 * of being buried in a template literal.
 */

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

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <link rel="stylesheet" href="${styleUri}" />
</head>
<body>
  <div id="log" role="log" aria-live="polite"></div>
  <div id="composer">
    <textarea id="input" rows="3"
      placeholder="Describe the change you want. Every edit is shown as a diff for your approval."></textarea>
    <div id="bar">
      <button id="model" class="link" title="Pick an Ollama model">model: …</button>
      <span id="status"></span>
      <span class="spacer"></span>
      <button id="stop" class="secondary" hidden>Stop</button>
      <button id="send">Send</button>
    </div>
  </div>
  <template id="approval-card">
    <div class="card">
      <header><span class="title"></span><span class="stat"></span></header>
      <pre class="diff"></pre>
      <div class="actions">
        <button data-act="approve">Approve</button>
        <button data-act="reject" class="secondary">Reject</button>
      </div>
    </div>
  </template>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
