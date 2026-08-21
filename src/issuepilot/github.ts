import { ReviewPilotError } from "../errors.js";
import type {
  IssueCreationInput,
  IssueCreationResult,
  IssuePilotRepository,
  ManagedIssue,
  RepositoryPullRequest
} from "./types.js";

const GITHUB_API = "https://api.github.com";

interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  html_url: string;
  assignees?: Array<{ login: string }>;
  labels?: Array<string | { name?: string | null }>;
  pull_request?: unknown;
}

interface GitHubPull {
  number: number;
  body: string | null;
  state: "open" | "closed";
  merged_at: string | null;
  html_url: string;
}

export class GitHubIssuePilotRepository implements IssuePilotRepository {
  private readonly owner: string;
  private readonly repo: string;

  constructor(repository: string, private readonly token: string, private readonly fetchImpl: typeof fetch = fetch) {
    [this.owner, this.repo] = repository.split("/") as [string, string];
  }

  private headers(): Record<string, string> {
    return {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${this.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "ReviewPilot/1.1"
    };
  }

  private repoUrl(path: string): string {
    return `${GITHUB_API}/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}${path}`;
  }

  private async request<T>(url: string, init: RequestInit = {}, allowed = new Set<number>()): Promise<T | undefined> {
    const response = await this.fetchImpl(url, {
      ...init,
      headers: { ...this.headers(), ...(init.body ? { "Content-Type": "application/json" } : {}) }
    });
    if (allowed.has(response.status)) return undefined;
    if (!response.ok) {
      const detail = await response.text();
      throw new ReviewPilotError("GITHUB_API_ERROR", `GitHub returned ${response.status} for ${url}. ${detail.slice(0, 500)}`);
    }
    return response.json() as Promise<T>;
  }

  async listIssues(): Promise<ManagedIssue[]> {
    const result: ManagedIssue[] = [];
    for (let page = 1; page <= 30; page += 1) {
      const data = await this.request<GitHubIssue[]>(this.repoUrl(`/issues?state=all&per_page=100&page=${page}`)) ?? [];
      result.push(...data.filter((issue) => !issue.pull_request).map((issue) => ({
        number: issue.number,
        title: issue.title,
        body: issue.body ?? "",
        state: issue.state,
        assignees: (issue.assignees ?? []).map((assignee) => assignee.login),
        labels: (issue.labels ?? []).map((label) => typeof label === "string" ? label : label.name ?? "").filter(Boolean),
        url: issue.html_url
      })));
      if (data.length < 100) break;
    }
    return result;
  }

  async listPullRequests(): Promise<RepositoryPullRequest[]> {
    const result: RepositoryPullRequest[] = [];
    for (let page = 1; page <= 30; page += 1) {
      const data = await this.request<GitHubPull[]>(this.repoUrl(`/pulls?state=all&per_page=100&page=${page}`)) ?? [];
      result.push(...data.map((pull) => ({
        number: pull.number,
        body: pull.body ?? "",
        state: pull.state,
        merged: pull.merged_at !== null,
        url: pull.html_url
      })));
      if (data.length < 100) break;
    }
    return result;
  }

  async ensureLabel(name: string, color: string, description: string): Promise<void> {
    const endpoint = this.repoUrl(`/labels/${encodeURIComponent(name)}`);
    const existing = await this.request<unknown>(endpoint, {}, new Set([404]));
    if (existing) return;
    await this.request(this.repoUrl("/labels"), {
      method: "POST",
      body: JSON.stringify({ name, color, description })
    });
  }

  async createIssue(input: IssueCreationInput): Promise<IssueCreationResult> {
    const issue = await this.request<GitHubIssue>(this.repoUrl("/issues"), {
      method: "POST",
      body: JSON.stringify(input)
    });
    if (!issue) throw new ReviewPilotError("GITHUB_API_ERROR", "GitHub did not return the created issue.");
    return { number: issue.number, url: issue.html_url };
  }
}
