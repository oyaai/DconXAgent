/**
 * Minimal glob matching for the guard's allow/deny lists.
 *
 * Supports `**` (any number of path segments), `*` (within one segment) and `?`.
 * Kept deliberately tiny and dependency-free so the security-relevant matching
 * is auditable in one screen; see test/glob.test.js for the contract.
 */

function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          // '**/' matches zero or more leading path segments.
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(ch)) {
      out += "\\" + ch;
    } else {
      out += ch;
    }
  }
  return new RegExp("^" + out + "$", process.platform === "win32" ? "i" : "");
}

const cache = new Map<string, RegExp>();

/** `relPosix` must be a workspace-relative path using forward slashes. */
export function matchesGlob(relPosix: string, glob: string): boolean {
  let re = cache.get(glob);
  if (!re) {
    re = globToRegExp(glob);
    cache.set(glob, re);
  }
  return re.test(relPosix);
}

export function matchesAny(relPosix: string, globs: readonly string[]): string | undefined {
  return globs.find((g) => matchesGlob(relPosix, g));
}
