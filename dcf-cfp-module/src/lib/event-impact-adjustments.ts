"use client";

import type { CompanySave } from "@/types/cfp";
import type { RefreshEvent } from "@/lib/refresh-gate";

export const EVENT_IMPACT_ADJUSTMENTS_KEY = "dcf-event-impact-adjustments-v1";

export interface DriverAdjustment {
  id: string;
  driverId: string;
  driverLabel: string;
  sourceEventId: string;
  sourceEventTitle: string;
  eventType: string;
  cachedValue: number | null;
  suggestedValue: number | null;
  unit: "%" | "USD_M" | "score" | "text";
  confidence: number;
  reason: string;
  applied: boolean;
}

export interface EventImpactAdjustmentPackage {
  companyName: string;
  ticker: string;
  saveId: string;
  savedAt: string;
  generatedAt: string;
  adjustments: DriverAdjustment[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundPct(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function latestForecastCagr(save: CompanySave): number | null {
  const total = save.cfpState.summary.aggregatedRows.find((row) => row.isTotal);
  if (total) return total.cagr / 100;

  const rows = save.cfpState.forecast.structuredResults?.flatMap((result) => result.machine_artifact.forecast_table) ?? [];
  if (!rows.length) return null;
  const years = Array.from(new Set(rows.map((row) => row.fiscal_year))).sort();
  const first = years[0];
  const last = years[years.length - 1];
  const fy1 = rows.filter((row) => row.fiscal_year === first).reduce((sum, row) => sum + row.revenue_base_usd_m, 0);
  const fy5 = rows.filter((row) => row.fiscal_year === last).reduce((sum, row) => sum + row.revenue_base_usd_m, 0);
  if (fy1 <= 0 || fy5 <= 0) return null;
  return Math.pow(fy5 / fy1, 1 / Math.max(1, years.length - 1)) - 1;
}

function confidence(event: RefreshEvent): number {
  return Math.round((event.confidence * 0.5) + (event.truthScore * 0.3) + (event.impactSize * 0.2));
}

function materialityMultiplier(event: RefreshEvent): number {
  if (event.materiality === "high") return 1.3;
  if (event.materiality === "medium") return 1;
  if (event.materiality === "low") return 0.55;
  return 0.8;
}

function addAdjustment(
  list: DriverAdjustment[],
  event: RefreshEvent,
  driverId: string,
  driverLabel: string,
  cachedValue: number | null,
  suggestedValue: number | null,
  unit: DriverAdjustment["unit"],
  reason: string,
  applied = false,
) {
  list.push({
    id: `${event.id}-${driverId}`,
    driverId,
    driverLabel,
    sourceEventId: event.id,
    sourceEventTitle: event.title,
    eventType: event.eventType,
    cachedValue,
    suggestedValue,
    unit,
    confidence: confidence(event),
    reason,
    applied,
  });
}

export function buildEventImpactAdjustments(save: CompanySave, events: RefreshEvent[]): EventImpactAdjustmentPackage {
  const adjustments: DriverAdjustment[] = [];
  const baseGrowth = latestForecastCagr(save);
  const baseFcfMargin = save.snapshot.fcfMargin;
  const baseTerminalGrowth = save.snapshot.terminalGrowth;
  const baseWacc = save.snapshot.wacc;
  const baseMarketCap = save.snapshot.marketCapUsdM;

  for (const event of events) {
    const m = materialityMultiplier(event);
    const isPositive = !/(decline|risk|lawsuit|litigation|ban|fine|pressure|loss|default|recession|tariff|rate hike|higher rate)/i.test(`${event.title} ${event.detail}`);

    switch (event.eventType) {
      case "new product/technology":
        addAdjustment(
          adjustments,
          event,
          "forecast-growth",
          "Forecast Growth",
          baseGrowth,
          baseGrowth == null ? null : roundPct(clamp(baseGrowth + (isPositive ? 0.006 : -0.004) * m, -0.2, 0.4)),
          "%",
          "Product/technology events can change TAM, adoption, pricing power, or replacement cycles, so forecast growth is the first affected DCF driver.",
          true,
        );
        addAdjustment(
          adjustments,
          event,
          "fcf-margin",
          "FCF Margin",
          baseFcfMargin,
          roundPct(clamp(baseFcfMargin + (isPositive ? -0.003 : -0.008) * m, 0.02, 0.6)),
          "%",
          "New technology can require launch spending, infrastructure, or R&D before cash-flow conversion improves.",
        );
        addAdjustment(
          adjustments,
          event,
          "terminal-growth",
          "Terminal Growth",
          baseTerminalGrowth,
          roundPct(clamp(baseTerminalGrowth + (isPositive ? 0.002 : -0.001) * m, 0, 0.06)),
          "%",
          "If the event extends durability of the business, terminal growth may move modestly.",
        );
        break;

      case "competitive shift":
        addAdjustment(adjustments, event, "forecast-growth", "Forecast Growth", baseGrowth, baseGrowth == null ? null : roundPct(clamp(baseGrowth + (isPositive ? 0.004 : -0.006) * m, -0.2, 0.4)), "%", "Competitive shifts affect market share and pricing, which flow directly into forecast growth.", true);
        addAdjustment(adjustments, event, "fcf-margin", "FCF Margin", baseFcfMargin, roundPct(clamp(baseFcfMargin + (isPositive ? 0.002 : -0.006) * m, 0.02, 0.6)), "%", "Pricing pressure or share gains can change margin and cash conversion.");
        break;

      case "regulation/litigation":
        addAdjustment(adjustments, event, "discount-rate", "WACC / Ke", baseWacc, baseWacc == null ? null : roundPct(clamp(baseWacc + 0.004 * m, 0.01, 0.25)), "%", "Regulatory or litigation uncertainty typically increases required return or risk spread.", true);
        addAdjustment(adjustments, event, "fcf-margin", "FCF Margin", baseFcfMargin, roundPct(clamp(baseFcfMargin - 0.004 * m, 0.02, 0.6)), "%", "Compliance costs, fines, or remedies can reduce cash-flow conversion.");
        break;

      case "macro change":
        addAdjustment(adjustments, event, "discount-rate", "WACC / Ke", baseWacc, baseWacc == null ? null : roundPct(clamp(baseWacc + (isPositive ? -0.002 : 0.005) * m, 0.01, 0.25)), "%", "Macro changes move rates, ERP, demand risk, and discount rates.", true);
        addAdjustment(adjustments, event, "forecast-growth", "Forecast Growth", baseGrowth, baseGrowth == null ? null : roundPct(clamp(baseGrowth + (isPositive ? 0.002 : -0.004) * m, -0.2, 0.4)), "%", "Macro demand changes can raise or lower revenue trajectory.");
        break;

      case "market data change":
        addAdjustment(adjustments, event, "market-data", "Market Data Inputs", baseMarketCap, baseMarketCap, "USD_M", "Market data changes update price, market cap, debt/cash context, and valuation comparison. Re-fetch Step 7 for actual values.", true);
        addAdjustment(adjustments, event, "discount-rate", "WACC / Ke", baseWacc, baseWacc == null ? null : roundPct(baseWacc), "%", "Market-data events should refresh Step 7 rates rather than infer a manual WACC change.");
        break;

      case "earnings/call":
      case "new 10-Q":
        addAdjustment(adjustments, event, "forecast-growth", "Forecast Growth", baseGrowth, baseGrowth == null ? null : roundPct(clamp(baseGrowth + (isPositive ? 0.003 : -0.003) * m, -0.2, 0.4)), "%", "Earnings and quarterly filings update run-rate revenue, guidance, and management commentary.", true);
        addAdjustment(adjustments, event, "fcf-margin", "FCF Margin", baseFcfMargin, roundPct(clamp(baseFcfMargin + (isPositive ? 0.002 : -0.003) * m, 0.02, 0.6)), "%", "Quarterly profitability and cash-flow signals can change margin assumptions.", true);
        break;

      case "new 10-K":
      case "M&A/divestiture":
        addAdjustment(adjustments, event, "revenue-baseline", "Historical Revenue Baseline", null, null, "text", "Annual filings or M&A can restate the base business, segment mix, and consolidated revenue. Prefer rerunning Steps 1-8.", true);
        addAdjustment(adjustments, event, "forecast-growth", "Forecast Growth", baseGrowth, baseGrowth, "%", "Full rerun is recommended because historical base and business structure may change together.", true);
        break;

      case "management change":
        addAdjustment(adjustments, event, "fcf-margin", "FCF Margin", baseFcfMargin, roundPct(clamp(baseFcfMargin + (isPositive ? 0.003 : -0.002) * m, 0.02, 0.6)), "%", "Management and capital allocation changes can alter reinvestment discipline and cash conversion.", true);
        addAdjustment(adjustments, event, "equity-bridge", "Equity Bridge Adjustments", null, null, "text", "Buyback, dividend, leverage, or cash policy changes should be reviewed in Step 7/8 bridge inputs.");
        break;
    }
  }

  return {
    companyName: save.companyName,
    ticker: save.ticker,
    saveId: save.saveId,
    savedAt: save.savedAt,
    generatedAt: new Date().toISOString(),
    adjustments,
  };
}

export function saveEventImpactAdjustments(pkg: EventImpactAdjustmentPackage): void {
  localStorage.setItem(EVENT_IMPACT_ADJUSTMENTS_KEY, JSON.stringify(pkg));
}

export function loadEventImpactAdjustments(): EventImpactAdjustmentPackage | null {
  try {
    const raw = localStorage.getItem(EVENT_IMPACT_ADJUSTMENTS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as EventImpactAdjustmentPackage;
  } catch {
    return null;
  }
}
