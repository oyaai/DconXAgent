/**
 * Config for the web UI, which has no VS Code settings to read.
 *
 * Three layers, later wins: DEFAULT_CONFIG → dconx.config.json in the workspace
 * root → environment variables. The env layer exists so an API key never has to
 * be written into a file that might be committed.
 */

import * as fs from "fs";
import * as path from "path";
import { DEFAULT_CONFIG, type DconxConfig } from "../core/config";

export const CONFIG_FILE = "dconx.config.json";

export interface LoadedConfig {
  config: DconxConfig;
  /** Where each layer came from, for the startup banner. */
  notes: string[];
}

type Section = keyof DconxConfig;

function mergeSection<T extends object>(base: T, override: unknown): T {
  if (!override || typeof override !== "object") return base;
  const out = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    if (key in out && value !== undefined) out[key] = value;
  }
  return out as T;
}

export function loadConfig(root: string, env: NodeJS.ProcessEnv = process.env): LoadedConfig {
  const notes: string[] = [];
  const config: DconxConfig = {
    ollama: { ...DEFAULT_CONFIG.ollama },
    guard: { ...DEFAULT_CONFIG.guard },
    agent: { ...DEFAULT_CONFIG.agent },
  };

  const filePath = path.join(root, CONFIG_FILE);
  if (fs.existsSync(filePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<DconxConfig>;
      for (const section of ["ollama", "guard", "agent"] as Section[]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (config as any)[section] = mergeSection(config[section] as object, parsed[section]);
      }
      notes.push(`config: ${CONFIG_FILE}`);
    } catch (e) {
      notes.push(`config: ${CONFIG_FILE} could not be parsed (${(e as Error).message}) — using defaults`);
    }
  }

  if (env.OLLAMA_BASE_URL) {
    config.ollama.baseUrl = env.OLLAMA_BASE_URL;
    notes.push("baseUrl: from OLLAMA_BASE_URL");
  }
  if (env.OLLAMA_API_KEY) {
    config.ollama.apiKey = env.OLLAMA_API_KEY;
    notes.push("apiKey: from OLLAMA_API_KEY");
  }
  if (env.DCONX_MODEL) {
    config.ollama.model = env.DCONX_MODEL;
    notes.push("model: from DCONX_MODEL");
  }

  return { config, notes };
}

/** Written on first run so there is something to edit rather than a blank page. */
export function writeSampleConfig(root: string): string {
  const filePath = path.join(root, CONFIG_FILE);
  if (fs.existsSync(filePath)) return filePath;

  const sample = {
    ollama: {
      baseUrl: DEFAULT_CONFIG.ollama.baseUrl,
      model: DEFAULT_CONFIG.ollama.model,
      // Deliberately not written: put the key in OLLAMA_API_KEY instead.
    },
    guard: {
      allowGlobs: DEFAULT_CONFIG.guard.allowGlobs,
      maxEditLines: DEFAULT_CONFIG.guard.maxEditLines,
      autoApproveCreate: DEFAULT_CONFIG.guard.autoApproveCreate,
      allowCommands: DEFAULT_CONFIG.guard.allowCommands,
      commandAllowlist: DEFAULT_CONFIG.guard.commandAllowlist,
    },
  };
  fs.writeFileSync(filePath, JSON.stringify(sample, null, 2) + "\n", "utf8");
  return filePath;
}
