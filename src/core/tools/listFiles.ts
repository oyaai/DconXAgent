import { resolveSafeDir } from "../guard";
import { walk } from "./walk";
import { defineTool, optionalBool, optionalString } from "./types";

export const listFiles = defineTool(
  "list_files",
  "List files and folders under a workspace-relative directory. Use this first to orient yourself.",
  {
    properties: {
      dir: { type: "string", description: "Workspace-relative directory. Use '.' for the root." },
      recursive: { type: "boolean", description: "Recurse into subdirectories (max depth 3)." },
    },
    required: ["dir"],
  },
  async (args, ctx) => {
    const { abs, rel } = resolveSafeDir(optionalString(args, "dir", "."), ctx.root, ctx.cfg);
    const entries = await walk(abs, ctx.root, { depth: optionalBool(args, "recursive") ? 3 : 0 });
    const label = rel || ".";
    return {
      text: entries.length
        ? `Files under ${label}:\n${entries.join("\n")}`
        : `No visible files under ${label}.`,
    };
  }
);
