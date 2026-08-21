import { describe, expect, it, vi } from "vitest";
import { generateIssuePilotPlan, type IssuePlanModelClient } from "../src/issuepilot/generator.js";
import { validateIssuePilotPlan } from "../src/issuepilot/plan.js";
import { evaluateTaskProgress, syncIssuePilot } from "../src/issuepilot/sync.js";
import type {
  IssuePilotConfig,
  IssuePilotPlan,
  IssuePilotRepository,
  ManagedIssue,
  RepositoryPullRequest
} from "../src/issuepilot/types.js";

const config: IssuePilotConfig = {
  repository: "acme/platform",
  projectDocument: "PROJECT_CONTEXT.md",
  issueTemplate: "ISSUE_FORMAT.md",
  managedLabel: "issuepilot",
  manualCompletionLabel: "completed-manually",
  team: [
    { github: "backend-dev", role: "backend" },
    { github: "frontend-dev", role: "frontend" }
  ]
};

const task = (id: string, assignee: string, role: string, dependencies: string[] = []) => ({
  id,
  title: `Implement ${id}`,
  role,
  assignee,
  description: `## Objective\n\nImplement the complete ${id} behavior with focused tests.`,
  dependencies
});

const plan: IssuePilotPlan = {
  version: 1,
  project: "Platform",
  repository: "acme/platform",
  generatedAt: "2026-08-21T00:00:00.000Z",
  tasks: [
    task("backend-1", "backend-dev", "backend"),
    task("frontend-1", "frontend-dev", "frontend"),
    task("backend-2", "backend-dev", "backend", ["backend-1"]),
    task("frontend-2", "frontend-dev", "frontend", ["backend-2"])
  ]
};

class MemoryRepository implements IssuePilotRepository {
  labels: string[] = [];
  created: Array<{ title: string; body: string; assignees: string[]; labels: string[] }> = [];

  constructor(public issues: ManagedIssue[] = [], public pulls: RepositoryPullRequest[] = []) {}
  async listIssues() { return this.issues; }
  async listPullRequests() { return this.pulls; }
  async ensureLabel(name: string) { this.labels.push(name); }
  async createIssue(input: { title: string; body: string; assignees: string[]; labels: string[] }) {
    this.created.push(input);
    return { number: 100 + this.created.length, url: `https://github.com/acme/platform/issues/${100 + this.created.length}` };
  }
}

const managedIssue = (number: number, id: string, state: "open" | "closed" = "open", labels: string[] = []): ManagedIssue => ({
  number,
  title: id,
  body: `Task\n<!-- issuepilot-task-id: ${id} -->`,
  state,
  assignees: [],
  labels,
  url: `https://github.com/acme/platform/issues/${number}`
});

describe("IssuePilot plan validation", () => {
  it("accepts configured assignees and rejects dependency cycles", () => {
    expect(validateIssuePilotPlan(plan, config).tasks).toHaveLength(4);
    const cyclic = {
      ...plan,
      tasks: [
        task("one", "backend-dev", "backend", ["two"]),
        task("two", "backend-dev", "backend", ["one"])
      ]
    };
    expect(() => validateIssuePilotPlan(cyclic, config)).toThrow(/cycle/i);
  });

  it("rejects a dependency that deadlocks against one-developer sequencing", () => {
    const deadlocked = {
      ...plan,
      tasks: [
        task("one", "backend-dev", "backend", ["two"]),
        task("two", "backend-dev", "backend")
      ]
    };
    expect(() => validateIssuePilotPlan(deadlocked, config)).toThrow(/cycle/i);
  });
});

describe("IssuePilot plan generation", () => {
  it("redacts secrets and validates the generated team assignments", async () => {
    const generate = vi.fn(async () => ({
      project: "Platform",
      tasks: [task("backend-1", "backend-dev", "backend")]
    }));
    const client = { generate } as IssuePlanModelClient;
    const generated = await generateIssuePilotPlan({
      config,
      projectDocument: "Build an API. api_key=super-secret-value",
      issueTemplate: "## Objective\nDescribe the task.",
      issues: [],
      pullRequests: [],
      client,
      model: "test-model",
      now: new Date("2026-08-21T00:00:00.000Z")
    });

    expect(generated.generatedAt).toBe("2026-08-21T00:00:00.000Z");
    expect(generate).toHaveBeenCalledWith("test-model", expect.not.stringContaining("super-secret-value"));
    expect(generate).toHaveBeenCalledWith("test-model", expect.stringContaining("Produce at most 30 tasks"));
    expect(generate).toHaveBeenCalledWith("test-model", expect.stringContaining("below 2500 characters"));
  });

  it("retries a failed model response and validates the next result", async () => {
    const generate = vi
      .fn()
      .mockRejectedValueOnce(new Error("invalid JSON"))
      .mockResolvedValueOnce({
        project: "Platform",
        tasks: [task("backend-1", "backend-dev", "backend")]
      });
    const onRetry = vi.fn();

    const generated = await generateIssuePilotPlan({
      config,
      projectDocument: "Build an API.",
      issueTemplate: "## Objective\nDescribe the task.",
      issues: [],
      pullRequests: [],
      client: { generate },
      model: "test-model",
      retryDelayMilliseconds: 0,
      onRetry
    });

    expect(generated.tasks).toHaveLength(1);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1]?.[1]).toContain("previous response failed validation: invalid JSON");
    expect(onRetry).toHaveBeenCalledWith(2, 3, "invalid JSON");
  });

  it("fails clearly after exhausting all plan attempts", async () => {
    const generate = vi.fn().mockRejectedValue(new Error("operation aborted"));

    await expect(generateIssuePilotPlan({
      config,
      projectDocument: "Build an API.",
      issueTemplate: "## Objective\nDescribe the task.",
      issues: [],
      pullRequests: [],
      client: { generate },
      model: "test-model",
      maxAttempts: 3,
      retryDelayMilliseconds: 0
    })).rejects.toThrow(/after 3 attempts.*operation aborted/i);

    expect(generate).toHaveBeenCalledTimes(3);
  });
});

describe("IssuePilot synchronization", () => {
  it("makes only the first task for each developer ready in a dry run", async () => {
    const repository = new MemoryRepository();
    const result = await syncIssuePilot(config, plan, repository, false);

    expect(result.wouldCreate.map((item) => item.taskId)).toEqual(["backend-1", "frontend-1"]);
    expect(repository.created).toHaveLength(0);
    expect(result.progress.find((item) => item.task.id === "backend-2")?.state).toBe("blocked");
  });

  it("waits for a closing PR to merge before releasing the next developer task", async () => {
    const issue = managedIssue(10, "backend-1");
    const openPull: RepositoryPullRequest = {
      number: 20,
      body: "Closes #10",
      state: "open",
      merged: false,
      url: "https://github.com/acme/platform/pull/20"
    };
    expect(evaluateTaskProgress(config, plan, [issue], [openPull])[0]).toMatchObject({ state: "in_progress" });

    const repository = new MemoryRepository([issue], [{ ...openPull, state: "closed", merged: true }]);
    const result = await syncIssuePilot(config, plan, repository, true);

    expect(result.created.map((item) => item.taskId)).toContain("backend-2");
    expect(repository.created.find((item) => item.title === "Implement backend-2")?.body).toContain("Depends on #10");
    expect(repository.labels).toEqual(["issuepilot", "completed-manually"]);
  });

  it("accepts a closed issue only with the manual completion label", () => {
    const unverified = evaluateTaskProgress(config, plan, [managedIssue(10, "backend-1", "closed")], []);
    expect(unverified[0]).toMatchObject({ state: "cancelled" });

    const approved = evaluateTaskProgress(
      config,
      plan,
      [managedIssue(10, "backend-1", "closed", ["completed-manually"])],
      []
    );
    expect(approved[0]).toMatchObject({ state: "completed" });
  });
});
