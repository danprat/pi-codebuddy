import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  activateAccount,
  listAccounts,
  loginCodeBuddy,
  refreshCodeBuddyToken,
  rememberAccount,
  removeAccount,
  resolveApiKeyFromContext,
  updateRememberedAccount,
  getApiKey,
} from "./auth/index.js";
import {
  getActiveRegion,
  getRegionConfig,
  PROVIDER_ID,
  PROVIDER_NAME,
  setActiveRegion,
  type CodeBuddyRegion,
} from "./client/index.js";
import { getLastDiagnostics, runWithDiagnostics } from "./diagnostics/index.js";
import { getModelCatalog } from "./models/index.js";
import { streamCodeBuddy } from "./stream/index.js";
import { fetchCodeBuddyUsage, formatUsageSummary } from "./usage/index.js";
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
    description: "Show CodeBuddy quota allowances (refill cycles and bonus packages)",
    handler: async (_args, ctx) => {
      try {
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
        emitCommandOutput(ctx, formatUsageSummary(usage));
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
    description: "List, switch, or remove linked CodeBuddy accounts",
    handler: async (args, ctx) => {
      const command = (args || "").trim();
      try {
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
        if (accounts.length === 0) {
          emitCommandOutput(
            ctx,
            "No linked CodeBuddy accounts found. Run /login codebuddy to connect one.",
            "warning",
          );
          return;
        }

        const lines = [
          "Linked CodeBuddy Accounts:",
          "───────────────────────────────────────────────────────",
        ];

        accounts.forEach((acc, i) => {
          const marker = acc.active ? "* " : "  ";
          const emailOrId = acc.email ? maskEmail(acc.email) : acc.accountId;
          const reg = acc.region ? ` [${acc.region.toUpperCase()}]` : "";
          lines.push(`${marker}${i + 1}. ${emailOrId}${reg}`);
        });

        lines.push("───────────────────────────────────────────────────────");
        lines.push("Commands: /codebuddy.accounts switch <index|id> or remove <index|id>");
        emitCommandOutput(ctx, lines.join("\n"));
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        emitCommandOutput(ctx, msg, "error");
      }
    },
  });

  // 5. /codebuddy.doctor
  pi.registerCommand("codebuddy.doctor", {
    description: "Check CodeBuddy diagnostics, connection status, and active region",
    handler: async (_args, ctx) => {
      const d = getLastDiagnostics();
      const currentRegion = getActiveRegion();
      const regionConfig = getRegionConfig(currentRegion);
      const accounts = listAccounts();
      const active = accounts.find((a) => a.active);
      const activeLabel = active ? (active.email ? maskEmail(active.email) : active.accountId) : "none";

      const lines = [
        "CodeBuddy Doctor Diagnostics",
        "───────────────────────────────────────────────────────",
        `provider=${PROVIDER_ID}`,
        `region=${currentRegion.toUpperCase()} (${regionConfig.name})`,
        `endpoint=${d.lastEndpoint || regionConfig.baseUrl}`,
        `activeAccount=${activeLabel}`,
        `linkedAccounts=${accounts.length}`,
        `lastModel=${d.lastModel || "none"}`,
        `lastStatus=${d.lastStatus ?? "none"}`,
        `lastLatencyMs=${d.lastLatencyMs !== undefined ? `${d.lastLatencyMs}ms` : "none"}`,
        `lastError=${d.lastError ? redactSecrets(d.lastError) : "none"}`,
        "transport=custom-streamSimple (OpenAI SSE + typed blocks)",
        "commands=/codebuddy.usage /codebuddy.models /codebuddy.region /codebuddy.accounts /codebuddy.doctor",
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
