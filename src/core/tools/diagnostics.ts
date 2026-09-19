import { defineTool, optionalString } from "./types";
import type { DiagnosticInfo } from "../ports";

const MAX_REPORTED = 50;

function format(d: DiagnosticInfo): string {
  const code = d.code ? ` [${d.code}]` : "";
  const source = d.source ? `${d.source}: ` : "";
  return `${d.relPath}:${d.line} ${d.severity}: ${source}${d.message}${code}`;
}

/**
 * Surfaces the real compiler/linter output from VS Code's Problems panel, so the
 * model fixes the error the toolchain actually reports rather than one it guessed.
 */
export const diagnostics = defineTool(
  "get_diagnostics",
  "Read the current errors and warnings from VS Code's Problems panel (TypeScript, ESLint, and any other language server). " +
    "Call this after an edit is applied to check whether it worked, and when the user reports a bug without pasting the error.",
  {
    properties: {
      path: {
        type: "string",
        description: "Optional workspace-relative file. Omit for the whole workspace.",
      },
      severity: {
        type: "string",
        description: "Optional filter: 'error' to see only errors. Default: errors and warnings.",
      },
    },
    required: [],
  },
  async (args, ctx) => {
    const relPath = optionalString(args, "path").trim();
    const wanted = optionalString(args, "severity").trim().toLowerCase();

    let found = ctx.editor.getDiagnostics(relPath || undefined);
    found = found.filter((d) =>
      wanted === "error" ? d.severity === "error" : d.severity === "error" || d.severity === "warning"
    );

    if (found.length === 0) {
      const scope = relPath ? relPath : "the workspace";
      return {
        text:
          `No errors or warnings reported in ${scope}. ` +
          `Note: a language server only reports on files it has opened or analysed, so this is not proof the project builds. ` +
          `Use run_command with the project's build or test command when that matters.`,
      };
    }

    // Errors first — they are what blocks the user.
    const order = { error: 0, warning: 1, info: 2, hint: 3 };
    found.sort((a, b) => order[a.severity] - order[b.severity] || a.relPath.localeCompare(b.relPath));

    const shown = found.slice(0, MAX_REPORTED).map(format);
    const extra = found.length > MAX_REPORTED ? `\n… and ${found.length - MAX_REPORTED} more.` : "";
    return { text: `${found.length} problem(s):\n${shown.join("\n")}${extra}` };
  }
);
