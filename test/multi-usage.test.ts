import { describe, expect, it } from "bun:test";
import { formatMultiAccountSummary } from "../src/usage/format.js";
import type { MultiAccountUsageSummary } from "../src/usage/usage.js";

describe("Multi-Account Usage Formatting", () => {
  it("formats multi-account dashboard cleanly with totals and progress bars", () => {
    const summary: MultiAccountUsageSummary = {
      accounts: [
        {
          accountId: "acc-1",
          email: "dev1@example.com",
          active: true,
          region: "intl",
          usage: {
            plan: "Free Plan",
            region: "intl",
            rawAccountsCount: 1,
            quotas: [
              {
                name: "Monthly Allowance",
                used: 20,
                total: 100,
                remaining: 80,
                percentUsed: 20,
                resetAt: new Date(Date.now() + 86400000).toISOString(),
                recurring: true,
              },
            ],
          },
        },
        {
          accountId: "acc-2",
          email: "dev2@example.com",
          active: false,
          region: "intl",
          usage: {
            plan: "Free Plan",
            region: "intl",
            rawAccountsCount: 1,
            quotas: [
              {
                name: "Monthly Allowance",
                used: 5,
                total: 100,
                remaining: 95,
                percentUsed: 5,
                resetAt: new Date(Date.now() + 86400000).toISOString(),
                recurring: true,
              },
            ],
          },
        },
      ],
      totalRemainingCredits: 175,
      totalAvailableCredits: 200,
      totalUsedCredits: 25,
    };

    const formatted = formatMultiAccountSummary(summary, "round-robin");

    expect(formatted).toContain("CodeBuddy Multi-Account Quota Pool (2 accounts)");
    expect(formatted).toContain("ROUND-ROBIN");
    expect(formatted).toContain("dev1@example.com");
    expect(formatted).toContain("dev2@example.com");
    expect(formatted).toContain("TOTAL COMBINED POOL: 175.00 / 200.00 credits remaining");
  });
});
