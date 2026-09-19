/**
 * Read-only window into the user's editor: active file, selection, open tabs and
 * the Problems panel. Implements EditorPort so core logic can use it without
 * importing `vscode`.
 */

import * as path from "path";
import * as vscode from "vscode";
import type {
  ActiveEditorInfo,
  DiagnosticInfo,
  DiagnosticSeverity,
  EditorPort,
} from "../core/ports";

/** Longest selection handed to the model verbatim. */
const MAX_SELECTION_CHARS = 4000;

const SEVERITY: Record<vscode.DiagnosticSeverity, DiagnosticSeverity> = {
  [vscode.DiagnosticSeverity.Error]: "error",
  [vscode.DiagnosticSeverity.Warning]: "warning",
  [vscode.DiagnosticSeverity.Information]: "info",
  [vscode.DiagnosticSeverity.Hint]: "hint",
};

export class VsCodeEditorPort implements EditorPort {
  constructor(private readonly getRoot: () => string) {}

  getActiveEditor(): ActiveEditorInfo | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return undefined;

    const relPath = this.toRelative(editor.document.uri);
    if (!relPath) return undefined; // a file outside the workspace, or an output pane

    const info: ActiveEditorInfo = {
      relPath,
      languageId: editor.document.languageId,
      lineCount: editor.document.lineCount,
      dirty: editor.document.isDirty,
    };

    if (!editor.selection.isEmpty) {
      const text = editor.document.getText(editor.selection);
      info.selection = {
        startLine: editor.selection.start.line + 1,
        endLine: editor.selection.end.line + 1,
        text:
          text.length > MAX_SELECTION_CHARS
            ? `${text.slice(0, MAX_SELECTION_CHARS)}\n… [selection truncated]`
            : text,
      };
    }

    return info;
  }

  getOpenFiles(): string[] {
    const out = new Set<string>();
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        if (input instanceof vscode.TabInputText) {
          const rel = this.toRelative(input.uri);
          if (rel) out.add(rel);
        }
      }
    }
    return [...out].sort();
  }

  getDiagnostics(relPath?: string): DiagnosticInfo[] {
    const out: DiagnosticInfo[] = [];

    for (const [uri, list] of vscode.languages.getDiagnostics()) {
      const rel = this.toRelative(uri);
      if (!rel) continue;
      if (relPath && rel !== relPath) continue;

      for (const d of list) {
        out.push({
          relPath: rel,
          line: d.range.start.line + 1,
          severity: SEVERITY[d.severity] ?? "info",
          message: d.message.replace(/\s+/g, " ").trim(),
          source: d.source,
          code: typeof d.code === "object" ? String(d.code.value) : d.code?.toString(),
        });
      }
    }
    return out;
  }

  /** Returns undefined for anything outside the workspace root. */
  private toRelative(uri: vscode.Uri): string | undefined {
    if (uri.scheme !== "file") return undefined;
    let root: string;
    try {
      root = this.getRoot();
    } catch {
      return undefined;
    }
    const rel = path.relative(root, uri.fsPath);
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
    return rel.split(path.sep).join("/");
  }
}
