import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ReviewPilotError } from "./errors.js";
import { runCommand } from "./process.js";
import type { PullRequestMetadata } from "./types.js";

export interface Checkout {
  directory: string;
  cleanup: () => Promise<void>;
}

function gitAuthenticationEnvironment(token?: string): NodeJS.ProcessEnv {
  if (!token) return {};
  const credential = Buffer.from(`x-access-token:${token}`).toString("base64");
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${credential}`,
    GIT_TERMINAL_PROMPT: "0"
  };
}

async function requireSuccess(command: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<void> {
  const result = await runCommand(command, {
    cwd,
    timeoutMilliseconds: 120_000,
    ...(env ? { env } : {})
  });
  if (result.exitCode !== 0) {
    throw new ReviewPilotError(
      "GIT_ERROR",
      `Command failed: ${command.join(" ")}\n${result.stderr || result.stdout}`
    );
  }
}

export async function checkoutPullRequest(pr: PullRequestMetadata, token?: string): Promise<Checkout> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "reviewpilot-"));
  const env = gitAuthenticationEnvironment(token);

  try {
    await requireSuccess(["git", "init", "--quiet", directory], process.cwd());
    await requireSuccess(
      ["git", "remote", "add", "origin", `https://github.com/${pr.owner}/${pr.repo}.git`],
      directory
    );
    await requireSuccess(
      ["git", "fetch", "--quiet", "--depth=1", "origin", `refs/pull/${pr.number}/head`],
      directory,
      env
    );
    await requireSuccess(["git", "checkout", "--quiet", "--detach", pr.headSha], directory);
    return {
      directory,
      cleanup: () => rm(directory, { recursive: true, force: true })
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
