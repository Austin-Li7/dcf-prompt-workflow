import type { Step2StructuredResult } from "../types/cfp.ts";
import type { Step2BankStructuredResult } from "./step2-bank-schema.ts";

// Industrial fixture: all 7 columns must be present
const REQUIRED_COLUMNS = [
  "fiscal_year",
  "quarter",
  "segment",
  "product_category",
  "product_name",
  "revenue_usd_m",
  "operating_income_usd_m",
];

// Bank fixture: base triple + at least one income metric
const BANK_BASE_COLUMNS = ["fiscal_year", "quarter", "segment"];
const BANK_INCOME_COLUMNS = [
  "nii_usd_m",
  "net_interest_income_usd_m",
  "nim_pct",
  "net_interest_margin_pct",
  "book_value_equity_usd_m",
  "total_assets_usd_m",
  "cet1_ratio_pct",
  "tier1_capital_ratio_pct",
  "non_interest_income_usd_m",
  "net_income_usd_m",
  "return_on_avg_equity_pct",
];

export type DcfInputSummary = {
  companyName: string | null;
  ticker: string | null;
  quarterlyRows: number;
  annualDriverYears: number;
  baseYearFiscalYear: number | null;
  baseYearRevenueUsdM: number | null;
  baseYearEbitUsdM: number | null;
  baseYearFreeCashFlowUsdM: number | null;
  cashAndMarketableSecuritiesUsdM: number | null;
  totalDebtUsdM: number | null;
  commonSharesOutstandingM: number | null;
  hasForecastAssumptions: boolean;
  hasValuationAssumptions: boolean;
  hasReadinessChecklist: boolean;
  readinessComplete: boolean;
  availableModules: string[];
};

function normalizeKey(key: string): string {
  return key.trim().toLowerCase();
}

function readField(record: Record<string, unknown>, key: string): unknown {
  const foundKey = Object.keys(record).find((candidate) => normalizeKey(candidate) === key);
  return foundKey ? record[foundKey] : undefined;
}

function hasFixtureColumns(record: Record<string, unknown>): boolean {
  const keys = new Set(Object.keys(record).map(normalizeKey));
  return REQUIRED_COLUMNS.every((column) => keys.has(column));
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function toText(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export function recordsFromDcfInputPayload(payload: unknown): Array<Record<string, unknown>> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }

  const record = payload as Record<string, unknown>;
  const quarterlyBaseline = record.historical_quarterly_baseline;
  if (
    quarterlyBaseline &&
    typeof quarterlyBaseline === "object" &&
    !Array.isArray(quarterlyBaseline)
  ) {
    const rows = (quarterlyBaseline as Record<string, unknown>).rows;
    if (
      Array.isArray(rows) &&
      rows.every((row) => row && typeof row === "object" && !Array.isArray(row))
    ) {
      return rows as Array<Record<string, unknown>>;
    }
  }

  if (
    Array.isArray(record.rows) &&
    record.rows.every((row) => row && typeof row === "object" && !Array.isArray(row))
  ) {
    return record.rows as Array<Record<string, unknown>>;
  }

  return [];
}

function objectValue(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = record[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function summarizeDcfInputPayload(payload: unknown): DcfInputSummary | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const quarterlyRows = recordsFromDcfInputPayload(record);
  const annualDrivers = record.historical_annual_dcf_drivers;
  const annualDriverYears = Array.isArray(annualDrivers) ? annualDrivers.length : 0;
  const baseYear = objectValue(record, "normalized_base_year");
  const company = objectValue(record, "company");
  const forecastAssumptions = objectValue(record, "forecast_seed_assumptions");
  const valuationAssumptions = objectValue(record, "valuation_assumptions");
  const readinessChecklist = objectValue(record, "minimum_dcf_readiness_checklist");

  if (
    quarterlyRows.length === 0 &&
    annualDriverYears === 0 &&
    !baseYear &&
    !forecastAssumptions &&
    !valuationAssumptions
  ) {
    return null;
  }

  const availableModules = [
    quarterlyRows.length > 0 ? "Quarterly historical baseline" : "",
    annualDriverYears > 0 ? "Annual DCF drivers" : "",
    baseYear ? "Normalized base year" : "",
    forecastAssumptions ? "Forecast seed assumptions" : "",
    valuationAssumptions ? "Valuation assumptions" : "",
    readinessChecklist ? "Readiness checklist" : "",
  ].filter(Boolean);

  return {
    companyName: company ? toText(company.name, null as unknown as string) || null : null,
    ticker: company ? toText(company.ticker, null as unknown as string) || null : null,
    quarterlyRows: quarterlyRows.length,
    annualDriverYears,
    baseYearFiscalYear: baseYear ? toNumber(baseYear.fiscal_year) : null,
    baseYearRevenueUsdM: baseYear ? toNumber(baseYear.revenue_usd_m) : null,
    baseYearEbitUsdM: baseYear ? toNumber(baseYear.ebit_usd_m) : null,
    baseYearFreeCashFlowUsdM: baseYear ? toNumber(baseYear.free_cash_flow_usd_m) : null,
    cashAndMarketableSecuritiesUsdM: baseYear
      ? toNumber(baseYear.cash_and_marketable_securities_usd_m)
      : null,
    totalDebtUsdM: baseYear ? toNumber(baseYear.total_debt_usd_m) : null,
    commonSharesOutstandingM: baseYear ? toNumber(baseYear.common_shares_outstanding_m) : null,
    hasForecastAssumptions: !!forecastAssumptions,
    hasValuationAssumptions: !!valuationAssumptions,
    hasReadinessChecklist: !!readinessChecklist,
    readinessComplete: readinessChecklist
      ? Object.values(readinessChecklist).every((value) => value === true)
      : false,
    availableModules,
  };
}

export function buildStep2StructuredFromFixtureRecords(
  records: Array<Record<string, unknown>>,
  targetYear: number,
  fallbackSourceName: string,
): Step2StructuredResult | null {
  const fixtureRecords = records.filter(hasFixtureColumns);
  if (fixtureRecords.length === 0) return null;

  const rowsForYear = fixtureRecords.filter(
    (record) => toNumber(readField(record, "fiscal_year")) === targetYear,
  );
  if (rowsForYear.length === 0) return null;

  const sourceIds = new Map<string, string>();
  const sources: Step2StructuredResult["sources"] = [];
  const validationWarnings: Step2StructuredResult["validation_warnings"] = [];

  function sourceIdFor(record: Record<string, unknown>): string {
    const sourceName = toText(readField(record, "source_name"), fallbackSourceName);
    const sourceLocator = toText(readField(record, "source_url"), "uploaded fixture");
    const key = `${sourceName}|${sourceLocator}`;
    const existing = sourceIds.get(key);
    if (existing) return existing;

    const sourceId = `source:fixture:${sourceIds.size + 1}`;
    const sourceExcerpt = toText(readField(record, "review_note"));
    sourceIds.set(key, sourceId);
    sources.push({
      source_id: sourceId,
      source_type: "uploaded_file",
      name: sourceName,
      locator: sourceLocator,
      excerpt: sourceExcerpt ? sourceExcerpt.slice(0, 220) : null,
    });
    return sourceId;
  }

  const rows: Step2StructuredResult["rows"] = rowsForYear.map((record, index) => {
    const quarter = toText(readField(record, "quarter"), "Q1") as "Q1" | "Q2" | "Q3" | "Q4";
    const segment = toText(readField(record, "segment"), "Total Company");
    const productCategory = toText(readField(record, "product_category"), segment);
    const productName = toText(readField(record, "product_name"), productCategory);
    const revenue = toNumber(readField(record, "revenue_usd_m"));
    const operatingIncome = toNumber(readField(record, "operating_income_usd_m"));
    const rowId = `row:${targetYear}:${quarter.toLowerCase()}:${slug(segment)}:${slug(productName)}:${index + 1}`;
    const missingMetrics = [
      revenue === null ? "revenue" : "",
      operatingIncome === null ? "operating income" : "",
    ].filter(Boolean);

    if (missingMetrics.length > 0) {
      validationWarnings.push({
        code: "MISSING_FINANCIAL_METRIC",
        severity: revenue === null ? "high" : "warn",
        message: `Missing ${missingMetrics.join(" and ")} for ${segment} / ${productName}.`,
        row_ids: [rowId],
      });
    }

    return {
      row_id: rowId,
      fiscal_year: targetYear,
      quarter,
      segment,
      product_category: productCategory,
      product_name: productName,
      revenue_usd_m: revenue,
      operating_income_usd_m: operatingIncome,
      mapped_from_step1_ids: toText(
        readField(record, "mapped_from_step1_ids"),
        `segment:${slug(segment)}`,
      )
        .split(";")
        .map((entry) => entry.trim())
        .filter(Boolean),
      source_id: sourceIdFor(record),
      evidence_level: "DISCLOSED",
      validation_status:
        toText(readField(record, "validation_status"), "verified_source") === "verified_source"
          ? "verified_source"
          : "needs_review",
      review_note: toText(
        readField(record, "review_note"),
        "Imported directly from standard Step 2 fixture columns.",
      ).slice(0, 220),
    };
  });

  return {
    schema_version: "v5.5",
    company_name: "Imported Company",
    target_year: targetYear,
    rows,
    sources,
    excluded_items: [],
    validation_warnings: validationWarnings,
    review_summary: {
      one_line: `${rows.length} row(s) imported from standard Step 2 fixture columns for FY ${targetYear}.`,
      highlights: ["Standard fixture columns were imported deterministically without LLM extraction."],
      warnings: validationWarnings.map((warning) => warning.message),
    },
  };
}

// =============================================================================
// Bank XLSX fixture ingest
// =============================================================================

function hasBankFixtureColumns(record: Record<string, unknown>): boolean {
  const keys = new Set(Object.keys(record).map(normalizeKey));
  if (!BANK_BASE_COLUMNS.every((c) => keys.has(c))) return false;
  return BANK_INCOME_COLUMNS.some((c) => keys.has(c));
}

/**
 * Build a Step2BankStructuredResult from XLSX records that contain bank-specific
 * columns (nii_usd_m, nim_pct, cet1_ratio_pct, etc.).
 * Returns null when no bank-signature rows are found for targetYear.
 */
export function buildStep2BankStructuredFromFixtureRecords(
  records: Array<Record<string, unknown>>,
  targetYear: number,
  fallbackSourceName: string,
): Step2BankStructuredResult | null {
  const bankRecords = records.filter(hasBankFixtureColumns);
  if (bankRecords.length === 0) return null;

  const rowsForYear = bankRecords.filter(
    (r) => toNumber(readField(r, "fiscal_year")) === targetYear,
  );
  if (rowsForYear.length === 0) return null;

  const sourceIds = new Map<string, string>();
  const sources: Step2BankStructuredResult["sources"] = [];
  const validationWarnings: Step2BankStructuredResult["validation_warnings"] = [];

  function sourceIdFor(record: Record<string, unknown>): string {
    const name = toText(readField(record, "source_name"), fallbackSourceName);
    const locator = toText(readField(record, "source_url"), "uploaded fixture");
    const key = `${name}|${locator}`;
    const existing = sourceIds.get(key);
    if (existing) return existing;
    const id = `source:bank-fixture:${sourceIds.size + 1}`;
    sourceIds.set(key, id);
    sources.push({ source_id: id, source_type: "uploaded_file", name, locator, excerpt: null });
    return id;
  }

  const rows: Step2BankStructuredResult["rows"] = rowsForYear.map((record, idx) => {
    const quarter = toText(readField(record, "quarter"), "Q4") as "Q1" | "Q2" | "Q3" | "Q4";
    const segment = toText(readField(record, "segment"), "Consolidated");
    const rowId = `row:bank:${targetYear}:${quarter.toLowerCase()}:${slug(segment)}:${idx + 1}`;

    const nii = toNumber(readField(record, "nii_usd_m")) ?? toNumber(readField(record, "net_interest_income_usd_m"));
    const nim = toNumber(readField(record, "net_interest_margin_pct")) ?? toNumber(readField(record, "nim_pct"));

    // Warn if no primary income metric present
    if (nii === null && toNumber(readField(record, "non_interest_income_usd_m")) === null && toNumber(readField(record, "net_income_usd_m")) === null) {
      validationWarnings.push({
        code: "MISSING_PRIMARY_METRIC",
        severity: "warn",
        message: `No primary income metric for ${segment} ${quarter} — row kept with all nulls.`,
        row_ids: [rowId],
      });
    }

    return {
      row_id: rowId,
      fiscal_year: targetYear,
      quarter,
      segment,
      nii_usd_m: nii,
      non_interest_income_usd_m: toNumber(readField(record, "non_interest_income_usd_m")),
      provision_for_credit_losses_usd_m: toNumber(readField(record, "provision_for_credit_losses_usd_m")),
      net_income_usd_m: toNumber(readField(record, "net_income_usd_m")),
      book_value_equity_usd_m: toNumber(readField(record, "book_value_equity_usd_m")),
      goodwill_usd_m: toNumber(readField(record, "goodwill_usd_m")),
      intangible_assets_usd_m: toNumber(readField(record, "intangible_assets_usd_m")),
      preferred_equity_usd_m: toNumber(readField(record, "preferred_equity_usd_m")),
      total_rwa_usd_m: toNumber(readField(record, "total_rwa_usd_m")),
      tier1_capital_ratio_pct: toNumber(readField(record, "tier1_capital_ratio_pct")),
      cet1_ratio_pct: toNumber(readField(record, "cet1_ratio_pct")),
      net_interest_margin_pct: nim,
      efficiency_ratio_pct: toNumber(readField(record, "efficiency_ratio_pct")),
      return_on_avg_equity_pct: toNumber(readField(record, "return_on_avg_equity_pct")),
      total_assets_usd_m: toNumber(readField(record, "total_assets_usd_m")),
      total_loans_usd_m: toNumber(readField(record, "total_loans_usd_m")),
      total_deposits_usd_m: toNumber(readField(record, "total_deposits_usd_m")),
      retail_insured_deposits_usd_m: toNumber(readField(record, "retail_insured_deposits_usd_m")),
      wholesale_uninsured_deposits_usd_m: toNumber(readField(record, "wholesale_uninsured_deposits_usd_m")),
      cash_and_hqla_usd_m: toNumber(readField(record, "cash_and_hqla_usd_m")),
      htm_bonds_usd_m: toNumber(readField(record, "htm_bonds_usd_m")),
      unrealized_losses_htm_usd_m: toNumber(readField(record, "unrealized_losses_htm_usd_m")),
      mapped_from_step1_ids: [`segment:${slug(segment)}`],
      source_id: sourceIdFor(record),
      evidence_level: "DISCLOSED",
      validation_status: "verified_source",
      review_note: toText(readField(record, "review_note"), "Imported from bank XLSX fixture.").slice(0, 220),
    };
  });

  return {
    schema_version: "v5.5",
    workflow: "bank",
    company_name: fallbackSourceName,
    target_year: targetYear,
    rows,
    sources,
    excluded_items: [],
    validation_warnings: validationWarnings,
    review_summary: {
      one_line: `${rows.length} bank row(s) imported from XLSX fixture for FY ${targetYear}.`,
      highlights: ["Bank fixture columns imported deterministically — NII-driven metrics."],
      warnings: validationWarnings.map((w) => w.message),
    },
  };
}
