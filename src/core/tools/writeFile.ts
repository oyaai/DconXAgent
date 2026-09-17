import { assertContentSize, resolveSafePath } from "../guard";
import { proposeEdit } from "./editGate";
import { defineTool, optionalString, requireString } from "./types";

export const writeFile = defineTool(
  "write_file",
  "Propose the full new contents of a file (creating it if absent). Use only for new or small " +
    "files; prefer replace_in_file. The user must approve the diff before anything is written.",
  {
    properties: {
      path: { type: "string", description: "Workspace-relative file path." },
      content: { type: "string", description: "Complete new file contents." },
    },
    required: ["path", "content"],
  },
  async (args, ctx) => {
    const { abs, rel } = resolveSafePath(requireString(args, "path"), ctx.root, ctx.cfg);
    const content = optionalString(args, "content");
    assertContentSize(content, ctx.cfg);
    return proposeEdit(rel, abs, content, ctx);
  }
);
