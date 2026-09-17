/**
 * Transport for the local Ollama server. Knows nothing about VS Code, tools or
 * guardrails — swap this file to target a different local runtime (llama.cpp,
 * LM Studio) and the rest of the agent is unchanged.
 */

import type { OllamaConfig } from "./config";
import { OllamaError } from "./errors";

export { OllamaError };

export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export interface ToolCall {
  id?: string;
  function: { name: string; arguments: Record<string, unknown> | string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  /** Ollama expects the tool name under `name` on tool-role messages. */
  tool_name?: string;
}

export interface ChatResult {
  content: string;
  toolCalls: ToolCall[];
}

export async function listModels(baseUrl: string): Promise<string[]> {
  const url = `${normalizeBaseUrl(baseUrl)}/api/tags`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new OllamaError(`Cannot reach Ollama at ${baseUrl}. (${(e as Error).message})`);
  }
  if (!res.ok) {
    throw new OllamaError(`Ollama returned ${res.status} from /api/tags`);
  }
  const data = (await res.json()) as { models?: Array<{ name: string }> };
  return (data.models ?? []).map((m) => m.name);
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

/**
 * One non-streaming tool-calling round against /api/chat.
 *
 * Streaming is deliberately off: Ollama does not emit tool calls incrementally,
 * so a streamed response would have to be buffered before dispatch anyway.
 */
export async function chat(
  cfg: OllamaConfig,
  messages: readonly ChatMessage[],
  tools: readonly ToolSchema[],
  signal: AbortSignal
): Promise<ChatResult> {
  const body = {
    model: cfg.model,
    messages: messages.map(toWireMessage),
    tools,
    stream: false,
    options: { temperature: cfg.temperature, num_ctx: cfg.numCtx },
  };

  const base = normalizeBaseUrl(cfg.baseUrl);
  let res: Response;
  try {
    res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new OllamaError(
      `Cannot reach Ollama at ${base}. Is it running? (${(e as Error).message})`
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new OllamaError(`Ollama /api/chat returned ${res.status}: ${text.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    message?: { content?: string; tool_calls?: ToolCall[] };
    error?: string;
  };
  if (data.error) throw new OllamaError(data.error);

  return { content: data.message?.content ?? "", toolCalls: data.message?.tool_calls ?? [] };
}

function toWireMessage(m: ChatMessage): Record<string, unknown> {
  const out: Record<string, unknown> = { role: m.role, content: m.content };
  if (m.tool_calls) out.tool_calls = m.tool_calls;
  if (m.tool_name) out.name = m.tool_name;
  return out;
}

/** Ollama sends tool arguments as an object, but some models emit a JSON string. */
export function parseToolArgs(call: ToolCall): Record<string, unknown> {
  const raw = call.function.arguments;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return raw ?? {};
}
