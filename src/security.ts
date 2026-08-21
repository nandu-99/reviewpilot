const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-or-v1-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_OPENROUTER_KEY]"],
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED_API_KEY]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[REDACTED_GITHUB_TOKEN]"],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]"],
  [/((?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["']?)[^\s"']{8,}/gi, "$1[REDACTED]"]
];

export function redactSecrets(input: string): { value: string; count: number } {
  let value = input;
  let count = 0;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    value = value.replace(pattern, () => {
      count += 1;
      return replacement;
    });
  }
  return { value, count };
}

export function isSensitivePath(filePath: string): boolean {
  const normalized = filePath.toLowerCase().replaceAll("\\", "/");
  const name = normalized.split("/").pop() ?? normalized;
  return name === ".env"
    || name.startsWith(".env.")
    || /(?:^|\/)(?:id_rsa|id_ed25519|credentials|secrets?)(?:\.|$)/.test(normalized)
    || /\.(?:pem|p12|pfx|key|keystore)$/.test(normalized);
}
