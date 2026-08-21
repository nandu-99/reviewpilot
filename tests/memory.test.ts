import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ReviewMemory } from "../src/memory.js";
import type { ReviewReport } from "../src/types.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("ReviewMemory", () => {
  it("stores reviews by exact head SHA cache key", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "reviewpilot-test-"));
    directories.push(directory);
    const memory = new ReviewMemory(path.join(directory, "memory.json"));
    const report = {
      cacheKey: "acme/shop#1@abc",
      generatedAt: new Date(0).toISOString(),
      inspectedFiles: [],
      validation: [],
      issues: [],
      pr: {
        owner: "acme", repo: "shop", number: 1, url: "https://github.com/acme/shop/pull/1",
        title: "Test", body: "", baseSha: "base", headSha: "abc", baseRef: "main", headRef: "test",
        author: "dev", draft: false, changedFiles: 1
      },
      review: {
        summary: "Done", riskLevel: "none", reviewedAreas: [], uncertainties: [], findings: [], model: "free"
      }
    } satisfies ReviewReport;
    await memory.put(report);
    expect(await memory.get(report.cacheKey)).toEqual(report);
  });
});
