import path from "node:path";
import {fileURLToPath} from "node:url";
import {defineConfig} from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      obsidian: path.resolve(__dirname, "tests/obsidian-mock.ts")
    }
  },
  esbuild: {
    target: "es2022"
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"]
  }
});
