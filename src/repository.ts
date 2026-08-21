import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ReviewPilotConfig } from "./config.js";
import { isSensitivePath, redactSecrets } from "./security.js";
import type { DiffFile, PullRequestFile, RepositoryContext } from "./types.js";

const INSTRUCTION_FILES = [
  "AGENTS.md",
  "CONTRIBUTING.md",
  "README.md",
  "reviewpilot.config.yml",
  "reviewpilot.config.yaml"
];

const SOURCE_EXTENSIONS = new Set([
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts",
  ".json", ".vue", ".svelte", ".css", ".scss", ".graphql", ".gql"
]);

const ALWAYS_IGNORED = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", ".turbo"]);

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "\u0000")
    .replaceAll("*", "[^/]*")
    .replaceAll("\u0000", ".*")
    .replaceAll("?", ".");
  return new RegExp(`^(?:${escaped}|.*/${escaped})$`);
}

function shouldIgnore(relativePath: string, patterns: string[]): boolean {
  const normalized = relativePath.replaceAll("\\", "/");
  return normalized.split("/").some((part) => ALWAYS_IGNORED.has(part))
    || patterns.some((pattern) => globToRegExp(pattern).test(normalized));
}

async function safeRead(root: string, relativePath: string, maximumCharacters: number): Promise<{ content: string; truncated: boolean; redactions: number } | undefined> {
  if (isSensitivePath(relativePath)) return undefined;
  const absolutePath = path.resolve(root, relativePath);
  const relative = path.relative(root, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;

  try {
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile() || fileStat.size > 2_000_000) return undefined;
    const raw = await readFile(absolutePath, "utf8");
    if (raw.includes("\0")) return undefined;
    const truncated = raw.length > maximumCharacters;
    const redacted = redactSecrets(raw.slice(0, maximumCharacters));
    return { content: redacted.value, truncated, redactions: redacted.count };
  } catch {
    return undefined;
  }
}

async function walkSourceFiles(root: string, ignoredPatterns: string[], limit = 2500): Promise<string[]> {
  const output: string[] = [];
  const queue = [""];
  while (queue.length > 0 && output.length < limit) {
    const relativeDirectory = queue.shift()!;
    const absoluteDirectory = path.join(root, relativeDirectory);
    let entries;
    try {
      entries = await readdir(absoluteDirectory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const relativePath = path.join(relativeDirectory, entry.name).replaceAll("\\", "/");
      if (shouldIgnore(relativePath, ignoredPatterns)) continue;
      if (entry.isDirectory()) queue.push(relativePath);
      else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) output.push(relativePath);
      if (output.length >= limit) break;
    }
  }
  return output;
}

function extractSymbols(diffFiles: DiffFile[]): string[] {
  const symbols = new Set<string>();
  const declaration = /^\+\s*(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|var|enum)\s+([A-Za-z_$][\w$]*)/gm;
  for (const file of diffFiles) {
    for (const match of file.patch.matchAll(declaration)) {
      const symbol = match[1];
      if (symbol && symbol.length >= 4) symbols.add(symbol);
      if (symbols.size >= 20) return [...symbols];
    }
  }
  return [...symbols];
}

function looksLikeRelatedTest(candidate: string, changedFiles: Set<string>): boolean {
  const normalized = candidate.toLowerCase();
  if (!/(?:test|spec)\.[cm]?[jt]sx?$/.test(normalized)) return false;
  const candidateBase = path.basename(candidate).replace(/\.(?:test|spec)\.[^.]+$/, "").toLowerCase();
  return [...changedFiles].some((changed) => path.basename(changed, path.extname(changed)).toLowerCase() === candidateBase);
}

export async function collectRepositoryContext(
  root: string,
  apiFiles: PullRequestFile[],
  diffFiles: DiffFile[],
  config: ReviewPilotConfig
): Promise<RepositoryContext> {
  const maximumCharacters = config.repository.maximumFileCharacters;
  const changedPaths = new Set(apiFiles.map((file) => file.filename));
  let redactionCount = 0;

  const instructions: RepositoryContext["instructions"] = [];
  for (const instructionPath of INSTRUCTION_FILES) {
    const result = await safeRead(root, instructionPath, 12_000);
    if (result) {
      instructions.push({ path: instructionPath, content: result.content });
      redactionCount += result.redactions;
    }
  }

  const changedFiles: RepositoryContext["changedFiles"] = [];
  for (const file of apiFiles) {
    if (file.status === "removed" || shouldIgnore(file.filename, config.repository.ignoredPaths)) continue;
    const result = await safeRead(root, file.filename, maximumCharacters);
    if (result) {
      changedFiles.push({ path: file.filename, content: result.content, truncated: result.truncated });
      redactionCount += result.redactions;
    }
  }

  const allSourceFiles = await walkSourceFiles(root, config.repository.ignoredPaths);
  const symbols = extractSymbols(diffFiles);
  const relatedFiles: RepositoryContext["relatedFiles"] = [];

  for (const candidate of allSourceFiles) {
    if (changedPaths.has(candidate) || relatedFiles.length >= config.repository.maximumRelatedFiles) continue;
    const testMatch = looksLikeRelatedTest(candidate, changedPaths);
    const result = await safeRead(root, candidate, maximumCharacters);
    if (!result) continue;
    const matchedSymbol = symbols.find((symbol) => result.content.includes(symbol));
    if (!testMatch && !matchedSymbol) continue;
    relatedFiles.push({
      path: candidate,
      content: result.content,
      reason: testMatch ? "matching test file" : `references changed symbol ${matchedSymbol}`,
      truncated: result.truncated
    });
    redactionCount += result.redactions;
  }

  const manifestRead = await safeRead(root, "package.json", maximumCharacters);
  if (manifestRead) redactionCount += manifestRead.redactions;

  return {
    instructions,
    changedFiles,
    relatedFiles,
    ...(manifestRead ? { manifest: { path: "package.json", content: manifestRead.content } } : {}),
    redactionCount
  };
}
