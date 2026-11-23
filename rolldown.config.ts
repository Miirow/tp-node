import { defineConfig } from "rolldown";
import run from "@rollup/plugin-run";

const isDev = process.env["ROLLDOWN_WATCH"] === "true";

export default defineConfig({
  platform: "node",
  input: "src/tp.ts",
  output: {
    file: "dist/server.js"
  },
  plugins: [isDev && run()]
});
