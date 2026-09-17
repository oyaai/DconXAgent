const path = require("path");
const { core, createRunner } = require("./harness");
const { resolveSafePath, resolveSafeDir, assertEditSize, assertContentSize } = core("guard");
const { DEFAULT_CONFIG } = core("config");

const t = createRunner("guard");
const ROOT = path.resolve("/tmp/ws");
const cfg = DEFAULT_CONFIG.guard;

const blocked = (p, c = cfg) => {
  try {
    resolveSafePath(p, ROOT, c);
    return false;
  } catch {
    return true;
  }
};

// --- containment
t.equal(resolveSafePath("src/a.ts", ROOT, cfg).rel, "src/a.ts", "relative path allowed");
t.ok(blocked("../outside.ts"), "parent escape blocked");
t.ok(blocked("../../etc/passwd"), "deep escape blocked");
t.ok(blocked("src/../../x"), "mid-path escape blocked");
t.ok(blocked("/etc/passwd"), "outside absolute path blocked, not re-rooted");
t.ok(blocked("."), "the root itself is not a valid file target");
t.ok(blocked(""), "empty path rejected");
t.equal(
  resolveSafePath(path.join(ROOT, "src/a.ts"), ROOT, cfg).rel,
  "src/a.ts",
  "absolute path inside the root is accepted"
);

// --- deny list
t.ok(blocked(".env"), "root .env blocked");
t.ok(blocked("config/.env.production"), "nested .env.* blocked");
t.ok(blocked(".git/config"), "git internals blocked");
t.ok(blocked("node_modules/foo/index.js"), "node_modules blocked");
t.ok(blocked("deep/nested/node_modules/x.js"), "nested node_modules blocked");
t.ok(blocked("certs/server.key"), "*.key blocked");
t.ok(blocked("package-lock.json"), "lockfile blocked");
t.ok(blocked("dist/extension.js"), "build output blocked");
t.ok(!blocked("src/env.ts"), "similar-but-safe name allowed");

// --- allow list
const strict = { ...cfg, allowGlobs: ["src/**", "*.md"] };
t.ok(!blocked("src/deep/a.ts", strict), "allow list permits src/**");
t.ok(!blocked("README.md", strict), "allow list permits *.md");
t.ok(blocked("scripts/build.js", strict), "allow list rejects an outside path");
t.ok(blocked("src/.env", strict), "deny list still wins inside an allowed folder");

// --- directory resolution
t.equal(resolveSafeDir(".", ROOT, cfg).rel, "", "'.' resolves to the root");
t.equal(resolveSafeDir("", ROOT, cfg).abs, ROOT, "empty dir resolves to the root");
t.equal(resolveSafeDir("src", ROOT, cfg).rel, "src", "named dir resolves normally");

// --- size caps
t.throws(() => assertEditSize(cfg.maxEditLines + 1, cfg), "edit over the line cap is rejected");
assertEditSize(cfg.maxEditLines, cfg);
t.ok(true, "edit exactly at the line cap is allowed");
t.throws(
  () => assertContentSize("x".repeat(cfg.maxFileBytes + 1), cfg),
  "content over the byte cap is rejected"
);

process.exit(t.finish() ? 1 : 0);
