import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ReviewReport } from "./types.js";

interface MemoryFile {
  version: 1;
  reviews: Record<string, ReviewReport>;
}

const EMPTY_MEMORY: MemoryFile = { version: 1, reviews: {} };

export class ReviewMemory {
  constructor(private readonly filePath: string) {}

  private async load(): Promise<MemoryFile> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<MemoryFile>;
      if (parsed.version !== 1 || !parsed.reviews || typeof parsed.reviews !== "object") return { ...EMPTY_MEMORY, reviews: {} };
      return { version: 1, reviews: parsed.reviews };
    } catch {
      return { ...EMPTY_MEMORY, reviews: {} };
    }
  }

  async get(cacheKey: string): Promise<ReviewReport | undefined> {
    const report = (await this.load()).reviews[cacheKey];
    return report ? { ...report, issues: report.issues ?? [] } : undefined;
  }

  async put(report: ReviewReport): Promise<void> {
    const memory = await this.load();
    memory.reviews[report.cacheKey] = report;
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(memory, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }
}
