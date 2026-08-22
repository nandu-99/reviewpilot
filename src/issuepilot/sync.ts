import { ReviewPilotError } from "../errors.js";
import { extractClosingIssueReferences } from "../github.js";
import type {
  IssuePilotConfig,
  IssuePilotPlan,
  IssuePilotRepository,
  IssuePilotSyncResult,
  ManagedIssue,
  RepositoryPullRequest,
  TaskProgress
} from "./types.js";

export const ISSUEPILOT_TASK_MARKER_PREFIX = "<!-- issuepilot-task-id:";

function taskMarker(taskId: string): string {
  return `${ISSUEPILOT_TASK_MARKER_PREFIX} ${taskId} -->`;
}

function issueTaskId(issue: ManagedIssue): string | undefined {
  const match = /<!--\s*issuepilot-task-id:\s*([a-z0-9]+(?:-[a-z0-9]+)*)\s*-->/i.exec(issue.body);
  return match?.[1]?.toLowerCase();
}

function closingPullRequests(
  pulls: RepositoryPullRequest[],
  config: IssuePilotConfig
): Map<number, RepositoryPullRequest[]> {
  const [owner, repo] = config.repository.split("/") as [string, string];
  const result = new Map<number, RepositoryPullRequest[]>();
  for (const pull of pulls) {
    for (const reference of extractClosingIssueReferences(pull.body, { owner, repo })) {
      if (reference.owner.toLowerCase() !== owner.toLowerCase() || reference.repo.toLowerCase() !== repo.toLowerCase()) continue;
      const existing = result.get(reference.number) ?? [];
      existing.push(pull);
      result.set(reference.number, existing);
    }
  }
  return result;
}

export function evaluateTaskProgress(
  config: IssuePilotConfig,
  plan: IssuePilotPlan,
  issues: ManagedIssue[],
  pulls: RepositoryPullRequest[]
): TaskProgress[] {
  const byNumber = new Map(issues.map((issue) => [issue.number, issue]));
  const byTaskId = new Map<string, ManagedIssue>();
  for (const issue of issues) {
    const id = issueTaskId(issue);
    if (!id) continue;
    if (byTaskId.has(id)) throw new ReviewPilotError("DUPLICATE_MANAGED_ISSUE", `Multiple GitHub issues use IssuePilot task ID ${id}.`);
    byTaskId.set(id, issue);
  }
  const pullMap = closingPullRequests(pulls, config);
  const issueByTask = new Map<string, ManagedIssue>();
  const taskByIssue = new Map<number, string>();
  for (const task of plan.tasks) {
    const issue = task.existingIssueNumber ? byNumber.get(task.existingIssueNumber) : byTaskId.get(task.id.toLowerCase());
    if (!issue) continue;
    const markerId = issueTaskId(issue);
    if (task.existingIssueNumber && markerId && markerId !== task.id.toLowerCase()) {
      throw new ReviewPilotError("TASK_ISSUE_MARKER_MISMATCH", `Task ${task.id} maps to issue #${issue.number}, whose marker belongs to ${markerId}.`);
    }
    const existingTask = taskByIssue.get(issue.number);
    if (existingTask) throw new ReviewPilotError("DUPLICATE_TASK_ISSUE", `Tasks ${existingTask} and ${task.id} map to issue #${issue.number}.`);
    taskByIssue.set(issue.number, task.id);
    issueByTask.set(task.id, issue);
  }

  return plan.tasks.map((task) => {
    if (task.baselineCompleted) {
      return { task, state: "completed", reason: task.completionEvidence ?? "Marked complete in the approved baseline plan." };
    }
    const issue = issueByTask.get(task.id);
    if (!issue) return { task, state: "planned", reason: "No managed GitHub issue has been created." };

    const linkedPulls = pullMap.get(issue.number) ?? [];
    const mergedPull = linkedPulls.find((pull) => pull.merged);
    if (mergedPull) return { task, issue, state: "completed", reason: `Linked PR #${mergedPull.number} was merged.` };

    const manualCompletion = issue.state === "closed" && issue.labels.some(
      (label) => label.toLowerCase() === config.manualCompletionLabel.toLowerCase()
    );
    if (manualCompletion) return { task, issue, state: "completed", reason: `Issue #${issue.number} was closed with ${config.manualCompletionLabel}.` };
    if (issue.state === "closed") return { task, issue, state: "cancelled", reason: `Issue #${issue.number} was closed without completion evidence.` };

    const openPull = linkedPulls.find((pull) => pull.state === "open");
    return {
      task,
      issue,
      state: "in_progress",
      reason: openPull ? `Linked PR #${openPull.number} is open.` : `Issue #${issue.number} is open.`
    };
  });
}

function issueBody(description: string, taskId: string): string {
  return `${description.trim()}\n\n${taskMarker(taskId)}`;
}

export type IssueDescriptionGenerator = (
  task: IssuePilotPlan["tasks"][number],
  progress: TaskProgress[]
) => Promise<string>;

export async function syncIssuePilot(
  config: IssuePilotConfig,
  plan: IssuePilotPlan,
  repository: IssuePilotRepository,
  apply: boolean,
  generateDescription?: IssueDescriptionGenerator
): Promise<IssuePilotSyncResult> {
  const [issues, pulls] = await Promise.all([repository.listIssues(), repository.listPullRequests()]);
  const progress = evaluateTaskProgress(config, plan, issues, pulls);
  const progressById = new Map(progress.map((item) => [item.task.id, item]));
  const created: IssuePilotSyncResult["created"] = [];
  const wouldCreate: IssuePilotSyncResult["wouldCreate"] = [];
  const assignedThisRun = new Set<string>();

  if (apply) {
    await repository.ensureLabel(config.managedLabel, "1d76db", "Task managed by IssuePilot");
    await repository.ensureLabel(config.manualCompletionLabel, "0e8a16", "Closed task accepted as complete without a merged PR");
  }

  for (const item of progress) {
    if (item.state !== "planned") continue;
    const assignee = item.task.assignee.toLowerCase();
    if (assignedThisRun.has(assignee)) {
      item.state = "blocked";
      item.reason = "Another task for this assignee is being released in this synchronization run.";
      continue;
    }

    const earlierForAssignee = progress.slice(0, progress.indexOf(item)).filter(
      (candidate) => candidate.task.assignee.toLowerCase() === assignee
    );
    if (earlierForAssignee.some((candidate) => candidate.state !== "completed")) {
      item.state = "blocked";
      item.reason = "An earlier task for this assignee is not complete.";
      continue;
    }

    const dependencies = item.task.dependencies.map((id) => progressById.get(id));
    if (dependencies.some((dependency) => dependency?.state !== "completed")) {
      item.state = "blocked";
      item.reason = "One or more task dependencies are not complete.";
      continue;
    }

    item.state = "ready";
    item.reason = apply ? "All gates passed; creating the issue." : "All gates passed; the issue would be created.";
    assignedThisRun.add(assignee);
    if (!apply) {
      wouldCreate.push({ taskId: item.task.id, assignee: item.task.assignee, title: item.task.title });
      continue;
    }

    if (!generateDescription) {
      throw new ReviewPilotError(
        "MISSING_ISSUE_DESCRIPTION_GENERATOR",
        "An AI description generator is required when creating IssuePilot issues."
      );
    }
    const description = await generateDescription(item.task, progress);
    const result = await repository.createIssue({
      title: item.task.title,
      body: issueBody(description, item.task.id),
      assignees: [item.task.assignee],
      labels: [config.managedLabel]
    });
    created.push({ taskId: item.task.id, ...result });
  }

  return { progress, created, wouldCreate };
}
