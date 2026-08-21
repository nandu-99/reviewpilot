import { describe, expect, it } from "vitest";
import { isSensitivePath, redactSecrets } from "../src/security.js";

describe("secret handling", () => {
  it("redacts provider tokens and common assignments", () => {
    const result = redactSecrets("OPENROUTER=sk-or-v1-abcdefghijklmnopqrstuvwxyz\npassword=supersecretvalue");
    expect(result.value).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(result.value).not.toContain("supersecretvalue");
    expect(result.count).toBe(2);
  });

  it("blocks common secret file paths", () => {
    expect(isSensitivePath(".env.production")).toBe(true);
    expect(isSensitivePath("certs/server.pem")).toBe(true);
    expect(isSensitivePath("src/config.ts")).toBe(false);
  });
});
