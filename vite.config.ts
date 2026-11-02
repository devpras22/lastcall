/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // node_modules is a symlink to node_modules.nosync (keeps it out of iCloud); keep paths as-is so deps get pre-bundled.
  resolve: { preserveSymlinks: true },
  test: { include: ["convex/**/*.test.ts", "src/**/*.test.ts"] },
});
