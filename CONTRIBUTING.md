# Contributing

Thank you for improving ReviewPilot. Changes should preserve its cautious defaults: inspect before reporting, verify model output, minimize GitHub permissions, and keep code modification and merging outside the agent boundary.

## Development setup

Requirements:

- Node.js 22 or newer
- npm
- Git

```bash
npm ci --ignore-scripts
npm run check
npm run test:coverage
npm run build
```

The automated tests mock GitHub and model-provider responses. API keys are not required.

For local manual testing, copy `.env.example` to `.env` and provide only the credentials needed for the selected scenario. Never commit `.env`, generated reports, tokens, or private repository content.

## Project structure

```text
src/
├── cli.ts                 CLI commands and provider wiring
├── reviewer.ts            PR review orchestration and finding verification
├── github.ts              PR, issue, diff, and comment GitHub API behavior
├── repository.ts          Bounded repository-context collection
├── providers.ts           Provider selection and fallback
├── gemini.ts              Gemini structured review client
├── openrouter.ts          OpenRouter structured review client
├── security.ts            Sensitive-path filtering and secret redaction
├── report.ts              Markdown, JSON, and PR comment rendering
└── issuepilot/
    ├── config.ts          IssuePilot configuration validation
    ├── plan.ts            Manual roadmap validation
    ├── sync.ts            Progress reconstruction and scheduling
    ├── generator.ts       Just-in-time issue-description generation
    └── github.ts          IssuePilot GitHub operations

tests/                     Unit and scenario tests
examples/                  Target-repository workflow templates
action.yml                 ReviewPilot composite action
issuepilot/action.yml      IssuePilot composite action
```

## Making a change

1. Keep the change focused and avoid unrelated refactors.
2. Add or update tests for behavior changes.
3. Preserve typed, structured errors for expected failures.
4. Do not weaken secret handling, diff verification, or workflow permissions.
5. Update README, architecture, troubleshooting, and changelog content when behavior changes.
6. Run the full local checks.

```bash
npm run check
npm run test:coverage
npm run build
```

## Adding or changing a model provider

A review provider must implement the common review client contract and return the same structured review schema. Provider-specific output must not bypass confidence filtering or diff-location verification.

An IssuePilot description provider must return one complete issue body that follows the target repository's template. It must not add IssuePilot's hidden task marker; the scheduler owns marker creation.

Add tests for:

- valid structured output;
- malformed output;
- timeout or abort behavior;
- rate-limit/transient errors; and
- provider fallback where applicable.

## Changing scheduling behavior

Scheduling changes require tests covering:

- dependencies;
- per-assignee ordering;
- an already active managed issue;
- multiple eligible developers;
- merged closing PR completion;
- approved manual completion;
- cancellation; and
- duplicate task/issue markers.

The roadmap must remain human-authored and repository-approved. Do not reintroduce autonomous roadmap generation without an explicit product decision and a new major design review.

## Pull requests

A good pull request explains:

- the problem;
- the chosen behavior;
- safety or compatibility impact;
- tests performed; and
- documentation changes.

Do not include generated local reports, credentials, dependency directories, or unrelated application code.
