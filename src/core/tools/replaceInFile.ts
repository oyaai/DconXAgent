import * as fs from "fs/promises";
import { assertReadableSize, resolveSafePath } from "../guard";
import { proposeEdit } from "./editGate";
import { defineTool, optionalString, requireString } from "./types";

export const replaceInFile = defineTool(
  "replace_in_file",
  "Propose an edit by replacing an exact block of existing text. Preferred over write_file. " +
    "The user must approve the resulting diff before anything is written.",
  {
    properties: {
      path: { type: "string", description: "Workspace-relative file path." },
      search: {
        type: "string",
        description: "Exact existing text to replace. Must appear exactly once in the file.",
      },
      replace: { type: "string", description: "Replacement text." },
    },
    required: ["path", "search", "replace"],
  },
  async (args, ctx) => {
    const { abs, rel } = resolveSafePath(requireString(args, "path"), ctx.root, ctx.cfg);
    await assertReadableSize(abs, ctx.cfg);

    const oldText = await fs.readFile(abs, "utf8");
    const search = requireString(args, "search");
    const replace = optionalString(args, "replace");

    const first = oldText.indexOf(search);
    if (first === -1) {
      return {
        text:
          `NOT FOUND: the search block does not appear in ${rel}. ` +
          `Re-read the file and copy the exact text, including indentation.`,
      };
    }
    if (oldText.indexOf(search, first + 1) !== -1) {
      return {
        text:
          `AMBIGUOUS: the search block appears more than once in ${rel}. ` +
          `Include surrounding lines to make it unique.`,
      };
    }

    const newText = oldText.slice(0, first) + replace + oldText.slice(first + search.length);
    return proposeEdit(rel, abs, newText, ctx);
  }
);
