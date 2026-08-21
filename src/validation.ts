import type { ReviewPilotConfig } from "./config.js";
import { runCommand } from "./process.js";
import type { ValidationResult } from "./types.js";

const BLOCKED_EXECUTABLES = new Set([
  "rm", "rmdir", "sudo", "doas", "shutdown", "reboot", "mkfs", "dd", "curl", "wget", "ssh", "scp"
]);

export function assertSafeValidationCommand(command: string[]): void {
  const executable = command[0]?.toLowerCase();
  if (!executable || BLOCKED_EXECUTABLES.has(executable)) {
    throw new Error(`Validation command is not allowed: ${command.join(" ")}`);
  }
  if (command.some((part) => /[;&|`<>\n\r]/.test(part))) {
    throw new Error(`Shell operators are not allowed in validation commands: ${command.join(" ")}`);
  }
}

export async function runValidation(root: string, config: ReviewPilotConfig): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  for (const command of config.validation.commands) {
    assertSafeValidationCommand(command);
    const result = await runCommand(command, {
      cwd: root,
      timeoutMilliseconds: config.validation.timeoutMilliseconds,
      inheritEnvironment: false,
      env: {
        PATH: process.env.PATH ?? "",
        CI: "1",
        NO_COLOR: "1"
      }
    });
    results.push(result);
  }
  return results;
}
