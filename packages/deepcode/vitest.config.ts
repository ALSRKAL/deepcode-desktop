import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    conditions: ["@deepcode/source"],
  },
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
