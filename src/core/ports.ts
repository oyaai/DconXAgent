/**
 * Ports: the capabilities core logic needs from its environment.
 *
 * Core defines the interface, `src/vscode` supplies the implementation. This is
 * how the agent reaches the editor and the shell without importing `vscode` or
 * spawning processes itself — both of which the boundary test forbids in core.
 */

export interface EditorSelection {
  startLine: number;
  endLine: number;
  text: string;
}

export interface ActiveEditorInfo {
  /** Workspace-relative path, forward slashes. */
  relPath: string;
  languageId: string;
  lineCount: number;
  /** Present only when the user has actually selected something. */
  selection?: EditorSelection;
  /** True when the buffer has unsaved changes. */
  dirty: boolean;
}

export type DiagnosticSeverity = "error" | "warning" | "info" | "hint";

export interface DiagnosticInfo {
  relPath: string;
  line: number;
  severity: DiagnosticSeverity;
  message: string;
  /** e.g. "ts", "eslint" */
  source?: string;
  code?: string;
}

/** What the agent may learn about the user's editor. Read-only by design. */
export interface EditorPort {
  getActiveEditor(): ActiveEditorInfo | undefined;
  /** Workspace-relative paths of files currently open in tabs. */
  getOpenFiles(): string[];
  /** All diagnostics, or only those for one workspace-relative file. */
  getDiagnostics(relPath?: string): DiagnosticInfo[];
}

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** True when the command was killed for exceeding the timeout. */
  timedOut: boolean;
}

/**
 * Runs an already-validated command. The port does NOT decide what may run —
 * `commandGuard.ts` does that before this is ever called, and the user approves
 * each one. Implementations must not use a shell, so metacharacters cannot chain
 * extra commands.
 */
export interface ShellPort {
  run(
    executable: string,
    args: readonly string[],
    options: { cwd: string; timeoutMs: number; signal?: AbortSignal }
  ): Promise<CommandResult>;
}
