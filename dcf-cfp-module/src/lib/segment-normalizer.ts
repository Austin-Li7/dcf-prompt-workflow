"use client";
/**
 * segment-normalizer.ts
 *
 * Deterministic post-extraction segment name normalizer.
 *
 * Problem: the LLM may use slightly different segment names across filings
 * (e.g. "SoFi Lending" vs "Lending", "Technology Platform" vs "Tech Platform").
 * This prevents Q4 derivation from matching annual and quarterly rows by segment.
 *
 * Solution: after all files are extracted, build a canonical segment set from
 * Step 1 architecture, then normalize every row's segment name using a ranked
 * match strategy:
 *   1. Exact match → no change
 *   2. Case-insensitive match → normalize case
 *   3. Canonical name is a substring of the row name (or vice-versa) → normalize
 *   4. Levenshtein distance ≤ 2 → normalize
 *   5. No match → leave unchanged, add to unmatched list
 *
 * A validation_warning is added to each affected row's reviewNote.
 */

import type { HistoricalExtractionRow } from "@/types/cfp";

// =============================================================================
// Canonical segment extraction from Step 1 architecture
// =============================================================================

/** Walk any nested object and collect unique segment / name strings. */
function extractCanonicalSegments(architecture: unknown): string[] {
  const found = new Set<string>();

  function walk(obj: unknown): void {
    if (!obj || typeof obj !== "object") return;
    const o = obj as Record<string, unknown>;
    if (typeof o.segment === "string" && o.segment.trim().length >= 2) {
      found.add(o.segment.trim());
    }
    if (typeof o.name === "string" && o.name.trim().length >= 2) {
      found.add(o.name.trim());
    }
    for (const v of Object.values(o)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v !== "string" && typeof v !== "number") walk(v);
    }
  }

  walk(architecture);

  // Always include "Consolidated" as a valid segment for capital-ratio rows.
  found.add("Consolidated");

  return Array.from(found);
}

// =============================================================================
// Fuzzy matching helpers
// =============================================================================

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

/**
 * Returns true when every word in the shorter name is either an exact match or
 * a prefix/suffix of a word in the longer name — e.g. "Tech Platform" matches
 * "Technology Platform" because "tech" is a prefix of "technology".
 */
function wordPrefixMatch(a: string, b: string): boolean {
  const wa = a.split(/\s+/);
  const wb = b.split(/\s+/);
  const [shorter, longer] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  // Every word in the shorter name must prefix-match at least one word in the longer name.
  return shorter.every((sw) =>
    longer.some((lw) => lw.startsWith(sw) || sw.startsWith(lw)),
  );
}

/**
 * Find the best canonical segment name for `raw`.
 * Returns null if no confident match is found.
 */
export function findCanonicalMatch(
  raw: string,
  canonicals: string[],
): string | null {
  const rawLower = raw.toLowerCase().trim();

  // 1. Exact match
  const exact = canonicals.find((c) => c === raw);
  if (exact) return exact;

  // 2. Case-insensitive exact
  const caseInsensitive = canonicals.find((c) => c.toLowerCase() === rawLower);
  if (caseInsensitive) return caseInsensitive;

  // 3. Substring: canonical name ⊆ raw  OR  raw ⊆ canonical name (min 4 chars)
  const substringMatch = canonicals.find((c) => {
    const cl = c.toLowerCase();
    return (
      cl.length >= 4 &&
      rawLower.length >= 4 &&
      (rawLower.includes(cl) || cl.includes(rawLower))
    );
  });
  if (substringMatch) return substringMatch;

  // 4. Word-prefix match: "Tech Platform" → "Technology Platform"
  const wordMatch = canonicals.find((c) => {
    const cl = c.toLowerCase();
    return cl.length >= 4 && rawLower.length >= 4 && wordPrefixMatch(rawLower, cl);
  });
  if (wordMatch) return wordMatch;

  // 5. Levenshtein ≤ 2 (only for short names to avoid false positives)
  const fuzzy = canonicals.find((c) => {
    const dist = levenshtein(rawLower, c.toLowerCase());
    return dist <= 2 && dist < rawLower.length * 0.3;
  });
  if (fuzzy) return fuzzy;

  return null;
}

// =============================================================================
// Public entry point
// =============================================================================

export interface NormalizationReport {
  /** Number of rows whose segment name was changed. */
  normalized: number;
  /** Distinct (rawName → canonicalName) pairs that were applied. */
  mappings: Array<{ from: string; to: string }>;
  /** Segment names that had no canonical match and were left unchanged. */
  unmatched: string[];
}

/**
 * Normalize all bank-mode HistoricalExtractionRow segment names against the
 * Step 1 canonical segment list extracted from `architecture`.
 *
 * Mutates rows in-place for efficiency (caller already owns the array).
 * Returns a report of what changed.
 */
export function normalizeSegmentNames(
  rows: HistoricalExtractionRow[],
  architecture: unknown,
): NormalizationReport {
  const canonicals = extractCanonicalSegments(architecture);
  const mappingMap = new Map<string, string>(); // raw → canonical
  const unmatchedSet = new Set<string>();
  let normalizedCount = 0;

  for (const row of rows) {
    const raw = row.segment;
    if (!raw) continue;

    // Fast path: already in canonical set
    if (canonicals.includes(raw)) continue;

    // Check cache first
    if (mappingMap.has(raw)) {
      row.segment = mappingMap.get(raw)!;
      normalizedCount++;
      continue;
    }
    if (unmatchedSet.has(raw)) continue;

    const match = findCanonicalMatch(raw, canonicals);
    if (match) {
      mappingMap.set(raw, match);
      row.segment = match;
      if (row.reviewNote) {
        const suffix = ` [Segment renamed: "${raw}" → "${match}"]`;
        row.reviewNote = (row.reviewNote.length + suffix.length <= 500)
          ? row.reviewNote + suffix
          : row.reviewNote;
      }
      normalizedCount++;
    } else {
      unmatchedSet.add(raw);
    }
  }

  const mappings = Array.from(mappingMap.entries()).map(([from, to]) => ({ from, to }));
  const unmatched = Array.from(unmatchedSet);

  return { normalized: normalizedCount, mappings, unmatched };
}
