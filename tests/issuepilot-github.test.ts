import { describe, expect, it, vi } from "vitest";
import { GitHubIssuePilotRepository } from "../src/issuepilot/github.js";

describe("GitHubIssuePilotRepository", () => {
  it("reads repository progress and filters pull requests from the issues endpoint", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      if (value.includes("/issues?")) {
        return new Response(JSON.stringify([
          {
            number: 1,
            title: "Task",
            body: "Body",
            state: "open",
            html_url: "https://github.com/acme/platform/issues/1",
            assignees: [{ login: "dev" }],
            labels: [{ name: "issuepilot" }]
          },
          {
            number: 2,
            title: "PR",
            body: "",
            state: "open",
            html_url: "https://github.com/acme/platform/pull/2",
            pull_request: {}
          }
        ]));
      }
      return new Response(JSON.stringify([
        {
          number: 2,
          body: "Closes #1",
          state: "closed",
          merged_at: "2026-08-21T00:00:00Z",
          html_url: "https://github.com/acme/platform/pull/2"
        }
      ]));
    });
    const repository = new GitHubIssuePilotRepository("acme/platform", "token", fetchMock as typeof fetch);

    await expect(repository.listIssues()).resolves.toEqual([
      expect.objectContaining({ number: 1, assignees: ["dev"], labels: ["issuepilot"] })
    ]);
    await expect(repository.listPullRequests()).resolves.toEqual([
      expect.objectContaining({ number: 2, merged: true })
    ]);
  });

  it("creates missing labels and assigned issues", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url);
      if (value.endsWith("/labels/issuepilot")) return new Response("not found", { status: 404 });
      if (value.endsWith("/labels")) {
        expect(init?.method).toBe("POST");
        return new Response(JSON.stringify({ name: "issuepilot" }), { status: 201 });
      }
      expect(value).toMatch(/\/issues$/);
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toMatchObject({ assignees: ["dev"], labels: ["issuepilot"] });
      return new Response(JSON.stringify({
        number: 7,
        title: "Task",
        body: "Body",
        state: "open",
        html_url: "https://github.com/acme/platform/issues/7"
      }), { status: 201 });
    });
    const repository = new GitHubIssuePilotRepository("acme/platform", "token", fetchMock as typeof fetch);

    await repository.ensureLabel("issuepilot", "123456", "Managed");
    await expect(repository.createIssue({
      title: "Task",
      body: "Body",
      assignees: ["dev"],
      labels: ["issuepilot"]
    })).resolves.toEqual({ number: 7, url: "https://github.com/acme/platform/issues/7" });
  });
});
