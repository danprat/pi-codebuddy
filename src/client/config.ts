import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const PROVIDER_ID = "codebuddy";
export const PROVIDER_NAME = "CodeBuddy";

export type CodeBuddyRegion = "intl" | "cn";

export interface RegionConfig {
  region: CodeBuddyRegion;
  name: string;
  baseUrl: string;
  domain: string;
  stateUrl: string;
  tokenUrl: string;
  refreshUrl: string;
  usageUrl: string;
  platform: string;
  userAgent: string;
  authUserAgent: string;
  ideType: string;
  ideName: string;
  pollIntervalMs: number;
}

export const REGIONS: Record<CodeBuddyRegion, RegionConfig> = {
  intl: {
    region: "intl",
    name: "CodeBuddy International",
    baseUrl: "https://www.codebuddy.ai/v2/chat/completions",
    domain: "www.codebuddy.ai",
    stateUrl: "https://www.codebuddy.ai/v2/plugin/auth/state",
    tokenUrl: "https://www.codebuddy.ai/v2/plugin/auth/token",
    refreshUrl: "https://www.codebuddy.ai/v2/plugin/auth/token/refresh",
    usageUrl: "https://www.codebuddy.ai/v2/billing/meter/get-user-resource",
    platform: "ide",
    userAgent: "IDE/2.108.1 CodeBuddy/2.108.1",
    authUserAgent: "IDE/2.63.2 CodeBuddy/2.63.2",
    ideType: "IDE",
    ideName: "IDE",
    pollIntervalMs: 5000,
  },
  cn: {
    region: "cn",
    name: "CodeBuddy CN (Tencent Copilot)",
    baseUrl: "https://copilot.tencent.com/v2/chat/completions",
    domain: "copilot.tencent.com",
    stateUrl: "https://copilot.tencent.com/v2/plugin/auth/state",
    tokenUrl: "https://copilot.tencent.com/v2/plugin/auth/token",
    refreshUrl: "https://copilot.tencent.com/v2/plugin/auth/token/refresh",
    usageUrl: "https://copilot.tencent.com/v2/billing/meter/get-user-resource",
    platform: "CLI",
    userAgent: "CLI/2.108.1 CodeBuddy/2.108.1",
    authUserAgent: "CLI/2.63.2 CodeBuddy/2.63.2",
    ideType: "CLI",
    ideName: "CLI",
    pollIntervalMs: 5000,
  },
};

const CONFIG_FILE = "codebuddy-config.json";

function agentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

function configPath(): string {
  return join(agentDir(), CONFIG_FILE);
}

export function getActiveRegion(): CodeBuddyRegion {
  if (process.env.CODEBUDDY_REGION?.toLowerCase() === "cn") {
    return "cn";
  }
  if (process.env.CODEBUDDY_REGION?.toLowerCase() === "intl") {
    return "intl";
  }
  try {
    const file = configPath();
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      if (parsed?.region === "cn" || parsed?.region === "intl") {
        return parsed.region;
      }
    }
  } catch {
    // ignore read error
  }
  return "intl";
}

export function setActiveRegion(region: CodeBuddyRegion): void {
  try {
    const file = configPath();
    writeFileSync(file, JSON.stringify({ region }, null, 2), "utf8");
  } catch (error) {
    console.error("Failed to persist CodeBuddy region config:", error);
  }
}

export function getRegionConfig(region?: CodeBuddyRegion): RegionConfig {
  const currentRegion = region || getActiveRegion();
  return REGIONS[currentRegion];
}

let prewarmed = false;
export function prewarmConnection(url?: string): void {
  const targetUrl = url || getRegionConfig().baseUrl;
  try {
    const origin = new URL(targetUrl).origin;
    fetch(`${origin}/v2/chat/completions`, {
      method: "OPTIONS",
      headers: { "User-Agent": getRegionConfig().userAgent },
      signal: AbortSignal.timeout(3000),
    }).catch(() => {
      // pre-warm is best effort
    });
    prewarmed = true;
  } catch {
    // ignore
  }
}

// Deterministic RFC-4122-v5-shaped UUID derived from a session key, mirroring
// the official client's per-conversation id (uuid5 over the session key).
export function stableUuidFrom(key: string): string {
  const hash = createHash("sha1").update(key).digest("hex");
  const timeHigh = ((parseInt(hash.slice(12, 16), 16) & 0x0fff) | 0x5000)
    .toString(16)
    .padStart(4, "0");
  const clockSeq = ((parseInt(hash.slice(16, 20), 16) & 0x3fff) | 0x8000)
    .toString(16)
    .padStart(4, "0");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    timeHigh,
    clockSeq,
    hash.slice(20, 32),
  ].join("-");
}

export function buildChatHeaders(
  token: string,
  regionConfig: RegionConfig = getRegionConfig(),
  body?: { messages?: Array<{ role: string; content?: any }> },
): Record<string, string> {
  const cleanToken = token.startsWith("Bearer ") ? token.slice(7).trim() : token.trim();

  // Stable per-conversation id: derive from opening user message (stable across retries),
  // else fall back to a fresh UUID.
  const firstUser = Array.isArray(body?.messages)
    ? body.messages.find((m) => m?.role === "user")
    : null;
  const userText =
    typeof firstUser?.content === "string"
      ? firstUser.content
      : Array.isArray(firstUser?.content)
        ? firstUser.content
            .map((b) => (b && typeof b.text === "string" ? b.text : ""))
            .join("\n")
        : "";

  const conversationKey = userText ? `cbai:${userText}` : null;
  const conversationId = conversationKey ? stableUuidFrom(conversationKey) : randomUUID();

  return {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "User-Agent": regionConfig.userAgent,
    "X-Product": "SaaS",
    "X-IDE-Type": regionConfig.ideType,
    "X-IDE-Name": regionConfig.ideName,
    "x-requested-with": "XMLHttpRequest",
    "x-codebuddy-request": "1",
    "X-Conversation-ID": conversationId,
    "X-Conversation-Request-ID": randomUUID(),
    "X-Conversation-Message-ID": randomUUID(),
    Authorization: `Bearer ${cleanToken}`,
  };
}
