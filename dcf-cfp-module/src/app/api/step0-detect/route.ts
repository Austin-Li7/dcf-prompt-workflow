import { NextRequest, NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";
import type {
  Step0ChangeType,
  Step0DetectResponse,
  Step0DetectedEvent,
  Step0ImpactCertainty,
  Step0ImpactHorizon,
  Step0ImpactMateriality,
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
): Omit<Step0DetectedEvent, "id" | "source" | "title" | "detectedAt" | "eventDate" | "url"> {
  return { changeType, summary, confidence, horizon, materiality, suggestedSteps, requiresReview, rationale };
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
