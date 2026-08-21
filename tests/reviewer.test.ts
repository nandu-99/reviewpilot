import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "../src/diff.js";
import { findingRulesForPrompt, verifyFindings } from "../src/reviewer.js";

const diff = parseUnifiedDiff(`diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,1 +1,2 @@
 const a = 1;
+const risky = run();`);

const baseReview = {
  summary: "Review",
  riskLevel: "high" as const,
  reviewedAreas: ["correctness"],
  uncertainties: [],
  findings: [
    {
      severity: "high" as const,
      confidence: 0.9,
      category: "correctness",
      file: "src/a.ts",
      line: 2,
      title: "Valid finding",
      evidence: "Evidence",
      impact: "Impact",
      suggestion: "Fix"
    },
    {
      severity: "critical" as const,
      confidence: 0.99,
      category: "correctness",
      file: "src/a.ts",
      line: 99,
      title: "Hallucinated line",
      evidence: "Evidence",
      impact: "Impact",
      suggestion: "Fix"
    }
  ]
};

describe("verifyFindings", () => {
  it("keeps only findings attached to real added diff lines", () => {
    const result = verifyFindings(baseReview, diff, 0.75, 10, "test-model");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.title).toBe("Valid finding");
    expect(result.riskLevel).toBe("high");
  });

  it("recomputes risk after filtering", () => {
    const result = verifyFindings({ ...baseReview, findings: [{ ...baseReview.findings[0]!, confidence: 0.2 }] }, diff, 0.75, 10, "test-model");
    expect(result.findings).toEqual([]);
    expect(result.riskLevel).toBe("none");
  });

  it("keeps unlocated requirement findings only with issue context", () => {
    const requirementFinding = {
      ...baseReview.findings[0]!,
      category: "requirements",
      file: null,
      line: null,
      title: "Required audit log is missing"
    };
    const withoutIssue = verifyFindings({ ...baseReview, findings: [requirementFinding] }, diff, 0.75, 10, "test-model");
    const withIssue = verifyFindings({ ...baseReview, findings: [requirementFinding] }, diff, 0.75, 10, "test-model", true);
    expect(withoutIssue.findings).toEqual([]);
    expect(withIssue.findings).toHaveLength(1);
  });
});

describe("findingRulesForPrompt", () => {
  it("allows unlocated findings for entirely missing linked-issue requirements", () => {
    const rules = findingRulesForPrompt(true);

    expect(rules).toContain('category "requirements"');
    expect(rules).toContain("file and line set to null");
    expect(rules).toContain("include it in findings");
  });

  it("requires added-line locations when no issue context exists", () => {
    expect(findingRulesForPrompt(false)).toContain("Every finding must point to an added line");
  });
});
