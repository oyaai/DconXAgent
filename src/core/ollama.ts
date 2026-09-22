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

/**
 * Headers for every request. An API key is only meaningful for a remote server,
 * but sending it to localhost is harmless, so there is no special case.
 */
export function buildHeaders(cfg: OllamaConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...cfg.headers,
  };
  if (cfg.apiKey.trim() !== "") {
    headers.Authorization = `Bearer ${cfg.apiKey.trim()}`;
  }
  return headers;
}

/** Turns transport failures into a message that says what to check. */
function describeFailure(cfg: OllamaConfig, e: unknown): string {
  const message = (e as Error).message ?? String(e);
  const base = normalizeBaseUrl(cfg.baseUrl);
  const remote = !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|$|\/)/.test(base);

  if (!remote) {
    return `Cannot reach Ollama at ${base}. Is it running? (${message})`;
  }
  return (
    `Cannot reach the Ollama server at ${base}. (${message}) ` +
    `For a remote server check: the host is up and reachable, it was started with ` +
    `OLLAMA_HOST=0.0.0.0 so it listens beyond localhost, the port is open, and ` +
    `dconx.ollama.apiKey is set if it requires a token.`
  );
}

export async function listModels(cfg: OllamaConfig): Promise<string[]> {
  const base = normalizeBaseUrl(cfg.baseUrl);
  let res: Response;
  try {
    res = await fetch(`${base}/api/tags`, { headers: buildHeaders(cfg) });
  } catch (e) {
    throw new OllamaError(describeFailure(cfg, e));
  }
  if (!res.ok) {
    throw new OllamaError(explainStatus(res.status, base, "/api/tags"));
  }
  const data = (await res.json()) as { models?: Array<{ name: string }> };
  return (data.models ?? []).map((m) => m.name);
}

/** HTTP status codes a remote host actually returns, in words the user can act on. */
export function explainStatus(status: number, base: string, path: string): string {
  if (status === 401 || status === 403) {
    return `Ollama at ${base} rejected the request (${status}). It needs an API key — set dconx.ollama.apiKey, or OLLAMA_API_KEY for the web UI.`;
  }
  if (status === 404) {
    return `${base}${path} returned 404. Check the base URL: it should be the server root, without /api or /v1 on the end.`;
  }
  if (status === 429) {
    return `Ollama at ${base} is rate limiting (429). Wait, or use a different endpoint.`;
  }
  return `Ollama ${path} returned ${status}.`;
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

  // A remote host can accept the connection and then stall; without this the
  // agent would hang with no way back except Stop.
  const timeout = AbortSignal.timeout(cfg.requestTimeoutMs);
  const combined = AbortSignal.any ? AbortSignal.any([signal, timeout]) : signal;

  let res: Response;
  try {
    res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: buildHeaders(cfg),
      body: JSON.stringify(body),
      signal: combined,
    });
  } catch (e) {
    if (signal.aborted) throw e; // the user pressed Stop
    if ((e as Error).name === "TimeoutError" || timeout.aborted) {
      throw new OllamaError(
        `${base} accepted the connection but sent no response within ${cfg.requestTimeoutMs} ms. ` +
          `A large model on a slow remote host may need dconx.ollama.requestTimeoutMs raised.`
      );
    }
    throw new OllamaError(describeFailure(cfg, e));
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const detail = text.trim() === "" ? "" : `: ${text.slice(0, 300)}`;
    throw new OllamaError(explainStatus(res.status, base, "/api/chat") + detail);
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

/**
 * Small local models sometimes fail to use Ollama's native tool-calling channel and
 * instead print the call as plain JSON text — `{"name":"ask_user","arguments":{...}}`,
 * often inside a ```json fence, occasionally with a sentence before or after it. When
 * that happens `chat()` returns an empty toolCalls array and the JSON ends up as a wall
 * of text in the chat with no button and no next step, which looks like the agent hung.
 *
 * This recovers the call so the rest of the agent loop can treat it exactly like a real
 * tool call. It only fires when the parsed object names a tool the agent actually has,
 * so ordinary prose that happens to contain braces is never mistaken for a call.
 */
export function extractFallbackToolCall(
  content: string,
  toolNames: readonly string[]
): ToolCall | undefined {
  const trimmed = content.trim();
  if (trimmed === "") return undefined;

  for (const candidate of candidateJsonSlices(trimmed)) {
    const call = tryParseToolCallJson(candidate);
    if (call && toolNames.includes(call.function.name)) {
      return call;
    }
  }
  return undefined;
}

function candidateJsonSlices(text: string): string[] {
  const slices = [text];

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) slices.push(fenced[1].trim());

  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) slices.push(text.slice(first, last + 1));

  return slices;
}

function tryParseToolCallJson(text: string): ToolCall | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;

  const rec = parsed as Record<string, unknown>;
  const name = typeof rec.name === "string" ? rec.name : undefined;
  const args = rec.arguments;
  const argsLookLikeArgs =
    (typeof args === "object" && args !== null) || typeof args === "string";
  if (!name || !argsLookLikeArgs) return undefined;

  return { function: { name, arguments: args as Record<string, unknown> | string } };
}
