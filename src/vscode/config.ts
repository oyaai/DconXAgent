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
    },
    guard: {
      denyGlobs: guard.get("denyGlobs", d.guard.denyGlobs),
      allowGlobs: guard.get("allowGlobs", d.guard.allowGlobs),
      maxEditLines: guard.get("maxEditLines", d.guard.maxEditLines),
      maxFileBytes: guard.get("maxFileBytes", d.guard.maxFileBytes),
      allowCreate: guard.get("allowCreate", d.guard.allowCreate),
      allowDelete: guard.get("allowDelete", d.guard.allowDelete),
    },
    agent: {
      maxIterations: agent.get("maxIterations", d.agent.maxIterations),
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
