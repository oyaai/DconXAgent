/**
 * Configuration shapes and defaults.
 *
 * Pure data — no VS Code import. The adapter in `src/vscode/config.ts` is the
 * only place that knows these values come from workspace settings, which keeps
 * everything under `src/core` testable with a plain object.
 *
 * ADDING A SETTING: add the field here, add its default to DEFAULT_CONFIG, read
 * it in `src/vscode/config.ts`, and declare it in package.json `contributes.configuration`.
 * The test suite asserts those three stay in sync.
 */

export interface OllamaConfig {
  /** Any http(s) host: localhost, a VPS, a LAN box, or a hosted Ollama. */
  baseUrl: string;
  model: string;
  temperature: number;
  numCtx: number;
  /** Sent as `Authorization: Bearer <key>` when set. Empty means no auth. */
  apiKey: string;
  /** Extra headers, for gateways that need their own (e.g. a proxy token). */
  headers: Record<string, string>;
  /** Abort a request that has produced nothing for this long. */
  requestTimeoutMs: number;
}

export interface GuardConfig {
  denyGlobs: string[];
  allowGlobs: string[];
  maxEditLines: number;
  maxFileBytes: number;
  allowCreate: boolean;
  /**
   * Write NEW files without asking. Scaffolding a project is a dozen creates in
   * a row, and clicking Approve twelve times teaches the user to click blindly.
   * A create cannot overwrite anything, and the panel offers Undo.
   * Modifying an existing file is never auto-approved, whatever this is set to.
   */
  autoApproveCreate: boolean;
  allowDelete: boolean;
  /** Master switch for the run_command tool. */
  allowCommands: boolean;
  /** Commands the agent may propose. Matched on whole leading tokens. */
  commandAllowlist: string[];
  commandTimeoutMs: number;
  /** Characters of combined stdout+stderr handed back to the model. */
  commandOutputLimit: number;
}

export interface AgentConfig {
  maxIterations: number;
  /**
   * Workspace-relative folder for throwaway work — new project scaffolds, spikes,
   * anything the user does not want mixed into their real source tree yet.
   * Must not start with a dot, or list_files will not show it.
   */
  scratchFolder: string;
}

export interface DconxConfig {
  ollama: OllamaConfig;
  guard: GuardConfig;
  agent: AgentConfig;
}

export const DEFAULT_DENY_GLOBS: readonly string[] = [
  "**/.git/**",
  "**/node_modules/**",
  "**/.env",
  "**/.env.*",
  "**/*.pem",
  "**/*.key",
  "**/id_rsa*",
  "**/package-lock.json",
  "**/pnpm-lock.yaml",
  "**/yarn.lock",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
];

/**
 * Read-only or clearly reversible commands only. Anything that publishes,
 * installs or deletes is deliberately absent — the user adds those knowingly.
 */
export const DEFAULT_COMMAND_ALLOWLIST: readonly string[] = [
  "npm test",
  "npm run build",
  "npm run typecheck",
  "npm run check",
  "npm run lint",
  "npx tsc --noEmit",
  "node --version",
  "python -m pytest",
  "pytest",
  "git status",
  "git diff",
  "git log",
  "git branch",
];

export const DEFAULT_CONFIG: DconxConfig = {
  ollama: {
    baseUrl: "http://127.0.0.1:11434",
    model: "qwen2.5-coder:7b",
    temperature: 0.2,
    numCtx: 16384,
    apiKey: "",
    headers: {},
    requestTimeoutMs: 300000,
  },
  guard: {
    denyGlobs: [...DEFAULT_DENY_GLOBS],
    allowGlobs: [],
    maxEditLines: 400,
    maxFileBytes: 262144,
    allowCreate: true,
    autoApproveCreate: true,
    allowDelete: false,
    allowCommands: true,
    commandAllowlist: [...DEFAULT_COMMAND_ALLOWLIST],
    commandTimeoutMs: 120000,
    commandOutputLimit: 8000,
  },
  agent: {
    maxIterations: 12,
    scratchFolder: "dconx-scratch",
  },
};
