import { defineTool } from "./types";

/**
 * Lets the model resolve "this file" / "the code I selected" without the user
 * having to type a path. Read-only: it reports what the editor shows, and any
 * change still goes through the normal diff-approval path.
 */
export const editorContext = defineTool(
  "get_editor_context",
  "See which file the user currently has open, what they have selected, and which files are open in tabs. " +
    "Call this FIRST whenever the user says 'this file', 'here', 'the selected code', or does not name a path.",
  { properties: {}, required: [] },
  async (_args, ctx) => {
    const active = ctx.editor.getActiveEditor();
    const open = ctx.editor.getOpenFiles();

    if (!active) {
      return {
        text:
          open.length > 0
            ? `No active editor. Files open in tabs:\n${open.join("\n")}`
            : "No editor is open. Ask the user which file to work on, or use list_files.",
      };
    }

    const lines = [
      `Active file: ${active.relPath}`,
      `Language: ${active.languageId}`,
      `Lines: ${active.lineCount}${active.dirty ? " (unsaved changes)" : ""}`,
    ];

    if (active.selection) {
      lines.push(
        `Selection: lines ${active.selection.startLine}-${active.selection.endLine}`,
        "Selected text:",
        active.selection.text
      );
    } else {
      lines.push("Selection: none (the user has not highlighted anything).");
    }

    if (open.length > 1) {
      lines.push("", `Other open tabs: ${open.filter((f) => f !== active.relPath).join(", ")}`);
    }

    lines.push("", "Use read_file to see the full contents before editing.");
    return { text: lines.join("\n") };
  }
);
