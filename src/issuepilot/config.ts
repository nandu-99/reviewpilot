import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { ReviewPilotError } from "../errors.js";
import type { IssuePilotConfig } from "./types.js";

const githubLogin = z.string().trim().min(1).max(39).regex(/^[a-zd](?:[a-zd-]*[a-zd])?$/i);

export const issuePilotConfigSchema = z.object({
  repository: z.string().trim().regex(/^[^/\s]+\/[^/\s]+$/, "repository must use owner/name format"),
  projectDocument: z.string().trim().min(1).default("PROJECT_CONTEXT.md"),
  issueTemplate: z.string().trim().min(1).default("ISSUE_FORMAT.md"),
  managedLabel: z.string().trim().min(1).default("issuepilot"),
  manualCompletionLabel: z.string().trim().min(1).default("completed-manually"),
  team: z.array(z.object({
    github: githubLogin,
    role: z.string().trim().min(1).max(60)
  })).min(1).max(50)
}).superRefine((config, context) => {
  const logins = new Set<string>();
  for (const [index, member] of config.team.entries()) {
    const login = member.github.toLowerCase();
    if (logins.has(login)) {
      context.addIssue({ code: "custom", path: ["team", index, "github"], message: "team GitHub logins must be unique" });
    }
    logins.add(login);
  }
});

export async function loadIssuePilotConfig(cwd: string, configPath = ".issuepilot/config.yml"): Promise<IssuePilotConfig> {
  const resolved = path.resolve(cwd, configPath);
  try {
    return issuePilotConfigSchema.parse(YAML.parse(await readFile(resolved, "utf8")) as unknown);
  } catch (error) {
    throw new ReviewPilotError(
      "INVALID_ISSUEPILOT_CONFIG",
      `Could not load IssuePilot configuration at ${resolved}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
