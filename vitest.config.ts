import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      thresholds: {
        statements: 50,
        branches: 70,
        functions: 65,
        lines: 50
      }
    }
  }
});
