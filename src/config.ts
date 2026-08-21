import { access, readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { ReviewPilotError } from "./errors.js";

const commandSchema = z.array(z.string().min(1)).min(1);

const configSchema = z.object({
  model: z.string().min(1).default("openrouter/free"),
  review: z.object({
    focus: z.array(z.string().min(1)).min(1).default(["correctness", "security", "tests"]),
    minimumConfidence: z.number().min(0).max(1).default(0.75),
    maximumFindings: z.number().int().min(1).max(50).default(12),
    maximumPromptCharacters: z.number().int().min(10000).max(500000).default(100000)
  }).default({
    focus: ["correctness", "security", "tests"],
    minimumConfidence: 0.75,
    maximumFindings: 12,
    maximumPromptCharacters: 100000
  }),
  repository: z.object({
    maximumFileCharacters: z.number().int().min(1000).max(100000).default(20000),
    maximumRelatedFiles: z.number().int().min(0).max(50).default(12),
    ignoredPaths: z.array(z.string()).default([
      "dist/**",
      "build/**",
      "coverage/**",
      "*.min.js",
      "*.map"
    ])
  }).default({
    maximumFileCharacters: 20000,
    maximumRelatedFiles: 12,
    ignoredPaths: ["dist/**", "build/**", "coverage/**", "*.min.js", "*.map"]
  }),
  validation: z.object({
    commands: z.array(commandSchema).max(10).default([]),
    timeoutMilliseconds: z.number().int().min(1000).max(600000).default(120000)
  }).default({ commands: [], timeoutMilliseconds: 120000 })
});

export type ReviewPilotConfig = z.infer<typeof configSchema>;

const CONFIG_NAMES = ["reviewpilot.config.yml", "reviewpilot.config.yaml"];

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function loadConfig(cwd: string, explicitPath?: string): Promise<ReviewPilotConfig> {
  const candidate = explicitPath
    ? path.resolve(cwd, explicitPath)
    : (await Promise.all(CONFIG_NAMES.map(async (name) => {
        const filePath = path.join(cwd, name);
        return (await exists(filePath)) ? filePath : undefined;
      }))).find(Boolean);

  if (!candidate) {
    return configSchema.parse({ model: process.env.OPENROUTER_MODEL ?? "openrouter/free" });
  }

  try {
    const parsed = YAML.parse(await readFile(candidate, "utf8")) as unknown;
    const config = configSchema.parse(parsed ?? {});
    return process.env.OPENROUTER_MODEL ? { ...config, model: process.env.OPENROUTER_MODEL } : config;
  } catch (error) {
    throw new ReviewPilotError("INVALID_CONFIG", `Could not load configuration at ${candidate}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
