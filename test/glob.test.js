const { core, createRunner } = require("./harness");
const { matchesGlob } = core("glob");

const t = createRunner("glob");

t.ok(matchesGlob("src/a.ts", "src/*.ts"), "* matches within a segment");
t.ok(!matchesGlob("src/deep/a.ts", "src/*.ts"), "* does not cross a separator");
t.ok(matchesGlob("src/deep/a.ts", "src/**"), "** crosses separators");
t.ok(matchesGlob(".env", "**/.env"), "**/ matches zero leading segments");
t.ok(matchesGlob("config/.env", "**/.env"), "**/ matches one leading segment");
t.ok(matchesGlob("a/b/c/.env", "**/.env"), "**/ matches several leading segments");
t.ok(matchesGlob("node_modules/x/y.js", "**/node_modules/**"), "nested deny pattern matches");
t.ok(!matchesGlob("src/env.ts", "**/.env"), "similar name does not match");
t.ok(matchesGlob("a.b.key", "**/*.key"), "extension glob with dots");
t.ok(!matchesGlob("keyfile", "**/*.key"), "extension glob needs the dot");
t.ok(matchesGlob("id_rsa.pub", "**/id_rsa*"), "prefix glob matches");
t.ok(matchesGlob("a.ts", "?.ts"), "? matches one character");
t.ok(!matchesGlob("ab.ts", "?.ts"), "? does not match two");

process.exit(t.finish() ? 1 : 0);
