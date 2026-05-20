"use client";
/**
 * pipeline-core.ts
 *
 * Shared utilities for multi-file extraction pipelines.
 * Imported by both multi-file-pipeline.ts (bank) and
 * multi-file-industrial-pipeline.ts (industrial).
 */

// =============================================================================
// Error sentinels
// =============================================================================

export class RateLimitError extends Error {
  constructor() {
    super("Rate limit reached (429/503).");
    this.name = "RateLimitError";
  }
}

export class UsageExhaustedError extends Error {
  constructor() {
    super("Usage limit exhausted.");
    this.name = "UsageExhaustedError";
  }
}

// =============================================================================
// Helpers
// =============================================================================

export function generateSessionId(): string {
  return `mf${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

const USAGE_EXHAUSTED_PATTERNS = [
  /insufficient.{0,20}credit/i,
  /usage.{0,20}limit/i,
  /quota.{0,20}exceed/i,
  /out.{0,10}of.{0,10}credit/i,
  /billing/i,
];

export function isUsageExhausted(body: unknown): boolean {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return USAGE_EXHAUSTED_PATTERNS.some((re) => re.test(text));
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const RATE_LIMIT_WAIT_MS = 60_000;
export const MAX_RETRY_ATTEMPTS = 3;

export async function postJson<T>(
  path: string,
  body: unknown,
  onRateLimit: (retryIn: number, attempt: number) => void,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.status === 429 || res.status === 503) {
      if (attempt < MAX_RETRY_ATTEMPTS) {
        onRateLimit(RATE_LIMIT_WAIT_MS / 1000, attempt);
        await sleep(RATE_LIMIT_WAIT_MS);
        continue;
      }
      throw new RateLimitError();
    }

    const text = await res.text();
    if (!text.trim()) {
      throw new Error(`Server returned empty response (HTTP ${res.status}). Try again.`);
    }

    let data: T & { error?: string };
    try {
      data = JSON.parse(text) as T & { error?: string };
    } catch {
      throw new Error(`Server returned invalid JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }

    if (isUsageExhausted(data)) throw new UsageExhaustedError();

    if (!res.ok) {
      throw new Error((data as { error?: string }).error ?? `Server error ${res.status}`);
    }

    return data;
  }
  throw new RateLimitError();
}

export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<Array<T | Error>> {
  const results: Array<T | Error> = new Array(tasks.length);
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= tasks.length) break;
      try {
        results[index] = await tasks[index]();
      } catch (err) {
        results[index] = err instanceof Error ? err : new Error(String(err));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}
