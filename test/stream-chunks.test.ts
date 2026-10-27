import { describe, expect, it } from "bun:test";
import { streamCodeBuddy } from "../src/stream/stream.js";
import type { Context, Model } from "@earendil-works/pi-ai";

describe("CodeBuddy Stream Chunks with empty tool_calls", () => {
  const dummyModel: Model<any> = {
    id: "deepseek-v4.1-flash",
    name: "DeepSeek-V4.1-Flash",
    baseUrl: "https://www.codebuddy.ai/v2/chat/completions",
    api: "codebuddy-api" as any,
    provider: "codebuddy",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
  };

  it("does not split text into multiple blocks when delta contains empty tool_calls array", async () => {
    const rawChunks = [
      'data: {"choices":[{"delta":{"role":"assistant","content":"H","tool_calls":[]}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"alo","tool_calls":[]}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"!","tool_calls":[]}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" ","tool_calls":[]}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Ada yang bisa saya bantu?","tool_calls":[]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ].join("");

    // Mock fetch for this test
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(rawChunks));
            controller.close();
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      )) as any;

    try {
      const context: Context = {
        messages: [{ role: "user", content: "halo", timestamp: Date.now() }],
      };

      const stream = streamCodeBuddy(dummyModel, context, { apiKey: "test-token" });

      const events: any[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      const textStartEvents = events.filter((e) => e.type === "text_start");
      const textEndEvents = events.filter((e) => e.type === "text_end");
      const doneEvent = events.find((e) => e.type === "done");

      // Verify text_start was only emitted once, not for every chunk!
      expect(textStartEvents.length).toBe(1);
      expect(textEndEvents.length).toBe(1);

      // Verify output message has exactly 1 text content block with complete text
      expect(doneEvent).toBeDefined();
      expect(doneEvent.message.content.length).toBe(1);
      expect(doneEvent.message.content[0].type).toBe("text");
      expect(doneEvent.message.content[0].text).toBe("Halo! Ada yang bisa saya bantu?");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
