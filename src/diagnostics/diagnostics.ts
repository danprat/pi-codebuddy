export interface CodeBuddyDiagnostics {
  lastEndpoint?: string;
  lastStatus?: number;
  lastLatencyMs?: number;
  lastError?: string;
  lastModel?: string;
  lastRegion?: string;
}

const currentDiagnostics: CodeBuddyDiagnostics = {};

export function setLastEndpoint(endpoint?: string): void {
  currentDiagnostics.lastEndpoint = endpoint;
}

export function setLastStatus(status?: number): void {
  currentDiagnostics.lastStatus = status;
}

export function setLastLatencyMs(latencyMs?: number): void {
  currentDiagnostics.lastLatencyMs = latencyMs;
}

export function setLastError(error?: string): void {
  currentDiagnostics.lastError = error;
}

export function setLastModel(model?: string): void {
  currentDiagnostics.lastModel = model;
}

export function setLastRegion(region?: string): void {
  currentDiagnostics.lastRegion = region;
}

export function getLastDiagnostics(): CodeBuddyDiagnostics {
  return { ...currentDiagnostics };
}

export async function runWithDiagnostics<T>(fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    setLastLatencyMs(Date.now() - start);
    return result;
  } catch (err) {
    setLastLatencyMs(Date.now() - start);
    setLastError(err instanceof Error ? err.message : String(err));
    throw err;
  }
}
