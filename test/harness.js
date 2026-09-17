/**
 * Tiny assertion harness. Each suite is a plain module exporting `run(t)`.
 * No test framework on purpose: the suites must run with nothing but Node.
 */

const path = require("path");

/** Loads a bundled core module from .tmp (built by test/run.js). */
function core(name) {
  return require(path.join(__dirname, "..", ".tmp", name + ".cjs"));
}

function createRunner(suiteName) {
  const failures = [];
  let passed = 0;

  const t = {
    ok(condition, message) {
      if (condition) {
        passed++;
      } else {
        failures.push(message);
        console.log(`  FAIL  ${message}`);
      }
    },
    equal(actual, expected, message) {
      t.ok(
        actual === expected,
        `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`
      );
    },
    /** Asserts that `fn` throws; returns the error so the caller can check it. */
    async throws(fn, message) {
      try {
        await fn();
        t.ok(false, `${message} — expected a throw, none happened`);
        return undefined;
      } catch (e) {
        t.ok(true, message);
        return e;
      }
    },
    async rejectsWith(fn, substring, message) {
      const e = await t.throws(fn, message);
      if (e) t.ok(String(e.message).includes(substring), `${message} — message mentions "${substring}"`);
    },
    finish() {
      console.log(`  ${passed} passed, ${failures.length} failed  [${suiteName}]`);
      return failures.length;
    },
  };
  return t;
}

module.exports = { core, createRunner };
