import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "node18",
    platform: "node",
  },
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    sourcemap: false,
    target: "node18",
    platform: "node",
  },
]);
