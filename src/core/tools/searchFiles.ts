import * as fs from "fs/promises";
import { assertReadableSize, resolveSafePath } from "../guard";
import { GuardError } from "../errors";
import { walk } from "./walk";
import { defineTool, optionalString, requireString } from "./types";

const MAX_HITS = 100;

export const searchFiles = defineTool(
  "search_files",
  "Regex-search file contents across the workspace. Returns matching path:line snippets.",
  {
    properties: {
      pattern: { type: "string", description: "JavaScript regular expression." },
      extensions: {
        type: "string",
        description: "Optional comma-separated extension filter, e.g. 'ts,tsx,json'.",
      },
    },
    required: ["pattern"],
  },
  async (args, ctx) => {
    const pattern = requireString(args, "pattern");
    let re: RegExp;
    try {
      re = new RegExp(pattern);
    } catch (e) {
      throw new GuardError(`Invalid regular expression: ${(e as Error).message}`);
    }

    const exts = optionalString(args, "extensions")
      .split(",")
      .map((s) => s.trim().replace(/^\./, ""))
      .filter(Boolean);

    const candidates = await walk(ctx.root, ctx.root, { depth: 4, limit: 2000 });
    const hits: string[] = [];

    for (const rel of candidates) {
      if (hits.length >= MAX_HITS) break;
      if (rel.endsWith("/")) continue;
      if (exts.length > 0 && !exts.includes(rel.split(".").pop() ?? "")) continue;

      let abs: string;
      try {
        abs = resolveSafePath(rel, ctx.root, ctx.cfg).abs;
        await assertReadableSize(abs, ctx.cfg);
      } catch {
        continue; // denied or oversized — silently skipped, not an error
      }

      let content: string;
      try {
        content = await fs.readFile(abs, "utf8");
      } catch {
        continue;
      }

      const lines = content.split("\n");
      for (let i = 0; i < lines.length && hits.length < MAX_HITS; i++) {
        if (re.test(lines[i])) {
          hits.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
        }
      }
    }

    return { text: hits.length ? hits.join("\n") : "No matches." };
  }
);
