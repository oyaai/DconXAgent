/**
 * EditorPort for the web UI, where there is no editor.
 *
 * It reports the absence honestly rather than pretending: the model is told to
 * ask for a path, and that diagnostics are unavailable here, so it reaches for
 * run_command (a typecheck or test run) instead of assuming the code is clean.
 */

import type { ActiveEditorInfo, DiagnosticInfo, EditorPort } from "../core/ports";

export class NoEditorPort implements EditorPort {
  getActiveEditor(): ActiveEditorInfo | undefined {
    return undefined;
  }

  getOpenFiles(): string[] {
    return [];
  }

  getDiagnostics(): DiagnosticInfo[] {
    return [];
  }
}
