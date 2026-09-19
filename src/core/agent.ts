/**
 * The agent loop: prompt -> model -> tool calls -> tool results -> repeat.
 *
 * Deliberately free of any VS Code import. Everything environment-specific
 * arrives through AgentHost, which means the loop can be driven from a test or
 * a CLI without a running editor.
 */

import type { DconxConfig } from "./config";
import { OllamaError } from "./errors";
import type { EditorPort, ShellPort } from "./ports";
import { ChatMessage, chat, parseToolArgs } from "./ollama";
import { buildSystemPrompt } from "./prompt";
import { TOOLS, TOOL_SCHEMAS, runTool } from "./tools";
import type { AgentEvent, ApprovalPort, ToolContext } from "./tools/types";

export type { AgentEvent };

/** The seam between the pure loop and its environment. Implemented by src/vscode/chatViewProvider.ts. */
export interface AgentHost {
  /** Read fresh each turn so settings changes take effect without a reload. */
  getConfig(): DconxConfig;
  /** Absolute workspace root. Throw to abort the turn with a readable message. */
  getWorkspaceRoot(): string;
  approve: ApprovalPort;
  editor: EditorPort;
  shell: ShellPort;
  onEvent(event: AgentEvent): void;
}

export class Agent {
  private messages: ChatMessage[] = [];
  private controller: AbortController | undefined;
  private running = false;

  constructor(private readonly host: AgentHost) {}

  get isRunning(): boolean {
    return this.running;
  }

  /** Clears conversation history. The next send starts a fresh task. */
  reset(): void {
    this.cancel();
    this.messages = [];
  }

  cancel(): void {
    this.controller?.abort();
    this.controller = undefined;
  }

  async send(userText: string): Promise<void> {
    if (this.running) {
      this.host.onEvent({ type: "error", message: "A task is already running." });
      return;
    }

    let config: DconxConfig;
    let root: string;
    try {
      config = this.host.getConfig();
      root = this.host.getWorkspaceRoot();
    } catch (e) {
      this.host.onEvent({ type: "error", message: (e as Error).message });
      return;
    }

    if (this.messages.length === 0) {
      this.messages.push({
        role: "system",
        content: buildSystemPrompt(config, root, TOOLS.map((t) => t.name)),
      });
    }
    this.messages.push({ role: "user", content: userText });

    const ctx: ToolContext = {
      root,
      cfg: config.guard,
      approve: this.host.approve,
      editor: this.host.editor,
      shell: this.host.shell,
      onEvent: (e) => this.host.onEvent(e),
    };

    this.running = true;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.host.onEvent({ type: "status", state: "thinking", model: config.ollama.model });

    try {
      await this.loop(config, ctx, signal);
    } catch (e) {
      this.reportFailure(e);
    } finally {
      this.running = false;
      this.controller = undefined;
      this.host.onEvent({ type: "status", state: "idle" });
    }
  }

  private async loop(config: DconxConfig, ctx: ToolContext, signal: AbortSignal): Promise<void> {
    const maxIterations = config.agent.maxIterations;

    for (let round = 0; round < maxIterations; round++) {
      if (signal.aborted) return;

      const result = await chat(config.ollama, this.messages, TOOL_SCHEMAS, signal);

      this.messages.push({
        role: "assistant",
        content: result.content,
        tool_calls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
      });

      if (result.content.trim() !== "") {
        this.host.onEvent({ type: "assistant", text: result.content });
      }

      // Prose with no tool call means the model considers the turn over.
      if (result.toolCalls.length === 0) return;

      for (const call of result.toolCalls) {
        if (signal.aborted) return;

        const name = call.function.name;
        const args = parseToolArgs(call);
        this.host.onEvent({ type: "tool", name, args });

        const outcome = await runTool(name, args, ctx);
        this.host.onEvent({ type: "toolResult", name, text: outcome.text });
        this.messages.push({ role: "tool", tool_name: name, content: outcome.text });

        if (outcome.done) return;
      }
    }

    this.host.onEvent({
      type: "error",
      message: `Stopped after ${maxIterations} tool rounds. Send another message to continue.`,
    });
  }

  private reportFailure(e: unknown): void {
    const err = e as Error;
    if (err?.name === "AbortError") {
      this.host.onEvent({ type: "status", state: "cancelled" });
      return;
    }
    this.host.onEvent({
      type: "error",
      message: e instanceof OllamaError ? err.message : `Unexpected error: ${err?.message ?? e}`,
    });
  }
}
