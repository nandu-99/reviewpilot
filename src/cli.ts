#!/usr/bin/env node
import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { ReviewPilotError, toErrorMessage } from "./errors.js";
import { GeminiClient } from "./gemini.js";
import { GitHubClient } from "./github.js";
import { OpenRouterClient } from "./openrouter.js";
import type { ConfiguredReviewProvider } from "./providers.js";
import { renderPullRequestComment, REVIEWPILOT_COMMENT_MARKER, writeReports } from "./report.js";
import { executeReview } from "./reviewer.js";
import { loadIssuePilotConfig } from "./issuepilot/config.js";
import {
  GeminiIssueDescriptionClient,
  generateIssueDescription,
  OpenRouterIssueDescriptionClient
} from "./issuepilot/generator.js";
import { GitHubIssuePilotRepository } from "./issuepilot/github.js";
import { loadIssuePilotPlan } from "./issuepilot/plan.js";
import { syncIssuePilot, type IssueDescriptionGenerator } from "./issuepilot/sync.js";
import type { IssuePilotPlan, TaskProgress } from "./issuepilot/types.js";

interface CliOptions {
  config?: string;
  output: string;
  model?: string;
  provider?: string;
  focus?: string;
  issue?: string;
  linkedIssues: boolean;
  runChecks: boolean;
  force: boolean;
  postComment: boolean;
  quiet: boolean;
}

const program = new Command();
program
  .name("reviewpilot")
  .description("Repository-aware pull request reviews with OpenRouter")
  .version("1.1.0");

function reportCliError(product: "ReviewPilot" | "IssuePilot", error: unknown): void {
  const prefix = error instanceof ReviewPilotError ? `[${error.code}] ` : "";
  process.stderr.write(`${product} failed: ${prefix}${toErrorMessage(error)}\n`);
  process.exitCode = 1;
}

program
  .command("review")
  .description("Review a GitHub pull request and write local Markdown and JSON reports")
  .argument("<pr-url>", "GitHub pull request URL")
  .option("-c, --config <path>", "configuration file")
  .option("-o, --output <directory>", "report output directory", ".reviewpilot/reviews")
  .option("-m, --model <model>", "primary provider model ID")
  .option("--provider <provider>", "primary AI provider: gemini or openrouter")
  .option("--focus <areas>", "comma-separated review focus areas")
  .option("--issue <reference>", "explicit issue number, owner/repo#number, or GitHub issue URL")
  .option("--no-linked-issues", "do not auto-detect Closes/Fixes/Resolves references in the PR description")
  .option("--run-checks", "run explicitly configured validation commands", false)
  .option("--post-comment", "create or update the ReviewPilot summary comment on GitHub", false)
  .option("--force", "ignore an existing cached review for the same commit", false)
  .option("-q, --quiet", "show only the final result", false)
  .action(async (pullRequestUrl: string, cliOptions: CliOptions) => {
    try {
      const cwd = process.cwd();
      const config = await loadConfig(cwd, cliOptions.config);
      const geminiApiKey = process.env.GEMINI_API_KEY ?? "";
      const openRouterApiKey = process.env.OPENROUTER_API_KEY ?? "";
      const githubToken = process.env.GITHUB_TOKEN;
      const providerName = (cliOptions.provider ?? process.env.AI_PROVIDER ?? (geminiApiKey ? "gemini" : "openrouter")).toLowerCase();
      if (providerName !== "gemini" && providerName !== "openrouter") {
        throw new ReviewPilotError(
          "INVALID_AI_PROVIDER",
          "AI provider must be gemini or openrouter."
        );
      }
      const providers: ConfiguredReviewProvider[] = [];
      if (providerName === "gemini") {
        if (!geminiApiKey) {
          throw new ReviewPilotError(
            "MISSING_GEMINI_KEY",
            "GEMINI_API_KEY is required when AI_PROVIDER=gemini."
          );
        }
        providers.push({
          name: "gemini",
          model: cliOptions.model ?? process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
          client: new GeminiClient(geminiApiKey)
        });
        if (openRouterApiKey) {
          providers.push({
            name: "openrouter",
            model: process.env.OPENROUTER_FALLBACK_MODEL ?? process.env.OPENROUTER_MODEL ?? config.model,
            client: new OpenRouterClient(openRouterApiKey)
          });
        }
      } else {
        if (!openRouterApiKey) {
          throw new ReviewPilotError(
            "MISSING_OPENROUTER_KEY",
            "OPENROUTER_API_KEY is required when AI_PROVIDER=openrouter."
          );
        }
        providers.push({
          name: "openrouter",
          model: cliOptions.model ?? process.env.OPENROUTER_MODEL ?? config.model,
          client: new OpenRouterClient(openRouterApiKey)
        });
      }
      if (cliOptions.postComment && !githubToken) {
        throw new ReviewPilotError(
          "MISSING_GITHUB_TOKEN",
          "GITHUB_TOKEN is required with --post-comment. Put it in .env or export it in your shell."
        );
      }
      const onProgress = cliOptions.quiet ? undefined : (message: string) => process.stderr.write(`→ ${message}\n`);
      const execution = await executeReview({
        pullRequestUrl,
        config,
        ...(githubToken ? { githubToken } : {}),
        providers,
        outputDirectory: path.resolve(cwd, cliOptions.output),
        memoryFile: path.resolve(cwd, ".reviewpilot", "memory.json"),
        runChecks: cliOptions.runChecks,
        force: cliOptions.force,
        includeLinkedIssues: cliOptions.linkedIssues,
        ...(cliOptions.focus ? { focus: cliOptions.focus.split(",").map((item) => item.trim()).filter(Boolean) } : {}),
        ...(cliOptions.issue ? { issueReference: cliOptions.issue } : {}),
        ...(onProgress ? { onProgress } : {})
      });
      const paths = await writeReports(execution.report, path.resolve(cwd, cliOptions.output));
      let commentOutput = "";
      if (cliOptions.postComment) {
        onProgress?.("Creating or updating the ReviewPilot pull request comment...");
        const github = new GitHubClient(githubToken);
        const comment = await github.upsertPullRequestComment(
          execution.report.pr,
          renderPullRequestComment(execution.report),
          REVIEWPILOT_COMMENT_MARKER
        );
        commentOutput = `GitHub comment ${comment.action}: ${comment.url}\n`;
      }
      process.stdout.write(
        `${execution.cached ? "Cached review" : "Review complete"}: ${execution.report.review.findings.length} finding(s), risk ${execution.report.review.riskLevel}.\n` +
        `Markdown: ${paths.markdownPath}\nJSON: ${paths.jsonPath}\n${commentOutput}`
      );
    } catch (error) {
      reportCliError("ReviewPilot", error);
    }
  });

const issuePilot = program.command("issuepilot").description("Plan and release dependency-aware GitHub issues");

function issuePilotModel(providerOption?: string, modelOption?: string) {
  const provider = (providerOption ?? process.env.AI_PROVIDER ?? (process.env.GEMINI_API_KEY ? "gemini" : "openrouter")).toLowerCase();
  const client = provider === "gemini"
    ? new GeminiIssueDescriptionClient(process.env.GEMINI_API_KEY ?? "")
    : provider === "openrouter"
      ? new OpenRouterIssueDescriptionClient(process.env.OPENROUTER_API_KEY ?? "")
      : undefined;
  if (!client) throw new ReviewPilotError("INVALID_AI_PROVIDER", "AI provider must be gemini or openrouter.");
  const model = modelOption ?? (provider === "gemini"
    ? process.env.GEMINI_MODEL ?? "gemini-2.5-flash"
    : process.env.OPENROUTER_MODEL ?? "openrouter/free");
  return { provider, client, model };
}

issuePilot
  .command("sync")
  .description("Evaluate approved tasks and optionally create the next eligible issues")
  .option("-c, --config <path>", "IssuePilot configuration file", ".issuepilot/config.yml")
  .option("-p, --plan <path>", "approved plan path", ".issuepilot/plan.yml")
  .option("--provider <provider>", "AI provider for just-in-time issue descriptions: gemini or openrouter")
  .option("-m, --model <model>", "provider model ID for issue descriptions")
  .option("--apply", "create eligible GitHub issues", false)
  .action(async (options: { config: string; plan: string; apply: boolean; provider?: string; model?: string }) => {
    try {
      const cwd = process.cwd();
      const githubToken = process.env.GITHUB_TOKEN;
      if (!githubToken) throw new ReviewPilotError("MISSING_GITHUB_TOKEN", "GITHUB_TOKEN is required to synchronize issues.");
      const config = await loadIssuePilotConfig(cwd, options.config);
      const plan = await loadIssuePilotPlan(cwd, config, options.plan);
      const repository = new GitHubIssuePilotRepository(config.repository, githubToken);
      let generateDescription: IssueDescriptionGenerator | undefined;
      if (options.apply) {
        const [projectDocument, issueTemplate] = await Promise.all([
          readFile(path.resolve(cwd, config.projectDocument), "utf8"),
          readFile(path.resolve(cwd, config.issueTemplate), "utf8")
        ]);
        const { provider, client, model } = issuePilotModel(options.provider, options.model);
        generateDescription = async (task: IssuePilotPlan["tasks"][number], progress: TaskProgress[]) => {
          process.stderr.write(`→ Generating the current issue description for ${task.id} with ${provider}/${model}...\n`);
          return generateIssueDescription({
            projectDocument,
            issueTemplate,
            task,
            progress,
            client,
            model,
            onRetry: (attempt, maxAttempts, reason) => {
              process.stderr.write(
                `→ Issue description generation failed (${reason.slice(0, 300)}). Retrying attempt ${attempt}/${maxAttempts}...\n`
              );
            }
          });
        };
      }
      const result = await syncIssuePilot(config, plan, repository, options.apply, generateDescription);
      for (const item of result.progress) process.stdout.write(`${item.task.id}: ${item.state} — ${item.reason}\n`);
      for (const issue of result.created) process.stdout.write(`Created ${issue.taskId}: ${issue.url}\n`);
      for (const issue of result.wouldCreate) process.stdout.write(`Would create ${issue.taskId} for ${issue.assignee}: ${issue.title}\n`);
      if (!options.apply) process.stdout.write("Dry run only. Re-run with --apply to create eligible issues.\n");
    } catch (error) {
      reportCliError("IssuePilot", error);
    }
  });

await program.parseAsync(process.argv);
