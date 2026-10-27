/**
 * Security utilities for masking sensitive credentials and error messages
 */

export function maskToken(token?: string): string {
  if (!token) return "none";
  const trimmed = token.trim();
  if (trimmed.length <= 10) return "***";
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

export function maskEmail(email?: string): string {
  if (!email) return "none";
  const atIdx = email.indexOf("@");
  if (atIdx <= 1) return `*@${email.slice(atIdx + 1)}`;
  const name = email.slice(0, atIdx);
  const domain = email.slice(atIdx);
  return `${name[0]}***${domain}`;
}

const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /X-Refresh-Token:\s*[A-Za-z0-9._~+/-]+=*/gi,
  /access_token["']?\s*[:=]\s*["']?([A-Za-z0-9._~+/-]+)/gi,
  /refresh_token["']?\s*[:=]\s*["']?([A-Za-z0-9._~+/-]+)/gi,
  /sk-[A-Za-z0-9]{20,}/gi,
];

export function redactSecrets(text: string): string {
  if (!text) return "";
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, (match) => {
      if (match.toLowerCase().startsWith("bearer ")) {
        return "Bearer [REDACTED]";
      }
      if (match.toLowerCase().startsWith("x-refresh-token:")) {
        return "X-Refresh-Token: [REDACTED]";
      }
      return "[REDACTED]";
    });
  }
  return result;
}

export function parseResetTime(raw?: unknown): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Pattern: 2026-04-01 08:00:00 UTC+08:00 or 2026-04-01 08:00:00
  const match = trimmed.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})(?:\s*UTC\+?([0-9:]+))?/i);
  if (match) {
    const dp = match[1];
    const tp = match[2];
    const tz = match[3]
      ? match[3].includes(":")
        ? match[3].startsWith("+")
          ? match[3]
          : `+${match[3]}`
        : `+${match[3].padStart(2, "0")}:00`
      : "+08:00";
    const dt = new Date(`${dp}T${tp}${tz}`);
    if (!Number.isNaN(dt.getTime())) {
      return dt.toISOString();
    }
  }

  // Fallback ISO or standard Date parse
  const direct = new Date(trimmed);
  if (!Number.isNaN(direct.getTime())) {
    return direct.toISOString();
  }

  return trimmed;
}
