const { core, createRunner } = require("./harness");
const { unifiedDiff } = core("diff");

const t = createRunner("diff");

const a = "line1\nline2\nline3\nline4\nline5\nline6\nline7\n";
const b = "line1\nline2\nCHANGED\nline4\nline5\nline6\nline7\n";

const d = unifiedDiff(a, b, "x.txt");
t.equal(d.added, 1, "one line added");
t.equal(d.removed, 1, "one line removed");
t.ok(d.text.includes("-line3") && d.text.includes("+CHANGED"), "diff shows both sides");
t.ok(!d.text.includes("line7"), "context trimming drops distant lines");
t.equal(d.text.split("\n").filter((l) => l.startsWith("@@")).length, 1, "one hunk");

t.equal(unifiedDiff(a, a, "x.txt").changedLines, 0, "identical input yields no diff");
t.equal(unifiedDiff("", "hello\nworld\n", "n.txt").removed, 0, "creation removes nothing");
t.equal(unifiedDiff("a\nb\nc\n", "a\nc\n", "y.txt").removed, 1, "pure deletion counted");
t.equal(unifiedDiff("a\r\nb\r\n", "a\nb\n", "z.txt").changedLines, 0, "CRLF is not a spurious diff");

// Two distant changes must produce two hunks, not one giant one.
const far = unifiedDiff(
  Array.from({ length: 40 }, (_, i) => `l${i}`).join("\n"),
  Array.from({ length: 40 }, (_, i) => (i === 2 || i === 35 ? `X${i}` : `l${i}`)).join("\n"),
  "f.txt"
);
t.equal(far.text.split("\n").filter((l) => l.startsWith("@@")).length, 2, "distant changes split into two hunks");

process.exit(t.finish() ? 1 : 0);
