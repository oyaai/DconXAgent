/**
 * Layout contract for the chat panel.
 *
 * These pin a bug that made the extension unusable: #log had no `min-height: 0`,
 * so the flex column refused to shrink, the transcript grew past the viewport,
 * nothing scrolled, and the Approve buttons became unreachable. CSS has no unit
 * tests, so the rules that must not be lost are asserted here.
 */

const fs = require("fs");
const path = require("path");
const { createRunner } = require("./harness");

const t = createRunner("webview");

const cssPath = path.join(__dirname, "..", "media", "chat.css");
const css = fs.readFileSync(cssPath, "utf8");
/** Comments attach themselves to the following selector, so strip them first. */
const cleanCss = css.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Merges the declarations of EVERY rule whose selector list contains `selector`
 * exactly — so `body` picks up both `body { … }` and `html, body { … }`, the way
 * the browser sees it.
 */
function block(selector) {
  let out = "";
  const rules = /([^{}]+)\{([^}]*)\}/g;
  let m;
  while ((m = rules.exec(cleanCss)) !== null) {
    const selectors = m[1]
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    if (selectors.includes(selector)) out += m[2] + "\n";
  }
  return out;
}

function declares(selector, property, value) {
  const re = new RegExp(`(^|;|\\s)${property}\\s*:\\s*${value}\\s*;`, "m");
  return re.test(block(selector));
}

// --- the scroll container
t.ok(block("#log") !== "", "#log has a rule");
t.ok(
  declares("#log", "min-height", "0"),
  "#log sets min-height:0 so the flex column can shrink and actually scroll"
);
t.ok(declares("#log", "overflow-y", "auto"), "#log is the scrolling element");

// --- the page itself must not scroll or grow
t.ok(declares("body", "overflow", "hidden"), "body does not scroll");
t.ok(declares("body", "display", "flex"), "body is the flex column");
t.ok(declares("body", "flex-direction", "column"), "body stacks log over composer");
t.ok(/html,\s*\n?body\s*\{[^}]*height:\s*100%/.test(css), "the page fills the viewport height");
t.ok(!/height:\s*100vh/.test(css), "100vh is not used — it misbehaves in webviews");

// --- the composer must stay reachable
t.ok(
  declares("#composer", "flex", "0 0 auto"),
  "#composer never shrinks, so the input stays usable"
);

// --- cards must keep their natural height inside the flex column
t.ok(declares(".card", "flex", "0 0 auto"), "cards are not squeezed by the flex column");
t.ok(declares(".msg", "flex", "0 0 auto"), "messages are not squeezed by the flex column");

// --- long diffs scroll inside their own card rather than stretching the page
t.ok(/\.card \.diff \{[^}]*max-height:/.test(css), "a long diff is capped inside its card");
t.ok(/\.card \.diff \{[^}]*overflow:\s*auto/.test(css), "a capped diff scrolls internally");

// --- scrollbar is visible, not the near-invisible webview default
t.ok(css.includes("#log::-webkit-scrollbar"), "the transcript scrollbar is styled to be visible");

// --- the markup is shared by both frontends, so neither can drift
const body = fs.readFileSync(path.join(__dirname, "..", "media", "chat.body.html"), "utf8");
for (const id of ["approval-card", "command-card", "created-card", "question-card"]) {
  t.ok(body.includes(`id="${id}"`), `shared markup declares the ${id} template`);
}
t.ok(body.includes('id="log"'), "shared markup declares the transcript container");
t.ok(body.includes('id="composer"'), "shared markup declares the composer");
// The header comment legitimately names both frontends; only the markup matters.
const bodyMarkup = body.replace(/<!--[\s\S]*?-->/g, "");
t.ok(
  !/vscode/i.test(bodyMarkup),
  "shared markup contains nothing VS Code-specific"
);

const webviewHtml = fs.readFileSync(
  path.join(__dirname, "..", "src", "vscode", "webviewHtml.ts"),
  "utf8"
);
const webServer = fs.readFileSync(
  path.join(__dirname, "..", "src", "web", "server.ts"),
  "utf8"
);
t.ok(webviewHtml.includes("chat.body.html"), "the extension renders the shared markup");
t.ok(webServer.includes("chat.body.html"), "the web UI renders the same shared markup");
t.ok(webServer.includes("chat.js"), "the web UI serves the same chat script");
t.ok(
  fs.existsSync(path.join(__dirname, "..", "media", "web-bridge.js")),
  "the browser bridge that lets chat.js run unchanged exists"
);

// --- activity bar icon: it is used as a CSS mask, so it must carry real alpha
const iconPath = path.join(__dirname, "..", "media", "icon.svg");
const icon = fs.readFileSync(iconPath, "utf8");
const iconAttrs = icon.replace(/<!--[\s\S]*?-->/g, "");

t.ok(/<svg[^>]*width="24"/.test(iconAttrs), "icon declares an explicit width");
t.ok(/<svg[^>]*height="24"/.test(iconAttrs), "icon declares an explicit height");
t.ok(/viewBox="0 0 24 24"/.test(iconAttrs), "icon uses a 24x24 viewBox");
t.ok(
  !/currentColor/.test(iconAttrs),
  "icon avoids currentColor — it has nothing to inherit from and can resolve to transparent"
);
t.ok(/fill="#[0-9A-Fa-f]{3,6}"/.test(iconAttrs), "icon paths are filled with an explicit colour");
t.ok(
  !/\sstroke=/.test(iconAttrs),
  "icon is a filled silhouette, not a stroke that can vanish when scaled"
);

// --- there is a way in that does not depend on the icon
const pkg = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")
);
const commandIds = pkg.contributes.commands.map((c) => c.command);
t.ok(commandIds.includes("dconx.openChat"), "a command can open the chat without the icon");
t.ok(
  (pkg.contributes.keybindings ?? []).some((k) => k.command === "dconx.openChat"),
  "that command has a keybinding"
);
t.ok(
  pkg.contributes.viewsContainers.activitybar[0].icon === "media/icon.svg",
  "the activity bar container points at the icon that ships"
);
t.ok(
  Object.keys(pkg.contributes.views)[0] === pkg.contributes.viewsContainers.activitybar[0].id,
  "the view is registered into the contributed container"
);

process.exit(t.finish() ? 1 : 0);
