import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "../src/diff.js";

const DIFF = `diff --git a/src/auth.ts b/src/auth.ts
index 111..222 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -10,3 +10,4 @@ function refresh() {
 context();
-oldCall();
+newCall();
+trackResult();
 done();
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const one = 1;
+export const two = 2;`;

describe("parseUnifiedDiff", () => {
  it("tracks files and added new-file line numbers", () => {
    const files = parseUnifiedDiff(DIFF);
    expect(files).toHaveLength(2);
    expect(files[0]?.path).toBe("src/auth.ts");
    expect([...files[0]!.addedLines]).toEqual([11, 12]);
    expect(files[1]?.status).toBe("added");
    expect([...files[1]!.addedLines]).toEqual([1, 2]);
  });
});
