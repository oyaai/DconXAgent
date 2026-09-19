/**
 * Runs a command that commandGuard has already validated and the user approved.
 *
 * Lives in src/node because both frontends use it: the VS Code extension and the
 * local web server. It has no VS Code dependency.
 *
 * Windows note: npm, npx and friends are `.cmd` shims, and Node refuses to spawn
 * those without a shell (EINVAL, since the CVE-2024-27980 fix). So on Windows we
 * do use a shell — which is safe *here* only because commandGuard rejects every
 * shell metacharacter before this code is reached, so there is nothing to inject.
 * Arguments containing spaces are quoted explicitly, because Node does not quote
 * them when `shell` is true.
 */

import { spawn } from "child_process";
import type { CommandResult, ShellPort } from "../core/ports";

const MAX_BUFFERED_CHARS = 200_000;

function quoteForShell(arg: string): string {
  return /\s/.test(arg) ? `"${arg}"` : arg;
}

export class NodeShellPort implements ShellPort {
  run(
    executable: string,
    args: readonly string[],
    options: { cwd: string; timeoutMs: number; signal?: AbortSignal }
  ): Promise<CommandResult> {
    const useShell = process.platform === "win32";
    const spawnArgs = useShell ? args.map(quoteForShell) : [...args];

    return new Promise<CommandResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;

      const child = spawn(executable, spawnArgs, {
        cwd: options.cwd,
        shell: useShell,
        windowsHide: true,
        env: process.env,
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, options.timeoutMs);

      const onAbort = () => child.kill();
      options.signal?.addEventListener("abort", onAbort, { once: true });

      const finish = (exitCode: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
        resolve({ exitCode, stdout, stderr, timedOut });
      };

      child.stdout?.on("data", (chunk: Buffer) => {
        if (stdout.length < MAX_BUFFERED_CHARS) stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        if (stderr.length < MAX_BUFFERED_CHARS) stderr += chunk.toString();
      });

      child.on("error", (err) => {
        stderr += `\nFailed to start "${executable}": ${err.message}`;
        finish(null);
      });
      child.on("close", (code) => finish(code));
    });
  }
}
