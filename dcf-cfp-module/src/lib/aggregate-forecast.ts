import type { ForecastState, AggregatedRow } from "@/types/cfp";

/**
 * Aggregates the massive 20-quarter product-level forecast into
 * annual (FY1–FY5) totals grouped by Segment → Category, with
 * subtotals per segment and a consolidated grand total.
 *
 * CAGR formula: ((FY5 / FY1) ^ (1/4)) - 1
 * (4 periods of growth between Year 1 and Year 5)
 */
export function aggregateMasterForecast(forecastState: ForecastState): AggregatedRow[] {
  // Step 1: Build a nested map  Segment → Category → { fy1..fy5 }
  const map = new Map<string, Map<string, [number, number, number, number, number]>>();

  for (const seg of forecastState.segments) {
    if (!map.has(seg.segment)) map.set(seg.segment, new Map());
    const catMap = map.get(seg.segment)!;

    for (const prod of seg.products) {
      const catKey = prod.categoryName || prod.productName;
      if (!catMap.has(catKey)) catMap.set(catKey, [0, 0, 0, 0, 0]);
      const totals = catMap.get(catKey)!;

      for (const q of prod.forecast) {
        const yearIdx = (q.year ?? 1) - 1; // year 1→index 0
        if (yearIdx >= 0 && yearIdx < 5) {
          totals[yearIdx] += q.revenueM;
        }
      }
    }
  }

  // Step 2: Build the rows array with subtotals
  const rows: AggregatedRow[] = [];
  let grandTotals: [number, number, number, number, number] = [0, 0, 0, 0, 0];

  const sortedSegments = [...map.entries()].sort(([a], [b]) => a.localeCompare(b));

  for (const [segment, catMap] of sortedSegments) {
    let segTotals: [number, number, number, number, number] = [0, 0, 0, 0, 0];
    const sortedCats = [...catMap.entries()].sort(([a], [b]) => a.localeCompare(b));

    for (const [category, totals] of sortedCats) {
      const [fy1, fy2, fy3, fy4, fy5] = totals.map(v => round(v));
      rows.push({
        segment,
        category,
        fy1, fy2, fy3, fy4, fy5,
        cagr: calcCAGR(fy1, fy5),
      });
      for (let i = 0; i < 5; i++) segTotals[i] += totals[i];
    }

    // Segment subtotal
    const [s1, s2, s3, s4, s5] = segTotals.map(v => round(v));
    rows.push({
      segment,
      category: `${segment} Subtotal`,
      fy1: s1, fy2: s2, fy3: s3, fy4: s4, fy5: s5,
      cagr: calcCAGR(s1, s5),
      isSubtotal: true,
    });

    for (let i = 0; i < 5; i++) grandTotals[i] += segTotals[i];
  }

  // Grand total
  const [g1, g2, g3, g4, g5] = grandTotals.map(v => round(v));
  rows.push({
    segment: "",
    category: "CONSOLIDATED TOTAL",
    fy1: g1, fy2: g2, fy3: g3, fy4: g4, fy5: g5,
    cagr: calcCAGR(g1, g5),
    isTotal: true,
  });

  return rows;
}

/** CAGR = ((FY5 / FY1) ^ (1/4)) - 1, expressed as percentage */
function calcCAGR(fy1: number, fy5: number): number {
  if (fy1 <= 0 || fy5 <= 0) return 0;
  const cagr = (Math.pow(fy5 / fy1, 1 / 4) - 1) * 100;
  return round(cagr);
}

function round(v: number): number {
  return Math.round(v * 10) / 10;
}
