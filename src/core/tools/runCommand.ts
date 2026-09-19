import { parseCommand, truncateOutput } from "../commandGuard";
import { defineTool, requireString } from "./types";

let sequence = 0;

/** Exported for tests, which need deterministic ids. */
export function resetCommandSequence(): void {
  sequence = 0;
}

/**
 * The only way the agent can execute anything.
 *
 * Four things stand between the model and the machine:
 *   1. commandGuard rejects disabled execution, metacharacters and anything off
 *      the allowlist — before the user is even asked.
 *   2. The user approves this exact command string, every single time.
 *   3. It runs without a shell, in the workspace root, with a timeout.
 *   4. Output is truncated so one noisy command cannot flood the context.
 */
export const runCommand = defineTool(
  "run_command",
  "Run one allowed command (for example the project's test or typecheck command) in the workspace root and read its output. " +
    "The user must approve every run. One plain command only — no pipes, no chaining, no redirection.",
  {
    properties: {
      command: {
        type: "string",
        description: "A single command, e.g. 'npm test'. No ';', '&&', '|' or redirection.",
      },
      reason: {
        type: "string",
        description: "One short sentence telling the user why you want to run it.",
      },
    },
    required: ["command"],
  },
  async (args, ctx) => {
    const raw = requireString(args, "command");
    // Throws GuardError, which the dispatcher turns into a GUARD: result.
    const parsed = parseCommand(raw, ctx.cfg);

    const approved = await ctx.approve.requestCommand({
      id: `cmd-${++sequence}`,
      command: raw.trim(),
      cwd: ctx.root,
      matchedRule: parsed.matchedRule,
    });

    if (!approved) {
      return {
        text:
          `REJECTED by the user. "${raw.trim()}" was NOT run. ` +
          `Do not retry it — continue without that output, or ask the user what to do.`,
      };
    }

    ctx.onEvent({ type: "commandStarted", command: raw.trim() });

    const result = await ctx.shell.run(parsed.executable, parsed.args, {
      cwd: ctx.root,
      timeoutMs: ctx.cfg.commandTimeoutMs,
    });

    ctx.onEvent({ type: "commandFinished", command: raw.trim(), exitCode: result.exitCode });

    if (result.timedOut) {
      return {
        text: `TIMED OUT after ${ctx.cfg.commandTimeoutMs} ms and was killed. Partial output:\n${truncateOutput(
          result.stdout + result.stderr,
          ctx.cfg.commandOutputLimit
        )}`,
      };
    }

    const combined = [result.stdout, result.stderr].filter((s) => s.trim() !== "").join("\n");
    const body = combined.trim() === "" ? "(no output)" : truncateOutput(combined, ctx.cfg.commandOutputLimit);

    return { text: `exit code ${result.exitCode}\n${body}` };
  }
);
