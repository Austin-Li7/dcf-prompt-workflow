/**
 * Centralized server-side LLM abstraction.
 * Dispatches to Anthropic (Claude) or Google (Gemini) based on the provider.
 * Imported only by API route handlers — never by client components.
 */

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import type { LLMProvider } from "@/types/cfp";

// =============================================================================
// Public interface
// =============================================================================

export interface CallLLMOptions {
  provider: LLMProvider;
  apiKey: string;
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  /**
   * Optional Gemini-native responseSchema (JSON Schema object).
   * When provided the Gemini branch enables responseMimeType "application/json"
   * and passes the schema, guaranteeing structured output.
   * When provided for Claude, the request is forced through a tool schema.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  responseSchema?: Record<string, any>;
  responseToolName?: string;
  responseToolDescription?: string;
}

export interface CallLLMResult {
  text: string;
  structuredData?: unknown;
  finishReason?: string;
  finishMessage?: string;
}

/**
 * Extract the structured payload from a callLLM result.
 * Prefers the native structuredData field (tool-use path); falls back to
 * parsing the raw text as JSON (text-completion path).
 */
export function extractStructuredPayload(
  result: { text: string; structuredData?: unknown; finishReason?: string; finishMessage?: string },
  provider: LLMProvider,
): unknown {
  if (result.structuredData && typeof result.structuredData === "object") {
    return result.structuredData;
  }
  return parseStructuredJsonText(result.text, {
    provider,
    finishReason: result.finishReason,
    finishMessage: result.finishMessage,
  });
}

export function parseStructuredJsonText(
  text: string,
  context: { provider: LLMProvider; finishReason?: string; finishMessage?: string },
): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (
      context.provider === "gemini" &&
      context.finishReason === "MAX_TOKENS" &&
      error instanceof SyntaxError
    ) {
      throw new Error(
        `Structured output was truncated because Gemini hit MAX_TOKENS. ${context.finishMessage ?? "Try retrying with a smaller output or a higher token limit."}`.trim(),
      );
    }

    if (
      context.provider === "deepseek" &&
      context.finishReason === "length" &&
      error instanceof SyntaxError
    ) {
      throw new Error(
        "Structured output was truncated because DeepSeek hit the token limit. Try retrying or reduce the number of target years.",
      );
    }

    throw error;
  }
}

// =============================================================================
// Key resolution helper (used by every API route)
// =============================================================================

/**
 * Resolve the API key for a given provider.
 * Priority: runtime key from request > environment variable.
 */
export function resolveApiKey(
  provider: LLMProvider,
  runtimeKey?: string,
): { apiKey: string; needsKey: boolean } {
  const envKey =
    provider === "claude"
      ? process.env.ANTHROPIC_API_KEY
      : provider === "deepseek"
      ? process.env.DEEPSEEK_API_KEY
      : process.env.GEMINI_API_KEY;
  const key =
    (typeof runtimeKey === "string" && runtimeKey.trim()) || envKey || "";
  return { apiKey: key, needsKey: !key };
}

// =============================================================================
// Main dispatch
// =============================================================================

export async function callLLM(options: CallLLMOptions): Promise<CallLLMResult> {
  const { provider, apiKey, prompt, systemPrompt, maxTokens = 8192 } = options;

  if (!apiKey) {
    throw new Error("No API key provided for the selected LLM provider.");
  }

  if (provider === "gemini") {
    return callGemini(apiKey, prompt, systemPrompt, maxTokens, options.responseSchema);
  }

  if (provider === "deepseek") {
    return callDeepSeek(
      apiKey,
      prompt,
      systemPrompt,
      maxTokens,
      options.responseSchema,
      options.responseToolName,
      options.responseToolDescription,
    );
  }

  // Default: Claude
  return callClaude(
    apiKey,
    prompt,
    systemPrompt,
    maxTokens,
    options.responseSchema,
    options.responseToolName,
    options.responseToolDescription,
  );
}

// =============================================================================
// Claude (Anthropic)
// =============================================================================

async function callClaude(
  apiKey: string,
  prompt: string,
  systemPrompt: string | undefined,
  maxTokens: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  responseSchema?: Record<string, any>,
  responseToolName = "submit_step1_structured_result",
  responseToolDescription = "Return the validated Step 1 structured payload.",
): Promise<CallLLMResult> {
  const anthropic = new Anthropic({ apiKey });

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: maxTokens,
    ...(systemPrompt ? { system: systemPrompt } : {}),
    ...(responseSchema
      ? {
          tools: [
            {
              name: responseToolName,
              description: responseToolDescription,
              input_schema: responseSchema as any,
            },
          ],
          tool_choice: {
            type: "tool",
            name: responseToolName,
          },
        }
      : {}),
    messages: [{ role: "user", content: prompt }],
  } as any);

  const toolUseBlock = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n\n");

  return {
    text:
      toolUseBlock && typeof toolUseBlock.input === "object"
        ? JSON.stringify(toolUseBlock.input, null, 2)
        : text,
    structuredData: toolUseBlock?.input,
    finishReason: message.stop_reason ?? undefined,
  };
}

// =============================================================================
// DeepSeek (OpenAI-compatible API)
// =============================================================================

/** DeepSeek-V3 (`deepseek-chat`) hard output cap is 8 192 tokens. */
const DEEPSEEK_MAX_OUTPUT_TOKENS = 8192;

/**
 * Resolve all JSON Schema `$ref` references inline so the resulting schema has
 * no `$ref`, `definitions`, or `$schema` keys.
 *
 * DeepSeek (OpenAI-compatible) function-calling `parameters` must be a flat
 * object schema — it cannot process a top-level `$ref`.  Raw `zodToJsonSchema`
 * output (used for Claude) has exactly this shape, so we resolve it here
 * instead of maintaining a second schema per route.
 */
function resolveSchemaRefs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawSchema: Record<string, any>,
): Record<string, unknown> {
  const definitions =
    (rawSchema.definitions as Record<string, unknown> | undefined) ?? {};

  function resolve(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(resolve);
    if (!node || typeof node !== "object") return node;

    const rec = node as Record<string, unknown>;

    // Inline $ref — look it up in definitions and recurse
    if (typeof rec.$ref === "string") {
      const key = rec.$ref.split("/").pop()!;
      return key in definitions ? resolve(definitions[key]) : rec;
    }

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) {
      if (k === "$schema" || k === "definitions") continue; // strip meta-only keys
      out[k] = resolve(v);
    }
    return out;
  }

  return resolve(rawSchema) as Record<string, unknown>;
}

async function callDeepSeek(
  apiKey: string,
  prompt: string,
  systemPrompt: string | undefined,
  maxTokens: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  responseSchema?: Record<string, any>,
  responseToolName = "submit_structured_result",
  responseToolDescription = "Return the validated structured payload.",
): Promise<CallLLMResult> {
  const client = new OpenAI({
    apiKey,
    baseURL: "https://api.deepseek.com/v1",
  });

  // DeepSeek-V3 caps at 8 192 output tokens; clamp regardless of what the caller passes
  const cappedTokens = Math.min(maxTokens, DEEPSEEK_MAX_OUTPUT_TOKENS);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
    { role: "user" as const, content: prompt },
  ];

  const response = await client.chat.completions.create({
    model: "deepseek-chat",
    max_tokens: cappedTokens,
    messages,
    ...(responseSchema
      ? {
          tools: [
            {
              type: "function" as const,
              function: {
                name: responseToolName,
                description: responseToolDescription,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                parameters: resolveSchemaRefs(responseSchema) as any,
              },
            },
          ],
          tool_choice: {
            type: "function" as const,
            function: { name: responseToolName },
          },
        }
      : {}),
  });

  const choice = response.choices[0];
  // OpenAI SDK types tool_calls on the specific discriminated union; cast to access safely
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toolCalls = (choice.message as any).tool_calls as
    | Array<{ function?: { arguments?: string } }>
    | undefined;
  const rawText = choice.message.content ?? "";
  const argumentsText = toolCalls?.[0]?.function?.arguments ?? "";

  let structuredData: unknown;
  if (argumentsText) {
    try {
      structuredData = JSON.parse(argumentsText);
    } catch {
      structuredData = undefined;
    }
  }

  return {
    text: argumentsText || rawText,
    structuredData,
    finishReason: choice.finish_reason ?? undefined,
  };
}

// =============================================================================
// Gemini (Google)
// =============================================================================

async function callGemini(
  apiKey: string,
  prompt: string,
  systemPrompt: string | undefined,
  maxTokens: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  responseSchema?: Record<string, any>,
): Promise<CallLLMResult> {
  const genai = new GoogleGenerativeAI(apiKey);

  const model = genai.getGenerativeModel({
    model: "gemini-2.5-flash",
    ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    generationConfig: {
      maxOutputTokens: maxTokens,
      // When a schema is provided, lock output to structured JSON and disable thinking.
      // Gemini 2.5 models count thinking tokens against maxOutputTokens; for large
      // structured schemas the reasoning budget can consume the entire window before
      // any JSON is written, causing MAX_TOKENS truncation. Extraction tasks are
      // pattern-matching and gain no benefit from deep reasoning.
      ...(responseSchema
        ? {
            responseMimeType: "application/json",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            responseSchema: responseSchema as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            thinkingConfig: { thinkingBudget: 0 } as any,
          }
        : {}),
    } as any,
  });

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const firstCandidate = result.response.candidates?.[0];
  let structuredData: unknown;

  if (responseSchema) {
    try {
      structuredData = parseStructuredJsonText(text, {
        provider: "gemini",
        finishReason: firstCandidate?.finishReason,
        finishMessage: firstCandidate?.finishMessage,
      });
    } catch {
      structuredData = undefined;
    }
  }

  return {
    text,
    structuredData,
    finishReason: firstCandidate?.finishReason,
    finishMessage: firstCandidate?.finishMessage,
  };
}
