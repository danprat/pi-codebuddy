import { describe, expect, it } from "bun:test";
import { getModelCatalog } from "../src/models/catalog.js";
import { buildChatHeaders, getRegionConfig, REGIONS, stableUuidFrom } from "../src/client/config.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("CodeBuddy Models & Config", () => {
  it("provides comprehensive model lineup", () => {
    const models = getModelCatalog();
    expect(models.length).toBeGreaterThanOrEqual(15);

    const modelIds = models.map((m) => m.id);
    expect(modelIds).toContain("glm-5.2");
    expect(modelIds).toContain("glm-5.1");
    expect(modelIds).toContain("minimax-m3");
    expect(modelIds).toContain("deepseek-v4-pro");
    expect(modelIds).toContain("kimi-k2.7");
    expect(modelIds).toContain("hy3");
  });

  it("configures regional endpoints correctly", () => {
    const intl = getRegionConfig("intl");
    expect(intl.baseUrl).toBe("https://www.codebuddy.ai/v2/chat/completions");
    expect(intl.domain).toBe("www.codebuddy.ai");
    expect(intl.platform).toBe("ide");

    const cn = getRegionConfig("cn");
    expect(cn.baseUrl).toBe("https://copilot.tencent.com/v2/chat/completions");
    expect(cn.domain).toBe("copilot.tencent.com");
    expect(cn.platform).toBe("CLI");
  });

  it("always sets X-Conversation-* headers family to pass channel verification", () => {
    const body = {
      messages: [{ role: "user", content: "hello world" }],
    };
    const headers = buildChatHeaders("dummy-token", getRegionConfig("intl"), body);

    expect(headers["X-Conversation-ID"]).toMatch(UUID_RE);
    expect(headers["X-Conversation-Request-ID"]).toMatch(UUID_RE);
    expect(headers["X-Conversation-Message-ID"]).toMatch(UUID_RE);
  });

  it("keeps X-Conversation-ID stable across retries of the same turn", () => {
    const body = {
      messages: [{ role: "user", content: "same opening query" }],
    };
    const a = buildChatHeaders("dummy-token", getRegionConfig("intl"), body);
    const b = buildChatHeaders("dummy-token", getRegionConfig("intl"), body);

    expect(a["X-Conversation-ID"]).toBe(b["X-Conversation-ID"]);
    expect(a["X-Conversation-Request-ID"]).not.toBe(b["X-Conversation-Request-ID"]);
    expect(a["X-Conversation-Message-ID"]).not.toBe(b["X-Conversation-Message-ID"]);
  });
});
