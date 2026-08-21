import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import type { ValidationResult } from "./types.js";

const MAX_CAPTURE_CHARACTERS = 40_000;

export interface RunCommandOptions {
  cwd: string;
  timeoutMilliseconds: number;
  env?: NodeJS.ProcessEnv;
  inheritEnvironment?: boolean;
}

export async function runCommand(command: string[], options: RunCommandOptions): Promise<ValidationResult> {
  const [executable, ...args] = command;
  if (!executable) throw new Error("Cannot execute an empty command.");

  const started = performance.now();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: { ...(options.inheritEnvironment === false ? {} : process.env), ...options.env },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_CAPTURE_CHARACTERS) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_CAPTURE_CHARACTERS) stderr += chunk.toString("utf8");
    });

    child.on("error", reject);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, options.timeoutMilliseconds);
    timer.unref();

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        command,
        exitCode,
        stdout: stdout.slice(0, MAX_CAPTURE_CHARACTERS),
        stderr: stderr.slice(0, MAX_CAPTURE_CHARACTERS),
        timedOut,
        durationMilliseconds: Math.round(performance.now() - started)
      });
    });
  });
}
