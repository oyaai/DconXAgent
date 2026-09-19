/**
 * The contract between the extension host and the webview.
 *
 * Both directions are exhaustive unions, so adding a message means the compiler
 * points at every switch that needs a new case. media/chat.js is type-checked
 * against these types via JSDoc (`npm run typecheck`), which is what stops the
 * two sides from silently drifting apart.
 *
 * ADDING A MESSAGE:
 *   1. Add a variant to HostMessage (host -> webview) or ViewMessage (webview -> host).
 *   2. Handle it in media/chat.js or src/vscode/chatViewProvider.ts.
 *   3. `npm run typecheck` fails until both sides agree.
 */

/** Sent from the extension host to the webview. */
export type HostMessage =
  | { type: "clear" }
  | { type: "config"; model: string }
  | { type: "assistant"; text: string }
  | { type: "error"; message: string }
  | { type: "tool"; name: string; detail: string }
  | { type: "guard"; text: string }
  | { type: "status"; state: AgentState }
  | {
      type: "approval";
      id: string;
      kind: "modify" | "create" | "delete";
      relPath: string;
      diff: string;
      added: number;
      removed: number;
    }
  | {
      type: "commandApproval";
      id: string;
      command: string;
      cwd: string;
      /** The allowlist entry that permitted it. */
      rule: string;
    }
  | { type: "created"; id: string; relPath: string; added: number }
  | { type: "undoResult"; id: string; ok: boolean; reason?: string }
  | { type: "question"; question: string; options: string[] }
  | { type: "approvalResolved"; id: string; approved: boolean }
  | { type: "commandResult"; command: string; exitCode: number | null };

export type AgentState = "thinking" | "idle" | "cancelled";

/** Sent from the webview to the extension host. */
export type ViewMessage =
  | { type: "ready" }
  | { type: "send"; text: string }
  | { type: "cancel" }
  | { type: "pickModel" }
  | { type: "approve"; id: string }
  | { type: "undo"; id: string }
  | { type: "reject"; id: string };
