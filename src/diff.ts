import type { DiffFile } from "./types.js";

function normalizeDiffPath(value: string): string {
  const unquoted = value.replace(/^"|"$/g, "");
  return unquoted === "/dev/null" ? unquoted : unquoted.replace(/^[ab]\//, "");
}

export function parseUnifiedDiff(diff: string): DiffFile[] {
  const lines = diff.split("\n");
  const files: DiffFile[] = [];
  let current: DiffFile | undefined;
  let patchLines: string[] = [];
  let newLine = 0;
  let inHunk = false;

  const finish = () => {
    if (current) {
      current.patch = patchLines.join("\n");
      files.push(current);
    }
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      finish();
      const match = /^diff --git (.+) (.+)$/.exec(line);
      const previousPath = match ? normalizeDiffPath(match[1]!) : "unknown";
      const path = match ? normalizeDiffPath(match[2]!) : previousPath;
      current = { path, previousPath, status: "modified", patch: "", addedLines: new Set<number>() };
      patchLines = [line];
      inHunk = false;
      continue;
    }

    if (!current) continue;
    patchLines.push(line);

    if (line.startsWith("new file mode")) current.status = "added";
    if (line.startsWith("deleted file mode")) current.status = "deleted";
    if (line.startsWith("rename from ")) {
      current.status = "renamed";
      current.previousPath = line.slice("rename from ".length);
    }
    if (line.startsWith("rename to ")) current.path = line.slice("rename to ".length);

    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      newLine = Number(hunk[1]);
      inHunk = true;
      continue;
    }

    if (!inHunk || line.startsWith("\\ No newline")) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.addedLines.add(newLine);
      newLine += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      // Deleted lines do not advance the new-file line counter.
    } else {
      newLine += 1;
    }
  }

  finish();
  return files;
}

export function renderDiffForPrompt(files: DiffFile[], maxCharacters: number): string {
  const sections: string[] = [];
  let remaining = maxCharacters;
  for (const file of files) {
    if (remaining <= 0) break;
    const section = file.patch.slice(0, remaining);
    sections.push(section);
    remaining -= section.length;
  }
  return sections.join("\n");
}
