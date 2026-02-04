import { describe, it, expect } from "vitest";
import { scanForSecrets } from "../security/secret-scanner.js";

describe("system/security/secret-scanner", () => {
  it("detects PEM private keys as high confidence", () => {
    const body = `-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----`;
    const r = scanForSecrets(body);
    expect(r.hasHighConfidence).toBe(true);
    expect(r.findings.some((f) => f.type === "private_key_pem")).toBe(true);
  });

  it("detects OpenAI-style keys as high confidence", () => {
    const body = "sk-abcdefghijklmnopqrstuvwxyz0123456789";
    const r = scanForSecrets(body);
    expect(r.hasHighConfidence).toBe(true);
    expect(r.findings.some((f) => f.type === "openai_api_key")).toBe(true);
  });

  it("returns no findings on benign text", () => {
    const r = scanForSecrets("hello world");
    expect(r.findings.length).toBe(0);
    expect(r.hasHighConfidence).toBe(false);
  });
});
