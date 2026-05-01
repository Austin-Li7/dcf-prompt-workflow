"use client";
/**
 * Client-side file parser and chunker for the Step 2 extraction pipeline.
 *
 * Strategy (per file type):
 *   .txt  → split by quarterly section headers first, then overlap if still too large.
 *   .csv/.xlsx → group rows by quarter field first, then row-count batches.
 *   .json → records array: same as CSV; otherwise text-based split.
 *
 * Token estimation: 1 token ≈ 4 characters (financial-text heuristic).
 * Provider safety targets: Gemini 700k tokens, Claude 150k tokens.
 */

import { readXlsxToRecords, parseCsvToRecords } from "./excel-utils";
import type { LLMProvider } from "@/types/cfp";

// =============================================================================
// Token budget
// =============================================================================

const PROVIDER_TOKEN_TARGETS: Record<LLMProvider, number> = {
  gemini: 700_000, // 1M cap, leave headroom for response + system prompt
  claude: 150_000, // 200k cap
};

/** Rough heuristic: 4 chars ≈ 1 token for English/financial text. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function getChunkTokenLimit(provider: LLMProvider): number {
  return PROVIDER_TOKEN_TARGETS[provider];
}

// =============================================================================
// Public types
// =============================================================================

export interface FileChunk {
  sourceFile: string;
  /** 0-based */
  chunkIndex: number;
  totalChunks: number;
  content: string;
  estimatedTokens: number;
}

// =============================================================================
// Quarterly boundary regex for .txt files
// =============================================================================

// Matches the START of a section that contains a quarterly / annual label.
// The lookahead avoids consuming characters so split boundaries are clean.
const QUARTER_BOUNDARY_RE =
  /(?=(?:Q[1-4]\s+20\d{2}|FY\s*20\d{2}|First Quarter|Second Quarter|Third Quarter|Fourth Quarter|Three [Mm]onths [Ee]nded|Six [Mm]onths [Ee]nded|Nine [Mm]onths [Ee]nded|Fiscal [Yy]ear [Ee]nded))/g;

// =============================================================================
// Text splitters
// =============================================================================

/**
 * Split plain text by quarterly section boundaries first.
 * Falls back to overlap-split if no markers are found or a section is still too large.
 */
function splitText(text: string, maxTokens: number): string[] {
  const sections = text.split(QUARTER_BOUNDARY_RE).filter((s) => s.trim());

  if (sections.length <= 1) {
    return splitByOverlap(text, maxTokens);
  }

  // Greedily merge consecutive sections that fit within the budget.
  const chunks: string[] = [];
  let current = "";

  for (const section of sections) {
    const candidate = current ? `${current}\n\n${section}` : section;
    if (estimateTokens(candidate) > maxTokens && current) {
      chunks.push(current);
      current = section;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);

  // Sub-split any chunk still over budget.
  const result: string[] = [];
  for (const chunk of chunks) {
    if (estimateTokens(chunk) > maxTokens) {
      result.push(...splitByOverlap(chunk, maxTokens));
    } else {
      result.push(chunk);
    }
  }
  return result;
}

/** Generic character-count split with 15 % overlap. */
function splitByOverlap(text: string, maxTokens: number): string[] {
  const charLimit = maxTokens * 4;
  const overlap = Math.floor(charLimit * 0.15);
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + charLimit, text.length);
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = end - overlap;
  }
  return chunks;
}

// =============================================================================
// Record splitters (CSV / XLSX / JSON arrays)
// =============================================================================

const QUARTER_FIELD_NAMES = new Set([
  "quarter",
  "Quarter",
  "QUARTER",
  "qtr",
  "Qtr",
  "QTR",
  "period",
  "Period",
  "PERIOD",
]);

/** Matches fiscal-year column headers like "FY2021" or "FY 2022". */
const FISCAL_YEAR_COL_RE = /^FY\s*\d{4}$/i;

/** Matches quarter labels like "Q1", "Q3 2024" in cell values. */
const QUARTER_VALUE_RE = /\bQ[1-4]\b/i;

/**
 * Annotation prepended to pivoted fiscal-year tables so the LLM knows
 * that column headers (FY2021, FY2022…) represent fiscal years, not row fields.
 */
const PIVOT_ANNOTATION =
  "// TABLE FORMAT NOTE: This is a PIVOTED financial table.\n" +
  "// Column headers (e.g. FY2021, FY2022, FY2023...) represent fiscal years.\n" +
  "// Each JSON object is a financial metric row (e.g. Total revenue, Operating income).\n" +
  "// Extract data by reading each row's 'Item' key as the metric name, then reading\n" +
  "// the value under each FY column for that year. Annual data only — use Q4 as the quarter.\n\n";

/**
 * Find the key in the first record that identifies the quarter / period dimension.
 *
 * Resolution order:
 *  1. Exact match against the QUARTER_FIELD_NAMES set.
 *  2. Case-insensitive substring: key name contains "quarter" or "period".
 *  3. Value scan: first column whose values look like quarter labels (Q1–Q4).
 */
function findQuarterKey(records: Array<Record<string, unknown>>): string | null {
  if (!records.length) return null;
  const keys = Object.keys(records[0]);

  // 1. Exact set match
  const exactMatch = keys.find((k) => QUARTER_FIELD_NAMES.has(k));
  if (exactMatch) return exactMatch;

  // 2. Case-insensitive substring ("quarter" or "period" in the column name)
  const substringMatch = keys.find((k) => {
    const lower = k.toLowerCase();
    return lower.includes("quarter") || lower.includes("period");
  });
  if (substringMatch) return substringMatch;

  // 3. Value scan — find a column whose sampled values look like Q1/Q2/Q3/Q4
  const sampleSize = Math.min(records.length, 5);
  for (const key of keys) {
    let hits = 0;
    for (let i = 0; i < sampleSize; i++) {
      if (QUARTER_VALUE_RE.test(String(records[i][key] ?? ""))) hits++;
    }
    if (hits >= Math.min(2, sampleSize)) return key;
  }

  return null;
}

/**
 * Returns true when the table is in PIVOTED format — fiscal years are column
 * headers (FY2021, FY2022…) rather than a per-row year field.
 * Requires at least two such columns to avoid false positives.
 */
function isPivotedFiscalTable(records: Array<Record<string, unknown>>): boolean {
  if (!records.length) return false;
  const fiscalYearCols = Object.keys(records[0]).filter((k) => FISCAL_YEAR_COL_RE.test(k.trim()));
  return fiscalYearCols.length >= 2;
}

/**
 * Convert comma-formatted number strings ("2,865", "19,409") to actual numbers.
 * Non-numeric strings and already-numeric values are left unchanged.
 */
function normalizeRecords(
  records: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return records.map((rec) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rec)) {
      if (
        typeof value === "string" &&
        value.trim() !== "" &&
        /^-?[\d,]+(\.\d+)?$/.test(value.trim())
      ) {
        const num = Number(value.replace(/,/g, ""));
        out[key] = isNaN(num) ? value : num;
      } else {
        out[key] = value;
      }
    }
    return out;
  });
}

function groupByField(
  records: Array<Record<string, unknown>>,
  key: string,
): Map<string, Array<Record<string, unknown>>> {
  const groups = new Map<string, Array<Record<string, unknown>>>();
  for (const rec of records) {
    const value = String(rec[key] ?? "unknown");
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value)!.push(rec);
  }
  return groups;
}

function recordsToChunks(
  records: Array<Record<string, unknown>>,
  maxTokens: number,
): string[] {
  const quarterKey = findQuarterKey(records);

  // --- Strategy 1: group by quarter field ---
  if (quarterKey) {
    const groups = groupByField(records, quarterKey);
    const chunks: string[] = [];
    let batch: Array<Record<string, unknown>> = [];

    for (const groupRecs of groups.values()) {
      const candidate = [...batch, ...groupRecs];
      if (estimateTokens(JSON.stringify(candidate)) > maxTokens && batch.length > 0) {
        chunks.push(JSON.stringify(batch, null, 2));
        batch = groupRecs;
      } else {
        batch = candidate;
      }
    }
    if (batch.length > 0) chunks.push(JSON.stringify(batch, null, 2));
    return chunks;
  }

  // --- Strategy 2: row-count batches ---
  const chunks: string[] = [];
  let batch: Array<Record<string, unknown>> = [];

  for (const rec of records) {
    batch.push(rec);
    const text = JSON.stringify(batch, null, 2);
    if (estimateTokens(text) > maxTokens) {
      if (batch.length > 1) {
        batch.pop();
        chunks.push(JSON.stringify(batch, null, 2));
        batch = [rec];
      } else {
        // Single oversized record — include as-is.
        chunks.push(text);
        batch = [];
      }
    }
  }
  if (batch.length > 0) chunks.push(JSON.stringify(batch, null, 2));
  return chunks;
}

// =============================================================================
// Main entry point
// =============================================================================

/**
 * Parse a single uploaded File and return it as one or more FileChunk objects
 * sized for the target provider's context window.
 *
 * All work is done in the browser — no server round-trip required.
 */
export async function chunkFile(file: File, provider: LLMProvider): Promise<FileChunk[]> {
  const maxTokens = getChunkTokenLimit(provider);
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  let rawChunks: string[];

  if (ext === "txt") {
    const text = await file.text();
    rawChunks = splitText(text, maxTokens);
  } else if (ext === "json") {
    const text = await file.text();
    try {
      const parsed: unknown = JSON.parse(text);
      let records: Array<Record<string, unknown>> = [];

      if (Array.isArray(parsed)) {
        records = parsed as Array<Record<string, unknown>>;
      } else if (parsed && typeof parsed === "object") {
        const obj = parsed as Record<string, unknown>;
        // Try common wrapper keys used by DCF fixture payloads
        const candidate = obj.rows ?? obj.data ?? obj.records;
        if (Array.isArray(candidate)) {
          records = candidate as Array<Record<string, unknown>>;
        } else {
          records = [obj];
        }
      }

      if (records.length > 0) {
        const normalizedRecords = normalizeRecords(records);
        const normalizedText = JSON.stringify(normalizedRecords, null, 2);
        rawChunks =
          estimateTokens(normalizedText) > maxTokens
            ? recordsToChunks(normalizedRecords, maxTokens)
            : [normalizedText];
      } else {
        rawChunks = [text];
      }
    } catch {
      // Not valid JSON — treat as plain text.
      rawChunks = splitText(text, maxTokens);
    }
  } else if (["csv", "xlsx", "xlsm"].includes(ext)) {
    const rawRecords = ext === "csv"
      ? parseCsvToRecords(await file.text())
      : await readXlsxToRecords(file);

    if (rawRecords.length === 0) {
      rawChunks = ["(empty workbook)"];
    } else {
      // Normalize comma-formatted numbers ("2,865" → 2865) before chunking/serialisation.
      const allRecords = normalizeRecords(rawRecords);

      // Detect pivoted fiscal-year tables and prepend an LLM annotation.
      const pivoted = isPivotedFiscalTable(allRecords);
      const annotation = pivoted ? PIVOT_ANNOTATION : "";

      const bodyText = JSON.stringify(allRecords, null, 2);

      if (estimateTokens(annotation + bodyText) > maxTokens) {
        // For pivoted tables the annotation goes on the first chunk only.
        const subChunks = recordsToChunks(allRecords, maxTokens);
        rawChunks = subChunks.map((c, idx) => (idx === 0 ? annotation + c : c));
      } else {
        rawChunks = [annotation + bodyText];
      }
    }
  } else {
    throw new Error(`Unsupported file type: ${file.name} (.${ext})`);
  }

  return rawChunks.map((content, i) => ({
    sourceFile: file.name,
    chunkIndex: i,
    totalChunks: rawChunks.length,
    content,
    estimatedTokens: estimateTokens(content),
  }));
}

/**
 * Wrap free-text notes as a single FileChunk (may split if enormous).
 */
export function chunkTextNotes(notes: string, provider: LLMProvider): FileChunk[] {
  const maxTokens = getChunkTokenLimit(provider);
  const rawChunks = splitText(notes.trim(), maxTokens);
  return rawChunks.map((content, i) => ({
    sourceFile: "text-notes",
    chunkIndex: i,
    totalChunks: rawChunks.length,
    content,
    estimatedTokens: estimateTokens(content),
  }));
}
