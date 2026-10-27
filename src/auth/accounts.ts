import { createHash } from "node:crypto";
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getActiveRegion, type CodeBuddyRegion } from "../client/config.js";
import { refreshCodeBuddyToken, type CodeBuddyOAuthCredentials } from "./oauth.js";

const ACCOUNTS_FILE = "codebuddy-accounts.json";
const AUTH_FILE = "auth.json";
const REFRESH_SKEW_MS = 5 * 60 * 1000;

export type AccountRoutingMode = "failover" | "round-robin" | "least-used";

export interface StoredAccount extends CodeBuddyOAuthCredentials {
  accountId: string;
  addedAt: number;
  lastUsedAt: number;
  email?: string;
  cooldownUntil?: number;
  restricted?: boolean;
  lastError?: string;
  remainingCredits?: number;
}

interface AccountsFile {
  version: 1;
  activeAccountId?: string;
  routingMode?: AccountRoutingMode;
  roundRobinIndex?: number;
  accounts: Record<string, StoredAccount>;
}

export interface AccountSummary {
  accountId: string;
  email?: string;
  region?: CodeBuddyRegion;
  active: boolean;
  lastUsedAt: number;
  cooldownUntil?: number;
  restricted?: boolean;
  remainingCredits?: number;
}

function agentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

function accountsPath(): string {
  return join(agentDir(), ACCOUNTS_FILE);
}

function authPath(): string {
  return join(agentDir(), AUTH_FILE);
}

function readJsonObject(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function writePrivateJson(path: string, value: unknown): void {
  const tempPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(tempPath, 0o600);
  renameSync(tempPath, path);
  chmodSync(path, 0o600);
}

function emptyStore(): AccountsFile {
  return { version: 1, accounts: {} };
}

function isStoredAccount(value: unknown): value is StoredAccount {
  if (!value || typeof value !== "object") return false;
  const account = value as Partial<StoredAccount>;
  return typeof account.access === "string" && account.access.length > 0;
}

function normalizeStore(value: Record<string, unknown> | undefined): AccountsFile {
  if (!value || value.version !== 1 || !value.accounts || typeof value.accounts !== "object") {
    return emptyStore();
  }
  const accounts: Record<string, StoredAccount> = {};
  for (const [key, raw] of Object.entries(value.accounts as Record<string, unknown>)) {
    if (!isStoredAccount(raw)) continue;
    const accountId =
      typeof raw.accountId === "string" && raw.accountId.trim() ? raw.accountId : key;
    accounts[accountId] = { ...raw, accountId };
  }
  const activeAccountId =
    typeof value.activeAccountId === "string" && accounts[value.activeAccountId]
      ? value.activeAccountId
      : undefined;
  const routingMode =
    value.routingMode === "round-robin" || value.routingMode === "least-used"
      ? value.routingMode
      : "failover";
  const roundRobinIndex = typeof value.roundRobinIndex === "number" ? value.roundRobinIndex : 0;
  return {
    version: 1,
    activeAccountId,
    routingMode,
    roundRobinIndex,
    accounts,
  };
}

export function loadAccountStore(): AccountsFile {
  return normalizeStore(readJsonObject(accountsPath()));
}

function saveAccountStore(store: AccountsFile): void {
  writePrivateJson(accountsPath(), store);
}

function accountIdFor(credentials: CodeBuddyOAuthCredentials): string {
  if (credentials.email?.trim()) return credentials.email.trim().toLowerCase();
  const token = credentials.refresh || credentials.access;
  return `cb-${createHash("sha256").update(token).digest("hex").slice(0, 12)}`;
}

function accountFromCredentials(
  credentials: CodeBuddyOAuthCredentials,
  existing?: StoredAccount,
): StoredAccount {
  const now = Date.now();
  return {
    ...credentials,
    accountId: existing?.accountId || accountIdFor(credentials),
    addedAt: existing?.addedAt || now,
    lastUsedAt: now,
    region: credentials.region || existing?.region || getActiveRegion(),
    cooldownUntil: existing?.cooldownUntil,
    restricted: existing?.restricted,
    remainingCredits: existing?.remainingCredits,
    lastError: existing?.lastError,
  };
}

function sortedAccounts(store: AccountsFile): StoredAccount[] {
  return Object.values(store.accounts).sort((a, b) => {
    if (a.addedAt !== b.addedAt) return a.addedAt - b.addedAt;
    return a.accountId.localeCompare(b.accountId);
  });
}

function findAccount(
  store: AccountsFile,
  credentials: CodeBuddyOAuthCredentials,
): StoredAccount | undefined {
  return Object.values(store.accounts).find(
    (account) =>
      account.access === credentials.access ||
      (account.refresh && account.refresh === credentials.refresh),
  );
}

function findAccountId(store: AccountsFile, selector: string): string | undefined {
  const normalized = selector.trim().toLowerCase();
  if (!normalized) return undefined;
  const entries = sortedAccounts(store);
  if (/^\d+$/.test(normalized)) {
    const index = Number.parseInt(normalized, 10);
    if (index >= 1 && index <= entries.length) return entries[index - 1]?.accountId;
    return undefined;
  }
  return entries.find(
    (account) =>
      account.accountId.toLowerCase() === normalized ||
      account.email?.trim().toLowerCase() === normalized,
  )?.accountId;
}

function readAuthFile(): Record<string, unknown> {
  const path = authPath();
  if (!existsSync(path)) return {};
  const parsed = readJsonObject(path);
  if (!parsed) return {};
  return parsed;
}

function writeActiveCredential(account: StoredAccount | undefined): void {
  const auth = readAuthFile();
  if (account) {
    auth.codebuddy = {
      type: "oauth",
      access: account.access,
      refresh: account.refresh,
      expires: account.expires,
      region: account.region,
      email: account.email,
    };
  } else {
    delete auth.codebuddy;
  }
  writePrivateJson(authPath(), auth);
}

function currentAuthCredentials(): CodeBuddyOAuthCredentials | undefined {
  const current = readJsonObject(authPath())?.codebuddy;
  if (!current || typeof current !== "object") return undefined;
  const record = current as Record<string, unknown>;
  if (typeof record.access !== "string" || !record.access) return undefined;
  return {
    access: record.access,
    refresh: typeof record.refresh === "string" ? record.refresh : "",
    expires: typeof record.expires === "number" ? record.expires : 0,
    region: typeof record.region === "string" ? (record.region as CodeBuddyRegion) : undefined,
    email: typeof record.email === "string" ? record.email : undefined,
  };
}

export function syncCurrentAuth(): void {
  const credentials = currentAuthCredentials();
  if (!credentials) return;
  const store = loadAccountStore();
  const existing = findAccount(store, credentials);
  const account = accountFromCredentials(credentials, existing);
  store.accounts[account.accountId] = account;
  store.activeAccountId = account.accountId;
  saveAccountStore(store);
}

export function rememberAccount(credentials: CodeBuddyOAuthCredentials): StoredAccount {
  syncCurrentAuth();
  const store = loadAccountStore();
  const existing = findAccount(store, credentials);
  const account = accountFromCredentials(credentials, existing);
  store.accounts[account.accountId] = account;
  store.activeAccountId = account.accountId;
  saveAccountStore(store);
  writeActiveCredential(account);
  return account;
}

export function updateRememberedAccount(
  previous: CodeBuddyOAuthCredentials,
  credentials: CodeBuddyOAuthCredentials,
): void {
  const store = loadAccountStore();
  const existing = findAccount(store, previous);
  if (!existing) return;
  const account = accountFromCredentials(credentials, existing);
  delete store.accounts[existing.accountId];
  store.accounts[account.accountId] = account;
  if (store.activeAccountId === existing.accountId) {
    store.activeAccountId = account.accountId;
  }
  saveAccountStore(store);
  writeActiveCredential(account);
}

export function getRoutingMode(): AccountRoutingMode {
  const store = loadAccountStore();
  return store.routingMode || "failover";
}

export function setRoutingMode(mode: AccountRoutingMode): void {
  const store = loadAccountStore();
  store.routingMode = mode;
  saveAccountStore(store);
}

export function markAccountCooldown(tokenOrId: string, resetsAtMs: number): void {
  const store = loadAccountStore();
  for (const account of Object.values(store.accounts)) {
    if (account.accountId === tokenOrId || account.access === tokenOrId) {
      account.cooldownUntil = resetsAtMs;
      saveAccountStore(store);
      break;
    }
  }
}

export function markAccountRestricted(tokenOrId: string, reason?: string): void {
  const store = loadAccountStore();
  for (const account of Object.values(store.accounts)) {
    if (account.accountId === tokenOrId || account.access === tokenOrId) {
      account.restricted = true;
      account.lastError = reason || "Account restricted (11140)";
      saveAccountStore(store);
      break;
    }
  }
}

export function updateAccountCredits(accountId: string, credits: number): void {
  const store = loadAccountStore();
  if (store.accounts[accountId]) {
    store.accounts[accountId]!.remainingCredits = credits;
    saveAccountStore(store);
  }
}

export function addAccountFromToken(
  token: string,
  options?: { refresh?: string; region?: CodeBuddyRegion },
): StoredAccount {
  let email: string | undefined;
  try {
    const parts = token.split(".");
    if (parts[1]) {
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
      email = payload.email || payload.preferred_username;
    }
  } catch {
    // ignore
  }

  const credentials: CodeBuddyOAuthCredentials = {
    access: token.trim(),
    refresh: options?.refresh?.trim() || "",
    expires: Date.now() + 86400 * 1000 - 5 * 60 * 1000,
    region: options?.region || getActiveRegion(),
    email,
  };

  return rememberAccount(credentials);
}

export function listAccounts(): AccountSummary[] {
  syncCurrentAuth();
  const store = loadAccountStore();
  return sortedAccounts(store).map((account) => ({
    accountId: account.accountId,
    email: account.email,
    region: account.region,
    active: account.accountId === store.activeAccountId,
    lastUsedAt: account.lastUsedAt,
    cooldownUntil: account.cooldownUntil,
    restricted: account.restricted,
    remainingCredits: account.remainingCredits,
  }));
}

export async function ensureFresh(account: StoredAccount): Promise<StoredAccount> {
  if (account.access && account.expires > Date.now() + REFRESH_SKEW_MS) {
    return account;
  }
  if (!account.refresh) {
    return account;
  }
  const refreshed = await refreshCodeBuddyToken(account, account.region);
  return accountFromCredentials(refreshed, account);
}

export async function activateAccount(selector: string): Promise<StoredAccount> {
  syncCurrentAuth();
  const store = loadAccountStore();
  const accountId = findAccountId(store, selector);
  if (!accountId) throw new Error(`CodeBuddy account not found: ${selector}`);
  const existing = store.accounts[accountId];
  if (!existing) throw new Error(`CodeBuddy account not found: ${selector}`);
  const account = await ensureFresh(existing);
  account.lastUsedAt = Date.now();
  store.accounts[account.accountId] = account;
  store.activeAccountId = account.accountId;
  saveAccountStore(store);
  writeActiveCredential(account);
  return account;
}

export async function removeAccount(selector: string): Promise<StoredAccount | undefined> {
  syncCurrentAuth();
  const store = loadAccountStore();
  const accountId = findAccountId(store, selector);
  if (!accountId) throw new Error(`CodeBuddy account not found: ${selector}`);
  delete store.accounts[accountId];
  let next: StoredAccount | undefined;
  if (store.activeAccountId === accountId) {
    next = sortedAccounts(store).sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0];
    if (next) {
      next = await ensureFresh(next);
      next.lastUsedAt = Date.now();
      store.accounts[next.accountId] = next;
    }
    store.activeAccountId = next?.accountId;
    writeActiveCredential(next);
  }
  saveAccountStore(store);
  return next;
}

/**
 * Select the best account for the next chat turn based on the configured routingMode:
 * - failover: use active account, fallback to next healthy account
 * - round-robin: rotate across healthy accounts per turn
 * - least-used: pick account with highest remaining credits / longest idle time
 */
export async function getAccountForNextTurn(
  triedAccessTokens: ReadonlySet<string> = new Set(),
): Promise<StoredAccount | undefined> {
  syncCurrentAuth();
  const store = loadAccountStore();
  const now = Date.now();

  // Healthy candidates: not restricted, not in active cooldown, not already tried
  const candidates = sortedAccounts(store).filter((account) => {
    if (triedAccessTokens.has(account.access)) return false;
    if (account.restricted) return false;
    if (account.cooldownUntil && account.cooldownUntil > now) return false;
    return true;
  });

  if (candidates.length === 0) {
    // If all healthy are exhausted but active account wasn't tried, check fallback
    return undefined;
  }

  const mode = store.routingMode || "failover";
  let selected: StoredAccount | undefined;

  if (mode === "round-robin") {
    let nextIdx = (store.roundRobinIndex ?? 0) % candidates.length;
    selected = candidates[nextIdx];
    store.roundRobinIndex = (nextIdx + 1) % candidates.length;
    saveAccountStore(store);
  } else if (mode === "least-used") {
    // Sort by remainingCredits desc, then lastUsedAt asc
    const sorted = [...candidates].sort((a, b) => {
      const credA = a.remainingCredits ?? 0;
      const credB = b.remainingCredits ?? 0;
      if (credA !== credB) return credB - credA;
      return a.lastUsedAt - b.lastUsedAt;
    });
    selected = sorted[0];
  } else {
    // Failover mode: use active account if healthy
    const active = store.activeAccountId ? store.accounts[store.activeAccountId] : undefined;
    if (active && !active.restricted && (!active.cooldownUntil || active.cooldownUntil <= now) && !triedAccessTokens.has(active.access)) {
      selected = active;
    } else {
      selected = candidates[0];
    }
  }

  if (selected) {
    try {
      const fresh = await ensureFresh(selected);
      fresh.lastUsedAt = Date.now();
      store.accounts[fresh.accountId] = fresh;
      store.activeAccountId = fresh.accountId;
      saveAccountStore(store);
      writeActiveCredential(fresh);
      return fresh;
    } catch {
      // If token refresh fails, try next candidate
      return getAccountForNextTurn(new Set([...triedAccessTokens, selected.access]));
    }
  }

  return undefined;
}

/**
 * Failover to next available account when rate limited or quota exhausted (429 / 6004 / 11140).
 */
export async function failoverToNextAccount(
  triedAccessTokens: ReadonlySet<string>,
): Promise<StoredAccount | undefined> {
  return getAccountForNextTurn(triedAccessTokens);
}

export async function resolveApiKeyFromContext(ctx?: ExtensionCommandContext): Promise<string | undefined> {
  if (process.env.CODEBUDDY_API_KEY?.trim()) {
    return process.env.CODEBUDDY_API_KEY.trim();
  }

  // Check Pi modelRegistry if available
  if (ctx && typeof (ctx as unknown as { modelRegistry?: { getApiKey?: (p: string) => Promise<string | undefined> } }).modelRegistry?.getApiKey === "function") {
    try {
      const key = await (ctx as unknown as { modelRegistry: { getApiKey: (p: string) => Promise<string | undefined> } }).modelRegistry.getApiKey("codebuddy");
      if (key?.trim()) return key.trim();
    } catch {
      // Fall through
    }
  }

  // Check active account store
  syncCurrentAuth();
  const store = loadAccountStore();
  if (store.activeAccountId && store.accounts[store.activeAccountId]) {
    const active = store.accounts[store.activeAccountId]!;
    const fresh = await ensureFresh(active);
    if (fresh.access !== active.access) {
      store.accounts[fresh.accountId] = fresh;
      saveAccountStore(store);
      writeActiveCredential(fresh);
    }
    return fresh.access;
  }

  // Check auth.json
  const current = currentAuthCredentials();
  if (current?.access) {
    return current.access;
  }

  const rawAuth = readJsonObject(authPath())?.codebuddy;
  if (typeof rawAuth === "string" && rawAuth.trim()) {
    return rawAuth.trim();
  }
  if (rawAuth && typeof rawAuth === "object") {
    const rec = rawAuth as Record<string, unknown>;
    if (typeof rec.key === "string" && rec.key.trim()) {
      return rec.key.trim();
    }
  }

  return undefined;
}
