/**
 * Decides whether a command may run at all.
 *
 * Three layers, in order:
 *   1. The feature must be enabled (`dconx.guard.allowCommands`).
 *   2. The string must contain no shell metacharacters. The command is executed
 *      without a shell, but rejecting them early means a model cannot smuggle
 *      `npm test && rm -rf .` past an allowlist that only inspects the prefix.
 *   3. The command must match an entry in the allowlist, matched on whole tokens
 *      so "npm" never authorises "npmfoo" and "git log" never authorises "git push".
 *
 * The user still approves every single run. This is the filter, not the gate.
 */

import type { GuardConfig } from "./config";
import { GuardError } from "./errors";

/** Characters that let one command become several, or redirect into a file. */
const SHELL_METACHARACTERS = /[;&|><`$(){}\[\]!\n\r\\]/;

export interface ParsedCommand {
  executable: string;
  args: string[];
  /** The allowlist entry that permitted this command. */
  matchedRule: string;
}

/** Splits on whitespace, honouring "double" and 'single' quoted arguments. */
export function tokenize(command: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(command)) !== null) {
    tokens.push(m[1] ?? m[2] ?? m[3]);
  }
  return tokens;
}

export function parseCommand(raw: string, cfg: GuardConfig): ParsedCommand {
  if (!cfg.allowCommands) {
    throw new GuardError(
      "Blocked: running commands is disabled. The user can enable it with dconx.guard.allowCommands."
    );
  }

  const command = (raw ?? "").trim();
  if (command === "") {
    throw new GuardError("The command is required.");
  }

  if (SHELL_METACHARACTERS.test(command)) {
    throw new GuardError(
      "Blocked: the command contains shell metacharacters (; & | > < ` $ ( ) etc). " +
        "Run one plain command at a time — chaining is not permitted."
    );
  }

  const tokens = tokenize(command);
  const matchedRule = findRule(tokens, cfg.commandAllowlist);
  if (!matchedRule) {
    throw new GuardError(
      `Blocked: "${command}" is not in the allowed command list. Allowed: ` +
        `${cfg.commandAllowlist.join(", ")}. Ask the user to add it to dconx.guard.commandAllowlist if it is needed.`
    );
  }

  return { executable: tokens[0], args: tokens.slice(1), matchedRule };
}

/**
 * An allowlist entry matches when every one of its tokens equals the command's
 * token at the same position. Token equality (not string prefix) is what stops
 * "git log" from authorising "git logout-and-push".
 */
function findRule(tokens: readonly string[], allowlist: readonly string[]): string | undefined {
  return allowlist.find((rule) => {
    const ruleTokens = tokenize(rule.trim());
    if (ruleTokens.length === 0 || ruleTokens.length > tokens.length) return false;
    return ruleTokens.every((t, i) => t === tokens[i]);
  });
}

/** Keeps a single command's output from swallowing the model's context window. */
export function truncateOutput(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const head = text.slice(0, Math.floor(maxChars * 0.3));
  const tail = text.slice(-Math.floor(maxChars * 0.7));
  return `${head}\n… [${text.length - maxChars} characters trimmed] …\n${tail}`;
}
