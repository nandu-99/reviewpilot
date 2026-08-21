import { ReviewPilotError } from "./errors.js";
import type { IssueContext, IssueRef, PullRequestFile, PullRequestMetadata, PullRequestRef } from "./types.js";

const GITHUB_API = "https://api.github.com";

export function parsePullRequestUrl(input: string): PullRequestRef {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ReviewPilotError("INVALID_PR_URL", "Expected a GitHub pull request URL such as https://github.com/owner/repo/pull/123.");
  }

  if (url.hostname.toLowerCase() !== "github.com") {
    throw new ReviewPilotError("INVALID_PR_URL", "Version 1 supports github.com pull request URLs only.");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 4 || parts[2] !== "pull" || !/^\d+$/.test(parts[3] ?? "")) {
    throw new ReviewPilotError("INVALID_PR_URL", "Expected a GitHub pull request URL such as https://github.com/owner/repo/pull/123.");
  }

  const number = Number(parts[3]);
  return {
    owner: parts[0]!,
    repo: parts[1]!.replace(/\.git$/, ""),
    number,
    url: `https://github.com/${parts[0]}/${parts[1]!.replace(/\.git$/, "")}/pull/${number}`
  };
}

function issueRef(owner: string, repo: string, number: number): IssueRef {
  return {
    owner,
    repo: repo.replace(/\.git$/, ""),
    number,
    url: `https://github.com/${owner}/${repo.replace(/\.git$/, "")}/issues/${number}`
  };
}

export function parseIssueReference(input: string, defaultRepository: Pick<PullRequestRef, "owner" | "repo">): IssueRef {
  const value = input.trim();
  const urlMatch = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)(?:[/?#].*)?$/i.exec(value);
  if (urlMatch) return issueRef(urlMatch[1]!, urlMatch[2]!, Number(urlMatch[3]));

  const qualifiedMatch = /^([^/\s]+)\/([^#\s]+)#(\d+)$/.exec(value);
  if (qualifiedMatch) return issueRef(qualifiedMatch[1]!, qualifiedMatch[2]!, Number(qualifiedMatch[3]));

  const localMatch = /^#?(\d+)$/.exec(value);
  if (localMatch) return issueRef(defaultRepository.owner, defaultRepository.repo, Number(localMatch[1]));

  throw new ReviewPilotError(
    "INVALID_ISSUE_REFERENCE",
    "Expected an issue number, #123, owner/repo#123, or https://github.com/owner/repo/issues/123."
  );
}

export function extractClosingIssueReferences(body: string, defaultRepository: Pick<PullRequestRef, "owner" | "repo">): IssueRef[] {
  const references: IssueRef[] = [];
  const seen = new Set<string>();
  const lines = body.split(/\r?\n/).filter((line) => /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b/i.test(line));
  const referencePattern = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/\d+|[^/\s,;]+\/[^#\s,;]+#\d+|#\d+/gi;

  for (const line of lines) {
    for (const match of line.matchAll(referencePattern)) {
      try {
        const parsed = parseIssueReference(match[0], defaultRepository);
        const key = `${parsed.owner.toLowerCase()}/${parsed.repo.toLowerCase()}#${parsed.number}`;
        if (!seen.has(key)) {
          seen.add(key);
          references.push(parsed);
        }
      } catch {
        // Ignore non-issue tokens in otherwise valid closing-keyword lines.
      }
      if (references.length >= 5) return references;
    }
  }
  return references;
}

interface GitHubPullResponse {
  title: string;
  body: string | null;
  base: { sha: string; ref: string };
  head: { sha: string; ref: string };
  user: { login: string } | null;
  draft: boolean | null;
  changed_files: number;
}

interface GitHubFileResponse {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  previous_filename?: string;
}

interface GitHubIssueResponse {
  title: string;
  body: string | null;
  state: "open" | "closed";
  user: { login: string } | null;
  assignees?: Array<{ login: string }> | null;
  labels?: Array<string | { name?: string | null }>;
  updated_at: string;
  pull_request?: unknown;
}

interface GitHubUserResponse {
  login: string;
}

interface GitHubIssueCommentResponse {
  id: number;
  body: string | null;
  html_url: string;
  user: { login: string } | null;
}

export interface PullRequestCommentResult {
  action: "created" | "updated";
  url: string;
}

export class GitHubClient {
  constructor(private readonly token?: string, private readonly fetchImpl: typeof fetch = fetch) {}

  private headers(accept = "application/vnd.github+json"): Record<string, string> {
    return {
      Accept: accept,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "ReviewPilot/1.0",
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
    };
  }

  private async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(url, {
      ...init,
      headers: {
        ...this.headers(),
        ...(init.body ? { "Content-Type": "application/json" } : {})
      }
    });
    if (!response.ok) {
      const detail = await response.text();
      const hint = response.status === 404
        ? " The repository may be private or the token may not have access."
        : "";
      throw new ReviewPilotError("GITHUB_API_ERROR", `GitHub returned ${response.status} for ${url}.${hint} ${detail.slice(0, 500)}`);
    }
    return response.json() as Promise<T>;
  }

  async getPullRequest(ref: PullRequestRef): Promise<PullRequestMetadata> {
    const data = await this.request<GitHubPullResponse>(`${GITHUB_API}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/pulls/${ref.number}`);
    return {
      ...ref,
      title: data.title,
      body: data.body ?? "",
      baseSha: data.base.sha,
      headSha: data.head.sha,
      baseRef: data.base.ref,
      headRef: data.head.ref,
      author: data.user?.login ?? "unknown",
      draft: data.draft ?? false,
      changedFiles: data.changed_files
    };
  }

  async getIssue(ref: IssueRef): Promise<IssueContext> {
    const data = await this.request<GitHubIssueResponse>(
      `${GITHUB_API}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/issues/${ref.number}`
    );
    if (data.pull_request) {
      throw new ReviewPilotError("ISSUE_IS_PULL_REQUEST", `${ref.url} is a pull request, not an issue.`);
    }
    return {
      ...ref,
      title: data.title,
      body: data.body ?? "",
      state: data.state,
      author: data.user?.login ?? "unknown",
      assignees: (data.assignees ?? []).map((assignee) => assignee.login),
      labels: (data.labels ?? []).map((label) => typeof label === "string" ? label : label.name ?? "").filter(Boolean),
      updatedAt: data.updated_at
    };
  }

  async getPullRequestFiles(ref: PullRequestRef): Promise<PullRequestFile[]> {
    const files: PullRequestFile[] = [];
    for (let page = 1; page <= 30; page += 1) {
      const data = await this.request<GitHubFileResponse[]>(
        `${GITHUB_API}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/pulls/${ref.number}/files?per_page=100&page=${page}`
      );
      files.push(...data.map((file) => ({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
        ...(file.patch !== undefined ? { patch: file.patch } : {}),
        ...(file.previous_filename !== undefined ? { previousFilename: file.previous_filename } : {})
      })));
      if (data.length < 100) break;
    }
    return files;
  }

  async getPullRequestDiff(ref: PullRequestRef): Promise<string> {
    const response = await this.fetchImpl(
      `${GITHUB_API}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/pulls/${ref.number}`,
      { headers: this.headers("application/vnd.github.v3.diff") }
    );
    if (!response.ok) {
      throw new ReviewPilotError("GITHUB_API_ERROR", `GitHub returned ${response.status} while fetching the PR diff.`);
    }
    return response.text();
  }

  async upsertPullRequestComment(
    ref: PullRequestRef,
    body: string,
    marker: string
  ): Promise<PullRequestCommentResult> {
    if (!this.token) {
      throw new ReviewPilotError(
        "MISSING_GITHUB_TOKEN",
        "GITHUB_TOKEN is required to post a pull request comment."
      );
    }
    if (!body.includes(marker)) {
      throw new ReviewPilotError("MISSING_COMMENT_MARKER", "The ReviewPilot comment body must contain its duplicate-prevention marker.");
    }

    // GITHUB_TOKEN is a GitHub App installation token. It can post comments as
    // github-actions[bot], but it cannot access the user-only `/user` endpoint.
    const commentAuthor = process.env.GITHUB_ACTIONS === "true"
      ? "github-actions[bot]"
      : (await this.request<GitHubUserResponse>(`${GITHUB_API}/user`)).login;
    let existing: GitHubIssueCommentResponse | undefined;
    for (let page = 1; page <= 30 && !existing; page += 1) {
      const comments = await this.request<GitHubIssueCommentResponse[]>(
        `${GITHUB_API}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/issues/${ref.number}/comments?per_page=100&page=${page}`
      );
      existing = comments.find((comment) =>
        comment.user?.login.toLowerCase() === commentAuthor.toLowerCase() && comment.body?.includes(marker)
      );
      if (comments.length < 100) break;
    }

    const endpoint = existing
      ? `${GITHUB_API}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/issues/comments/${existing.id}`
      : `${GITHUB_API}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/issues/${ref.number}/comments`;
    const comment = await this.request<GitHubIssueCommentResponse>(endpoint, {
      method: existing ? "PATCH" : "POST",
      body: JSON.stringify({ body })
    });
    return { action: existing ? "updated" : "created", url: comment.html_url };
  }
}
