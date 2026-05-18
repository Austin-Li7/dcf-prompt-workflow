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

import * as XLSX from "xlsx";
import type { LLMProvider } from "@/types/cfp";

// =============================================================================
// Token budget
// =============================================================================

const PROVIDER_TOKEN_TARGETS: Record<LLMProvider, number> = {
  gemini: 700_000, // 1M cap, leave headroom for response + system prompt
  claude: 150_000, // 200k cap
  deepseek: 50_000, // 64k input cap; leave headroom for system prompt + response
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
  "// Column headers (FY2021, FY2022, …) are fiscal years; each JSON object is ONE metric row.\n" +
  "//\n" +
  "// HOW TO BUILD ChunkRows — for EACH fiscal-year column:\n" +
  "//   1. Create exactly ONE ChunkRow per fiscal year by combining ALL metric rows for that year:\n" +
  "//      • Item contains 'revenue' or 'Total revenue'   → revenue_usd_m\n" +
  "//      • Item contains 'Operating income' or 'EBIT'   → operating_income_usd_m\n" +
  "//   2. Annual-only source → set quarter = 'Q4' (represents the full-year figure).\n" +
  "//   3. No segment breakdown in this table → set segment = 'Total',\n" +
  "//      product_category = 'Total', product_name = 'Total'.\n" +
  "//   4. DO NOT emit a separate ChunkRow per metric row; all metrics for a year go in ONE row.\n" +
  "//   5. Values are already in USD millions — do not rescale.\n" +
  "//\n\n";

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
// Nested-JSON flattener
// =============================================================================

/**
 * Detect and flatten nested financial JSON structures like:
 *   { "company": "...", "year": 2025, "quarters": [
 *     { "quarter": "Q1", "segments": { "segment_name": { "revenue": ..., "operating_earnings": ... } } }
 *   ]}
 *
 * Returns flat records (one per segment × quarter) so the LLM can extract
 * every segment cleanly, including those with null revenue.
 * Returns null if the object does not match this pattern.
 */
function flattenNestedFinancials(
  obj: Record<string, unknown>,
): Array<Record<string, unknown>> | null {
  const quarters = obj.quarters ?? obj.periods ?? obj.data;
  if (!Array.isArray(quarters) || quarters.length === 0) return null;

  const fiscalYear = obj.year ?? obj.fiscal_year ?? obj.fiscalYear;
  const company = obj.company ?? obj.ticker ?? "";
  const currency = obj.currency ?? "USD in millions";

  const flattened: Array<Record<string, unknown>> = [];

  for (const q of quarters) {
    if (!q || typeof q !== "object" || Array.isArray(q)) continue;
    const qRec = q as Record<string, unknown>;
    const quarter = qRec.quarter ?? qRec.period ?? qRec.Quarter;
    const qYear = qRec.year ?? qRec.fiscal_year ?? fiscalYear;
    const segments = qRec.segments ?? qRec.business_segments ?? qRec.breakdown;

    if (segments && typeof segments === "object" && !Array.isArray(segments)) {
      for (const [segName, segData] of Object.entries(segments as Record<string, unknown>)) {
        if (!segData || typeof segData !== "object" || Array.isArray(segData)) continue;
        const seg = segData as Record<string, unknown>;
        flattened.push({
          company,
          currency,
          fiscal_year: qYear,
          quarter,
          segment: segName,
          revenue_usd_m:
            seg.revenue ?? seg.revenue_usd_m ?? seg.total_revenue ?? null,
          operating_income_usd_m:
            seg.operating_earnings ?? seg.operating_income ?? seg.operating_income_usd_m ?? null,
        });
      }
    }
  }

  return flattened.length > 0 ? flattened : null;
}

const NESTED_JSON_ANNOTATION =
  "// TABLE FORMAT NOTE: This data was flattened from a nested JSON structure.\n" +
  "// Each record represents ONE business segment for ONE fiscal quarter.\n" +
  "// 'revenue_usd_m' is null for segments that only disclose operating income (e.g. investment income).\n" +
  "// IMPORTANT: Extract ALL segments, even those where revenue_usd_m is null — include them with\n" +
  "//   revenue_usd_m: null and the disclosed operating_income_usd_m value.\n\n";

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
  let rawChunks: string[] = [];

  if (ext === "txt" || ext === "json") {
    const text = await file.text();
    const trimmed = text.trim();
    let handledAsJson = false;

    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        let records: Array<Record<string, unknown>> = [];
        let annotation = "";

        if (Array.isArray(parsed)) {
          records = parsed as Array<Record<string, unknown>>;
        } else if (parsed && typeof parsed === "object") {
          const obj = parsed as Record<string, unknown>;

          // Try nested-financial structure first (e.g. BRK quarters+segments)
          const flattened = flattenNestedFinancials(obj);
          if (flattened) {
            records = flattened;
            annotation = NESTED_JSON_ANNOTATION;
          } else {
            // Try common DCF fixture wrapper keys
            const candidate = obj.rows ?? obj.data ?? obj.records;
            if (Array.isArray(candidate)) {
              records = candidate as Array<Record<string, unknown>>;
            } else {
              records = [obj];
            }
          }
        }

        if (records.length > 0) {
          const normalizedRecords = normalizeRecords(records);
          const bodyText = JSON.stringify(normalizedRecords, null, 2);
          const fullText = annotation + bodyText;
          rawChunks =
            estimateTokens(fullText) > maxTokens
              ? recordsToChunks(normalizedRecords, maxTokens).map((c, i) =>
                  i === 0 ? annotation + c : c,
                )
              : [fullText];
          handledAsJson = true;
        }
      } catch {
        // Not valid JSON — fall through to text splitting.
      }
    }

    if (!handledAsJson) {
      rawChunks = splitText(text, maxTokens);
    }
  } else if (["csv", "xlsx", "xls", "xlsm"].includes(ext)) {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: "array" });
    const rawRecords: Array<Record<string, unknown>> = [];

    for (const sheetName of wb.SheetNames) {
      rawRecords.push(
        ...XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], {
          defval: "",
        }),
      );
    }

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

// =============================================================================
// Targeted page selection (Step 1–guided relevance scoring)
// =============================================================================

const FINANCIAL_PAGE_KEYWORDS = [
  "revenue", "net revenue", "total revenue",
  "operating income", "operating loss",
  "gross profit", "gross margin",
  "capital expenditure", "capex",
  "depreciation", "amortization",
  "headcount", "employees", "employee",
  "net income", "net loss",
  "income statement", "statements of operations", "statements of income",
  "consolidated statement", "condensed consolidated",
  "segment information", "segment results", "segment revenue",
  "selected financial data", "selected quarterly",
  "three months ended", "six months ended", "nine months ended",
  "twelve months ended", "year ended", "quarter ended",
  "fiscal year", "fiscal quarter",
];

/** Walk any nested object and collect string values from "segment" and "name" keys. */
function extractSegmentTerms(architecture: unknown): string[] {
  const terms: string[] = [];
  function walk(obj: unknown) {
    if (!obj || typeof obj !== "object") return;
    const o = obj as Record<string, unknown>;
    if (typeof o.segment === "string" && o.segment.length >= 2)
      terms.push(o.segment.toLowerCase());
    if (typeof o.name === "string" && o.name.length >= 2)
      terms.push(o.name.toLowerCase());
    for (const v of Object.values(o)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") walk(v);
    }
  }
  walk(architecture);
  return [...new Set(terms)];
}

function scorePageRelevance(
  pageText: string,
  segmentTerms: string[],
  targetYear?: number,
): number {
  const lower = pageText.toLowerCase();
  let score = 0;

  for (const term of segmentTerms) {
    if (lower.includes(term)) score += 5;
  }
  for (const kw of FINANCIAL_PAGE_KEYWORDS) {
    if (lower.includes(kw)) score += 2;
  }
  // Numeric density — financial tables pack many numbers on one page
  const numCount = (pageText.match(/\b\d[\d,.]+\b/g) ?? []).length;
  score += Math.min(numCount, 30);
  // Fiscal year mention
  if (targetYear && pageText.includes(String(targetYear))) score += 3;

  return score;
}

/**
 * Given full PDF text (with "--- Page N ---" markers), return a filtered version
 * containing only the top `maxPages` most financially relevant pages plus their
 * immediate neighbours for context.
 *
 * Falls back to the full text if no page markers are found.
 */
export function selectRelevantPages(
  fullText: string,
  architecture: unknown,
  targetYear?: number,
  maxPages = 40,
): { text: string; selected: number; total: number } {
  const PAGE_MARKER_RE = /--- Page (\d+) ---/g;
  const pageStarts: Array<{ pageNum: number; start: number }> = [];
  let match: RegExpExecArray | null;

  while ((match = PAGE_MARKER_RE.exec(fullText)) !== null) {
    pageStarts.push({ pageNum: parseInt(match[1], 10), start: match.index });
  }

  if (pageStarts.length === 0) {
    return { text: fullText, selected: 0, total: 0 };
  }

  const segmentTerms = extractSegmentTerms(architecture);

  // Slice each page's text
  const pages = pageStarts.map((entry, i) => {
    const end =
      i + 1 < pageStarts.length ? pageStarts[i + 1].start : fullText.length;
    const text = fullText.slice(entry.start, end);
    return {
      pageNum: entry.pageNum,
      text,
      score: scorePageRelevance(text, segmentTerms, targetYear),
    };
  });

  // Pick top-N by score, plus ±1 neighbours for context
  const sorted = [...pages].sort((a, b) => b.score - a.score);
  const selectedNums = new Set<number>();
  for (const p of sorted.slice(0, maxPages)) {
    selectedNums.add(p.pageNum);
    if (p.pageNum > 1) selectedNums.add(p.pageNum - 1);
    selectedNums.add(p.pageNum + 1);
  }

  const filtered = pages
    .filter((p) => selectedNums.has(p.pageNum))
    .map((p) => p.text)
    .join("\n\n");

  return {
    text: filtered || fullText,
    selected: selectedNums.size,
    total: pages.length,
  };
}

// =============================================================================
// PDF text chunker
// =============================================================================

/**
 * Chunk pre-extracted PDF text (plain string) exactly like a .txt file.
 * Use this after server-side PDF parsing returns the raw text.
 *
 * When `architecture` is provided (Step 1 result), the text is first filtered
 * to only the top financially relevant pages — dramatically reducing token usage
 * for large filings (e.g. 500-page 10-Ks → ~50 targeted pages).
 *
 * A PDF-specific annotation header is prepended to every chunk so the LLM
 * knows it is reading extracted PDF text (not a spreadsheet or JSON file).
 */
export function chunkPdfText(
  text: string,
  /** Original PDF filename, e.g. "JPM-10K-2024.pdf" */
  fileName: string,
  provider: LLMProvider,
  /** Optional Step 1 architecture — enables targeted page selection */
  architecture?: unknown,
  /** Optional fiscal year — used to boost pages mentioning that year */
  targetYear?: number,
): FileChunk[] {
  const maxTokens = getChunkTokenLimit(provider);

  // Filter to relevant pages when architecture is available
  let workingText = text.trim();
  let pageNote = "";
  if (architecture) {
    const { text: filtered, selected, total } = selectRelevantPages(
      workingText,
      architecture,
      targetYear,
    );
    if (total > 0 && selected < total) {
      workingText = filtered;
      pageNote = `// Targeted extraction: ${selected} of ${total} pages selected by relevance scoring.\n`;
    }
  }

  const annotation =
    `// SOURCE: Extracted text from ${fileName}\n` +
    `// FORMAT: Plain text extracted from a SEC PDF filing (10-K or 10-Q).\n` +
    `// Pages are delimited by "--- Page N ---" markers.\n` +
    `// Extract all financial figures in USD millions (convert if stated in thousands or billions).\n` +
    pageNote +
    `\n`;

  const rawChunks = splitText(workingText, maxTokens - estimateTokens(annotation));
  return rawChunks.map((content, i) => ({
    sourceFile: fileName,
    chunkIndex: i,
    totalChunks: rawChunks.length,
    content: annotation + content,
    estimatedTokens: estimateTokens(annotation + content),
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
