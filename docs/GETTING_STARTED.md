# Getting Started

This guide shows you how to add ReviewPilot and IssuePilot to a GitHub repository and test the complete workflow.

ReviewPilot reviews pull requests. IssuePilot reads an approved project plan and creates the next task only when its dependencies and the assignee's earlier work are complete. Both run in GitHub Actions, so you do not need to deploy a server.

## Before you start

You need:

- a GitHub repository with Actions enabled;
- permission to add repository files, Actions secrets, and workflows;
- a Gemini API key, an OpenRouter API key, or both; and
- the GitHub usernames of the people who will receive IssuePilot tasks.

The examples below use Gemini. GitHub automatically provides the workflow `GITHUB_TOKEN`, so you do not need to create a personal access token.

## 1. Add the AI API key

In the target repository, open **Settings -> Secrets and variables -> Actions -> New repository secret**.

Create this secret:

```text
Name: GEMINI_API_KEY
Value: your Gemini API key
```

To use OpenRouter instead, create `OPENROUTER_API_KEY` and set `provider: openrouter` in the relevant action step.

Never commit an API key to the repository.

## 2. Install ReviewPilot

Create `.github/workflows/reviewpilot.yml`:

```yaml
name: ReviewPilot

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
  workflow_dispatch:
    inputs:
      pr_url:
        description: Existing pull request URL to review manually
        required: true
        type: string

permissions:
  contents: read
  issues: read
  pull-requests: write

concurrency:
  group: reviewpilot-${{ github.event.pull_request.number || github.run_id }}
  cancel-in-progress: true

jobs:
  review:
    if: >-
      github.event_name == 'workflow_dispatch' ||
      (github.event.pull_request.draft == false &&
      github.event.pull_request.head.repo.full_name == github.repository)
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - name: Review pull request
        uses: nandu-99/reviewpilot@v1
        with:
          pr-url: ${{ github.event.pull_request.html_url || inputs.pr_url }}
          github-token: ${{ github.token }}
          gemini-api-key: ${{ secrets.GEMINI_API_KEY }}
```

ReviewPilot now runs when a same-repository pull request is opened, reopened, marked ready, or updated with a new commit. Fork pull requests are skipped because they cannot safely access repository secrets.

Linked issues are optional. To let ReviewPilot check requirements, use a closing reference in the pull-request description:

```text
Closes #42
```

ReviewPilot creates one marked PR comment and updates that comment after later commits instead of creating duplicates.

## 3. Configure IssuePilot

IssuePilot needs four files in the target repository:

```text
PROJECT_CONTEXT.md
ISSUE_FORMAT.md
.issuepilot/config.yml
.issuepilot/plan.yml
```

### Project context

Create `PROJECT_CONTEXT.md`. Describe:

- what the project does;
- the technology stack;
- important folders and existing features;
- coding and development rules;
- commands used to run and test the project; and
- the features expected when the project is complete.

IssuePilot uses this document when it writes a task description.

### Issue format

Create `ISSUE_FORMAT.md`:

```markdown
# Task title

## Objective

Explain what must be implemented.

## Background

Explain why the task is required.

## Dependencies

List work that must be completed first.

## Requirements

Provide clear implementation requirements.

## Technical Guidance

Mention likely files, commands, and useful implementation details.

## Deliverables

List the expected code, tests, and documentation.

## Out of Scope

Explain what should not be changed.
```

This is guidance for the generated description. IssuePilot adds its own hidden task marker for duplicate prevention.

### IssuePilot configuration

Create `.issuepilot/config.yml`:

```yaml
repository: OWNER/REPOSITORY
projectDocument: PROJECT_CONTEXT.md
issueTemplate: ISSUE_FORMAT.md
managedLabel: issuepilot
manualCompletionLabel: completed-manually

team:
  - github: GITHUB_USERNAME
    role: developer
```

Replace `OWNER/REPOSITORY` and `GITHUB_USERNAME` with real values. Every GitHub username must identify a repository collaborator who can be assigned issues.

Roles can be names such as `backend`, `frontend`, `testing`, or `developer`. A person's role must match the role used for that person's tasks in the plan.

### Approved task plan

Create `.issuepilot/plan.yml`:

```yaml
version: 3
project: Example Project
repository: OWNER/REPOSITORY

tasks:
  - id: create-user-api
    title: Create the user API
    role: developer
    assignee: GITHUB_USERNAME
    summary: Create an API that returns user information with validation and automated tests.
    dependencies: []

  - id: create-user-page
    title: Create the user profile page
    role: developer
    assignee: GITHUB_USERNAME
    summary: Create a profile page that displays information returned by the user API.
    dependencies:
      - create-user-api
```

Plan rules:

- `version` must be `3`.
- `repository` must match `.issuepilot/config.yml`.
- Every `id` must be unique, lowercase, and hyphen-separated.
- Every assignee and role must match a member in the configuration.
- Every dependency must refer to another task ID.
- Dependencies cannot contain cycles.
- Tasks for the same person are released in plan order.

Review the plan before committing it. IssuePilot follows the plan but does not decide the project's scope.

## 4. Install the IssuePilot workflow

Create `.github/workflows/issuepilot-sync.yml`:

```yaml
name: Synchronize IssuePilot Tasks

on:
  pull_request:
    types: [closed]
  issues:
    types: [closed, labeled]
  workflow_dispatch:

permissions:
  contents: read
  issues: write
  pull-requests: read

concurrency:
  group: issuepilot-sync-${{ github.repository }}
  cancel-in-progress: false

jobs:
  sync:
    if: >-
      github.event_name == 'workflow_dispatch' ||
      github.event_name == 'issues' ||
      github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    timeout-minutes: 20

    steps:
      - name: Check out the approved default branch
        uses: actions/checkout@v4
        with:
          ref: ${{ github.event.repository.default_branch }}

      - name: Create the next eligible issues
        uses: nandu-99/reviewpilot/issuepilot@v1
        with:
          github-token: ${{ github.token }}
          gemini-api-key: ${{ secrets.GEMINI_API_KEY }}
```

Commit and push all setup files to the repository's default branch.

## 5. Create the first task

Open **Actions -> Synchronize IssuePilot Tasks -> Run workflow**.

IssuePilot reads the approved plan and creates the first eligible issue. It creates at most one new task per assignee during a synchronization run. Later work remains blocked until its dependencies and that assignee's previous task are complete.

## 6. Test the complete workflow

Use this flow for a normal task:

1. Open the issue created by IssuePilot.
2. Implement the work on a new branch.
3. Open a pull request from that branch.
4. Add `Closes #ISSUE_NUMBER` to the PR description.
5. Wait for the ReviewPilot workflow.
6. Read the marked ReviewPilot comment.
7. If it reports a valid problem, fix it and push another commit.
8. Confirm that ReviewPilot updates the existing comment.
9. Merge the pull request after human approval.
10. GitHub closes the linked issue.
11. IssuePilot runs automatically and creates the next eligible task.

ReviewPilot does not approve or merge pull requests. A developer remains responsible for deciding whether to merge.

## 7. Understand task completion

IssuePilot recognizes three outcomes:

### Completed through a pull request

The task is complete when a merged PR contains a closing reference such as `Closes #12`. Dependent tasks may then be released.

### Completed manually

If the work was completed without a pull request:

1. Add the configured `completed-manually` label to the open issue.
2. Close the issue.

The label must be added before the issue is closed. Dependent tasks may then be released.

### Cancelled

Closing an issue without a merged closing PR or the manual-completion label marks its task as cancelled. Cancellation does not unlock dependent tasks.
It does allow the assignee's next independent task to be created.

## 8. Verify the installation

Confirm all of the following:

- Both workflows appear on the repository's Actions page.
- A same-repository PR receives one ReviewPilot comment.
- Pushing another commit updates that comment instead of adding a duplicate.
- A PR containing `Closes #N` is checked against that issue's requirements.
- A manual IssuePilot run creates only eligible work.
- Merging a closing PR completes its task and triggers IssuePilot.
- A manually completed issue unlocks dependent work.
- A cancelled issue releases assignee capacity but does not unlock dependent work.
- IssuePilot does not create duplicate managed issues.

## Common problems

### The workflow cannot comment or create issues

Check the workflow `permissions` blocks. Also open **Settings -> Actions -> General -> Workflow permissions** and ensure workflows are allowed to use the required repository permissions.

### The AI request fails

Confirm that the API-key secret has the correct name and a valid value. Free models can also fail because of quota or temporary rate limits. Run the workflow again later or configure the other provider.

### IssuePilot rejects the configuration or plan

Check that repository names, usernames, and roles match exactly. Also check that task IDs are valid, dependencies exist, and the plan uses `version: 3`.

### IssuePilot does not create the next task

Read the synchronization log on the Actions page. It explains whether a dependency is incomplete, an assignee already has active work, an earlier task was cancelled, or another task is being released in the same run.

For more solutions, see [Troubleshooting](../TROUBLESHOOTING.md).

## Updating the actions

The examples use the moving major-version tag:

```yaml
uses: nandu-99/reviewpilot@v1
uses: nandu-99/reviewpilot/issuepilot@v1
```

This receives compatible version 1 updates. Use a specific release tag or full commit SHA if your repository requires an immutable action reference.
