import esbuild from "esbuild";
import process from "node:process";
import {builtinModules} from "node:module";
import {join, dirname} from "node:path";
import {fileURLToPath} from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isProduction = process.argv.includes("production");
const emptyShim = join(__dirname, "src/shims/empty.js");

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
  ],
  alias: Object.fromEntries(builtinModules.flatMap((m) => [
    [m, emptyShim],
    [`node:${m}`, emptyShim],
  ])),
  format: "cjs",
  platform: "browser",
  target: "es2022",
  logLevel: "info",
  sourcemap: isProduction ? false : "inline",
  treeShaking: true,
  outfile: "main.js"
});

if (isProduction) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
  console.log("Watching for changes...");
}
