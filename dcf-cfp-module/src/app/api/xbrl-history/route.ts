import { NextResponse } from "next/server";
import type { HistoricalExtractionRow } from "@/types/cfp";
import type { Step2IndustrialStructuredResult } from "@/lib/step2-industrial-schema";

export const runtime = "nodejs";

type SecTickerEntry = {
  cik_str: number;
  ticker: string;
  title: string;
};

type SecFactUnit = {
  fy?: number;
  fp?: string;
  form?: string;
  filed?: string;
  frame?: string;
  accn?: string;
  start?: string;
  end?: string;
  val?: number;
};

type SecConcept = {
  units?: Record<string, SecFactUnit[]>;
};

type CompanyFacts = {
  cik: number;
  entityName: string;
  facts?: {
    "us-gaap"?: Record<string, SecConcept>;
    dei?: Record<string, SecConcept>;
  };
};

type Submissions = {
  filings?: {
    recent?: {
      accessionNumber?: string[];
      form?: string[];
      reportDate?: string[];
      filingDate?: string[];
      primaryDocument?: string[];
      fiscalYear?: number[];
      fiscalPeriod?: string[];
    };
  };
};

type SecFiling = {
  accessionNumber: string;
  accessionNoDash: string;
  primaryDocument: string;
  reportDate: string;
  filingDate: string;
  fiscalYear: number;
  fiscalPeriod: "FY" | "Q1" | "Q2" | "Q3" | "Q4";
  form: "10-K" | "10-Q";
  url: string;
};

type XbrlContext = {
  id: string;
  year: number | null;
  endDate: string | null;
  days: number | null;
  annual: boolean;
  quarterly: boolean;
  members: string[];
};

type SegmentRevenueFact = {
  target: XbrlTargetLine;
  matchedMember: string;
  revenueUsdM: number;
  tag: string;
  tagRank: number;
  contextRef: string;
};

type XbrlTargetLine = {
  name: string;
  parentSegment: string;
  category: string;
  isOffering: boolean;
};

const SEC_HEADERS = {
  "User-Agent": "dcf-prompt-local-dev/1.0 ruoqili-codex-sec-xbrl",
  Accept: "application/json",
};

const METRIC_TAGS = {
  revenue_usd_m: [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "SalesRevenueNet",
  ],
  operating_income_usd_m: ["OperatingIncomeLoss"],
  gross_profit_usd_m: ["GrossProfit"],
  capex_usd_m: [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PaymentsToAcquireProductiveAssets",
    "CapitalExpendituresIncurredButNotYetPaid",
  ],
  depreciation_amortization_usd_m: [
    "DepreciationDepletionAndAmortization",
    "DepreciationDepletionAndAmortizationExpense",
    "DepreciationAndAmortization",
  ],
} as const;

type MetricKey = keyof typeof METRIC_TAGS;

function cik10(cik: number | string): string {
  return String(cik).replace(/\D/g, "").padStart(10, "0");
}

function fiscalYearFromFrame(frame: string | undefined): number | null {
  const match = frame?.match(/CY(\d{4})/);
  return match ? Number(match[1]) : null;
}

function durationDays(fact: SecFactUnit): number | null {
  if (!fact.start || !fact.end) return null;
  const days = (Date.parse(fact.end) - Date.parse(fact.start)) / 86_400_000;
  return Number.isFinite(days) ? days : null;
}

function isAnnualFact(fact: SecFactUnit): boolean {
  const form = fact.form ?? "";
  if (!/^10-K/.test(form)) return false;
  if (fact.fp !== "FY") return false;
  const days = durationDays(fact);
  if (days === null || days < 250 || days > 390) return false;
  if (fact.frame && /Q[1-4]/.test(fact.frame)) return false;
  return typeof fact.val === "number";
}

function factYear(fact: SecFactUnit): number | null {
  return typeof fact.fy === "number" ? fact.fy : fiscalYearFromFrame(fact.frame);
}

function pickAnnualFact(
  facts: CompanyFacts,
  tags: readonly string[],
  year: number,
  preferredAccn?: string,
): { tag: string; fact: SecFactUnit } | null {
  const gaap = facts.facts?.["us-gaap"] ?? {};
  for (const tag of tags) {
    const concept = gaap[tag];
    const usdFacts = concept?.units?.USD ?? [];
    const candidates = usdFacts
      .filter(isAnnualFact)
      .filter((fact) => factYear(fact) === year)
      .sort((a, b) => {
        const aPreferred = preferredAccn && a.accn === preferredAccn ? 1 : 0;
        const bPreferred = preferredAccn && b.accn === preferredAccn ? 1 : 0;
        if (aPreferred !== bPreferred) return bPreferred - aPreferred;
        return Date.parse(b.filed ?? "") - Date.parse(a.filed ?? "");
      });
    if (candidates[0]) return { tag, fact: candidates[0] };
  }
  return null;
}

function allAnnualYears(facts: CompanyFacts): number[] {
  const gaap = facts.facts?.["us-gaap"] ?? {};
  const years = new Set<number>();
  for (const tag of METRIC_TAGS.revenue_usd_m) {
    const candidates = gaap[tag]?.units?.USD ?? [];
    for (const fact of candidates) {
      if (!isAnnualFact(fact)) continue;
      const year = factYear(fact);
      if (typeof year === "number") years.add(year);
    }
  }
  return [...years].sort((a, b) => b - a);
}

function toUsdM(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round((Math.abs(value) / 1_000_000) * 10) / 10;
}

function inlineFactToUsdM(value: string, scale: string | undefined): number | null {
  const numeric = Number(value.replace(/,/g, "").replace(/[()]/g, "").trim());
  if (!Number.isFinite(numeric)) return null;
  const sign = /\(/.test(value) ? -1 : 1;
  const scaleNum = scale != null && scale.trim() !== "" ? Number(scale) : 0;
  const scaled = sign * numeric * Math.pow(10, Number.isFinite(scaleNum) ? scaleNum : 0);
  return Math.round((scaled / 1_000_000) * 10) / 10;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function textContent(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim());
}

function normalizeName(value: string): string {
  return value
    .replace(/^[a-zA-Z0-9_]+:/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b(member|axis|segment|region|statement|business|geographical|areas|product|service)\b/gi, " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function matchesSegment(member: string, segmentName: string): boolean {
  const memberNorm = normalizeName(member);
  const segmentNorm = normalizeName(segmentName);
  if (!memberNorm || !segmentNorm) return false;
  return memberNorm === segmentNorm || memberNorm.includes(segmentNorm) || segmentNorm.includes(memberNorm);
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      if (["and", "or", "of", "the"].includes(lower)) return lower;
      if (["ev", "fsd"].includes(lower)) return lower.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ")
    .replace(/\bUs\b/g, "US");
}

function displayNameFromMember(member: string): string {
  const withoutPrefix = decodeHtml(member).replace(/^[a-zA-Z0-9_]+:/, "");
  const words = withoutPrefix
    .replace(/Member$/i, "")
    .replace(/Axis$/i, "")
    .replace(/Domain$/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return titleCase(words);
}

function isGenericSegmentMember(member: string, target: XbrlTargetLine): boolean {
  const memberNorm = normalizeName(member);
  const targetNorm = normalizeName(target.parentSegment || target.name);
  const targetNameNorm = normalizeName(target.name);
  if (!memberNorm || !targetNorm) return true;
  const genericVariants = new Set([
    targetNorm,
    targetNameNorm,
    `${targetNorm} revenue`,
    `${targetNorm} revenues`,
    `${targetNorm} total`,
    `${targetNorm} segment`,
    `${targetNorm} operating`,
    `${targetNorm} reportable`,
  ]);
  if (genericVariants.has(memberNorm)) return true;
  if (memberNorm.endsWith(" revenues") && memberNorm.replace(/\s+revenues$/, "") === targetNorm) return true;
  if (memberNorm.endsWith(" revenue") && memberNorm.replace(/\s+revenue$/, "") === targetNorm) return true;
  return false;
}

function lineCategoryFromMember(member: string): string {
  const norm = normalizeName(member);
  if (/\bregulatory credit/.test(norm)) return "Regulatory credits";
  if (/\bleasing\b/.test(norm)) return "Leasing";
  if (/\bservices?\b/.test(norm) || /\bother\b/.test(norm)) return "Services and other";
  if (/\bsales?\b/.test(norm)) return "Sales";
  if (/\bsolar\b/.test(norm)) return "Solar";
  if (/\bstorage\b|\benergy\b/.test(norm)) return "Energy products";
  return "XBRL revenue line";
}

function targetKey(target: XbrlTargetLine): string {
  return `${normalizeName(target.parentSegment)}|${normalizeName(target.name)}`;
}

function bestMemberForTarget(members: string[], target: XbrlTargetLine): string | null {
  const matches = members.filter((candidate) => matchesSegment(candidate, target.name));
  if (matches.length === 0) return null;
  return matches.sort((a, b) => {
    if (target.isOffering) {
      const aExact = normalizeName(a) === normalizeName(target.name) ? 1 : 0;
      const bExact = normalizeName(b) === normalizeName(target.name) ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;
    }
    const aGeneric = isGenericSegmentMember(a, target) ? 1 : 0;
    const bGeneric = isGenericSegmentMember(b, target) ? 1 : 0;
    if (aGeneric !== bGeneric) return aGeneric - bGeneric;
    return normalizeName(b).length - normalizeName(a).length;
  })[0];
}

function targetFromMatchedMember(target: XbrlTargetLine, member: string): XbrlTargetLine {
  if (target.isOffering || isGenericSegmentMember(member, target)) return target;
  const name = displayNameFromMember(member);
  return {
    name,
    parentSegment: target.parentSegment || target.name,
    category: lineCategoryFromMember(member),
    isOffering: true,
  };
}

function inferParentSegmentFromMember(member: string, targetLines: XbrlTargetLine[]): string | null {
  const norm = normalizeName(member);
  const parentTargets = targetLines.filter((target) => !target.isOffering);
  const direct = parentTargets.find((target) => matchesSegment(member, target.name));
  if (direct) return direct.parentSegment || direct.name;

  const energy = parentTargets.find((target) => /\benergy\b|\bstorage\b|\bsolar\b/.test(normalizeName(target.name)));
  const automotive = parentTargets.find((target) => /\bauto\b|\bvehicle\b/.test(normalizeName(target.name)));

  if (/\benergy\b|\bstorage\b|\bsolar\b|\bmegapack\b|\bpowerwall\b/.test(norm)) {
    return energy?.parentSegment ?? energy?.name ?? null;
  }
  if (/\bauto\b|\bvehicle\b|\bregulatory credit\b|\bleasing\b|\bservices?\b|\bother\b/.test(norm)) {
    return automotive?.parentSegment ?? automotive?.name ?? null;
  }
  return null;
}

function targetFromUnmatchedMember(member: string, targetLines: XbrlTargetLine[]): XbrlTargetLine | null {
  const parentSegment = inferParentSegmentFromMember(member, targetLines);
  if (!parentSegment) return null;
  const target: XbrlTargetLine = {
    name: parentSegment,
    parentSegment,
    category: "Segment total",
    isOffering: false,
  };
  if (isGenericSegmentMember(member, target)) return target;
  return {
    name: displayNameFromMember(member),
    parentSegment,
    category: lineCategoryFromMember(member),
    isOffering: true,
  };
}

function preferDetailedTargets(targets: XbrlTargetLine[]): XbrlTargetLine[] {
  const parentsWithDetail = new Set(
    targets
      .filter((target) => target.isOffering)
      .map((target) => normalizeName(target.parentSegment)),
  );
  return targets
    .filter((target) => target.isOffering || !parentsWithDetail.has(normalizeName(target.parentSegment)))
    .sort((a, b) => a.parentSegment.localeCompare(b.parentSegment) || a.name.localeCompare(b.name));
}

function revenueTagRank(tag: string): number {
  const index = METRIC_TAGS.revenue_usd_m.findIndex((candidate) => candidate === tag);
  return index >= 0 ? index : METRIC_TAGS.revenue_usd_m.length;
}

function inferFiscalPeriod(form: string, reportDate: string, secFp?: string): "FY" | "Q1" | "Q2" | "Q3" | "Q4" {
  if (form === "10-K") return "FY";
  if (secFp === "Q1" || secFp === "Q2" || secFp === "Q3" || secFp === "Q4") return secFp;
  const month = Number(reportDate.slice(5, 7));
  if (month <= 3) return "Q1";
  if (month <= 6) return "Q2";
  if (month <= 9) return "Q3";
  return "Q4";
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: SEC_HEADERS, cache: "no-store" });
  if (!res.ok) throw new Error(`SEC request failed (${res.status}) for ${url}`);
  return (await res.json()) as T;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { ...SEC_HEADERS, Accept: "text/html,application/xhtml+xml" }, cache: "no-store" });
  if (!res.ok) throw new Error(`SEC document request failed (${res.status}) for ${url}`);
  return await res.text();
}

async function resolveTicker(query: string): Promise<SecTickerEntry> {
  const lookup = await fetchJson<Record<string, SecTickerEntry>>(
    "https://www.sec.gov/files/company_tickers.json",
  );
  const normalized = query.trim().toUpperCase();
  const normalizedName = normalizeName(query);
  const entries = Object.values(lookup);
  const match =
    entries.find((entry) => entry.ticker.toUpperCase() === normalized) ??
    entries.find((entry) => normalizeName(entry.title) === normalizedName) ??
    entries.find((entry) => normalizeName(entry.title).includes(normalizedName));
  if (!match) throw new Error(`${query} was not found in the SEC ticker list.`);
  return match;
}

async function recentFilings(cik: string, annualCount: number): Promise<SecFiling[]> {
  const submissions = await fetchJson<Submissions>(
    `https://data.sec.gov/submissions/CIK${cik}.json`,
  );
  const recent = submissions.filings?.recent;
  if (!recent?.accessionNumber || !recent.form || !recent.reportDate || !recent.primaryDocument) {
    return [];
  }

  const allFilings: SecFiling[] = [];
  for (let i = 0; i < recent.accessionNumber.length; i += 1) {
    const form = recent.form[i];
    if (form !== "10-K" && form !== "10-Q") continue;
    const accessionNumber = recent.accessionNumber[i];
    const primaryDocument = recent.primaryDocument[i];
    const reportDate = recent.reportDate[i];
    const filingDate = recent.filingDate?.[i] ?? reportDate;
    if (!accessionNumber || !primaryDocument || !reportDate) continue;
    const fiscalYear = Number(recent.fiscalYear?.[i] ?? reportDate.slice(0, 4));
    if (!Number.isInteger(fiscalYear)) continue;
    const accessionNoDash = accessionNumber.replace(/-/g, "");
    allFilings.push({
      accessionNumber,
      accessionNoDash,
      primaryDocument,
      reportDate,
      filingDate,
      fiscalYear,
      fiscalPeriod: inferFiscalPeriod(form, reportDate, recent.fiscalPeriod?.[i]),
      form,
      url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionNoDash}/${primaryDocument}`,
    });
  }

  const annualYears = allFilings
    .filter((filing) => filing.form === "10-K")
    .sort((a, b) => b.fiscalYear - a.fiscalYear)
    .slice(0, annualCount)
    .map((filing) => filing.fiscalYear);
  const yearSet = new Set(annualYears);
  return allFilings
    .filter((filing) => yearSet.has(filing.fiscalYear) && (filing.form === "10-K" || ["Q1", "Q2", "Q3"].includes(filing.fiscalPeriod)))
    .sort((a, b) => a.fiscalYear - b.fiscalYear || a.fiscalPeriod.localeCompare(b.fiscalPeriod));
}

function attr(tag: string, name: string): string | undefined {
  const pattern = new RegExp(`${name}=["']([^"']+)["']`, "i");
  return tag.match(pattern)?.[1];
}

function parseContexts(documentHtml: string): Map<string, XbrlContext> {
  const contexts = new Map<string, XbrlContext>();
  const contextRe = /<xbrli:context\b[^>]*\bid=["']([^"']+)["'][^>]*>([\s\S]*?)<\/xbrli:context>/gi;
  let match: RegExpExecArray | null;
  while ((match = contextRe.exec(documentHtml))) {
    const id = match[1];
    const body = match[2];
    const start = body.match(/<xbrli:startDate[^>]*>([^<]+)<\/xbrli:startDate>/i)?.[1];
    const end = body.match(/<xbrli:endDate[^>]*>([^<]+)<\/xbrli:endDate>/i)?.[1];
    const instant = body.match(/<xbrli:instant[^>]*>([^<]+)<\/xbrli:instant>/i)?.[1];
    const days =
      start && end ? (Date.parse(end) - Date.parse(start)) / 86_400_000 : null;
    const annual = days != null && Number.isFinite(days) && days >= 250 && days <= 390;
    const quarterly = days != null && Number.isFinite(days) && days >= 60 && days <= 120;
    const yearSource = end ?? instant ?? null;
    const year = yearSource ? Number(yearSource.slice(0, 4)) : null;
    const members: string[] = [];
    const memberRe = /<xbrldi:explicitMember\b[^>]*>([^<]+)<\/xbrldi:explicitMember>/gi;
    let memberMatch: RegExpExecArray | null;
    while ((memberMatch = memberRe.exec(body))) {
      members.push(decodeHtml(memberMatch[1]));
    }
    contexts.set(id, { id, year, endDate: end ?? instant ?? null, days, annual, quarterly, members });
  }
  return contexts;
}

function parseSegmentRevenueFacts(
  documentHtml: string,
  filing: SecFiling,
  targetLines: XbrlTargetLine[],
): SegmentRevenueFact[] {
  const contexts = parseContexts(documentHtml);
  const facts: SegmentRevenueFact[] = [];
  const tags = METRIC_TAGS.revenue_usd_m.join("|");
  const factRe = new RegExp(
    `<ix:nonFraction\\b([^>]*)\\bname=["'](?:us-gaap:)?(${tags})["']([^>]*)>([\\s\\S]*?)<\\/ix:nonFraction>`,
    "gi",
  );
  let match: RegExpExecArray | null;
  while ((match = factRe.exec(documentHtml))) {
    const attrs = `${match[1]} ${match[3]}`;
    const contextRef = attr(attrs, "contextRef");
    if (!contextRef) continue;
    const context = contexts.get(contextRef);
    if (!context || context.members.length === 0) continue;
    const expectedEnd = filing.reportDate;
    const periodMatches =
      filing.form === "10-K"
        ? context.annual
        : context.quarterly && context.endDate === expectedEnd;
    if (!periodMatches || context.year !== filing.fiscalYear) continue;
    const value = inlineFactToUsdM(textContent(match[4]), attr(attrs, "scale"));
    if (value == null) continue;

    let matchedTarget: XbrlTargetLine | null = null;
    let matchedMember: string | null = null;
    for (const target of targetLines) {
      const member = bestMemberForTarget(context.members, target);
      if (!member) continue;
      matchedTarget = targetFromMatchedMember(target, member);
      matchedMember = member;
      break;
    }
    if (!matchedTarget || !matchedMember) {
      const preferredMember = context.members
        .filter((member) => !/Axis|Domain$/i.test(member))
        .sort((a, b) => normalizeName(b).length - normalizeName(a).length)[0];
      if (!preferredMember) continue;
      matchedTarget = targetFromUnmatchedMember(preferredMember, targetLines);
      matchedMember = preferredMember;
    }
    if (!matchedTarget || !matchedMember) continue;

      facts.push({
        target: matchedTarget,
        matchedMember,
        revenueUsdM: value,
        tag: match[2],
        tagRank: revenueTagRank(match[2]),
        contextRef,
      });
  }

  const bestBySegment = new Map<string, SegmentRevenueFact>();
  for (const fact of facts) {
    const current = bestBySegment.get(targetKey(fact.target));
    if (
      !current ||
      fact.tagRank < current.tagRank ||
      (fact.tagRank === current.tagRank && fact.revenueUsdM > current.revenueUsdM)
    ) {
      bestBySegment.set(targetKey(fact.target), fact);
    }
  }
  return [...bestBySegment.values()].sort(
    (a, b) => a.target.parentSegment.localeCompare(b.target.parentSegment) || a.target.name.localeCompare(b.target.name),
  );
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      ticker?: string;
      companyName?: string;
      query?: string;
      segmentNames?: string[];
      targetLines?: XbrlTargetLine[];
      years?: number;
    };
    const query = body.query?.trim() || body.ticker?.trim() || body.companyName?.trim();
    if (!query) {
      return NextResponse.json({ error: "Ticker or company name is required." }, { status: 400 });
    }

    const tickerEntry = await resolveTicker(query);
    const ticker = tickerEntry.ticker.toUpperCase();
    const cik = cik10(tickerEntry.cik_str);
    const companyFacts = await fetchJson<CompanyFacts>(
      `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
    );

    const requestedYears = Math.max(1, Math.min(10, Math.floor(body.years ?? 5)));
    const years = allAnnualYears(companyFacts).slice(0, requestedYears).sort((a, b) => a - b);
    if (years.length === 0) {
      return NextResponse.json(
        { error: `No annual 10-K XBRL revenue facts found for ${ticker}.` },
        { status: 404 },
      );
    }

    const requestedTargets = Array.isArray(body.targetLines) && body.targetLines.length > 0
      ? body.targetLines
          .filter((line) => line.name?.trim())
          .map((line) => ({
            name: line.name.trim(),
            parentSegment: line.parentSegment?.trim() || line.name.trim(),
            category: line.category?.trim() || line.parentSegment?.trim() || line.name.trim(),
            isOffering: Boolean(line.isOffering),
          }))
      : Array.isArray(body.segmentNames)
        ? body.segmentNames
            .filter((segment) => segment.trim().length > 0)
            .map((segment) => ({
              name: segment.trim(),
              parentSegment: segment.trim(),
              category: segment.trim(),
              isOffering: false,
            }))
        : [];
    const requestedSegments = requestedTargets.map((target) => target.name);

    const rows: HistoricalExtractionRow[] = [];
    const structuredResults: Step2IndustrialStructuredResult[] = [];
    const warnings: string[] = [];

    if (requestedTargets.length > 0) {
      const filings = await recentFilings(cik, requestedYears);
      const factsByYearSegmentQuarter = new Map<string, SegmentRevenueFact>();
      const annualFactsByYearSegment = new Map<string, SegmentRevenueFact>();
      const sourceByYearQuarter = new Map<string, SecFiling>();
      const discoveredTargets = new Map<string, XbrlTargetLine>();
      const matchedSegments = new Set<string>();

      for (const filing of filings) {
        try {
          const html = await fetchText(filing.url);
          const facts = parseSegmentRevenueFacts(html, filing, requestedTargets);
          if (facts.length === 0) {
            warnings.push(`${filing.fiscalYear} ${filing.fiscalPeriod}: no Step 1 segment revenue facts matched in filing-level XBRL.`);
            continue;
          }

          for (const fact of facts) {
            matchedSegments.add(fact.target.name);
            matchedSegments.add(fact.target.parentSegment);
            discoveredTargets.set(targetKey(fact.target), fact.target);
            if (filing.form === "10-K") {
              annualFactsByYearSegment.set(`${filing.fiscalYear}|${targetKey(fact.target)}`, fact);
              sourceByYearQuarter.set(`${filing.fiscalYear}|FY`, filing);
            } else {
              factsByYearSegmentQuarter.set(`${filing.fiscalYear}|${targetKey(fact.target)}|${filing.fiscalPeriod}`, fact);
              sourceByYearQuarter.set(`${filing.fiscalYear}|${filing.fiscalPeriod}`, filing);
            }
          }
        } catch (err) {
          warnings.push(
            `${filing.fiscalYear} ${filing.fiscalPeriod}: filing-level XBRL parse failed (${err instanceof Error ? err.message : "unknown error"}).`,
          );
        }
      }

      const segmentRows: HistoricalExtractionRow[] = [];
      const segmentStructuredResults: Step2IndustrialStructuredResult[] = [];
      const segmentYears = [...new Set(filings.map((filing) => filing.fiscalYear))].sort((a, b) => a - b);
      const effectiveTargets =
        discoveredTargets.size > 0 ? preferDetailedTargets([...discoveredTargets.values()]) : requestedTargets;
      const sourceIdsForYear = (year: number) =>
        ["Q1", "Q2", "Q3", "FY"]
          .map((period) => sourceByYearQuarter.get(`${year}|${period}`))
          .filter((filing): filing is SecFiling => Boolean(filing))
          .map((filing) => ({
            source_id: `sec-inline-xbrl-${filing.fiscalYear}-${filing.fiscalPeriod}`,
            source_type: "derived" as const,
            name: `SEC inline XBRL ${filing.form} ${filing.fiscalYear} ${filing.fiscalPeriod}`,
            locator: filing.url,
            excerpt: `${filing.form} filed ${filing.filingDate}; period ended ${filing.reportDate}.`,
          }));

      for (const year of segmentYears) {
        const yearRows: HistoricalExtractionRow[] = [];
        for (const target of effectiveTargets) {
          const key = targetKey(target);
          const q1 = factsByYearSegmentQuarter.get(`${year}|${key}|Q1`);
          const q2 = factsByYearSegmentQuarter.get(`${year}|${key}|Q2`);
          const q3 = factsByYearSegmentQuarter.get(`${year}|${key}|Q3`);
          const annual = annualFactsByYearSegment.get(`${year}|${key}`);
          const q4Revenue =
            annual && q1 && q2 && q3
              ? Math.round((annual.revenueUsdM - q1.revenueUsdM - q2.revenueUsdM - q3.revenueUsdM) * 10) / 10
              : null;
          const quarterFacts: Array<["Q1" | "Q2" | "Q3" | "Q4", SegmentRevenueFact | null, number | null, string]> = [
            ["Q1", q1 ?? null, q1?.revenueUsdM ?? null, "Direct 10-Q three-month inline XBRL segment revenue."],
            ["Q2", q2 ?? null, q2?.revenueUsdM ?? null, "Direct 10-Q three-month inline XBRL segment revenue."],
            ["Q3", q3 ?? null, q3?.revenueUsdM ?? null, "Direct 10-Q three-month inline XBRL segment revenue."],
            ["Q4", annual ?? null, q4Revenue, "Derived as 10-K annual segment revenue minus Q1-Q3 segment revenue."],
          ];

          for (const [quarter, fact, revenue, note] of quarterFacts) {
            if (revenue == null) {
              warnings.push(`${year} ${quarter} ${target.name}: segment/product revenue not found or not derivable from XBRL.`);
              continue;
            }
            if (revenue < 0) {
              warnings.push(`${year} ${quarter} ${target.name}: derived revenue was negative (${revenue}); row was not imported.`);
              continue;
            }
            const sourceFiling =
              quarter === "Q4"
                ? sourceByYearQuarter.get(`${year}|FY`)
                : sourceByYearQuarter.get(`${year}|${quarter}`);
            const row: HistoricalExtractionRow = {
              id: `sec-inline-xbrl-${ticker}-${year}-${quarter}-${normalizeName(`${target.parentSegment}-${target.name}`).replace(/\s+/g, "-")}`,
              fiscalYear: year,
              quarter,
              segment: target.parentSegment,
              productCategory: target.isOffering ? target.category : "Segment total",
              productName: target.isOffering ? target.name : "Segment total",
              revenue,
              yoyGrowth: 0,
              operatingIncome: null,
              notes: note,
              reviewStatus: "Verified",
              internalVerify: "Yes",
              sourceType: "Internal",
              sourceName: sourceFiling
                ? `SEC inline XBRL ${sourceFiling.form} ${year} ${sourceFiling.fiscalPeriod}`
                : `SEC inline XBRL ${year}`,
              sourceLink: sourceFiling?.url,
              reviewNote:
                quarter === "Q4"
                  ? `Derived Q4 from annual us-gaap:${fact?.tag ?? "Revenue"} less Q1-Q3; annual member ${fact?.matchedMember ?? target.name}.`
                  : `Revenue tag us-gaap:${fact?.tag}; matched XBRL member ${fact?.matchedMember}; context ${fact?.contextRef}.`,
              workflow_mode: "industrial",
              isAnnualFiling: quarter === "Q4",
              gross_profit_usd_m: null,
              capex_usd_m: null,
              depreciation_amortization_usd_m: null,
              headcount: null,
            };
            yearRows.push(row);
            segmentRows.push(row);
          }
        }

        if (yearRows.length > 0) {
          segmentStructuredResults.push({
            schema_version: "v5.5",
            workflow: "industrial",
            company_name: companyFacts.entityName || tickerEntry.title,
            target_year: year,
            rows: yearRows.map((row) => ({
              row_id: row.id,
              fiscal_year: row.fiscalYear,
              quarter: row.quarter as "Q1" | "Q2" | "Q3" | "Q4",
              segment: row.segment,
              product_category: row.productCategory,
              product_name: row.productName,
              revenue_usd_m: row.revenue,
              operating_income_usd_m: null,
              gross_profit_usd_m: null,
              capex_usd_m: null,
              depreciation_amortization_usd_m: null,
              headcount: null,
              mapped_from_step1_ids: [],
              source_id:
                row.quarter === "Q4"
                  ? `sec-inline-xbrl-${year}-FY`
                  : `sec-inline-xbrl-${year}-${row.quarter}`,
              evidence_level: "DISCLOSED",
              validation_status: "verified_source",
              review_note: row.reviewNote ?? "SEC inline XBRL quarterly segment revenue.",
            })),
            sources: sourceIdsForYear(year),
            excluded_items: requestedSegments
              .filter((segment) => !yearRows.some((row) => row.productName === segment || row.segment === segment))
              .map((segment) => ({
                label: segment,
                reason: "No quarterly segment revenue fact was found or derivable for this segment/year.",
                source_id: null,
                evidence_level: "UNSUPPORTED",
              })),
            validation_warnings: [],
            review_summary: {
              one_line: `Imported ${yearRows.length} quarterly segment revenue row(s) for FY${year} from SEC inline XBRL.`,
              highlights: [
                "Q1-Q3 use 10-Q three-month segment facts when available.",
                "Q4 is derived from 10-K annual segment revenue less Q1-Q3.",
                "Rows are matched to Step 1 segments and XBRL-disclosed revenue/product line members.",
              ],
              warnings: effectiveTargets.length * 4 > yearRows.length
                ? ["Some Step 1 segment-quarter rows were not found or derivable from XBRL."]
                : [],
            },
            capex_mda_split: null,
          });
        }
      }

      if (segmentRows.length > 0) {
        return NextResponse.json({
          ticker,
          cik,
          companyName: companyFacts.entityName || tickerEntry.title,
          years: segmentYears,
          rows: segmentRows,
          structuredResults: segmentStructuredResults,
          segmentCoverage: {
            requestedSegments,
            matchedSegments: [...matchedSegments].sort(),
            missingSegments: requestedSegments.filter((segment) => !matchedSegments.has(segment)),
            note:
              "Imported quarterly segment revenue by matching Step 1 segment names to 10-Q/10-K inline XBRL dimension members. Q4 is derived from annual 10-K less Q1-Q3 when possible.",
          },
          warnings,
        });
      }

      warnings.push("No filing-level XBRL segment revenue matched Step 1 segments; falling back to company-total XBRL.");
    }

    for (const year of years) {
      const revenueFact = pickAnnualFact(companyFacts, METRIC_TAGS.revenue_usd_m, year);
      const preferredAccn = revenueFact?.fact.accn;
      const metricFacts = Object.fromEntries(
        (Object.keys(METRIC_TAGS) as MetricKey[]).map((metric) => [
          metric,
          metric === "revenue_usd_m"
            ? revenueFact
            : pickAnnualFact(companyFacts, METRIC_TAGS[metric], year, preferredAccn),
        ]),
      ) as Record<MetricKey, { tag: string; fact: SecFactUnit } | null>;

      const revenue = metricFacts.revenue_usd_m;
      const sourceAccn =
        revenue?.fact.accn ??
        metricFacts.operating_income_usd_m?.fact.accn ??
        metricFacts.gross_profit_usd_m?.fact.accn ??
        `SEC-XBRL-${year}`;
      const sourceId = `sec-xbrl-${year}`;
      const sourceLink = sourceAccn.includes("-")
        ? `https://www.sec.gov/Archives/edgar/data/${Number(tickerEntry.cik_str)}/${sourceAccn.replace(/-/g, "")}/`
        : "https://data.sec.gov/";

      const row: HistoricalExtractionRow = {
        id: `sec-xbrl-${ticker}-${year}`,
        fiscalYear: year,
        quarter: "Q4",
        segment: "Company Total (XBRL)",
        productCategory: "Company Total",
        productName: "Company Total",
        revenue: toUsdM(revenue?.fact.val),
        yoyGrowth: 0,
        operatingIncome: toUsdM(metricFacts.operating_income_usd_m?.fact.val),
        notes: "SEC XBRL companyfacts annual 10-K fact. Segment-level dimensions may require filing-level XBRL parsing.",
        reviewStatus: "Verified",
        internalVerify: "Yes",
        sourceType: "Internal",
        sourceName: `SEC XBRL 10-K ${year}`,
        sourceLink,
        reviewNote: [
          "Company-total annual row from SEC XBRL.",
          revenue ? `Revenue tag: us-gaap:${revenue.tag}.` : "Revenue tag not found.",
          metricFacts.operating_income_usd_m
            ? `Operating income tag: us-gaap:${metricFacts.operating_income_usd_m.tag}.`
            : "Operating income tag not found.",
        ].join(" "),
        workflow_mode: "industrial",
        isAnnualFiling: true,
        gross_profit_usd_m: toUsdM(metricFacts.gross_profit_usd_m?.fact.val),
        capex_usd_m: toUsdM(metricFacts.capex_usd_m?.fact.val),
        depreciation_amortization_usd_m: toUsdM(
          metricFacts.depreciation_amortization_usd_m?.fact.val,
        ),
        headcount: null,
      };
      rows.push(row);

      const missing = (Object.keys(metricFacts) as MetricKey[]).filter((metric) => !metricFacts[metric]);
      if (missing.length > 0) warnings.push(`${year}: missing ${missing.join(", ")} in companyfacts.`);

      structuredResults.push({
        schema_version: "v5.5",
        workflow: "industrial",
        company_name: companyFacts.entityName || tickerEntry.title,
        target_year: year,
        rows: [
          {
            row_id: `sec-xbrl-${ticker}-${year}`,
            fiscal_year: year,
            quarter: "Q4",
            segment: "Company Total (XBRL)",
            revenue_usd_m: row.revenue,
            operating_income_usd_m: row.operatingIncome,
            gross_profit_usd_m: row.gross_profit_usd_m ?? null,
            capex_usd_m: row.capex_usd_m ?? null,
            depreciation_amortization_usd_m: row.depreciation_amortization_usd_m ?? null,
            headcount: null,
            mapped_from_step1_ids: [],
            source_id: sourceId,
            evidence_level: "DISCLOSED",
            validation_status: "verified_source",
            review_note: row.reviewNote ?? "SEC XBRL company-total fact.",
          },
        ],
        sources: [
          {
            source_id: sourceId,
            source_type: "derived",
            name: `SEC XBRL companyfacts ${ticker} FY${year}`,
            locator: sourceLink,
            excerpt: (Object.keys(metricFacts) as MetricKey[])
              .map((metric) => {
                const found = metricFacts[metric];
                return found ? `${metric}=us-gaap:${found.tag}` : `${metric}=not found`;
              })
              .join("; ")
              .slice(0, 200),
          },
        ],
        excluded_items: [],
        validation_warnings: missing.map((metric) => ({
          code: "XBRL_METRIC_NOT_FOUND",
          severity: "warn",
          message: `${metric} was not found in SEC companyfacts for FY${year}.`,
          row_ids: [`sec-xbrl-${ticker}-${year}`],
        })),
        review_summary: {
          one_line: `Imported FY${year} company-total historical metrics from SEC XBRL companyfacts.`,
          highlights: [
            "Source is SEC structured XBRL companyfacts, not PDF table extraction.",
            "Values are annual company-total 10-K facts in USD millions.",
          ],
          warnings: missing.length
            ? ["Some DCF metrics were not available under the configured us-gaap tag fallbacks."]
            : [],
        },
        capex_mda_split: null,
      });
    }

    return NextResponse.json({
      ticker,
      cik,
      companyName: companyFacts.entityName || tickerEntry.title,
      years,
      rows,
      structuredResults,
      segmentCoverage: {
        requestedSegments,
        matchedSegments: [],
        missingSegments: requestedSegments,
        note:
          "SEC companyfacts provides comparable company-level facts. Segment dimensions usually require filing-level inline XBRL parsing, so use the PDF/filing extractor for segment rows that are not present here.",
      },
      warnings,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "SEC XBRL import failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
