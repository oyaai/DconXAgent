/** Shared directory walk used by list_files and search_files. */

import * as fs from "fs/promises";
import * as path from "path";

/**
 * Directories skipped before the guard even sees them. This is a performance
 * and noise filter, NOT a security boundary — `guard.denyGlobs` is the boundary.
 */
export const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "out",
  "build",
  ".next",
  ".venv",
  "__pycache__",
]);

export interface WalkOptions {
  /** 0 = the directory itself only. */
  depth: number;
  /** Stop collecting past this many entries. */
  limit?: number;
}

/** Returns workspace-relative POSIX paths; directories carry a trailing slash. */
export async function walk(
  dir: string,
  root: string,
  opts: WalkOptions,
  acc: string[] = []
): Promise<string[]> {
  const limit = opts.limit ?? 500;
  if (opts.depth < 0 || acc.length >= limit) return acc;

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }

  for (const e of entries) {
    if (acc.length >= limit) break;
    if (e.name.startsWith(".") && e.name !== ".vscode") continue;
    if (SKIP_DIRS.has(e.name)) continue;

    const abs = path.join(dir, e.name);
    const rel = path.relative(root, abs).split(path.sep).join("/");

    if (e.isDirectory()) {
      acc.push(rel + "/");
      await walk(abs, root, { ...opts, depth: opts.depth - 1 }, acc);
    } else if (e.isFile()) {
      acc.push(rel);
    }
  }
  return acc;
}
