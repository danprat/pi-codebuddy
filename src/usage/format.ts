import type { CodeBuddyUsageResult, QuotaItem } from "./usage.js";

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
