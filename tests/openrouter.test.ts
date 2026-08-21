import { describe, expect, it, vi } from "vitest";
import { OpenRouterClient, parseModelReview } from "../src/openrouter.js";

const VALID_REVIEW = {
  summary: "One concurrency risk.",
  riskLevel: "high",
  reviewedAreas: ["authentication"],
  uncertainties: [],
  findings: [{
    severity: "high",
    confidence: 0.92,
    category: "correctness",
    file: "src/auth.ts",
    line: 12,
    title: "Concurrent refreshes race",
    evidence: "Every 401 starts an independent refresh.",
    impact: "A stale token can overwrite a new token.",
    suggestion: "Share the active refresh promise."
  }]
};

describe("OpenRouter parsing", () => {
  it("accepts fenced JSON and validates its schema", () => {
    expect(parseModelReview(`\`\`\`json\n${JSON.stringify(VALID_REVIEW)}\n\`\`\``).findings).toHaveLength(1);
  });

  it("rejects malformed findings", () => {
    expect(() => parseModelReview(JSON.stringify({ ...VALID_REVIEW, findings: [{ file: "x" }] }))).toThrow(/invalid review JSON/);
  });
});

describe("OpenRouterClient", () => {
  it("sends bearer authentication and returns the actual routed model", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer router-key");
      return new Response(JSON.stringify({
        model: "example/free-model",
        choices: [{ message: { content: JSON.stringify(VALID_REVIEW) } }]
      }), { status: 200 });
    });
    const client = new OpenRouterClient("router-key", fetchMock as typeof fetch);
    const review = await client.review("openrouter/free", "Review this diff");
    expect(review.actualModel).toBe("example/free-model");
    expect(review.result.findings[0]?.line).toBe(12);
  });

  it("reports a clear error when a free model times out", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })
    );
    const client = new OpenRouterClient("router-key", fetchMock as typeof fetch, "https://router.test", 5);

    await expect(client.review("slow/free", "Review this diff")).rejects.toMatchObject({
      code: "OPENROUTER_TIMEOUT",
      message: expect.stringContaining("slow/free did not respond within")
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
