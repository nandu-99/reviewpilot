# ReviewPilot

[![CI](https://github.com/nandu-99/reviewpilot/actions/workflows/ci.yml/badge.svg)](https://github.com/nandu-99/reviewpilot/actions/workflows/ci.yml)
[![GitHub release](https://img.shields.io/github/v/release/nandu-99/reviewpilot)](https://github.com/nandu-99/reviewpilot/releases)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

ReviewPilot automatically reviews pull requests and creates the next project task when earlier work is complete.

It runs inside GitHub Actions. You do not need to deploy or maintain a server.

## What it does

| Agent           | Purpose                                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **ReviewPilot** | Reads a pull request, checks the changed code against optional linked issues, verifies every finding, and creates or updates one PR comment. |
| **IssuePilot**  | Reads an approved task plan, waits for dependencies and earlier work, then creates the next eligible GitHub issue.                           |

Neither agent pushes code, approves reviews, or merges pull requests.

## How the system works

![ReviewPilot and IssuePilot system overview](https://raw.githubusercontent.com/nandu-99/reviewpilot/main/docs/assets/architecture/system-overview.svg)

### Pull-request reviews

When a pull request is opened or updated, ReviewPilot:

1. Fetches the PR, diff, changed files, and optional linked issues.
2. Checks out the exact PR commit in a temporary folder.
3. Reads related code, tests, manifests, and repository instructions.
4. Sends limited, redacted context to Gemini or OpenRouter.
5. Rejects findings that point to the wrong file, wrong line, or have low confidence.
6. Creates or updates one marked comment on the PR.

Issue linking is optional. ReviewPilot understands references such as `Closes #42`, `Fixes owner/repository#9`, and `Resolves <issue-url>`.

### Automatic issue scheduling

IssuePilot reads a plan that your team reviews and stores in `.issuepilot/plan.yml`. It creates a task only when:

- all dependencies are complete;
- the developer's earlier task is complete; and
- the developer has no other managed issue in progress.

A task is complete after a linked closing PR is merged. It can also be completed manually by adding the configured `completed-manually` label before closing the issue. Closing without either signal means cancellation, so dependent work stays blocked.

## See it working

### ReviewPilot finds a requirement defect

![ReviewPilot reports a high-confidence pull-request finding](https://raw.githubusercontent.com/nandu-99/reviewpilot/main/docs/assets/screenshots/review-finding.png)

After the fix is pushed, the same comment is updated instead of creating a duplicate:

![ReviewPilot updates the existing comment after the fix](https://raw.githubusercontent.com/nandu-99/reviewpilot/main/docs/assets/screenshots/review-fixed.png)

### IssuePilot releases only eligible work

![IssuePilot creates one task and blocks later work](https://raw.githubusercontent.com/nandu-99/reviewpilot/main/docs/assets/screenshots/issue-scheduling.png)

## Quick start: automatic PR reviews

Requirements:

- Node.js 22 or newer
- a Gemini API key, an OpenRouter API key, or both
- a GitHub token only for local private-repository access or local comment publishing

In the repository you want to review:

1. Add `GEMINI_API_KEY` under **Settings → Secrets and variables → Actions**.
2. Copy [`examples/reviewpilot.yml`](examples/reviewpilot.yml) to `.github/workflows/reviewpilot.yml`.
3. Open or update a same-repository pull request.

The workflow uses:

```yaml
uses: nandu-99/reviewpilot@v1
```

Use a release tag or full commit SHA instead of `v1` if your project requires an immutable action reference.

## Quick start: IssuePilot

Add these files to the target repository:

```text
PROJECT_CONTEXT.md
ISSUE_FORMAT.md
.issuepilot/config.yml
.issuepilot/plan.yml
```

Start from [`issuepilot.config.example.yml`](issuepilot.config.example.yml), then copy [`examples/issuepilot-sync.yml`](examples/issuepilot-sync.yml) to `.github/workflows/issuepilot-sync.yml`.

IssuePilot runs automatically when a closing PR is merged or a managed issue is closed. You can also start it manually from the Actions page.

## Local review

```bash
npm install
cp .env.example .env
npm run build
npm run dev -- review https://github.com/OWNER/REPOSITORY/pull/123
```

Useful options:

```bash
npm run dev -- review <PR_URL> --post-comment
npm run dev -- review <PR_URL> --issue 42
npm run dev -- review <PR_URL> --no-linked-issues
npm run dev -- review <PR_URL> --provider openrouter --model openrouter/free
npm run dev -- review <PR_URL> --force
```

Local Markdown and JSON reports are saved in `.reviewpilot/reviews/`.

## Safety

- Reviewed code is inspected before any comment is written.
- Model context is size-limited and common secrets are redacted.
- The model has no shell access, GitHub token, or direct write access.
- Review findings must match real changed files and added lines.
- Temporary repository checkouts are removed after every run.
- Validation commands are disabled in automatic PR workflows because PR code is untrusted.
- The supplied workflow skips pull requests from forks.

## Tech stack

- TypeScript and Node.js
- GitHub Actions and GitHub REST API
- Gemini and OpenRouter
- Zod for structured validation
- Vitest for automated tests

## Documentation

| Document                              | Contents                                             |
| ------------------------------------- | ---------------------------------------------------- |
| [Architecture](ARCHITECTURE.md)       | Components, agent flows, state, and trust boundaries |
| [Security](SECURITY.md)               | Permissions, secret handling, and threat boundaries  |
| [Troubleshooting](TROUBLESHOOTING.md) | Common setup and provider errors                     |
| [Contributing](CONTRIBUTING.md)       | Local development and pull-request checks            |
| [Changelog](CHANGELOG.md)             | Release history                                      |

## Current limits

- Review quality depends on the selected model and its available quota.
- Large repositories use bounded related-file context instead of a full semantic index.
- The automatic workflow skips fork pull requests.
- IssuePilot requires a human-reviewed roadmap and does not decide product scope.
- Neither agent implements code or merges pull requests.

## License

[MIT](LICENSE)
