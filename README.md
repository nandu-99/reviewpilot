# ReviewPilot

ReviewPilot is a cautious, repository-aware pull request review agent for GitHub. It fetches a PR, checks out the exact head commit, inspects changed and related files, optionally runs explicitly allowed validation commands, asks Gemini or OpenRouter for a structured review, verifies every finding against the actual diff, and writes local Markdown and JSON reports.

ReviewPilot never modifies the reviewed repository or installs dependencies. Validation and GitHub comment publishing remain opt-in through `--run-checks` and `--post-comment`.

## Requirements

- Node.js 22 or newer
- Git
- A Gemini API key, an [OpenRouter API key](https://openrouter.ai/keys), or both
- A GitHub fine-grained personal access token for private repositories

Public repositories can be reviewed without a GitHub token, although authenticated requests have better rate limits.

## Install

```bash
npm install
npm run build
```

Create a local environment file:

```bash
cp .env.example .env
```

Gemini-primary configuration with an optional OpenRouter fallback:

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=your-gemini-key
GEMINI_MODEL=gemini-2.5-flash

OPENROUTER_API_KEY=sk-or-v1-your-key
OPENROUTER_FALLBACK_MODEL=nvidia/nemotron-3-ultra-550b-a55b:free
```

When Gemini is primary, ReviewPilot retries transient Gemini failures and then uses the configured OpenRouter fallback. Set `AI_PROVIDER=openrouter` to use OpenRouter alone. `--provider` and `--model` can override the primary provider and model for one run.

Gemini free-tier submissions may be used by Google to improve its products. Use an appropriate paid provider or local model before reviewing confidential source code.

For private repositories, also set:

```env
GITHUB_TOKEN=github_pat_your-token
```

For local-only reviews, the recommended fine-grained GitHub permissions are `Contents: Read`, `Pull requests: Read`, and `Issues: Read`, restricted to selected repositories. `Issues: Read` is only needed for private linked-issue context. To use `--post-comment`, change `Pull requests` to `Read and write`. Tokens and sensitive files are never sent to the model or written into review memory.

## Run a review

During development:

```bash
npm run dev -- review https://github.com/OWNER/REPOSITORY/pull/123
```

After building:

```bash
node dist/cli.js review https://github.com/OWNER/REPOSITORY/pull/123
```

Reports are written to `.reviewpilot/reviews/`. A review is cached by repository, PR number, exact head SHA, model, focus, thresholds, and validation settings; use `--force` to regenerate it.

Useful options:

```bash
reviewpilot review <url> --focus correctness,security
reviewpilot review <url> --provider gemini --model gemini-2.5-flash
reviewpilot review <url> --provider openrouter --model openrouter/free
reviewpilot review <url> --output ./review-results
reviewpilot review <url> --force
reviewpilot review <url> --post-comment
```

### Optional GitHub comment

`--post-comment` publishes one compact summary comment in the pull request Conversation tab. Each finding has three short fields: what is wrong, a concrete example of what can happen, and the smallest fix. Findings with verified diff locations include `file:line`; entirely missing linked-issue requirements are labeled as general requirement findings. Publishing is opt-in and requires `GITHUB_TOKEN` with `Pull requests: Read and write`.

The comment contains a hidden ReviewPilot marker. On later runs, ReviewPilot updates the existing marked comment authored by the token owner instead of adding a duplicate. It never edits another user's comment and does not approve, request changes, merge, or push code.

## Optional issue-aware review

ReviewPilot can compare a PR with issue requirements, but an issue is not required. By default it detects up to five issue references on PR-description lines containing `Closes`, `Fixes`, or `Resolves`:

```markdown
Closes #42
Fixes owner/other-repository#9
Resolves https://github.com/owner/repository/issues/15
```

You can explicitly supply an issue even when the PR description does not link it:

```bash
reviewpilot review <PR_URL> --issue 42
reviewpilot review <PR_URL> --issue owner/repository#42
reviewpilot review <PR_URL> --issue https://github.com/owner/repository/issues/42
```

To perform a PR-only review and ignore automatically detected links:

```bash
reviewpilot review <PR_URL> --no-linked-issues
```

An explicit `--issue` is still used with `--no-linked-issues`; that flag disables automatic detection only. Issue titles and descriptions are secret-redacted before model analysis and report persistence. Issue content and its `updated_at` value are part of the cache identity, so editing requirements causes a fresh review even when the PR commit is unchanged.

## Configuration

Copy the example configuration if you want to customize behavior:

```bash
cp reviewpilot.config.example.yml reviewpilot.config.yml
```

The default review threshold is 75% confidence, and model findings are discarded unless they point to a real added line in the PR diff.

### Validation commands

Commands are arrays, not shell strings. This prevents pipes, redirects, substitutions, and chained commands:

```yaml
validation:
  commands:
    - [npm, run, typecheck, --if-present]
    - [npm, test]
  timeoutMilliseconds: 120000
```

Run them with explicit authorization:

```bash
reviewpilot review <url> --run-checks
```

ReviewPilot does not install dependencies. Validation therefore works when the required tooling is already available in the checkout or when commands rely only on repository-contained/runtime tooling. PR code is untrusted: use an isolated container before enabling validation for repositories you do not control.

## Processing flow

1. Parse and validate the GitHub PR URL.
2. Optionally resolve explicit or closing-keyword issue references.
3. Fetch PR metadata, issue requirements, changed-file metadata, and the full unified diff.
4. Create a temporary Git checkout at the exact PR head SHA.
5. Read repository instructions, changed files, matching tests, and references to changed symbols.
6. Redact credentials and build a size-limited review context.
7. Optionally execute allowlisted validation commands without a shell.
8. Request a schema-constrained Gemini review with transient-error retries; fall back to OpenRouter when configured.
9. Compare code with issue acceptance criteria when issue context exists.
10. Reject low-confidence, duplicate, wrong-file, and wrong-line findings.
11. Save Markdown/JSON reports and minimal non-secret review memory.
12. Optionally create or update one marked PR summary comment with `--post-comment`.
13. Remove the temporary checkout.

## Memory

`.reviewpilot/memory.json` contains only completed review metadata and results keyed by the exact commit SHA. It does not contain source-code snapshots or credentials. Repository context and working state remain in memory only for the duration of a review.

## Safety boundaries

- `.env`, private keys, credential files, and common token patterns are excluded or redacted.
- Git authentication is passed to the Git subprocess through its environment, not embedded in the repository URL.
- Temporary checkouts are removed after success or failure.
- Validation uses direct process execution with no shell.
- Destructive and network download commands are blocked from validation configuration.
- GitHub publishing is opt-in through `--post-comment`; autonomous code changes, approvals, change requests, merges, and pushes remain outside this MVP.

## Development

```bash
npm run check
npm run build
```

The test suite uses mocked GitHub, Gemini, and OpenRouter responses and does not require API keys.
