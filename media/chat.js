// @ts-check
/**
 * Webview behaviour.
 *
 * Type-checked against src/protocol.ts via JSDoc, so a message added on the
 * extension side fails `npm run typecheck` until it is handled here too.
 *
 * Rendering rule: build DOM with textContent, never innerHTML with model output.
 * The only string interpolated into markup is the diff, and it goes through
 * renderDiff(), which creates elements rather than parsing HTML.
 */

/** @typedef {import("../src/protocol").HostMessage} HostMessage */

const vscode = acquireVsCodeApi();

const log = /** @type {HTMLDivElement} */ (document.getElementById("log"));
const input = /** @type {HTMLTextAreaElement} */ (document.getElementById("input"));
const sendButton = /** @type {HTMLButtonElement} */ (document.getElementById("send"));
const stopButton = /** @type {HTMLButtonElement} */ (document.getElementById("stop"));
const modelButton = /** @type {HTMLButtonElement} */ (document.getElementById("model"));
const statusLabel = /** @type {HTMLSpanElement} */ (document.getElementById("status"));
const cardTemplate = /** @type {HTMLTemplateElement} */ (document.getElementById("approval-card"));

/* ---------- transcript ---------- */

function isScrolledToBottom() {
  return log.scrollHeight - log.scrollTop - log.clientHeight < 60;
}

/** @param {HTMLElement} el */
function append(el) {
  const stick = isScrolledToBottom();
  log.appendChild(el);
  if (stick) log.scrollTop = log.scrollHeight;
}

/**
 * @param {string} className
 * @param {string} text
 */
function appendText(className, text) {
  const div = document.createElement("div");
  div.className = className;
  div.textContent = text;
  append(div);
}

/**
 * Renders a unified diff as coloured lines. Builds nodes directly — no innerHTML.
 * @param {HTMLElement} target
 * @param {string} diff
 */
function renderDiff(target, diff) {
  for (const line of diff.split("\n")) {
    const span = document.createElement("span");
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) {
      span.className = "meta";
    } else if (line.startsWith("+")) {
      span.className = "add";
    } else if (line.startsWith("-")) {
      span.className = "del";
    }
    span.textContent = line + "\n";
    target.appendChild(span);
  }
}

/* ---------- approval card ---------- */

/** @param {Extract<HostMessage, {type: "approval"}>} msg */
function appendApprovalCard(msg) {
  const card = /** @type {HTMLElement} */ (
    cardTemplate.content.cloneNode(true)
  ).firstElementChild;
  if (!card) return;

  const verb = msg.kind === "create" ? "Create" : "Edit";
  /** @type {HTMLElement} */ (card.querySelector(".title")).textContent = `${verb} ${msg.relPath}`;
  /** @type {HTMLElement} */ (card.querySelector(".stat")).textContent =
    `+${msg.added} / -${msg.removed}`;
  renderDiff(/** @type {HTMLElement} */ (card.querySelector(".diff")), msg.diff);

  const actions = /** @type {HTMLElement} */ (card.querySelector(".actions"));
  actions.dataset.editId = msg.id;

  for (const button of actions.querySelectorAll("button")) {
    button.addEventListener("click", () => {
      const act = button.dataset.act;
      vscode.postMessage(
        act === "approve" ? { type: "approve", id: msg.id } : { type: "reject", id: msg.id }
      );
    });
  }

  append(/** @type {HTMLElement} */ (card));
  log.scrollTop = log.scrollHeight;
}

/**
 * Replaces a card's buttons once the host confirms the outcome, so the UI never
 * claims an edit was applied before it actually was.
 * @param {string} id
 * @param {boolean} approved
 */
function settleApprovalCard(id, approved) {
  const actions = /** @type {HTMLElement | null} */ (
    log.querySelector(`.actions[data-edit-id="${CSS.escape(id)}"]`)
  );
  if (!actions) return;
  actions.textContent = "";
  const note = document.createElement("span");
  note.className = "stat";
  note.textContent = approved ? "Applied." : "Rejected.";
  actions.appendChild(note);
}

/* ---------- composer ---------- */

function submit() {
  const text = input.value.trim();
  if (!text) return;
  appendText("msg user", text);
  input.value = "";
  vscode.postMessage({ type: "send", text });
}

sendButton.addEventListener("click", submit);
stopButton.addEventListener("click", () => vscode.postMessage({ type: "cancel" }));
modelButton.addEventListener("click", () => vscode.postMessage({ type: "pickModel" }));
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    submit();
  }
});

/* ---------- host messages ---------- */

window.addEventListener("message", (event) => {
  const msg = /** @type {HostMessage} */ (event.data);
  switch (msg.type) {
    case "clear":
      log.textContent = "";
      break;
    case "config":
      modelButton.textContent = `model: ${msg.model}`;
      break;
    case "assistant":
      appendText("msg assistant", msg.text);
      break;
    case "error":
      appendText("msg error", msg.message);
      break;
    case "tool":
      appendText("trace", `→ ${msg.name}${msg.detail ? ` (${msg.detail})` : ""}`);
      break;
    case "guard":
      appendText("trace guard", msg.text);
      break;
    case "status": {
      const busy = msg.state === "thinking";
      statusLabel.textContent = busy ? "thinking…" : "";
      sendButton.disabled = busy;
      stopButton.hidden = !busy;
      break;
    }
    case "approval":
      appendApprovalCard(msg);
      break;
    case "approvalResolved":
      settleApprovalCard(msg.id, msg.approved);
      break;
  }
});

vscode.postMessage({ type: "ready" });
