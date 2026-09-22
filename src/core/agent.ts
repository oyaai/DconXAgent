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
import { ChatMessage, chat, extractFallbackToolCall, parseToolArgs } from "./ollama";
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

      // A long-running task accumulates file contents in tool-call history (every
      // write_file's full argument text stays in `this.messages` forever). Once
      // that gets close to the model's context window, a small local model can take
      // minutes to prefill and still not answer before dconx.ollama.requestTimeoutMs
      // — which looks exactly like a hang. Catching it here costs nothing and turns
      // a silent multi-minute timeout into an immediate, actionable message.
      const budget = estimateContextBudgetChars(config.ollama.numCtx);
      const used = estimateMessageChars(this.messages);
      if (used > budget) {
        this.host.onEvent({
          type: "error",
          message:
            `This conversation has grown too large for the model's context window ` +
            `(numCtx=${config.ollama.numCtx}) and would likely time out instead of responding. ` +
            `Click "+" to start a new task — it keeps working on the same files, it just clears ` +
            `the chat history. Raising dconx.ollama.numCtx works too, if the model and machine can take it.`,
        });
        return;
      }

      const result = await chat(config.ollama, this.messages, TOOL_SCHEMAS, signal);

      let toolCalls = result.toolCalls;
      let content = result.content;

      // The model sometimes prints the tool call as JSON text instead of using
      // Ollama's tool-calling channel. Recover it rather than showing the user
      // a wall of JSON and quietly ending the turn — see extractFallbackToolCall.
      if (toolCalls.length === 0) {
        const fallback = extractFallbackToolCall(
          content,
          TOOLS.map((t) => t.name)
        );
        if (fallback) {
          toolCalls = [fallback];
          content = "";
        }
      }

      this.messages.push({
        role: "assistant",
        content,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      });

      if (content.trim() !== "") {
        this.host.onEvent({ type: "assistant", text: content });
      }

      // Prose with no tool call means the model considers the turn over.
      if (toolCalls.length === 0) return;

      for (const call of toolCalls) {
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

/**
 * Total characters of everything that will be sent back to Ollama, including tool
 * call arguments — which is where a created file's full contents actually live in
 * history, not in its short "CREATED path (n lines)" tool-result text.
 */
export function estimateMessageChars(messages: readonly ChatMessage[]): number {
  let total = 0;
  for (const m of messages) {
    total += m.content.length;
    if (m.tool_calls) {
      for (const call of m.tool_calls) {
        const args = call.function.arguments;
        total += typeof args === "string" ? args.length : JSON.stringify(args).length;
      }
    }
  }
  return total;
}

/**
 * A conservative chars-of-history budget derived from numCtx. Ollama does not
 * expose the model's real tokenizer over HTTP, so this uses a deliberately
 * generous ~3.2 chars/token estimate (code and JSON run shorter than English
 * prose) and only spends 75% of the window, leaving room for the system prompt
 * overhead already counted in `messages` and for the model's own reply.
 */
export function estimateContextBudgetChars(numCtx: number): number {
  return Math.floor(numCtx * 3.2 * 0.75);
}
