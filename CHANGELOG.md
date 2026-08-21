# Changelog

All notable changes to ReviewPilot are documented in this file.

## [1.1.0] - 2026-08-21

### Added

- IssuePilot project planning from repository-owned project documents and issue templates.
- Version-controlled `.issuepilot/plan.yml` approval workflow.
- Dependency-aware and developer-sequential issue scheduling.
- Progress detection from merged closing PRs and approved manual completions.
- Duplicate-safe managed issue creation with stable task markers.
- Event-driven GitHub Actions workflows for plan approval and task synchronization.
- Dry-run synchronization for inspecting which tasks are ready without creating issues.

## [1.0.0] - 2026-08-21

ReviewPilot's first stable release.

### Added

- Repository-aware pull request reviews at the exact PR head commit.
- Optional requirement-aware review using linked GitHub issues.
- Gemini as the primary AI provider with optional OpenRouter fallback.
- Structured finding verification against real changed files and added lines.
- Compact Markdown and JSON reports with secret redaction.
- Duplicate-safe GitHub pull request summary comments.
- Automatic same-repository PR reviews through a composite GitHub Action.
- Manual workflow dispatch for reviewing an existing pull request.
- Minimal review memory keyed by commit and review configuration.
- Optional allowlisted validation commands for trusted local execution.

### Safety

- ReviewPilot does not modify, approve, merge, or push to reviewed repositories.
- Automatic workflows skip fork-origin pull requests to protect repository secrets.
- Automatic validation is disabled for untrusted pull request code.
- Temporary checkouts are removed after successful and failed reviews.

### Requirements

- Node.js 22 or newer for local use.
- A Gemini or OpenRouter API key.
- GitHub permissions appropriate to repository visibility and comment publishing.
