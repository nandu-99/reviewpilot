import { describe, expect, it, vi } from "vitest";
import { GeminiClient, toGeminiSchema, type GeminiSdkClient } from "../src/gemini.js";

const VALID_REVIEW = {
  summary: "No defects found.",
  riskLevel: "none",
  reviewedAreas: ["correctness"],
  uncertainties: [],
  findings: []
};

describe("GeminiClient", () => {
  it("removes JSON Schema keywords unsupported by Gemini", () => {
    expect(toGeminiSchema({
      type: "object",
      additionalProperties: false,
      properties: { line: { type: "integer", exclusiveMinimum: 0 }, title: { type: "string", minLength: 1 } }
    })).toEqual({
      type: "object",
      properties: { line: { type: "integer" }, title: { type: "string" } }
    });
  });

  it("requests schema-constrained JSON and returns the actual model", async () => {
    const generateContent = vi.fn(async () => ({
      text: JSON.stringify(VALID_REVIEW),
      modelVersion: "gemini-test-001"
    }));
    const client = new GeminiClient("gemini-key", { models: { generateContent } });

    const review = await client.review("gemini-test", "Review this diff");

    expect(review.actualModel).toBe("gemini-test-001");
    expect(review.result.findings).toEqual([]);
    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      model: "gemini-test",
      contents: "Review this diff",
      config: expect.objectContaining({
        responseMimeType: "application/json",
        responseJsonSchema: expect.objectContaining({ type: "object" })
      })
    }));
  });

  it("retries transient rate limits before succeeding", async () => {
    const generateContent = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("quota"), { status: 429 }))
      .mockResolvedValueOnce({ text: JSON.stringify(VALID_REVIEW), modelVersion: "gemini-test" });
    const sleep = vi.fn(async () => undefined);
    const sdk = { models: { generateContent } } as GeminiSdkClient;
    const client = new GeminiClient("gemini-key", sdk, 1000, 3, sleep);

    await expect(client.review("gemini-test", "Review")).resolves.toMatchObject({ actualModel: "gemini-test" });
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });
});
