export interface IssuePilotTeamMember {
  github: string;
  role: string;
}

export interface IssuePilotConfig {
  repository: string;
  projectDocument: string;
  issueTemplate: string;
  managedLabel: string;
  manualCompletionLabel: string;
  team: IssuePilotTeamMember[];
}

export interface PlannedIssue {
  id: string;
  title: string;
  role: string;
  assignee: string;
  summary: string;
  dependencies: string[];
  existingIssueNumber?: number | undefined;
  baselineCompleted?: boolean | undefined;
  completionEvidence?: string | undefined;
}

export interface IssuePilotPlan {
  version: 2;
  project: string;
  repository: string;
  generatedAt: string;
  tasks: PlannedIssue[];
}

export interface ManagedIssue {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  assignees: string[];
  labels: string[];
  url: string;
}

export interface RepositoryPullRequest {
  number: number;
  body: string;
  state: "open" | "closed";
  merged: boolean;
  url: string;
}

export type TaskState = "planned" | "ready" | "in_progress" | "completed" | "cancelled" | "blocked";

export interface TaskProgress {
  task: PlannedIssue;
  state: TaskState;
  issue?: ManagedIssue;
  reason: string;
}

export interface IssueCreationInput {
  title: string;
  body: string;
  assignees: string[];
  labels: string[];
}

export interface IssueCreationResult {
  number: number;
  url: string;
}

export interface IssuePilotSyncResult {
  progress: TaskProgress[];
  created: Array<{ taskId: string; number: number; url: string }>;
  wouldCreate: Array<{ taskId: string; assignee: string; title: string }>;
}

export interface IssuePilotRepository {
  listIssues(): Promise<ManagedIssue[]>;
  listPullRequests(): Promise<RepositoryPullRequest[]>;
  ensureLabel(name: string, color: string, description: string): Promise<void>;
  createIssue(input: IssueCreationInput): Promise<IssueCreationResult>;
}
