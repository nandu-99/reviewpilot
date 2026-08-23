# Changelog

All notable changes to ReviewPilot are documented in this file.

## [1.3.2] - 2026-08-23

### Added

- Static SVG diagrams for the complete system, pull-request review, and task scheduling flows.
- Tested GitHub workflow screenshots with simple result highlights.

### Changed

- Rewrote and shortened the README for first-time visitors.
- Simplified the architecture guide and moved detailed explanations out of the README.
- Reduced documentation image size by keeping only the screenshots used by the project.

## [1.3.1] - 2026-08-23

### Added

- Architecture, security, contributing, and troubleshooting documentation.
- Static diagrams for the PR-review and dependency-aware scheduling flows.
- Prettier formatting enforcement and Vitest coverage reporting with minimum thresholds.
- Dependabot configuration, CodeQL analysis, and a pull-request template.

### Changed

- Restructured the README around product value, quick setup, safety boundaries, and current limitations.
- Expanded npm package metadata for repository discovery.
- The CLI now derives its version from `package.json` and describes both supported AI providers and agents accurately.

### Fixed

- GitHub usernames containing digits, such as `nandu-99`, now pass IssuePilot team validation while invalid consecutive hyphens remain rejected.

## [1.3.0] - 2026-08-22

### Changed

- Removed AI roadmap generation and the plan-generation workflow.
- `.issuepilot/plan.yml` is now a manually maintained, pull-request-reviewed source of truth using schema version 3.
- IssuePilot is focused on event-driven synchronization and just-in-time issue-description generation.
- The scheduler blocks new work whenever any managed issue is already active for the same assignee, regardless of roadmap position.
- Merged closing PRs and approved manually completed issues continue to unlock dependent tasks automatically.

## [1.2.0] - 2026-08-22

### Changed

- IssuePilot plans now store concise task summaries instead of every future issue body.
- Complete roadmaps must cover all unfinished confirmed project priorities.
- Full issue descriptions are generated only when a task becomes eligible, using the latest project document, issue template, and dependency status.
- Synchronization accepts Gemini or OpenRouter credentials for just-in-time issue writing.
- Plan schema version increased to 2; version 1 generated plans must be regenerated before approval.

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
