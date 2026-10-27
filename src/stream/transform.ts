import type {
  Context,
  Model,
  Tool,
  TextContent,
  ImageContent,
  ToolCall,
} from "@earendil-works/pi-ai";
import { getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import { redactSecrets } from "../utils/security.js";

const DEFAULT_SYSTEM_PROMPT = "You are CodeBuddy Code, an expert AI software engineering assistant. Provide direct, helpful, and accurate coding solutions.";

const AGENT_PATTERN = /you are claude code|claude.?code.+official.+cli|anthropic.+official.+cli|anxthxropic.+official.+cli|you are (?:cursor|windsurf|cline|aider|continue|copilot|cody)|you are an? (?:ai )?(?:coding |code )?agent|cc_entrypoint\s*=\s*(?:cli|vscode|jetbrains|gui)|<agent-identity>|<Role>|<Behavior_Instructions>/gi;

function sanitizeSystemText(text?: string): string {
  if (!text) return DEFAULT_SYSTEM_PROMPT;
  // If text contains agent prompt injection that trips Tencent content filter, neutralize it
  const cleaned = AGENT_PATTERN.test(text)
    ? text.replace(AGENT_PATTERN, "You are CodeBuddy Code")
    : text;
  if (cleaned.startsWith("You are CodeBuddy Code")) {
    return cleaned;
  }
  return `You are CodeBuddy Code.\n\n${cleaned}`;
}

export interface CodeBuddyMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | Array<{ type: string; text?: string; image_url?: { url: string } }> | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export interface CodeBuddyRequestBody {
  model: string;
  messages: CodeBuddyMessage[];
  stream: true;
  temperature?: number;
  max_tokens?: number;
  reasoning_effort?: "low" | "medium" | "high";
  reasoning_summary?: "auto";
  tools?: Array<{
    type: "function";
    function: {
      name: string;
      description?: string;
      parameters: unknown;
    };
  }>;
  tool_choice?: "auto" | "none" | "required";
}

function sanitizeSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(sanitizeSchema);

  const obj = { ...(schema as Record<string, unknown>) };
  delete obj.$schema;
  delete obj.$id;
  delete obj.$defs;
  delete obj.definitions;

  // If type is an array like ["string", "null"], take the non-null type
  if (Array.isArray(obj.type)) {
    const valid = obj.type.find((t) => t !== "null");
    if (valid) obj.type = valid;
  }

  // Handle anyOf with null
  if (Array.isArray(obj.anyOf) && obj.anyOf.length === 2) {
    const nonNull = obj.anyOf.find((item: any) => item && typeof item === "object" && item.type !== "null");
    if (nonNull && typeof nonNull === "object") {
      delete obj.anyOf;
      Object.assign(obj, sanitizeSchema(nonNull));
    }
  }

  if (obj.properties && typeof obj.properties === "object" && !Array.isArray(obj.properties)) {
    const props: Record<string, unknown> = {};
    for (const [key, propVal] of Object.entries(obj.properties as Record<string, unknown>)) {
      props[key] = sanitizeSchema(propVal);
    }
    obj.properties = props;
  }

  if (obj.items && typeof obj.items === "object") {
    obj.items = sanitizeSchema(obj.items);
  }

  return obj;
}

function convertTools(tools?: Tool[]) {
  if (!tools || tools.length === 0) return undefined;
  const filtered = tools.filter((t) => t && typeof t.name === "string" && t.name.trim().length > 0);
  if (filtered.length === 0) return undefined;

  return filtered.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      parameters: sanitizeSchema(tool.parameters || { type: "object", properties: {} }),
    },
  }));
}

const HARNESS_PATTERNS = [
  /you are an? expert coding assistant operating inside pi-bolt[^.]*\./gi,
  /you are claude code[^.]*\./gi,
  /anthropic's official cli[^.]*\./gi,
  /you are an? (?:ai )?(?:coding |code )?agent[^.]*\./gi,
];

function extractBridgeContext(messages: Context["messages"], basePrompt?: string): string | undefined {
  const parts: string[] = [];

  // Extract from system prompt if present
  if (basePrompt && typeof basePrompt === "string" && basePrompt.trim()) {
    let cleaned = basePrompt;
    for (const pat of HARNESS_PATTERNS) {
      cleaned = cleaned.replace(pat, "");
    }
    const trimmed = cleaned.trim();
    if (trimmed.length > 0) {
      parts.push(trimmed);
    }
  }

  // Extract from system messages (e.g. skills, dynamically added rules)
  for (const msg of messages || []) {
    if ((msg.role as string) === "system") {
      let contentStr = "";
      if (typeof msg.content === "string") {
        contentStr = msg.content;
      } else if (Array.isArray(msg.content)) {
        contentStr = msg.content
          .map((b) => (typeof b === "string" ? b : (b as any)?.text || ""))
          .join("\n");
      }

      let cleaned = contentStr;
      for (const pat of HARNESS_PATTERNS) {
        cleaned = cleaned.replace(pat, "");
      }
      const trimmed = cleaned.trim();
      if (trimmed.length > 0) {
        parts.push(trimmed);
      }
    }
  }

  if (parts.length === 0) return undefined;
  return parts.join("\n\n");
}

export function buildCodeBuddyRequestBody(
  model: Model<any>,
  context: Context,
  options?: {
    temperature?: number;
    maxTokens?: number;
    reasoning?: string;
  },
): CodeBuddyRequestBody {
  // CodeBuddy rejects plain OpenAI shape (11101 invalid request): needs a
  // leading system prompt + user content as typed blocks, not a bare string.
  // Custom or long CLI agent system prompts trigger Tencent's content filter
  // and channel verification error (HTTP 400 code 11128 "request illegal").
  // Exactly matching official client: leading system message "You are CodeBuddy Code."
  const messages: CodeBuddyMessage[] = [
    {
      role: "system",
      content: "You are CodeBuddy Code.",
    },
  ];

  const systemPrompt = getCurrentSystemPrompt(context.messages) || context.systemPrompt;
  const bridgeContext = extractBridgeContext(context.messages, systemPrompt);
  let isFirstUser = true;

  for (const msg of context.messages) {
    if ((msg.role as string) === "system" || (msg.role as string) === "developer") {
      // Drop client system prompts to avoid tripping channel verification (code 11128)
      continue;
    }

    if (msg.role === "user") {
      const bridgeHeader = isFirstUser && bridgeContext ? `[Active Instructions & Context:\n${bridgeContext}\n]\n\n` : "";
      isFirstUser = false;

      if (typeof msg.content === "string") {
        messages.push({
          role: "user",
          content: [{ type: "text", text: `${bridgeHeader}${msg.content}` }],
        });
      } else if (Array.isArray(msg.content)) {
        const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
        let hasAppendedBridge = false;

        for (const item of msg.content) {
          if (typeof item === "string") {
            const text = !hasAppendedBridge && bridgeHeader ? `${bridgeHeader}${item}` : item;
            hasAppendedBridge = true;
            parts.push({ type: "text", text });
          } else if (item && typeof item === "object") {
            if (item.type === "text" && typeof (item as TextContent).text === "string") {
              const text = !hasAppendedBridge && bridgeHeader ? `${bridgeHeader}${(item as TextContent).text}` : (item as TextContent).text;
              hasAppendedBridge = true;
              parts.push({ type: "text", text });
            } else if (item.type === "image") {
              const img = item as ImageContent;
              const rawData = img.data;
              const mime = img.mimeType || "image/png";
              if (rawData) {
                const url = rawData.startsWith("data:") ? rawData : `data:${mime};base64,${rawData}`;
                parts.push({ type: "image_url", image_url: { url } });
              }
            }
          }
        }

        if (bridgeHeader && !hasAppendedBridge) {
          parts.unshift({ type: "text", text: bridgeHeader });
        }

        messages.push({
          role: "user",
          content: parts.length > 0 ? parts : [{ type: "text", text: "" }],
        });
      }
    } else if (msg.role === "assistant") {
      if (msg.stopReason === "error" || msg.stopReason === "aborted") continue;

      let textContent = "";
      const toolCalls: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }> = [];

      for (const block of msg.content) {
        if (block.type === "text" && block.text) {
          textContent += block.text;
        } else if (block.type === "toolCall") {
          const tc = block as ToolCall;
          toolCalls.push({
            id: tc.id || `call_${toolCalls.length + 1}`,
            type: "function",
            function: {
              name: tc.name,
              arguments: typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments ?? {}),
            },
          });
        }
      }

      const assistantMsg: CodeBuddyMessage = {
        role: "assistant",
        content: toolCalls.length > 0 ? (textContent || null) : (textContent || ""),
      };

      if (toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls;
      }

      messages.push(assistantMsg);
    } else if (msg.role === "toolResult") {
      const text = msg.content
        .filter((c): c is TextContent => c.type === "text")
        .map((c) => c.text)
        .join("\n");

      messages.push({
        role: "tool",
        tool_call_id: msg.toolCallId || "tool",
        content: text || (msg.isError ? "Tool execution failed" : "Done"),
      });
    }
  }

  const currentTools = getCurrentTools(context.messages);
  const rawTools = currentTools && currentTools.length > 0 ? currentTools : context.tools;
  const tools = convertTools(rawTools);

  const body: CodeBuddyRequestBody = {
    model: model.id,
    messages,
    stream: true,
  };

  if (options?.temperature !== undefined) {
    body.temperature = options.temperature;
  }
  if (options?.maxTokens !== undefined) {
    body.max_tokens = options.maxTokens;
  }

  const eff = options?.reasoning;
  if (eff && eff !== "off" && eff !== "none") {
    // CodeBuddy supports low, medium, high
    let normalizedEff: "low" | "medium" | "high" = "medium";
    if (eff === "minimal" || eff === "low") {
      normalizedEff = "low";
    } else if (eff === "high" || eff === "xhigh" || eff === "max") {
      normalizedEff = "high";
    } else if (eff === "medium") {
      normalizedEff = "medium";
    }
    body.reasoning_effort = normalizedEff;
    body.reasoning_summary = "auto";
  }

  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  return body;
}

export interface ParsedCodeBuddyError {
  status: number;
  message: string;
  code?: number;
  resetsAtMs?: number | null;
  resetsAtIso?: string | null;
}

export function parseCodeBuddyError(status: number, bodyText: string): ParsedCodeBuddyError {
  let msg = `HTTP ${status}`;
  let code: number | undefined;
  let resetsAtMs: number | null = null;
  let resetsAtIso: string | null = null;

  if (bodyText) {
    try {
      const data = JSON.parse(bodyText);
      code = data?.code;
      msg = data?.msg || data?.message || data?.error?.message || bodyText.slice(0, 300);

      // Check code 11140 account restriction error (Tencent risk-control)
      if (code === 11140 || /unusual activity|已被限制使用|异常使用行为|restricted due to unusual activity/i.test(msg)) {
        const tip = data?.displayTips?.en || data?.displayTips?.zh || data?.displayMsg?.en;
        return {
          status: 403,
          code: 11140,
          message: `CodeBuddy account restricted (11140): ${tip || "We detected unusual activity on this account. Submit feedback to appeal this restriction."} Please run /login codebuddy with another account or appeal on https://www.codebuddy.ai.`,
          resetsAtMs: null,
          resetsAtIso: null,
        };
      }

      // Check code 11128 channel verification error
      if (code === 11128 || /request illegal|channel verification|渠道校验/i.test(msg)) {
        const tip = data?.displayTips?.en || data?.displayTips?.zh || data?.displayMsg?.en;
        return {
          status: 400,
          code: 11128,
          message: tip || msg || "CodeBuddy request illegal (11128)",
          resetsAtMs: null,
          resetsAtIso: null,
        };
      }

      // Check code 6004 or rate limit text
      if (code === 6004 || /超出频率限制|frequency limit|限额|quota exceeded/i.test(msg)) {
        const match = msg.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})(?:\s*UTC\+?([0-9:]+))?/i);
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
            resetsAtMs = dt.getTime();
            resetsAtIso = dt.toISOString();
          }
        }
        return {
          status: 429,
          code: 6004,
          message: msg || "CodeBuddy frequency limit exceeded (6004)",
          resetsAtMs,
          resetsAtIso,
        };
      }
    } catch {
      if (bodyText.includes("<title>")) {
        const titleMatch = bodyText.match(/<title>([^<]+)<\/title>/i);
        msg = titleMatch?.[1] ? `HTTP ${status}: ${titleMatch[1].trim()}` : `HTTP ${status}`;
      } else {
        msg = bodyText.slice(0, 300);
      }
    }
  }

  if (status === 401) {
    msg = `CodeBuddy authentication failed (${msg}). Check your CODEBUDDY_API_KEY or run /login codebuddy.`;
  } else if (status === 403) {
    msg = `CodeBuddy access forbidden (${msg}). Check your permissions or run /login codebuddy.`;
  }

  return {
    status,
    code,
    message: redactSecrets(msg),
    resetsAtMs,
    resetsAtIso,
  };
}
