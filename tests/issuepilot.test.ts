import { describe, expect, it, vi } from "vitest";
import { generateIssueDescription } from "../src/issuepilot/generator.js";
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
  summary: `Implement the complete ${id} behavior with focused automated tests.`,
  dependencies
});

const plan: IssuePilotPlan = {
  version: 3,
  project: "Platform",
  repository: "acme/platform",
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

describe("IssuePilot issue description generation", () => {
  it("generates a just-in-time issue description from the approved task and template", async () => {
    const generate = vi.fn(async () => ({
      description: "## Objective\n\nImplement the approved backend task with focused validation and automated tests.\n\n## Dependencies\n\n- Depends on #10\n\n## Out of Scope\n\nNo unrelated changes."
    }));

    const description = await generateIssueDescription({
      projectDocument: "Use Express and preserve existing routes.",
      issueTemplate: "## Objective\n\n## Dependencies\n\n## Requirements",
      task: plan.tasks[2]!,
      progress: [
        {
          task: plan.tasks[0]!,
          state: "completed",
          issue: managedIssue(10, "backend-1", "closed"),
          reason: "Linked PR #20 was merged."
        }
      ],
      client: { generate },
      model: "test-model",
      retryDelayMilliseconds: 0
    });

    expect(description).toContain("Depends on #10");
    expect(generate).toHaveBeenCalledWith(
      "test-model",
      expect.stringContaining('"issueNumber":10'),
      expect.any(Object)
    );
  });

  it("retries when a description adds headings omitted by the repository template", async () => {
    const invalid = `${"## Objective\n\nImplement the approved task safely.\n\n"}## Acceptance Criteria\n\n- It works correctly.`;
    const valid = "## Objective\n\nImplement the approved task safely with focused tests and clear error handling.\n\n## Deliverables\n\n- Focused implementation and tests.\n\n## Out of Scope\n\nNo unrelated work.";
    const generate = vi.fn()
      .mockResolvedValueOnce({ description: invalid })
      .mockResolvedValueOnce({ description: valid });

    const description = await generateIssueDescription({
      projectDocument: "Build the approved feature.",
      issueTemplate: "## Objective\n\n## Deliverables\n\n## Out of Scope",
      task: plan.tasks[0]!,
      progress: [],
      client: { generate },
      model: "test-model",
      retryDelayMilliseconds: 0
    });

    expect(description).toBe(valid);
    expect(generate).toHaveBeenCalledTimes(2);
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
    const generateDescription = vi.fn(async () =>
      "## Objective\n\nImplement backend-2.\n\n## Dependencies\n\n- Depends on #10"
    );
    const result = await syncIssuePilot(config, plan, repository, true, generateDescription);

    expect(result.created.map((item) => item.taskId)).toContain("backend-2");
    expect(repository.created.find((item) => item.title === "Implement backend-2")?.body).toContain("Depends on #10");
    expect(repository.created.find((item) => item.title === "Implement backend-2")?.body).toContain("issuepilot-task-id: backend-2");
    expect(generateDescription).toHaveBeenCalledTimes(2);
    expect(repository.labels).toEqual(["issuepilot", "completed-manually"]);
  });

  it("does not request issue descriptions during a dry run", async () => {
    const repository = new MemoryRepository();
    const generateDescription = vi.fn();

    await syncIssuePilot(config, plan, repository, false, generateDescription);

    expect(generateDescription).not.toHaveBeenCalled();
  });

  it("does not release an earlier planned task when a later task is already active for the assignee", async () => {
    const laterActivePlan: IssuePilotPlan = {
      version: 3,
      project: "Platform",
      repository: "acme/platform",
      tasks: [
        task("backend-planned", "backend-dev", "backend"),
        {
          ...task("backend-existing", "backend-dev", "backend"),
          existingIssueNumber: 42
        }
      ]
    };
    const existing = managedIssue(42, "backend-existing");
    const repository = new MemoryRepository([existing]);

    const result = await syncIssuePilot(config, laterActivePlan, repository, false);

    expect(result.wouldCreate).toHaveLength(0);
    expect(result.progress[0]).toMatchObject({
      state: "blocked",
      reason: "Task backend-existing is already in progress for this assignee."
    });
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
