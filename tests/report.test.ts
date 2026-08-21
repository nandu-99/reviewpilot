import { describe, expect, it } from "vitest";
import { renderPullRequestComment, REVIEWPILOT_COMMENT_MARKER } from "../src/report.js";
import type { ReviewReport } from "../src/types.js";

const report = {
  cacheKey: "acme/shop#1@head",
  generatedAt: new Date(0).toISOString(),
  inspectedFiles: ["src/a.ts"],
  validation: [],
  issues: [],
  pr: {
    owner: "acme", repo: "shop", number: 1, url: "https://github.com/acme/shop/pull/1",
    title: "Test", body: "", baseSha: "base", headSha: "1234567890abcdef", baseRef: "main", headRef: "test",
    author: "dev", draft: false, changedFiles: 1
  },
  review: {
    summary: "One defect found.", riskLevel: "high", reviewedAreas: ["correctness"], uncertainties: [], model: "free",
    findings: [{
      severity: "high", confidence: 0.95, category: "correctness", file: "src/a.ts", line: 2,
      title: "Broken call", evidence: "It throws.", impact: "Request fails.", suggestion: "Handle the error."
    }]
  }
} satisfies ReviewReport;

describe("renderPullRequestComment", () => {
  it("renders finding locations and the duplicate-prevention marker", () => {
    const comment = renderPullRequestComment(report);

    expect(comment).toContain("`src/a.ts:2`");
    expect(comment).toContain("**Risk:** HIGH");
    expect(comment).toContain("**Wrong:** It throws.");
    expect(comment).toContain("**Example impact:** Request fails.");
    expect(comment).toContain("**Fix:** Handle the error.");
    expect(comment).not.toContain("**Evidence:**");
    expect(comment.endsWith(REVIEWPILOT_COMMENT_MARKER)).toBe(true);
  });

  it("keeps generated sections on one short line", () => {
    const longReport = structuredClone(report);
    longReport.review.findings[0]!.evidence = `First line\n${"x".repeat(400)}`;

    const comment = renderPullRequestComment(longReport);
    const wrongLine = comment.split("\n").find((line) => line.startsWith("- **Wrong:**"));
    expect(wrongLine).toBeDefined();
    expect(wrongLine!.length).toBeLessThanOrEqual(314);
    expect(wrongLine).toContain("…");
  });
});
