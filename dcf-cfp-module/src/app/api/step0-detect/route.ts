import { NextRequest, NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";
import type {
  Step0ChangeType,
  Step0DcfImpactDriver,
  Step0DetectResponse,
  Step0DetectedEvent,
  Step0ImpactAction,
  Step0ImpactAssessment,
  Step0ImpactCertainty,
  Step0ImpactHorizon,
  Step0ImpactMateriality,
  Step0ImpactQuantifiability,
} from "@/lib/step0-cache";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
const SEC_USER_AGENT = "dcf-cfp-module contact@example.com";
const RECENT_WINDOW_DAYS = 120;

interface YahooSearchNewsItem {
  uuid?: string;
  title?: string;
  publisher?: string;
  link?: string;
  providerPublishTime?: number | Date;
  type?: string;
  relatedTickers?: string[];
}

interface SecTickerEntry {
  cik_str: number;
  ticker: string;
  title: string;
}

interface SecSubmissionsResponse {
  cik: string;
  name: string;
  filings?: {
    recent?: {
      accessionNumber?: string[];
      filingDate?: string[];
      form?: string[];
      primaryDocument?: string[];
    };
  };
}

export async function GET(req: NextRequest): Promise<NextResponse<Step0DetectResponse>> {
  const detectedAt = new Date().toISOString();

  try {
    const { searchParams } = new URL(req.url);
    const ticker = searchParams.get("ticker")?.trim().toUpperCase();

    if (!ticker) {
      return NextResponse.json(
        {
          ticker: "",
          companyName: null,
          detectedAt,
          events: [],
          warnings: [],
          error: "ticker query parameter is required.",
        },
        { status: 400 },
      );
    }

    const events: Step0DetectedEvent[] = [];
    const warnings: string[] = [];
    let companyName: string | null = null;

    const [secResult, yahooResult] = await Promise.allSettled([
      detectSecEvents(ticker, detectedAt),
      detectYahooEvents(ticker, detectedAt),
    ]);

    if (secResult.status === "fulfilled") {
      events.push(...secResult.value.events);
      companyName = secResult.value.companyName ?? companyName;
    } else {
      warnings.push("SEC filing detection failed.");
    }

    if (yahooResult.status === "fulfilled") {
      events.push(...yahooResult.value.events);
      companyName = yahooResult.value.companyName ?? companyName;
    } else {
      warnings.push("Yahoo Finance news and earnings detection failed.");
    }

    return NextResponse.json({
      ticker,
      companyName,
      detectedAt,
      events: dedupeEvents(events),
      warnings,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "An unexpected error occurred.";
    return NextResponse.json(
      { ticker: "", companyName: null, detectedAt, events: [], warnings: [], error: msg },
      { status: 500 },
    );
  }
}

async function detectYahooEvents(
  ticker: string,
  detectedAt: string,
): Promise<{ companyName: string | null; events: Step0DetectedEvent[] }> {
  const events: Step0DetectedEvent[] = [];
  let companyName: string | null = null;

  const searchResults = await yf.search(ticker, { newsCount: 12 });
  const quote = searchResults.quotes?.find((item: Record<string, unknown>) => item.symbol === ticker);
  if (quote && typeof quote.longname === "string") companyName = quote.longname;
  if (quote && !companyName && typeof quote.shortname === "string") companyName = quote.shortname;

  const newsItems = (searchResults.news ?? []) as unknown as YahooSearchNewsItem[];
  for (const item of newsItems) {
    if (!item.title) continue;
    const eventDate = item.providerPublishTime
      ? toYahooNewsDate(item.providerPublishTime)
      : null;
    if (eventDate && !isRecent(eventDate)) continue;

    const classification = classifyNewsTitle(item.title);
    if (!classification) continue;

    events.push({
      id: item.uuid ?? `news-${hashText(item.title)}`,
      source: "news",
      changeType: classification.changeType,
      title: item.title,
      summary: `${item.publisher ? `${item.publisher}: ` : ""}${classification.summary}`,
      detectedAt,
      eventDate,
      url: item.link ?? null,
      confidence: classification.confidence,
      horizon: classification.horizon,
      materiality: classification.materiality,
      suggestedSteps: classification.suggestedSteps,
      requiresReview: classification.requiresReview,
      rationale: classification.rationale,
      impactAssessment: classification.impactAssessment,
    });
  }

  try {
    const summary = await yf.quoteSummary(ticker, { modules: ["calendarEvents"] });
    const dates = summary.calendarEvents?.earnings?.earningsDate;
    if (Array.isArray(dates) && dates.length > 0) {
      const nextDate = dates
        .map((value: string | Date) => new Date(value))
        .filter((value: Date) => !Number.isNaN(value.getTime()))
        .sort((a: Date, b: Date) => a.getTime() - b.getTime())[0];
      if (nextDate) {
        events.push({
          id: `earnings-${ticker}-${nextDate.toISOString()}`,
          source: "earnings",
          changeType: "earnings_release",
          title: `Earnings date detected for ${ticker}`,
          summary: "Upcoming or recent earnings can refresh the operating base, guidance, and forecast assumptions.",
          detectedAt,
          eventDate: nextDate.toISOString(),
          url: null,
          confidence: "medium",
          horizon: "one_to_two_years",
          materiality: "medium",
          suggestedSteps: [2, 5, 6, 8],
          requiresReview: true,
          rationale: "Earnings timing was detected automatically. Confirm whether new numbers or guidance have actually been released before accepting.",
          impactAssessment: buildImpactAssessment({
            horizon: "one_to_two_years",
            materiality: "medium",
            certainty: "medium",
            quantifiability: "estimable",
            action: "manual_parameters",
            dcfDrivers: ["revenue_growth", "operating_margin"],
            parameterHints: [
              "Refresh recent actuals and management guidance before changing the base-case forecast.",
              "If only an earnings date is available, wait for the release or treat as a monitoring item.",
            ],
            assessmentSummary: "Earnings can alter near-term actuals and forward guidance, but the impact is not known until the release is reviewed.",
          }),
        });
      }
    }
  } catch {
    // Earnings dates are optional; news detection is still useful.
  }

  return { companyName, events };
}

async function detectSecEvents(
  ticker: string,
  detectedAt: string,
): Promise<{ companyName: string | null; events: Step0DetectedEvent[] }> {
  const tickerMapRes = await fetch("https://www.sec.gov/files/company_tickers.json", {
    headers: { "User-Agent": SEC_USER_AGENT },
    next: { revalidate: 60 * 60 * 24 },
  });
  if (!tickerMapRes.ok) throw new Error("Could not fetch SEC ticker map.");

  const tickerMap = (await tickerMapRes.json()) as Record<string, SecTickerEntry>;
  const entry = Object.values(tickerMap).find((item) => item.ticker.toUpperCase() === ticker);
  if (!entry) return { companyName: null, events: [] };

  const cik = String(entry.cik_str).padStart(10, "0");
  const submissionsRes = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
    headers: { "User-Agent": SEC_USER_AGENT },
    next: { revalidate: 60 * 30 },
  });
  if (!submissionsRes.ok) throw new Error("Could not fetch SEC submissions.");

  const submissions = (await submissionsRes.json()) as SecSubmissionsResponse;
  const recent = submissions.filings?.recent;
  const events: Step0DetectedEvent[] = [];

  if (!recent?.form || !recent.filingDate || !recent.accessionNumber) {
    return { companyName: submissions.name || entry.title, events };
  }

  for (let index = 0; index < Math.min(recent.form.length, 40); index += 1) {
    const form = recent.form[index];
    if (form !== "10-K" && form !== "10-Q" && form !== "8-K") continue;

    const filingDate = recent.filingDate[index];
    if (!filingDate || !isRecent(filingDate)) continue;

    const accession = recent.accessionNumber[index];
    const primaryDocument = recent.primaryDocument?.[index] ?? "";
    const accessionPath = accession?.replace(/-/g, "");
    const url = accession && primaryDocument
      ? `https://www.sec.gov/Archives/edgar/data/${entry.cik_str}/${accessionPath}/${primaryDocument}`
      : null;

    const changeType = form === "10-K" ? "new_10k" : form === "10-Q" ? "new_10q" : "earnings_release";
    const suggestedSteps = form === "10-K"
      ? [1, 2, 3, 4, 5, 6, 7, 8]
      : form === "10-Q"
        ? [2, 5, 6, 7, 8]
        : [2, 5, 6, 8];

    events.push({
      id: `sec-${accession}`,
      source: "sec",
      changeType,
      title: `${form} filed on ${filingDate}`,
      summary: `${entry.title} filed a recent ${form}. Filing updates are treated as hard refresh triggers.`,
      detectedAt,
      eventDate: new Date(`${filingDate}T00:00:00.000Z`).toISOString(),
      url,
      confidence: "high",
      horizon: form === "8-K" ? "unknown" : "long_term",
      materiality: form === "8-K" ? "unknown" : "high",
      suggestedSteps,
      requiresReview: form === "8-K",
      rationale: form === "10-K"
        ? "A new annual report can change architecture, history, risk, capital allocation, WACC, and valuation."
        : form === "10-Q"
          ? "A new quarterly filing updates the historical data base and forecast inputs."
          : "A recent 8-K may contain earnings or material events; review before accepting.",
      impactAssessment: buildImpactAssessment({
        horizon: form === "8-K" ? "unknown" : "long_term",
        materiality: form === "8-K" ? "unknown" : "high",
        certainty: "high",
        quantifiability: form === "8-K" ? "unknown" : "known",
        action: form === "8-K" ? "manual_parameters" : "auto_rerun",
        dcfDrivers: form === "10-K"
          ? ["revenue_growth", "operating_margin", "business_mix", "net_debt", "wacc", "terminal_growth"]
          : form === "10-Q"
            ? ["revenue_growth", "operating_margin", "net_debt", "wacc"]
            : ["revenue_growth", "operating_margin"],
        parameterHints: form === "10-K"
          ? ["Use the new annual filing as the new source of truth for business structure, financial history, risks, and capital allocation."]
          : form === "10-Q"
            ? ["Refresh the latest quarter, balance sheet bridge, and forecast base from the new filing."]
            : ["Review the 8-K content before deciding whether it changes revenue, margin, capital allocation, or risk assumptions."],
        assessmentSummary: form === "8-K"
          ? "The filing is real, but the DCF effect depends on what the 8-K contains."
          : "The filing directly updates source-of-truth financial inputs, so the DCF impact is known enough to rerun automatically.",
      }),
    });
  }

  return { companyName: submissions.name || entry.title, events };
}

function classifyNewsTitle(title: string): Omit<Step0DetectedEvent, "id" | "source" | "title" | "detectedAt" | "eventDate" | "url"> | null {
  const text = title.toLowerCase();

  if (matches(text, ["acquire", "acquisition", "merger", "merge", "buyout", "divest", "spinoff", "spin off"])) {
    return newsClassification(
      "mna_or_divestiture",
      "Potential corporate action detected.",
      "high",
      "long_term",
      "high",
      [1, 2, 3, 4, 5, 6, 7, 8],
      false,
      "M&A or divestiture can change business architecture, pro forma financials, competitive position, and valuation.",
      "estimable",
      "auto_rerun",
      ["business_mix", "revenue_growth", "operating_margin", "net_debt", "wacc", "terminal_growth"],
      [
        "Use transaction value, expected close timing, financing mix, and disclosed synergy targets if available.",
        "If pro forma financials are missing, rerun the qualitative architecture and keep valuation scenarios separate.",
      ],
      "This is likely a durable structural event. If transaction economics are disclosed, the impact is estimable enough to rerun the workflow.",
    );
  }

  if (matches(text, ["launch", "unveil", "release", "product", "ai", "chip", "platform", "feature", "model"])) {
    return newsClassification(
      "new_product_or_technology",
      "Product or technology news detected.",
      "medium",
      "unknown",
      "unknown",
      [5, 6, 8],
      true,
      "Product news may be short-term or long-term. Review durability and materiality before changing the base case.",
      "unknown",
      "manual_parameters",
      ["revenue_growth", "gross_margin", "operating_margin", "terminal_growth"],
      [
        "Estimate adoption timing, pricing, incremental revenue, and margin profile only if management or credible sources provide evidence.",
        "If impact is unclear, adjust scenario assumptions instead of changing the base-case forecast.",
      ],
      "The event may affect growth, but long-term adoption and financial magnitude are not yet known.",
    );
  }

  if (matches(text, ["rival", "competitor", "competition", "market share", "price war", "pricing pressure"])) {
    return newsClassification(
      "competitive_shift",
      "Competitive landscape news detected.",
      "medium",
      "one_to_two_years",
      "medium",
      [3, 4, 5, 6, 8],
      true,
      "Competitive news can affect moat durability, pricing, growth, and valuation, but usually needs human confirmation.",
      "estimable",
      "manual_parameters",
      ["revenue_growth", "operating_margin", "moat_duration", "terminal_growth"],
      [
        "Estimate market-share, pricing, retention, or take-rate pressure only if there is credible evidence.",
        "If the shift is early, rerun competition and keep the DCF impact in sensitivities.",
      ],
      "Competitive changes may be durable, but the magnitude often needs analyst judgment before updating base-case assumptions.",
    );
  }

  if (matches(text, ["lawsuit", "sues", "probe", "investigation", "regulator", "antitrust", "ban", "fine", "settlement"])) {
    return newsClassification(
      "regulation_or_litigation",
      "Regulatory or litigation news detected.",
      "medium",
      "unknown",
      "unknown",
      [3, 5, 6, 7, 8],
      true,
      "Legal or regulatory events can affect risk and cash flows, but impact size often requires review.",
      "unknown",
      "manual_parameters",
      ["revenue_growth", "operating_margin", "wacc", "terminal_growth"],
      [
        "Quantify fines, settlement cost, restricted revenue, compliance cost, or risk premium only if the source provides enough detail.",
        "If the event is procedural, monitor it before changing valuation assumptions.",
      ],
      "Regulatory events can matter a lot, but the DCF effect is often binary or uncertain until legal outcomes are clearer.",
    );
  }

  if (matches(text, ["ceo", "cfo", "resigns", "steps down", "appoints", "management", "activist"])) {
    return newsClassification(
      "management_change",
      "Management or governance news detected.",
      "medium",
      "one_to_two_years",
      "medium",
      [4, 5, 6, 8],
      true,
      "Leadership changes can affect strategy and capital allocation, but may not require a full rerun.",
      "unknown",
      "manual_parameters",
      ["business_mix", "capex", "share_count", "net_debt", "terminal_growth"],
      [
        "Adjust capital allocation, investment intensity, buybacks, or strategy only if new leadership gives explicit guidance.",
        "If there is no strategic change yet, treat as a monitoring item.",
      ],
      "Management changes are potentially long-lived, but the DCF impact is not known without a strategy or capital allocation update.",
    );
  }

  return null;
}

function newsClassification(
  changeType: Step0ChangeType,
  summary: string,
  confidence: Step0ImpactCertainty,
  horizon: Step0ImpactHorizon,
  materiality: Step0ImpactMateriality,
  suggestedSteps: number[],
  requiresReview: boolean,
  rationale: string,
  quantifiability: Step0ImpactQuantifiability,
  action: Step0ImpactAction,
  dcfDrivers: Step0DcfImpactDriver[],
  parameterHints: string[],
  assessmentSummary: string,
): Omit<Step0DetectedEvent, "id" | "source" | "title" | "detectedAt" | "eventDate" | "url"> {
  return {
    changeType,
    summary,
    confidence,
    horizon,
    materiality,
    suggestedSteps,
    requiresReview,
    rationale,
    impactAssessment: buildImpactAssessment({
      horizon,
      materiality,
      certainty: confidence,
      quantifiability,
      action,
      dcfDrivers,
      parameterHints,
      assessmentSummary,
    }),
  };
}

function buildImpactAssessment(input: {
  horizon: Step0ImpactHorizon;
  materiality: Step0ImpactMateriality;
  certainty: Step0ImpactCertainty;
  quantifiability: Step0ImpactQuantifiability;
  action: Step0ImpactAction;
  dcfDrivers: Step0DcfImpactDriver[];
  parameterHints: string[];
  assessmentSummary: string;
}): Step0ImpactAssessment {
  return {
    horizon: input.horizon,
    materiality: input.materiality,
    certainty: input.certainty,
    quantifiability: input.quantifiability,
    action: input.action,
    dcfDrivers: input.dcfDrivers,
    parameterHints: input.parameterHints,
    assessmentSummary: input.assessmentSummary,
  };
}

function matches(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => {
    if (keyword.includes(" ")) return text.includes(keyword);
    return new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "i").test(text);
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecent(value: string): boolean {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const ageMs = Date.now() - date.getTime();
  return ageMs <= RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

function toYahooNewsDate(value: number | Date): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(value * 1000).toISOString();
}

function dedupeEvents(events: Step0DetectedEvent[]): Step0DetectedEvent[] {
  const seen = new Set<string>();
  const unique: Step0DetectedEvent[] = [];

  for (const event of events.sort((a, b) => (b.eventDate ?? b.detectedAt).localeCompare(a.eventDate ?? a.detectedAt))) {
    const key = `${event.source}-${event.changeType}-${event.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(event);
  }

  return unique.slice(0, 20);
}

function hashText(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
