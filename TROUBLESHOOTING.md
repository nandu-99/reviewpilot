# Troubleshooting

## GitHub action repository not found

```text
Unable to resolve action nandu-99/reviewpilot
```

Confirm that:

- the action repository is public, or the target repository is allowed to use private actions from it;
- the requested tag exists;
- the reference is spelled correctly; and
- IssuePilot uses the subdirectory form `nandu-99/reviewpilot/issuepilot@v1`.

## Dependency cache paths cannot be resolved

The composite actions disable package-manager caching because the lockfile lives in the action repository rather than the target repository. Use the current action version. If maintaining a copied workflow, remove any invalid `cache-dependency-path` setting that refers to a nonexistent target-repository lockfile.

## GitHub returns 403 for the authenticated user

```text
Resource not accessible by integration
```

Use the current ReviewPilot version, which identifies its own marked comment without calling an API unavailable to the workflow token. Also confirm the workflow grants:

```yaml
permissions:
  contents: read
  issues: read
  pull-requests: write
```

For IssuePilot, grant `issues: write` and `pull-requests: read`.

## Gemini quota exceeded

A new API key created under the same Google project can share the same project-level quota. Options include:

- waiting for the quota window to reset;
- using a different eligible Google project;
- selecting OpenRouter as the primary provider; or
- configuring OpenRouter as a fallback.

IssuePilot requests an issue description only when a task actually becomes eligible. Blocked synchronization runs do not need model generation.

## The model request was aborted

An abort commonly indicates a provider timeout or unavailable free model. Retry after checking provider status and quota, or configure the alternate provider. A retry is safe because ReviewPilot updates its marked comment and IssuePilot checks task markers before creating work.

## Invalid model JSON

Both agents require structured output. Invalid or truncated JSON is rejected and retried instead of being partially applied. If failures continue:

- use a model with reliable structured-output support;
- reduce unusually large project documentation;
- check the provider's token/output limits; or
- switch providers.

## ReviewPilot posts no issue-aware findings

Issue context is optional. To enable it, place a closing reference on its own PR-description line:

```markdown
Closes #42
```

Alternatively run:

```bash
npm run dev -- review <PR_URL> --issue 42
```

Use `--no-linked-issues` only when a PR-only review is intended.

## A finding has no file and line

Location-free findings are allowed only for a linked requirement that is entirely missing from the PR. Ordinary code findings must point to a real added diff line.

## Duplicate PR comments

ReviewPilot updates only a comment containing its hidden marker and authored by the current workflow-token identity. Changing the identity used to publish comments can leave an older marked comment that the new identity cannot edit. Remove the obsolete comment once, then keep a consistent workflow identity.

## A cached review was used

Caching is keyed by the exact PR head SHA and review settings. Use `--force` to request a fresh model review:

```bash
npm run dev -- review <PR_URL> --force
```

Editing a linked issue changes the cache identity automatically.

## IssuePilot creates no issue

Read the synchronization output. A task is intentionally blocked when:

- one of its dependencies is incomplete;
- an earlier task for the same assignee is incomplete;
- the assignee already has a managed issue in progress;
- a prior issue was closed without valid completion evidence; or
- an existing issue/PR mapping already represents the task.

Run a dry synchronization locally to inspect decisions without writing:

```bash
node dist/cli.js issuepilot sync
```

## A closed issue did not unlock dependencies

A closed issue is complete only when:

- a linked PR containing `Closes #<issue-number>` was merged; or
- the issue had the configured `completed-manually` label when closed.

Closing it without either condition intentionally records cancellation. Reopen and complete the issue correctly, or update the approved roadmap if the task is no longer required.

## An existing task was duplicated

Map pre-existing work with `existingIssueNumber` in `.issuepilot/plan.yml`. Issues created by IssuePilot contain a hidden task marker and are detected automatically. Never copy the same marker into another issue.

## A dependency-ready task still waits

IssuePilot also enforces sequential work per assignee. Even with completed dependencies, a task waits while that developer has another managed task in progress or an earlier roadmap task remains incomplete.

## The workflow did not run after a merge

Confirm the target repository contains the current synchronization workflow and that it listens for:

```yaml
pull_request:
  types: [closed]
```

The job condition must accept only merged pull requests. Use `workflow_dispatch` as a safe manual fallback.

## The moving v1 tag does not contain a new feature

An immutable release tag and the moving major tag are separate Git references. After publishing a compatible release, the maintainer must update both the new immutable tag and `v1`. Consumers pinned to a commit or older version will not move automatically.
