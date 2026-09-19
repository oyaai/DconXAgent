/**
 * The contract every tool implements.
 *
 * ADDING A TOOL:
 *   1. Create `src/core/tools/myTool.ts` exporting a ToolDefinition.
 *   2. Add it to the array in `src/core/tools/index.ts`.
 * Nothing else changes — the schema sent to the model, the dispatcher and the
 * tests all read from that one array.
 */

import type { GuardConfig } from "../config";
import type { EditorPort, ShellPort } from "../ports";
import type { ToolSchema } from "../ollama";
import { GuardError } from "../errors";

export type EditKind = "modify" | "create" | "delete";

/** A file change that has been built and checked, but not yet written to disk. */
export interface PendingEdit {
  id: string;
  kind: EditKind;
  relPath: string;
  absPath: string;
  oldText: string;
  newText: string;
  /** Unified diff, for display only. */
  diff: string;
  added: number;
  removed: number;
}

/** A command the user has been asked to approve, before it runs. */
export interface PendingCommand {
  id: string;
  command: string;
  cwd: string;
  /** The allowlist entry that permitted it — shown to the user for context. */
  matchedRule: string;
}

/**
 * The human gate. Both methods must resolve `true` only after an explicit click.
 * This is the single chokepoint between the model and anything irreversible.
 */
export interface ApprovalPort {
  requestEdit(edit: PendingEdit): Promise<boolean>;
  requestCommand(command: PendingCommand): Promise<boolean>;
}

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

/** Everything a tool is allowed to touch. Tools receive this; they never reach for globals. */
export interface ToolContext {
  /** Absolute workspace root. All paths resolve against it. */
  root: string;
  cfg: GuardConfig;
  approve: ApprovalPort;
  /** Read-only view of the user's editor. */
  editor: EditorPort;
  /** Runs commands that commandGuard has already validated and the user approved. */
  shell: ShellPort;
  onEvent(event: AgentEvent): void;
}

export interface ToolOutcome {
  /** Text handed back to the model as the tool result. */
  text: string;
  /** Set by attempt_completion to end the agent's turn. */
  done?: boolean;
}

export interface ToolDefinition {
  readonly name: string;
  readonly schema: ToolSchema;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome>;
}

/** Small helper so every tool declares its schema the same way. */
export function defineTool(
  name: string,
  description: string,
  parameters: { properties: Record<string, unknown>; required?: string[] },
  run: ToolDefinition["run"]
): ToolDefinition {
  return {
    name,
    schema: {
      type: "function",
      function: {
        name,
        description,
        parameters: {
          type: "object",
          properties: parameters.properties,
          required: parameters.required ?? [],
        },
      },
    },
    run,
  };
}

/** Models routinely omit or mistype arguments; fail with a message they can act on. */
export function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.trim() === "") {
    throw new GuardError(`The "${key}" argument is required and must be a non-empty string.`);
  }
  return v;
}

export function optionalString(args: Record<string, unknown>, key: string, fallback = ""): string {
  const v = args[key];
  return typeof v === "string" ? v : fallback;
}

export function optionalBool(args: Record<string, unknown>, key: string, fallback = false): boolean {
  const v = args[key];
  return typeof v === "boolean" ? v : fallback;
}
