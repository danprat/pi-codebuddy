import { getRegionConfig, type CodeBuddyRegion } from "../client/config.js";
import { parseResetTime } from "../utils/security.js";

export interface QuotaItem {
  name: string;
  used: number;
  total: number;
  remaining: number;
  percentUsed: number;
  resetAt: string | null;
  recurring: boolean;
}

export interface CodeBuddyUsageResult {
  plan: string;
  region: CodeBuddyRegion;
  quotas: QuotaItem[];
  rawAccountsCount: number;
}

interface RawAccount {
  PackageName?: string;
  SubProductName?: string;
  CycleStartTime?: string;
  CycleEndTime?: string;
  DeductionEndTime?: number | string;
  CycleCapacitySize?: number;
  CycleCapacitySizePrecise?: string;
  CycleCapacityUsed?: number;
  CycleCapacityUsedPrecise?: string;
  CapacitySize?: number;
  CapacitySizePrecise?: string;
  CapacityUsed?: number;
  CapacityUsedPrecise?: string;
}

interface UsageApiResponse {
  code: number;
  msg?: string;
  data?: {
    Response?: {
      Data?: {
        Accounts?: RawAccount[];
      };
    };
  };
}

function num(precise?: string, plain?: number): number {
  const n = Number(precise ?? plain);
  return Number.isFinite(n) ? n : 0;
}

function refillCadence(acc: RawAccount): string {
  const start = parseResetTime(acc.CycleStartTime);
  const end = parseResetTime(acc.CycleEndTime);
  if (start && end) {
    const days = (new Date(end).getTime() - new Date(start).getTime()) / 86400000;
    if (days <= 1.5) return "Daily Allowance";
    if (days <= 10) return "Weekly Allowance";
  }
  return "Monthly Allowance";
}

export async function fetchCodeBuddyUsage(
  token: string,
  regionOverride?: CodeBuddyRegion,
): Promise<CodeBuddyUsageResult> {
  const regionConfig = getRegionConfig(regionOverride);

  const response = await fetch(regionConfig.usageUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": regionConfig.userAgent,
      "X-Product": "SaaS",
      "X-IDE-Type": regionConfig.ideType,
      "X-IDE-Name": regionConfig.ideName,
      "x-requested-with": "XMLHttpRequest",
      "x-codebuddy-request": "1",
      Authorization: `Bearer ${token}`,
    },
    body: "{}",
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error("CodeBuddy credentials invalid or expired. Run /login codebuddy to re-authenticate.");
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`CodeBuddy quota API error (${response.status}): ${errorText.slice(0, 200)}`);
  }

  const json = (await response.json()) as UsageApiResponse;
  if (json.code !== 0) {
    throw new Error(`CodeBuddy quota error (${json.code}): ${json.msg || "unknown error"}`);
  }

  const data = json.data?.Response?.Data;
  const accounts = Array.isArray(data?.Accounts) ? data.Accounts : [];

  if (accounts.length === 0) {
    return {
      plan: "Free",
      region: regionConfig.region,
      quotas: [],
      rawAccountsCount: 0,
    };
  }

  const cycleEndMs = (acc: RawAccount) => {
    const r = parseResetTime(acc.CycleEndTime);
    return r ? new Date(r).getTime() : Number.POSITIVE_INFINITY;
  };

  const REFILL_GAP_MS = 2 * 24 * 60 * 60 * 1000;
  const isRefill = (acc: RawAccount) => {
    const ce = cycleEndMs(acc);
    const de = Number(acc.DeductionEndTime);
    return Number.isFinite(ce) && Number.isFinite(de) && de - ce > REFILL_GAP_MS;
  };

  const byExpiry = (a: RawAccount, b: RawAccount) => cycleEndMs(a) - cycleEndMs(b);

  const refills = accounts.filter(isRefill).sort(byExpiry);
  const bonuses = accounts.filter((a) => !isRefill(a)).sort(byExpiry);

  const quotas: QuotaItem[] = [];
  const seenRefill: Record<string, number> = {};

  for (const acc of refills) {
    const base = refillCadence(acc);
    seenRefill[base] = (seenRefill[base] || 0) + 1;
    const name = seenRefill[base] > 1 ? `${base} #${seenRefill[base]}` : base;
    const used = num(acc.CycleCapacityUsedPrecise, acc.CycleCapacityUsed);
    const total = num(acc.CycleCapacitySizePrecise, acc.CycleCapacitySize);
    const remaining = Math.max(0, total - used);
    const percentUsed = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;

    quotas.push({
      name: `${name} (${acc.PackageName || "Standard"})`,
      used,
      total,
      remaining,
      percentUsed,
      resetAt: parseResetTime(acc.CycleEndTime),
      recurring: true,
    });
  }

  bonuses.forEach((acc, i) => {
    const used = num(acc.CapacityUsedPrecise, acc.CapacityUsed);
    const total = num(acc.CapacitySizePrecise, acc.CapacitySize);
    const remaining = Math.max(0, total - used);
    const percentUsed = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;

    quotas.push({
      name: `Bonus Pack ${i + 1}${acc.PackageName ? ` (${acc.PackageName})` : ""}`,
      used,
      total,
      remaining,
      percentUsed,
      resetAt: parseResetTime(acc.CycleEndTime),
      recurring: false,
    });
  });

  const basePkg = refills[0] || accounts[0] || {};
  const plan = basePkg.PackageName || basePkg.SubProductName || "CodeBuddy";

  return {
    plan,
    region: regionConfig.region,
    quotas,
    rawAccountsCount: accounts.length,
  };
}
