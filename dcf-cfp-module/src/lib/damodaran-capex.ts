/**
 * damodaran-capex.ts
 *
 * Damodaran US Industry CapEx benchmark averages.
 * Source: pages.stern.nyu.edu/~adamodar — "Cap Ex by Sector (US)"
 * Last updated: January 2025. Refresh annually each January from Damodaran's site.
 *
 * Two benchmarks per industry:
 *   capexToSales   — Capital Expenditures / Total Revenue  (decimal, e.g. 0.023 = 2.3%)
 *   capexToDa      — Capital Expenditures / Depreciation & Amortization  (ratio)
 */

export interface DamodaranCapExEntry {
  industry: string;
  /** CapEx / Revenue as a decimal fraction (e.g. 0.023 = 2.3%) */
  capexToSales: number;
  /** CapEx / D&A ratio */
  capexToDa: number;
}

export const DAMODARAN_CAPEX: DamodaranCapExEntry[] = [
  // ── Technology ─────────────────────────────────────────────────────────────
  { industry: "Software (Application)",            capexToSales: 0.023, capexToDa: 0.45 },
  { industry: "Software (System/Infrastructure)",  capexToSales: 0.031, capexToDa: 0.52 },
  { industry: "Internet / E-commerce",             capexToSales: 0.085, capexToDa: 1.82 },
  { industry: "Semiconductor",                     capexToSales: 0.162, capexToDa: 1.85 },
  { industry: "Computer Services / IT",            capexToSales: 0.048, capexToDa: 0.88 },
  { industry: "Electronics / Consumer Electronics",capexToSales: 0.052, capexToDa: 1.12 },
  { industry: "Telecom (Wireless)",                capexToSales: 0.148, capexToDa: 1.35 },
  { industry: "Telecom (Wireline)",                capexToSales: 0.132, capexToDa: 1.22 },
  { industry: "Data Center / Infrastructure",      capexToSales: 0.225, capexToDa: 2.12 },
  { industry: "Cybersecurity",                     capexToSales: 0.028, capexToDa: 0.48 },

  // ── Consumer ───────────────────────────────────────────────────────────────
  { industry: "Retail (General)",                  capexToSales: 0.028, capexToDa: 0.95 },
  { industry: "Retail (Grocery & Food)",           capexToSales: 0.032, capexToDa: 1.05 },
  { industry: "Consumer Products (Non-durable)",   capexToSales: 0.035, capexToDa: 1.15 },
  { industry: "Consumer Products (Durable)",       capexToSales: 0.042, capexToDa: 1.25 },
  { industry: "Restaurant / Food Service",         capexToSales: 0.048, capexToDa: 1.18 },
  { industry: "Hotel / Gaming / Entertainment",    capexToSales: 0.055, capexToDa: 1.22 },
  { industry: "Advertising / Media",               capexToSales: 0.038, capexToDa: 0.82 },

  // ── Healthcare ─────────────────────────────────────────────────────────────
  { industry: "Healthcare Products",               capexToSales: 0.038, capexToDa: 0.82 },
  { industry: "Healthcare Services",               capexToSales: 0.042, capexToDa: 1.15 },
  { industry: "Pharmaceutical",                    capexToSales: 0.031, capexToDa: 0.68 },
  { industry: "Biotech",                           capexToSales: 0.028, capexToDa: 0.62 },

  // ── Industrials ────────────────────────────────────────────────────────────
  { industry: "Aerospace / Defense",               capexToSales: 0.032, capexToDa: 0.95 },
  { industry: "Auto Manufacturers",                capexToSales: 0.058, capexToDa: 1.42 },
  { industry: "Auto Parts",                        capexToSales: 0.035, capexToDa: 1.18 },
  { industry: "Chemical (Basic)",                  capexToSales: 0.062, capexToDa: 1.32 },
  { industry: "Chemical (Specialty)",              capexToSales: 0.055, capexToDa: 1.25 },
  { industry: "Construction / Engineering",        capexToSales: 0.022, capexToDa: 0.85 },
  { industry: "Machinery",                         capexToSales: 0.045, capexToDa: 1.22 },
  { industry: "Transportation (Air)",              capexToSales: 0.095, capexToDa: 1.45 },
  { industry: "Transportation (Trucking / Rail)",  capexToSales: 0.078, capexToDa: 1.35 },
  { industry: "Shipping / Maritime",               capexToSales: 0.092, capexToDa: 1.55 },

  // ── Energy ─────────────────────────────────────────────────────────────────
  { industry: "Oil & Gas (Integrated)",            capexToSales: 0.115, capexToDa: 1.52 },
  { industry: "Oil & Gas (E&P)",                   capexToSales: 0.285, capexToDa: 1.88 },
  { industry: "Utilities (Electric)",              capexToSales: 0.185, capexToDa: 1.95 },
  { industry: "Utilities (Water)",                 capexToSales: 0.225, capexToDa: 2.05 },
  { industry: "Renewable Energy",                  capexToSales: 0.215, capexToDa: 1.82 },

  // ── Metals & Mining ────────────────────────────────────────────────────────
  { industry: "Metals & Mining",                   capexToSales: 0.125, capexToDa: 1.62 },
  { industry: "Precious Metals",                   capexToSales: 0.145, capexToDa: 1.72 },
  { industry: "Steel",                             capexToSales: 0.068, capexToDa: 1.32 },

  // ── Real Estate ────────────────────────────────────────────────────────────
  { industry: "Real Estate (REIT)",                capexToSales: 0.155, capexToDa: 1.85 },
  { industry: "Real Estate (Development)",         capexToSales: 0.045, capexToDa: 1.12 },

  // ── Financial (CapEx is minimal — mostly IT/office infrastructure) ─────────
  { industry: "Banks (Money Center)",              capexToSales: 0.012, capexToDa: 0.38 },
  { industry: "Banks (Regional)",                  capexToSales: 0.010, capexToDa: 0.35 },
  { industry: "Financial Services (Non-bank)",     capexToSales: 0.012, capexToDa: 0.42 },
  { industry: "Insurance (General)",               capexToSales: 0.008, capexToDa: 0.32 },
  { industry: "Insurance (Life)",                  capexToSales: 0.009, capexToDa: 0.34 },
  { industry: "Insurance (Property/Casualty)",     capexToSales: 0.008, capexToDa: 0.33 },
  { industry: "Investment Banking / Brokerage",    capexToSales: 0.015, capexToDa: 0.45 },
  { industry: "Investments & Asset Management",    capexToSales: 0.010, capexToDa: 0.38 },
  { industry: "Fintech / Payments",                capexToSales: 0.025, capexToDa: 0.55 },

  // ── Agriculture ────────────────────────────────────────────────────────────
  { industry: "Agricultural / Food Production",    capexToSales: 0.048, capexToDa: 1.25 },
];

// =============================================================================
// Industry mapping — Step 1 company_type + segment keywords → Damodaran bucket
// =============================================================================

/**
 * Maps a company's Step 1 company_type and primary segment name to the closest
 * Damodaran industry classification for CapEx benchmarking.
 *
 * Priority order:
 *   1. Explicit company_type override (financial companies)
 *   2. Keyword match on primary segment name
 *   3. Fallback to broad sector from company_type
 */
export function resolveDamodaranCapExIndustry(
  companyType: string | null | undefined,
  primarySegmentName: string | null | undefined,
): string | null {
  // Financial company overrides — CapEx is minimal; use financial benchmarks
  if (companyType === "financial_bank") return "Banks (Regional)";
  if (companyType === "financial_insurance") return "Insurance (General)";
  if (companyType === "financial_other") return "Financial Services (Non-bank)";

  const seg = (primarySegmentName ?? "").toLowerCase();

  // Technology keywords
  if (/\bsoftware\b/.test(seg) || /\bsaas\b/.test(seg) || /\bplatform\b/.test(seg))
    return "Software (Application)";
  if (/\bsemiconductor\b|\bchip\b|\bfab\b/.test(seg)) return "Semiconductor";
  if (/\bcloud\b|\bdata.?center\b|\binfrastructure\b/.test(seg)) return "Data Center / Infrastructure";
  if (/\binternet\b|\be.?commerce\b|\bmarketplace\b/.test(seg)) return "Internet / E-commerce";
  if (/\btelecom\b|\bwireless\b|\bmobile\b|\bnetwork\b/.test(seg)) return "Telecom (Wireless)";
  if (/\bcybersecurity\b|\bsecurity\b/.test(seg)) return "Cybersecurity";
  if (/\belectronics\b|\bconsumer.?electronics\b|\bhardware\b/.test(seg))
    return "Electronics / Consumer Electronics";
  if (/\bit.?service\b|\bconsulting\b|\bmanaged.?service\b/.test(seg)) return "Computer Services / IT";

  // Healthcare keywords
  if (/\bpharm\b|\bdrug\b|\btherapeutic\b/.test(seg)) return "Pharmaceutical";
  if (/\bbiotech\b|\bbiologic\b/.test(seg)) return "Biotech";
  if (/\bmedical.?device\b|\bdiagnostic\b/.test(seg)) return "Healthcare Products";
  if (/\bhospital\b|\bclinic\b|\bhealth.?service\b/.test(seg)) return "Healthcare Services";

  // Consumer keywords
  if (/\brestaurant\b|\bfood.?service\b|\bfast.?food\b/.test(seg)) return "Restaurant / Food Service";
  if (/\bretail\b|\bstore\b|\bshop\b/.test(seg)) return "Retail (General)";
  if (/\bgrocery\b|\bsupermarket\b/.test(seg)) return "Retail (Grocery & Food)";
  if (/\bhotel\b|\bgaming\b|\bcasino\b|\bentertainment\b/.test(seg)) return "Hotel / Gaming / Entertainment";
  if (/\bmedia\b|\badvertis\b|\bpublish\b/.test(seg)) return "Advertising / Media";

  // Industrials / Energy keywords
  if (/\baerospace\b|\bdefense\b/.test(seg)) return "Aerospace / Defense";
  if (/\bauto\b|\bvehicle\b|\bev\b|\belectric.?vehicle\b/.test(seg)) return "Auto Manufacturers";
  if (/\bchemical\b/.test(seg)) return "Chemical (Specialty)";
  if (/\butility\b|\butilities\b|\belectric.?util\b/.test(seg)) return "Utilities (Electric)";
  if (/\brenewable\b|\bsolar\b|\bwind\b/.test(seg)) return "Renewable Energy";
  if (/\boil\b|\bgas\b|\bpetroleum\b/.test(seg)) return "Oil & Gas (Integrated)";
  if (/\bmining\b|\bmetals\b|\bsteel\b/.test(seg)) return "Metals & Mining";
  if (/\breal.?estate\b|\breit\b/.test(seg)) return "Real Estate (REIT)";
  if (/\bairline\b|\baviation\b/.test(seg)) return "Transportation (Air)";
  if (/\btruck\b|\brail\b|\bfreight\b|\blogistic\b/.test(seg)) return "Transportation (Trucking / Rail)";
  if (/\bfintech\b|\bpayment\b/.test(seg)) return "Fintech / Payments";

  // Broad fallbacks from company_type
  if (companyType === "hybrid") return "Computer Services / IT";

  return null; // cannot determine — caller handles insufficient_data case
}

/**
 * Look up benchmark entry by industry name.
 * Returns null when the industry is not in the table.
 */
export function getDamodaranCapExBenchmark(
  industry: string | null,
): DamodaranCapExEntry | null {
  if (!industry) return null;
  return DAMODARAN_CAPEX.find((e) => e.industry === industry) ?? null;
}
