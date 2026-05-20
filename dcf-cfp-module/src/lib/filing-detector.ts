/**
 * filing-detector.ts
 *
 * Parses a PDF filename to extract filing metadata.
 *
 * Expected naming conventions:
 *   10-K  : TICKER-10K-YYYY.pdf         e.g. JPM-10K-2024.pdf
 *   10-Q  : TICKER-10Q-Qn-YYYY.pdf     e.g. JPM-10Q-Q1-2024.pdf
 *           Q4 10-Q is accepted when explicitly uploaded (some companies publish Q4
 *           earnings reports); if not uploaded, Q4 is auto-derived from the 10-K.
 * Up to 5 10-K files (years) and 20 10-Q files (4 per year × 5 years).
 */

export type FilingType = "10-K" | "10-Q";
export type FilingPeriod = "annual" | "Q1" | "Q2" | "Q3" | "Q4";

export interface DetectedFiling {
  file: File;
  fileName: string;
  filingType: FilingType;
  year: number;
  period: FilingPeriod;
  /** Human-readable label, e.g. "JPM 10-K 2024" or "JPM 10-Q Q1 2024" */
  displayName: string;
  /**
   * Numeric key for chronological sort within the extraction run.
   * 10-K comes first inside each year (position 0), then Q1=1, Q2=2, Q3=3.
   *  sortKey = year * 10 + position
   */
  sortKey: number;
}

export interface FilingDetectionError {
  fileName: string;
  reason: string;
}

export type FilingDetectionResult = DetectedFiling | FilingDetectionError;

export function isDetectionError(r: FilingDetectionResult): r is FilingDetectionError {
  return "reason" in r;
}

// Matches "10K", "10-K", "10_K" case-insensitively
const RE_10K = /10[-_\s]?k\b/i;
// Matches "10Q", "10-Q", "10_Q" case-insensitively
const RE_10Q = /10[-_\s]?q\b/i;
// Matches a 4-digit year 2000–2099
const RE_YEAR = /\b(20\d{2})\b/;
// Matches Q1–Q4 surrounded by non-alphanumeric chars
const RE_QUARTER = /[^a-z0-9](q([1-4]))[^a-z0-9]/i;
// Fallback quarter scan (at word boundary)
const RE_QUARTER_LOOSE = /\bq([1-4])\b/i;

/**
 * Try to detect filing type, year, and quarter from a single filename.
 * Returns a `FilingDetectionError` (with `reason`) when detection fails.
 */
export function detectFiling(file: File): FilingDetectionResult {
  const name = file.name;

  // ── Year ─────────────────────────────────────────────────────────────────
  const yearMatch = name.match(RE_YEAR);
  if (!yearMatch) {
    return {
      fileName: name,
      reason: 'No year (20XX) found. Rename to e.g. "JPM-10K-2024.pdf".',
    };
  }
  const year = parseInt(yearMatch[1], 10);

  // Derive a short ticker prefix for displayName (everything before first dash/underscore)
  const tickerRaw = name.split(/[-_.]/)[0].toUpperCase();
  const ticker = tickerRaw || "Unknown";

  // ── 10-K ─────────────────────────────────────────────────────────────────
  if (RE_10K.test(name)) {
    return {
      file,
      fileName: name,
      filingType: "10-K",
      year,
      period: "annual",
      displayName: `${ticker} ${year} Annual (10-K)`,
      sortKey: year * 10 + 0, // annual processed first within year
    };
  }

  // ── 10-Q ─────────────────────────────────────────────────────────────────
  if (RE_10Q.test(name)) {
    // Try strict match first (Q1/Q2/Q3 surrounded by non-alphanumeric chars)
    let qNum: number | null = null;
    const strictMatch = name.match(RE_QUARTER);
    if (strictMatch) {
      qNum = parseInt(strictMatch[2], 10);
    } else {
      // Loose fallback: just find Q1/Q2/Q3 anywhere
      const looseMatch = name.match(RE_QUARTER_LOOSE);
      if (looseMatch) {
        qNum = parseInt(looseMatch[1], 10);
      }
    }

    if (qNum === null) {
      return {
        fileName: name,
        reason:
          'Quarter (Q1/Q2/Q3/Q4) not found in 10-Q filename. Rename to e.g. "JPM-10Q-Q2-2024.pdf".',
      };
    }

    const period = `Q${qNum}` as FilingPeriod;
    return {
      file,
      fileName: name,
      filingType: "10-Q",
      year,
      period,
      displayName: `${ticker} ${year} ${period} (10-Q)`,
      sortKey: year * 10 + qNum, // Q4 → position 4, processed after Q3
    };
  }

  // ── Neither ───────────────────────────────────────────────────────────────
  return {
    fileName: name,
    reason: 'Filename must contain "10K" or "10Q". Rename to e.g. "JPM-10K-2024.pdf".',
  };
}

export interface DetectFilingsOutput {
  detected: DetectedFiling[];
  errors: FilingDetectionError[];
}

/**
 * Detect and sort a batch of PDF files.
 * Returns {detected} (sorted chronologically) and {errors} (files that could not be parsed).
 *
 * Sort order: year ascending, then within each year: 10-K → Q1 → Q2 → Q3.
 */
export function detectFilings(files: File[]): DetectFilingsOutput {
  const detected: DetectedFiling[] = [];
  const errors: FilingDetectionError[] = [];

  for (const file of files) {
    const result = detectFiling(file);
    if (isDetectionError(result)) {
      errors.push(result);
    } else {
      detected.push(result);
    }
  }

  // Stable chronological sort
  detected.sort((a, b) => a.sortKey - b.sortKey);

  return { detected, errors };
}

/**
 * Summarise the detected filing set for display.
 *   e.g. "3 × 10-K, 9 × 10-Q spanning 2020–2022"
 */
export function summariseFilings(detected: DetectedFiling[]): string {
  if (detected.length === 0) return "No filings detected.";
  const tenKCount = detected.filter((f) => f.filingType === "10-K").length;
  const tenQCount = detected.filter((f) => f.filingType === "10-Q").length;
  const years = detected.map((f) => f.year);
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  const yearRange = minYear === maxYear ? String(minYear) : `${minYear}–${maxYear}`;
  const parts: string[] = [];
  if (tenKCount > 0) parts.push(`${tenKCount} × 10-K`);
  if (tenQCount > 0) parts.push(`${tenQCount} × 10-Q`);
  return `${parts.join(", ")} spanning ${yearRange}`;
}

/** Max allowed uploads per type */
export const MAX_10K_FILES = 5;
export const MAX_10Q_FILES = 20; // up to 4 quarters × 5 years
export const MAX_TOTAL_PDF_FILES = MAX_10K_FILES + MAX_10Q_FILES;
