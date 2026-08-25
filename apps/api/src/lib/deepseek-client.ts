import OpenAI from "openai";
import { createOpenAICompatible, type OpenAICompatibleProvider } from "@ai-sdk/openai-compatible";
import { streamText as createTextStream } from "ai";

import type { AppConfig } from "../config.js";

export type ModelFailureStage =
  | "timeout"
  | "provider_request"
  | "empty_response"
  | "json_parse"
  | "schema_validation"
  | "unexpected";

export interface ModelCallDiagnostic {
  failureStage: ModelFailureStage;
  statusCode: number | null;
  errorCode: string | null;
  elapsedMs: number;
  attempt: number;
  schemaIssues: string[];
}

export interface JsonCompletionResult {
  value: Record<string, unknown>;
  elapsedMs: number;
}

export class ModelCallError extends Error {
  constructor(public readonly diagnostic: ModelCallDiagnostic) {
    super(`Model call failed at ${diagnostic.failureStage}`);
    this.name = "ModelCallError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function stringField(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function numberField(record: Record<string, unknown> | null, key: string): number | null {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function requestFailure(error: unknown, elapsedMs: number, attempt: number): ModelCallError {
  const record = asRecord(error);
  const nested = asRecord(record?.error);
  const name = stringField(record, "name");
  const providerCode = stringField(record, "code") ?? stringField(nested, "code");
  const isTimeout = name?.toLocaleLowerCase().includes("timeout")
    || providerCode === "ETIMEDOUT"
    || providerCode === "ECONNABORTED";
  return new ModelCallError({
    failureStage: isTimeout ? "timeout" : "provider_request",
    statusCode: numberField(record, "status"),
    errorCode: isTimeout ? "MODEL_TIMEOUT" : providerCode ?? "MODEL_REQUEST_FAILED",
    elapsedMs,
    attempt,
    schemaIssues: [],
  });
}

export class DeepSeekClient {
  private readonly client: OpenAI | null;
  private readonly streamingProvider: OpenAICompatibleProvider | null;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(config: AppConfig) {
    this.model = config.deepseekModel;
    this.timeoutMs = config.deepseekTimeoutMs ?? 30_000;
    this.client = config.deepseekApiKey
      ? new OpenAI({
          apiKey: config.deepseekApiKey,
          baseURL: config.deepseekBaseUrl,
        })
      : null;
    this.streamingProvider = config.deepseekApiKey
      ? createOpenAICompatible({
          name: "deepseek",
          apiKey: config.deepseekApiKey,
          baseURL: config.deepseekBaseUrl,
        })
      : null;
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  async completeText(systemPrompt: string, userPrompt: string): Promise<string | null> {
    if (!this.client) {
      return null;
    }
    try {
      return await this.requestText(systemPrompt, userPrompt);
    } catch {
      return null;
    }
  }

  async completeJson(systemPrompt: string, userPrompt: string): Promise<Record<string, unknown> | null> {
    const raw = await this.completeText(
      `${systemPrompt}\n输出必须是 JSON 对象，不要加 markdown。`,
      userPrompt,
    );
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  async completeJsonWithDiagnostics(
    systemPrompt: string,
    userPrompt: string,
    attempt: number,
  ): Promise<JsonCompletionResult> {
    const startedAt = Date.now();
    let raw: string | null;
    try {
      raw = await this.requestText(
        `${systemPrompt}\n输出必须是 JSON 对象，不要加 markdown。`,
        userPrompt,
      );
    } catch (error) {
      throw requestFailure(error, Date.now() - startedAt, attempt);
    }
    const elapsedMs = Date.now() - startedAt;
    if (!raw) {
      throw new ModelCallError({
        failureStage: "empty_response",
        statusCode: null,
        errorCode: "MODEL_EMPTY_RESPONSE",
        elapsedMs,
        attempt,
        schemaIssues: [],
      });
    }
    try {
      return {
        value: JSON.parse(raw) as Record<string, unknown>,
        elapsedMs,
      };
    } catch {
      throw new ModelCallError({
        failureStage: "json_parse",
        statusCode: null,
        errorCode: "MODEL_INVALID_JSON",
        elapsedMs,
        attempt,
        schemaIssues: [],
      });
    }
  }

  streamText(systemPrompt: string, userPrompt: string): AsyncIterable<string> | null {
    if (!this.streamingProvider) {
      return null;
    }
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.timeoutMs);
    const result = createTextStream({
      model: this.streamingProvider(this.model),
      system: systemPrompt,
      prompt: userPrompt,
      temperature: 0.3,
      abortSignal: abortController.signal,
    });
    const stream = result.textStream;
    return (async function* streamWithTimeout() {
      try {
        yield* stream;
      } finally {
        clearTimeout(timeout);
      }
    })();
  }

  private async requestText(systemPrompt: string, userPrompt: string): Promise<string | null> {
    if (!this.client) return null;
    const response = await this.client.chat.completions.create(
      {
        model: this.model,
        temperature: 0.3,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      },
      {
        timeout: this.timeoutMs,
      },
    );
    return response.choices[0]?.message?.content ?? null;
  }
}
