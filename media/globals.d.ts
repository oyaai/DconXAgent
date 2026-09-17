/** Ambient declarations for the webview script, so chat.js type-checks. */

declare function acquireVsCodeApi(): {
  postMessage(message: import("../src/protocol").ViewMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
};
