import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Finding, ReviewReport, ValidationResult } from "./types.js";

export const REVIEWPILOT_COMMENT_MARKER = "<!-- reviewpilot:pr-review -->";

function renderFinding(finding: Finding, index: number): string {
  const location = finding.file !== null && finding.line !== null
    ? `\`${finding.file}:${finding.line}\``
    : "General requirement finding";
  return `### ${index + 1}. ${finding.severity.toUpperCase()}: ${finding.title}\n\n` +
    `- Location: ${location}\n` +
    `- Category: ${finding.category}\n` +
    `- Confidence: ${Math.round(finding.confidence * 100)}%\n\n` +
    `**Evidence:** ${finding.evidence}\n\n` +
    `**Impact:** ${finding.impact}\n\n` +
    `**Suggested change:** ${finding.suggestion}\n`;
}

function oneLine(value: string, maximumLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maximumLength) return normalized;

  const candidate = normalized.slice(0, maximumLength);
  const sentenceEnd = Math.max(
    candidate.lastIndexOf(". "),
    candidate.lastIndexOf("! "),
    candidate.lastIndexOf("? ")
  );
  if (sentenceEnd >= Math.floor(maximumLength * 0.55)) {
    return candidate.slice(0, sentenceEnd + 1);
  }
  return `${candidate.slice(0, maximumLength - 1).trimEnd()}…`;
}

function renderCompactFinding(finding: Finding, index: number): string {
  const severityIcon = {
    critical: "🔴",
    high: "🟠",
    medium: "🟡",
    low: "🔵"
  }[finding.severity];
  const location = finding.file !== null && finding.line !== null
    ? `\`${finding.file}:${finding.line}\``
    : "General requirement";
  return `### ${severityIcon} ${index + 1}. ${oneLine(finding.title, 120)}\n\n` +
    `${location} · ${Math.round(finding.confidence * 100)}% confidence\n\n` +
    `- **Wrong:** ${oneLine(finding.evidence, 300)}\n` +
    `- **Example impact:** ${oneLine(finding.impact, 240)}\n` +
    `- **Fix:** ${oneLine(finding.suggestion, 240)}\n`;
}

function renderValidation(result: ValidationResult): string {
  const status = result.timedOut ? "TIMED OUT" : result.exitCode === 0 ? "PASSED" : `FAILED (${result.exitCode ?? "unknown"})`;
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").slice(0, 4000);
  return `### \`${result.command.join(" ")}\` — ${status}\n\n` +
    (output ? `\`\`\`text\n${output}\n\`\`\`\n` : "No output.\n");
}

export function renderMarkdownReport(report: ReviewReport): string {
  const reportIssues = report.issues ?? [];
  const findings = report.review.findings.length > 0
    ? report.review.findings.map(renderFinding).join("\n")
    : "No high-confidence defects were found in the supplied changes.\n";
  const validation = report.validation.length > 0
    ? report.validation.map(renderValidation).join("\n")
    : "Validation commands were not run. Use `--run-checks` with explicitly configured commands to enable them.\n";
  const issues = reportIssues.length > 0
    ? reportIssues.map((issue) => `- [${issue.owner}/${issue.repo}#${issue.number}: ${issue.title}](${issue.url})`).join("\n")
    : "- None; this was a PR-only review.";

  return `# ReviewPilot report: ${report.pr.owner}/${report.pr.repo}#${report.pr.number}\n\n` +
    `- PR: [${report.pr.title}](${report.pr.url})\n` +
    `- Commit: \`${report.pr.headSha}\`\n` +
    `- Model: \`${report.review.model}\`\n` +
    `- Risk: **${report.review.riskLevel.toUpperCase()}**\n` +
    `- Generated: ${report.generatedAt}\n\n` +
    `## Summary\n\n${report.review.summary}\n\n` +
    `## Requirement sources\n\n${issues}\n\n` +
    `## Findings\n\n${findings}\n` +
    `## Validation\n\n${validation}\n` +
    `## Scope\n\nReviewed areas: ${report.review.reviewedAreas.join(", ") || "not specified"}.\n\n` +
    `Inspected files:\n${report.inspectedFiles.map((file) => `- \`${file}\``).join("\n") || "- None"}\n\n` +
    (report.review.uncertainties.length > 0
      ? `## Uncertainties\n\n${report.review.uncertainties.map((item) => `- ${item}`).join("\n")}\n`
      : "");
}

export function renderPullRequestComment(report: ReviewReport): string {
  const findings = report.review.findings.length > 0
    ? report.review.findings.map(renderCompactFinding).join("\n")
    : "### ✅ No high-confidence findings\n\nNo actionable defects were found in this review.\n";
  const issues = report.issues.length > 0
    ? report.issues.map((issue) => `[${issue.owner}/${issue.repo}#${issue.number}](${issue.url})`).join(", ")
    : "PR-only review";
  const content = `## 🤖 ReviewPilot\n\n` +
    `**Risk:** ${report.review.riskLevel.toUpperCase()} · **Commit:** \`${report.pr.headSha.slice(0, 12)}\` · **Requirements:** ${issues}\n\n` +
    `**Summary:** ${oneLine(report.review.summary, 300)}\n\n` +
    `${findings}\n` +
    `_This comment updates automatically when ReviewPilot runs again._`;
  const maximumContentLength = 60_000;
  const truncated = content.length > maximumContentLength
    ? `${content.slice(0, maximumContentLength)}\n\n_Comment truncated; see the local report for complete output._`
    : content;
  return `${truncated}\n\n${REVIEWPILOT_COMMENT_MARKER}`;
}

export async function writeReports(report: ReviewReport, outputDirectory: string): Promise<{ markdownPath: string; jsonPath: string }> {
  const directory = path.resolve(outputDirectory);
  await mkdir(directory, { recursive: true });
  const baseName = `${report.pr.owner}-${report.pr.repo}-pr-${report.pr.number}-${report.pr.headSha.slice(0, 8)}`
    .replace(/[^A-Za-z0-9._-]/g, "-");
  const markdownPath = path.join(directory, `${baseName}.md`);
  const jsonPath = path.join(directory, `${baseName}.json`);
  await Promise.all([
    writeFile(markdownPath, renderMarkdownReport(report), "utf8"),
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  ]);
  return { markdownPath, jsonPath };
}
