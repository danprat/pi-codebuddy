import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  activateAccount,
  addAccountFromToken,
  ensureFresh,
  getRoutingMode,
  listAccounts,
  loadAccountStore,
  loginCodeBuddy,
  markAccountRestricted,
  refreshCodeBuddyToken,
  rememberAccount,
  removeAccount,
  resolveApiKeyFromContext,
  setRoutingMode,
  updateAccountCredits,
  updateRememberedAccount,
  getApiKey,
  type AccountRoutingMode,
} from "./auth/index.js";
import {
  getActiveRegion,
  getRegionConfig,
  prewarmConnection,
  PROVIDER_ID,
  PROVIDER_NAME,
  setActiveRegion,
  type CodeBuddyRegion,
} from "./client/index.js";
import { getLastDiagnostics, runWithDiagnostics } from "./diagnostics/index.js";
import { getModelCatalog } from "./models/index.js";
import { streamCodeBuddy } from "./stream/index.js";
import {
  fetchCodeBuddyUsage,
  fetchMultiAccountUsage,
  formatMultiAccountSummary,
  formatUsageSummary,
} from "./usage/index.js";
import { maskEmail, redactSecrets } from "./utils/index.js";

function emitCommandOutput(
  ctx: ExtensionCommandContext,
  text: string,
  type: "info" | "warning" | "error" = "info",
): void {
  if (ctx.hasUI) {
    ctx.ui.notify(text, type);
    return;
  }
  if (type === "warning" || type === "error") {
    console.error(text);
  } else {
    console.log(text);
  }
}

async function loginAndRemember(
  callbacks: Parameters<typeof loginCodeBuddy>[0],
): ReturnType<typeof loginCodeBuddy> {
  const credentials = await loginCodeBuddy(callbacks);
  rememberAccount(credentials);
  return credentials;
}

async function refreshAndRemember(
  credentials: Parameters<typeof refreshCodeBuddyToken>[0],
): ReturnType<typeof refreshCodeBuddyToken> {
  const refreshed = await refreshCodeBuddyToken(credentials);
  updateRememberedAccount(credentials, refreshed);
  return refreshed;
}

export default function (pi: ExtensionAPI): void {
  const initialRegionConfig = getRegionConfig();
  const models = getModelCatalog();

  // Pre-warm connection and check token freshness in background on session start
  pi.on("session_start", async () => {
    prewarmConnection(initialRegionConfig.baseUrl);

    // Background pre-emptive token refresh
    try {
      const store = loadAccountStore();
      if (store.activeAccountId && store.accounts[store.activeAccountId]) {
        const active = store.accounts[store.activeAccountId]!;
        // If token expires in less than 10 minutes, refresh proactively
        if (active.refresh && active.expires < Date.now() + 10 * 60 * 1000) {
          void ensureFresh(active).catch(() => {});
        }
      }
    } catch {
      // ignore
    }
  });

  const providerConfig = {
    name: PROVIDER_NAME,
    baseUrl: initialRegionConfig.baseUrl,
    apiKey: "$CODEBUDDY_API_KEY",
    api: "codebuddy-api",
    models: models.map((m) => ({
      id: m.id,
      name: m.name,
      reasoning: m.reasoning,
      input: m.input,
      cost: m.cost,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
    })),
    oauth: {
      name: PROVIDER_NAME,
      isSubscription: true,
      login: loginAndRemember,
      refreshToken: refreshAndRemember,
      getApiKey,
    },
    streamSimple: streamCodeBuddy,
  };

  pi.registerProvider(
    PROVIDER_ID,
    providerConfig as unknown as Parameters<typeof pi.registerProvider>[1],
  );

  // 1. /codebuddy.usage
  pi.registerCommand("codebuddy.usage", {
    description: "Show CodeBuddy quota allowances: /codebuddy.usage [--all]",
    handler: async (args, ctx) => {
      const isAll = Boolean(args && /--all|\ball\b/i.test(args));

      try {
        if (isAll) {
          if (ctx.hasUI) ctx.ui.notify("Fetching quota for all linked accounts...", "info");
          const multi = await runWithDiagnostics(() => fetchMultiAccountUsage());
          emitCommandOutput(ctx, formatMultiAccountSummary(multi, getRoutingMode()));
          return;
        }

        const token = await resolveApiKeyFromContext(ctx);
        if (!token) {
          emitCommandOutput(
            ctx,
            "No CodeBuddy credentials found. Run /login codebuddy or set CODEBUDDY_API_KEY first.",
            "warning",
          );
          return;
        }

        if (ctx.hasUI) ctx.ui.notify("Fetching CodeBuddy quota...", "info");
        const usage = await runWithDiagnostics(() => fetchCodeBuddyUsage(token));
        emitCommandOutput(ctx, `${formatUsageSummary(usage)}\n(Tip: use /codebuddy.usage --all to see all accounts)`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        emitCommandOutput(ctx, `CodeBuddy usage query failed: ${msg}`, "error");
      }
    },
  });

  // 2. /codebuddy.models
  pi.registerCommand("codebuddy.models", {
    description: "List available CodeBuddy models, reasoning capabilities, and context limits",
    handler: async (_args, ctx) => {
      const region = getActiveRegion();
      const lines = [
        `CodeBuddy Models (Region: ${region.toUpperCase()})`,
        "─────────────────────────────────────────────────────────────────",
        `${"ID".padEnd(22)} ${"Name".padEnd(20)} ${"Reasoning".padEnd(11)} ${"Context".padEnd(9)} Output`,
        "─────────────────────────────────────────────────────────────────",
      ];

      for (const m of models) {
        const ctxK = `${Math.round(m.contextWindow / 1000)}k`;
        const outK = `${Math.round(m.maxTokens / 1000)}k`;
        lines.push(
          `${m.id.padEnd(22)} ${m.name.padEnd(20)} ${(m.reasoning ? "Yes" : "No").padEnd(11)} ${ctxK.padEnd(9)} ${outK}`,
        );
      }

      lines.push("─────────────────────────────────────────────────────────────────");
      lines.push(`Total: ${models.length} models available.`);
      emitCommandOutput(ctx, lines.join("\n"));
    },
  });

  // 3. /codebuddy.region
  pi.registerCommand("codebuddy.region", {
    description: "Show or switch CodeBuddy region: /codebuddy.region [intl|cn]",
    handler: async (args, ctx) => {
      const target = args?.trim().toLowerCase();
      if (target === "intl" || target === "cn") {
        setActiveRegion(target as CodeBuddyRegion);
        const config = getRegionConfig(target as CodeBuddyRegion);
        prewarmConnection(config.baseUrl);
        emitCommandOutput(
          ctx,
          `Active CodeBuddy region switched to: ${config.name} (${target.toUpperCase()})\nEndpoint: ${config.baseUrl}`,
          "info",
        );
        return;
      }

      const current = getActiveRegion();
      const currentConfig = getRegionConfig(current);
      emitCommandOutput(
        ctx,
        `Current CodeBuddy Region: ${currentConfig.name} (${current.toUpperCase()})\nEndpoint: ${currentConfig.baseUrl}\n\nTo switch region, run:\n/codebuddy.region intl  (codebuddy.ai)\n/codebuddy.region cn    (copilot.tencent.com)`,
      );
    },
  });

  // 4. /codebuddy.accounts
  pi.registerCommand("codebuddy.accounts", {
    description: "Manage CodeBuddy accounts: switch, remove, add, mode [failover|round-robin|least-used]",
    handler: async (args, ctx) => {
      const command = (args || "").trim();
      try {
        if (command.startsWith("mode ")) {
          const modeInput = command.slice("mode ".length).trim().toLowerCase() as AccountRoutingMode;
          if (["failover", "round-robin", "least-used"].includes(modeInput)) {
            setRoutingMode(modeInput);
            emitCommandOutput(ctx, `Multi-account routing strategy set to: ${modeInput.toUpperCase()}`, "info");
            return;
          }
          emitCommandOutput(ctx, "Usage: /codebuddy.accounts mode [failover | round-robin | least-used]", "warning");
          return;
        }

        if (command.startsWith("add ")) {
          const rawToken = command.slice("add ".length).trim();
          if (!rawToken) {
            emitCommandOutput(ctx, "Usage: /codebuddy.accounts add <access_token>", "warning");
            return;
          }
          const account = addAccountFromToken(rawToken);
          emitCommandOutput(ctx, `Added account: ${account.email || account.accountId} (Active)`, "info");
          return;
        }

        if (command.startsWith("switch ")) {
          const selector = command.slice("switch ".length).trim();
          const account = await activateAccount(selector);
          emitCommandOutput(
            ctx,
            `Active CodeBuddy account switched to: ${account.email || account.accountId}`,
            "info",
          );
          return;
        }

        if (command.startsWith("remove ")) {
          const selector = command.slice("remove ".length).trim();
          const remaining = await removeAccount(selector);
          const next = remaining
            ? ` Active account is now: ${remaining.email || remaining.accountId}.`
            : " No remaining accounts.";
          emitCommandOutput(ctx, `CodeBuddy account removed.${next}`, "info");
          return;
        }

        const accounts = listAccounts();
        const currentMode = getRoutingMode();
        if (accounts.length === 0) {
          emitCommandOutput(
            ctx,
            "No linked CodeBuddy accounts found. Run /login codebuddy to connect one.",
            "warning",
          );
          return;
        }

        const lines = [
          `Linked CodeBuddy Accounts (Mode: ${currentMode.toUpperCase()}):`,
          "───────────────────────────────────────────────────────",
        ];

        accounts.forEach((acc, i) => {
          const marker = acc.active ? "* " : "  ";
          const emailOrId = acc.email ? maskEmail(acc.email) : acc.accountId;
          const reg = acc.region ? ` [${acc.region.toUpperCase()}]` : "";
          let statusExtra = "";
          if (acc.restricted) {
            statusExtra = " ⛔ [RESTRICTED 11140]";
          } else if (acc.cooldownUntil && acc.cooldownUntil > Date.now()) {
            const secs = Math.ceil((acc.cooldownUntil - Date.now()) / 1000);
            statusExtra = ` ⏳ [COOLDOWN ${secs}s]`;
          } else if (acc.remainingCredits !== undefined) {
            statusExtra = ` (${acc.remainingCredits.toFixed(1)} credits)`;
          }

          lines.push(`${marker}${i + 1}. ${emailOrId}${reg}${statusExtra}`);
        });

        lines.push("───────────────────────────────────────────────────────");
        lines.push("Commands:");
        lines.push("  /codebuddy.accounts switch <index|id>");
        lines.push("  /codebuddy.accounts mode [failover | round-robin | least-used]");
        lines.push("  /codebuddy.accounts add <token>");
        lines.push("  /codebuddy.accounts remove <index|id>");
        emitCommandOutput(ctx, lines.join("\n"));
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        emitCommandOutput(ctx, msg, "error");
      }
    },
  });

  // 5. /codebuddy.doctor
  pi.registerCommand("codebuddy.doctor", {
    description: "Check CodeBuddy diagnostics: /codebuddy.doctor [--fix]",
    handler: async (args, ctx) => {
      const isFix = Boolean(args && /--fix|\bfix\b/i.test(args));

      if (isFix) {
        if (ctx.hasUI) ctx.ui.notify("Running self-healing account check...", "info");
        const store = loadAccountStore();
        const results: string[] = ["CodeBuddy Self-Healing Doctor Results:"];
        let healed = 0;

        for (const acc of Object.values(store.accounts)) {
          const label = acc.email || acc.accountId;
          try {
            const fresh = await ensureFresh(acc);
            const usage = await fetchCodeBuddyUsage(fresh.access, fresh.region);
            const remaining = usage.quotas.reduce((s, q) => s + q.remaining, 0);
            updateAccountCredits(acc.accountId, remaining);
            results.push(`✓ ${label}: Healthy (${remaining.toFixed(1)} credits remaining)`);
            healed++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("11140") || msg.includes("unusual activity")) {
              markAccountRestricted(acc.accountId, msg);
              results.push(`⛔ ${label}: Flagged restricted (11140)`);
            } else {
              results.push(`⚠️ ${label}: ${msg.slice(0, 60)}`);
            }
          }
        }

        results.push(`Summary: ${healed} healthy accounts ready in the pool.`);
        emitCommandOutput(ctx, results.join("\n"), "info");
        return;
      }

      const d = getLastDiagnostics();
      const currentRegion = getActiveRegion();
      const regionConfig = getRegionConfig(currentRegion);
      const accounts = listAccounts();
      const active = accounts.find((a) => a.active);
      const activeLabel = active ? (active.email ? maskEmail(active.email) : active.accountId) : "none";
      const routingMode = getRoutingMode();

      const lines = [
        "CodeBuddy Doctor Diagnostics",
        "───────────────────────────────────────────────────────",
        `provider=${PROVIDER_ID}`,
        `region=${currentRegion.toUpperCase()} (${regionConfig.name})`,
        `endpoint=${d.lastEndpoint || regionConfig.baseUrl}`,
        `activeAccount=${activeLabel}`,
        `linkedAccounts=${accounts.length}`,
        `routingMode=${routingMode.toUpperCase()}`,
        `lastModel=${d.lastModel || "none"}`,
        `lastStatus=${d.lastStatus ?? "none"}`,
        `lastLatencyMs=${d.lastLatencyMs !== undefined ? `${d.lastLatencyMs}ms` : "none"}`,
        `lastError=${d.lastError ? redactSecrets(d.lastError) : "none"}`,
        "transport=custom-streamSimple (OpenAI SSE + typed blocks)",
        "tip=Run /codebuddy.doctor --fix to test and heal all accounts",
        "───────────────────────────────────────────────────────",
      ];

      emitCommandOutput(ctx, lines.join("\n"));
    },
  });

  // 6. /codebuddy.refresh
  pi.registerCommand("codebuddy.refresh", {
    description: "Force refresh CodeBuddy active credentials and verify connectivity",
    handler: async (_args, ctx) => {
      try {
        const token = await resolveApiKeyFromContext(ctx);
        if (!token) {
          emitCommandOutput(
            ctx,
            "No CodeBuddy credentials found. Run /login codebuddy first.",
            "warning",
          );
          return;
        }

        if (ctx.hasUI) ctx.ui.notify("Refreshing CodeBuddy connection...", "info");

        // Verify connectivity via usage endpoint
        const usage = await runWithDiagnostics(() => fetchCodeBuddyUsage(token));
        emitCommandOutput(
          ctx,
          `CodeBuddy verified successfully! Connected to ${usage.region.toUpperCase()} (${usage.plan}). Active quota packages: ${usage.quotas.length}.`,
          "info",
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        emitCommandOutput(ctx, `CodeBuddy verification failed: ${redactSecrets(msg)}`, "error");
      }
    },
  });
}
