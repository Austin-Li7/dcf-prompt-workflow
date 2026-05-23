import type { ContinuityBridge, HistoricalExtractionRow } from "@/types/cfp";

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Scale all additive flow-metric fields by a factor.
 * Ratio fields (NIM %, CET1 %, efficiency %) are NOT scaled —
 * they remain valid after a proportional segment split.
 */
function scaleFlowMetrics(
  row: HistoricalExtractionRow,
  factor: number,
): Partial<HistoricalExtractionRow> {
  const scale = (v: number | null | undefined) =>
    v != null ? v * factor : v;

  return {
    revenue: scale(row.revenue),
    operatingIncome: scale(row.operatingIncome),
    nii_usd_m: scale(row.nii_usd_m),
    non_interest_income_usd_m: scale(row.non_interest_income_usd_m),
    provision_for_credit_losses_usd_m: scale(row.provision_for_credit_losses_usd_m),
    net_income_usd_m: scale(row.net_income_usd_m),
    gross_profit_usd_m: scale(row.gross_profit_usd_m),
    capex_usd_m: scale(row.capex_usd_m),
    depreciation_amortization_usd_m: scale(row.depreciation_amortization_usd_m),
    total_assets_usd_m: scale(row.total_assets_usd_m),
    book_value_equity_usd_m: scale(row.book_value_equity_usd_m),
    goodwill_usd_m: scale(row.goodwill_usd_m),
    intangible_assets_usd_m: scale(row.intangible_assets_usd_m),
    total_rwa_usd_m: scale(row.total_rwa_usd_m),
    total_loans_usd_m: scale(row.total_loans_usd_m),
    total_deposits_usd_m: scale(row.total_deposits_usd_m),
    // Headcount: round to nearest integer after scaling
    headcount: row.headcount != null ? Math.round(row.headcount * factor) : row.headcount,
  };
}

/**
 * Apply all confirmed continuity bridges to a set of historical rows.
 *
 * - rename / merge / discontinuation → relabel old segment to first new segment
 * - split → emit one proportionally-scaled copy per destination segment
 *
 * Rows whose fiscalYear > bridge.fromYear are already in the new structure
 * and are passed through unchanged.
 */
export function applyBridgesToRows(
  rows: HistoricalExtractionRow[],
  bridges: ContinuityBridge[],
): HistoricalExtractionRow[] {
  const confirmed = bridges.filter((b) => b.status === "confirmed");
  if (confirmed.length === 0) return rows;

  const result: HistoricalExtractionRow[] = [];

  for (const row of rows) {
    let handled = false;

    for (const bridge of confirmed) {
      if (!bridge.oldSegments.includes(row.segment)) continue;
      if (row.fiscalYear > bridge.fromYear) continue;

      if (
        bridge.eventType === "rename" ||
        bridge.eventType === "merge" ||
        bridge.eventType === "discontinuation"
      ) {
        const newSeg = bridge.newSegments[0] ?? row.segment;
        result.push({ ...row, segment: newSeg });
        handled = true;
        break;
      }

      if (bridge.eventType === "split") {
        const weightMap = bridge.weights[row.segment];
        if (!weightMap || Object.keys(weightMap).length === 0) {
          result.push(row);
          handled = true;
          break;
        }
        for (const [newSeg, pct] of Object.entries(weightMap)) {
          const factor = pct / 100;
          result.push({
            ...row,
            ...scaleFlowMetrics(row, factor),
            id: uid(),
            segment: newSeg,
            reviewNote: `Bridge: "${row.segment}" → "${newSeg}" (${pct.toFixed(1)}%)`,
          });
        }
        handled = true;
        break;
      }
    }

    if (!handled) result.push(row);
  }

  return result;
}
