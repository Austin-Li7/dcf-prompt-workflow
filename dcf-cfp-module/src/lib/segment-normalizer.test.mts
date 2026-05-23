import test from "node:test";
import assert from "node:assert/strict";
import { findCanonicalMatch, normalizeSegmentNames } from "./segment-normalizer.ts";
import type { HistoricalExtractionRow } from "../types/cfp.ts";

// ── findCanonicalMatch ────────────────────────────────────────────────────────

test("exact match returns the canonical name unchanged", () => {
  const result = findCanonicalMatch("Lending", ["Lending", "Financial Services", "Technology Platform"]);
  assert.equal(result, "Lending");
});

test("case-insensitive match normalises to canonical casing", () => {
  const result = findCanonicalMatch("lending", ["Lending", "Financial Services"]);
  assert.equal(result, "Lending");
});

test("substring match: raw contains canonical name", () => {
  const result = findCanonicalMatch("SoFi Lending Division", ["Lending", "Financial Services"]);
  assert.equal(result, "Lending");
});

test("substring match: canonical name contains raw", () => {
  const result = findCanonicalMatch("Tech Platform", ["Technology Platform", "Financial Services"]);
  assert.equal(result, "Technology Platform");
});

test("Levenshtein match on minor typo", () => {
  const result = findCanonicalMatch("Lendings", ["Lending", "Financial Services"]);
  assert.equal(result, "Lending");
});

test("Consolidated is always a valid match", () => {
  const result = findCanonicalMatch("consolidated", ["Lending", "Consolidated"]);
  assert.equal(result, "Consolidated");
});

test("returns null when no match found", () => {
  const result = findCanonicalMatch("Corporate Treasury", ["Lending", "Financial Services"]);
  assert.equal(result, null);
});

test("does not false-positive short strings", () => {
  // "NII" should NOT match "Financial Services" or "Lending"
  const result = findCanonicalMatch("NII", ["Lending", "Financial Services"]);
  assert.equal(result, null);
});

// ── normalizeSegmentNames ─────────────────────────────────────────────────────

function makeRow(segment: string): HistoricalExtractionRow {
  return {
    id: "test-id",
    fiscalYear: 2024,
    quarter: "Q1",
    segment,
    productCategory: "Banking",
    productName: segment,
    revenue: null,
    yoyGrowth: 0,
    operatingIncome: null,
    notes: "",
    reviewNote: "original note",
    workflow_mode: "bank",
  };
}

const architecture = {
  segments: [
    { segment: "Lending" },
    { segment: "Financial Services" },
    { segment: "Technology Platform" },
  ],
};

test("normalizes variant segment names in-place", () => {
  const rows = [
    makeRow("SoFi Lending"),
    makeRow("Financial Services"),
    makeRow("Tech Platform"),
  ];
  const report = normalizeSegmentNames(rows, architecture);
  assert.equal(rows[0].segment, "Lending");
  assert.equal(rows[1].segment, "Financial Services"); // already canonical
  assert.equal(rows[2].segment, "Technology Platform");
  assert.equal(report.normalized, 2);
  assert.equal(report.mappings.length, 2);
  assert.equal(report.unmatched.length, 0);
});

test("Consolidated is always accepted even if not in architecture", () => {
  const rows = [makeRow("Consolidated")];
  const report = normalizeSegmentNames(rows, architecture);
  assert.equal(rows[0].segment, "Consolidated");
  assert.equal(report.normalized, 0); // already canonical
});

test("leaves unmatched segments unchanged and reports them", () => {
  const rows = [makeRow("Corporate Treasury"), makeRow("Lending")];
  const report = normalizeSegmentNames(rows, architecture);
  assert.equal(rows[0].segment, "Corporate Treasury");
  assert.deepEqual(report.unmatched, ["Corporate Treasury"]);
  assert.equal(report.normalized, 0);
});

test("appends rename note to reviewNote", () => {
  const rows = [makeRow("SoFi Lending Division")];
  normalizeSegmentNames(rows, architecture);
  assert.ok(rows[0].reviewNote?.includes('→ "Lending"'));
});

test("empty architecture only accepts Consolidated", () => {
  const rows = [makeRow("Lending"), makeRow("Consolidated")];
  const report = normalizeSegmentNames(rows, {});
  assert.equal(rows[1].segment, "Consolidated"); // stays
  assert.equal(report.unmatched.includes("Lending"), true);
});
