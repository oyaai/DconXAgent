/**
 * Undo for auto-created files, shared by both frontends.
 *
 * Auto-approval is only defensible if it is reversible, so every file written
 * without a click is recorded here with its exact content. Undo deletes the file
 * only when what is on disk is still byte-for-byte what the agent wrote — if the
 * user (or anything else) has since touched it, undo refuses rather than
 * destroying work it did not create.
 *
 * It never deletes a file the agent did not create in this session.
 */

import * as fs from "fs/promises";

export interface CreatedFile {
  relPath: string;
  absPath: string;
  content: string;
}

export interface UndoOutcome {
  ok: boolean;
  reason?: string;
}

/**
 * Runs just before the file is removed. The VS Code frontend uses it to close an
 * editor tab showing the file, so the buffer is not resurrected on save.
 */
export type BeforeDelete = (file: CreatedFile) => Promise<void>;

export class UndoRegistry {
  private readonly created = new Map<string, CreatedFile>();

  constructor(private readonly beforeDelete?: BeforeDelete) {}

  record(id: string, file: CreatedFile): void {
    this.created.set(id, file);
  }

  clear(): void {
    this.created.clear();
  }

  async undo(id: string): Promise<UndoOutcome> {
    const entry = this.created.get(id);
    if (!entry) {
      return { ok: false, reason: "Nothing to undo — this file is no longer tracked." };
    }

    let onDisk: string;
    try {
      onDisk = await fs.readFile(entry.absPath, "utf8");
    } catch {
      this.created.delete(id);
      return { ok: false, reason: "The file is already gone." };
    }

    if (onDisk !== entry.content) {
      return {
        ok: false,
        reason: "The file has been edited since it was created, so it was left alone.",
      };
    }

    try {
      await this.beforeDelete?.(entry);
      await fs.unlink(entry.absPath);
    } catch (e) {
      return { ok: false, reason: `Could not delete it: ${(e as Error).message}` };
    }

    this.created.delete(id);
    return { ok: true };
  }
}
