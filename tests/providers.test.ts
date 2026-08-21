import { describe, expect, it, vi } from "vitest";
import { generateReviewWithFallback, providerCacheIdentity, type ConfiguredReviewProvider } from "../src/providers.js";

const generated = {
  actualModel: "fallback-model",
  result: {
    summary: "Reviewed.",
    riskLevel: "none" as const,
    reviewedAreas: [],
    uncertainties: [],
    findings: []
  }
};

describe("AI provider fallback", () => {
  it("falls back from Gemini to OpenRouter", async () => {
    const progress = vi.fn();
    const providers: ConfiguredReviewProvider[] = [
      { name: "gemini", model: "gemini-primary", client: { review: vi.fn(async () => { throw new Error("unavailable"); }) } },
      { name: "openrouter", model: "router-fallback", client: { review: vi.fn(async () => generated) } }
    ];

    await expect(generateReviewWithFallback(providers, "prompt", progress)).resolves.toEqual(generated);
    expect(progress).toHaveBeenCalledWith(expect.stringContaining("falling back"));
    expect(providerCacheIdentity(providers)).toBe("gemini:gemini-primary->openrouter:router-fallback");
  });

  it("fails without returning partial output when every provider fails", async () => {
    const providers: ConfiguredReviewProvider[] = [
      { name: "gemini", model: "primary", client: { review: vi.fn(async () => { throw new Error("down"); }) } },
      { name: "openrouter", model: "fallback", client: { review: vi.fn(async () => { throw new Error("limited"); }) } }
    ];

    await expect(generateReviewWithFallback(providers, "prompt")).rejects.toMatchObject({ code: "AI_PROVIDERS_FAILED" });
  });
});
