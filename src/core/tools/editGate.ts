/**
 * The approval chokepoint.
 *
 * Every write in this extension goes through `proposeEdit`. There is no other
 * call to fs.writeFile anywhere in src/. If you add a tool that changes files,
 * route it through here rather than writing directly — that is what keeps the
 * "nothing is written without approval" guarantee true rather than aspirational.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { assertEditSize, assertReadableSize } from "../guard";
import { GuardError } from "../errors";
import { unifiedDiff } from "../diff";
import type { EditKind, PendingEdit, ToolContext, ToolOutcome } from "./types";

let sequence = 0;

/** Exported for tests, which need deterministic ids. */
export function resetEditSequence(): void {
  sequence = 0;
}

async function buildEdit(
  relPath: string,
  absPath: string,
  newText: string,
  ctx: ToolContext
): Promise<PendingEdit> {
  let oldText = "";
  let kind: EditKind = "modify";

  try {
    await assertReadableSize(absPath, ctx.cfg);
    oldText = await fs.readFile(absPath, "utf8");
  } catch (e) {
    if (e instanceof GuardError) throw e; // e.g. file too large — not a "create"
    kind = "create";
    if (!ctx.cfg.allowCreate) {
      throw new GuardError("Blocked: creating new files is disabled (dconx.guard.allowCreate).");
    }
  }

  const d = unifiedDiff(oldText, newText, relPath);
  if (d.changedLines === 0) {
    throw new GuardError("No change: the proposed content is identical to the current file.");
  }
  assertEditSize(d.changedLines, ctx.cfg);

  return {
    id: `edit-${++sequence}`,
    kind,
    relPath,
    absPath,
    oldText,
    newText,
    diff: d.text,
    added: d.added,
    removed: d.removed,
  };
}

/**
 * Builds the edit, asks the human, and writes only on approval.
 * The returned text is what the model sees, so it is phrased to steer the model:
 * a rejection explicitly tells it not to retry.
 */
export async function proposeEdit(
  relPath: string,
  absPath: string,
  newText: string,
  ctx: ToolContext
): Promise<ToolOutcome> {
  const edit = await buildEdit(relPath, absPath, newText, ctx);

  const approved = await ctx.requestApproval(edit);
  if (!approved) {
    ctx.onEvent({ type: "rejected", relPath: edit.relPath, id: edit.id });
    return {
      text:
        `REJECTED by the user. ${edit.relPath} was NOT modified. ` +
        `Do not retry the same edit — ask the user what they want changed instead.`,
    };
  }

  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, newText, "utf8");
  ctx.onEvent({ type: "applied", relPath: edit.relPath, id: edit.id });

  return { text: `APPROVED and written to ${edit.relPath} (+${edit.added}/-${edit.removed}).` };
}
