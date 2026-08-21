import { describe, expect, it } from "vitest";
import { runCommand } from "../src/process.js";
import { assertSafeValidationCommand } from "../src/validation.js";

describe("validation command policy", () => {
  it("allows direct test commands", () => {
    expect(() => assertSafeValidationCommand(["npm", "test"])).not.toThrow();
  });

  it("blocks destructive executables and shell operators", () => {
    expect(() => assertSafeValidationCommand(["rm", "-rf", "build"])).toThrow(/not allowed/);
    expect(() => assertSafeValidationCommand(["npm", "test", "&&", "curl"])).toThrow(/Shell operators/);
  });

  it("can execute with an isolated environment", async () => {
    process.env.REVIEWPILOT_SHOULD_NOT_LEAK = "secret";
    try {
      const result = await runCommand(
        [process.execPath, "-e", "process.stdout.write(process.env.REVIEWPILOT_SHOULD_NOT_LEAK ?? 'clean')"],
        {
          cwd: process.cwd(),
          timeoutMilliseconds: 5_000,
          inheritEnvironment: false,
          env: { PATH: process.env.PATH ?? "" }
        }
      );
      expect(result.stdout).toBe("clean");
    } finally {
      delete process.env.REVIEWPILOT_SHOULD_NOT_LEAK;
    }
  });
});
