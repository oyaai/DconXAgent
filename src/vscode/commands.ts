/** Command registrations, kept out of activate() so the wiring stays readable. */

import * as vscode from "vscode";
import { listModels } from "../core/ollama";
import type { ChatViewProvider } from "./chatViewProvider";
import { readConfig, setModel } from "./config";

export function registerCommands(
  context: vscode.ExtensionContext,
  provider: ChatViewProvider
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("dconx.newTask", () => provider.newTask()),
    vscode.commands.registerCommand("dconx.pickModel", () => pickModel(provider))
  );
}

async function pickModel(provider: ChatViewProvider): Promise<void> {
  const { baseUrl } = readConfig().ollama;

  let models: string[];
  try {
    models = await listModels(baseUrl);
  } catch (e) {
    void vscode.window.showErrorMessage((e as Error).message);
    return;
  }

  if (models.length === 0) {
    void vscode.window.showWarningMessage(
      "Ollama has no models installed. Try: ollama pull qwen2.5-coder:7b"
    );
    return;
  }

  const picked = await vscode.window.showQuickPick(models, { placeHolder: "Ollama model" });
  if (!picked) return;

  await setModel(picked);
  provider.notifyModelChanged();
}
