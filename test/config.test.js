/**
 * Keeps package.json's declared settings and DEFAULT_CONFIG in sync. Without
 * this, adding a setting in one place and forgetting the other fails silently
 * at runtime instead of loudly at test time.
 */

const fs = require("fs");
const path = require("path");
const { core, createRunner } = require("./harness");
const { DEFAULT_CONFIG } = core("config");

const t = createRunner("config");

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
const declared = pkg.contributes.configuration.properties;

const expected = [];
for (const [section, values] of Object.entries(DEFAULT_CONFIG)) {
  for (const key of Object.keys(values)) expected.push(`dconx.${section}.${key}`);
}

for (const id of expected) {
  t.ok(id in declared, `package.json declares ${id}`);
}
for (const id of Object.keys(declared)) {
  t.ok(expected.includes(id), `${id} exists in DEFAULT_CONFIG`);
}

// Declared defaults must match the code defaults, or the two disagree
// depending on whether the user has ever opened settings.
for (const [section, values] of Object.entries(DEFAULT_CONFIG)) {
  for (const [key, value] of Object.entries(values)) {
    const id = `dconx.${section}.${key}`;
    if (!declared[id]) continue;
    t.equal(
      JSON.stringify(declared[id].default),
      JSON.stringify(value),
      `${id} default matches DEFAULT_CONFIG`
    );
  }
}

// Commands referenced from menus must exist.
const commandIds = pkg.contributes.commands.map((c) => c.command);
for (const menu of pkg.contributes.menus["view/title"] ?? []) {
  t.ok(commandIds.includes(menu.command), `menu command ${menu.command} is declared`);
}

process.exit(t.finish() ? 1 : 0);
