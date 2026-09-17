/** Minimal LCS-based unified diff, no runtime dependencies. */

type Op = { t: "eq" | "del" | "add"; line: string };

function lcsOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  // Guard against pathological memory use on very large files.
  const table: Uint32Array = new Uint32Array((n + 1) * (m + 1));
  const idx = (i: number, j: number) => i * (m + 1) + j;

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[idx(i, j)] =
        a[i] === b[j]
          ? table[idx(i + 1, j + 1)] + 1
          : Math.max(table[idx(i + 1, j)], table[idx(i, j + 1)]);
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ t: "eq", line: a[i] });
      i++;
      j++;
    } else if (table[idx(i + 1, j)] >= table[idx(i, j + 1)]) {
      ops.push({ t: "del", line: a[i] });
      i++;
    } else {
      ops.push({ t: "add", line: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ t: "del", line: a[i++] });
  while (j < m) ops.push({ t: "add", line: b[j++] });
  return ops;
}

export interface DiffResult {
  text: string;
  added: number;
  removed: number;
  changedLines: number;
}

function splitLines(s: string): string[] {
  if (s === "") return [];
  return s.replace(/\r\n/g, "\n").split("\n");
}

export function unifiedDiff(
  oldText: string,
  newText: string,
  relPath: string,
  context = 3
): DiffResult {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const ops = lcsOps(a, b);

  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.t === "add") added++;
    else if (op.t === "del") removed++;
  }

  if (added === 0 && removed === 0) {
    return { text: "", added: 0, removed: 0, changedLines: 0 };
  }

  // Mark which ops are within `context` lines of a change.
  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach((op, k) => {
    if (op.t !== "eq") {
      for (let x = Math.max(0, k - context); x <= Math.min(ops.length - 1, k + context); x++) {
        keep[x] = true;
      }
    }
  });

  const lines: string[] = [`--- a/${relPath}`, `+++ b/${relPath}`];
  let oldLine = 1;
  let newLine = 1;
  let k = 0;
  while (k < ops.length) {
    if (!keep[k]) {
      if (ops[k].t !== "add") oldLine++;
      if (ops[k].t !== "del") newLine++;
      k++;
      continue;
    }
    const hunk: string[] = [];
    const startOld = oldLine;
    const startNew = newLine;
    let oldCount = 0;
    let newCount = 0;
    while (k < ops.length && keep[k]) {
      const op = ops[k];
      if (op.t === "eq") {
        hunk.push(" " + op.line);
        oldCount++;
        newCount++;
        oldLine++;
        newLine++;
      } else if (op.t === "del") {
        hunk.push("-" + op.line);
        oldCount++;
        oldLine++;
      } else {
        hunk.push("+" + op.line);
        newCount++;
        newLine++;
      }
      k++;
    }
    lines.push(`@@ -${startOld},${oldCount} +${startNew},${newCount} @@`);
    lines.push(...hunk);
  }

  return { text: lines.join("\n"), added, removed, changedLines: added + removed };
}
