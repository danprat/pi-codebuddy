import {
  calculateCost,
  createAssistantMessageEventStream,
  parseToolCallArguments,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
  type ToolCall,
} from "@earendil-works/pi-ai";
import { getRegionConfig, buildChatHeaders, PROVIDER_ID } from "../client/config.js";
import { failoverToNextAccount, resolveApiKeyFromContext } from "../auth/accounts.js";
import { setLastEndpoint, setLastLatencyMs, setLastError, setLastModel, setLastStatus } from "../diagnostics/diagnostics.js";
import { buildCodeBuddyRequestBody, parseCodeBuddyError } from "./transform.js";
import { redactSecrets } from "../utils/security.js";

interface SSEDelta {
  role?: string;
  content?: string | null;
  reasoning_content?: string | null;
  thought?: string | null;
  reasoning?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: string;
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
}

interface SSEChunk {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    index: number;
    delta?: SSEDelta;
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  code?: number;
  msg?: string;
  message?: string;
  error?: {
    message?: string;
    code?: number | string;
  };
}

function createAssistantMessage(model: Model<any>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider || PROVIDER_ID,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

export function streamCodeBuddy(
  model: Model<any>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();

  (async () => {
    const startTime = Date.now();
    setLastModel(model.id);
    const output = createAssistantMessage(model);
    const fetchFn = options?.fetch || globalThis.fetch;

    try {
      let token = options?.apiKey;
      if (!token || token === PROVIDER_ID) {
        token = await resolveApiKeyFromContext();
      }

      if (!token) {
        throw new Error("No CodeBuddy credentials found. Run /login codebuddy or set CODEBUDDY_API_KEY.");
      }

      const triedTokens = new Set<string>([token]);
      const regionConfig = getRegionConfig();
      setLastEndpoint(regionConfig.baseUrl);

      const requestBody = buildCodeBuddyRequestBody(model, context, {
        temperature: options?.temperature,
        maxTokens: options?.maxTokens,
        reasoning: options?.reasoning,
      });

      let finalBody: unknown = requestBody;
      if (typeof options?.onPayload === "function") {
        const replacement = await options.onPayload(requestBody, model);
        if (replacement !== undefined) {
          finalBody = replacement;
        }
      }

      let response: Response | undefined;
      let lastErrorText = "";

      // Send request with retry/failover if rate limited (6004 / 429)
      for (let attempt = 0; attempt <= 2; attempt++) {
        if (options?.signal?.aborted) {
          throw new Error("Request was aborted");
        }

        const headers = buildChatHeaders(token, regionConfig, finalBody as any);
        if (options?.headers) {
          Object.assign(headers, options.headers);
        }

        try {
          response = await fetchFn(regionConfig.baseUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(finalBody),
            signal: options?.signal,
          });

          setLastStatus(response.status);

          if (response.ok) {
            break;
          }

          lastErrorText = await response.text();
          const parsed = parseCodeBuddyError(response.status, lastErrorText);

          // If rate limited or quota exceeded, try failing over to another stored account
          if (response.status === 429 || parsed.code === 6004) {
            const nextAccount = await failoverToNextAccount(triedTokens);
            if (nextAccount?.access) {
              triedTokens.add(nextAccount.access);
              token = nextAccount.access;
              continue;
            }
          }

          // Non-retryable error
          throw new Error(parsed.message || `CodeBuddy request failed (${response.status})`);
        } catch (fetchErr) {
          if (options?.signal?.aborted) throw new Error("Request was aborted");
          if (attempt === 2) throw fetchErr;
        }
      }

      if (!response || !response.ok) {
        const parsed = parseCodeBuddyError(response?.status || 500, lastErrorText);
        throw new Error(parsed.message || "Failed to get response from CodeBuddy");
      }

      if (typeof options?.onResponse === "function") {
        await options.onResponse(response as any, model);
      }

      if (!response.body) {
        throw new Error("CodeBuddy returned empty response body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let buffer = "";
      let started = false;
      let currentThinkingBlockIndex = -1;
      let currentTextBlockIndex = -1;
      const accumulatedToolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();

      const ensureStarted = () => {
        if (!started) {
          stream.push({ type: "start", partial: output });
          started = true;
        }
      };

      const closeThinkingIfActive = () => {
        if (currentThinkingBlockIndex >= 0) {
          const block = output.content[currentThinkingBlockIndex];
          if (block && block.type === "thinking") {
            stream.push({
              type: "thinking_end",
              contentIndex: currentThinkingBlockIndex,
              content: block.thinking,
              partial: output,
            });
          }
          currentThinkingBlockIndex = -1;
        }
      };

      const closeTextIfActive = () => {
        if (currentTextBlockIndex >= 0) {
          const block = output.content[currentTextBlockIndex];
          if (block && block.type === "text") {
            stream.push({
              type: "text_end",
              contentIndex: currentTextBlockIndex,
              content: block.text,
              partial: output,
            });
          }
          currentTextBlockIndex = -1;
        }
      };

      const processLine = async (line: string) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) return;

        if (!trimmed.startsWith("data:")) {
          // Check if error JSON
          if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
            try {
              const parsed = JSON.parse(trimmed);
              if (parsed.code && parsed.code !== 0) {
                const err = parseCodeBuddyError(400, trimmed);
                throw new Error(err.message);
              }
            } catch {
              // Not JSON error
            }
          }
          return;
        }

        const dataContent = trimmed.slice(5).trim();
        if (dataContent === "[DONE]") {
          return;
        }

        let chunk: SSEChunk;
        try {
          chunk = JSON.parse(dataContent) as SSEChunk;
        } catch {
          return;
        }

        if (typeof options?.onProviderStreamEvent === "function") {
          await options.onProviderStreamEvent(chunk, model);
        }

        if (chunk.code && chunk.code !== 0) {
          const err = parseCodeBuddyError(400, JSON.stringify(chunk));
          throw new Error(err.message);
        }

        if (chunk.choices && chunk.choices.length > 0) {
          const choice = chunk.choices[0]!;
          const delta = choice.delta;

          // 1. Thinking / Reasoning delta
          const reasoning = delta?.reasoning_content ?? delta?.thought ?? delta?.reasoning;
          if (typeof reasoning === "string" && reasoning.length > 0) {
            ensureStarted();
            closeTextIfActive();

            if (currentThinkingBlockIndex < 0) {
              output.content.push({ type: "thinking", thinking: "" });
              currentThinkingBlockIndex = output.content.length - 1;
              stream.push({
                type: "thinking_start",
                contentIndex: currentThinkingBlockIndex,
                partial: output,
              });
            }

            const block = output.content[currentThinkingBlockIndex];
            if (block && block.type === "thinking") {
              block.thinking += reasoning;
              stream.push({
                type: "thinking_delta",
                contentIndex: currentThinkingBlockIndex,
                delta: reasoning,
                partial: output,
              });
            }
          }

          // 2. Text Content delta
          if (typeof delta?.content === "string" && delta.content.length > 0) {
            ensureStarted();
            closeThinkingIfActive();

            if (currentTextBlockIndex < 0) {
              output.content.push({ type: "text", text: "" });
              currentTextBlockIndex = output.content.length - 1;
              stream.push({
                type: "text_start",
                contentIndex: currentTextBlockIndex,
                partial: output,
              });
            }

            const block = output.content[currentTextBlockIndex];
            if (block && block.type === "text") {
              block.text += delta.content;
              stream.push({
                type: "text_delta",
                contentIndex: currentTextBlockIndex,
                delta: delta.content,
                partial: output,
              });
            }
          }

          // 3. Tool Calls
          if (delta?.tool_calls && Array.isArray(delta.tool_calls)) {
            ensureStarted();
            closeThinkingIfActive();
            closeTextIfActive();

            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              const existing = accumulatedToolCalls.get(idx) || {
                id: tc.id || `call_${idx + 1}`,
                name: "",
                arguments: "",
              };

              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.name += tc.function.name;
              if (tc.function?.arguments) existing.arguments += tc.function.arguments;

              accumulatedToolCalls.set(idx, existing);
            }
          }

          // 4. Finish reason
          if (choice.finish_reason) {
            output.rawStopReason = choice.finish_reason;
            if (choice.finish_reason === "length") {
              output.stopReason = "length";
            } else if (choice.finish_reason === "tool_calls" || accumulatedToolCalls.size > 0) {
              output.stopReason = "toolUse";
            } else {
              output.stopReason = "stop";
            }
          }
        }

        // 5. Usage metadata
        if (chunk.usage) {
          const promptTokens = chunk.usage.prompt_tokens || 0;
          const compTokens = chunk.usage.completion_tokens || 0;
          output.usage.input = promptTokens;
          output.usage.output = compTokens;
          output.usage.totalTokens = chunk.usage.total_tokens || promptTokens + compTokens;
          calculateCost(model, output.usage);
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          await processLine(line);
        }
      }

      if (buffer.trim()) {
        await processLine(buffer);
      }

      closeThinkingIfActive();
      closeTextIfActive();

      // Emit finished tool calls
      if (accumulatedToolCalls.size > 0) {
        output.stopReason = "toolUse";
        for (const [, tc] of accumulatedToolCalls) {
          const parsed = parseToolCallArguments(tc.arguments);

          const toolCall: ToolCall = {
            type: "toolCall",
            id: tc.id,
            name: tc.name,
            arguments: parsed.arguments,
            ...(parsed.argumentsError ? { argumentsError: parsed.argumentsError } : {}),
          };

          output.content.push(toolCall);
          const blockIdx = output.content.length - 1;

          stream.push({
            type: "toolcall_start",
            contentIndex: blockIdx,
            partial: output,
          });
          stream.push({
            type: "toolcall_delta",
            contentIndex: blockIdx,
            delta: tc.arguments,
            partial: output,
          });
          stream.push({
            type: "toolcall_end",
            contentIndex: blockIdx,
            toolCall,
            partial: output,
          });
        }
      }

      ensureStarted();

      setLastLatencyMs(Date.now() - startTime);
      const finalDoneReason: "stop" | "length" | "toolUse" | "deferred" =
        output.stopReason === "length" || output.stopReason === "toolUse" || output.stopReason === "deferred"
          ? output.stopReason
          : "stop";

      stream.push({
        type: "done",
        reason: finalDoneReason,
        message: output,
      });
      stream.end();
    } catch (err) {
      setLastLatencyMs(Date.now() - startTime);
      const errMsg = err instanceof Error ? err.message : String(err);
      setLastError(errMsg);

      const isAborted = Boolean(options?.signal?.aborted);
      const reason = isAborted ? "aborted" : "error";
      output.stopReason = reason;
      output.errorMessage = redactSecrets(errMsg);

      stream.push({
        type: "error",
        reason,
        error: output,
      });
      stream.end();
    }
  })();

  return stream;
}
