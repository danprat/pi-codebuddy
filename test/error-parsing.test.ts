import { describe, expect, it } from "bun:test";
import { parseCodeBuddyError } from "../src/stream/transform.js";
import { parseResetTime, redactSecrets } from "../src/utils/security.js";

describe("CodeBuddy Error & Rate Limit Parsing", () => {
  it("parses code 6004 frequency limit with resetsAt timestamp", () => {
    const errorJson = JSON.stringify({
      code: 6004,
      msg: "超出频率限制，请于 2026-05-01 08:30:00 UTC+08:00 后重试",
    });

    const parsed = parseCodeBuddyError(400, errorJson);

    expect(parsed.status).toBe(429);
    expect(parsed.code).toBe(6004);
    expect(parsed.resetsAtMs).toBeNumber();
    expect(parsed.resetsAtIso).toContain("2026-05-01");
  });

  it("parses English frequency limit string", () => {
    const errorJson = JSON.stringify({
      code: 6004,
      msg: "frequency limit exceeded, resets at 2026-10-15 12:00:00",
    });

    const parsed = parseCodeBuddyError(429, errorJson);
    expect(parsed.status).toBe(429);
    expect(parsed.code).toBe(6004);
    expect(parsed.resetsAtMs).toBeNumber();
  });

  it("parses code 11140 account restriction error with actionable guidance", () => {
    const errorJson = JSON.stringify({
      code: 11140,
      msg: "request illegal",
      displayMsg: { en: "Your account has been restricted due to unusual activity" },
      displayTips: { en: "We detected unusual activity on this account. Submit feedback to appeal this restriction" },
    });

    const parsed = parseCodeBuddyError(403, errorJson);
    expect(parsed.status).toBe(403);
    expect(parsed.code).toBe(11140);
    expect(parsed.message).toContain("11140");
    expect(parsed.message).toContain("unusual activity");
  });

  it("redacts bearer tokens and secrets from error strings", () => {
    const raw = "Request failed for Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret123 with key sk-abcdef123456789012345678";
    const redacted = redactSecrets(raw);

    expect(redacted).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    expect(redacted).not.toContain("sk-abcdef123456789012345678");
    expect(redacted).toContain("Bearer [REDACTED]");
    expect(redacted).toContain("[REDACTED]");
  });

  it("handles parseResetTime with various formats", () => {
    const parsed = parseResetTime("2026-06-01 10:00:00 UTC+08:00");
    expect(parsed).toBeString();
    expect(new Date(parsed!).getUTCFullYear()).toBe(2026);

    expect(parseResetTime(undefined)).toBeNull();
    expect(parseResetTime("")).toBeNull();
  });
});
