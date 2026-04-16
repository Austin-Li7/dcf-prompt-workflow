/**
 * Centralized server-side LLM abstraction.
 * Dispatches to Anthropic (Claude) or Google (Gemini) based on the provider.
 * Imported only by API route handlers — never by client components.
 */

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
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
   * Ignored by the Claude branch (use prompt instructions for Claude).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  responseSchema?: Record<string, any>;
}

export interface CallLLMResult {
  text: string;
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
  const key =
    (typeof runtimeKey === "string" && runtimeKey.trim()) ||
    (provider === "claude"
      ? process.env.ANTHROPIC_API_KEY
      : process.env.GEMINI_API_KEY) ||
    "";
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

  // Default: Claude
  return callClaude(apiKey, prompt, systemPrompt, maxTokens);
}

// =============================================================================
// Claude (Anthropic)
// =============================================================================

async function callClaude(
  apiKey: string,
  prompt: string,
  systemPrompt: string | undefined,
  maxTokens: number,
): Promise<CallLLMResult> {
  const anthropic = new Anthropic({ apiKey });

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: maxTokens,
    ...(systemPrompt ? { system: systemPrompt } : {}),
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n\n");

  return { text };
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
    model: "gemini-2.5-pro",
    ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
    generationConfig: {
      maxOutputTokens: maxTokens,
      // When a schema is provided, lock output to structured JSON
      ...(responseSchema
        ? {
            responseMimeType: "application/json",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            responseSchema: responseSchema as any,
          }
        : {}),
    },
  });

  const result = await model.generateContent(prompt);
  const text = result.response.text();

  return { text };
}
