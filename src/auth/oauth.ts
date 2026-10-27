import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import { getActiveRegion, getRegionConfig, type CodeBuddyRegion, type RegionConfig } from "../client/config.js";
import { redactSecrets } from "../utils/security.js";

export interface CodeBuddyOAuthCredentials extends OAuthCredentials {
  region?: CodeBuddyRegion;
  email?: string;
  accountId?: string;
}

interface StateResponse {
  code: number;
  msg?: string;
  data?: {
    state: string;
    authUrl: string;
  };
}

interface TokenResponse {
  code: number;
  msg?: string;
  data?: {
    accessToken?: string;
    refreshToken?: string;
    tokenType?: string;
    expiresIn?: number;
  };
}

export async function requestAuthState(config: RegionConfig): Promise<{ state: string; authUrl: string }> {
  const url = `${config.stateUrl}?platform=${config.platform}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": config.authUserAgent,
      "X-Requested-With": "XMLHttpRequest",
      "X-Domain": config.domain,
      "X-No-Authorization": "true",
      "X-No-User-Id": "true",
      "X-Product": "SaaS",
    },
    body: "{}",
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`CodeBuddy auth state request failed (${response.status}): ${redactSecrets(errorText)}`);
  }

  const json = (await response.json()) as StateResponse;
  if (json.code !== 0 || !json.data?.state || !json.data?.authUrl) {
    throw new Error(`CodeBuddy auth state error (${json.code}): ${json.msg || "missing state/authUrl"}`);
  }

  return {
    state: json.data.state,
    authUrl: json.data.authUrl,
  };
}

export async function pollAuthToken(
  config: RegionConfig,
  state: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; pending?: boolean; data?: { accessToken: string; refreshToken?: string; expiresIn?: number }; error?: string }> {
  const url = `${config.tokenUrl}?state=${encodeURIComponent(state)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": config.authUserAgent,
      "X-Requested-With": "XMLHttpRequest",
      "X-Domain": config.domain,
      "X-No-Authorization": "true",
      "X-No-User-Id": "true",
      "X-No-Enterprise-Id": "true",
      "X-No-Department-Info": "true",
      "X-Product": "SaaS",
    },
    signal,
  });

  if (!response.ok) {
    return { ok: false, error: `HTTP ${response.status}` };
  }

  const json = (await response.json()) as TokenResponse;
  // Code 0 = success, Code 11217 = pending confirmation
  if (json.code === 0 && json.data?.accessToken) {
    return {
      ok: true,
      data: {
        accessToken: json.data.accessToken,
        refreshToken: json.data.refreshToken,
        expiresIn: json.data.expiresIn,
      },
    };
  }

  if (json.code === 11217) {
    return { ok: false, pending: true };
  }

  return { ok: false, error: json.msg || `CodeBuddy error (${json.code})` };
}

export async function loginCodeBuddy(
  callbacks: OAuthLoginCallbacks,
): Promise<CodeBuddyOAuthCredentials> {
  const region = getActiveRegion();
  const config = getRegionConfig(region);

  const { state, authUrl } = await requestAuthState(config);

  callbacks.onAuth({
    url: authUrl,
    instructions: `Sign in to CodeBuddy (${config.name}) in your browser. Polling authorization state...`,
  });

  const pollIntervalMs = config.pollIntervalMs || 5000;
  const timeoutMs = 10 * 60 * 1000; // 10 minutes
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (callbacks.signal?.aborted) {
      throw new Error("Login cancelled by user");
    }

    // Wait for poll interval
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, pollIntervalMs);
      callbacks.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("Login cancelled by user"));
      }, { once: true });
    });

    if (callbacks.signal?.aborted) {
      throw new Error("Login cancelled by user");
    }

    let result: Awaited<ReturnType<typeof pollAuthToken>>;
    try {
      result = await pollAuthToken(config, state, callbacks.signal);
    } catch {
      if (callbacks.signal?.aborted) throw new Error("Login cancelled by user");
      // Transient network poll error, keep trying unless cancelled
      continue;
    }

    if (result.ok && result.data) {
      const expiresIn = result.data.expiresIn || 86400;
      return {
        access: result.data.accessToken,
        refresh: result.data.refreshToken || "",
        expires: Date.now() + expiresIn * 1000 - 5 * 60 * 1000,
        region,
      };
    }
    if (!result.pending && result.error) {
      // Unexpected terminal error (e.g. auth rejected/expired)
      throw new Error(result.error);
    }
  }

  throw new Error("CodeBuddy login timed out after 10 minutes waiting for browser sign-in");
}

export async function refreshCodeBuddyToken(
  credentials: CodeBuddyOAuthCredentials,
  regionOverride?: CodeBuddyRegion,
  signal?: AbortSignal,
): Promise<CodeBuddyOAuthCredentials> {
  if (!credentials.refresh) {
    throw new Error("No refresh token available to refresh CodeBuddy session");
  }

  const region = (typeof regionOverride === "string" ? regionOverride : undefined) || credentials.region || getActiveRegion();
  const config = getRegionConfig(region);

  const response = await fetch(config.refreshUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": config.authUserAgent,
      "X-Requested-With": "XMLHttpRequest",
      "X-Domain": config.domain,
      "X-Refresh-Token": credentials.refresh,
      "X-Auth-Refresh-Source": "plugin",
      "X-Product": "SaaS",
    },
    body: "{}",
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`CodeBuddy token refresh failed (${response.status}): ${redactSecrets(errorText)}`);
  }

  const json = (await response.json()) as TokenResponse;
  if (json.code !== 0 || !json.data?.accessToken) {
    throw new Error(`CodeBuddy token refresh error (${json.code}): ${json.msg || "missing access token"}`);
  }

  const expiresIn = json.data.expiresIn || 86400;
  return {
    ...credentials,
    access: json.data.accessToken,
    refresh: json.data.refreshToken || credentials.refresh,
    expires: Date.now() + expiresIn * 1000 - 5 * 60 * 1000,
    region,
  };
}

export function getApiKey(credentials: OAuthCredentials): string {
  return credentials.access;
}
