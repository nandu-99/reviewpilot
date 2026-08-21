import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

const root = process.cwd();

describe("GitHub automation", () => {
  it("defines a duplicate-safe PR review action without automatic validation", async () => {
    const source = await readFile(path.join(root, "action.yml"), "utf8");
    const action = YAML.parse(source) as {
      inputs: Record<string, { required?: boolean; default?: string }>;
      runs: { using: string; steps: Array<{ run?: string }> };
    };

    expect(action.runs.using).toBe("composite");
    expect(action.inputs["pr-url"]?.required).toBe(true);
    expect(action.inputs["github-token"]?.required).toBe(true);
    expect(action.inputs.provider?.default).toBe("gemini");
    expect(source).toContain("--post-comment");
    expect(source).not.toContain("--run-checks");
  });

  it("uses minimal caller permissions and safe same-repository PR triggers", async () => {
    const source = await readFile(path.join(root, "examples", "reviewpilot.yml"), "utf8");
    const workflow = YAML.parse(source) as {
      permissions: Record<string, string>;
      jobs: { review: { if: string } };
    };

    expect(workflow.permissions).toEqual({
      contents: "read",
      issues: "read",
      "pull-requests": "write"
    });
    expect(workflow.jobs.review.if).toContain("head.repo.full_name == github.repository");
    expect(source).not.toMatch(/contents:\s*write/);
    expect(source).not.toContain("pull_request_target");
  });
});
