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
  baseUrl: string;
  model: string;
  temperature: number;
  numCtx: number;
}

export interface GuardConfig {
  denyGlobs: string[];
  allowGlobs: string[];
  maxEditLines: number;
  maxFileBytes: number;
  allowCreate: boolean;
  allowDelete: boolean;
}

export interface AgentConfig {
  maxIterations: number;
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

export const DEFAULT_CONFIG: DconxConfig = {
  ollama: {
    baseUrl: "http://127.0.0.1:11434",
    model: "qwen2.5-coder:7b",
    temperature: 0.2,
    numCtx: 16384,
  },
  guard: {
    denyGlobs: [...DEFAULT_DENY_GLOBS],
    allowGlobs: [],
    maxEditLines: 400,
    maxFileBytes: 262144,
    allowCreate: true,
    allowDelete: false,
  },
  agent: {
    maxIterations: 12,
  },
};
