"use client";

import type { HistoricalExtractionRow } from "@/types/cfp";
import type { Step2IndustrialStructuredResult } from "@/lib/step2-industrial-schema";

export interface XbrlSegmentCoverage {
  requestedSegments: string[];
  matchedSegments: string[];
  missingSegments: string[];
  note: string;
}

export interface XbrlTargetLine {
  name: string;
  parentSegment: string;
  category: string;
  isOffering: boolean;
}

export interface XbrlHistoryResult {
  ticker: string;
  cik: string;
  companyName: string;
  years: number[];
  rows: HistoricalExtractionRow[];
  structuredResults: Step2IndustrialStructuredResult[];
  segmentCoverage: XbrlSegmentCoverage;
  warnings: string[];
}

export async function fetchXbrlHistory(
  query: string,
  targetLines: XbrlTargetLine[],
  years = 5,
): Promise<XbrlHistoryResult> {
  const res = await fetch("/api/xbrl-history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, targetLines, segmentNames: targetLines.map((line) => line.name), years }),
  });
  const data = (await res.json()) as XbrlHistoryResult & { error?: string };
  if (!res.ok || data.error) {
    throw new Error(data.error ?? "SEC XBRL import failed.");
  }
  return data;
}
