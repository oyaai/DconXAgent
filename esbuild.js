/**
 * Builds both frontends from one source tree:
 *   dist/extension.js   the VS Code extension  (vscode is external)
 *   dist/web-server.js  the local web UI       (plain node)
 */

const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const targets = [
  {
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.js",
    external: ["vscode"],
  },
  {
    entryPoints: ["src/web/server.ts"],
    outfile: "dist/web-server.js",
    external: [],
  },
];

async function main() {
  const contexts = await Promise.all(
    targets.map((target) =>
      esbuild.context({
        ...target,
        bundle: true,
        format: "cjs",
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        platform: "node",
        target: "node18",
        logLevel: "info",
      })
    )
  );

  if (watch) {
    await Promise.all(contexts.map((c) => c.watch()));
  } else {
    await Promise.all(contexts.map((c) => c.rebuild()));
    await Promise.all(contexts.map((c) => c.dispose()));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
