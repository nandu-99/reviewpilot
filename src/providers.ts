import { ReviewPilotError, toErrorMessage } from "./errors.js";
import type { OpenRouterReview } from "./openrouter.js";

export interface ReviewModelClient {
  review(model: string, prompt: string): Promise<OpenRouterReview>;
}

export interface ConfiguredReviewProvider {
  name: "gemini" | "openrouter";
  model: string;
  client: ReviewModelClient;
}

export function providerCacheIdentity(providers: ConfiguredReviewProvider[]): string {
  return providers.map((provider) => `${provider.name}:${provider.model}`).join("->");
}

export async function generateReviewWithFallback(
  providers: ConfiguredReviewProvider[],
  prompt: string,
  onProgress: (message: string) => void = () => undefined
): Promise<OpenRouterReview> {
  if (providers.length === 0) {
    throw new ReviewPilotError("NO_AI_PROVIDER", "No AI review provider is configured.");
  }

  const failures: string[] = [];
  for (const [index, provider] of providers.entries()) {
    onProgress(`Requesting a structured review from ${provider.name}/${provider.model}...`);
    try {
      return await provider.client.review(provider.model, prompt);
    } catch (error) {
      failures.push(`${provider.name}/${provider.model}: ${toErrorMessage(error)}`);
      const next = providers[index + 1];
      if (next) {
        onProgress(`${provider.name}/${provider.model} failed; falling back to ${next.name}/${next.model}...`);
      }
    }
  }

  throw new ReviewPilotError(
    "AI_PROVIDERS_FAILED",
    `All configured AI providers failed. ${failures.join(" | ")}`
  );
}
