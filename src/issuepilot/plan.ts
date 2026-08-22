import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { ReviewPilotError } from "../errors.js";
import type { IssuePilotConfig, IssuePilotPlan } from "./types.js";

export const plannedIssueSchema = z.object({
  id: z.string().trim().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().trim().min(1).max(180),
  role: z.string().trim().min(1).max(60),
  assignee: z.string().trim().min(1).max(39),
  summary: z.string().trim().min(20).max(1000),
  dependencies: z.array(z.string().trim().min(1)).default([]),
  existingIssueNumber: z.number().int().positive().optional(),
  baselineCompleted: z.boolean().optional(),
  completionEvidence: z.string().trim().min(1).max(500).optional()
});

export const issuePilotPlanSchema = z.object({
  version: z.literal(2),
  project: z.string().trim().min(1).max(200),
  repository: z.string().trim().regex(/^[^/\s]+\/[^/\s]+$/),
  generatedAt: z.string().datetime(),
  tasks: z.array(plannedIssueSchema).min(1).max(200)
});

export function validateIssuePilotPlan(value: unknown, config: IssuePilotConfig): IssuePilotPlan {
  const plan = issuePilotPlanSchema.parse(value);
  if (plan.repository.toLowerCase() !== config.repository.toLowerCase()) {
    throw new ReviewPilotError("PLAN_REPOSITORY_MISMATCH", `Plan repository ${plan.repository} does not match ${config.repository}.`);
  }

  const members = new Map(config.team.map((member) => [member.github.toLowerCase(), member.role.toLowerCase()]));
  const ids = new Set<string>();
  const existingIssueNumbers = new Set<number>();
  for (const task of plan.tasks) {
    if (ids.has(task.id)) throw new ReviewPilotError("DUPLICATE_TASK_ID", `Task ID ${task.id} appears more than once.`);
    ids.add(task.id);
    const role = members.get(task.assignee.toLowerCase());
    if (!role) throw new ReviewPilotError("UNKNOWN_TASK_ASSIGNEE", `Task ${task.id} uses unknown assignee ${task.assignee}.`);
    if (role !== task.role.toLowerCase()) {
      throw new ReviewPilotError("TASK_ROLE_MISMATCH", `Task ${task.id} role ${task.role} does not match ${task.assignee}'s role ${role}.`);
    }
    if (task.existingIssueNumber !== undefined) {
      if (existingIssueNumbers.has(task.existingIssueNumber)) {
        throw new ReviewPilotError("DUPLICATE_EXISTING_ISSUE", `GitHub issue #${task.existingIssueNumber} is mapped to multiple tasks.`);
      }
      existingIssueNumbers.add(task.existingIssueNumber);
    }
  }

  for (const task of plan.tasks) {
    for (const dependency of task.dependencies) {
      if (!ids.has(dependency)) throw new ReviewPilotError("UNKNOWN_TASK_DEPENDENCY", `Task ${task.id} depends on unknown task ${dependency}.`);
      if (dependency === task.id) throw new ReviewPilotError("SELF_TASK_DEPENDENCY", `Task ${task.id} cannot depend on itself.`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(plan.tasks.map((task) => [task.id, task]));
  const previousByTask = new Map<string, string>();
  const lastByAssignee = new Map<string, string>();
  for (const task of plan.tasks) {
    const assignee = task.assignee.toLowerCase();
    const previous = lastByAssignee.get(assignee);
    if (previous) previousByTask.set(task.id, previous);
    lastByAssignee.set(assignee, task.id);
  }
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new ReviewPilotError("CYCLIC_TASK_DEPENDENCY", `Task dependency cycle includes ${id}.`);
    if (visited.has(id)) return;
    visiting.add(id);
    const dependencies = [...(byId.get(id)?.dependencies ?? [])];
    const previous = previousByTask.get(id);
    if (previous) dependencies.push(previous);
    for (const dependency of dependencies) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of plan.tasks) visit(task.id);

  return plan;
}

export async function loadIssuePilotPlan(cwd: string, config: IssuePilotConfig, planPath = ".issuepilot/plan.yml"): Promise<IssuePilotPlan> {
  const resolved = path.resolve(cwd, planPath);
  try {
    return validateIssuePilotPlan(YAML.parse(await readFile(resolved, "utf8")) as unknown, config);
  } catch (error) {
    if (error instanceof ReviewPilotError) throw error;
    throw new ReviewPilotError("INVALID_ISSUEPILOT_PLAN", `Could not load IssuePilot plan at ${resolved}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function writeIssuePilotPlan(cwd: string, plan: IssuePilotPlan, planPath = ".issuepilot/plan.yml"): Promise<string> {
  const resolved = path.resolve(cwd, planPath);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, YAML.stringify(plan), "utf8");
  return resolved;
}
