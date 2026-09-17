import * as fs from "fs/promises";
import { assertReadableSize, resolveSafePath } from "../guard";
import { defineTool, requireString } from "./types";

/** Line numbers help the model quote exact blocks back to replace_in_file. */
function withLineNumbers(text: string): string {
  return text
    .split("\n")
    .map((line, i) => `${String(i + 1).padStart(4)} | ${line}`)
    .join("\n");
}

export const readFile = defineTool(
  "read_file",
  "Read the full text of one workspace-relative file. Always read a file before editing it.",
  {
    properties: { path: { type: "string", description: "Workspace-relative file path." } },
    required: ["path"],
  },
  async (args, ctx) => {
    const { abs, rel } = resolveSafePath(requireString(args, "path"), ctx.root, ctx.cfg);
    await assertReadableSize(abs, ctx.cfg);
    const text = await fs.readFile(abs, "utf8");
    return { text: `${rel}:\n${withLineNumbers(text)}` };
  }
);
