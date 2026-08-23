# Security Policy

## Supported versions

Security fixes are applied to the latest `v1.x` release. Consumers can follow the moving `v1` tag for backward-compatible updates or pin an immutable release/commit SHA.

## Reporting a vulnerability

Do not disclose credentials, exploitable repository content, or a working exploit in a public issue. Contact the repository owner privately through the security-reporting option enabled for the GitHub repository. Include the affected version, impact, reproduction steps, and any suggested mitigation.

If private vulnerability reporting has not yet been enabled, open a public issue containing no sensitive details and ask the maintainer for a private contact channel.

## Data sent to model providers

Depending on the command and configuration, ReviewPilot can send:

- pull-request title and description;
- unified diff content;
- linked issue titles and descriptions;
- selected changed and related source files;
- repository instruction files and a manifest; and
- explicitly authorized validation output.

IssuePilot can send:

- the approved task summary;
- project documentation;
- the issue template; and
- task dependency/progress context.

Do not use a free or externally hosted provider for confidential code unless its terms and data controls meet your organization's requirements.

## Credential handling

- `.env`, common key files, and local configuration are ignored by Git.
- Common secret patterns and sensitive paths are removed or redacted before model analysis.
- Git credentials are passed to Git through the subprocess environment, not embedded in clone URLs.
- Tokens are not stored in review memory or reports.
- Temporary checkouts are removed after successful and failed reviews.

Redaction is a defense-in-depth control, not a guarantee that arbitrary secrets hidden in ordinary source text will always be recognized. Repository owners remain responsible for provider selection and secret hygiene.

## Minimum permissions

Automatic PR reviews use:

```yaml
permissions:
  contents: read
  issues: read
  pull-requests: write
```

IssuePilot synchronization uses:

```yaml
permissions:
  contents: read
  issues: write
  pull-requests: read
```

The supplied workflows do not grant `contents: write`, and the agents cannot push code or merge pull requests.

For local private-repository reviews, use a fine-grained personal access token restricted to selected repositories. Grant only `Contents: Read`, `Pull requests: Read`, and optional `Issues: Read`. Change pull-request access to write only when publishing a comment.

## Untrusted pull requests

Pull-request code is untrusted. The supplied automatic review workflow:

- skips fork-origin PRs;
- does not use `pull_request_target`;
- does not run repository validation commands; and
- does not install dependencies in the reviewed checkout.

Local `--run-checks` execution is explicit. Commands are configured as argument arrays, executed without a shell, and screened for destructive, shell, and network-download behavior. Use a disposable container or isolated runner before validating code you do not trust.

## Model isolation

Models receive text and return schema-constrained data. They do not receive GitHub tokens, direct tool access, filesystem write access, or command execution access.

Model findings pass through deterministic verification before publication. This does not guarantee that every published finding is correct; a human must still decide whether and how to change the code.

## Write boundaries

ReviewPilot can create or update only its marked PR summary comment. It does not approve, request changes, merge, or push.

IssuePilot can ensure its configured labels and create issues represented by the approved roadmap. It does not generate or approve the roadmap, modify source code, close issues, or merge pull requests.

## Supply-chain recommendations

- Pin this action to a full commit SHA in sensitive repositories.
- Review moving `v1` release notes before adopting major behavioral changes.
- Pin third-party Actions dependencies according to your organization's policy.
- Keep npm dependencies and runner images updated.
- Enable Dependabot, CodeQL, branch protection, and secret scanning on public deployments.
