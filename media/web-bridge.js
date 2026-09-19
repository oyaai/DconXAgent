// @ts-nocheck
/**
 * Makes a plain browser look like a VS Code webview, so media/chat.js runs
 * unchanged in both places.
 *
 * chat.js only needs two things from its host: `acquireVsCodeApi().postMessage`
 * to send, and window "message" events to receive. Here the first becomes an
 * HTTP POST and the second an SSE stream. Nothing else differs, which is why
 * there is one chat UI rather than two that slowly diverge.
 *
 * Must load BEFORE chat.js.
 */

(function () {
  const pending = [];
  let ready = false;

  window.acquireVsCodeApi = function () {
    return {
      postMessage(message) {
        fetch("/api/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(message),
        }).catch((e) => {
          window.postMessage(
            { type: "error", message: "Lost contact with the Dconx server: " + e.message },
            "*"
          );
        });
      },
      getState() {
        return undefined;
      },
      setState() {
        /* the server holds the state */
      },
    };
  };

  const events = new EventSource("/api/events");

  events.onmessage = (event) => {
    let parsed;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      return;
    }
    if (ready) {
      window.postMessage(parsed, "*");
    } else {
      pending.push(parsed);
    }
  };

  events.onopen = () => {
    ready = true;
    for (const message of pending.splice(0)) window.postMessage(message, "*");
  };

  events.onerror = () => {
    // EventSource reconnects on its own; say so rather than looking frozen.
    const status = document.getElementById("status");
    if (status) status.textContent = "reconnecting…";
  };
})();
