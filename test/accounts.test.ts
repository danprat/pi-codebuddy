import { describe, expect, it } from "bun:test";
import {
  addAccountFromToken,
  getRoutingMode,
  listAccounts,
  loadAccountStore,
  markAccountCooldown,
  markAccountRestricted,
  setRoutingMode,
  updateAccountCredits,
} from "../src/auth/accounts.js";

describe("Multi-Account Management & Routing", () => {
  it("allows setting and reading routing modes", () => {
    setRoutingMode("round-robin");
    expect(getRoutingMode()).toBe("round-robin");

    setRoutingMode("least-used");
    expect(getRoutingMode()).toBe("least-used");

    setRoutingMode("failover");
    expect(getRoutingMode()).toBe("failover");
  });

  it("adds accounts from token and marks status", () => {
    // Fake JWT with email
    const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ email: "test-user-99@example.com", exp: 2000000000 }),
    ).toString("base64url");
    const fakeJwt = `${header}.${payload}.signature`;

    const account = addAccountFromToken(fakeJwt);
    expect(account.email).toBe("test-user-99@example.com");

    // Mark cooldown
    const resetTime = Date.now() + 60000;
    markAccountCooldown(account.accountId, resetTime);
    let list = listAccounts();
    let found = list.find((a) => a.accountId === account.accountId);
    expect(found?.cooldownUntil).toBe(resetTime);

    // Mark restricted
    markAccountRestricted(account.accountId, "Restricted test");
    list = listAccounts();
    found = list.find((a) => a.accountId === account.accountId);
    expect(found?.restricted).toBe(true);

    // Update credits
    updateAccountCredits(account.accountId, 75.5);
    list = listAccounts();
    found = list.find((a) => a.accountId === account.accountId);
    expect(found?.remainingCredits).toBe(75.5);
  });
});
