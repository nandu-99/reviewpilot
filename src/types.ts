export type Severity = "critical" | "high" | "medium" | "low";

export interface PullRequestRef {
  owner: string;
  repo: string;
  number: number;
  url: string;
}

export interface PullRequestMetadata extends PullRequestRef {
  title: string;
  body: string;
  baseSha: string;
  headSha: string;
  baseRef: string;
  headRef: string;
  author: string;
  draft: boolean;
  changedFiles: number;
}

export interface PullRequestFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  previousFilename?: string;
}

export interface IssueRef {
  owner: string;
  repo: string;
  number: number;
  url: string;
}

export interface IssueContext extends IssueRef {
  title: string;
  body: string;
  state: "open" | "closed";
  author: string;
  assignees: string[];
  labels: string[];
  updatedAt: string;
}

export interface DiffFile {
  path: string;
  previousPath?: string;
  status: "added" | "modified" | "deleted" | "renamed" | "unknown";
  patch: string;
  addedLines: Set<number>;
}

export interface RepositoryContext {
  instructions: Array<{ path: string; content: string }>;
  changedFiles: Array<{ path: string; content: string; truncated: boolean }>;
  relatedFiles: Array<{ path: string; content: string; reason: string; truncated: boolean }>;
  manifest?: { path: string; content: string };
  redactionCount: number;
}

export interface ValidationResult {
  command: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMilliseconds: number;
}

export interface Finding {
  severity: Severity;
  confidence: number;
  category: string;
  file: string | null;
  line: number | null;
  title: string;
  evidence: string;
  impact: string;
  suggestion: string;
}

export interface ReviewResult {
  summary: string;
  riskLevel: Severity | "none";
  reviewedAreas: string[];
  uncertainties: string[];
  findings: Finding[];
  model: string;
}

export interface ReviewReport {
  pr: PullRequestMetadata;
  issues: IssueContext[];
  review: ReviewResult;
  validation: ValidationResult[];
  inspectedFiles: string[];
  generatedAt: string;
  cacheKey: string;
}
