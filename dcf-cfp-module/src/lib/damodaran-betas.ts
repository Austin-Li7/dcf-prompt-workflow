/**
 * Damodaran US Industry Unlevered Beta estimates.
 * Source: pages.stern.nyu.edu/~adamodar — "Betas by Sector (US)"
 * Last updated: January 2026. Refresh annually each January from Damodaran's site.
 *
 * For financial companies (banks, insurance) the "unlevered" beta published by
 * Damodaran is already the equity beta proxy — financial-firm leverage is
 * inseparable from operations (deposits ≠ traditional debt), so no Hamada
 * re-levering is applied in Ke-only mode.
 */

export interface DamodaranBetaEntry {
  industry: string;
  unleveredBeta: number;
}

export const DAMODARAN_BETAS: DamodaranBetaEntry[] = [
  // ── Financial / Banking ────────────────────────────────────────────────────
  { industry: "Banks (Money Center)",              unleveredBeta: 0.30 },
  { industry: "Banks (Regional)",                  unleveredBeta: 0.37 },
  { industry: "Financial Services (Non-bank)",     unleveredBeta: 0.48 },
  { industry: "Insurance (General)",               unleveredBeta: 0.36 },
  { industry: "Insurance (Life)",                  unleveredBeta: 0.41 },
  { industry: "Insurance (Property/Casualty)",     unleveredBeta: 0.38 },
  { industry: "Investment Banking / Brokerage",    unleveredBeta: 0.61 },
  { industry: "Investments & Asset Management",    unleveredBeta: 0.60 },
  { industry: "Fintech / Payments",                unleveredBeta: 0.73 },

  // ── Technology ─────────────────────────────────────────────────────────────
  { industry: "Software (Application)",            unleveredBeta: 0.96 },
  { industry: "Software (System/Infrastructure)",  unleveredBeta: 0.88 },
  { industry: "Internet / E-commerce",             unleveredBeta: 1.04 },
  { industry: "Semiconductor",                     unleveredBeta: 1.06 },
  { industry: "Computer Services / IT",            unleveredBeta: 0.83 },
  { industry: "Electronics / Consumer Electronics",unleveredBeta: 0.84 },
  { industry: "Telecom (Wireless)",                unleveredBeta: 0.56 },
  { industry: "Telecom (Wireline)",                unleveredBeta: 0.38 },

  // ── Consumer ───────────────────────────────────────────────────────────────
  { industry: "Retail (General)",                  unleveredBeta: 0.73 },
  { industry: "Retail (Grocery & Food)",           unleveredBeta: 0.44 },
  { industry: "Consumer Products (Non-durable)",   unleveredBeta: 0.59 },
  { industry: "Consumer Products (Durable)",       unleveredBeta: 0.78 },
  { industry: "Restaurant / Food Service",         unleveredBeta: 0.74 },
  { industry: "Hotel / Gaming / Entertainment",    unleveredBeta: 0.80 },
  { industry: "Advertising / Media",               unleveredBeta: 0.72 },

  // ── Healthcare ─────────────────────────────────────────────────────────────
  { industry: "Healthcare Products",               unleveredBeta: 0.68 },
  { industry: "Healthcare Services",               unleveredBeta: 0.61 },
  { industry: "Pharmaceutical",                    unleveredBeta: 0.65 },
  { industry: "Biotech",                           unleveredBeta: 0.95 },

  // ── Industrials ────────────────────────────────────────────────────────────
  { industry: "Aerospace / Defense",               unleveredBeta: 0.73 },
  { industry: "Auto Manufacturers",                unleveredBeta: 0.85 },
  { industry: "Auto Parts",                        unleveredBeta: 0.82 },
  { industry: "Chemical (Basic)",                  unleveredBeta: 0.74 },
  { industry: "Chemical (Specialty)",              unleveredBeta: 0.78 },
  { industry: "Construction / Engineering",        unleveredBeta: 0.78 },
  { industry: "Machinery",                         unleveredBeta: 0.80 },
  { industry: "Transportation (Air)",              unleveredBeta: 0.72 },
  { industry: "Transportation (Trucking / Rail)",  unleveredBeta: 0.67 },

  // ── Energy ─────────────────────────────────────────────────────────────────
  { industry: "Oil & Gas (Integrated)",            unleveredBeta: 0.79 },
  { industry: "Oil & Gas (E&P)",                   unleveredBeta: 1.05 },
  { industry: "Utilities (Electric)",              unleveredBeta: 0.24 },
  { industry: "Utilities (Water)",                 unleveredBeta: 0.25 },
  { industry: "Renewable Energy",                  unleveredBeta: 0.63 },

  // ── Real Estate ────────────────────────────────────────────────────────────
  { industry: "Real Estate (REIT)",                unleveredBeta: 0.41 },
  { industry: "Real Estate (Development)",         unleveredBeta: 0.68 },

  // ── Metals & Mining ────────────────────────────────────────────────────────
  { industry: "Metals & Mining",                   unleveredBeta: 0.85 },
  { industry: "Precious Metals",                   unleveredBeta: 0.93 },
  { industry: "Steel",                             unleveredBeta: 0.79 },

  // ── Shipping & Agriculture ─────────────────────────────────────────────────
  { industry: "Shipping / Maritime",               unleveredBeta: 0.65 },
  { industry: "Agricultural / Food Production",    unleveredBeta: 0.60 },

  // ── Emerging Technology ────────────────────────────────────────────────────
  { industry: "Cybersecurity",                     unleveredBeta: 0.98 },
  { industry: "Data Center / Infrastructure",      unleveredBeta: 0.72 },
];

// =============================================================================
// Yahoo Finance industry → Damodaran category mapping
// =============================================================================

const YF_INDUSTRY_MAP: Record<string, string> = {
  // Banks
  "Banks—Diversified":                        "Banks (Money Center)",
  "Banks—Regional":                           "Banks (Regional)",
  "Banks - Diversified":                      "Banks (Money Center)",
  "Banks - Regional":                         "Banks (Regional)",

  // Financial services
  "Credit Services":                          "Financial Services (Non-bank)",
  "Financial Data & Stock Exchanges":         "Investments & Asset Management",
  "Capital Markets":                          "Investment Banking / Brokerage",
  "Asset Management":                         "Investments & Asset Management",
  "Insurance—Diversified":                    "Insurance (General)",
  "Insurance—Life":                           "Insurance (Life)",
  "Insurance—Property & Casualty":           "Insurance (Property/Casualty)",
  "Insurance—Specialty":                      "Insurance (General)",
  "Insurance - Diversified":                  "Insurance (General)",
  "Insurance - Life":                         "Insurance (Life)",
  "Insurance - Property & Casualty":         "Insurance (Property/Casualty)",
  "Mortgage Finance":                         "Financial Services (Non-bank)",
  "Financial Conglomerates":                  "Financial Services (Non-bank)",

  // Technology
  "Software—Application":                     "Software (Application)",
  "Software—Infrastructure":                  "Software (System/Infrastructure)",
  "Software - Application":                   "Software (Application)",
  "Software - Infrastructure":                "Software (System/Infrastructure)",
  "Internet Content & Information":           "Internet / E-commerce",
  "Internet Retail":                          "Internet / E-commerce",
  "E-Commerce":                               "Internet / E-commerce",
  "Semiconductors":                           "Semiconductor",
  "Semiconductor Equipment & Materials":      "Semiconductor",
  "Computer Hardware":                        "Computer Services / IT",
  "Information Technology Services":          "Computer Services / IT",
  "Electronic Components":                    "Electronics / Consumer Electronics",
  "Consumer Electronics":                     "Electronics / Consumer Electronics",
  "Telecom Services":                         "Telecom (Wireless)",
  "Communication Services":                   "Telecom (Wireless)",
  "Wireless Telecom Services":                "Telecom (Wireless)",

  // Consumer
  "Specialty Retail":                         "Retail (General)",
  "Department Stores":                        "Retail (General)",
  "Discount Stores":                          "Retail (General)",
  "Grocery Stores":                           "Retail (Grocery & Food)",
  "Restaurants":                              "Restaurant / Food Service",
  "Entertainment":                            "Hotel / Gaming / Entertainment",
  "Gambling":                                 "Hotel / Gaming / Entertainment",
  "Hotels":                                   "Hotel / Gaming / Entertainment",
  "Travel & Leisure":                         "Hotel / Gaming / Entertainment",
  "Advertising Agencies":                     "Advertising / Media",
  "Publishing":                               "Advertising / Media",
  "Broadcasting":                             "Advertising / Media",
  "Household & Personal Products":            "Consumer Products (Non-durable)",
  "Packaged Foods":                           "Consumer Products (Non-durable)",
  "Beverages—Non-Alcoholic":                  "Consumer Products (Non-durable)",
  "Beverages—Alcoholic":                      "Consumer Products (Non-durable)",
  "Tobacco":                                  "Consumer Products (Non-durable)",
  "Auto Manufacturers":                       "Auto Manufacturers",
  "Auto Parts":                               "Auto Parts",

  // Healthcare
  "Drug Manufacturers—General":               "Pharmaceutical",
  "Drug Manufacturers—Specialty & Generic":   "Pharmaceutical",
  "Biotechnology":                            "Biotech",
  "Medical Devices":                          "Healthcare Products",
  "Medical Instruments & Supplies":           "Healthcare Products",
  "Diagnostics & Research":                   "Healthcare Products",
  "Hospitals":                                "Healthcare Services",
  "Healthcare Plans":                         "Healthcare Services",

  // Industrials
  "Aerospace & Defense":                      "Aerospace / Defense",
  "Airlines":                                 "Transportation (Air)",
  "Trucking":                                 "Transportation (Trucking / Rail)",
  "Railroads":                                "Transportation (Trucking / Rail)",
  "Specialty Industrial Machinery":           "Machinery",
  "Electrical Equipment & Parts":             "Machinery",
  "Construction & Engineering":               "Construction / Engineering",
  "Building Products & Equipment":            "Construction / Engineering",
  "Chemicals":                                "Chemical (Basic)",
  "Specialty Chemicals":                      "Chemical (Specialty)",

  // Energy
  "Oil & Gas Integrated":                     "Oil & Gas (Integrated)",
  "Oil & Gas E&P":                            "Oil & Gas (E&P)",
  "Oil & Gas Refining & Marketing":           "Oil & Gas (Integrated)",
  "Utilities—Regulated Electric":             "Utilities (Electric)",
  "Utilities—Regulated Water":                "Utilities (Water)",
  "Solar":                                    "Renewable Energy",
  "Utilities—Renewable":                      "Renewable Energy",

  // Real Estate
  "REIT—Diversified":                         "Real Estate (REIT)",
  "REIT—Retail":                              "Real Estate (REIT)",
  "REIT—Residential":                         "Real Estate (REIT)",
  "REIT—Office":                              "Real Estate (REIT)",
  "Real Estate Development":                  "Real Estate (Development)",
  "Real Estate Services":                     "Real Estate (Development)",

  // Metals & Mining
  "Other Industrial Metals & Mining":         "Metals & Mining",
  "Copper":                                   "Metals & Mining",
  "Aluminum":                                 "Metals & Mining",
  "Gold":                                     "Precious Metals",
  "Silver":                                   "Precious Metals",
  "Steel":                                    "Steel",
  "Iron & Steel":                             "Steel",

  // Shipping & Agriculture
  "Marine Shipping":                          "Shipping / Maritime",
  "Shipping":                                 "Shipping / Maritime",
  "Farm Products":                            "Agricultural / Food Production",
  "Agricultural Inputs":                      "Agricultural / Food Production",

  // Emerging Technology
  "Software—Security":                        "Cybersecurity",
  "Internet Security":                        "Cybersecurity",
};

// =============================================================================
// Public helpers
// =============================================================================

/**
 * Look up an unlevered beta from a Yahoo Finance industry string.
 * Returns null if no match is found.
 */
export function lookupDamodaranBeta(
  yfIndustry: string,
): { beta: number; damodaranIndustry: string } | null {
  if (!yfIndustry) return null;

  // 1. Direct map lookup
  const mapped = YF_INDUSTRY_MAP[yfIndustry];
  if (mapped) {
    const entry = DAMODARAN_BETAS.find((e) => e.industry === mapped);
    if (entry) return { beta: entry.unleveredBeta, damodaranIndustry: entry.industry };
  }

  // 2. Case-insensitive substring match against the map keys
  const lower = yfIndustry.toLowerCase();
  for (const [yfKey, damCategory] of Object.entries(YF_INDUSTRY_MAP)) {
    if (lower.includes(yfKey.toLowerCase()) || yfKey.toLowerCase().includes(lower)) {
      const entry = DAMODARAN_BETAS.find((e) => e.industry === damCategory);
      if (entry) return { beta: entry.unleveredBeta, damodaranIndustry: entry.industry };
    }
  }

  // 3. Keyword fallbacks
  if (lower.includes("bank") || lower.includes("banking")) {
    const e = DAMODARAN_BETAS.find((x) => x.industry === "Banks (Regional)")!;
    return { beta: e.unleveredBeta, damodaranIndustry: e.industry };
  }
  if (lower.includes("fintech") || lower.includes("payment")) {
    const e = DAMODARAN_BETAS.find((x) => x.industry === "Fintech / Payments")!;
    return { beta: e.unleveredBeta, damodaranIndustry: e.industry };
  }
  if (lower.includes("insurance")) {
    const e = DAMODARAN_BETAS.find((x) => x.industry === "Insurance (General)")!;
    return { beta: e.unleveredBeta, damodaranIndustry: e.industry };
  }
  if (lower.includes("financial") || lower.includes("credit") || lower.includes("lending")) {
    const e = DAMODARAN_BETAS.find((x) => x.industry === "Financial Services (Non-bank)")!;
    return { beta: e.unleveredBeta, damodaranIndustry: e.industry };
  }
  if (lower.includes("software")) {
    const e = DAMODARAN_BETAS.find((x) => x.industry === "Software (Application)")!;
    return { beta: e.unleveredBeta, damodaranIndustry: e.industry };
  }
  if (lower.includes("internet") || lower.includes("e-commerce")) {
    const e = DAMODARAN_BETAS.find((x) => x.industry === "Internet / E-commerce")!;
    return { beta: e.unleveredBeta, damodaranIndustry: e.industry };
  }
  if (lower.includes("mining") || lower.includes("copper") || lower.includes("aluminum")) {
    const e = DAMODARAN_BETAS.find((x) => x.industry === "Metals & Mining")!;
    return { beta: e.unleveredBeta, damodaranIndustry: e.industry };
  }
  if (lower.includes("gold") || lower.includes("silver") || lower.includes("precious")) {
    const e = DAMODARAN_BETAS.find((x) => x.industry === "Precious Metals")!;
    return { beta: e.unleveredBeta, damodaranIndustry: e.industry };
  }
  if (lower.includes("cybersecurity") || lower.includes("security software")) {
    const e = DAMODARAN_BETAS.find((x) => x.industry === "Cybersecurity")!;
    return { beta: e.unleveredBeta, damodaranIndustry: e.industry };
  }
  if (lower.includes("data center")) {
    const e = DAMODARAN_BETAS.find((x) => x.industry === "Data Center / Infrastructure")!;
    return { beta: e.unleveredBeta, damodaranIndustry: e.industry };
  }

  return null;
}

/**
 * Returns true if the Yahoo Finance industry string is a financial/bank type
 * for which traditional WACC is inappropriate (deposits ≠ traditional debt).
 */
export function isFinancialIndustry(yfIndustry: string): boolean {
  if (!yfIndustry) return false;
  const lower = yfIndustry.toLowerCase();
  return (
    lower.includes("bank") ||
    lower.includes("insurance") ||
    lower.includes("credit services") ||
    lower.includes("capital markets") ||
    lower.includes("asset management") ||
    lower.includes("mortgage") ||
    lower.includes("financial conglomerate") ||
    lower.includes("financial data")
  );
}

/**
 * Return the best Damodaran unlevered beta for a segment based on its
 * workflow_mode tag set during Step 2 review.
 *
 * "bank"       → Banks (Regional) beta (~0.37)
 * "industrial" → Software / Application beta (~0.96) as a sensible tech default;
 *                callers should override with a fetched-industry lookup when available
 */
export function damodaranBetaForWorkflowMode(
  workflowMode: "bank" | "industrial" | undefined,
): number {
  if (workflowMode === "bank") {
    return DAMODARAN_BETAS.find((e) => e.industry === "Banks (Regional)")!.unleveredBeta;
  }
  // Industrial default — reasonable for tech/software segments
  return DAMODARAN_BETAS.find((e) => e.industry === "Software (Application)")!.unleveredBeta;
}
