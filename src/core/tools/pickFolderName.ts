/**
 * Support for "start a brand new project" when the workspace already has one or
 * more previously-generated projects in it. Without this, a small model tends to
 * reuse the same folder name it used last time (e.g. "react-demo" every time), and
 * the second file it writes there collides with an existing file — which turns
 * what should be an instant auto-create into a "modify" that needs Approve, and
 * the model was never told to expect that. This tool makes a fresh, guaranteed-free
 * name for it instead, the same way a file manager appends "(2)" to a duplicate.
 *
 * Read-only: it only stats paths to see what already exists. No approval needed.
 */

import * as fs from "fs/promises";
import { resolveSafePath } from "../guard";
import { defineTool, requireString } from "./types";

const MAX_ATTEMPTS = 200;

async function pathExists(absPath: string): Promise<boolean> {
  try {
    await fs.stat(absPath);
    return true;
  } catch {
    return false;
  }
}

export const pickFolderName = defineTool(
  "pick_folder_name",
  "Given a short base folder name for a brand new project (e.g. react-demo), returns a " +
    "workspace-relative folder name that does not collide with anything already there — " +
    "appending -2, -3, ... if needed. Call this once, right after choosing a base name, before " +
    "creating any files, whenever the user picked \"a new folder here\" for a new project. " +
    "Read-only, no approval needed.",
  {
    properties: {
      base: { type: "string", description: "The folder name you would like to use, e.g. react-demo." },
    },
    required: ["base"],
  },
  async (args, ctx) => {
    const base = requireString(args, "base")
      .trim()
      .replace(/[\\/]+$/, "");

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
      const { abs, rel } = resolveSafePath(candidate, ctx.root, ctx.cfg);
      if (!(await pathExists(abs))) {
        return {
          text:
            candidate === base
              ? `"${rel}" is free. Use it as the path prefix for every file you create for this project.`
              : `"${base}" already exists in the workspace. Use "${rel}" instead as the path prefix ` +
                `for every file you create for this project — do not reuse "${base}".`,
        };
      }
    }

    return {
      text: `Could not find a free name near "${base}" after ${MAX_ATTEMPTS} tries. Ask the user for a name with ask_user.`,
    };
  }
);
