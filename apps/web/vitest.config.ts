import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: rootDir,
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: [fileURLToPath(new URL("./src/vitest-setup.ts", import.meta.url))],
  },
});
