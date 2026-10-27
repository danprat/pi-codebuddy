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

export interface StoredAccount extends CodeBuddyOAuthCredentials {
  accountId: string;
  addedAt: number;
  lastUsedAt: number;
  email?: string;
}

interface AccountsFile {
  version: 1;
  activeAccountId?: string;
  accounts: Record<string, StoredAccount>;
}

export interface AccountSummary {
  accountId: string;
  email?: string;
  region?: CodeBuddyRegion;
  active: boolean;
  lastUsedAt: number;
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
  return {
    version: 1,
    activeAccountId,
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

export function listAccounts(): AccountSummary[] {
  syncCurrentAuth();
  const store = loadAccountStore();
  return sortedAccounts(store).map((account) => ({
    accountId: account.accountId,
    email: account.email,
    region: account.region,
    active: account.accountId === store.activeAccountId,
    lastUsedAt: account.lastUsedAt,
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
 * Failover to next available account when rate limited or quota exhausted (429 / 6004).
 */
export async function failoverToNextAccount(
  triedAccessTokens: ReadonlySet<string>,
): Promise<StoredAccount | undefined> {
  syncCurrentAuth();
  const store = loadAccountStore();
  const candidates = sortedAccounts(store).filter(
    (account) => !triedAccessTokens.has(account.access),
  );
  for (const candidate of candidates) {
    try {
      const account = await ensureFresh(candidate);
      if (!account.access || triedAccessTokens.has(account.access)) continue;
      account.lastUsedAt = Date.now();
      store.accounts[account.accountId] = account;
      store.activeAccountId = account.accountId;
      saveAccountStore(store);
      writeActiveCredential(account);
      return account;
    } catch {
      // Skip invalid accounts
    }
  }
  return undefined;
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
