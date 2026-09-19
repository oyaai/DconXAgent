/**
 * End-to-end test of the local web UI: a fake Ollama drives the real agent
 * through the real server, and we check that a file actually lands on disk and
 * that the browser is told about it.
 *
 * This is the test that proves the second frontend really does reuse src/core
 * rather than reimplementing it — and it covers the remote-Ollama auth header,
 * which is otherwise only exercised by talking to a real server.
 */

const { spawn } = require("child_process");
const esbuild = require("esbuild");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { createRunner } = require("./harness");

const t = createRunner("web");
const root = path.join(__dirname, "..");
const bundle = path.join(root, ".tmp", "web-server.cjs");

const API_KEY = "test-token-123";
const PORT = 3947;
const OLLAMA_PORT = 3948;

/** Replies the fake Ollama gives, in order: create a file, then finish. */
const SCRIPT = [
  {
    message: {
      content: "",
      tool_calls: [
        {
          function: {
            name: "write_file",
            arguments: { path: "hello.js", content: "console.log('hi');\n" },
          },
        },
      ],
    },
  },
  { message: { content: "Created hello.js.", tool_calls: [] } },
];

function waitFor(predicate, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = setInterval(() => {
      if (predicate()) {
        clearInterval(tick);
        resolve(true);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(tick);
        reject(new Error(`timed out waiting for ${label}`));
      }
    }, 50);
  });
}

function post(pathname, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        path: pathname,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": data.length },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      }
    );
    req.on("error", reject);
    req.end(data);
  });
}

(async () => {
  // 1. Build the server bundle the same way `npm run build` does.
  esbuild.buildSync({
    entryPoints: [path.join(root, "src", "web", "server.ts")],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node18",
    outfile: bundle,
    logLevel: "error",
  });
  t.ok(fs.existsSync(bundle), "the web server bundles");

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "dconx-web-"));
  const seenAuth = [];
  let call = 0;

  // 2. A fake Ollama that records its headers and replays the script.
  const ollama = http.createServer((req, res) => {
    seenAuth.push(req.headers.authorization);
    if (req.url === "/api/tags") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models: [{ name: "fake-model" }] }));
      return;
    }
    req.resume();
    req.on("end", () => {
      const reply = SCRIPT[Math.min(call++, SCRIPT.length - 1)];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise((r) => ollama.listen(OLLAMA_PORT, "127.0.0.1", r));

  // 3. The real server, pointed at the fake Ollama through the env layer.
  const server = spawn(process.execPath, [bundle, workspace, "--port", String(PORT)], {
    env: {
      ...process.env,
      OLLAMA_BASE_URL: `http://127.0.0.1:${OLLAMA_PORT}`,
      OLLAMA_API_KEY: API_KEY,
      DCONX_MODEL: "fake-model",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let banner = "";
  server.stdout.on("data", (d) => (banner += d.toString()));

  const events = [];
  let stream;
  try {
    await waitFor(() => banner.includes("Ctrl+C"), 8000, "server startup");
    t.ok(banner.includes(workspace), "banner names the workspace");
    t.ok(banner.includes("API key set"), "banner reports that auth is configured");
    t.ok(banner.includes("fake-model"), "env var overrides the model");

    // 4. Listen the way the browser does.
    stream = await new Promise((resolve, reject) => {
      const req = http.get(
        { host: "127.0.0.1", port: PORT, path: "/api/events" },
        (res) => {
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            for (const line of chunk.split("\n")) {
              if (line.startsWith("data: ")) {
                try {
                  events.push(JSON.parse(line.slice(6)));
                } catch {
                  /* keep-alive comment */
                }
              }
            }
          });
          resolve(req);
        }
      );
      req.on("error", reject);
    });

    await waitFor(() => events.some((e) => e.type === "config"), 5000, "config event");

    // 5. Drive it exactly as the page would.
    const status = await post("/api/message", { type: "send", text: "make hello.js" });
    t.equal(status, 204, "the page's POST is accepted");

    await waitFor(() => events.some((e) => e.type === "created"), 10000, "created event");

    const created = events.find((e) => e.type === "created");
    t.equal(created.relPath, "hello.js", "the browser is told which file was created");
    t.ok(
      fs.existsSync(path.join(workspace, "hello.js")),
      "the file really exists in the workspace"
    );
    t.equal(
      fs.readFileSync(path.join(workspace, "hello.js"), "utf8"),
      "console.log('hi');\n",
      "the file has the content the model asked for"
    );

    // 6. The remote-Ollama auth header actually goes out.
    t.ok(seenAuth.length > 0, "the fake Ollama was called");
    t.ok(
      seenAuth.every((h) => h === `Bearer ${API_KEY}`),
      "every request carries the Authorization header"
    );

    await waitFor(
      () => events.some((e) => e.type === "status" && e.state === "idle"),
      8000,
      "idle status"
    );
    t.ok(
      events.some((e) => e.type === "tool" && e.name === "write_file"),
      "tool activity is streamed to the browser"
    );

    // 7. Undo removes the file it created.
    await post("/api/message", { type: "undo", id: created.id });
    await waitFor(() => events.some((e) => e.type === "undoResult"), 5000, "undo result");
    const undone = events.find((e) => e.type === "undoResult");
    t.equal(undone.ok, true, "undo reports success");
    t.ok(!fs.existsSync(path.join(workspace, "hello.js")), "undo deleted the file");
  } catch (e) {
    t.ok(false, `web end-to-end: ${e.message}`);
  } finally {
    stream?.destroy();
    server.kill();
    ollama.close();
    fs.rmSync(workspace, { recursive: true, force: true });
  }

  process.exit(t.finish() ? 1 : 0);
})();
