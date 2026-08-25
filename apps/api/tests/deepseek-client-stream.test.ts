import { describe, expect, it, vi } from "vitest";

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: () => () => ({ provider: "test" }),
}));

vi.mock("ai", () => ({
  streamText: ({ abortSignal }: { abortSignal: AbortSignal }) => ({
    textStream: (async function* stalledStream() {
      await new Promise<void>((_resolve, reject) => {
        abortSignal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
      yield "unreachable";
    })(),
  }),
}));

import { DeepSeekClient } from "../src/lib/deepseek-client.js";

describe("DeepSeekClient streaming", () => {
  it("aborts a stalled provider stream at the configured deadline", async () => {
    const client = new DeepSeekClient({
      port: 0,
      databasePath: ":memory:",
      deepseekApiKey: "test-key",
      deepseekBaseUrl: "https://api.deepseek.com",
      deepseekModel: "deepseek-chat",
      deepseekTimeoutMs: 20,
    });
    const stream = client.streamText("system", "user");
    expect(stream).not.toBeNull();

    const consume = async () => {
      for await (const _chunk of stream!) {
        // The mocked provider never yields before cancellation.
      }
    };

    await expect(consume()).rejects.toMatchObject({ name: "AbortError" });
  });
});
