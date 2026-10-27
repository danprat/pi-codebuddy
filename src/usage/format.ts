import type { CodeBuddyUsageResult, MultiAccountUsageSummary, QuotaItem } from "./usage.js";

function renderProgressBar(percent: number, width = 16): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${clamped}%`;
}

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return "unknown";
  const target = new Date(isoString).getTime();
  if (Number.isNaN(target)) return isoString;

  const diffMs = target - Date.now();
  if (diffMs <= 0) return "expired / resetting";

  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);
  const remainingHours = diffHours % 24;

  if (diffDays > 0) {
    return `${diffDays}d ${remainingHours}h`;
  }
  const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  return `${diffHours}h ${diffMins}m`;
}

export function formatUsageSummary(usage: CodeBuddyUsageResult): string {
  const lines: string[] = [];

  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push(`CodeBuddy Quota Usage (${usage.region.toUpperCase()}) — Plan: ${usage.plan}`);
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  if (usage.quotas.length === 0) {
    lines.push("No active quota packages found for this account.");
    lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    return lines.join("\n");
  }

  for (const q of usage.quotas) {
    const timingLabel = q.recurring ? "Resets in" : "Expires in";
    const timeDetail = formatRelativeTime(q.resetAt);
    const dateFormatted = q.resetAt ? ` (${q.resetAt.slice(0, 10)})` : "";

    lines.push(`• ${q.name}`);
    lines.push(`  Used:      ${q.used.toFixed(2)} / ${q.total.toFixed(2)} ${renderProgressBar(q.percentUsed)}`);
    lines.push(`  Remaining: ${q.remaining.toFixed(2)}`);
    lines.push(`  ${timingLabel}: ${timeDetail}${dateFormatted}`);
    lines.push("");
  }

  lines.push("Use /codebuddy.region to toggle between intl and cn.");
  return lines.join("\n");
}

export function formatMultiAccountSummary(summary: MultiAccountUsageSummary, routingMode = "failover"): string {
  const lines: string[] = [];
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push(`CodeBuddy Multi-Account Quota Pool (${summary.accounts.length} accounts)`);
  lines.push(`Routing Strategy: ${routingMode.toUpperCase()}`);
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  if (summary.accounts.length === 0) {
    lines.push("No linked accounts found. Run /login codebuddy to add one.");
    lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    return lines.join("\n");
  }

  for (let i = 0; i < summary.accounts.length; i++) {
    const acc = summary.accounts[i]!;
    const marker = acc.active ? "* " : "  ";
    const label = acc.email || acc.accountId;
    lines.push(`${marker}${i + 1}. ${label} [${acc.region.toUpperCase()}]${acc.active ? " (Active)" : ""}`);

    if (acc.error) {
      lines.push(`   Status: ⚠️ Error (${acc.error.slice(0, 80)})`);
      lines.push("");
      continue;
    }

    if (!acc.usage || acc.usage.quotas.length === 0) {
      lines.push("   Status: Connected (No quota packages found)");
      lines.push("");
      continue;
    }

    lines.push(`   Plan: ${acc.usage.plan}`);
    for (const q of acc.usage.quotas) {
      lines.push(`   • ${q.name}: ${q.used.toFixed(1)}/${q.total.toFixed(1)} ${renderProgressBar(q.percentUsed, 10)}`);
      lines.push(`     Remaining: ${q.remaining.toFixed(2)} credits | ${q.recurring ? "Resets" : "Expires"} in: ${formatRelativeTime(q.resetAt)}`);
    }
    lines.push("");
  }

  lines.push("────────────────────────────────────────────────────");
  lines.push(`TOTAL COMBINED POOL: ${summary.totalRemainingCredits.toFixed(2)} / ${summary.totalAvailableCredits.toFixed(2)} credits remaining`);
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  return lines.join("\n");
}
