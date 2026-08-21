import { describe, expect, it, vi } from "vitest";
import { extractClosingIssueReferences, GitHubClient, parseIssueReference, parsePullRequestUrl } from "../src/github.js";

describe("parsePullRequestUrl", () => {
  it("parses canonical GitHub PR URLs", () => {
    expect(parsePullRequestUrl("https://github.com/acme/shop/pull/142/files")).toEqual({
      owner: "acme",
      repo: "shop",
      number: 142,
      url: "https://github.com/acme/shop/pull/142"
    });
  });

  it("rejects non-PR and non-GitHub URLs", () => {
    expect(() => parsePullRequestUrl("https://gitlab.com/acme/shop/pull/1")).toThrow(/github.com/);
    expect(() => parsePullRequestUrl("https://github.com/acme/shop/issues/1")).toThrow(/pull request URL/);
  });
});

describe("issue references", () => {
  const repository = { owner: "acme", repo: "shop" };

  it("parses local, qualified, and URL issue references", () => {
    expect(parseIssueReference("#12", repository)).toMatchObject({ owner: "acme", repo: "shop", number: 12 });
    expect(parseIssueReference("platform/api#9", repository)).toMatchObject({ owner: "platform", repo: "api", number: 9 });
    expect(parseIssueReference("https://github.com/other/web/issues/42", repository)).toMatchObject({ owner: "other", repo: "web", number: 42 });
  });

  it("extracts only references on closing-keyword lines and removes duplicates", () => {
    const body = "Related to #99\nCloses #12 and fixes acme/api#7\nResolves https://github.com/acme/web/issues/4\nFixes #12";
    expect(extractClosingIssueReferences(body, repository).map((issue) => `${issue.owner}/${issue.repo}#${issue.number}`)).toEqual([
      "acme/shop#12",
      "acme/api#7",
      "acme/web#4"
    ]);
  });
});

describe("GitHubClient", () => {
  it("maps PR metadata and authenticates without exposing the token in the URL", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).not.toContain("secret-token");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer secret-token");
      return new Response(JSON.stringify({
        title: "Fix auth",
        body: null,
        base: { sha: "base", ref: "main" },
        head: { sha: "head", ref: "fix" },
        user: { login: "dev" },
        draft: false,
        changed_files: 2
      }), { status: 200 });
    });
    const client = new GitHubClient("secret-token", fetchMock as typeof fetch);
    const result = await client.getPullRequest(parsePullRequestUrl("https://github.com/acme/shop/pull/12"));
    expect(result).toMatchObject({ title: "Fix auth", body: "", headSha: "head", changedFiles: 2 });
  });

  it("paginates changed files", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      filename: `src/${index}.ts`, status: "modified", additions: 1, deletions: 0, changes: 1
    }));
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const page = new URL(String(url)).searchParams.get("page");
      const data = page === "1" ? firstPage : [
        { filename: "src/final.ts", status: "added", additions: 2, deletions: 0, changes: 2 }
      ];
      return new Response(JSON.stringify(data), { status: 200 });
    });
    const client = new GitHubClient(undefined, fetchMock as typeof fetch);
    const files = await client.getPullRequestFiles(parsePullRequestUrl("https://github.com/acme/shop/pull/12"));
    expect(files).toHaveLength(101);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fetches issue requirements", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      title: "Implement refresh tokens",
      body: "## Acceptance criteria\n- Reject expired tokens",
      state: "open",
      user: { login: "lead" },
      assignees: [{ login: "backend-dev" }],
      labels: [{ name: "backend" }, "priority-high"],
      updated_at: "2026-08-21T00:00:00Z"
    }), { status: 200 }));
    const client = new GitHubClient("token", fetchMock as typeof fetch);
    const issue = await client.getIssue(parseIssueReference("12", { owner: "acme", repo: "shop" }));
    expect(issue).toMatchObject({
      number: 12,
      title: "Implement refresh tokens",
      assignees: ["backend-dev"],
      labels: ["backend", "priority-high"]
    });
  });

  it("creates a marked PR comment when no ReviewPilot comment exists", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url);
      if (value.endsWith("/user")) return new Response(JSON.stringify({ login: "reviewer" }));
      if (value.includes("/comments?")) return new Response(JSON.stringify([]));
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ body: "Review\n<!-- marker -->" });
      return new Response(JSON.stringify({ id: 7, body: "Review", html_url: "https://github.com/acme/shop/pull/12#issuecomment-7", user: { login: "reviewer" } }));
    });
    const client = new GitHubClient("token", fetchMock as typeof fetch);

    await expect(client.upsertPullRequestComment(
      parsePullRequestUrl("https://github.com/acme/shop/pull/12"),
      "Review\n<!-- marker -->",
      "<!-- marker -->"
    )).resolves.toEqual({ action: "created", url: "https://github.com/acme/shop/pull/12#issuecomment-7" });
  });

  it("updates only the token owner's existing marked comment", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url);
      if (value.endsWith("/user")) return new Response(JSON.stringify({ login: "reviewer" }));
      if (value.includes("/comments?")) {
        return new Response(JSON.stringify([
          { id: 6, body: "Copied <!-- marker -->", html_url: "other", user: { login: "someone-else" } },
          { id: 7, body: "Old <!-- marker -->", html_url: "old", user: { login: "reviewer" } }
        ]));
      }
      expect(value).toMatch(/\/issues\/comments\/7$/);
      expect(init?.method).toBe("PATCH");
      return new Response(JSON.stringify({ id: 7, body: "New", html_url: "https://github.com/acme/shop/pull/12#issuecomment-7", user: { login: "reviewer" } }));
    });
    const client = new GitHubClient("token", fetchMock as typeof fetch);

    await expect(client.upsertPullRequestComment(
      parsePullRequestUrl("https://github.com/acme/shop/pull/12"),
      "New <!-- marker -->",
      "<!-- marker -->"
    )).resolves.toEqual({ action: "updated", url: "https://github.com/acme/shop/pull/12#issuecomment-7" });
  });

  it("updates the Actions bot comment without calling the user-only endpoint", async () => {
    vi.stubEnv("GITHUB_ACTIONS", "true");
    try {
      const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const value = String(url);
        expect(value).not.toMatch(/\/user$/);
        if (value.includes("/comments?")) {
          return new Response(JSON.stringify([
            { id: 7, body: "Old <!-- marker -->", html_url: "old", user: { login: "github-actions[bot]" } }
          ]));
        }
        expect(value).toMatch(/\/issues\/comments\/7$/);
        expect(init?.method).toBe("PATCH");
        return new Response(JSON.stringify({
          id: 7,
          body: "New",
          html_url: "https://github.com/acme/shop/pull/12#issuecomment-7",
          user: { login: "github-actions[bot]" }
        }));
      });
      const client = new GitHubClient("actions-token", fetchMock as typeof fetch);

      await expect(client.upsertPullRequestComment(
        parsePullRequestUrl("https://github.com/acme/shop/pull/12"),
        "New <!-- marker -->",
        "<!-- marker -->"
      )).resolves.toEqual({ action: "updated", url: "https://github.com/acme/shop/pull/12#issuecomment-7" });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
