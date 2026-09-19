/**
 * The only place that reads VS Code settings.
 *
 * Everything under src/core takes a DconxConfig argument instead, so core logic
 * can be exercised with a plain object. Keys here must match the ids declared in
 * package.json `contributes.configuration` — test/config.test.js checks that.
 */

import * as vscode from "vscode";
import { DEFAULT_CONFIG, type DconxConfig } from "../core/config";

export const CONFIG_ROOT = "dconx";

export function readConfig(): DconxConfig {
  const ollama = vscode.workspace.getConfiguration("dconx.ollama");
  const guard = vscode.workspace.getConfiguration("dconx.guard");
  const agent = vscode.workspace.getConfiguration("dconx.agent");
  const d = DEFAULT_CONFIG;

  return {
    ollama: {
      baseUrl: ollama.get("baseUrl", d.ollama.baseUrl),
      model: ollama.get("model", d.ollama.model),
      temperature: ollama.get("temperature", d.ollama.temperature),
      numCtx: ollama.get("numCtx", d.ollama.numCtx),
      // Env var wins over the setting, so a key need not be written into settings.json.
      apiKey: process.env.OLLAMA_API_KEY ?? ollama.get("apiKey", d.ollama.apiKey),
      headers: ollama.get("headers", d.ollama.headers),
      requestTimeoutMs: ollama.get("requestTimeoutMs", d.ollama.requestTimeoutMs),
    },
    guard: {
      denyGlobs: guard.get("denyGlobs", d.guard.denyGlobs),
      allowGlobs: guard.get("allowGlobs", d.guard.allowGlobs),
      maxEditLines: guard.get("maxEditLines", d.guard.maxEditLines),
      maxFileBytes: guard.get("maxFileBytes", d.guard.maxFileBytes),
      allowCreate: guard.get("allowCreate", d.guard.allowCreate),
      autoApproveCreate: guard.get("autoApproveCreate", d.guard.autoApproveCreate),
      allowDelete: guard.get("allowDelete", d.guard.allowDelete),
      allowCommands: guard.get("allowCommands", d.guard.allowCommands),
      commandAllowlist: guard.get("commandAllowlist", d.guard.commandAllowlist),
      commandTimeoutMs: guard.get("commandTimeoutMs", d.guard.commandTimeoutMs),
      commandOutputLimit: guard.get("commandOutputLimit", d.guard.commandOutputLimit),
    },
    agent: {
      maxIterations: agent.get("maxIterations", d.agent.maxIterations),
      scratchFolder: agent.get("scratchFolder", d.agent.scratchFolder),
    },
  };
}

export async function setModel(model: string): Promise<void> {
  await vscode.workspace
    .getConfiguration("dconx.ollama")
    .update("model", model, vscode.ConfigurationTarget.Global);
}

/** Throws a message the user can act on, rather than a bare undefined. */
export function requireWorkspaceRoot(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    throw new Error("No workspace folder is open. Dconx Agent only operates inside an open folder.");
  }
  return folders[0].uri.fsPath;
}
