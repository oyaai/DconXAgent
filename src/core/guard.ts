/**
 * The guardrails. Every path the model supplies passes through here before any
 * filesystem call, and every proposed edit passes through here before approval.
 *
 * This module is pure: it takes the workspace root and config as arguments and
 * has no VS Code or filesystem dependency beyond `fs.stat`. That is what makes
 * the security rules directly testable — see test/guard.test.js.
 */

import * as path from "path";
import * as fs from "fs/promises";
import type { GuardConfig } from "./config";
import { GuardError } from "./errors";
import { matchesAny } from "./glob";

export { GuardError };

export interface ResolvedPath {
  /** Absolute path on disk. */
  abs: string;
  /** Workspace-relative path, forward slashes, safe to show the user. */
  rel: string;
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function looksAbsolute(raw: string): boolean {
  return path.isAbsolute(raw) || /^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith("/");
}

/**
 * Resolves a model-supplied path against the workspace root and enforces
 * containment plus the allow/deny lists. Throws GuardError on any violation.
 *
 * Rules, in order:
 *   1. An absolute path is accepted only if it already points inside the root.
 *      It is never silently reinterpreted as relative.
 *   2. The result must be strictly inside the root (the root itself is not a
 *      valid target — use listDirectory for that).
 *   3. Deny globs always win.
 *   4. If an allow list is configured, the path must match it.
 */
export function resolveSafePath(input: string, root: string, cfg: GuardConfig): ResolvedPath {
  if (!input || typeof input !== "string") {
    throw new GuardError("Path is required.");
  }
  const raw = input.trim();

  // An absolute path is honoured as-is when it already points inside the root,
  // and rejected otherwise. It is never silently reinterpreted as relative,
  // which would turn "/etc/passwd" into "<root>/etc/passwd".
  let abs: string;
  if (looksAbsolute(raw)) {
    abs = path.resolve(raw);
    const r = path.relative(root, abs);
    if (r === "" || r.startsWith("..") || path.isAbsolute(r)) {
      throw new GuardError(
        `Blocked: "${input}" is an absolute path outside the workspace root. Use a workspace-relative path.`
      );
    }
  } else {
    abs = path.resolve(root, raw);
  }

  const rel = path.relative(root, abs);

  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new GuardError(
      `Blocked: "${input}" resolves outside the workspace root. The agent may only touch files under ${root}.`
    );
  }

  const relPosix = toPosix(rel);

  const denied = matchesAny(relPosix, cfg.denyGlobs);
  if (denied) {
    throw new GuardError(`Blocked: "${relPosix}" matches the deny pattern "${denied}".`);
  }

  if (cfg.allowGlobs.length > 0 && !matchesAny(relPosix, cfg.allowGlobs)) {
    throw new GuardError(
      `Blocked: "${relPosix}" is outside the configured allow list (${cfg.allowGlobs.join(", ")}).`
    );
  }

  return { abs, rel: relPosix };
}

/** Like resolveSafePath, but "." / "" also resolve to the workspace root itself. */
export function resolveSafeDir(input: string, root: string, cfg: GuardConfig): ResolvedPath {
  const cleaned = (input ?? "").trim();
  if (cleaned === "" || cleaned === "." || cleaned === "./" || cleaned === "/") {
    return { abs: root, rel: "" };
  }
  return resolveSafePath(cleaned, root, cfg);
}

export async function assertReadableSize(abs: string, cfg: GuardConfig): Promise<void> {
  const st = await fs.stat(abs);
  if (!st.isFile()) {
    throw new GuardError("Not a regular file.");
  }
  if (st.size > cfg.maxFileBytes) {
    throw new GuardError(
      `Blocked: file is ${st.size} bytes, over the ${cfg.maxFileBytes}-byte limit.`
    );
  }
}

export function assertEditSize(changedLines: number, cfg: GuardConfig): void {
  if (changedLines > cfg.maxEditLines) {
    throw new GuardError(
      `Blocked: edit changes ${changedLines} lines, over the limit of ${cfg.maxEditLines}. Split it into smaller edits.`
    );
  }
}

export function assertContentSize(content: string, cfg: GuardConfig): void {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > cfg.maxFileBytes) {
    throw new GuardError(
      `Blocked: proposed content is ${bytes} bytes, over the ${cfg.maxFileBytes}-byte limit.`
    );
  }
}
