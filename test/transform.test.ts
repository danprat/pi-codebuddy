import { describe, expect, it } from "bun:test";
import { buildCodeBuddyRequestBody, parseCodeBuddyError } from "../src/stream/transform.js";
import type { Context, Model } from "@earendil-works/pi-ai";

describe("CodeBuddy Request Transformation", () => {
  const dummyModel: Model<any> = {
    id: "glm-5.2",
    name: "GLM-5.2",
    baseUrl: "https://www.codebuddy.ai/v2/chat/completions",
    api: "codebuddy-api" as any,
    provider: "codebuddy",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
  };

  it("adds leading system prompt and wraps user string in typed blocks", () => {
    const context: Context = {
      messages: [
        {
          role: "user",
          content: "Hello CodeBuddy!",
          timestamp: Date.now(),
        },
      ],
    };

    const body = buildCodeBuddyRequestBody(dummyModel, context);

    expect(body.stream).toBe(true);
    expect(body.model).toBe("glm-5.2");
    expect(body.messages.length).toBe(2);

    // Message 0: leading system prompt
    expect(body.messages[0]?.role).toBe("system");
    expect(body.messages[0]?.content).toContain("You are CodeBuddy Code");

    // Message 1: user content wrapped in typed block
    expect(body.messages[1]?.role).toBe("user");
    expect(body.messages[1]?.content).toEqual([{ type: "text", text: "Hello CodeBuddy!" }]);
  });

  it("sets reasoning_summary='auto' when reasoning_effort is active", () => {
    const context: Context = {
      messages: [
        {
          role: "user",
          content: "Solve this algorithm",
          timestamp: Date.now(),
        },
      ],
    };

    const body = buildCodeBuddyRequestBody(dummyModel, context, { reasoning: "high" });

    expect(body.reasoning_effort).toBe("high");
    expect(body.reasoning_summary).toBe("auto");
  });

  it("omits reasoning_effort and reasoning_summary when reasoning is off or none", () => {
    const context: Context = {
      messages: [
        {
          role: "user",
          content: "Quick reply",
          timestamp: Date.now(),
        },
      ],
    };

    const body = buildCodeBuddyRequestBody(dummyModel, context, { reasoning: "off" });

    expect(body.reasoning_effort).toBeUndefined();
    expect(body.reasoning_summary).toBeUndefined();
  });

  it("converts multi-turn assistant and tool results correctly", () => {
    const context: Context = {
      messages: [
        {
          role: "user",
          content: "What is in file.txt?",
          timestamp: Date.now(),
        },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Let me check." },
            {
              type: "toolCall",
              id: "call_123",
              name: "read_file",
              arguments: { path: "file.txt" },
            },
          ],
          api: "codebuddy-api" as any,
          provider: "codebuddy",
          model: "glm-5.2",
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: "toolUse",
          timestamp: Date.now(),
        },
        {
          role: "toolResult",
          toolCallId: "call_123",
          toolName: "read_file",
          content: [{ type: "text", text: "file contents hello world" }],
          isError: false,
          timestamp: Date.now(),
        },
      ],
    };

    const body = buildCodeBuddyRequestBody(dummyModel, context);

    expect(body.messages.length).toBe(4);
    // 0: system
    // 1: user
    // 2: assistant with tool_calls
    const assistantMsg = body.messages[2]!;
    expect(assistantMsg.role).toBe("assistant");
    expect(assistantMsg.content).toBe("Let me check.");
    expect(assistantMsg.tool_calls).toBeDefined();
    expect(assistantMsg.tool_calls?.[0]?.id).toBe("call_123");
    expect(assistantMsg.tool_calls?.[0]?.function.name).toBe("read_file");

    // 3: tool result
    const toolMsg = body.messages[3]!;
    expect(toolMsg.role).toBe("tool");
    expect(toolMsg.tool_call_id).toBe("call_123");
    expect(toolMsg.content).toBe("file contents hello world");
  });
});
