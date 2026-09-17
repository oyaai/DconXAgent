/**
 * The tool registry — the single list the model, the dispatcher and the tests
 * all read from.
 *
 * ADDING A TOOL: write `myTool.ts` exporting a ToolDefinition, then add it to
 * TOOLS below. That is the whole change.
 *
 * A tool that modifies files must call `proposeEdit` from ./editGate rather
 * than writing to disk itself.
 */

import { GuardError } from "../errors";
import type { ToolSchema } from "../ollama";
import { attemptCompletion } from "./attemptCompletion";
import { listFiles } from "./listFiles";
import { readFile } from "./readFile";
import { replaceInFile } from "./replaceInFile";
import { searchFiles } from "./searchFiles";
import { writeFile } from "./writeFile";
import type { ToolContext, ToolDefinition, ToolOutcome } from "./types";

export const TOOLS: readonly ToolDefinition[] = [
  listFiles,
  readFile,
  searchFiles,
  replaceInFile,
  writeFile,
  attemptCompletion,
];

export const TOOL_SCHEMAS: readonly ToolSchema[] = TOOLS.map((t) => t.schema);

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/**
 * Dispatches one tool call. Never throws: a failure becomes a tool result the
 * model can read and correct, which is what keeps the loop from dying on a
 * malformed argument.
 */
export async function runTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolOutcome> {
  const tool = BY_NAME.get(name);
  if (!tool) {
    return {
      text: `Unknown tool "${name}". Available: ${TOOLS.map((t) => t.name).join(", ")}.`,
    };
  }

  try {
    return await tool.run(args, ctx);
  } catch (e) {
    if (e instanceof GuardError) {
      ctx.onEvent({ type: "blocked", tool: name, reason: e.message });
      return { text: `GUARD: ${e.message}` };
    }
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { text: `ERROR: no such file. Use list_files to check the path.` };
    }
    return { text: `ERROR: ${(e as Error).message}` };
  }
}

export * from "./types";
export { proposeEdit, resetEditSequence } from "./editGate";
