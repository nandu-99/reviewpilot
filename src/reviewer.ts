import path from "node:path";
import { createHash } from "node:crypto";
import type { ReviewPilotConfig } from "./config.js";
import { parseUnifiedDiff, renderDiffForPrompt } from "./diff.js";
import { ReviewPilotError } from "./errors.js";
import { checkoutPullRequest } from "./git.js";
import { extractClosingIssueReferences, GitHubClient, parseIssueReference, parsePullRequestUrl } from "./github.js";
import { ReviewMemory } from "./memory.js";
import { generateReviewWithFallback, providerCacheIdentity, type ConfiguredReviewProvider } from "./providers.js";
import { collectRepositoryContext } from "./repository.js";
import { redactSecrets } from "./security.js";
import type { DiffFile, Finding, IssueContext, IssueRef, RepositoryContext, ReviewReport, ReviewResult, ValidationResult } from "./types.js";
import { runValidation } from "./validation.js";

export interface ReviewOptions {
  pullRequestUrl: string;
  config: ReviewPilotConfig;
  githubToken?: string;
  providers: ConfiguredReviewProvider[];
  outputDirectory: string;
  memoryFile: string;
  runChecks: boolean;
  force: boolean;
  focus?: string[];
  issueReference?: string;
  includeLinkedIssues?: boolean;
  onProgress?: (message: string) => void;
}

function serializeIssues(issues: IssueContext[], maximumCharacters: number): string {
  if (issues.length === 0) return "No linked issue was supplied or detected. Perform a code-quality review without assuming unstated requirements.";
  const sections: string[] = [];
  let remaining = maximumCharacters;
  for (const issue of issues) {
    if (remaining <= 0) break;
    const section = `--- ISSUE: ${issue.owner}/${issue.repo}#${issue.number} ---\nTitle: ${issue.title}\nState: ${issue.state}\nURL: ${issue.url}\nLabels: ${issue.labels.join(", ") || "none"}\nAssignees: ${issue.assignees.join(", ") || "none"}\n\n${issue.body || "(no description)"}`;
    sections.push(section.slice(0, remaining));
    remaining -= section.length;
  }
  return sections.join("\n\n");
}

function uniqueIssueRefs(refs: IssueRef[]): IssueRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.owner.toLowerCase()}/${ref.repo.toLowerCase()}#${ref.number}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface ReviewExecution {
  report: ReviewReport;
  cached: boolean;
}

function serializeContext(context: RepositoryContext, maximumCharacters: number): string {
  const sections: string[] = [];
  const append = (header: string, content: string) => {
    const used = sections.reduce((total, section) => total + section.length, 0);
    const remaining = maximumCharacters - used;
    if (remaining <= header.length) return;
    sections.push(`${header}\n${content.slice(0, remaining - header.length)}`);
  };

  for (const item of context.instructions) append(`--- REPOSITORY INSTRUCTION: ${item.path} ---`, item.content);
  if (context.manifest) append(`--- MANIFEST: ${context.manifest.path} ---`, context.manifest.content);
  for (const item of context.changedFiles) append(`--- CHANGED FILE: ${item.path}${item.truncated ? " (truncated)" : ""} ---`, item.content);
  for (const item of context.relatedFiles) append(`--- RELATED FILE: ${item.path} (${item.reason})${item.truncated ? " (truncated)" : ""} ---`, item.content);
  return sections.join("\n\n");
}

function validationForPrompt(results: ValidationResult[]): string {
  if (results.length === 0) return "Validation was not run.";
  return results.map((result) => {
    const status = result.timedOut ? "timed out" : result.exitCode === 0 ? "passed" : `failed with exit code ${result.exitCode}`;
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").slice(0, 5000);
    return `$ ${result.command.join(" ")}\nStatus: ${status}\n${output}`;
  }).join("\n\n");
}

function severityRank(severity: Finding["severity"]): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[severity];
}

export function findingRulesForPrompt(hasIssueContext: boolean): string {
  if (hasIssueContext) {
    return "Review defects introduced by the diff and completeness against the linked issue. " +
      "A required behavior that the PR entirely omits is in scope even when no corresponding line was changed: report it as a category \"requirements\" finding with both file and line set to null. " +
      "Do not mention an unmet requirement only in the summary; include it in findings. " +
      "All other code findings must point to an added line shown in the diff.";
  }

  return "Review only defects introduced by this diff. Every finding must point to an added line shown in the diff.";
}

export function verifyFindings(
  review: Omit<ReviewResult, "model">,
  diffFiles: DiffFile[],
  minimumConfidence: number,
  maximumFindings: number,
  model: string,
  hasIssueContext = false
): ReviewResult {
  const byPath = new Map(diffFiles.map((file) => [file.path, file]));
  const seen = new Set<string>();
  const findings = review.findings
    .filter((finding) => finding.confidence >= minimumConfidence)
    .filter((finding) => {
      if (finding.file === null && finding.line === null) {
        return hasIssueContext && /^(?:requirement|requirements|scope)$/i.test(finding.category.trim());
      }
      if (finding.file === null || finding.line === null) return false;
      const diffFile = byPath.get(finding.file.replace(/^\.\//, ""));
      return diffFile?.addedLines.has(finding.line) ?? false;
    })
    .filter((finding) => {
      const key = `${finding.file}:${finding.line}:${finding.title.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.confidence - a.confidence)
    .slice(0, maximumFindings);

  const riskLevel = findings.length === 0
    ? "none"
    : findings.reduce((highest, finding) => severityRank(finding.severity) > severityRank(highest) ? finding.severity : highest, findings[0]!.severity);

  return { ...review, findings, riskLevel, model };
}

export async function executeReview(options: ReviewOptions): Promise<ReviewExecution> {
  const progress = options.onProgress ?? (() => undefined);
  const ref = parsePullRequestUrl(options.pullRequestUrl);
  const github = new GitHubClient(options.githubToken);
  const memory = new ReviewMemory(path.resolve(options.memoryFile));

  progress("Fetching pull request metadata from GitHub...");
  const fetchedPr = await github.getPullRequest(ref);
  const redactedTitle = redactSecrets(fetchedPr.title);
  const redactedBody = redactSecrets(fetchedPr.body);
  const pr = { ...fetchedPr, title: redactedTitle.value, body: redactedBody.value };
  const detectedIssueRefs = options.includeLinkedIssues === false
    ? []
    : extractClosingIssueReferences(fetchedPr.body, ref);
  const explicitIssueRefs = options.issueReference
    ? [parseIssueReference(options.issueReference, ref)]
    : [];
  const issueRefs = uniqueIssueRefs([...explicitIssueRefs, ...detectedIssueRefs]);
  if (issueRefs.length > 0) progress(`Fetching ${issueRefs.length} issue(s) for requirement-aware review...`);
  const fetchedIssues = await Promise.all(issueRefs.map((issue) => github.getIssue(issue)));
  let issueRedactionCount = 0;
  const issues = fetchedIssues.map((issue) => {
    const title = redactSecrets(issue.title);
    const body = redactSecrets(issue.body);
    issueRedactionCount += title.count + body.count;
    return { ...issue, title: title.value, body: body.value };
  });
  const metadataRedactionCount = redactedTitle.count + redactedBody.count + issueRedactionCount;
  const focus = options.focus?.length ? options.focus : options.config.review.focus;
  const reviewSettingsHash = createHash("sha256").update(JSON.stringify({
    providers: providerCacheIdentity(options.providers),
    focus,
    minimumConfidence: options.config.review.minimumConfidence,
    maximumFindings: options.config.review.maximumFindings,
    runChecks: options.runChecks,
    validationCommands: options.runChecks ? options.config.validation.commands : [],
    issues: issues.map((issue) => ({
      reference: `${issue.owner}/${issue.repo}#${issue.number}`,
      updatedAt: issue.updatedAt,
      contentHash: createHash("sha256").update(`${issue.title}\n${issue.body}`).digest("hex")
    }))
  })).digest("hex").slice(0, 12);
  const cacheKey = `${pr.owner}/${pr.repo}#${pr.number}@${pr.headSha}:${reviewSettingsHash}`;
  if (!options.force) {
    const cached = await memory.get(cacheKey);
    if (cached) {
      progress("Using the cached review for this exact commit.");
      return { report: cached, cached: true };
    }
  }

  progress("Fetching changed files and the complete diff...");
  const [apiFiles, rawDiff] = await Promise.all([
    github.getPullRequestFiles(ref),
    github.getPullRequestDiff(ref)
  ]);
  const redactedDiff = redactSecrets(rawDiff);
  const diffFiles = parseUnifiedDiff(redactedDiff.value);
  if (diffFiles.length === 0) throw new ReviewPilotError("EMPTY_DIFF", "GitHub returned an empty or unsupported diff for this PR.");

  progress("Checking out the exact PR commit in a temporary workspace...");
  const checkout = await checkoutPullRequest(pr, options.githubToken);
  try {
    progress("Inspecting changed files, related code, and repository instructions...");
    const context = await collectRepositoryContext(checkout.directory, apiFiles, diffFiles, options.config);

    let validation: ValidationResult[] = [];
    if (options.runChecks) {
      if (options.config.validation.commands.length === 0) {
        throw new ReviewPilotError("NO_VALIDATION_COMMANDS", "--run-checks was provided, but no validation.commands are configured.");
      }
      progress("Running explicitly configured validation commands...");
      validation = await runValidation(checkout.directory, options.config);
    }

    const promptLimit = options.config.review.maximumPromptCharacters;
    const diffBudget = Math.floor(promptLimit * 0.55);
    const issueBudget = issues.length > 0 ? Math.min(20_000, Math.floor(promptLimit * 0.2)) : 1_000;
    const contextBudget = Math.max(0, promptLimit - diffBudget - issueBudget - 10_000);
    const requirementInstruction = issues.length > 0
      ? "Compare the implementation with the linked issue requirements and acceptance criteria. Report concrete missing, contradictory, or incorrectly implemented requirements when supported by the changed code. Do not invent requirements that are absent from the issue."
      : "No issue requirements are available, so review correctness and quality without assuming unstated product behavior.";
    const prompt = `Review pull request ${pr.owner}/${pr.repo}#${pr.number}.\n\nPR title: ${pr.title}\nPR description: ${pr.body || "(none)"}\nAuthor: ${pr.author}\nBase: ${pr.baseRef} (${pr.baseSha})\nHead: ${pr.headRef} (${pr.headSha})\nReview focus: ${focus.join(", ")}\nSecrets redacted before analysis: ${metadataRedactionCount + redactedDiff.count + context.redactionCount}\n\n--- LINKED ISSUE REQUIREMENTS ---\n${serializeIssues(issues, issueBudget)}\n\n--- PULL REQUEST DIFF ---\n${renderDiffForPrompt(diffFiles, diffBudget)}\n\n--- REPOSITORY CONTEXT ---\n${serializeContext(context, contextBudget)}\n\n--- VALIDATION RESULTS ---\n${validationForPrompt(validation)}\n\n${requirementInstruction}\n${findingRulesForPrompt(issues.length > 0)}`;

    const generated = await generateReviewWithFallback(options.providers, prompt, progress);
    const review = verifyFindings(
      generated.result,
      diffFiles,
      options.config.review.minimumConfidence,
      options.config.review.maximumFindings,
      generated.actualModel,
      issues.length > 0
    );

    const inspectedFiles = [
      ...context.instructions.map((item) => item.path),
      ...context.changedFiles.map((item) => item.path),
      ...context.relatedFiles.map((item) => item.path)
    ];
    const report: ReviewReport = {
      pr,
      issues,
      review,
      validation,
      inspectedFiles: [...new Set(inspectedFiles)],
      generatedAt: new Date().toISOString(),
      cacheKey
    };
    await memory.put(report);
    return { report, cached: false };
  } finally {
    progress("Removing the temporary checkout...");
    await checkout.cleanup();
  }
}
